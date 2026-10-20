mod api;
mod shared;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use lilium_core::jobs::JobQueue;
use lilium_core::Library;

pub struct ServerState {
    pub lib: Arc<Mutex<Library>>,
    pub queue: std::sync::Arc<JobQueue>,
    pub version: &'static str,
}

pub struct ServerConfig {
    pub port: u16,
    pub library: Option<PathBuf>,
    pub web_dist: Option<PathBuf>,
    pub open_browser: bool,
}

pub fn default_config() -> ServerConfig {
    let mut library = None;
    // LILIUM_LIBRARY 环境变量
    if let Ok(p) = std::env::var("LILIUM_LIBRARY") {
        library = Some(PathBuf::from(p));
    }
    let port = std::env::var("LILIUM_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(7333);
    ServerConfig { port, library, web_dist: None, open_browser: false }
}

/// 拆分出的核心启动逻辑（供 Tauri 桌面端复用）：
/// 打开/创建库 → 启动缩略图 worker → 观察文件夹扫描 → 绑定 HTTP 端口
/// 返回实际绑定的端口（端口被占用时自动向后递增重试）
pub async fn serve_embedded(
    lib: Arc<Mutex<Library>>,
    queue: std::sync::Arc<JobQueue>,
    web_dist: Option<PathBuf>,
    preferred_port: u16,
) -> anyhow::Result<u16> {
    let state = Arc::new(ServerState { lib, queue, version: env!("CARGO_PKG_VERSION") });
    let mut app = api::router(state.clone());
    if let Some(dist) = web_dist.filter(|p| p.join("index.html").is_file()) {
        tracing::info!("托管 Web UI: {}", dist.display());
        let index = dist.clone();
        let fallback = tower_http::services::ServeDir::new(&dist)
            .fallback(tower_http::services::ServeFile::new(index.join("index.html")));
        app = app.fallback_service(fallback);
    }

    // 端口冲突自动递增（桌面端多开场景）
    let mut port = preferred_port;
    let listener = loop {
        match tokio::net::TcpListener::bind(std::net::SocketAddr::from(([127, 0, 0, 1], port))).await {
            Ok(l) => break l,
            Err(_) if port < 65535 => port += 1,
            Err(e) => return Err(e.into()),
        }
    };
    tracing::info!("Lilium 内嵌服务已启动: http://127.0.0.1:{}/", port);
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("内嵌服务异常退出: {e}");
        }
    });
    Ok(port)
}

pub async fn serve(cfg: ServerConfig) -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "lilium=info,tower_http=warn".into()),
        )
        .init();

    // 打开或创建库
    let lib = match &cfg.library {
        Some(path) => {
            if lilium_core::db::looks_like_eagle_library(path) {
                tracing::info!("检测到 Eagle 库，开始导入: {}", path.display());
                let (lib, report) = lilium_core::Library::open_eagle(path)?;
                tracing::info!(
                    "Eagle 导入完成：文件夹 {}，条目 {}，标签 {}，跳过 {}",
                    report.folders, report.items, report.tags, report.skipped
                );
                lib
            } else if path.join("library.db").is_file() {
                lilium_core::Library::open(path)?
            } else if path
                .extension()
                .map(|e| e == "lilium")
                .unwrap_or(false)
            {
                // xxx.lilium 已存在但没有 library.db → 视为需要重建
                std::fs::remove_dir_all(path).ok();
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Lilium".into());
                let parent = path.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
                lilium_core::Library::create(&parent, &name)?
            } else {
                // 打开普通目录作为库根（在该目录内直接建 library.db）
                lilium_core::Library::open(path).or_else(|_| {
                    let name = path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Lilium".into());
                    let parent = path.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
                    lilium_core::Library::create(&parent, &name)
                })?
            }
        }
        None => {
            // 默认库：~/Lilium/Lilium.lilium
            let base = dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("Lilium");
            lilium_core::Library::create(&base, "Lilium")?
        }
    };

    let (queue, rx) = JobQueue::new();
    let lib = Arc::new(Mutex::new(lib));
    JobQueue::spawn_worker(queue.clone(), rx, lib.clone());


    // 观察文件夹周期扫描（30s）
    spawn_watch_scan(lib.clone(), queue.clone());

    if cfg.open_browser {
        let _ = open::that(format!("http://localhost:{}/", cfg.port));
    }
    let bound = serve_embedded(lib, queue, cfg.web_dist.or_else(|| auto_dist()), cfg.port).await?;
    tracing::info!("Lilium 服务已启动: http://localhost:{}/", bound);
    // serve_embedded 内部已 spawn 服务，这里保持存活直到进程退出
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
    }
}

/// 自动探测前端 dist 目录
pub fn auto_dist() -> Option<PathBuf> {
    [
        PathBuf::from("web/dist"),
        PathBuf::from("/opt/lilium/web/dist"),
    ]
    .into_iter()
    .find(|p| p.join("index.html").is_file())
}

/// 观察文件夹周期扫描
pub fn spawn_watch_scan(lib: Arc<Mutex<Library>>, queue: std::sync::Arc<JobQueue>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            tick.tick().await;
            let l = lib.clone();
            let q = queue.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok(lib) = l.lock() {
                    let _ = lib.scan_watch_folders(&q);
                }
            })
            .await;
        }
    });
}pub mod cli {
    pub fn parse_args() -> super::ServerConfig {
        let mut cfg = super::default_config();
        let mut args = std::env::args().skip(1);
        while let Some(a) = args.next() {
            match a.as_str() {
                "--port" | "-p" => {
                    if let Some(v) = args.next().and_then(|v| v.parse().ok()) {
                        cfg.port = v;
                    }
                }
                "--library" | "-l" => {
                    if let Some(v) = args.next() {
                        cfg.library = Some(std::path::PathBuf::from(v));
                    }
                }
                "--dist" => {
                    if let Some(v) = args.next() {
                        cfg.web_dist = Some(std::path::PathBuf::from(v));
                    }
                }
                "--open" => cfg.open_browser = true,
                "--help" | "-h" => {
                    println!("lilium-server — Lilium 图片管理服务端\n\n选项:\n  -p, --port <端口>     监听端口（默认 7333）\n  -l, --library <路径>  库路径（.lilium 库或 Eagle .library 目录）\n      --dist <目录>     Web 前端静态目录\n      --open            启动后打开浏览器");
                    std::process::exit(0);
                }
                _ => {}
            }
        }
        cfg
    }
}
