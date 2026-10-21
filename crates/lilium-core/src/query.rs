use crate::model::Item;

/// 宽松整数：兼容 query string 里的字符串数字
#[derive(Debug, Clone, Copy, Default)]
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
#[derive(Debug, Clone, Default)]
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

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    /// 精确单文件夹
    pub folder_id: Option<String>,
    /// 递归时由调用方展开的全部 folder id（含子级）
    pub folder_ids: Vec<String>,
    pub tag: Option<String>,
    #[serde(default)]
    pub kinds: LooseVec,
    #[serde(default)]
    pub exts: LooseVec,
    pub rating_min: LooseInt,
    pub rating_max: LooseInt,
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
    if q.rating_min.0 > 0 {
        where_parts.push("rating >= ?".into());
        args.push(Arg::I(q.rating_min.0));
    }
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
