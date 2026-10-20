use std::future::Future;

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use lilium_core::Library;

use crate::ServerState;

pub type ArcState = std::sync::Arc<ServerState>;

pub struct ApiError(pub StatusCode, pub String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, axum::Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    }
}

pub fn with_lib_blocking<T>(
    state: &ServerState,
    f: impl FnOnce(&mut Library) -> Result<T, anyhow::Error> + Send + 'static,
) -> impl Future<Output = Result<T, ApiError>> + Send
where
    T: Send + 'static,
{
    let lib = state.lib.clone();
    async move {
        tokio::task::spawn_blocking(move || {
            let mut lib = lib.lock().map_err(|_| poisoned())?;
            f(&mut lib).map_err(ApiError::from)
        })
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    }
}

fn poisoned() -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "库锁已损坏".into())
}

/// 文件响应（带 ETag / 304 协商缓存）
pub async fn file_response(
    path: std::path::PathBuf,
    cache: bool,
    if_none_match: Option<String>,
) -> Response {
    use tokio_util::io::ReaderStream;
    match tokio::fs::File::open(&path).await {
        Ok(file) => {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let mime = lilium_core::meta::mime_of(&ext);
            // 以 (路径, 修改时间, 长度) 生成强 ETag
            let etag = file
                .metadata()
                .await
                .ok()
                .map(|m| {
                    let mtime = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    format!("\"{}-{}-{}\"", path.display(), mtime, m.len())
                })
                .unwrap_or_default();

            // 协商缓存命中 → 304
            if cache {
                if let Some(inm) = &if_none_match {
                    // 浏览器可能发来多个候选（弱引用/引号差异），逐个比对
                    let candidates: Vec<String> = inm
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    if candidates.iter().any(|c| *c == etag || *c == format!("W/{etag}")) {
                        return Response::builder()
                            .status(StatusCode::NOT_MODIFIED)
                            .header(header::ETAG, etag)
                            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                            .body(Body::empty())
                            .unwrap();
                    }
                }
            }

            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);
            let mut resp = Response::builder().header(header::CONTENT_TYPE, mime);
            if cache {
                resp = resp
                    .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                    .header(header::ETAG, etag);
            }
            resp.body(body).unwrap()
        }
        Err(_) => (StatusCode::NOT_FOUND, "file not found").into_response(),
    }
}

pub fn ok_json<T: serde::Serialize>(v: T) -> Response {
    axum::Json(v).into_response()
}



