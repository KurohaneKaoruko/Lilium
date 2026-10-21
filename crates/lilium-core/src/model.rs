use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub ext: String,
    pub kind: String,
    pub size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration: Option<f64>,
    pub rating: i64,
    pub note: String,
    pub url: String,
    pub folder_id: Option<String>,
    pub trash: bool,
    pub added_at: i64,
    pub created_at: i64,
    pub thumb: i32,
    pub r: Option<i64>,
    pub g: Option<i64>,
    pub b: Option<i64>,
    pub palette: Value,
    pub tags: Vec<String>,
    #[serde(skip_serializing)]
    pub hash: Option<String>,
    #[serde(skip_serializing)]
    pub phash: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetail {
    #[serde(flatten)]
    pub item: Item,
    pub exif: Value,
    pub hash: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub position: i64,
    /// 封面条目（最新加入的一张，无条目时为 None）
    #[serde(default)]
    pub cover_item_id: Option<String>,
    #[serde(default)]
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Tag {
    pub name: String,
    pub color: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub query: Value,
    pub position: i64,
}

pub fn item_from_row(row: &rusqlite::Row) -> rusqlite::Result<Item> {
    let palette: Option<String> = row.get("palette")?;
    Ok(Item {
        id: row.get("id")?,
        name: row.get("name")?,
        ext: row.get("ext")?,
        kind: row.get("kind")?,
        size: row.get("size")?,
        width: row.get("width")?,
        height: row.get("height")?,
        duration: row.get("duration")?,
        rating: row.get("rating")?,
        note: row.get("note")?,
        url: row.get("url")?,
        folder_id: row.get("folder_id")?,
        trash: row.get::<_, i64>("trash")? != 0,
        added_at: row.get("added_at")?,
        created_at: row.get("created_at")?,
        thumb: row.get("thumb")?,
        r: row.get("r")?,
        g: row.get("g")?,
        b: row.get("b")?,
        palette: palette
            .and_then(|p| serde_json::from_str(&p).ok())
            .unwrap_or(Value::Null),
        tags: Vec::new(),
        hash: row.get("hash")?,
        phash: row.get("phash")?,
    })
}

pub fn folder_from_row(row: &rusqlite::Row) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get("id")?,
        parent_id: row.get("parent_id")?,
        name: row.get("name")?,
        position: row.get("position")?,
        cover_item_id: row.get("cover_item_id").ok().flatten(),
        item_count: row.get("item_count").unwrap_or(0),
    })
}
