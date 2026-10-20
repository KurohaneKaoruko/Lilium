# 🌸 Lilium

本地优先的图片 / 素材管理工具 —— 参考 Eagle 的完整功能集，并加入独特的**无限视图**。

> 一套 Rust 核心，三种形态：**桌面端 (Tauri 2)** · **自托管 Web 服务端** · **Docker 部署**

## ✨ 核心特性

### 无限视图
所有图片平铺在一张无限画布上，按图片纵横比错落有致地拼贴成封面墙：
- 向**上下左右任意方向**自由拖拽平移，滚轮以光标为中心缩放
- 布局按需生成（环形生长算法），数万张图片依然流畅
- Shift+拖拽框选、双击大图预览、点阵背景随视差移动

### Eagle 完整功能集
- 📁 **嵌套文件夹** + 📌 **智能文件夹**（保存搜索条件）
- 🏷️ **标签系统**（彩色标签、计数、批量打标）
- ⭐ 评分（0–5 星）、📝 注释、🔗 来源 URL
- 🎨 **主色 / 调色板提取**（k-means），按颜色搜索图片
- 🔍 搜索（名称 / 注释 / 标签）、排序（时间 / 名称 / 大小 / 尺寸 / 评分 / 随机）
- 🖼️ 四种浏览视图：瀑布流 / 网格 / 列表 / **无限视图**
- 🗑️ 回收站（软删除 + 彻底删除）
- 📥 导入：文件选择器、磁盘路径、URL 拖网、**观察文件夹自动导入**
- 🔁 重复文件检测（SHA1 精确 + dHash 感知哈希相似搜索）
- ✂️ 批量操作：加标签 / 评分 / 移动 / 重命名（支持 `{name} {index} {date} {w} {h}` 模式）
- 📷 EXIF 读取（相机 / 参数 / 拍摄时间）、视频海报帧（自动检测 ffmpeg）

### 🦅 Eagle 库兼容导入
直接导入 Eagle 的 `.library` 库目录，完整迁移：
- 文件夹树（含嵌套）、标签（含颜色）
- 评分（star）、注释（annotation）、来源 URL
- 调色板（palettes）、尺寸 / 大小 / 添加时间等元数据
- **复用 Eagle 生成的 thumbnail.png**，秒级完成导入无需重新生成

## 🚀 快速开始

### 桌面端（Tauri）
```bash
# 前置：Rust、Node 18+、以及系统 WebView 运行时
#   Linux: sudo apt install libwebkit2gtk-4.1-dev build-essential
#   macOS: xcode-select --install
#   Windows: WebView2 已随系统提供

cd web && npm install && npm run build && cd ..
cargo install tauri-cli --version '^2'
cargo tauri dev    # 开发模式
cargo tauri build  # 产出安装包
```
库默认位于 `~/Lilium/Lilium.lilium`。

### Web 服务端（直接部署）
```bash
cargo build --release -p lilium-server
cd web && npm install && npm run build && cd ..
./target/release/lilium-server --library ~/Pictures/MyLib --dist web/dist --open
# 浏览器访问 http://localhost:7333/
```

### Docker 部署（云服务器 / NAS）
```bash
docker compose up -d          # 或 docker build -t lilium . && docker run -d -p 7333:7333 -v lilium-data:/data lilium
# 访问 http://服务器IP:7333/
```
- 数据持久化在 `lilium-data` 卷；把宿主机目录挂载到容器内后即可用「磁盘导入」路径导入

## 🦅 导入 Eagle 库

两种方式：
1. **Web UI**：顶栏 → 「Eagle 库」→ 输入 `.library` 目录的绝对路径
2. **命令行**：`lilium-server --library ~/Pictures/Design.library`（自动识别并导入）

导入在库旁生成同名 `.lilium` 库，原 Eagle 库保持只读不动。

## ⌨️ 快捷键

| 按键 | 功能 |
|---|---|
| `Ctrl+F` | 搜索 |
| `Ctrl+A` | 全选 |
| `1/2/3/4` | 瀑布流 / 网格 / 列表 / 无限视图 |
| `Enter` | 大图预览 |
| `←→` | 预览切换 |
| `0–5` | 预览中快速评分 |
| `Del` | 删除选中 |
| `Esc` | 关闭 / 取消 |

## 🏗️ 架构

```
crates/
  lilium-core     核心：库管理、SQLite、缩略图、调色板、感知哈希、Eagle 导入
  lilium-server   Web 服务端：Axum REST API + 静态托管
src-tauri/        桌面端：Tauri 2 壳 + 原生命令
web/              前端：React 18 + TypeScript + Tailwind v4 + Zustand
```

- 库结构：`MyLib.lilium/library.db (SQLite) + images/xx/<id>.<ext> + thumbnails/xx/<id>.jpg`
- 条目 ID 为 20 位大写字母数字（Eagle 同款风格），导入 Eagle 条目时**沿用原 ID**，可重复导入不产生副本

## 📋 系统要求

- 缩略图 / EXIF：无需外部依赖（纯 Rust）
- 视频缩略图：可选安装 `ffmpeg`
