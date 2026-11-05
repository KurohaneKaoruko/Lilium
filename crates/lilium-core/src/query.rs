use crate::model::Item;

/// 宽松整数：兼容 query string 里的字符串数字
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LooseInt(pub i64);

impl<'de> serde::Deserialize<'de> for LooseInt {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl serde::de::Visitor<'_> for V {
            type Value = LooseInt;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("integer or string integer")
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<LooseInt, E> {
                Ok(LooseInt(v))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<LooseInt, E> {
                Ok(LooseInt(v as i64))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<LooseInt, E> {
                Ok(LooseInt(v as i64))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<LooseInt, E> {
                v.trim().parse::<i64>().map(LooseInt).map_err(serde::de::Error::custom)
            }
            // JSON null（旧库/未来版本写入的空值）→ 中性 0，不报错
            fn visit_unit<E: serde::de::Error>(self) -> Result<LooseInt, E> {
                Ok(LooseInt(0))
            }
        }
        d.deserialize_any(V)
    }
}

impl serde::Serialize for LooseInt {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_i64(self.0)
    }
}

/// 宽松布尔：兼容 "true"/"1"/"yes" 与 JS 布尔
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LooseBool(pub bool);

impl<'de> serde::Deserialize<'de> for LooseBool {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl serde::de::Visitor<'_> for V {
            type Value = LooseBool;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("boolean or string boolean")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<LooseBool, E> {
                Ok(LooseBool(v))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<LooseBool, E> {
                Ok(LooseBool(v != 0))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<LooseBool, E> {
                Ok(LooseBool(v != 0))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<LooseBool, E> {
                match v.trim().to_lowercase().as_str() {
                    "true" | "1" | "yes" | "on" => Ok(LooseBool(true)),
                    "false" | "0" | "no" | "off" | "" => Ok(LooseBool(false)),
                    _ => Err(serde::de::Error::custom(format!("非法布尔: {v}"))),
                }
            }
            // JSON null → false（中性），不报错
            fn visit_unit<E: serde::de::Error>(self) -> Result<LooseBool, E> {
                Ok(LooseBool(false))
            }
        }
        d.deserialize_any(V)
    }
}

impl std::ops::Deref for LooseBool {
    type Target = bool;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

/// 宽松字符串列表：兼容 `kinds=a,b` 与 `kinds=a&kinds=b` 与单个标量
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LooseVec(pub Vec<String>);

struct LooseVecVisitor;

impl<'de> serde::de::Visitor<'de> for LooseVecVisitor {
    type Value = LooseVec;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.write_str("string, list of strings, or comma-separated string")
    }
    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<LooseVec, E> {
        let list: Vec<String> = v
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Ok(LooseVec(list))
    }
    fn visit_seq<A>(self, mut seq: A) -> Result<LooseVec, A::Error>
    where
        A: serde::de::SeqAccess<'de>,
    {
        let mut out = vec![];
        while let Some(s) = seq.next_element::<String>()? {
            for part in s.split(',') {
                let p = part.trim();
                if !p.is_empty() {
                    out.push(p.to_string());
                }
            }
        }
        Ok(LooseVec(out))
    }
    // JSON null → 空列表（中性），不报错
    fn visit_unit<E: serde::de::Error>(self) -> Result<LooseVec, E> {
        Ok(LooseVec(vec![]))
    }
}

impl<'de> serde::Deserialize<'de> for LooseVec {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(LooseVecVisitor)
    }
}

