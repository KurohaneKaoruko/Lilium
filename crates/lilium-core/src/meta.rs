use anyhow::{anyhow, Context};
use image::DynamicImage;
use std::path::Path;
use std::sync::OnceLock;

pub fn kind_of(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tiff" | "tif" | "avif" | "svg" => "image",
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "wmv" | "flv" | "mpg" | "mpeg" => "video",
        "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "opus" => "audio",
        "ttf" | "otf" | "woff" | "woff2" | "ttc" | "eot" => "font",
        "txt" | "md" | "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "epub" => "document",
        _ => "other",
    }
}

/// 尝试解码图片尺寸；失败返回 None
pub fn image_dimensions(path: &Path) -> Option<(u32, u32)> {
    if path.extension()?.to_string_lossy().to_lowercase() == "svg" {
        return svg_dimensions(path);
    }
    image::image_dimensions(path).ok()
}

fn svg_dimensions(path: &Path) -> Option<(u32, u32)> {
    let text = std::fs::read_to_string(path).ok()?;
    let w = extract_svg_num(&text, "width");
    let h = extract_svg_num(&text, "height");
    match (w, h) {
        (Some(w), Some(h)) => Some((w, h)),
        _ => {
            // viewBox="0 0 w h"
            let i = text.find("viewBox")?;
            let rest = &text[i..];
            let nums: Vec<f64> = rest
                .split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
                .filter_map(|s| s.parse::<f64>().ok())
                .collect();
            if nums.len() >= 4 {
                Some((nums[2] as u32, nums[3] as u32))
            } else {
                None
            }
        }
    }
}

fn extract_svg_num(text: &str, attr: &str) -> Option<u32> {
    let pat = format!("{attr}=\"");
    let i = text.find(&pat)? + pat.len();
    let rest = &text[i..];
    let end = rest.find('"')?;
    let s = &rest[..end];
    if s.contains('%') {
        return None;
    }
    let num: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    num.parse::<f64>().ok().map(|v| v as u32)
}

pub fn decode_image(path: &Path) -> Result<DynamicImage, anyhow::Error> {
    let img = image::ImageReader::open(path)?
        .with_guessed_format()?
        .decode()?;
    Ok(img)
}

/// 视频元数据：优先 ffprobe（若 PATH 中存在）
pub fn video_meta(path: &Path) -> Option<(i64, f64, Vec<u8>)> {
    let out = std::process::Command::new("ffprobe")
        .args([
            "-v", "quiet", "-print_format", "json",
            "-show_streams", "-show_format",
            path.to_str()?,
        ])
        .output()
        .ok()?;
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let streams = v.get("streams")?.as_array()?;
    let vs = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("video"))?;
    let w = vs.get("width")?.as_i64()?;
    let h = vs.get("height")?.as_i64()?;
    let dur = v
        .pointer("/format/duration")
        .and_then(|d| d.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    Some((w * 1000 + h, dur, vec![]))
}

