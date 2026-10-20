use std::path::{Path, PathBuf};

use image::GenericImageView;

const THUMB_SIZE: u32 = 640;

/// 生成缩略图到 out_dir/{id}.png|jpg|svg，返回路径
pub fn generate_thumbnail(file: &Path, id: &str, out_dir: &Path) -> Result<PathBuf, anyhow::Error> {
    std::fs::create_dir_all(out_dir)?;
    let ext = file
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let _ = ext;

    // SVG：直接复制原图作为缩略图
    if file.extension().map(|e| e.to_string_lossy().to_lowercase() == "svg").unwrap_or(false) {
        let dest = out_dir.join(format!("{id}.svg"));
        std::fs::copy(file, &dest)?;
        return Ok(dest);
    }

    // 视频尝试 ffmpeg 抓帧
    if crate::meta::kind_of(
        file.extension().map(|e| e.to_string_lossy().to_string()).as_deref().unwrap_or(""),
    ) == "video"
    {
        if let Some(bytes) = crate::meta::video_poster(file) {
            let dest = out_dir.join(format!("{id}.jpg"));
            std::fs::write(&dest, &bytes)?;
            shrink_bytes(&bytes, &dest, 92)?;
            return Ok(dest);
        }
        return Err(anyhow::anyhow!("无法生成视频缩略图（需要 ffmpeg）"));
    }

    let img = crate::meta::decode_image(file)?;
    let thumb = shrink_image(&img, THUMB_SIZE);
    // 有 alpha 通道存 PNG，否则 JPEG（更小）
    let has_alpha = img.color().has_alpha()
        && match &img {
            image::DynamicImage::ImageRgba8(rgba) => rgba.pixels().any(|p| p.0[3] < 255),
            image::DynamicImage::ImageRgba16(_) => true,
            _ => false,
        };
    let dest = if has_alpha {
        out_dir.join(format!("{id}.png"))
    } else {
        out_dir.join(format!("{id}.jpg"))
    };
    save(&thumb, &dest, 88)?;
    Ok(dest)
}

pub fn shrink_image(img: &image::DynamicImage, max: u32) -> image::DynamicImage {
    let (w, h) = img.dimensions();
    if w <= max && h <= max {
        return img.clone();
    }
    let ratio = (max as f64 / w.max(h) as f64).min(1.0);
    let nw = ((w as f64) * ratio).round() as u32;
    let nh = ((h as f64) * ratio).round() as u32;
    img.resize(nw, nh, image::imageops::FilterType::Triangle)
}

fn shrink_bytes(bytes: &[u8], dest: &Path, quality: u8) -> Result<(), anyhow::Error> {
    let img = image::load_from_memory(bytes)?;
    let thumb = shrink_image(&img, THUMB_SIZE);
    save(&thumb, dest, quality)
}

pub fn save(img: &image::DynamicImage, dest: &Path, quality: u8) -> Result<(), anyhow::Error> {
    match dest.extension().and_then(|e| e.to_str()) {
        Some("png") => img.save_with_format(dest, image::ImageFormat::Png)?,
        _ => {
            let rgb = img.to_rgb8();
            let mut out = Vec::new();
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
            enc.encode(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)?;
            std::fs::write(dest, out)?;
        }
    }
    Ok(())
}