impl std::ops::Deref for LooseVec {
    type Target = Vec<String>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    /// 精确单文件夹
    pub folder_id: Option<String>,
    /// 递归时由调用方展开的全部 folder id（含子级）
    pub folder_ids: Vec<String>,
    pub tag: Option<String>,
    /// 否定标签：排除含有任一这些标签的条目（向后兼容新增，旧库 JSON 无此字段时默认无排除）
    #[serde(default)]
    pub not_tags: LooseVec,
    #[serde(default)]
    pub kinds: LooseVec,
    #[serde(default)]
    pub exts: LooseVec,
    pub rating_min: LooseInt,
    pub rating_max: LooseInt,
    /// 添加时间区间（毫秒时间戳，含边界）；0/缺失表示不设界
    #[serde(default)]
    pub added_from: LooseInt,
    #[serde(default)]
    pub added_to: LooseInt,
    /// 拍摄/创建时间区间（毫秒时间戳，含边界）；0/缺失表示不设界
    #[serde(default)]
    pub created_from: LooseInt,
    #[serde(default)]
    pub created_to: LooseInt,
    /// 颜色过滤：`#rrggbb` 字符串或 [r,g,b]
    pub color: Option<String>,
    #[serde(default)]
    pub color_tolerance: LooseInt,
    pub q: Option<String>,
    #[serde(default)]
    pub trash: LooseBool,
    #[serde(default)]
    pub untagged: LooseBool,
    #[serde(default)]
    pub unfiled: LooseBool,
    pub sort: Option<String>,
    #[serde(default)]
    pub asc: LooseBool,
    #[serde(default)]
    pub offset: LooseInt,
    #[serde(default)]
    pub limit: LooseInt,
    /// 随机排序种子
    #[serde(default)]
    pub seed: LooseInt,
}

pub const ITEM_COLS: &str = "id, name, ext, kind, size, width, height, duration, rating, note, url, folder_id, trash, added_at, created_at, thumb, r, g, b, palette, hash, phash";

const SORTS: &[(&str, &str)] = &[
    ("addedAt", "added_at"),
    ("createdAt", "created_at"),
    ("name", "name COLLATE NOCASE"),
    ("size", "size"),
    ("width", "width"),
    ("height", "height"),
    ("rating", "rating"),
    ("duration", "duration"),
];

pub fn sanitize_sort(sort: &str) -> Option<&'static str> {
    SORTS.iter().find(|(k, _)| *k == sort).map(|(_, col)| *col)
}

/// SQL 参数包装，避免 Box<dyn ToSql>
#[derive(Debug, Clone)]
pub enum Arg {
    S(String),
    I(i64),
    F(f64),
    N,
}

impl rusqlite::types::ToSql for Arg {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        match self {
            Arg::S(s) => s.to_sql(),
            Arg::I(i) => i.to_sql(),
            Arg::F(f) => f.to_sql(),
            Arg::N => rusqlite::types::Null.to_sql(),
        }
    }
}

type SqlArgs = Vec<Arg>;

