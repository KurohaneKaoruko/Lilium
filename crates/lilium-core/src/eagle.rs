//! Eagle 库（.library）格式兼容导入
//!
//! Eagle 库结构：
//! ```text
//! xxx.library/
//!   metadata.json      { "folders": [...], ... }   旧版
//!   folders.json       [ { id, name, children: [...] } ]  新版
//!   tags.json          [ { name, color? } ] 或 { "tags": [...] }
//!   images/
//!     K/
//!       KXXXX.info/
//!         metadata.json  { id, name, ext, size, width, height, tags, palettes,
//!                          star, annotation, url, modificationTime, ... }
//!         thumbnail.png
//! ```
use std::path::Path;

use rusqlite::params;
use serde_json::Value;

use crate::jobs::JobQueue;
use crate::library::Library;
use crate::meta;

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EagleImportReport {
    pub folders: usize,
    pub items: usize,
    pub tags: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// 读取 Eagle 库显示名
pub fn read_library_name(root: &Path) -> Option<String> {
    let v: Value = serde_json::from_slice(&std::fs::read(root.join("metadata.json")).ok()?).ok()?;
    v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
}

pub fn sha1_hex_file(path: &Path) -> String {
    use sha1::Digest;
    let mut hasher = sha1::Sha1::new();
    // 流式读取，避免大文件（视频）整块载入内存
    if let Ok(f) = std::fs::File::open(path) {
        let mut reader = std::io::BufReader::with_capacity(256 * 1024, f);
        let mut buf = [0u8; 64 * 1024];
        loop {
            match std::io::Read::read(&mut reader, &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => hasher.update(&buf[..n]),
            }
        }
    }
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// dHash 8x8 → 16 hex（64 bit）
pub fn dhash_hex(img: &image::DynamicImage) -> String {
    let gray = img.grayscale().to_luma8();
    let small = image::imageops::resize(&gray, 9, 8, image::imageops::FilterType::Triangle);
    let mut bits: u64 = 0;
    for y in 0..8 {
        for x in 0..8 {
            let l = small.get_pixel(x, y).0[0] as i16;
            let r = small.get_pixel(x + 1, y).0[0] as i16;
            bits = (bits << 1) | (l > r) as u64;
        }
    }
    format!("{bits:016x}")
}

type PaletteResult = (Vec<Value>, (i64, i64, i64));

/// k-means 调色板（k=6），返回 ([{color,weight}...], 主色 rgb)
pub fn kmeans_palette(img: &image::DynamicImage) -> PaletteResult {
    let small = img.resize_exact(32, 32, image::imageops::FilterType::Triangle).to_rgb8();
    let pixels: Vec<[f32; 3]> = small
        .pixels()
        .map(|p| [p.0[0] as f32, p.0[1] as f32, p.0[2] as f32])
        .collect();

    let k = 6usize;
    // 初始中心：均匀采样
    let mut centers: Vec<[f32; 3]> = (0..k)
        .map(|i| pixels[(i * pixels.len() / k).min(pixels.len() - 1)])
        .collect();
    let mut assign = vec![0usize; pixels.len()];

    for _ in 0..8 {
        // assign
        for (i, p) in pixels.iter().enumerate() {
            let mut best = 0;
            let mut bd = f32::MAX;
            for (ci, c) in centers.iter().enumerate() {
                let d = (p[0] - c[0]).powi(2) + (p[1] - c[1]).powi(2) + (p[2] - c[2]).powi(2);
                if d < bd {
                    bd = d;
                    best = ci;
                }
            }
            assign[i] = best;
        }
        // update
        let mut sums = vec![[0f32; 3]; k];
        let mut counts = vec![0f32; k];
        for (i, p) in pixels.iter().enumerate() {
            let c = assign[i];
            sums[c][0] += p[0];
            sums[c][1] += p[1];
            sums[c][2] += p[2];
            counts[c] += 1.0;
        }
        for ci in 0..k {
            if counts[ci] > 0.0 {
                centers[ci] = [sums[ci][0] / counts[ci], sums[ci][1] / counts[ci], sums[ci][2] / counts[ci]];
            }
        }
    }

    let mut entries: Vec<(f32, [i64; 3])> = centers
        .iter()
        .enumerate()
        .map(|(ci, c)| {
            (
                counts_of(&assign, ci),
                [c[0].round() as i64, c[1].round() as i64, c[2].round() as i64],
            )
        })
        .collect();
    let total: f32 = entries.iter().map(|e| e.0).sum::<f32>().max(1.0);
    entries.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let palette: Vec<Value> = entries
        .iter()
        .map(|(cnt, rgb)| {
            serde_json::json!({
                "color": format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2]),
                "weight": (cnt / total * 1000.0).round() / 1000.0,
            })
        })
        .collect();
    let dom = entries.first().map(|e| e.1).unwrap_or([128, 128, 128]);
    (palette, (dom[0], dom[1], dom[2]))
}

