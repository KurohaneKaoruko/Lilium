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
-- 部分索引：hash 查询只发生在非回收站条目上（find_duplicates / 导入内容去重），
-- 体积更小且恰好覆盖查询的 WHERE trash=0 前缀
CREATE INDEX IF NOT EXISTS idx_items_hash_live ON items(hash) WHERE trash=0;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 旧库升级兼容：模拟「新索引加入前」创建的库（手工建表、只带旧索引），
    /// 再次 open_db 时 SCHEMA 幂等执行，应自动补建 idx_items_hash_live，
    /// 且 find_duplicates 的 hash 聚合查询能走上该索引（EXPLAIN 查询计划包含它）。
    #[test]
    fn open_db_backfills_partial_hash_index_on_old_library() {
        let dir = std::env::temp_dir().join(format!("lilium-old-db-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("library.db");

        // 第一阶段：用「旧版 SCHEMA」建库——即现行 SCHEMA 剥掉新加的
        // idx_items_hash_live 语句，模拟该索引引入前创建的老库
        let old_schema: String = SCHEMA
            .split(';')
            .filter(|stmt| !stmt.contains("idx_items_hash_live"))
            .collect::<Vec<_>>()
            .join(";");
        let old_conn = Connection::open(&db_path).unwrap();
        old_conn.execute_batch(&old_schema).unwrap();
        old_conn
            .execute(
                "INSERT INTO items(id,name,hash,trash) VALUES('OLD00000000000000001','a.png','h1',0)",
                [],
            )
            .unwrap();
        old_conn.close().unwrap();

        // 第二阶段：现行 open_db 打开旧库 → 幂等补建缺失索引，数据原样保留
        let conn = open_db(&db_path).unwrap();
        let idx: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_items_hash_live'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            idx.to_lowercase().contains("where trash=0"),
            "部分索引应带 WHERE trash=0 谓词，实际: {idx}"
        );
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "升级不得动旧数据");

        // find_duplicates 的聚合查询应能使用该部分索引（INDEXED BY 强制指定；
        // 若索引不适用于查询形状，SQLite 会直接报错）。不断言默认计划：
        // 规划器在 tiny 表上可能选择 idx_items_trash，属正常行为。
        let plan: String = conn
            .query_row(
                "EXPLAIN QUERY PLAN SELECT hash FROM items INDEXED BY idx_items_hash_live
                 WHERE trash=0 AND hash IS NOT NULL GROUP BY hash HAVING COUNT(*)>1",
                [],
                |r| r.get::<_, String>(3),
            )
            .unwrap_or_else(|e| panic!("hash 聚合无法使用部分索引: {e}"));
        assert!(
            plan.to_lowercase().contains("idx_items_hash_live"),
            "计划应包含部分索引，实际: {plan}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