pub fn build(q: &Query) -> (String, String, SqlArgs) {
    let mut where_parts: Vec<String> = vec![format!("trash = {}", (*q.trash) as i64)];
    let mut args: SqlArgs = vec![];

    if let Some(folder_id) = &q.folder_id {
        where_parts.push("folder_id = ?".into());
        args.push(Arg::S(folder_id.clone()));
    }
    if !q.folder_ids.is_empty() {
        let ph = q.folder_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        where_parts.push(format!("folder_id IN ({ph})"));
        for id in &q.folder_ids {
            args.push(Arg::S(id.clone()));
        }
    }
    if let Some(tag) = &q.tag {
        where_parts.push("id IN (SELECT it.item_id FROM item_tags it WHERE it.tag_id = ?)".into());
        args.push(Arg::S(tag.clone()));
    }
    // 否定标签：排除含任一 not_tags 的条目（0 值/空集不产生条件）
    if !q.not_tags.0.is_empty() {
        let ph = q.not_tags.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        where_parts.push(format!("id NOT IN (SELECT it.item_id FROM item_tags it WHERE it.tag_id IN ({ph}))"));
        for t in q.not_tags.0.iter() {
            args.push(Arg::S(t.clone()));
        }
    }
    if !q.kinds.0.is_empty() {
        let ph = q.kinds.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        where_parts.push(format!("kind IN ({ph})"));
        for k in q.kinds.0.iter() {
            args.push(Arg::S(k.clone()));
        }
    }
    if !q.exts.0.is_empty() {
        let ph = q.exts.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        where_parts.push(format!("ext IN ({ph})"));
        for e in q.exts.0.iter() {
            args.push(Arg::S(e.clone()));
        }
    }
    // 日期区间（毫秒时间戳，含边界）：0/负值视为未设界，不产生条件
    if q.added_from.0 > 0 {
        where_parts.push("added_at >= ?".into());
        args.push(Arg::I(q.added_from.0));
    }
    if q.added_to.0 > 0 {
        where_parts.push("added_at <= ?".into());
        args.push(Arg::I(q.added_to.0));
    }
    if q.created_from.0 > 0 {
        where_parts.push("created_at >= ?".into());
        args.push(Arg::I(q.created_from.0));
    }
    if q.created_to.0 > 0 {
        where_parts.push("created_at <= ?".into());
        args.push(Arg::I(q.created_to.0));
    }
    if q.rating_min.0 > 0 {
        where_parts.push("rating >= ?".into());
        args.push(Arg::I(q.rating_min.0));
    }
    // 评分上限：>0 才生效；≥5 等价「全部」，不产生条件（保持旧行为）
    if q.rating_max.0 > 0 && q.rating_max.0 < 5 {
        where_parts.push("rating <= ?".into());
        args.push(Arg::I(q.rating_max.0));
    }
    if let Some(hex) = &q.color {
        let rgb = parse_hex_color(hex).unwrap_or((128, 128, 128));
        let (r, g, b) = rgb;
        let tol = (q.color_tolerance.0.max(1)) * 3;
        where_parts.push(format!(
            "r IS NOT NULL AND ((r - {r}) * (r - {r}) * 2 + (g - {g}) * (g - {g}) * 4 + (b - {b}) * (b - {b})) < {tol}"
        ));
    }
    if let Some(s) = &q.q {
        let like = format!("%{}%", s.to_lowercase());
        where_parts.push(
            "(lower(name) LIKE ? OR lower(note) LIKE ? OR id IN
              (SELECT it.item_id FROM item_tags it WHERE it.tag_id LIKE ?))"
                .to_string(),
        );
        args.push(Arg::S(like.clone()));
        args.push(Arg::S(like.clone()));
        args.push(Arg::S(like));
    }
    if *q.untagged {
        where_parts.push("id NOT IN (SELECT item_id FROM item_tags)".into());
    }
    if *q.unfiled {
        where_parts.push("folder_id IS NULL".into());
    }

    let where_clause = where_parts.join(" AND ");
    let count_sql = format!("SELECT COUNT(*) FROM items WHERE {where_clause}");

    let order = match q.sort.as_deref().unwrap_or("addedAt") {
        "random" => {
            // 对 (rowid, seed) 做乘法混合，保证小数据集也能充分洗牌
            let s = q.seed.0.rem_euclid(999999937); // 大素数模
            format!("ORDER BY (((rowid + {s}) * 2654435761) % 4294967296), id")
        }
        s => {
            let col = sanitize_sort(s).unwrap_or("added_at");
            format!("ORDER BY {col} {}, id", if *q.asc { "ASC" } else { "DESC" })
        }
    };
    let limit = if q.limit.0 <= 0 { 200 } else { q.limit.0.min(2000) };
    let sql = format!(
        "SELECT {ITEM_COLS} FROM items WHERE {where_clause} {order} LIMIT {limit} OFFSET {}",
        q.offset.0.max(0)
    );
    (sql, count_sql, args)
}

pub fn item_ids(items: &[Item]) -> Vec<String> {
    items.iter().map(|i| i.id.clone()).collect()
}

