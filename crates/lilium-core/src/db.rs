use std::path::Path;

use anyhow::anyhow;
use rusqlite::Connection;

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'image',
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration REAL,
  hash TEXT,
  phash TEXT,
  r INTEGER,
  g INTEGER,
  b INTEGER,
  palette TEXT,
  rating INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  folder_id TEXT,
  trash INTEGER NOT NULL DEFAULT 0,
  source_path TEXT,
  exif TEXT,
  added_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  thumb INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_folder ON items(folder_id);
CREATE INDEX IF NOT EXISTS idx_items_added ON items(added_at);
CREATE INDEX IF NOT EXISTS idx_items_trash ON items(trash);
CREATE INDEX IF NOT EXISTS idx_items_hash ON items(hash);
CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY,
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
CREATE TABLE IF NOT EXISTS smart_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

pub fn open_db(path: &Path) -> Result<Connection, anyhow::Error> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

pub fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .ok()
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), anyhow::Error> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        [key, value],
    )?;
    Ok(())
}

/// 检查目录是否是一个 Eagle 库（包含 metadata.json 与 images/）
pub fn looks_like_eagle_library(path: &Path) -> bool {
    path.join("metadata.json").is_file() && path.join("images").is_dir()
}

/// 便捷：把 &str 包成 anyhow 错误
pub fn err<T>(s: impl Into<String>) -> Result<T, anyhow::Error> {
    Err(anyhow!(s.into()))
}
