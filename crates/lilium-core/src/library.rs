use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::json;

use crate::db::{self, meta_get, meta_set};
use crate::model::{Folder, Item, SmartFolder, Tag};
use crate::{eagle, import, jobs, query, thumbs};

pub struct Library {
    pub root: PathBuf,
    pub conn: Connection,
}

impl Library {
    // ---------- open / create / eagle ----------

    pub fn create(root: &Path, name: &str) -> Result<Library, anyhow::Error> {
        let root = root.join(format!("{name}.lilium"));
        if root.exists() {
            return Err(anyhow::anyhow!("目标已存在: {}", root.display()));
        }
        std::fs::create_dir_all(root.join("images"))?;
        std::fs::create_dir_all(root.join("thumbnails"))?;
        let conn = db::open_db(&root.join("library.db"))?;
        let lib = Library { root, conn };
        meta_set(&lib.conn, "name", name)?;
        meta_set(&lib.conn, "created_at", &crate::jobs::now_ms().to_string())?;
        Ok(lib)
    }

    pub fn open(root: &Path) -> Result<Library, anyhow::Error> {
        let root = root
            .canonicalize()
            .map_err(|_| anyhow::anyhow!("路径不存在: {}", root.display()))?;
        let conn = db::open_db(&root.join("library.db"))?;
        let lib = Library { root, conn };
        Ok(lib)
    }