/// 解析 `#rgb` / `#rrggbb` / `rgb(r,g,b)`
pub fn parse_hex_color(s: &str) -> Option<(i64, i64, i64)> {
    let s = s.trim().trim_start_matches('#');
    if let Some(hex) = s.strip_prefix("rgb(").map(|_| s) {
        let _ = hex;
    }
    if s.starts_with("rgb(") {
        let inner: Vec<i64> = s
            .trim_start_matches("rgb(")
            .trim_end_matches(')')
            .split(',')
            .filter_map(|v| v.trim().parse().ok())
            .collect();
        if inner.len() == 3 {
            return Some((inner[0], inner[1], inner[2]));
        }
        return None;
    }
    let hex: Vec<char> = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    match hex.len() {
        3 => {
            let v: Vec<i64> = hex.iter().filter_map(|c| c.to_digit(16).map(|d| (d as i64) * 17)).collect();
            Some((v[0], v[1], v[2]))
        }
        6 => {
            let pairs: Vec<String> = (0..3).map(|i| hex[i * 2..i * 2 + 2].iter().collect()).collect();
            let v: Vec<i64> = pairs.iter().filter_map(|p| i64::from_str_radix(p, 16).ok()).collect();
            if v.len() == 3 {
                Some((v[0], v[1], v[2]))
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    /// 模拟旧库 smart_folders.query 原始 JSON 直接落库再读出的完整链路（不迁移不报错）
    #[test]
    fn legacy_smart_folder_json_roundtrip_without_migration() {
        // 旧版前端保存的 query（无新字段、含当时的前端全量字段）
        let legacy = serde_json::json!({
            "folderId": null, "recursive": true, "tag": null, "kinds": [],
            "ratingMin": 0, "color": null, "colorTolerance": 40, "q": "",
            "trash": false, "smartId": "sf_123", "untagged": false, "unfiled": false
        });
        let q: Query = serde_json::from_value(legacy).expect("旧库 JSON 应直接解析成功");
        // 注意：旧前端会保存 "q": ""（Some 空串），build() 会产生一个 LIKE '%%' 参数（匹配全部），
        // 行为与旧版完全一致——这里只验证解析层中性
        assert_eq!(q, Query::default());
        assert_eq!(q.q.as_deref(), Some(""));

        // 未来版本字段（本版本不认识）→ 同样忽略
        let q: Query =
            serde_json::from_value(serde_json::json!({ "ratingMin": 4, "semantic": "cliip", "model": "v99" })).unwrap();
        assert_eq!(q.rating_min.0, 4);
    }

    #[test]
    fn loose_int_accepts_strings_and_numbers() {
        #[derive(Deserialize)]
        struct W {
            #[serde(default)]
            v: LooseInt,
        }
        let w: W = serde_json::from_str(r#"{"v": "42"}"#).unwrap();
        assert_eq!(w.v.0, 42);
        let w: W = serde_json::from_str(r#"{"v": 7}"#).unwrap();
        assert_eq!(w.v.0, 7);
        let w: W = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(w.v.0, 0);
        // 非数字字符串应报错而不是静默为 0
        assert!(serde_json::from_str::<W>(r#"{"v": "abc"}"#).is_err());
    }

    #[test]
    fn loose_bool_accepts_common_forms() {
        #[derive(Deserialize)]
        struct W {
            #[serde(default)]
            v: LooseBool,
        }
        for (src, want) in [
            (r#"{"v": true}"#, true),
            (r#"{"v": "true"}"#, true),
            (r#"{"v": "1"}"#, true),
            (r#"{"v": "yes"}"#, true),
            (r#"{"v": false}"#, false),
            (r#"{"v": "0"}"#, false),
            (r#"{"v": ""}"#, false),
        ] {
            let w: W = serde_json::from_str(src).unwrap();
            assert_eq!(*w.v, want, "src={src}");
        }
    }

    #[test]
    fn loose_vec_splits_csv_and_lists() {
        #[derive(Deserialize)]
        struct W {
            #[serde(default)]
            v: LooseVec,
        }
        let w: W = serde_json::from_str(r#"{"v": "image,video"}"#).unwrap();
        assert_eq!(w.v.0, vec!["image", "video"]);
        let w: W = serde_json::from_str(r#"{"v": ["image","video"]}"#).unwrap();
        assert_eq!(w.v.0, vec!["image", "video"]);
        let w: W = serde_json::from_str(r#"{}"#).unwrap();
        assert!(w.v.0.is_empty());
    }

    #[test]
    fn parse_hex_color_variants() {
        assert_eq!(parse_hex_color("#ffffff"), Some((255, 255, 255)));
        assert_eq!(parse_hex_color("#000"), Some((0, 0, 0)));
        assert_eq!(parse_hex_color("ff0000"), Some((255, 0, 0)));
        assert_eq!(parse_hex_color("rgb(10, 20, 30)"), Some((10, 20, 30)));
        assert_eq!(parse_hex_color("rgb(1,2)"), None);
        assert_eq!(parse_hex_color("xyz"), None);
    }

    #[test]
    fn sanitize_sort_whitelists_columns() {
        assert_eq!(sanitize_sort("addedAt"), Some("added_at"));
        assert_eq!(sanitize_sort("rating"), Some("rating"));
        assert_eq!(sanitize_sort("1; DROP TABLE items"), None);
    }

    #[test]
    fn build_produces_parameterized_sql() {
        let q = Query {
            tag: Some("a".into()),
            rating_min: LooseInt(2),
            q: Some("cat".into()),
            ..Default::default()
        };
        let (sql, count_sql, args) = build(&q);
        // tag=1 + rating_min=1 + 搜索词 3 处（name/note/tag LIKE）= 5
        assert_eq!(args.len(), 5);
        assert_eq!(count_sql.matches("?").count(), args.len());
        assert!(sql.contains("ORDER BY"));
        assert!(sql.contains("LIMIT"));
        assert!(!sql.to_lowercase().contains("drop table"));
    }

    // ---------- 组合逻辑真值表：每个独立条件要么进 WHERE 要么不进，参数按序对齐 ----------

    /// 所有条件都缺席（空集）：只应剩 trash 基线条件，零参数
    #[test]
    fn build_empty_query_only_trash_baseline() {
        let (sql, count_sql, args) = build(&Query::default());
        assert_eq!(args.len(), 0);
        assert_eq!(count_sql.matches("?").count(), 0);
        assert_eq!(count_sql, "SELECT COUNT(*) FROM items WHERE trash = 0");
        assert!(!sql.contains("NOT IN"));
        assert!(!sql.contains("rating"));
        assert!(!sql.contains("added_at >="));
    }

    /// 单条件逐个开启 → 恰好一个 WHERE 片段；带参片段参数数恰好对齐（真值表逐行验证）
    #[test]
    fn build_each_condition_contributes_exactly_one_clause() {
        // (查询, 期望 SQL 片段, 期望参数个数)
        let cases: Vec<(Query, &str, usize)> = vec![
            (
                Query { tag: Some("t".into()), ..Default::default() },
                "id IN (SELECT it.item_id",
                1,
            ),
            (
                Query { not_tags: LooseVec(vec!["x".into()]), ..Default::default() },
                "id NOT IN (SELECT it.item_id",
                1,
            ),
            (Query { rating_min: LooseInt(1), ..Default::default() }, "rating >= ?", 1),
            (Query { rating_max: LooseInt(4), ..Default::default() }, "rating <= ?", 1),
            (Query { added_from: LooseInt(1000), ..Default::default() }, "added_at >= ?", 1),
            (Query { added_to: LooseInt(2000), ..Default::default() }, "added_at <= ?", 1),
            (Query { created_from: LooseInt(1000), ..Default::default() }, "created_at >= ?", 1),
            (Query { created_to: LooseInt(2000), ..Default::default() }, "created_at <= ?", 1),
            // 子查询存在性条件无绑定参数
            (Query { untagged: LooseBool(true), ..Default::default() }, "id NOT IN (SELECT item_id", 0),
            (Query { unfiled: LooseBool(true), ..Default::default() }, "folder_id IS NULL", 0),
        ];
        for (q, fragment, want_args) in cases {
            let (sql, count_sql, args) = build(&q);
            assert!(sql.contains(fragment), "SQL 缺少片段 {fragment}: {sql}");
            assert_eq!(args.len(), want_args, "片段 {fragment} 参数数不符");
            assert_eq!(count_sql.matches("?").count(), args.len(), "片段 {fragment} 参数数不齐");
        }
    }

    /// 评分边界值真值表：min/max 各 0..=6，验证条件是否出现及比较方向
    #[test]
    fn build_rating_boundaries_truth_table() {
        // min: 0 → 无下界；1..=5 → >=；min > max 仍生成两个条件（交集为空集是合法语义）
        for (min, want_ge) in [(0i64, false), (1, true), (3, true), (5, true), (6, true)] {
            let (sql, _, args) = build(&Query { rating_min: LooseInt(min), ..Default::default() });
            assert_eq!(sql.contains("rating >="), want_ge, "min={min}");
            assert_eq!(args.len(), if want_ge { 1 } else { 0 });
        }
        // max: 0/缺失 → 无上界（旧行为）；1..=4 → <=；5 → 无上界（等价全部）；>5 → 无上界
        for (max, want_le) in [(0i64, false), (1, true), (4, true), (5, false), (6, false)] {
            let (sql, _, args) = build(&Query { rating_max: LooseInt(max), ..Default::default() });
            assert_eq!(sql.contains("rating <="), want_le, "max={max}");
            assert_eq!(args.len(), if want_le { 1 } else { 0 });
        }
        // min=3 且 max=4 同时生效 → 区间查询，两参数按序
        let (sql, _, args) = build(&Query {
            rating_min: LooseInt(3),
            rating_max: LooseInt(4),
            ..Default::default()
        });
        assert!(sql.contains("rating >= ?") && sql.contains("rating <= ?"));
        assert_eq!(args.len(), 2);
    }

    /// 日期区间边界值：0 不设界、负数不设界、正数含边界（>=/<= 双侧）
    #[test]
    fn build_date_range_boundaries() {
        // 0 = 未设界
        let (sql, _, args) = build(&Query::default());
        assert!(!sql.contains("added_at >=") && !sql.contains("created_at <="));
        assert_eq!(args.len(), 0);
        // 负值同样不设界（宽松解析容错）
        let (sql, _, _) = build(&Query { added_from: LooseInt(-5), created_to: LooseInt(-1), ..Default::default() });
        assert!(!sql.contains("added_at >=") && !sql.contains("created_at <="));
        // 闭区间双侧同时出现，参数按 from/to 顺序
        let t0 = 1_700_000_000_000i64;
        let t1 = 1_700_000_100_000i64;
        let (sql, count_sql, args) = build(&Query {
            added_from: LooseInt(t0),
            added_to: LooseInt(t1),
            ..Default::default()
        });
        assert!(sql.contains("added_at >= ?") && sql.contains("added_at <= ?"));
        assert_eq!(args.len(), 2);
        assert_eq!(count_sql.matches("?").count(), 2);
        // 同区间用在 created_at
        let (sql, _, _) = build(&Query {
            created_from: LooseInt(t0),
            created_to: LooseInt(t1),
            ..Default::default()
        });
        assert!(sql.contains("created_at >= ?") && sql.contains("created_at <= ?"));
        assert!(!sql.contains("added_at >="));
    }

    /// 多条件组合：全部条件叠加时片段齐全、参数计数严格对齐（AND 语义）
    #[test]
    fn build_combined_conditions_all_parts_aligned() {
        let q = Query {
            tag: Some("keep".into()),
            not_tags: LooseVec(vec!["spam".into(), "draft".into()]),
            kinds: LooseVec(vec!["image".into()]),
            exts: LooseVec(vec!["png".into()]),
            rating_min: LooseInt(2),
            rating_max: LooseInt(4),
            added_from: LooseInt(1_700_000_000_000),
            added_to: LooseInt(1_700_000_100_000),
            created_from: LooseInt(1_600_000_000_000),
            created_to: LooseInt(1_600_000_100_000),
            untagged: LooseBool(false),
            unfiled: LooseBool(false),
            q: Some("cat".into()),
            ..Default::default()
        };
        let (sql, count_sql, args) = build(&q);
        for fragment in [
            "id IN (SELECT it.item_id FROM item_tags it WHERE it.tag_id = ?",
            "id NOT IN (SELECT it.item_id FROM item_tags it WHERE it.tag_id IN (?,?)",
            "kind IN (?)",
            "ext IN (?)",
            "rating >= ?",
            "rating <= ?",
            "added_at >= ?",
            "added_at <= ?",
            "created_at >= ?",
            "created_at <= ?",
            "lower(name) LIKE ?",
        ] {
            assert!(sql.contains(fragment), "缺片段 {fragment}: {sql}");
        }
        // tag1 + not_tags2 + kinds1 + exts1 + rating2 + added2 + created2 + 搜索3 = 14
        assert_eq!(args.len(), 14);
        assert_eq!(count_sql.matches("?").count(), 14);
        assert_eq!(count_sql.matches(" AND ").count(), 11); // 12 个条件片段（含 trash 基线）11 个连接符
    }

    /// 否定标签边界：空列表 / 空字符串过滤后为空 → 不产生条件
    #[test]
    fn build_not_tags_empty_produces_no_clause() {
        let (sql, _, args) = build(&Query { not_tags: LooseVec(vec![]), ..Default::default() });
        assert!(!sql.contains("NOT IN (SELECT it.item_id"));
        assert_eq!(args.len(), 0);
        // CSV 全空 → LooseVec 过滤后为空集
        let (sql, _, args) = build(&Query { not_tags: LooseVec(vec!["".into(), " ".into()]), ..Default::default() });
        assert!(!sql.contains("NOT IN (SELECT it.item_id"));
        assert_eq!(args.len(), 0);
    }

    /// 向后兼容：旧库智能文件夹 JSON（无新字段）+ 未知字段混合，解析不报错、未知字段忽略
    #[test]
    fn query_deserialize_backward_compatible_and_ignores_unknown_fields() {
        // 1. 旧版完整 JSON：只有老字段，缺省新字段 → 不报错且为中性值
        let legacy = r#"{
            "folderId": null, "folderIds": [], "tag": "收藏", "kinds": ["image"],
            "exts": "png,jpg", "ratingMin": 2, "ratingMax": 0, "color": null,
            "colorTolerance": 40, "q": "cat", "trash": false, "untagged": false,
            "unfiled": false, "sort": "addedAt", "asc": false, "offset": 0,
            "limit": 200, "seed": 42
        }"#;
        let q: Query = serde_json::from_str(legacy).expect("旧版 JSON 应解析成功");
        assert_eq!(q.tag.as_deref(), Some("收藏"));
        assert_eq!(q.rating_min.0, 2);
        assert!(q.not_tags.0.is_empty());
        assert_eq!(q.added_from.0, 0);
        assert_eq!(q.added_to.0, 0);
        assert_eq!(q.created_from.0, 0);
        assert_eq!(q.created_to.0, 0);
        // 中性值 → 不产生新条件（老查询行为完全不变）
        let (sql, _, _) = build(&q);
        assert!(!sql.contains("NOT IN (SELECT it.item_id"));
        assert!(!sql.contains("added_at >="));
        assert!(!sql.contains("created_at <="));

        // 2. 含未知字段（未来版本写入）→ 忽略不报错
        let futuristic = r#"{"tag":"a","ratingMin":"3","orGroups":[{"tags":["x"]}],"fuzzyScore":0.9}"#;
        let q: Query = serde_json::from_str(futuristic).expect("未知字段应被忽略");
        assert_eq!(q.tag.as_deref(), Some("a"));
        assert_eq!(q.rating_min.0, 3); // LooseInt 兼容字符串数字

        // 3. 新字段宽松解析：毫秒时间戳可为字符串，notTags 可为 CSV
        let mixed = r#"{"notTags":"水印,草稿","addedFrom":"1700000000000","addedTo":1700001000000}"#;
        let q: Query = serde_json::from_str(mixed).expect("宽松类型应解析成功");
        assert_eq!(q.not_tags.0, vec!["水印", "草稿"]);
        assert_eq!(q.added_from.0, 1_700_000_000_000);
        assert_eq!(q.added_to.0, 1_700_000_100_000);

        // 4. 空 JSON / null 字段 → 全默认（LooseInt/LooseBool/LooseVec 均容忍 null）
        let q: Query = serde_json::from_str("{}").unwrap();
        assert_eq!(q, Query::default());
        let q: Query = serde_json::from_str(r#"{"tag":null,"notTags":null,"addedFrom":null,"addedTo":null,"createdFrom":null,"createdTo":null,"ratingMin":null,"ratingMax":null,"kinds":null,"trash":null}"#).unwrap();
        assert_eq!(q, Query::default());
    }
}
