use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::json;

use crate::db::{self, meta_get, meta_set};
use crate::model::{Folder, Item, SmartFolder, Tag};
use crate::{eagle, import, jobs, query, thumbs};

/// Eagle 库对应的伴生 .lilium 库路径（同级目录）
pub fn eagle_companion_path(eagle_root: &Path) -> PathBuf {
    let name = eagle_root
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Lilium".into());
    eagle_root
        .parent()
        .unwrap_or(Path::new("."))
        .join(format!("{name}.lilium"))
}

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

    /// 打开或创建（库切换面板主入口）：自动识别 Eagle 库 → 导入伴生库；
    /// 原生库不存在时自动创建；成功后写入最近库注册表
    pub fn open_or_create(path: &Path) -> Result<(Library, bool), anyhow::Error> {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let (lib, eagle_imported) = if db::looks_like_eagle_library(&canonical) {
            // Eagle 库 → 旁边找同名 .lilium 伴生库,无则导入生成
            let companion = eagle_companion_path(&canonical);
            if companion.join("library.db").is_file() {
                (Library::open(&companion)?, false)
            } else {
                let (l, _report) = Library::open_eagle(&canonical)?;
                (l, true)
            }
        } else if canonical.join("library.db").is_file() {
            (Library::open(&canonical)?, false)
        } else {
            // 目录不存在库 → 创建 xxx.lilium（目录名带 .lilium 后缀时直接用）
            let (parent, name) = if canonical
                .extension()
                .map(|e| e == "lilium")
                .unwrap_or(false)
            {
                if canonical.is_dir() {
                    // 空目录先移除（create 要求目标不存在），非空目录走下方保护逻辑
                    let is_empty = std::fs::read_dir(&canonical).map(|mut d| d.next().is_none()).unwrap_or(false);
                    if is_empty {
                        std::fs::remove_dir(&canonical).ok();
                    }
                }
                if canonical.is_dir() && std::fs::read_dir(&canonical).map(|mut d| d.next().is_some()).unwrap_or(false) {
                    // 目录已存在且非空：不覆盖（防止误删数据）。
                    // 含 images/ 或 thumbnails/ → 视为损坏的库目录，补齐缺失结构后打开
                    if canonical.join("images").is_dir() || canonical.join("thumbnails").is_dir() {
                        std::fs::create_dir_all(canonical.join("images"))?;
                        std::fs::create_dir_all(canonical.join("thumbnails"))?;
                        let conn = db::open_db(&canonical.join("library.db"))?;
                        let lib = Library { root: canonical.clone(), conn };
                        let _ = crate::recent::touch(&lib.root, &lib.name(), "lilium");
                        return Ok((lib, false));
                    }
                    return Err(anyhow::anyhow!(
                        "目录非空且不是有效的库: {}",
                        canonical.display()
                    ));
                }
                (
                    canonical.parent().unwrap_or(Path::new(".")).to_path_buf(),
                    canonical
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Lilium".into()),
                )
            } else {
                (canonical.clone(), canonical
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Lilium".into()))
            };
            (Library::create(&parent, &name)?, false)
        };
        let kind = if eagle_imported || db::looks_like_eagle_library(&canonical) { "eagle" } else { "lilium" };
        let _ = crate::recent::touch(&lib.root, &lib.name(), kind);
        Ok((lib, eagle_imported))
    }

    /// 清除缩略图缓存并重载库（库面板「清除缓存并重新加载」）
    pub fn clear_cache(&mut self) -> Result<u64, anyhow::Error> {
        let thumb_dir = self.root.join("thumbnails");
        let mut removed: u64 = 0;
        fn dir_size(p: &Path) -> u64 {
            let mut n = 0;
            if let Ok(rd) = std::fs::read_dir(p) {
                for e in rd.flatten() {
                    if e.path().is_dir() {
                        n += dir_size(&e.path());
                    } else if let Ok(m) = e.metadata() {
                        n += m.len();
                    }
                }
            }
            n
        }
        if thumb_dir.exists() {
            removed = dir_size(&thumb_dir);
            std::fs::remove_dir_all(&thumb_dir)?;
            std::fs::create_dir_all(&thumb_dir)?;
        }
        // 全部条目标记无缩略图,任务队列会重新生成
        self.conn.execute("UPDATE items SET thumb=0", [])?;
        Ok(removed)
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

    /// 库统计仪表盘数据:数量/大小分布、类型分布、评分分布、月度新增、标签 Top、颜色分布
    pub fn stats(&self) -> serde_json::Value {
        let one = |sql: &str| -> i64 { self.conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };

        // 类型分布
        let mut kind_stmt = self
            .conn
            .prepare("SELECT kind, COUNT(*), COALESCE(SUM(size),0) FROM items WHERE trash=0 GROUP BY kind ORDER BY 2 DESC")
            .unwrap();
        let kinds: Vec<serde_json::Value> = kind_stmt
            .query_map([], |r| {
                Ok(json!({ "kind": r.get::<_, String>(0)?, "count": r.get::<_, i64>(1)?, "size": r.get::<_, i64>(2)? }))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        drop(kind_stmt);

        // 评分分布 0-5
        let mut rating_stmt = self.conn.prepare("SELECT rating, COUNT(*) FROM items WHERE trash=0 GROUP BY rating").unwrap();
        let mut rating_map: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
        for row in rating_stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))).unwrap().filter_map(Result::ok) {
            rating_map.insert(row.0, row.1);
        }
        drop(rating_stmt);
        let ratings: Vec<serde_json::Value> = (0..=5)
            .map(|star| json!({ "rating": star, "count": rating_map.get(&star).copied().unwrap_or(0) }))
            .collect();

        // 近 12 个月每月新增
        let mut month_stmt = self
            .conn
            .prepare("SELECT strftime('%Y-%m', added_at/1000, 'unixepoch') m, COUNT(*) FROM items WHERE trash=0 AND added_at>0 GROUP BY m ORDER BY m DESC LIMIT 12")
            .unwrap();
        let mut months: Vec<serde_json::Value> = month_stmt
            .query_map([], |r| Ok(json!({ "month": r.get::<_, String>(0)?, "count": r.get::<_, i64>(1)? })))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        drop(month_stmt);
        months.reverse();

        // 标签 Top 10
        let mut tag_stmt = self
            .conn
            .prepare(
                "SELECT t.name, t.color, COUNT(it.item_id) n FROM tags t
                 JOIN item_tags it ON it.tag_id = t.name
                 JOIN items i ON i.id = it.item_id AND i.trash=0
                 GROUP BY t.name ORDER BY n DESC LIMIT 10",
            )
            .unwrap();
        let top_tags: Vec<serde_json::Value> = tag_stmt
            .query_map([], |r| {
                Ok(json!({ "name": r.get::<_, String>(0)?, "color": r.get::<_, String>(1)?, "count": r.get::<_, i64>(2)? }))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        drop(tag_stmt);

        // 颜色分布(主色量化到 8 色系:红/橙/黄/绿/青/蓝/紫/灰)
        let mut color_stmt = self
            .conn
            .prepare("SELECT r, g, b, COUNT(*) FROM items WHERE trash=0 AND r IS NOT NULL GROUP BY r/64, g/64, b/64 ORDER BY 4 DESC LIMIT 8")
            .unwrap();
        let colors: Vec<serde_json::Value> = color_stmt
            .query_map([], |r| {
                let rr: i64 = r.get(0)?;
                let gg: i64 = r.get(1)?;
                let bb: i64 = r.get(2)?;
                let n: i64 = r.get(3)?;
                Ok(json!({ "r": rr, "g": gg, "b": bb, "count": n }))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        drop(color_stmt);

        // 最大单文件 Top 5
        let mut big_stmt = self
            .conn
            .prepare("SELECT id, name, size FROM items WHERE trash=0 ORDER BY size DESC LIMIT 5")
            .unwrap();
        let largest: Vec<serde_json::Value> = big_stmt
            .query_map([], |r| {
                Ok(json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?, "size": r.get::<_, i64>(2)? }))
            })
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        drop(big_stmt);

        json!({
            "itemCount": one("SELECT COUNT(*) FROM items WHERE trash=0"),
            "totalSize": one("SELECT COALESCE(SUM(size),0) FROM items WHERE trash=0"),
            "trashCount": one("SELECT COUNT(*) FROM items WHERE trash=1"),
            "tagCount": one("SELECT COUNT(*) FROM tags"),
            "folderCount": one("SELECT COUNT(*) FROM folders"),
            "smartFolderCount": one("SELECT COUNT(*) FROM smart_folders"),
            "withRating": one("SELECT COUNT(*) FROM items WHERE trash=0 AND rating>0"),
            "withTags": one("SELECT COUNT(*) FROM items WHERE trash=0 AND EXISTS(SELECT 1 FROM item_tags WHERE item_id=items.id)"),
            "kinds": kinds,
            "ratings": ratings,
            "months": months,
            "topTags": top_tags,
            "colors": colors,
            "largest": largest,
        })
    }

    pub fn info(&self) -> serde_json::Value {        let item_count: i64 = self
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
            .prepare(
                "SELECT f.id, f.parent_id, f.name, f.position,
                        (SELECT i.id FROM items i WHERE i.folder_id = f.id AND i.trash = 0
                          ORDER BY i.added_at DESC LIMIT 1) AS cover_item_id,
                        (SELECT COUNT(*) FROM items i WHERE i.folder_id = f.id AND i.trash = 0) AS item_count
                 FROM folders f ORDER BY f.position, f.name",
            )
            .unwrap();
        let rows = stmt
            .query_map([], crate::model::folder_from_row)
            .unwrap();
        rows.filter_map(|r| r.ok()).collect()
    }

    pub fn create_folder(&self, parent_id: Option<&str>, name: &str) -> Result<Folder, anyhow::Error> {
        if name.trim().is_empty() {
            return Err(anyhow::anyhow!("文件夹名不能为空"));
        }
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
        Ok(Folder { id, parent_id: parent_id.map(|s| s.to_string()), name: name.trim().to_string(), position: pos, cover_item_id: None, item_count: 0 })
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
        if name.trim().is_empty() {
            return Err(anyhow::anyhow!("文件夹名不能为空"));
        }
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
        let name = name.trim();
        if name.is_empty() {
            return Err(anyhow::anyhow!("标签名不能为空"));
        }
        self.conn.execute(
            "INSERT INTO tags(name, color, created_at) VALUES(?1,?2,?3)
             ON CONFLICT(name) DO UPDATE SET color=excluded.color",
            params![name, color, crate::jobs::now_ms()],
        )?;
        Ok(())
    }

    pub fn rename_tag(&self, old: &str, new: &str, color: Option<&str>) -> Result<(), anyhow::Error> {
        if new.trim().is_empty() {
            return Err(anyhow::anyhow!("标签名不能为空"));
        }
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
        if name.trim().is_empty() {
            return Err(anyhow::anyhow!("智能文件夹名不能为空"));
        }
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
        if name.trim().is_empty() {
            return Err(anyhow::anyhow!("智能文件夹名不能为空"));
        }
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
        if let Some(v) = &patch.name {
            let name = v.trim();
            if name.is_empty() {
                return Err(anyhow::anyhow!("名称不能为空"));
            }
            sets.push("name=?".into());
            args.push(query::Arg::S(name.to_string()));
        }
        if let Some(v) = patch.rating {
            sets.push("rating=?".into());
            args.push(query::Arg::I(v.clamp(0, 5)));
        }
        if let Some(v) = &patch.note { sets.push("note=?".into()); args.push(query::Arg::S(v.clone())); }
        if let Some(v) = &patch.url { sets.push("url=?".into()); args.push(query::Arg::S(v.clone())); }
        if let Some(v) = &patch.folder_id {
            // 目标文件夹必须存在，避免悬空引用
            let exists: i64 = self
                .conn
                .query_row("SELECT COUNT(*) FROM folders WHERE id=?1", [v], |r| r.get(0))
                .unwrap_or(0);
            if exists == 0 {
                return Err(anyhow::anyhow!("目标文件夹不存在: {v}"));
            }
            sets.push("folder_id=?".into());
            args.push(query::Arg::S(v.clone()));
        }
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
        let rating = rating.clamp(0, 5);
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            tx.execute("UPDATE items SET rating=?1 WHERE id=?2", params![rating, id])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn batch_move(&self, ids: &[String], folder_id: Option<&str>) -> Result<(), anyhow::Error> {
        // 目标文件夹必须存在（None 表示移到未分类）
        if let Some(fid) = folder_id {
            let exists: i64 = self
                .conn
                .query_row("SELECT COUNT(*) FROM folders WHERE id=?1", [fid], |r| r.get(0))
                .unwrap_or(0);
            if exists == 0 {
                return Err(anyhow::anyhow!("目标文件夹不存在: {fid}"));
            }
        }
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
            // 只统计真实删除（条目存在且事务提交成功），避免把不存在的 id 也计入 affected
            if self.get_item(id).is_some() && self.purge_item(id).is_ok() {
                n += 1;
            }
        }
        Ok(n)
    }

    /// 批量重命名，支持 {name} {index} {ext} {date} {w} {h}
    ///
    /// 模式不含 {index}（或多文件展开同名）时可能碰撞：自动追加 ` (2)`、` (3)` …
    /// 直到唯一。判定范围 = 库内已有名称 ∪ 本批次已用名称。
    pub fn batch_rename(&self, ids: &[String], pattern: &str) -> Result<Vec<(String, String)>, anyhow::Error> {
        // 与单条 update_item 的空名校验对齐：空白模式会把条目名批量清空
        if pattern.trim().is_empty() {
            return Err(anyhow::anyhow!("重命名模式不能为空"));
        }
        let tx = self.conn.unchecked_transaction()?;
        let mut out = vec![];
        let mut taken: std::collections::HashSet<String> = {
            let mut stmt = self.conn.prepare("SELECT name FROM items")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for (i, id) in ids.iter().enumerate() {
            if let Some(item) = self.get_item(id) {
                let stem = std::path::Path::new(&item.name)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(item.name.clone());
                let date = chrono_fmt(item.added_at);
                let candidate = pattern
                    .replace("{name}", &stem)
                    .replace("{index}", &format!("{:03}", i + 1))
                    .replace("{ext}", &item.ext)
                    .replace("{date}", &date)
                    .replace("{w}", &item.width.unwrap_or(0).to_string())
                    .replace("{h}", &item.height.unwrap_or(0).to_string());
                let new_name = dedupe_name(&candidate, &mut taken);
                tx.execute("UPDATE items SET name=?1 WHERE id=?2", params![new_name, id])?;
                out.push((id.clone(), new_name));
            }
        }
        tx.commit()?;
        Ok(out)
    }

    // ---------- duplicates / stats ----------

    pub fn find_duplicates(&self) -> Vec<(String, Vec<Item>)> {
        let mut groups: Vec<(String, Vec<Item>)> = vec![];

        // 1) 完全相同 hash：先用 SQL 聚合找出重复的 hash，再按 hash 取条目
        //    （避免把全库条目连调色板 JSON 一起载入内存再建 HashMap）
        let dup_hashes: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT hash FROM items WHERE trash=0 AND hash IS NOT NULL GROUP BY hash HAVING COUNT(*)>1")
                .unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0))
                .map(|rs| rs.filter_map(|r| r.ok()).collect())
                .unwrap_or_default()
        };
        for h in dup_hashes {
            let mut group: Vec<Item> = {
                let mut stmt = self
                    .conn
                    .prepare(&format!(
                        "SELECT {} FROM items WHERE trash=0 AND hash=?1 ORDER BY size, id",
                        query::ITEM_COLS
                    ))
                    .unwrap();
                stmt.query_map([&h], crate::model::item_from_row)
                    .map(|rs| rs.filter_map(|r| r.ok()).collect::<Vec<_>>())
                    .unwrap_or_default()
            };
            if group.len() > 1 {
                self.attach_tags(&mut group);
                groups.push((format!("相同内容 {h}"), group));
            }
        }

        // 2) 相似感知哈希（dHash 汉明距离 ≤ 6），跳过已按内容归组的条目。
        //    带状索引（LSH）：64bit 分 8 段 × 8bit，距离 ≤ 7 的图片对必然共享
        //    至少一段完全相同 → 候选对只在共享段的桶内产生并做汉明校验，
        //    大库从 O(n²) 全对比较降到近似线性；组内用并查集合并。
        //
        //    【阈值说明】分组用 ≤ 6 而全库相似搜索 similar_to 用 ≤ 10：
        //    分组是自动批量聚合，阈值过松会把「同一场景连拍」以外的大量弱相关图
        //    吸进同一组，组会越滚越大（并查集传递合并），结果难读；≤ 6 只聚
        //    「肉眼几乎相同」的图，宁可漏不可滥。similar_to 是用户对单张图主动
        //    发起检索，召回优先，≤ 10 覆盖同构图 / 裁剪 / 轻度调色的近邻，
        //    由用户自己判断结果相关性。两者语义不同，阈值不应统一。
        let grouped: std::collections::HashSet<String> = groups
            .iter()
            .flat_map(|(_, g)| g.iter().map(|i| i.id.clone()))
            .collect();
        let phashed: Vec<(u64, Item)> = {
            let mut stmt = self
                .conn
                .prepare(&format!(
                    "SELECT {} FROM items WHERE trash=0 AND phash IS NOT NULL",
                    query::ITEM_COLS
                ))
                .unwrap();
            stmt.query_map([], crate::model::item_from_row)
                .map(|rs| rs.filter_map(|r| r.ok()).collect::<Vec<Item>>())
                .unwrap_or_default()
        }
        .into_iter()
        .filter(|it| !grouped.contains(&it.id))
        .filter_map(|it| {
            let v = it.phash.as_ref()?;
            u64::from_str_radix(v, 16).ok().map(|u| (u, it))
        })
        .collect();

        fn find(parent: &mut Vec<usize>, mut x: usize) -> usize {
            while parent[x] != x {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            x
        }

        let n = phashed.len();
        let mut parent: Vec<usize> = (0..n).collect();
        let mut bands: std::collections::HashMap<(usize, u16), Vec<usize>> = Default::default();
        for (i, (u, _)) in phashed.iter().enumerate() {
            for b in 0..8usize {
                bands.entry((b, ((u >> (b * 8)) & 0xFF) as u16)).or_default().push(i);
            }
        }
        for bucket in bands.into_values() {
            if bucket.len() < 2 {
                continue;
            }
            for a in 0..bucket.len() {
                for b in (a + 1)..bucket.len() {
                    let (ia, ib) = (bucket[a], bucket[b]);
                    if (phashed[ia].0 ^ phashed[ib].0).count_ones() <= 6 {
                        let ra = find(&mut parent, ia);
                        let rb = find(&mut parent, ib);
                        if ra != rb {
                            parent[rb] = ra;
                        }
                    }
                }
            }
        }

        let mut clusters: Vec<Vec<usize>> = Vec::with_capacity(n / 2 + 1);
        let mut by_root: std::collections::HashMap<usize, Vec<usize>> = Default::default();
        for i in 0..n {
            let r = find(&mut parent, i);
            by_root.entry(r).or_default().push(i);
        }
        for mut c in by_root.into_values() {
            if c.len() < 2 {
                continue;
            }
            c.sort();
            clusters.push(c);
        }
        // 按最小下标排序，保证分组顺序稳定（与旧实现的种子顺序一致）
        clusters.sort_by_key(|c| c[0]);
        for cluster in clusters {
            let mut group: Vec<Item> = cluster.into_iter().map(|i| phashed[i].1.clone()).collect();
            self.attach_tags(&mut group);
            groups.push(("相似图片 (dHash)".into(), group));
        }
        groups
    }

    pub fn similar_to(&self, id: &str) -> Vec<Item> {
        let Some(me) = self.get_item(id) else { return vec![] };
        let Some(ph) = &me.phash else { return vec![] };
        let target = u64::from_str_radix(ph, 16).unwrap_or(0);
        // 阈值 ≤ 10：主动检索、召回优先（与 find_duplicates 自动分组的 ≤ 6
        // 语义不同，详见 find_duplicates 内的【阈值说明】）。
        // 带状索引剪枝（鸽笼原理）：64bit 分 8 段，若总距离 ≤ 10，则必有
        // 至少一段的距离 ≤ ⌊10/8⌋ = 1，即该段字节等于目标字节或与其差 1 个 bit。
        // 每段枚举 9 个合法字节（原值 + 8 个单 bit 翻转），SQL 先筛出超集，
        // 再在 Rust 里做精确汉明校验，避免全表载入。
        let byte_hex = |v: u8| format!("{v:02x}");
        let mut cond = String::new();
        for b in 0..8usize {
            let t = ((target >> (b * 8)) & 0xFF) as u8;
            // phash 是 16 位 hex（高位在前），第 b 段（从低位数）对应 substr 起点 15-2b
            let pos = 15 - 2 * b;
            if b > 0 {
                cond.push_str(" OR ");
            }
            let variants: Vec<String> = (0..8u32)
                .map(|i| byte_hex(t ^ (1 << i)))
                .chain(std::iter::once(byte_hex(t)))
                .map(|h| format!("'{h}'"))
                .collect();
            cond.push_str(&format!("substr(phash, {pos}, 2) IN ({})", variants.join(",")));
        }
        let sql = format!(
            "SELECT {} FROM items WHERE trash=0 AND phash IS NOT NULL AND id != ?1 AND ({cond})",
            query::ITEM_COLS
        );
        let mut stmt = self.conn.prepare(&sql).unwrap();
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

    /// 扫描观察文件夹并导入新文件；返回导入数量。
    /// `autoImport=false` 时跳过（返回 0），定时任务与手动扫描共用本入口。
    pub fn scan_watch_folders(&self, queue: &jobs::JobQueue) -> Result<usize, anyhow::Error> {
        let settings = self.settings_get_all();
        if settings.get("autoImport").and_then(|v| v.as_bool()) == Some(false) {
            return Ok(0);
        }
        let folders = settings.get("watchFolders").cloned().unwrap_or(json!([]));
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

/// 重命名去重：`candidate` 与 `taken` 中已有名称冲突时，追加 ` (2)`、` (3)` …
/// 直到唯一；确定的结果写回 `taken`，保证同批次内后续条目也能看到。
fn dedupe_name(candidate: &str, taken: &mut std::collections::HashSet<String>) -> String {
    if taken.insert(candidate.to_string()) {
        return candidate.to_string();
    }
    let (stem, dot_ext) = match candidate.rsplit_once('.') {
        // 点后无字符或超长视为名字一部分（与 file_stem 的保守处理一致）
        Some((s, e)) if !e.is_empty() && e.len() <= 8 && !e.contains(' ') => (s, Some(e)),
        _ => (candidate, None),
    };
    for n in 2.. {
        let name = match dot_ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{candidate} ({n})"),
        };
        if taken.insert(name.clone()) {
            return name;
        }
    }
    unreachable!()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::JobQueue;

    /// 每个测试独立的临时库（进程内唯一目录，测试结束后由调用方清理）
    fn temp_lib(tag: &str) -> (Library, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "lilium-test-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let lib = Library::create(&dir, tag).unwrap();
        (lib, dir)
    }

    /// 生成一张简单的测试 PNG
    fn test_png(dir: &Path, name: &str, w: u32, h: u32, color: [u8; 3]) -> std::path::PathBuf {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([color[0], color[1], color[2], 255]));
        let p = dir.join(name);
        img.save_with_format(&p, image::ImageFormat::Png).unwrap();
        p
    }

    #[test]
    fn create_open_and_meta() {
        let (lib, dir) = temp_lib("meta");
        assert_eq!(lib.name(), "meta");
        assert!(lib.root.join("library.db").is_file());
        // 重复创建报错
        let parent = lib.root.parent().unwrap().to_path_buf();
        assert!(Library::create(&parent, "meta").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_or_create_rejects_nonempty_dir() {
        let base = std::env::temp_dir().join(format!("lilium-test-guard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let target = base.join("guard.lilium");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("notes.txt"), "user data").unwrap();
        // 非空且不是有效库结构的 .lilium 目录必须报错，而不是清空重建
        assert!(Library::open_or_create(&target).is_err());
        assert!(target.join("notes.txt").is_file());
        // 空目录 → 正常创建
        let empty = base.join("empty.lilium");
        std::fs::create_dir_all(&empty).unwrap();
        assert!(Library::open_or_create(&empty).is_ok());
        // 已有 library.db 的目录 → 正常打开（不再要求 images/thumbnails 存在）
        assert!(Library::open_or_create(&empty).is_ok());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn folder_crud_and_cycle_guard() {
        let (lib, dir) = temp_lib("folders");
        let f1 = lib.create_folder(None, "A").unwrap();
        let f2 = lib.create_folder(Some(&f1.id), "B").unwrap();
        let mut names: Vec<String> = lib.list_folders().iter().map(|f| f.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["A".to_string(), "B".to_string()]);
        // 禁止把父级移动到子级（成环）
        assert!(lib.move_folder(&f1.id, Some(&f2.id)).is_err());
        // 重命名
        lib.rename_folder(&f1.id, "A2").unwrap();
        assert_eq!(lib.list_folders()[0].name, "A2");
        // 删除后子文件夹上提
        lib.delete_folder(&f1.id).unwrap();
        let rest = lib.list_folders();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].id, f2.id);
        assert!(rest[0].parent_id.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ingest_query_trash_and_purge() {
        let (lib, dir) = temp_lib("items");
        let (queue, _rx) = JobQueue::new();
        let tmp = std::env::temp_dir().join(format!("lilium-src-{}.png", std::process::id()));
        let src = test_png(std::env::temp_dir().as_path(), &tmp.file_name().unwrap().to_string_lossy(), 32, 32, [200, 10, 10]);

        let (item, created) = import::ingest_file(&lib, &src, None, None, &queue).unwrap();
        assert!(created);
        // 同路径重复导入幂等
        let (item2, created2) = import::ingest_file(&lib, &src, None, None, &queue).unwrap();
        assert!(!created2);
        assert_eq!(item.id, item2.id);
        assert_eq!((item.width, item.height), (Some(32), Some(32)));

        // 查询可见
        let q = query::Query { ..Default::default() };
        let (items, total) = lib.query_items(&q);
        assert_eq!((items.len(), total), (1, 1));

        // 回收站：默认查询不显示，trash 查询可见
        lib.trash_item(&item.id).unwrap();
        let (_, total_live) = lib.query_items(&query::Query { ..Default::default() });
        let (_, total_trash) = lib.query_items(&query::Query { trash: query::LooseBool(true), ..Default::default() });
        assert_eq!((total_live, total_trash), (0, 1));
        // 恢复
        lib.restore_item(&item.id).unwrap();
        let (_, total_restored) = lib.query_items(&query::Query { ..Default::default() });
        assert_eq!(total_restored, 1);

        // 彻底删除：文件与 DB 记录一并移除
        let file = lib.item_file_path(&item.id).unwrap();
        assert!(file.is_file());
        lib.purge_item(&item.id).unwrap();
        assert!(!file.exists());
        assert!(lib.get_item(&item.id).is_none());

        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tags_and_batch_operations() {
        let (lib, dir) = temp_lib("tags");
        let (queue, _rx) = JobQueue::new();
        let tmp = std::env::temp_dir().join(format!("lilium-tag-{}.png", std::process::id()));
        let src = test_png(std::env::temp_dir().as_path(), &tmp.file_name().unwrap().to_string_lossy(), 16, 16, [10, 200, 10]);
        let (item, _) = import::ingest_file(&lib, &src, None, None, &queue).unwrap();

        lib.create_tag("风景", "#22c55e").unwrap();
        lib.batch_tag(&[item.id.clone()], "风景", false).unwrap();
        let tags = lib.list_tags();
        assert_eq!(tags.len(), 1);
        assert_eq!((tags[0].name.as_str(), tags[0].count), ("风景", 1));

        // 批量评分 + 范围约束
        lib.batch_rating(&[item.id.clone()], 9).unwrap();
        assert_eq!(lib.get_item(&item.id).unwrap().rating, 5);
        lib.batch_rating(&[item.id.clone()], -1).unwrap();
        assert_eq!(lib.get_item(&item.id).unwrap().rating, 0);

        // 单条 update 校验评分 clamp 与空名称拒绝
        let patched = lib
            .update_item(&item.id, &import::ItemPatch { rating: Some(3), ..Default::default() })
            .unwrap();
        assert_eq!(patched.rating, 3);
        assert!(lib
            .update_item(&item.id, &import::ItemPatch { name: Some("  ".into()), ..Default::default() })
            .is_err());

        // 标签重命名 & 删除
        lib.rename_tag("风景", "scenery", Some("#3b82f6")).unwrap();
        let tags = lib.list_tags();
        assert_eq!((tags[0].name.as_str(), tags[0].color.as_str()), ("scenery", "#3b82f6"));
        lib.delete_tag("scenery").unwrap();
        assert!(lib.list_tags().is_empty());

        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn batch_move_validates_folder() {
        let (lib, dir) = temp_lib("move");
        let (queue, _rx) = JobQueue::new();
        let tmp = std::env::temp_dir().join(format!("lilium-move-{}.png", std::process::id()));
        let src = test_png(std::env::temp_dir().as_path(), &tmp.file_name().unwrap().to_string_lossy(), 16, 16, [10, 10, 200]);
        let (item, _) = import::ingest_file(&lib, &src, None, None, &queue).unwrap();

        assert!(lib.batch_move(&[item.id.clone()], Some("不存在")).is_err());
        let f = lib.create_folder(None, "目标").unwrap();
        lib.batch_move(&[item.id.clone()], Some(&f.id)).unwrap();
        assert_eq!(lib.get_item(&item.id).unwrap().folder_id, Some(f.id));
        // 移回未分类
        lib.batch_move(&[item.id.clone()], None).unwrap();
        assert_eq!(lib.get_item(&item.id).unwrap().folder_id, None);

        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn batch_rename_dedupes_pattern_collisions() {
        let (lib, dir) = temp_lib("rename");
        let (queue, _rx) = JobQueue::new();
        let tmp = std::env::temp_dir().join(format!("lilium-rn-{}.png", std::process::id()));
        // 不同尺寸 → 内容不同 → 导入互不去重，得到 3 个独立条目
        let srcs: Vec<_> = [(16u32, 16u32), (24, 24), (32, 32)]
            .into_iter()
            .map(|(w, h)| {
                let p = std::env::temp_dir().join(format!("lilium-rn-{}-{}x{}.png", std::process::id(), w, h));
                test_png(std::env::temp_dir().as_path(), &p.file_name().unwrap().to_string_lossy(), w, h, [200, 10, 10])
            })
            .collect();
        let mut ids = vec![];
        for src in &srcs {
            let (it, _) = import::ingest_file(&lib, src, None, None, &queue).unwrap();
            ids.push(it.id);
        }
        // 统一改成同名 → 模拟「多文件同名」的碰撞前提
        for id in &ids {
            lib.update_item(id, &import::ItemPatch { name: Some("photo.png".into()), ..Default::default() }).unwrap();
        }
        // 固定模式（不含 {index}）→ 必然碰撞
        let out = lib.batch_rename(&ids, "photo").unwrap();
        assert_eq!(out.len(), 3, "存在的条目都应出现在结果里");
        assert_eq!(out[0].1, "photo", "第一个条目拿到原始候选名");
        assert_eq!(out[1].1, "photo (2)", "第二个条目追加序号去重");
        assert_eq!(out[2].1, "photo (3)", "第三个条目继续追加序号");
        // 库内三条名称互不相同
        let names: std::collections::BTreeSet<_> = out.iter().map(|(_, n)| n.clone()).collect();
        assert_eq!(names.len(), 3);

        // 扩展名保留：带 {ext} 的模式碰撞时序号插在扩展名之前
        let out2 = lib.batch_rename(&ids, "pic.{ext}").unwrap();
        assert_eq!((out2[0].1.as_str(), out2[1].1.as_str(), out2[2].1.as_str()), ("pic.png", "pic (2).png", "pic (3).png"));

        // 与库内既有名称冲突：库外条目已占用「solo」→ 批次内改为 solo (2)、solo (3)
        let src4 = test_png(std::env::temp_dir().as_path(), &format!("lilium-rn-{}-40.png", std::process::id()), 40, 40, [10, 200, 200]);
        let (solo, _) = import::ingest_file(&lib, &src4, None, None, &queue).unwrap();
        assert_ne!(solo.id, ids[0], "不同内容文件应生成独立条目");
        lib.update_item(&solo.id, &import::ItemPatch { name: Some("solo".into()), ..Default::default() }).unwrap();
        let rest: Vec<String> = ids.iter().take(2).cloned().collect();
        let out3 = lib.batch_rename(&rest, "solo").unwrap();
        assert_eq!((out3[0].1.as_str(), out3[1].1.as_str()), ("solo (2)", "solo (3)"), "候选名 solo 已被库内条目占用");
        assert_eq!(lib.get_item(&solo.id).unwrap().name, "solo", "占用者不被改名");

        // 无碰撞的正常路径不受影响：{index} 保证唯一时不追加序号
        let out4 = lib.batch_rename(&ids, "n{index}").unwrap();
        assert_eq!(out4.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>(), ["n001", "n002", "n003"]);

        // 不存在的 id 静默跳过（与既有行为一致）
        let out5 = lib.batch_rename(&["NOPE00000000000000001".into()], "p").unwrap();
        assert!(out5.is_empty());

        for src in srcs.iter().chain(std::iter::once(&src4)) {
            let _ = std::fs::remove_file(src);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn batch_rename_rejects_blank_pattern() {
        // 空白模式会把条目名批量清空成 ""，与单条 update_item 的空名校验对齐
        let (lib, dir) = temp_lib("blankrn");
        assert!(lib.batch_rename(&["whatever".to_string()], "").is_err());
        assert!(lib.batch_rename(&["whatever".to_string()], "   ").is_err());
        // 任何条目都不该被改成空名
        assert!(lib.query_items(&Default::default()).0.iter().all(|i| !i.name.trim().is_empty()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn smart_folder_crud() {
        let (lib, dir) = temp_lib("smart");
        let q = serde_json::json!({ "ratingMin": 3 });
        let sf = lib.create_smart_folder("高分", &q).unwrap();
        assert_eq!(lib.list_smart_folders().len(), 1);
        lib.update_smart_folder(&sf.id, "高分图片", &serde_json::json!({ "ratingMin": 4 })).unwrap();
        let all = lib.list_smart_folders();
        assert_eq!(all[0].name, "高分图片");
        assert_eq!(all[0].query["ratingMin"], 4);
        lib.delete_smart_folder(&sf.id).unwrap();
        assert!(lib.list_smart_folders().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn blank_names_are_rejected() {
        let (lib, dir) = temp_lib("blank");
        // 标签：创建与重命名都拒绝空白名（此前纯空格会入库成不可见的空名标签）
        assert!(lib.create_tag("   ", "#8b5cf6").is_err());
        assert!(lib.list_tags().is_empty());
        lib.create_tag("t1", "#8b5cf6").unwrap();
        assert!(lib.rename_tag("t1", "  ", None).is_err());
        assert_eq!(lib.list_tags()[0].name, "t1", "重命名失败时原名应保留");

        // 文件夹：创建与重命名都拒绝空白名
        assert!(lib.create_folder(None, "   ").is_err());
        assert!(lib.list_folders().is_empty());
        let f = lib.create_folder(None, "f1").unwrap();
        assert!(lib.rename_folder(&f.id, "   ").is_err());
        assert_eq!(lib.list_folders()[0].name, "f1");

        // 智能文件夹：创建与更新都拒绝空白名
        let q = serde_json::json!({ "ratingMin": 1 });
        assert!(lib.create_smart_folder("  ", &q).is_err());
        assert!(lib.list_smart_folders().is_empty());
        let sf = lib.create_smart_folder("s1", &q).unwrap();
        assert!(lib.update_smart_folder(&sf.id, " ", &q).is_err());
        assert_eq!(lib.list_smart_folders()[0].name, "s1");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicates_groups_by_hash() {
        let (lib, dir) = temp_lib("dups");
        let (queue, _rx) = JobQueue::new();
        let tmp = std::env::temp_dir().join(format!("lilium-dup-{}.png", std::process::id()));
        let src = test_png(std::env::temp_dir().as_path(), &tmp.file_name().unwrap().to_string_lossy(), 24, 24, [99, 99, 99]);
        // 同一文件导入到不同位置 → 内容相同但路径不同 → 应进「相同内容」组
        // 同内容第二次导入 → 命中去重，返回同一条目
        let (a, created_first) = import::ingest_file(&lib, &src, None, Some("a.png"), &queue).unwrap();
        assert!(created_first);
        let (b, created) = import::ingest_file(&lib, &src, None, Some("b.png"), &queue).unwrap();
        assert!(!created, "同内容应命中去重");
        assert_eq!(a.id, b.id);

        // 手动制造一对相同 hash 的条目 → find_duplicates 应按内容分组
        lib.conn
            .execute(
                "INSERT INTO items(id,name,ext,kind,size,hash,phash,added_at,created_at)
                 VALUES('DUP00000000000000001','c.png','png','image',1,?1,?2,0,0)",
                rusqlite::params![a.hash.clone().unwrap_or_else(|| "x".into()), a.phash.clone().unwrap_or_else(|| "0".into())],
            )
            .unwrap();
        let groups = lib.find_duplicates();
        assert!(groups.iter().any(|(reason, g)| reason.starts_with("相同内容") && g.len() == 2));
        // 手造条目无 phash 相似对 → 不应出现「相似图片」组
        assert!(groups.iter().all(|(reason, _)| !reason.starts_with("相似图片")));
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn settings_roundtrip() {
        let (lib, dir) = temp_lib("settings");
        lib.settings_set("autoImport", &serde_json::json!(false)).unwrap();
        let all = lib.settings_get_all();
        assert_eq!(all["autoImport"], serde_json::json!(false));
        assert_eq!(all["watchFolders"], serde_json::json!([]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn query_filters_and_sort() {
        let (lib, dir) = temp_lib("query");
        let (queue, _rx) = JobQueue::new();
        let tmp1 = std::env::temp_dir().join(format!("lilium-q1-{}.png", std::process::id()));
        let tmp2 = std::env::temp_dir().join(format!("lilium-q2-{}.png", std::process::id()));
        let s1 = test_png(std::env::temp_dir().as_path(), &tmp1.file_name().unwrap().to_string_lossy(), 16, 16, [1, 2, 3]);
        let s2 = test_png(std::env::temp_dir().as_path(), &tmp2.file_name().unwrap().to_string_lossy(), 16, 16, [250, 250, 250]);
        let (i1, _) = import::ingest_file(&lib, &s1, None, Some("alpha.png"), &queue).unwrap();
        let (i2, _) = import::ingest_file(&lib, &s2, None, Some("beta.png"), &queue).unwrap();
        lib.batch_rating(&[i1.id.clone()], 4).unwrap();
        lib.create_tag("收藏", "#f59e0b").unwrap();
        lib.batch_tag(&[i2.id.clone()], "收藏", false).unwrap();

        // 名称搜索（不区分大小写）
        let (_, total) = lib.query_items(&query::Query { q: Some("ALPHA".into()), ..Default::default() });
        assert_eq!(total, 1);
        // 标签过滤
        let (_, total) = lib.query_items(&query::Query { tag: Some("收藏".into()), ..Default::default() });
        assert_eq!(total, 1);
        // 评分下限
        let (_, total) = lib.query_items(&query::Query { rating_min: query::LooseInt(3), ..Default::default() });
        assert_eq!(total, 1);
        // 未打标过滤
        let (_, total) = lib.query_items(&query::Query { untagged: query::LooseBool(true), ..Default::default() });
        assert_eq!(total, 1);
        // 随机排序不丢条目
        let (items, total) = lib.query_items(&query::Query {
            sort: Some("random".into()),
            seed: query::LooseInt(42),
            ..Default::default()
        });
        assert_eq!((items.len(), total), (2, 2));
        // 排序白名单：未知排序回落 addedAt 而不是报错
        let (items, _) = lib.query_items(&query::Query { sort: Some("'; DROP TABLE items;--".into()), ..Default::default() });
        assert_eq!(items.len(), 2);

        let _ = std::fs::remove_file(&s1);
        let _ = std::fs::remove_file(&s2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 新条件类型的端到端语义：评分上限、日期区间、否定标签（真值语义而非仅 SQL 形状）
    #[test]
    fn query_new_conditions_rating_max_dates_not_tags() {
        let (lib, dir) = temp_lib("query2");
        let (queue, _rx) = JobQueue::new();
        let tmp1 = std::env::temp_dir().join(format!("lilium-q3-{}.png", std::process::id()));
        let tmp2 = std::env::temp_dir().join(format!("lilium-q4-{}.png", std::process::id()));
        let tmp3 = std::env::temp_dir().join(format!("lilium-q5-{}.png", std::process::id()));
        let s1 = test_png(std::env::temp_dir().as_path(), &tmp1.file_name().unwrap().to_string_lossy(), 16, 16, [1, 2, 3]);
        let s2 = test_png(std::env::temp_dir().as_path(), &tmp2.file_name().unwrap().to_string_lossy(), 16, 16, [4, 5, 6]);
        let s3 = test_png(std::env::temp_dir().as_path(), &tmp3.file_name().unwrap().to_string_lossy(), 16, 16, [7, 8, 9]);
        let (a, _) = import::ingest_file(&lib, &s1, None, Some("apple.png"), &queue).unwrap();
        let (b, _) = import::ingest_file(&lib, &s2, None, Some("banana.png"), &queue).unwrap();
        let (c, _) = import::ingest_file(&lib, &s3, None, Some("cherry.png"), &queue).unwrap();

        // 评分：a=2, b=4, c=5；标签：a,b=「水果」, c=「工具」
        lib.batch_rating(&[a.id.clone()], 2).unwrap();
        lib.batch_rating(&[b.id.clone()], 4).unwrap();
        lib.batch_rating(&[c.id.clone()], 5).unwrap();
        lib.create_tag("水果", "#22c55e").unwrap();
        lib.create_tag("工具", "#3b82f6").unwrap();
        lib.batch_tag(&[a.id.clone(), b.id.clone()], "水果", false).unwrap();
        lib.batch_tag(&[c.id.clone()], "工具", false).unwrap();

        // 三条添加时间错开 1 秒（直接 SQL 改，绕过导入即即 now）
        let base: i64 = 1_700_000_000_000;
        for (idx, id) in [&a.id, &b.id, &c.id].iter().enumerate() {
            lib.conn
                .execute("UPDATE items SET added_at=?1, created_at=?2 WHERE id=?3", rusqlite::params![base + (idx as i64) * 1000, base + 5_000_000 + (idx as i64) * 1000, id])
                .unwrap();
        }

        // 评分区间 [3,4] → 只有 b（ratingMax 生效且 5 星不受界）
        let (_, total) = lib.query_items(&query::Query {
            rating_min: query::LooseInt(3),
            rating_max: query::LooseInt(4),
            ..Default::default()
        });
        assert_eq!(total, 1, "评分区间 [3,4] 应只命中 b");
        // ratingMax=5 等价不设上界 → 全部 3 条
        let (_, total) = lib.query_items(&query::Query { rating_max: query::LooseInt(5), ..Default::default() });
        assert_eq!(total, 3, "ratingMax=5 应等价全部");
        // ratingMin>ratingMax → 空集不报错
        let (_, total) = lib.query_items(&query::Query {
            rating_min: query::LooseInt(4),
            rating_max: query::LooseInt(2),
            ..Default::default()
        });
        assert_eq!(total, 0, "矛盾区间应为空集");

        // 添加日期区间：只含 base+1000（b）→ 闭区间含边界
        let (_, total) = lib.query_items(&query::Query {
            added_from: query::LooseInt(base + 1000),
            added_to: query::LooseInt(base + 1000),
            ..Default::default()
        });
        assert_eq!(total, 1, "闭区间单点应只命中 b");
        // 全跨度 → 3 条；created 区间（含全部）→ 3 条
        let (_, total) = lib.query_items(&query::Query {
            added_from: query::LooseInt(base - 1),
            added_to: query::LooseInt(base + 9999),
            ..Default::default()
        });
        assert_eq!(total, 3);
        let (_, total) = lib.query_items(&query::Query {
            created_from: query::LooseInt(base + 5_000_000),
            created_to: query::LooseInt(base + 5_002_000),
            ..Default::default()
        });
        assert_eq!(total, 3, "created 区间含边界应全命中");
        // created 区间早于全部 → 空集
        let (_, total) = lib.query_items(&query::Query {
            created_to: query::LooseInt(base),
            ..Default::default()
        });
        assert_eq!(total, 0, "区间早于全部条目应为空集");

        // 否定标签：排除「水果」→ 只剩 c
        let (_, total) = lib.query_items(&query::Query {
            not_tags: query::LooseVec(vec!["水果".into()]),
            ..Default::default()
        });
        assert_eq!(total, 1, "排除「水果」后应只剩 c");
        let (items, _) = lib.query_items(&query::Query {
            not_tags: query::LooseVec(vec!["水果".into()]),
            ..Default::default()
        });
        assert_eq!(items[0].id, c.id);
        // 否定 + 肯定组合：含「工具」且不含「水果」→ c；含「水果」且不含「工具」→ a,b
        let (_, total) = lib.query_items(&query::Query {
            tag: Some("工具".into()),
            not_tags: query::LooseVec(vec!["水果".into()]),
            ..Default::default()
        });
        assert_eq!(total, 1);
        let (_, total) = lib.query_items(&query::Query {
            tag: Some("水果".into()),
            not_tags: query::LooseVec(vec!["工具".into()]),
            ..Default::default()
        });
        assert_eq!(total, 2);
        // 否定多个标签（CSV 宽松解析）：排除「水果,工具」→ 空集
        let (_, total) = lib.query_items(&query::Query {
            not_tags: query::LooseVec(vec!["水果".into(), "工具".into()]),
            ..Default::default()
        });
        assert_eq!(total, 0);
        // 否定不存在的标签 → 无影响
        let (_, total) = lib.query_items(&query::Query {
            not_tags: query::LooseVec(vec!["不存在的标签".into()]),
            ..Default::default()
        });
        assert_eq!(total, 3);

        // 旧库 JSON 直接经 Query 解析（不迁移）+ 新条件：未知字段忽略
        let legacy = serde_json::json!({"ratingMin": 2, "legacyField": "should-be-ignored"});
        let q: query::Query = serde_json::from_value(legacy).unwrap();
        let (_, total) = lib.query_items(&q);
        assert_eq!(total, 1, "旧 JSON(含未知字段)应只命中 rating>=2 的 b,c");

        let _ = std::fs::remove_file(&s1);
        let _ = std::fs::remove_file(&s2);
        let _ = std::fs::remove_file(&s3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dhash_similarity_clusters_and_ignores_far_pairs() {
        let (lib, dir) = temp_lib("simgrp");
        // 构造 3 张互相相似（距离 ≤ 2）的图 + 1 张全 bit 翻转的不相似图
        let base: u64 = 0b1011_0100_1100_0110u64 << 48;
        let near2 = base ^ (1 << 40); // 距离 1
        let near3 = base ^ (0b11 << 20); // 距离 2
        let far = !base; // 距离 64
        for (id, ph) in [
            ("SIM000000000000000001", base),
            ("SIM000000000000000002", near2),
            ("SIM000000000000000003", near3),
            ("SIM000000000000000004", far),
        ] {
            lib.conn
                .execute(
                    "INSERT INTO items(id,name,ext,kind,size,phash,added_at,created_at)
                     VALUES(?1,'x.png','png','image',1,?2,0,0)",
                    rusqlite::params![id, format!("{ph:016x}")],
                )
                .unwrap();
        }
        let groups = lib.find_duplicates();
        let similar: Vec<&Vec<crate::model::Item>> = groups
            .iter()
            .filter(|(r, _)| r.starts_with("相似图片"))
            .map(|(_, g)| g)
            .collect();
        assert_eq!(similar.len(), 1, "相似条目应聚类成一组: {similar:?}");
        let ids: Vec<&str> = similar[0].iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids.len(), 3, "3 张相似图应聚成一组，远距离图不参与: {ids:?}");
        assert!(ids.contains(&"SIM000000000000000001"));
        assert!(ids.contains(&"SIM000000000000000002"));
        assert!(ids.contains(&"SIM000000000000000003"));
        assert!(!ids.contains(&"SIM000000000000000004"));

        // similar_to：以 base 为基准，应召回 2 张近邻、排除远距离图
        let sim = lib.similar_to("SIM000000000000000001");
        assert_eq!(sim.len(), 2, "带状索引剪枝不得漏召回近邻: {sim:?}");
        assert!(sim.iter().all(|i| i.id != "SIM000000000000000004"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicates_edge_cases_empty_single_no_phash() {
        // 空库：不 panic、无分组
        let (lib, dir) = temp_lib("dupempty");
        assert!(lib.find_duplicates().is_empty(), "空库不应产生分组");
        assert!(lib.similar_to("任意id").is_empty(), "不存在条目的相似查询应为空");

        // 单图（含 phash）：自成一组不可能出现，无相似对
        lib.conn
            .execute(
                "INSERT INTO items(id,name,ext,kind,size,phash,added_at,created_at)
                 VALUES('ONE0000000000000000001','a.png','png','image',1,'0123456789abcdef',0,0)",
                [],
            )
            .unwrap();
        assert!(lib.find_duplicates().is_empty(), "单图不应产生分组");
        assert!(lib.similar_to("ONE0000000000000000001").is_empty());

        // 两张完全相同 phash：应聚成一组（LSH 桶内距离 0）
        lib.conn
            .execute(
                "INSERT INTO items(id,name,ext,kind,size,phash,added_at,created_at)
                 VALUES('ONE0000000000000000002','b.png','png','image',1,'0123456789abcdef',0,0)",
                [],
            )
            .unwrap();
        let groups = lib.find_duplicates();
        let similar: Vec<&Vec<crate::model::Item>> = groups
            .iter()
            .filter(|(r, _)| r.starts_with("相似图片"))
            .map(|(_, g)| g)
            .collect();
        assert_eq!(similar.len(), 1, "相同 phash 两图应聚成一组: {groups:?}");
        assert_eq!(similar[0].len(), 2);

        // 无 phash / 非法 hex 条目：应被安全跳过，不 panic、不误报
        lib.conn
            .execute(
                "INSERT INTO items(id,name,ext,kind,size,phash,added_at,created_at)
                 VALUES('ONE0000000000000000003','c.png','png','image',1,NULL,0,0)",
                [],
            )
            .unwrap();
        lib.conn
            .execute(
                "INSERT INTO items(id,name,ext,kind,size,phash,added_at,created_at)
                 VALUES('ONE0000000000000000004','d.png','png','image',1,'zz-nothex!!',0,0)",
                [],
            )
            .unwrap();
        let groups = lib.find_duplicates();
        assert!(
            groups.iter().all(|(r, g)| !r.starts_with("相似图片") || g.iter().all(|i| i.id != "ONE0000000000000000004")),
            "非法 hex 条目不得进入相似组: {groups:?}"
        );
        assert!(lib.similar_to("ONE0000000000000000004").is_empty(), "自身 phash 非法时应返回空");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn lsh_threshold_boundaries() {
        let (lib, dir) = temp_lib("dupthresh");
        let mk = |lib: &Library, id: &str, ph: u64| {
            lib.conn
                .execute(
                    "INSERT INTO items(id,name,ext,kind,size,phash,added_at,created_at)
                     VALUES(?1,'x.png','png','image',1,?2,0,0)",
                    rusqlite::params![id, format!("{ph:016x}")],
                )
                .unwrap();
        };
        let base: u64 = 0x0123_4567_89ab_cdef;

        // 分组阈值边界：距离 6 → 同组；距离 7 → 不同组
        mk(&lib, "THR000000000000000001", base);
        mk(&lib, "THR000000000000000002", base ^ 0b111111); // 距离 6
        mk(&lib, "THR000000000000000003", base ^ (0b1111111 << 20)); // 距离 7
        let groups = lib.find_duplicates();
        let similar: Vec<&Vec<crate::model::Item>> = groups
            .iter()
            .filter(|(r, _)| r.starts_with("相似图片"))
            .map(|(_, g)| g)
            .collect();
        assert_eq!(similar.len(), 1, "距离 6 应成组，距离 7 不应: {similar:?}");
        let ids: Vec<&str> = similar[0].iter().map(|i| i.id.as_str()).collect();
        assert!(ids.contains(&"THR000000000000000001") && ids.contains(&"THR000000000000000002"));
        assert!(!ids.contains(&"THR000000000000000003"), "距离 7 超出分组阈值 6: {ids:?}");

        // 回收阈值边界（similar_to ≤ 10）：距离 10 → 召回；距离 11 → 不召回
        lib.conn.execute("DELETE FROM items WHERE 1=1", []).unwrap();
        mk(&lib, "THR000000000000000001", base);
        mk(&lib, "THR000000000000000002", base ^ (0b11_1111_1111)); // 距离 10
        mk(&lib, "THR000000000000000003", base ^ (0b111_1111_1111 << 8)); // 距离 11
        let sim = lib.similar_to("THR000000000000000001");
        let sim_ids: Vec<&str> = sim.iter().map(|i| i.id.as_str()).collect();
        assert!(
            sim_ids.contains(&"THR000000000000000002") && !sim_ids.contains(&"THR000000000000000003"),
            "距离 10 应召回、距离 11 不应: {sim_ids:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn auto_import_off_disables_watch_scan() {
        let (lib, dir) = temp_lib("watchoff");
        let (queue, _rx) = JobQueue::new();
        let watch = dir.parent().unwrap().join(format!("watch-src-{}", std::process::id()));
        std::fs::create_dir_all(&watch).unwrap();
        let src = test_png(&watch, "w.png", 16, 16, [1, 2, 3]);
        lib.settings_set("watchFolders", &serde_json::json!([watch.to_string_lossy()])).unwrap();
        lib.settings_set("autoImport", &serde_json::json!(false)).unwrap();

        let n = lib.scan_watch_folders(&queue).unwrap();
        assert_eq!(n, 0, "autoImport=false 时不得导入");

        lib.settings_set("autoImport", &serde_json::json!(true)).unwrap();
        let n = lib.scan_watch_folders(&queue).unwrap();
        assert_eq!(n, 1, "autoImport=true 时应导入观察文件夹");
        assert!(src.exists(), "观察导入不移动源文件");
        let _ = std::fs::remove_dir_all(&watch);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