fn counts_of(assign: &[usize], target: usize) -> f32 {
    assign.iter().filter(|&&a| a == target).count() as f32
}

// ---------- Eagle 库导入 ----------

#[derive(Default)]
struct EagleFolder {
    id: String,
    name: String,
    children: Vec<EagleFolder>,
}

fn parse_folders(v: &Value, errors: &mut Vec<String>) -> Vec<EagleFolder> {
    let mut out = vec![];
    if let Some(arr) = v.as_array() {
        for f in arr {
            let id = f.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
            let mut name = f
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("未命名")
                .to_string();
            if id.is_empty() {
                errors.push(format!("文件夹缺少 id: {name}"));
                continue;
            }
            if name.trim().is_empty() {
                name = "未命名".to_string();
            }
            let children = parse_folders(f.get("children").unwrap_or(&Value::Null), errors);
            out.push(EagleFolder { id, name, children });
        }
    }
    out
}

/// 导入 Eagle 库到 Lilium 库
pub fn import_eagle_library(
    lib: &Library,
    eagle_root: &Path,
) -> Result<EagleImportReport, anyhow::Error> {
    let mut report = EagleImportReport::default();
    let queue = JobQueue::new().0;

    // ---- folders.json（新）或 metadata.json（旧）----
    let folders_val: Option<Value> = std::fs::read(eagle_root.join("folders.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .or_else(|| {
            let meta: Value =
                serde_json::from_slice(&std::fs::read(eagle_root.join("metadata.json")).ok()?).ok()?;
            meta.get("folders").cloned()
        });
    let tree = folders_val
        .map(|v| parse_folders(&v, &mut report.errors))
        .unwrap_or_default();

    // 递归插入文件夹
    fn insert_folders(
        lib: &Library,
        nodes: &[EagleFolder],
        parent: Option<&str>,
        report: &mut EagleImportReport,
    ) {
        for n in nodes {
            let ok = lib
                .conn
                .execute(
                    "INSERT OR IGNORE INTO folders(id,parent_id,name,position,created_at) VALUES(?1,?2,?3,0,?4)",
                    params![n.id, parent, n.name, crate::jobs::now_ms()],
                )
                .is_ok();
            if ok {
                report.folders += 1;
            }
            insert_folders(lib, &n.children, Some(&n.id), report);
        }
    }
    insert_folders(lib, &tree, None, &mut report);

    // ---- tags.json ----
    if let Ok(bytes) = std::fs::read(eagle_root.join("tags.json")) {
        if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
            let arr: Vec<Value> = match v {
                Value::Array(a) => a,
                Value::Object(o) => o.get("tags").and_then(|t| t.as_array()).cloned().unwrap_or_default(),
                _ => vec![],
            };
            for t in arr {
                let (name, color) = match &t {
                    Value::String(s) => (s.clone(), "#8b5cf6".to_string()),
                    Value::Object(_) => (
                        t.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                        t.get("color")
                            .and_then(|x| x.as_str())
                            .unwrap_or("#8b5cf6")
                            .to_string(),
                    ),
                    _ => continue,
                };
                if name.is_empty() {
                    continue;
                }
                if lib
                    .conn
                    .execute(
                        "INSERT OR IGNORE INTO tags(name,color,created_at) VALUES(?1,?2,?3)",
                        params![name, color, crate::jobs::now_ms()],
                    )
                    .is_ok()
                {
                    report.tags += 1;
                }
            }
        }
    }

    // ---- images / <bucket> / <id>.info / metadata.json ----
    let images_dir = eagle_root.join("images");
    let mut infos: Vec<std::path::PathBuf> = vec![];
    if let Ok(rd) = std::fs::read_dir(&images_dir) {
        for bucket in rd.flatten() {
            let bpath = bucket.path();
            if !bpath.is_dir() {
                continue;
            }
            if let Ok(rd2) = std::fs::read_dir(&bpath) {
                for info_dir in rd2.flatten() {
                    let ipath = info_dir.path();
                    if ipath.is_dir() && ipath.extension().map(|e| e == "info").unwrap_or(false) {
                        infos.push(ipath);
                    }
                }
            }
        }
    }
    infos.sort();

    for info_dir in &infos {
        let meta_path = info_dir.join("metadata.json");
        let Ok(bytes) = std::fs::read(&meta_path) else {
            report.skipped += 1;
            continue;
        };
        let Ok(m) = serde_json::from_slice::<Value>(&bytes) else {
            report.skipped += 1;
            continue;
        };
        if import_eagle_item(lib, &m, info_dir, eagle_root, &queue).is_ok() {
            report.items += 1;
        } else {
            report.skipped += 1;
        }
    }

    Ok(report)
}

