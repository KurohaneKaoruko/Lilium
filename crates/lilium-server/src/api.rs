use axum::extract::{DefaultBodyLimit, Multipart, Path as UrlPath, Query as QQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

use axum::routing::{get, post, patch, put};
use axum::{Json, Router};
use lilium_core::import::ItemPatch;
use lilium_core::query::Query;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::shared::{ok_json, with_lib_blocking, ApiError, ArcState};
use crate::ServerState;

pub fn router(state: Arc<ServerState>) -> Router {
    Router::new()
        .route("/api/info", get(info))
        .route("/api/folders", get(folders).post(create_folder))
        .route("/api/folders/{id}", patch(update_folder).delete(delete_folder))
        .route("/api/tags", get(tags).post(create_tag))
        .route("/api/tags/{name}", patch(update_tag).delete(delete_tag))
        .route("/api/smart-folders", get(smart_folders).post(create_smart_folder))
        .route("/api/smart-folders/{id}", put(update_smart_folder).delete(delete_smart_folder))
        .route("/api/items", get(items))
        .route("/api/items/{id}", get(item_detail).patch(update_item).delete(delete_item))
        .route("/api/items/{id}/restore", post(restore_item))
        .route("/api/items/{id}/similar", get(similar_items))
        .route("/api/items/{id}/file", get(item_file))
        .route("/api/thumbs/{id}", get(item_thumb))
        .route("/api/items/{id}/tags/{tag}", put(add_tag).delete(remove_tag))
        .route("/api/batch", post(batch))
        .route("/api/batch-rename", post(batch_rename))
        .route("/api/import/paths", post(import_paths))
        .route("/api/import/upload", post(import_upload))
        .route("/api/import/url", post(import_url))
        .route("/api/import/eagle", post(import_eagle))
        .route("/api/duplicates", get(duplicates))
        .route("/api/suggest", get(suggest))
        .route("/api/settings", get(settings).patch(set_setting))
        .route("/api/watch-scan", post(watch_scan))
        .route("/api/reveal/{id}", post(reveal_item))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 1024))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state)
}

// ---------- library ----------

async fn info(State(state): State<ArcState>) -> Result<Response, ApiError> {
    let v = with_lib_blocking(&state, |lib| Ok(lib.info())).await?;
    Ok(ok_json(v))
}

// ---------- folders ----------

async fn folders(State(state): State<ArcState>) -> Result<Response, ApiError> {
    let v = with_lib_blocking(&state, |lib| Ok(lib.list_folders())).await?;
    Ok(ok_json(v))
}

#[derive(Deserialize)]
struct CreateFolderReq {
    #[serde(default)]
    parent_id: Option<String>,
    name: String,
}

async fn create_folder(State(state): State<ArcState>, Json(req): Json<CreateFolderReq>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(anyhow::anyhow!("文件夹名不能为空"));
        }
        let parent_id = sanitize_id(req.parent_id.as_deref());
        lib.create_folder(parent_id, name).map(|f| Json(f).into_response())
    })
    .await
}

#[derive(Deserialize)]
struct UpdateFolderReq {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    parent_id: Option<String>,
    move_to_root: bool,
}

async fn update_folder(
    State(state): State<ArcState>,
    UrlPath(id): UrlPath<String>,
    Json(req): Json<UpdateFolderReq>,
) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        if let Some(name) = &req.name {
            lib.rename_folder(&id, name)?;
        }
        if req.move_to_root {
            lib.move_folder(&id, None)?;
        } else if let Some(pid) = &req.parent_id {
            lib.move_folder(&id, Some(pid))?;
        }
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

