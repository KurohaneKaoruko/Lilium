//! Lilium 桌面端（Tauri 2）
//!
//! 复用 lilium-core 的全部能力；Web UI 由打包内嵌的 web/dist 提供，
//! 核心逻辑通过 Tauri command 与前端通信（无需 HTTP 端口，也保留 HTTP 模式）。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};

use lilium_core::jobs::JobQueue;
use lilium_core::Library;

struct DeskState {
    lib: Arc<Mutex<Library>>,
    queue: Arc<JobQueue>,
}

static PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(7333);

fn main() {
    let lib = open_or_create_library();
    let (queue, rx) = JobQueue::new();
    let lib = Arc::new(Mutex::new(lib));
    JobQueue::spawn_worker(queue.clone(), rx, lib.clone());

    // 启动内嵌 HTTP 服务（与 Web 版共用同一套 REST API，前端零改动）
    // 端口冲突时自动递增，实际端口通过 get_api_base 暴露给前端
    let lib2 = lib.clone();
    let queue2 = queue.clone();
    tauri::async_runtime::spawn(async move {
        match lilium_server::serve_embedded(lib2, queue2, None, 7333).await {
            Ok(port) => PORT.store(port, std::sync::atomic::Ordering::SeqCst),
            Err(e) => eprintln!("内嵌服务启动失败: {e}"),
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(DeskState { lib, queue })
        .invoke_handler(tauri::generate_handler![
            get_api_base,
            lib_info,
            list_folders,
            list_tags,
            list_smart_folders,
            query_items,
            item_detail,
            update_item,
            trash_items,
            restore_items,
            purge_items,
            batch,
            batch_rename,
            item_file_path,
            item_thumb_path,
            ensure_thumb,
            create_folder,
            rename_folder,
            delete_folder,
            import_paths,
            import_eagle,
            save_note,
            reveal,
            copy_file_to_clipboard,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lilium");
}

/// 前端启动时调用：获取内嵌 API 的实际地址（端口可能因冲突而递增）
#[tauri::command]
fn get_api_base() -> String {
    format!(
        "http://127.0.0.1:{}",
        PORT.load(std::sync::atomic::Ordering::SeqCst)
    )
}

fn open_or_create_library() -> Library {
    let home = std::env::var("HOME")
        .map(|h| std::path::PathBuf::from(h))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let base = home.join("Lilium");
    let path = base.join("Lilium.lilium");
    if path.join("library.db").is_file() {
        Library::open(&path).expect("打开库失败")
    } else {
        Library::create(&base, "Lilium").expect("创建库失败")
    }
}

type JsonResult<T> = Result<T, String>;

fn with_lib<T>(state: &DeskState, f: impl FnOnce(&mut Library) -> JsonResult<T>) -> JsonResult<T> {
    let mut lib = state.lib.lock().map_err(|e| e.to_string())?;
    f(&mut lib)
}

fn estr(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
fn lib_info(state: tauri::State<DeskState>) -> JsonResult<serde_json::Value> {
    with_lib(&state, |lib| Ok(lib.info()))
}

#[tauri::command]
fn list_folders(state: tauri::State<DeskState>) -> JsonResult<Vec<lilium_core::model::Folder>> {
    with_lib(&state, |lib| Ok(lib.list_folders()))
}

#[tauri::command]
fn list_tags(state: tauri::State<DeskState>) -> JsonResult<Vec<lilium_core::model::Tag>> {
    with_lib(&state, |lib| Ok(lib.list_tags()))
}

#[tauri::command]
fn list_smart_folders(state: tauri::State<DeskState>) -> JsonResult<Vec<lilium_core::model::SmartFolder>> {
    with_lib(&state, |lib| Ok(lib.list_smart_folders()))
}

#[tauri::command]
fn query_items(state: tauri::State<DeskState>, query: lilium_core::query::Query) -> JsonResult<serde_json::Value> {
    with_lib(&state, |lib| {
        let mut q = query;
        if let Some(fid) = q.folder_id.clone() {
            q.folder_ids = lib.folder_ids_recursive(&fid);
            q.folder_id = None;
        }
        let (items, total) = lib.query_items(&q);
        Ok(serde_json::json!({ "items": items, "total": total }))
    })
}

#[tauri::command]
fn item_detail(state: tauri::State<DeskState>, id: String) -> JsonResult<serde_json::Value> {
    with_lib(&state, |lib| {
        let item = lib.get_item(&id).ok_or("条目不存在")?;
        let mut items = vec![item];
        lib.attach_tags(&mut items);
        let item = items.pop().unwrap();
        let exif: serde_json::Value = lib
            .conn
            .query_row("SELECT exif FROM items WHERE id=?1", [&id], |r| r.get::<_, Option<String>>(0))
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::Value::Null);
        let path = lib.item_file_path(&id).map(|p| p.to_string_lossy().to_string());
        Ok(serde_json::json!({ "item": item, "exif": exif, "path": path }))
    })
}

#[tauri::command]
fn update_item(state: tauri::State<DeskState>, id: String, patch: lilium_core::import::ItemPatch) -> JsonResult<lilium_core::model::Item> {
    with_lib(&state, |lib| lib.update_item(&id, &patch).map_err(|e| e.to_string()))
}

#[tauri::command]
fn trash_items(state: tauri::State<DeskState>, ids: Vec<String>) -> JsonResult<usize> {
    with_lib(&state, |lib| lib.batch_trash(&ids).map_err(|e| e.to_string()))
}

#[tauri::command]
fn restore_items(state: tauri::State<DeskState>, ids: Vec<String>) -> JsonResult<usize> {
    with_lib(&state, |lib| lib.batch_restore(&ids).map_err(|e| e.to_string()))
}

#[tauri::command]
fn purge_items(state: tauri::State<DeskState>, ids: Vec<String>) -> JsonResult<usize> {
    with_lib(&state, |lib| lib.batch_purge(&ids).map_err(|e| e.to_string()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
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

#[tauri::command]
fn batch(state: tauri::State<DeskState>, req: BatchReq) -> JsonResult<usize> {
    with_lib(&state, |lib| {
        match req.action.as_str() {
            "tag" => lib.batch_tag(&req.ids, req.tag.as_deref().unwrap_or(""), req.remove).map_err(estr)?,
            "rating" => lib.batch_rating(&req.ids, req.rating.unwrap_or(0).clamp(0, 5)).map_err(estr)?,
            "move" => lib.batch_move(&req.ids, req.folder_id.as_deref()).map_err(estr)?,
            "trash" => {
                return lib.batch_trash(&req.ids).map_err(|e| e.to_string());
            }
            "restore" => {
                return lib.batch_restore(&req.ids).map_err(|e| e.to_string());
            }
            "purge" => {
                return lib.batch_purge(&req.ids).map_err(|e| e.to_string());
            }
            _ => return Err("未知操作".into()),
        }
        Ok(req.ids.len())
    })
}

#[tauri::command]
fn batch_rename(state: tauri::State<DeskState>, ids: Vec<String>, pattern: String) -> JsonResult<Vec<(String, String)>> {
    with_lib(&state, |lib| lib.batch_rename(&ids, &pattern).map_err(|e| e.to_string()))
}

#[tauri::command]
fn item_file_path(state: tauri::State<DeskState>, id: String) -> JsonResult<String> {
    with_lib(&state, |lib| {
        lib.item_file_path(&id)
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "文件不存在".into())
    })
}

#[tauri::command]
fn item_thumb_path(state: tauri::State<DeskState>, id: String) -> JsonResult<Option<String>> {
    with_lib(&state, |lib| {
        Ok(lib.item_thumb_path(&id).map(|p| p.to_string_lossy().to_string()))
    })
}

#[tauri::command]
fn ensure_thumb(state: tauri::State<DeskState>, id: String) -> JsonResult<Option<String>> {
    with_lib(&state, |lib| {
        Ok(lib.ensure_thumbnail(&id).ok().map(|p| p.to_string_lossy().to_string()))
    })
}

#[tauri::command]
fn create_folder(state: tauri::State<DeskState>, parent_id: Option<String>, name: String) -> JsonResult<lilium_core::model::Folder> {
    with_lib(&state, |lib| lib.create_folder(parent_id.as_deref(), &name).map_err(|e| e.to_string()))
}

#[tauri::command]
fn rename_folder(state: tauri::State<DeskState>, id: String, name: String) -> JsonResult<()> {
    with_lib(&state, |lib| lib.rename_folder(&id, &name).map_err(|e| e.to_string()))
}

#[tauri::command]
fn delete_folder(state: tauri::State<DeskState>, id: String) -> JsonResult<()> {
    with_lib(&state, |lib| lib.delete_folder(&id).map_err(|e| e.to_string()))
}

#[tauri::command]
fn import_paths(state: tauri::State<DeskState>, paths: Vec<String>, folder_id: Option<String>) -> JsonResult<serde_json::Value> {
    with_lib(&state, |lib| {
        let opts = lilium_core::import::ImportOptions::default();
        let mut total = 0;
        let mut errors = vec![];
        for p in &paths {
            let path = std::path::PathBuf::from(p);
            match lilium_core::import::import_paths_sync(lib, &path, folder_id.as_deref(), &opts, &state.queue) {
                Ok(n) => total += n,
                Err(e) => errors.push(format!("{p}: {e}")),
            }
        }
        Ok(serde_json::json!({ "imported": total, "errors": errors }))
    })
}

#[tauri::command]
fn import_eagle(state: tauri::State<DeskState>, path: String) -> JsonResult<serde_json::Value> {
    with_lib(&state, |lib| {
        let eagle_root = std::path::PathBuf::from(&path);
        let report = lilium_core::eagle::import_eagle_library(lib, &eagle_root).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "report": report }))
    })
}

#[tauri::command]
fn save_note(state: tauri::State<DeskState>, id: String, note: String) -> JsonResult<()> {
    with_lib(&state, |lib| {
        lib.conn
            .execute(
                "UPDATE items SET note=?1 WHERE id=?2",
                [note.as_str(), id.as_str()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn reveal(state: tauri::State<DeskState>, id: String) -> JsonResult<()> {
    with_lib(&state, |lib| lib.reveal(&id).map_err(|e| e.to_string()))
}

#[tauri::command]
fn copy_file_to_clipboard(app: tauri::AppHandle, state: tauri::State<DeskState>, id: String) -> JsonResult<()> {
    use tauri_plugin_opener::OpenerExt;
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let path = with_lib(&state, |lib| {
        lib.item_file_path(&id)
            .map(|p| p.to_string_lossy().to_string())
            .ok_or_else(|| "文件不存在".into())
    })?;
    let dir = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
    let _ = app.clipboard().write_text(path);
    Ok(())
}