/// 导入单个 Eagle 条目：优先复用其 thumbnail.png；否则重新生成
fn import_eagle_item(
    lib: &Library,
    m: &Value,
    info_dir: &Path,
    _eagle_root: &Path,
    queue: &JobQueue,
) -> Result<(), anyhow::Error> {
    let id = m.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    // id 至少 2 个字符：后续要按 id[0..2] 分桶存文件
    if id.len() < 2 {
        return Err(anyhow::anyhow!("缺少 id 或 id 过短"));
    }
    // 已导入过则跳过
    if lib.get_item(&id).is_some() {
        return Err(anyhow::anyhow!("已存在"));
    }
    let ext = m
        .get("ext")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    // 扩展名只允许字母数字：防路径穿越（如 "../../xxx"）与非法文件名
    if ext.is_empty() || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(anyhow::anyhow!("非法 ext: {ext:?}"));
    }
    let name = m
        .get("name")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| id.clone());
    let kind = m
        .get("type")
        .and_then(|x| x.as_str())
        .map(|s| match s {
            "image" | "video" | "audio" | "font" => s.to_string(),
            _ => meta::kind_of(&ext).to_string(),
        })
        .unwrap_or_else(|| meta::kind_of(&ext).to_string());
    let size = m.get("size").and_then(|x| x.as_i64()).unwrap_or(0);
    let width = m.get("width").and_then(|x| x.as_i64());
    let height = m.get("height").and_then(|x| x.as_i64());
    let duration = m.get("duration").and_then(|x| x.as_f64());
    let rating = m.get("star").and_then(|x| x.as_i64()).unwrap_or(0).clamp(0, 5);
    let note = m
        .get("annotation")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let url = m.get("url").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let added_at = m
        .get("modificationTime")
        .and_then(|x| x.as_i64())
        .unwrap_or_else(crate::jobs::now_ms);
    let created_at = added_at;

    // tags
    let tags: Vec<String> = m
        .get("tags")
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|t| t.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // palettes: Eagle 格式 [{"color":[r,g,b],"weight":0.5}]，转成 Lilium hex
    let mut dom: Option<(i64, i64, i64)> = None;
    let mut palette_json: Option<String> = None;
    if let Some(arr) = m.get("palettes").and_then(|x| x.as_array()) {
        let mut list: Vec<(f64, [i64; 3])> = arr
            .iter()
            .filter_map(|p| {
                let c = p.get("color")?;
                // Eagle 的 color 可能是 [r,g,b] 数组，也可能是 "#rrggbb" 字符串
                let rgb: [i64; 3] = if let Some(arr) = c.as_array() {
                    [
                        arr.first().and_then(|x| x.as_i64()).unwrap_or(128),
                        arr.get(1).and_then(|x| x.as_i64()).unwrap_or(128),
                        arr.get(2).and_then(|x| x.as_i64()).unwrap_or(128),
                    ]
                } else if let Some(hex) = c.as_str() {
                    let h = hex.trim_start_matches('#');
                    let n = i64::from_str_radix(h, 16).ok()?;
                    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
                } else {
                    return None;
                };
                let w = p.get("weight").and_then(|x| x.as_f64()).unwrap_or(0.0);
                Some((w, rgb))
            })
            .collect();
        list.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let total: f64 = list.iter().map(|e| e.0).sum::<f64>().max(1.0);
        let pal: Vec<Value> = list
            .iter()
            .map(|(w, rgb)| {
                serde_json::json!({
                    "color": format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2]),
                    "weight": (*w / total * 1000.0).round() / 1000.0,
                })
            })
            .collect();
        if let Some((_, rgb)) = list.first() {
            dom = Some((rgb[0], rgb[1], rgb[2]));
        }
        palette_json = Some(serde_json::to_string(&pal).unwrap_or_default());
    }

    // folder：校验存在性（悬空引用会让条目在文件夹树里隐身）
    let folder_id = m
        .get("folders")
        .and_then(|x| x.as_array())
        .and_then(|a| a.first())
        .and_then(|f| f.as_str())
        .filter(|fid| {
            let exists: i64 = lib
                .conn
                .query_row("SELECT COUNT(*) FROM folders WHERE id=?1", [fid], |r| r.get(0))
                .unwrap_or(0);
            exists > 0
        });

    // ---- 文件 ----
    let src_file = info_dir.join(format!("{id}.{ext}"));
    let sub = lib.root.join("images").join(&id[0..2]);
    std::fs::create_dir_all(&sub)?;
    let dest = sub.join(format!("{id}.{ext}"));

    let mut used_eagle_thumb = false;
    if src_file.is_file() {
        std::fs::copy(&src_file, &dest)?;
    } else {
        // 原文件缺失：仅登记元数据，thumb 状态 = 失败
        // （Eagle 有些条目只有缩略图，比如 URL 收藏）
        report_no_source(&m);
    }

    // Eagle 自带 thumbnail.png/png 缩略图 → 直接复用，跳过重新生成
    for thumb_name in ["thumbnail.png", "thumbnail_a.png", "thumbnail.jpg"] {
        let t = info_dir.join(thumb_name);
        if t.is_file() {
            let tdir = lib.root.join("thumbnails").join(&id[0..2]);
            std::fs::create_dir_all(&tdir)?;
            let dest_thumb_ext = t.extension().and_then(|e| e.to_str()).unwrap_or("png");
            let dest_thumb = tdir.join(format!("{id}.{dest_thumb_ext}"));
            if std::fs::copy(&t, &dest_thumb).is_ok() {
                used_eagle_thumb = true;
                break;
            }
        }
    }

    let phash = if dest.is_file() && kind == "image" {
        crate::meta::decode_image(&dest).ok().map(|img| dhash_hex(&img))
    } else {
        None
    };

    let inserted = lib.conn.execute(
        "INSERT OR IGNORE INTO items(id,name,ext,kind,size,width,height,duration,hash,phash,r,g,b,palette,
          rating,note,url,folder_id,source_path,added_at,created_at,thumb)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        params![
            id,
            name,
            ext,
            kind,
            size,
            width,
            height,
            duration,
            m.get("hash")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
                .or_else(|| if src_file.is_file() { Some(sha1_hex_file(&src_file)) } else { None }),
            phash,
            dom.map(|d| d.0),
            dom.map(|d| d.1),
            dom.map(|d| d.2),
            palette_json.clone(),
            rating,
            note,
            url,
            folder_id,
            info_dir.to_string_lossy(),
            added_at,
            created_at,
            if used_eagle_thumb { 1 } else { 0 },
        ],
    )?;
    if inserted == 0 {
        // 已存在（重复导入）→ 不重复计数
        return Ok(());
    }

    for t in &tags {
        if t.is_empty() {
            continue;
        }
        lib.conn.execute(
            "INSERT OR IGNORE INTO tags(name,color,created_at) VALUES(?1,'#8b5cf6',?2)",
            params![t, crate::jobs::now_ms()],
        )?;
        lib.conn.execute(
            "INSERT OR IGNORE INTO item_tags(item_id,tag_id) VALUES(?1,?2)",
            params![id, t],
        )?;
    }

    // 没有可用缩略图且是图片 → 排队生成
    if !used_eagle_thumb && dest.is_file() {
        queue.queue_thumbnail(id);
    }
    Ok(())
}

