//! 生成示例图片（各种尺寸/比例/颜色），用于测试与演示
use image::{Rgba, RgbaImage, ImageFormat};
use std::path::PathBuf;

fn gradient(name: &str, w: u32, h: u32, base: [u8; 3], accent: [u8; 3], out: &std::path::Path) {
    let mut img = RgbaImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let t = (x as f32 / w.max(1) as f32 * 0.7 + y as f32 / h.max(1) as f32 * 0.3).clamp(0.0, 1.0);
            let r = base[0] as f32 * (1.0 - t) + accent[0] as f32 * t;
            let g = base[1] as f32 * (1.0 - t) + accent[1] as f32 * t;
            let b = base[2] as f32 * (1.0 - t) + accent[2] as f32 * t;
            // 加一点圆形图案增加趣味
            let cx = w as f32 * 0.5;
            let cy = h as f32 * 0.5;
            let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            let ring = (d as i64 - (w.min(h) as i64) / 4).abs() < 8;
            let (r, g, b) = if ring { (255.0, 255.0, 255.0) } else { (r, g, b) };
            *img.get_pixel_mut(x, y) = Rgba([r as u8, g as u8, b as u8, 255]);
        }
    }
    let path = out.join(name);
    img.save_with_format(&path, ImageFormat::Png).unwrap();
    println!("生成 {}", path.display());
}

fn main() {
    let out = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("sample-images"));
    std::fs::create_dir_all(&out).unwrap();
    let cases: &[(&str, u32, u32, [u8; 3], [u8; 3])] = &[
        ("wide-landscape.png", 1600, 900, [66, 133, 244], [255, 214, 102]),
        ("tall-portrait.png", 800, 1400, [234, 67, 53], [255, 255, 255]),
        ("square.png", 1000, 1000, [52, 168, 83], [17, 19, 35]),
        ("ultra-wide.png", 1920, 640, [130, 80, 223], [250, 250, 250]),
        ("small-icon.png", 256, 256, [255, 145, 0], [40, 40, 40]),
        ("banner.png", 1800, 500, [0, 168, 181], [24, 32, 56]),
        ("photo-43.png", 1200, 900, [180, 60, 120], [30, 30, 60]),
        ("photo-916.png", 900, 1600, [90, 200, 250], [255, 130, 80]),
    ];
    for (name, w, h, base, accent) in cases {
        gradient(name, *w, *h, *base, *accent, &out);
    }
    println!("完成！共 {} 张图片 → {}", cases.len(), out.display());
}
