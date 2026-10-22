//! 最近资源库注册表：跨库记忆，供库切换面板使用。
//!
//! 存储于全局配置 `~/.config/lilium/libraries.json`：
//! `{ "recent": [{ "path": "...", "name": "...", "lastOpened": 0, "kind": "lilium"|"eagle-imported" }] }`

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub path: String,
    pub name: String,
    pub lastOpened: i64,
    /// lilium = 原生库目录;eagle = 由 Eagle 库导入生成的伴生库
    pub kind: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Registry {
    recent: Vec<LibraryEntry>,
}

fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lilium")
        .join("libraries.json")
}

fn load() -> Registry {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(r: &Registry) -> anyhow::Result<()> {
    let p = config_path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    Ok(serde_json::to_writer_pretty(std::fs::File::create(&p)?, r)?)
}

/// 记录/刷新一次库打开（去重、置顶、上限 20 条）
pub fn touch(path: &Path, name: &str, kind: &str) -> anyhow::Result<()> {
    let mut r = load();
    let ps = path.to_string_lossy().to_string();
    r.recent.retain(|e| e.path != ps);
    r.recent.insert(
        0,
        LibraryEntry {
            path: ps,
            name: name.to_string(),
            lastOpened: crate::jobs::now_ms(),
            kind: kind.to_string(),
        },
    );
    r.recent.truncate(20);
    save(&r)
}

/// 最近库列表（新的在前）
pub fn list() -> Vec<LibraryEntry> {
    load().recent
}

/// 从列表移除（路径失效或用户删除）
pub fn remove(path: &Path) -> anyhow::Result<()> {
    let mut r = load();
    let ps = path.to_string_lossy().to_string();
    r.recent.retain(|e| e.path != ps);
    save(&r)
}