async fn delete_folder(State(state): State<ArcState>, UrlPath(id): UrlPath<String>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.delete_folder(&id)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

// ---------- tags ----------

async fn tags(State(state): State<ArcState>) -> Result<Response, ApiError> {
    let v = with_lib_blocking(&state, |lib| Ok(lib.list_tags())).await?;
    Ok(ok_json(v))
}

#[derive(Deserialize)]
struct CreateTagReq {
    name: String,
    #[serde(default = "default_color")]
    color: String,
}
fn default_color() -> String {
    "#8b5cf6".into()
}

async fn create_tag(State(state): State<ArcState>, Json(req): Json<CreateTagReq>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.create_tag(&req.name, &req.color)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

#[derive(Deserialize)]
struct UpdateTagReq {
    name: String,
    color: Option<String>,
}

async fn update_tag(
    State(state): State<ArcState>,
    UrlPath(name): UrlPath<String>,
    Json(req): Json<UpdateTagReq>,
) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.rename_tag(&name, &req.name, req.color.as_deref())?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

async fn delete_tag(State(state): State<ArcState>, UrlPath(name): UrlPath<String>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.delete_tag(&name)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

// ---------- smart folders ----------

async fn smart_folders(State(state): State<ArcState>) -> Result<Response, ApiError> {
    let v = with_lib_blocking(&state, |lib| Ok(lib.list_smart_folders())).await?;
    Ok(ok_json(v))
}

#[derive(Deserialize)]
struct SmartFolderReq {
    name: String,
    query: Value,
}

async fn create_smart_folder(State(state): State<ArcState>, Json(req): Json<SmartFolderReq>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.create_smart_folder(&req.name, &req.query).map(|f| Json(f).into_response())
    })
    .await
}

async fn update_smart_folder(
    State(state): State<ArcState>,
    UrlPath(id): UrlPath<String>,
    Json(req): Json<SmartFolderReq>,
) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.update_smart_folder(&id, &req.name, &req.query)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

async fn delete_smart_folder(State(state): State<ArcState>, UrlPath(id): UrlPath<String>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.delete_smart_folder(&id)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

// ---------- items ----------

#[derive(Deserialize)]
struct ItemsQuery {
    #[serde(flatten)]
    q: Query,
    /// 递归查询子文件夹
    recursive: Option<lilium_core::query::LooseBool>,
}

async fn items(State(state): State<ArcState>, QQuery(q): QQuery<ItemsQuery>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        let mut query = q.q.clone();
        let recursive = q.recursive.map(|b| *b).unwrap_or(true);
        if recursive {
            if let Some(fid) = &query.folder_id {
                query.folder_ids = lib.folder_ids_recursive(fid);
                query.folder_id = None;
            }
        }
        let (items, total) = lib.query_items(&query);
        Ok(ok_json(json!({ "items": items, "total": total })))
    })
    .await
}

async fn item_detail(State(state): State<ArcState>, UrlPath(id): UrlPath<String>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        let item = lib.get_item(&id).ok_or_else(|| anyhow::anyhow!("条目不存在"))?;
        let mut items = vec![item];
        lib.attach_tags(&mut items);
        let item = items.pop().unwrap();
        let exif: Value = lib
            .conn
            .query_row("SELECT exif FROM items WHERE id=?1", [&id], |r| {
                r.get::<_, Option<String>>(0)
            })
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null);
        let path = lib.item_file_path(&id).map(|p| p.to_string_lossy().to_string());
        Ok(Json(json!({
            "item": item,
            "exif": exif,
            "path": path,
        }))
        .into_response())
    })
    .await
}

#[derive(Deserialize)]
struct UpdateItemReq {
    #[serde(flatten)]
    patch: ItemPatch,
}

async fn update_item(
    State(state): State<ArcState>,
    UrlPath(id): UrlPath<String>,
    Json(req): Json<UpdateItemReq>,
) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.update_item(&id, &req.patch).map(|it| Json(it).into_response())
    })
    .await
}

#[derive(Deserialize)]
struct DeleteItemReq {
    #[serde(default)]
    purge: lilium_core::query::LooseBool,
}

async fn delete_item(
    State(state): State<ArcState>,
    UrlPath(id): UrlPath<String>,
    QQuery(q): QQuery<DeleteItemReq>,
) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        if *q.purge {
            lib.purge_item(&id)?;
        } else {
            lib.trash_item(&id)?;
        }
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

async fn restore_item(State(state): State<ArcState>, UrlPath(id): UrlPath<String>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.restore_item(&id)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

async fn similar_items(State(state): State<ArcState>, UrlPath(id): UrlPath<String>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        let items = lib.similar_to(&id);
        Ok(Json(json!({ "items": items })).into_response())
    })
    .await
}