fn report_no_source(_m: &Value) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dhash_is_stable_and_order_sensitive() {
        let a = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(64, 64, image::Rgb([120, 120, 120])));
        let h1 = dhash_hex(&a);
        let h2 = dhash_hex(&a);
        assert_eq!(h1, h2, "同一图片哈希必须稳定");
        assert_eq!(h1.len(), 16, "8x8 → 64bit → 16 hex");

        // 左白右黑 vs 左黑右白 → 汉明距离应很大
        let mut left_white = image::RgbImage::new(64, 64);
        for (x, _, p) in left_white.enumerate_pixels_mut() {
            *p = if x < 32 { image::Rgb([240, 240, 240]) } else { image::Rgb([10, 10, 10]) };
        }
        let mut right_white = image::RgbImage::new(64, 64);
        for (x, _, p) in right_white.enumerate_pixels_mut() {
            *p = if x < 32 { image::Rgb([10, 10, 10]) } else { image::Rgb([240, 240, 240]) };
        }
        let d = {
            let x = u64::from_str_radix(&dhash_hex(&image::DynamicImage::ImageRgb8(left_white)), 16).unwrap();
            let y = u64::from_str_radix(&dhash_hex(&image::DynamicImage::ImageRgb8(right_white)), 16).unwrap();
            (x ^ y).count_ones()
        };
        assert!(d > 10, "镜像图应有低相似度，实际距离 {d}");
    }

    #[test]
    fn kmeans_palette_returns_six_entries_and_dominant() {
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(32, 32, image::Rgb([200, 30, 30])));
        let (palette, dom) = kmeans_palette(&img);
        assert_eq!(palette.len(), 6);
        assert_eq!(dom, (200, 30, 30), "纯色图主色应精确");
        let weight_total: f64 = palette
            .iter()
            .map(|e| e["weight"].as_f64().unwrap_or(0.0))
            .sum();
        assert!((weight_total - 1.0).abs() < 1e-6, "权重和应为 1");
    }

    #[test]
    fn import_eagle_builds_companion_library() {
        // 构造一个最小 Eagle 库
        let base = std::env::temp_dir().join(format!("lilium-eagle-{}", std::process::id()));
        let eagle_root = base.join("Demo.library");
        let info_dir = eagle_root.join("images").join("K0").join("KABC123.info");
        std::fs::create_dir_all(&info_dir).unwrap();
        std::fs::write(
            eagle_root.join("metadata.json"),
            r#"{"name":"DemoLib","folders":[{"id":"F1","name":"相册A"}]}"#,
        )
        .unwrap();
        std::fs::write(eagle_root.join("tags.json"), r##"[{"name":"风景","color":"#22c55e"}]"##).unwrap();

        // 生成真实 PNG 与 .info 元数据
        let img = image::RgbaImage::from_pixel(20, 10, image::Rgba([10, 20, 30, 255]));
        let img_path = info_dir.join("KABC123.png");
        img.save_with_format(&img_path, image::ImageFormat::Png).unwrap();
        std::fs::write(
            info_dir.join("metadata.json"),
            r#"{"id":"KABC123","name":"测试图","ext":"png","size":100,"width":20,"height":10,"tags":["风景"],"star":3,"annotation":"备注","url":"https://example.com","palettes":[{"color":[10,20,30],"weight":1.0}]}"#,
        )
        .unwrap();

        let lib_root = base.join("Demo.lilium");
        std::fs::create_dir_all(lib_root.join("images")).unwrap();
        std::fs::create_dir_all(lib_root.join("thumbnails")).unwrap();
        let conn = crate::db::open_db(&lib_root.join("library.db")).unwrap();
        let lib = Library { root: lib_root.clone(), conn };

        let report = import_eagle_library(&lib, &eagle_root).unwrap();
        assert_eq!((report.folders, report.items, report.tags), (1, 1, 1));

        // 文件夹 / 标签 / 条目元数据完整迁移
        let folders = lib.list_folders();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "相册A");
        let tags = lib.list_tags();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].color, "#22c55e");
        let item = lib.get_item("KABC123").expect("应沿用原 Eagle ID");
        assert_eq!((item.name.as_str(), item.rating), ("测试图", 3));
        assert_eq!(item.note, "备注");
        assert_eq!(item.url, "https://example.com");
        // get_item 不附带 tags → 直接查关联表
        let n: i64 = lib
            .conn
            .query_row("SELECT COUNT(*) FROM item_tags WHERE item_id='KABC123' AND tag_id='风景'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!((item.width, item.height), (Some(20), Some(10)));
        assert!(item.r.is_some(), "应从调色板提取主色");

        // 幂等：重复导入不产生副本
        let again = import_eagle_library(&lib, &eagle_root).unwrap();
        assert_eq!(again.items, 0);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 构造最小 Eagle 库骨架，返回 (Eagle 根目录, .info 目录)
    fn eagle_fixture(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("lilium-eagle-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let eagle_root = base.join("Demo.library");
        let info_dir = eagle_root.join("images").join("K0").join("KDEF0000000000000001.info");
        std::fs::create_dir_all(&info_dir).unwrap();
        std::fs::write(eagle_root.join("metadata.json"), r#"{"name":"DemoLib"}"#).unwrap();
        (eagle_root, info_dir)
    }

    #[test]
    fn eagle_item_with_short_id_is_skipped_not_panic() {
        // 回归：id 长度 < 2 时 id[0..2] 越界 panic 会打断整个导入
        let (eagle_root, info_dir) = eagle_fixture("shortid");
        std::fs::write(
            info_dir.join("metadata.json"),
            r#"{"id":"X","ext":"png"}"#,
        )
        .unwrap();
        let lib = open_test_lib(&eagle_root);
        let report = import_eagle_library(&lib, &eagle_root).unwrap();
        assert_eq!(report.items, 0, "短 id 条目应被跳过");
        assert_eq!(report.skipped, 1);
        let _ = std::fs::remove_dir_all(lib.root.parent().unwrap());
        let _ = std::fs::remove_dir_all(eagle_root.parent().unwrap());
    }

    #[test]
    fn eagle_item_with_traversal_ext_is_rejected() {
        // 回归：ext 未校验，"../evil" 之类会把文件复制出库目录
        let (eagle_root, info_dir) = eagle_fixture("travext");
        std::fs::write(
            info_dir.join("metadata.json"),
            r#"{"id":"KTRV0000000000000001","ext":"../../evil"}"#,
        )
        .unwrap();
        let lib = open_test_lib(&eagle_root);
        let report = import_eagle_library(&lib, &eagle_root).unwrap();
        assert_eq!(report.items, 0, "非法 ext 条目应被拒绝");
        assert!(!eagle_root.parent().unwrap().join("evil").exists(), "不得写出库目录");
        let _ = std::fs::remove_dir_all(lib.root.parent().unwrap());
        let _ = std::fs::remove_dir_all(eagle_root.parent().unwrap());
    }

    #[test]
    fn eagle_item_with_dangling_folder_falls_back_to_unfiled() {
        // 回归：metadata 引用不存在的 folder id → 条目在文件夹树里隐身
        let (eagle_root, info_dir) = eagle_fixture("dangling");
        let img_path = info_dir.join("KDEF0000000000000001.png");
        image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 2, 3, 255]))
            .save_with_format(&img_path, image::ImageFormat::Png)
            .unwrap();
        std::fs::write(
            info_dir.join("metadata.json"),
            r#"{"id":"KDEF0000000000000001","name":"d","ext":"png","folders":["GHOST_FOLDER"]}"#,
        )
        .unwrap();
        let lib = open_test_lib(&eagle_root);
        let report = import_eagle_library(&lib, &eagle_root).unwrap();
        assert_eq!(report.items, 1);
        let item = lib.get_item("KDEF0000000000000001").unwrap();
        assert_eq!(item.folder_id, None, "悬空 folder 应回落为未分类");
        let _ = std::fs::remove_dir_all(lib.root.parent().unwrap());
        let _ = std::fs::remove_dir_all(eagle_root.parent().unwrap());
    }

    /// 测试专用：在 Eagle 库旁打开/创建伴生 .lilium 库
    fn open_test_lib(eagle_root: &Path) -> Library {
        let companion = crate::library::eagle_companion_path(eagle_root);
        std::fs::create_dir_all(companion.join("images")).unwrap();
        std::fs::create_dir_all(companion.join("thumbnails")).unwrap();
        let conn = crate::db::open_db(&companion.join("library.db")).unwrap();
        Library { root: companion, conn }
    }
}
