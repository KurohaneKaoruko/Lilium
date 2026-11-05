# 🌸 Lilium

本地优先的图片 / 素材管理工具，具备同类工具的完整功能集，并加入独特的**无限视图**。

> 一套 Rust 核心，三种形态：**桌面端 (Tauri 2)** · **自托管 Web 服务端** · **Docker 部署**

## ✨ 核心特性

### 无限视图
所有图片平铺在一张无限画布上，按图片纵横比错落有致地拼贴成封面墙：
- 向**上下左右任意方向**自由拖拽平移，滚轮以光标为中心缩放
- 布局按需生成（环形生长算法），数万张图片依然流畅
- Shift+拖拽框选、双击大图预览、点阵背景随视差移动

### 完整功能集
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

### 📦 库迁移导入
支持直接导入 Eagle 等同类图片管理器的库目录（`.library`），完整迁移：
- 文件夹树（含嵌套）、标签（含颜色）
- 评分（star）、注释（annotation）、来源 URL
- 调色板（palettes）、尺寸 / 大小 / 添加时间等元数据
- 复用原库已生成的缩略图，秒级完成导入无需重新生成

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
docker run -d -p 7333:7333 -v lilium-data:/data ghcr.io/kurohanekaoruko/lilium:latest
# 或源码构建: docker compose up -d
# 访问 http://服务器IP:7333/
```
- 数据持久化在 `lilium-data` 卷；把宿主机目录挂载到容器内后即可用「磁盘导入」路径导入

### 下载安装包
桌面端安装包（Windows `.exe`/`.msi`、macOS `.dmg`、Linux `.deb`/`.AppImage`/`.rpm`）见
[Releases](https://github.com/KurohaneKaoruko/Lilium/releases/latest)。

## 📦 导入现有库

两种方式：
1. **Web UI**：顶栏 → 「库导入」→ 输入 `.library` 库目录的绝对路径
2. **命令行**：`lilium-server --library ~/Pictures/Design.library`（自动识别并导入）

导入在库旁生成同名 `.lilium` 库，原库保持只读不动。

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
  lilium-core     核心：库管理、SQLite、缩略图、调色板、感知哈希、库迁移导入
  lilium-server   Web 服务端：Axum REST API + 静态托管
src-tauri/        桌面端：Tauri 2 壳 + 原生命令
web/              前端：React 18 + TypeScript + Tailwind v4 + Zustand
```

- 库结构：`MyLib.lilium/library.db (SQLite) + images/xx/<id>.<ext> + thumbnails/xx/<id>.jpg`
- 条目 ID 为 20 位大写字母数字，导入已有库条目时**沿用原 ID**，可重复导入不产生副本
- 重复检测两档阈值：**自动分组** `find_duplicates` 用 dHash 汉明距离 ≤ 6（只聚肉眼几乎相同的图，宁缺毋滥）；
  **相似搜索** `similar_to` 用 ≤ 10（用户主动检索、召回优先，覆盖同构图 / 裁剪 / 轻度调色）。
  相似查询走 `(hash) WHERE trash=0` 部分索引；schema 每次启动幂等执行（`CREATE ... IF NOT EXISTS`），旧库自动补建索引，无需迁移脚本

## 🛠️ 开发说明

### 常用命令

```bash
# 构建与测试（Rust 侧）
cargo build
cargo test                     # 全部单元测试（core 31 + server 4）

# 只构建 / 测试某个 crate
cargo build -p lilium-core
cargo test  -p lilium-core

# 检查（比 build 快，不产出二进制）
cargo check

# 前端开发（Vite 热更新，API 代理到 7333 端口）
cd web && npm install && npm run dev

# 生成示例图片（用于本地演示 / 测试）
cargo run -p lilium-server --bin gen-samples -- sample-images
```

### 服务端 CLI 参数

```bash
lilium-server [选项]
  -p, --port <端口>     监听端口（默认 7333，被占用时自动 +1 重试）
  -l, --library <路径>  库路径（.lilium 库或 Eagle .library 目录）
      --dist <目录>     Web 前端静态目录（默认自动探测 web/dist）
      --open            启动后打开浏览器
  -h, --help            帮助
```

环境变量：`LILIUM_LIBRARY`（默认库路径）、`LILIUM_PORT`（默认端口）。

### API 概览

REST API 挂载在 `/api` 前缀下（完整列表见 `crates/lilium-server/src/api.rs` 的 `router`）：

| 分组 | 端点 |
|---|---|
| 库 | `GET /api/info` · `GET /api/stats` · `GET/POST /api/libraries` · `POST /api/libraries/{create,switch,remove,clear-cache}` |
| 文件夹 | `GET/POST /api/folders` · `PATCH/DELETE /api/folders/{id}` |
| 标签 | `GET/POST /api/tags` · `PATCH/DELETE /api/tags/{name}` |
| 智能文件夹 | `GET/POST /api/smart-folders` · `PUT/DELETE /api/smart-folders/{id}` |
| 条目 | `GET /api/items`（分页/搜索/排序/过滤）· `GET/PATCH/DELETE /api/items/{id}` · `POST /api/items/{id}/{restore,tags/{tag}}` · `GET /api/items/{id}/similar` |
| 文件 | `GET /api/items/{id}/file` · `GET /api/thumbs/{id}`（带 ETag/304 缓存） |
| 导入 | `POST /api/import/{paths,upload,url,eagle}` |
| 批量 | `POST /api/batch`（tag/rating/move/trash/restore/purge）· `POST /api/batch-rename`（空白模式拒绝 400） |
| 工具 | `GET /api/duplicates` · `GET /api/suggest` · `GET/PATCH /api/settings` · `POST /api/watch-scan` · `POST /api/reveal/{id}` |

查询参数支持宽松类型（`kinds=image,video` 或 `kinds=image&kinds=video` 均可），
排序字段走白名单（`addedAt/createdAt/name/size/width/height/rating/duration/random`），无注入风险。

### 测试约定

- 测试库/临时文件统一建立在系统临时目录，命名带进程 PID 隔离，测试结束自行清理
- core 测试覆盖：库生命周期、文件夹树（含成环保护）、导入去重（路径级 + 内容级）、
  回收站、批量操作、标签、智能文件夹、重复检测（精确 + dHash 带状索引聚类）、
  查询过滤器与排序白名单、观察文件夹 autoImport 开关、Eagle 导入边界（短 id / 非法 ext / 悬空 folder）
- server 测试覆盖：API 契约（重命名文件夹回归、空 folderId 语义、非法目标 400、详情接口返回哈希）、
  批量重命名（空白模式 400 + 碰撞追加序号）、智能文件夹全生命周期（空白名 400 + CRUD）、
  相似搜索 / 重复检测、库管理（switch/create/remove/clear-cache）

## 📋 系统要求

- 缩略图 / EXIF：无需外部依赖（纯 Rust）
- 视频缩略图：可选安装 `ffmpeg`

## 📄 许可证

[AGPL-3.0](LICENSE) © KurohaneKaoruko
