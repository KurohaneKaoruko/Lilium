use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::params;

use crate::jobs::JobQueue;
use crate::library::Library;
use crate::meta;

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportOptions {
    /// 来自观察文件夹（不复制 source，仅记录）
    pub watch: bool,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemPatch {
    pub name: Option<String>,
    pub rating: Option<i64>,
    pub note: Option<String>,
    pub url: Option<String>,
    pub folder_id: Option<String>,
}

/// 注册文件到库：复制进库、提取元数据、插入 DB、排队缩略图
/// `src` 是已存在的文件路径（会被复制到库内）
pub fn ingest_file(
    lib: &Library,
    src: &Path,
    folder_id: Option<&str>,
    original_name: Option<&str>,
    queue: &JobQueue,
) -> Result<crate::model::Item, anyhow::Error> {
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let name = original_name
        .map(|s| s.to_string())
        .or_else(|| src.file_name().map(|s| s.to_string_lossy().to_string()))
        .unwrap_or_else(|| "未命名".into());
    let kind = meta::kind_of(&ext);
    let size = std::fs::metadata(src).map(|m| m.len() as i64).unwrap_or(0);
    let id = crate::jobs::new_id();

    // copy into library
    let sub = lib.root.join("images").join(&id[0..2]);
    std::fs::create_dir_all(&sub)?;
    let dest = sub.join(format!("{id}.{ext}"));
    std::fs::copy(src, &dest)?;

    // metadata
    let (width, height, duration) = match kind {
        "image" => {
            let dims = meta::image_dimensions(&dest);
            (dims.map(|d| d.0 as i64), dims.map(|d| d.1 as i64), None)
        }
        "video" => meta::video_meta(&dest)
            .map(|(wh, dur, _)| (Some((wh / 1000) as i64), Some((wh % 1000) as i64), Some(dur)))
            .unwrap_or((None, None, None)),
        _ => (None, None, None),
    };

    // hash / palette / phash for images
    let mut hash = None;
    let mut phash = None;
    let mut palette = None;
    let mut dom: Option<(i64, i64, i64)> = None;
    if kind == "image" {
        hash = Some(crate::eagle::sha1_hex_file(&dest));
        if let Ok(img) = meta::decode_image(&dest) {
            palette = Some(crate::eagle::kmeans_palette(&img));
            dom = palette.as_ref().map(|p| p.1);
            phash = Some(crate::eagle::dhash_hex(&img));
        }
    }

    let created_at = meta::exif_date_or_mtime(&dest);
    let exif = if kind == "image" { meta::exif_json(&dest).map(|e| e.to_string()) } else { None };

    lib.conn.execute(
        "INSERT INTO items(id,name,ext,kind,size,width,height,duration,hash,phash,r,g,b,palette,
          folder_id,source_path,exif,added_at,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        params![
            id,
            name,
            ext,
            kind,
            size,
            width,
            height,
            duration,
            hash,
            phash,
            dom.map(|d| d.0),
            dom.map(|d| d.1),
            dom.map(|d| d.2),
            palette.map(|p| serde_json::to_string(&p.0).unwrap_or_default()),
            folder_id,
            src.to_string_lossy(),
            exif,
            crate::jobs::now_ms(),
            created_at,
        ],
    )?;
    queue.queue_thumbnail(id.clone());
    let mut item = lib.get_item(&id).ok_or_else(|| anyhow::anyhow!("导入后读取条目失败"))?;
    item.tags = vec![];
    Ok(item)
}

/// 从注册表中读取直接文件（可递归目录）
pub fn collect_files(path: &Path, recursive: bool) -> Vec<PathBuf> {
    let mut out = vec![];
    if path.is_file() {
        out.push(path.to_path_buf());
        return out;
    }
    let walker = if recursive {
        walkdir::WalkDir::new(path).into_iter()
    } else {
        walkdir::WalkDir::new(path).max_depth(1).into_iter()
    };
    for e in walker.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.is_file() {
            // 跳过库自身 / 隐藏文件
            let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if name.starts_with('.') || name.ends_with(".lilium") || name == "library.db" {
                continue;
            }
            out.push(p.to_path_buf());
        }
    }
    out.sort();
    out
}

/// 导入本地路径（文件或目录），返回 (导入条目, 错误列表)
pub fn import_paths_sync(
    lib: &Library,
    path: &Path,
    folder_id: Option<&str>,
    opts: &ImportOptions,
    queue: &JobQueue,
) -> Result<usize, anyhow::Error> {
    let files = collect_files(path, true);
    let mut n = 0;
    for f in &files {
        if ingest_file(lib, f, folder_id, None, queue).is_ok() {
            n += 1;
        }
    }
    let _ = opts;
    Ok(n)
}

/// 导入内存字节（上传 / URL 下载结果）
pub fn import_bytes(
    lib: &Library,
    bytes: Vec<u8>,
    filename: &str,
    folder_id: Option<&str>,
    queue: &JobQueue,
) -> Result<crate::model::Item, anyhow::Error> {
    // 保留原文件扩展名，便于类型识别
    let ext = std::path::Path::new(filename)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let tmp = std::env::temp_dir().join(format!("lilium-upload-{}{}", crate::jobs::new_id(), ext));
    std::fs::write(&tmp, &bytes)?;
    let item = ingest_file(lib, &tmp, folder_id, Some(filename), queue);
    std::fs::remove_file(&tmp).ok();
    item
}

/// 从 URL 导入
pub async fn import_url(
    lib: std::sync::Arc<std::sync::Mutex<Library>>,
    url: &str,
    folder_id: Option<String>,
    queue: JobQueue,
) -> Result<crate::model::Item, anyhow::Error> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Lilium/0.1)")
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let filename = resp
        .url()
        .path_segments()
        .and_then(|s| s.last().map(|s| s.to_string()))
        .filter(|s| !s.is_empty() && s.contains('.'))
        .unwrap_or_else(|| format!("{}.{}", crate::jobs::new_id(), guess_ext(resp.headers())));
    let bytes = resp.bytes().await?.to_vec();
    let libc = lib.clone();
    let queue2 = queue.clone();
    let folder2 = folder_id.clone();
    let fname = filename.clone();
    tokio::task::spawn_blocking(move || {
        let lib = libc.lock().unwrap();
        import_bytes(&lib, bytes, &fname, folder2.as_deref(), &queue2)
    })
    .await
    .map_err(|e| anyhow::anyhow!(e.to_string()))?
}

fn guess_ext(headers: &reqwest::header::HeaderMap) -> String {
    let ct = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    match ct.split(';').next().unwrap_or("").trim() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/avif" => "avif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        _ => "bin",
    }
    .to_string()
}

/// 读取（可能很大文件的）前 N 字节
pub fn read_head(path: &Path, n: usize) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    let mut buf = vec![0u8; n];
    let mut read = 0;
    while read < n {
        let k = f.read(&mut buf[read..])?;
        if k == 0 {
            break;
        }
        read += k;
    }
    buf.truncate(read);
    Ok(buf)
}