async fn item_file(State(state): State<ArcState>, UrlPath(id): UrlPath<String>, headers: axum::http::HeaderMap) -> Result<Response, ApiError> {
    let inm = headers
        .get(axum::http::header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let path = with_lib_blocking(&state, move |lib| {
        lib.item_file_path(&id).ok_or_else(|| anyhow::anyhow!("条目文件不存在"))
    })
    .await?;
    Ok(crate::shared::file_response(path, false, inm).await)
}

async fn item_thumb(State(state): State<ArcState>, UrlPath(id): UrlPath<String>, headers: axum::http::HeaderMap) -> Result<Response, ApiError> {
    let inm = headers
        .get(axum::http::header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    // 生成缩略图可能耗时 → 放到阻塞线程池
    let path = with_lib_blocking(&state, move |lib| {
        lib.ensure_thumbnail(&id).or_else(|_| {
            lib.item_thumb_path(&id)
                .ok_or_else(|| anyhow::anyhow!("无法生成缩略图"))
        })
    })
    .await?;
    Ok(crate::shared::file_response(path, true, inm).await)
}

// ---------- item tags ----------

async fn add_tag(
    State(state): State<ArcState>,
    UrlPath((id, tag)): UrlPath<(String, String)>,
) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.batch_tag(&[id], &tag, false)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

async fn remove_tag(
    State(state): State<ArcState>,
    UrlPath((id, tag)): UrlPath<(String, String)>,
) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.batch_tag(&[id], &tag, true)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

// ---------- batch ----------

#[derive(Deserialize)]
struct BatchReq {
    ids: Vec<String>,
    action: String,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    remove: bool,
    #[serde(default)]
    rating: Option<i64>,
    #[serde(default)]
    folder_id: Option<String>,
}

async fn batch(State(state): State<ArcState>, Json(req): Json<BatchReq>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        let n = match req.action.as_str() {
            "tag" => {
                let tag = req.tag.as_deref().ok_or_else(|| anyhow::anyhow!("缺少 tag"))?;
                lib.batch_tag(&req.ids, tag, req.remove)?;
                req.ids.len()
            }
            "rating" => {
                let r = req.rating.ok_or_else(|| anyhow::anyhow!("缺少 rating"))?;
                lib.batch_rating(&req.ids, r.clamp(0, 5))?;
                req.ids.len()
            }
            "move" => {
                lib.batch_move(&req.ids, req.folder_id.as_deref())?;
                req.ids.len()
            }
            "trash" => lib.batch_trash(&req.ids)?,
            "restore" => lib.batch_restore(&req.ids)?,
            "purge" => lib.batch_purge(&req.ids)?,
            other => return Err(anyhow::anyhow!("未知操作: {other}")),
        };
        Ok(Json(json!({"ok": true, "affected": n})).into_response())
    })
    .await
}

#[derive(Deserialize)]
struct BatchRenameReq {
    ids: Vec<String>,
    pattern: String,
}

async fn batch_rename(State(state): State<ArcState>, Json(req): Json<BatchRenameReq>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.batch_rename(&req.ids, &req.pattern)
            .map(|m| Json(json!({ "renamed": m })).into_response())
    })
    .await
}

// ---------- import ----------

#[derive(Deserialize)]
struct ImportPathsReq {
    paths: Vec<String>,
    #[serde(default)]
    folder_id: Option<String>,
}

async fn import_paths(State(state): State<ArcState>, Json(req): Json<ImportPathsReq>) -> Result<Response, ApiError> {
    let queue = state.queue.clone();
    with_lib_blocking(&state, move |lib| {
        let opts = lilium_core::import::ImportOptions::default();
        let mut total = 0;
        let mut errors = vec![];
        for p in &req.paths {
            let path = std::path::PathBuf::from(shellexpand(p));
            match lilium_core::import::import_paths_sync(lib, &path, req.folder_id.as_deref(), &opts, &queue) {
                Ok(n) => total += n,
                Err(e) => errors.push(format!("{}: {e}", path.display())),
            }
        }
        Ok(ok_json(json!({ "imported": total, "errors": errors })))
    })
    .await
}

fn shellexpand(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    p.to_string()
}