    /// 打开 Eagle 库：在库目录旁边生成同名 `.lilium` 库，完整导入结构、标签、评分、注释等
    pub fn open_eagle(eagle_root: &Path) -> Result<(Library, eagle::EagleImportReport), anyhow::Error> {
        if !db::looks_like_eagle_library(eagle_root) {
            return Err(anyhow::anyhow!(
                "不是有效的 Eagle 库（缺少 metadata.json / images 目录）: {}",
                eagle_root.display()
            ));
        }
        let name = eagle::read_library_name(eagle_root)
            .unwrap_or_else(|| eagle_root.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Eagle Library".into()));
        let parent = eagle_root.parent().unwrap_or(Path::new("."));
        let target = parent.join(format!("{name}.lilium"));
        let lib = if target.exists() && target.join("library.db").is_file() {
            Library::open(&target)?
        } else {
            Library::create(parent, &name)?
        };
        let report = eagle::import_eagle_library(&lib, eagle_root)?;
        Ok((lib, report))
    }

    pub fn name(&self) -> String {
        meta_get(&self.conn, "name").unwrap_or_else(|| "Lilium".into())
    }

    pub fn info(&self) -> serde_json::Value {
        let item_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM items WHERE trash=0", [], |r| r.get(0))
            .unwrap_or(0);
        let total_size: i64 = self
            .conn
            .query_row("SELECT COALESCE(SUM(size),0) FROM items WHERE trash=0", [], |r| r.get(0))
            .unwrap_or(0);
        let tag_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))
            .unwrap_or(0);
        let folder_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM folders", [], |r| r.get(0))
            .unwrap_or(0);
        json!({
            "name": self.name(),
            "path": self.root.to_string_lossy(),
            "itemCount": item_count,
            "totalSize": total_size,
            "tagCount": tag_count,
            "folderCount": folder_count,
        })
    }

    // ---------- folders ----------

    pub fn list_folders(&self) -> Vec<Folder> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, parent_id, name, position FROM folders ORDER BY position, name")
            .unwrap();
        let rows = stmt
            .query_map([], crate::model::folder_from_row)
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn create_folder(&self, parent_id: Option<&str>, name: &str) -> Result<Folder, anyhow::Error> {
        let id = crate::jobs::new_id();
        let pos: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position),0)+1 FROM folders WHERE parent_id IS ?1",
            [parent_id],
            |r| r.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO folders(id, parent_id, name, position, created_at) VALUES(?1,?2,?3,?4,?5)",
            params![id, parent_id, name.trim(), pos, crate::jobs::now_ms()],
        )?;
        Ok(Folder { id, parent_id: parent_id.map(|s| s.to_string()), name: name.trim().to_string(), position: pos })
    }

    /// 生成 descendants（含自身）的 folder id 列表
    pub fn folder_ids_recursive(&self, folder_id: &str) -> Vec<String> {
        let all = self.list_folders();
        let mut out = vec![folder_id.to_string()];
        let mut queue = vec![folder_id.to_string()];
        while let Some(cur) = queue.pop() {
            for f in &all {
                if f.parent_id.as_deref() == Some(cur.as_str()) {
                    let id = f.id.clone();
                    queue.push(id.clone());
                    out.push(id);
                }
            }
        }
        out
    }

    pub fn rename_folder(&self, id: &str, name: &str) -> Result<(), anyhow::Error> {
        self.conn.execute("UPDATE folders SET name=?1 WHERE id=?2", params![name.trim(), id])?;
        Ok(())
    }

    pub fn move_folder(&self, id: &str, parent_id: Option<&str>) -> Result<(), anyhow::Error> {
        if Some(id) == parent_id {
            return Err(anyhow::anyhow!("不能把文件夹移动到自己内部"));
        }
        // prevent cycles
        if let Some(pid) = parent_id {
            let descs = self.folder_ids_recursive(id);
            if descs.iter().any(|d| d == pid) {
                return Err(anyhow::anyhow!("不能把文件夹移动到自己的子文件夹内"));
            }
        }
        self.conn.execute("UPDATE folders SET parent_id=?1 WHERE id=?2", params![parent_id, id])?;
        Ok(())
    }

    /// 删除文件夹：其下条目移入未分类，子文件夹上提
    pub fn delete_folder(&self, id: &str) -> Result<(), anyhow::Error> {
        let parent: Option<String> = self
            .conn
            .query_row("SELECT parent_id FROM folders WHERE id=?1", [id], |r| r.get(0))
            .ok();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE items SET folder_id=?1 WHERE folder_id=?2", params![parent, id])?;
        tx.execute("UPDATE folders SET parent_id=?1 WHERE parent_id=?2", params![parent, id])?;
        tx.execute("DELETE FROM folders WHERE id=?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    // ---------- tags ----------

    pub fn list_tags(&self) -> Vec<Tag> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.name, t.color, (SELECT COUNT(*) FROM item_tags it JOIN items i ON i.id=it.item_id
                  WHERE it.tag_id=t.name AND i.trash=0) AS cnt
                 FROM tags t ORDER BY cnt DESC, t.name",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok(Tag { name: r.get(0)?, color: r.get(1)?, count: r.get(2)? })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn create_tag(&self, name: &str, color: &str) -> Result<(), anyhow::Error> {
        self.conn.execute(
            "INSERT INTO tags(name, color, created_at) VALUES(?1,?2,?3)
             ON CONFLICT(name) DO UPDATE SET color=excluded.color",
            params![name.trim(), color, crate::jobs::now_ms()],
        )?;
        Ok(())
    }

    pub fn rename_tag(&self, old: &str, new: &str, color: Option<&str>) -> Result<(), anyhow::Error> {
        if new != old {
            self.conn.execute("UPDATE tags SET name=?1 WHERE name=?2", params![new.trim(), old])?;
            self.conn.execute("UPDATE item_tags SET tag_id=?1 WHERE tag_id=?2", params![new.trim(), old])?;
        }
        if let Some(c) = color {
            self.conn.execute("UPDATE tags SET color=?1 WHERE name=?2", params![c, new.trim()])?;
        }
        Ok(())
    }

    pub fn delete_tag(&self, name: &str) -> Result<(), anyhow::Error> {
        self.conn.execute("DELETE FROM item_tags WHERE tag_id=?1", [name])?;
        self.conn.execute("DELETE FROM tags WHERE name=?1", [name])?;
        Ok(())
    }

    // ---------- smart folders ----------

    pub fn list_smart_folders(&self) -> Vec<SmartFolder> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, query, position FROM smart_folders ORDER BY position, created_at")
            .unwrap();
        let rows = stmt
            .query_map([], |r| {
                let q: String = r.get(2)?;
                Ok(SmartFolder {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    query: serde_json::from_str(&q).unwrap_or(json!({})),
                    position: r.get(3)?,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn create_smart_folder(&self, name: &str, query: &serde_json::Value) -> Result<SmartFolder, anyhow::Error> {
        let id = crate::jobs::new_id();
        let q = serde_json::to_string(query)?;
        self.conn.execute(
            "INSERT INTO smart_folders(id,name,query,position,created_at) VALUES(?1,?2,?3,
              (SELECT COALESCE(MAX(position),0)+1 FROM smart_folders), ?4)",
            params![id, name.trim(), q, crate::jobs::now_ms()],
        )?;
        Ok(SmartFolder { id, name: name.trim().to_string(), query: query.clone(), position: 0 })
    }

    pub fn update_smart_folder(&self, id: &str, name: &str, query: &serde_json::Value) -> Result<(), anyhow::Error> {
        self.conn.execute(
            "UPDATE smart_folders SET name=?1, query=?2 WHERE id=?3",
            params![name.trim(), serde_json::to_string(query)?, id],
        )?;
        Ok(())
    }

    pub fn delete_smart_folder(&self, id: &str) -> Result<(), anyhow::Error> {
        self.conn.execute("DELETE FROM smart_folders WHERE id=?1", [id])?;
        Ok(())
    }

    // ---------- items ----------

    pub fn get_item(&self, id: &str) -> Option<Item> {
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {} FROM items WHERE id=?1", query::ITEM_COLS))
            .ok()?;
        stmt.query_row([id], crate::model::item_from_row).ok()
    }

    pub fn attach_tags(&self, items: &mut [Item]) {
        if items.is_empty() {
            return;
        }
        let ids: Vec<String> = items.iter().map(|i| i.id.clone()).collect();
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT it.item_id, t.name FROM item_tags it JOIN tags t ON t.name=it.tag_id WHERE it.item_id IN ({placeholders})"
        );
        let mut stmt = match self.conn.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return,
        };
        let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        });
        if let Ok(rows) = rows {
            let mut map: std::collections::HashMap<String, Vec<String>> = Default::default();
            for row in rows.filter_map(|r| r.ok()) {
                map.entry(row.0).or_default().push(row.1);
            }
            for it in items.iter_mut() {
                if let Some(tags) = map.get(&it.id) {
                    it.tags = tags.clone();
                }
            }
        }
    }

    pub fn query_items(&self, q: &query::Query) -> (Vec<Item>, i64) {
        let (sql, count_sql, args) = query::build(q);
        let total: i64 = self
            .conn
            .query_row(&count_sql, rusqlite::params_from_iter(&args), |r| r.get(0))
            .unwrap_or(0);
        let mut stmt = match self.conn.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return (vec![], total),
        };
        let rows = stmt.query_map(rusqlite::params_from_iter(&args), crate::model::item_from_row);
        let mut items: Vec<Item> = rows.map(|rs| rs.filter_map(|r| r.ok()).collect()).unwrap_or_default();
        self.attach_tags(&mut items);
        (items, total)
    }

    pub fn update_item(&self, id: &str, patch: &import::ItemPatch) -> Result<Item, anyhow::Error> {
        let mut sets: Vec<String> = vec![];
        let mut args: Vec<query::Arg> = vec![];
        if let Some(v) = &patch.name { sets.push("name=?".into()); args.push(query::Arg::S(v.clone())); }
        if let Some(v) = patch.rating { sets.push("rating=?".into()); args.push(query::Arg::I(v)); }
        if let Some(v) = &patch.note { sets.push("note=?".into()); args.push(query::Arg::S(v.clone())); }
        if let Some(v) = &patch.url { sets.push("url=?".into()); args.push(query::Arg::S(v.clone())); }
        if let Some(v) = &patch.folder_id { sets.push("folder_id=?".into()); args.push(query::Arg::S(v.clone())); }
        if !sets.is_empty() {
            let sql = format!("UPDATE items SET {} WHERE id=?", sets.join(","));
            args.push(query::Arg::S(id.to_string()));
            self.conn.execute(&sql, rusqlite::params_from_iter(&args))?;
        }
        self.get_item(id).ok_or_else(|| anyhow::anyhow!("条目不存在"))
    }

    pub fn trash_item(&self, id: &str) -> Result<(), anyhow::Error> {
        self.conn.execute("UPDATE items SET trash=1 WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn restore_item(&self, id: &str) -> Result<(), anyhow::Error> {
        self.conn.execute("UPDATE items SET trash=0 WHERE id=?1", [id])?;
        Ok(())
    }

    /// 彻底删除：同时删除磁盘文件与缩略图
    pub fn purge_item(&self, id: &str) -> Result<(), anyhow::Error> {
        if let Some(item) = self.get_item(id) {
            let sub = self.root.join("images").join(&item.id[0..2.min(item.id.len())]);
            let file = sub.join(format!("{}.{}", item.id, item.ext));
            if file.exists() {
                std::fs::remove_file(&file).ok();
            }
            let tdir = self.root.join("thumbnails").join(&item.id[0..2.min(item.id.len())]);
            if let Ok(entries) = std::fs::read_dir(&tdir) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.file_stem().map(|s| s.to_string_lossy().starts_with(&item.id)).unwrap_or(false) {
                        std::fs::remove_file(&p).ok();
                    }
                }
            }
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM item_tags WHERE item_id=?1", [id])?;
        tx.execute("DELETE FROM items WHERE id=?1", [id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn item_file_path(&self, id: &str) -> Option<PathBuf> {
        let ext: String = self
            .conn
            .query_row("SELECT ext FROM items WHERE id=?1", [id], |r| r.get::<_, String>(0))
            .ok()?;
        let sub = self.root.join("images").join(&id[0..2.min(id.len())]);
        Some(sub.join(format!("{id}.{ext}")))
    }

    pub fn item_thumb_path(&self, id: &str) -> Option<PathBuf> {
        let (ext, thumb): (String, i32) = self
            .conn
            .query_row("SELECT ext, thumb FROM items WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()?;
        let tdir = self.root.join("thumbnails").join(&id[0..2.min(id.len())]);
        match thumb {
            1 => {
                for e in ["png", "jpg", "svg"] {
                    let p = tdir.join(format!("{id}.{e}"));
                    if p.is_file() {
                        return Some(p);
                    }
                }
                None
            }
            2 => None,
            _ => {
                // svg: 原样作为缩略图
                if ext == "svg" {
                    Some(self.item_file_path(id)?)
                } else {
                    None
                }
            }
        }
    }

    /// 确保缩略图存在（同步生成），返回路径
    pub fn ensure_thumbnail(&self, id: &str) -> Result<PathBuf, anyhow::Error> {
        if let Some(p) = self.item_thumb_path(id) {
            return Ok(p);
        }
        let file = self.item_file_path(id).ok_or_else(|| anyhow::anyhow!("条目不存在"))?;
        let out_dir = self.root.join("thumbnails").join(&id[0..2.min(id.len())]);
        let path = thumbs::generate_thumbnail(&file, id, &out_dir)?;
        self.conn.execute("UPDATE items SET thumb=1 WHERE id=?1", [id])?;
        Ok(path)
    }

    // ---------- batch ----------

    pub fn batch_tag(&self, ids: &[String], tag: &str, remove: bool) -> Result<(), anyhow::Error> {
        if !remove {
            self.create_tag(tag, "#8b5cf6")?;
        }
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            if remove {
                tx.execute("DELETE FROM item_tags WHERE item_id=?1 AND tag_id=?2", params![id, tag])?;
            } else {
                tx.execute(
                    "INSERT OR IGNORE INTO item_tags(item_id, tag_id) VALUES(?1,?2)",
                    params![id, tag],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn batch_rating(&self, ids: &[String], rating: i64) -> Result<(), anyhow::Error> {
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            tx.execute("UPDATE items SET rating=?1 WHERE id=?2", params![rating, id])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn batch_move(&self, ids: &[String], folder_id: Option<&str>) -> Result<(), anyhow::Error> {
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            tx.execute("UPDATE items SET folder_id=?1 WHERE id=?2", params![folder_id, id])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn batch_trash(&self, ids: &[String]) -> Result<usize, anyhow::Error> {
        let tx = self.conn.unchecked_transaction()?;
        let mut n = 0;
        for id in ids {
            n += tx.execute("UPDATE items SET trash=1 WHERE id=?1", [id])?;
        }
        tx.commit()?;
        Ok(n)
    }

    pub fn batch_restore(&self, ids: &[String]) -> Result<usize, anyhow::Error> {
        let tx = self.conn.unchecked_transaction()?;
        let mut n = 0;
        for id in ids {
            n += tx.execute("UPDATE items SET trash=0 WHERE id=?1", [id])?;
        }
        tx.commit()?;
        Ok(n)
    }

    pub fn batch_purge(&self, ids: &[String]) -> Result<usize, anyhow::Error> {
        let mut n = 0;
        for id in ids {
            if self.purge_item(id).is_ok() {
                n += 1;
            }
        }
        Ok(n)
    }

    /// 批量重命名，支持 {name} {index} {ext} {date} {w} {h}
    pub fn batch_rename(&self, ids: &[String], pattern: &str) -> Result<Vec<(String, String)>, anyhow::Error> {
        let tx = self.conn.unchecked_transaction()?;
        let mut out = vec![];
        for (i, id) in ids.iter().enumerate() {
            if let Some(item) = self.get_item(id) {
                let stem = std::path::Path::new(&item.name)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(item.name.clone());
                let date = chrono_fmt(item.added_at);
                let new_name = pattern
                    .replace("{name}", &stem)
                    .replace("{index}", &format!("{:03}", i + 1))
                    .replace("{ext}", &item.ext)
                    .replace("{date}", &date)
                    .replace("{w}", &item.width.unwrap_or(0).to_string())
                    .replace("{h}", &item.height.unwrap_or(0).to_string());
                tx.execute("UPDATE items SET name=?1 WHERE id=?2", params![new_name, id])?;
                out.push((id.clone(), new_name));
            }
        }
        tx.commit()?;
        Ok(out)
    }

    // ---------- duplicates / stats ----------

    pub fn find_duplicates(&self) -> Vec<(String, Vec<Item>)> {
        // 1) 完全相同 hash
        let mut groups: Vec<(String, Vec<Item>)> = vec![];
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {} FROM items WHERE trash=0 AND hash IS NOT NULL ORDER BY hash, size",
                query::ITEM_COLS
            ))
            .unwrap();
        let items: Vec<Item> = stmt
            .query_map([], crate::model::item_from_row)
            .map(|rs| rs.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        let mut by_hash: std::collections::HashMap<String, Vec<Item>> = Default::default();
        for it in items {
            if let Some(h) = &it.hash {
                by_hash.entry(h.clone()).or_default().push(it.clone());
            }
        }
        for (h, mut group) in by_hash {
            if group.len() > 1 {
                self.attach_tags(&mut group);
                groups.push((format!("相同内容 {h}"), group));
            }
        }
        groups
    }

    pub fn similar_to(&self, id: &str) -> Vec<Item> {
        let Some(me) = self.get_item(id) else { return vec![] };
        let Some(ph) = &me.phash else { return vec![] };
        let target = u64::from_str_radix(ph, 16).unwrap_or(0);
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {} FROM items WHERE trash=0 AND phash IS NOT NULL AND id != ?1",
                query::ITEM_COLS
            ))
            .unwrap();
        let cands: Vec<Item> = stmt
            .query_map([id], crate::model::item_from_row)
            .map(|rs| rs.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        let mut out: Vec<(u32, Item)> = cands
            .into_iter()
            .filter_map(|it| {
                let v = it.phash.as_ref()?;
                let u = u64::from_str_radix(v, 16).ok()?;
                let d = (u ^ target).count_ones();
                if d <= 10 {
                    Some((d, it))
                } else {
                    None
                }
            })
            .collect();
        out.sort_by_key(|(d, _)| *d);
        let mut items: Vec<Item> = out.into_iter().map(|(_, it)| it).collect();
        self.attach_tags(&mut items);
        items
    }

    pub fn suggest(&self, q: &str, limit: usize) -> Vec<serde_json::Value> {
        let like = format!("%{}%", q.to_lowercase());
        let mut out = vec![];
        let mut stmt = self
            .conn
            .prepare("SELECT name FROM tags WHERE name LIKE ?1 ORDER BY name LIMIT ?2")
            .unwrap();
        for r in stmt.query_map(params![like, limit as i64], |r| r.get::<_, String>(0)).unwrap() {
            out.push(json!({"type": "tag", "value": r.unwrap_or_default()}));
        }
        let mut stmt = self
            .conn
            .prepare("SELECT id, name FROM items WHERE trash=0 AND lower(name) LIKE ?1 ORDER BY added_at DESC LIMIT ?2")
            .unwrap();
        for r in stmt
            .query_map(params![like, limit as i64], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .unwrap()
        {
            if let Ok((id, name)) = r {
                out.push(json!({"type": "item", "value": name, "id": id}));
            }
        }
        out
    }

    pub fn reveal(&self, id: &str) -> Result<(), anyhow::Error> {
        let p = self.item_file_path(id).ok_or_else(|| anyhow::anyhow!("条目不存在"))?;
        let dir = p.parent().unwrap_or(Path::new("."));
        open::that(dir)?;
        Ok(())
    }

    // ---------- settings / watch ----------

    pub fn settings_get_all(&self) -> serde_json::Value {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings").unwrap();
        let mut map = serde_json::Map::new();
        for r in stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
        {
            if let Ok((k, v)) = r {
                map.insert(k, serde_json::from_str(&v).unwrap_or(json!(v)));
            }
        }
        json!({
            "watchFolders": map.get("watchFolders").cloned().unwrap_or(json!([])),
            "autoImport": map.get("autoImport").cloned().unwrap_or(json!(true)),
        })
    }

    pub fn settings_set(&self, key: &str, value: &serde_json::Value) -> Result<(), anyhow::Error> {
        self.conn.execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            params![key, serde_json::to_string(value)?],
        )?;
        Ok(())
    }

    /// 扫描观察文件夹并导入新文件；返回导入数量
    pub fn scan_watch_folders(&self, queue: &jobs::JobQueue) -> Result<usize, anyhow::Error> {
        let folders = self.settings_get_all().get("watchFolders").cloned().unwrap_or(json!([]));
        let mut paths = vec![];
        if let Some(arr) = folders.as_array() {
            for f in arr {
                if let Some(s) = f.as_str() {
                    paths.push(PathBuf::from(s));
                }
            }
        }
        let opts = import::ImportOptions { watch: true, ..Default::default() };
        let mut n = 0;
        for p in paths {
            n += import::import_paths_sync(self, &p, None, &opts, queue)?;
        }
        Ok(n)
    }
}

fn chrono_fmt(ms: i64) -> String {
    // yyyyMMdd（无需外部 chrono 依赖，简单实现日期换算）
    let secs = ms / 1000;
    let days = secs / 86400;
    let (y, m, d) = civil_from_days(days);
    format!("{y}{m:02}{d:02}")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