static FFMPEG_AVAILABLE: OnceLock<bool> = OnceLock::new();
pub fn ffmpeg_available() -> bool {
    *FFMPEG_AVAILABLE.get_or_init(|| {
        std::process::Command::new("ffmpeg")
            .arg("-version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

/// 从视频中抓取海报帧字节（jpeg）
pub fn video_poster(path: &Path) -> Option<Vec<u8>> {
    if !ffmpeg_available() {
        return None;
    }
    let out = std::process::Command::new("ffmpeg")
        .args([
            "-y", "-v", "quiet", "-ss", "1", "-i",
            path.to_str()?, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
        ])
        .output()
        .ok()?;
    if out.stdout.is_empty() {
        return None;
    }
    Some(out.stdout)
}

/// EXIF 提取（图片），返回 json
pub fn exif_json(path: &Path) -> Option<serde_json::Value> {
    use exif::Tag;
    let file = std::fs::File::open(path).ok()?;
    let mut bufreader = std::io::BufReader::new(file);
    let exifreader = exif::Reader::new();
    let exif = exifreader.read_from_container(&mut bufreader).ok()?;
    let mut map = serde_json::Map::new();
    const WANT: &[(Tag, &str)] = &[
        (Tag::DateTimeOriginal, "DateTimeOriginal"),
        (Tag::Make, "Make"),
        (Tag::Model, "Model"),
        (Tag::LensMake, "LensMake"),
        (Tag::LensModel, "LensModel"),
        (Tag::ISOSpeed, "ISO"),
        (Tag::FNumber, "FNumber"),
        (Tag::ExposureTime, "ExposureTime"),
        (Tag::FocalLength, "FocalLength"),
        (Tag::Flash, "Flash"),
        (Tag::WhiteBalance, "WhiteBalance"),
        (Tag::FocalLengthIn35mmFilm, "FocalLengthIn35mmFilm"),
        (Tag::GPSLatitude, "GPSLatitude"),
        (Tag::GPSLongitude, "GPSLongitude"),
        (Tag::Software, "Software"),
    ];
    for (tag, name) in WANT {
        if let Some(f) = exif.get_field(*tag, exif::In::PRIMARY) {
            let val = f.display_value().to_string();
            let val = val.trim_matches('"').to_string();
            if !val.is_empty() {
                map.insert(name.to_string(), serde_json::Value::String(val));
            }
        }
    }
    if map.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(map))
    }
}

/// EXIF 拍摄时间（毫秒时间戳），失败退回文件 mtime
pub fn exif_date_or_mtime(path: &Path) -> i64 {
    if let Ok(mtime) = std::fs::metadata(path).and_then(|m| m.modified()) {
        if let Ok(d) = mtime.duration_since(std::time::UNIX_EPOCH) {
            return d.as_millis() as i64;
        }
    }
    0
}

pub fn human_size(bytes: i64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = bytes as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{bytes} B")
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

/// 扩展名 → MIME
pub fn mime_of(ext: &str) -> &'static str {
    let mime = mime_guess::MimeGuess::from_ext(ext).first_or_octet_stream();
    let owned: String = mime.essence_str().to_string();
    Box::leak(owned.into_boxed_str())
}

/// 从错误中获得上下文
pub trait ContextExt<T> {
    fn ctx(self, s: &str) -> anyhow::Result<T>;
}
impl<T> ContextExt<T> for anyhow::Result<T> {
    fn ctx(self, s: &str) -> anyhow::Result<T> {
        self.context(s.to_string())
    }
}

pub fn ensure(v: bool, msg: &str) -> Result<(), anyhow::Error> {
    if v { Ok(()) } else { Err(anyhow!(msg.to_string())) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_of_covers_main_types() {
        assert_eq!(kind_of("PNG"), "image");
        assert_eq!(kind_of("jpg"), "image");
        assert_eq!(kind_of("svg"), "image");
        assert_eq!(kind_of("MP4"), "video");
        assert_eq!(kind_of("mkv"), "video");
        assert_eq!(kind_of("mp3"), "audio");
        assert_eq!(kind_of("ttf"), "font");
        assert_eq!(kind_of("pdf"), "document");
        assert_eq!(kind_of("xyz"), "other");
        assert_eq!(kind_of(""), "other");
    }

    #[test]
    fn image_dimensions_reads_png_and_rejects_garbage() {
        let dir = std::env::temp_dir().join(format!("lilium-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.png");
        image::RgbaImage::from_pixel(7, 13, image::Rgba([1, 2, 3, 255]))
            .save_with_format(&p, image::ImageFormat::Png)
            .unwrap();
        assert_eq!(image_dimensions(&p), Some((7, 13)));
        let bad = dir.join("bad.png");
        std::fs::write(&bad, b"not an image").unwrap();
        assert_eq!(image_dimensions(&bad), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn svg_dimensions_handles_width_height_and_viewbox() {
        let dir = std::env::temp_dir().join(format!("lilium-svg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.svg");
        std::fs::write(&a, r#"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"></svg>"#).unwrap();
        assert_eq!(svg_dimensions(&a), Some((320, 200)));
        // 百分比尺寸 → 回落 viewBox
        let b = dir.join("b.svg");
        std::fs::write(&b, r#"<svg width="100%" height="100%" viewBox="0 0 640 480"></svg>"#).unwrap();
        assert_eq!(svg_dimensions(&b), Some((640, 480)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mime_of_maps_common_exts() {
        assert_eq!(mime_of("png"), "image/png");
        assert_eq!(mime_of("jpg"), "image/jpeg");
        assert_eq!(mime_of("mp4"), "video/mp4");
        assert_eq!(mime_of("unknownext"), "application/octet-stream");
    }

    #[test]
    fn decode_rejects_garbage() {
        let dir = std::env::temp_dir().join(format!("lilium-decode-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bad = dir.join("bad.png");
        std::fs::write(&bad, b"not an image").unwrap();
        assert!(decode_image(&bad).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
