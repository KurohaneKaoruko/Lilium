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

impl ServerState {
    /// 运行时切换库：换出 Mutex 内的 Library,观察扫描/任务队列无需重启
    pub fn switch_library(&self, path: &std::path::Path) -> Result<(String, bool), anyhow::Error> {
        let (newlib, eagle_imported) = Library::open_or_create(path)?;
        let name = newlib.name();
        let mut guard = self.lib.lock().map_err(|_| anyhow::anyhow!("库锁已损坏"))?;
        *guard = newlib;
        Ok((name, eagle_imported))
    }
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
/// `host`: 服务器部署用 [0,0,0,0]，桌面端用 [127,0,0,1]
pub async fn serve_embedded(
    lib: Arc<Mutex<Library>>,
    queue: std::sync::Arc<JobQueue>,
    web_dist: Option<PathBuf>,
    host: [u8; 4],
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

    // 端口冲突自动递增（多实例场景）
    let mut port = preferred_port;
    let listener = loop {
        match tokio::net::TcpListener::bind(std::net::SocketAddr::from((host, port))).await {
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
    let bound = serve_embedded(lib, queue, cfg.web_dist.or_else(|| auto_dist()), [0, 0, 0, 0], cfg.port).await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::ArcState;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::Value;
    use tower::ServiceExt;

    /// 构造带临时库的测试应用
    fn test_app(tag: &str) -> (axum::Router, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("lilium-server-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let lib = Library::create(&base, tag).unwrap();
        let state: ArcState = std::sync::Arc::new(ServerState {
            lib: std::sync::Arc::new(std::sync::Mutex::new(lib)),
            queue: JobQueue::new().0.into(),
            version: "test",
        });
        // api 模块私有 → 通过 serve_embedded 不合适，直接复用内部 router
        (api::router(state), base)
    }

    async fn post_json(app: axum::Router, uri: &str, body: String) -> (StatusCode, serde_json::Value) {
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        let v = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
        (status, v)
    }

    async fn patch_json(app: axum::Router, uri: &str, body: String) -> (StatusCode, serde_json::Value) {
        let res = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(uri)
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        let v = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
        (status, v)
    }

    async fn get_json(app: axum::Router, uri: &str) -> (StatusCode, serde_json::Value) {
        let res = app.oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap()).await.unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        let v = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
        (status, v)
    }

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        use image::ImageBuffer;
        let mut out = std::io::Cursor::new(Vec::new());
        let img: image::RgbaImage = ImageBuffer::from_pixel(w, h, image::Rgba([10, 20, 30, 255]));
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[tokio::test]
    async fn rename_folder_without_move_fields_is_accepted() {
        // 回归：move_to_root 缺 serde(default) 导致仅重命名请求 422
        let (app, base) = test_app("rename");
        let (status, v) = post_json(app.clone(), "/api/folders", r#"{"name":"A"}"#.into()).await;
        assert_eq!(status, StatusCode::OK, "{v}");
        let id = v["id"].as_str().unwrap().to_string();
        let (status, v) = patch_json(app.clone(), &format!("/api/folders/{id}"), r#"{"name":"B"}"#.into()).await;
        assert_eq!(status, StatusCode::OK, "仅重命名不应被拒绝: {v}");
        let (status, folders) = get_json(app, "/api/folders").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(folders[0]["name"], "B");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn batch_move_to_empty_folder_id_clears_folder() {
        let (app, base) = test_app("moveto");
        // 建文件夹
        let (_, f) = post_json(app.clone(), "/api/folders", r#"{"name":"F"}"#.into()).await;
        let fid = f["id"].as_str().unwrap().to_string();
        // 上传一张图
        let boundary = "----liliumtest";
        let png = png_bytes(16, 16);
        let body = format!(
            "--{b}\r\ncontent-disposition: form-data; name=\"folderId\"\r\n\r\n{fid}\r\n--{b}\r\ncontent-disposition: form-data; name=\"file\"; filename=\"x.png\"\r\ncontent-type: image/png\r\n\r\n",
            b = boundary,
            fid = fid
        );
        let mut full = body.into_bytes();
        full.extend_from_slice(&png);
        full.extend_from_slice(format!("\r\n--{boundary}--\r\n", boundary = boundary).as_bytes());
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/import/upload")
                    .header("content-type", format!("multipart/form-data; boundary={boundary}", boundary = boundary))
                    .body(Body::from(full))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        let item_id = v["items"][0]["id"].as_str().unwrap().to_string();

        // move 到 folderId: "" → 应回退为未分类
        let (status, v) = post_json(
            app.clone(),
            "/api/batch",
            format!(r#"{{"ids":["{item_id}"],"action":"move","folderId":""}}"#),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{v}");
        let (_, items) = get_json(app, "/api/items").await;
        assert_eq!(items["items"][0]["folderId"], Value::Null);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn item_detail_returns_hash_for_info_panel() {
        // 回归：hash 在列表接口 skip_serializing 后，详情接口也没带出 → 前端「哈希」行永远为空
        let (app, base) = test_app("detailhash");
        let png = png_bytes(12, 12);
        // multipart 上传真实文件
        let boundary = "----liliumhash";
        let mut body = format!(
            "--{b}\r\ncontent-disposition: form-data; name=\"file\"; filename=\"h.png\"\r\ncontent-type: image/png\r\n\r\n",
            b = boundary
        )
        .into_bytes();
        body.extend_from_slice(&png);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n", boundary = boundary).as_bytes());
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/import/upload")
                    .header("content-type", format!("multipart/form-data; boundary={boundary}", boundary = boundary))
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        let up: Value = serde_json::from_slice(&bytes).unwrap();
        let item_id = up["items"][0]["id"].as_str().unwrap().to_string();

        let (_, detail) = get_json(app, &format!("/api/items/{item_id}")).await;
        let hash = detail["hash"].as_str().expect("详情接口应返回 hash");
        assert_eq!(hash.len(), 40, "SHA1 hex 长度应为 40");
        assert!(detail["phash"].is_null() || detail["phash"].is_string());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn batch_move_to_missing_folder_is_400() {
        let (app, base) = test_app("movemiss");
        let (status, v) = post_json(
            app,
            "/api/batch",
            format!(r#"{{"ids":["NOPE"],"action":"move","folderId":"MISSING"}}"#),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{v}");
        let _ = std::fs::remove_dir_all(&base);
    }
}