async fn import_upload(State(state): State<ArcState>, mut multipart: Multipart) -> Result<Response, ApiError> {
    let mut folder_id: Option<String> = None;
    let mut files: Vec<(String, Vec<u8>)> = vec![];
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.to_string()))?
    {
        match field.name().unwrap_or("") {
            "folderId" => {
                folder_id = Some(field.text().await.unwrap_or_default());
                if folder_id.as_deref() == Some("") {
                    folder_id = None;
                }
            }
            _ => {
                let name = field
                    .file_name()
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                // 浏览器/表单有时丢失扩展名，这里从 content-type 兜底恢复
                let name = if name.is_empty() {
                    format!("{}", lilium_core::jobs::new_id())
                } else {
                    name
                };
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.to_string()))?;
                files.push((name, bytes.to_vec()));
            }
        }
    }
    let queue = state.queue.clone();
    with_lib_blocking(&state, move |lib| {
        let mut imported = vec![];
        let mut errors = vec![];
        for (name, bytes) in files {
            match lilium_core::import::import_bytes(lib, bytes, &name, folder_id.as_deref(), &queue) {
                Ok(item) => imported.push(item),
                Err(e) => errors.push(format!("{name}: {e}")),
            }
        }
        Ok(Json(json!({ "items": imported, "errors": errors })).into_response())
    })
    .await
}

#[derive(Deserialize)]
struct ImportUrlReq {
    url: String,
    #[serde(default)]
    folder_id: Option<String>,
}

async fn import_url(State(state): State<ArcState>, Json(req): Json<ImportUrlReq>) -> Result<Response, ApiError> {
    let lib = state.lib.clone();
    let queue = state.queue.clone();
    let item = lilium_core::import::import_url(lib, &req.url, req.folder_id, (*queue).clone())
        .await
        .map_err(ApiError::from)?;
    Ok(ok_json(json!({ "item": item })))
}

#[derive(Deserialize)]
struct ImportEagleReq {
    path: String,
}

async fn import_eagle(State(state): State<ArcState>, Json(req): Json<ImportEagleReq>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        let eagle_root = std::path::PathBuf::from(shellexpand(&req.path));
        let report = lilium_core::eagle::import_eagle_library(lib, &eagle_root)?;
        Ok(Json(json!({ "report": report })).into_response())
    })
    .await
}

// ---------- misc ----------

async fn duplicates(State(state): State<ArcState>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, |lib| {
        let groups = lib.find_duplicates();
        let out: Vec<Value> = groups
            .into_iter()
            .map(|(reason, items)| json!({ "reason": reason, "items": items }))
            .collect();
        Ok(Json(json!({ "groups": out })).into_response())
    })
    .await
}

async fn suggest(State(state): State<ArcState>, QQuery(q): QQuery<std::collections::HashMap<String, String>>) -> Result<Response, ApiError> {
    let qv = q.get("q").cloned().unwrap_or_default();
    with_lib_blocking(&state, move |lib| {
        let suggestions = lib.suggest(&qv, 8);
        Ok(Json(json!({ "suggestions": suggestions })).into_response())
    })
    .await
}

async fn settings(State(state): State<ArcState>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, |lib| {
        lib.settings_get_all().pipe(|v| Ok(Json(v).into_response()))
    })
    .await
}

#[derive(Deserialize)]
struct SetSettingReq {
    key: String,
    value: Value,
}

async fn set_setting(State(state): State<ArcState>, Json(req): Json<SetSettingReq>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.settings_set(&req.key, &req.value)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

async fn watch_scan(State(state): State<ArcState>) -> Result<Response, ApiError> {
    let queue = state.queue.clone();
    with_lib_blocking(&state, move |lib| {
        let n = lib.scan_watch_folders(&queue)?;
        Ok(ok_json(json!({ "imported": n })))
    })
    .await
}

async fn reveal_item(State(state): State<ArcState>, UrlPath(id): UrlPath<String>) -> Result<Response, ApiError> {
    with_lib_blocking(&state, move |lib| {
        lib.reveal(&id)?;
        Ok(Json(json!({"ok": true})).into_response())
    })
    .await
}

// ---------- helpers ----------

fn sanitize_id(id: Option<&str>) -> Option<&str> {
    match id {
        Some(s) if !s.is_empty() && s != "null" => Some(s),
        _ => None,
    }
}

trait Pipe: Sized {
    fn pipe<F, T>(self, f: F) -> F::Output
    where
        F: FnOnce(Self) -> T,
    {
        f(self)
    }
}
impl<T> Pipe for T {}





