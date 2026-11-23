# 🌸 Lilium

本地优先的图片 / 素材管理工具，具备同类工具的完整功能集，并加入独特的**无限视图**。

> 一套 Rust 核心，三种形态：**桌面端 (Tauri 2)** · **自托管 Web 服务端** · **Docker 部署**

## ✨ 核心特性

### 无限视图
所有已载入的素材在一张无限画布上错落铺开：
- 向**上下左右任意方向**拖动平移，`Ctrl` / `⌘` + 滚轮以光标为中心缩放
- 按可见区域生成瓦片，可用右下角控件缩放或重置画布
- 点击聚焦一份素材，双击打开预览；按住 `Shift` 拖动可框选多项

### 完整功能集
- 📁 **嵌套文件夹** + 📌 **智能文件夹**（保存搜索条件，含评分区间 / 日期区间 / 否定标签）
- 🏷️ **标签系统**（彩色标签、计数、批量打标、排除标签）
- ⭐ 评分（0–5 星）、📝 注释、🔗 来源 URL
- 🎨 **主色 / 调色板提取**（k-means），按颜色搜索图片
- 🔍 搜索（名称 / 注释 / 标签）、排序（时间 / 名称 / 大小 / 尺寸 / 评分 / 随机）
- 🖼️ 五种浏览视图：瀑布流 / 网格 / 列表 / **无限视图** / 分类墙
- 🧭 Web 和桌面共用工作台：宽屏固定侧栏与详情栏，窄屏使用图标栏或抽屉；可单独移除已应用的筛选
- 🎛️ 工作台记住上次的视图、排序和缩略图大小；命令面板可快速切换视图、打开筛选或导入素材
- 🗑️ 回收站（软删除 + 彻底删除）
- 📥 导入：文件选择器、文件夹导入（桌面版系统目录选择器）、URL 拖网、**观察文件夹自动导入**
- 🔁 重复文件检测（SHA1 精确 + dHash 感知哈希相似搜索）
- ✂️ 批量操作：加标签 / 评分 / 移动 / 重命名（支持 `{name} {index} {date} {w} {h}` 模式）
- ☑️ 点击「多选」后，可逐项点按选中素材，无需键盘修饰键；操作栏显示选中数量和总文件大小
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
- 数据持久化在 `lilium-data` 卷；把宿主机目录挂载到容器内后即可用「从文件夹导入」路径导入

### 下载安装包
桌面端安装包（Windows `.exe`/`.msi`、macOS `.dmg`、Linux `.deb`/`.AppImage`/`.rpm`）见
[Releases](https://github.com/KurohaneKaoruko/Lilium/releases/latest)。

## 📦 导入现有库

两种方式：
1. **Web UI**：顶栏 → 「导入素材」→ 「迁移现有资源库」→ 选择 `.library` 库目录（桌面版可直接用系统选择器，网页版填写服务器可访问的绝对路径）
2. **命令行**：`lilium-server --library ~/Pictures/Design.library`（自动识别并导入）

导入在库旁生成同名 `.lilium` 库，原库保持只读不动。

## ⌨️ 快捷键

| 按键 | 功能 |
|---|---|
| `Ctrl+F` / `⌘F` | 聚焦搜索 |
| `Ctrl+K` / `⌘K` | 打开命令面板；用方向键选择、`Enter` 执行 |
| `Ctrl+A` / `⌘A` | 全选已载入的素材 |
| `1/2/3/4/5` | 瀑布流 / 网格 / 列表 / 无限视图 / 分类墙 |
| `Enter` | 大图预览 |
| `←→` | 预览切换 |
| `0–5` | 预览中快速评分 |
| `Del` | 将选中素材移到回收站 |
| `Esc` | 关闭弹层或取消选择 |
| `?` | 查看快捷键 |

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
cargo test                     # 工作区测试

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

### 浏览器冒烟测试

用临时素材库覆盖桌面和窄屏下的导入、画布框选、筛选、详情和预览，也检查命令面板、多选和偏好恢复，不会修改已有库：

```bash
cargo build -p lilium-server --bin lilium-server
npm --prefix web ci && npm --prefix web run build
# 在 Python 虚拟环境中安装 Playwright
python -m pip install playwright
python -m playwright install chromium
python scripts/smoke-workspace.py
```

可选 `--screenshots <目录>` 保存截图；用 `LILIUM_CHROMIUM` 指定已有 Chromium 的可执行文件。

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

#### 智能文件夹查询引擎

查询条件全部 AND 组合（多值字段为集合内 OR），保存为 JSON 到 `smart_folders.query`。
**向后兼容**：旧库 JSON 直接解析，未知字段忽略、缺失字段取中性默认值，不迁移不报错。

| 条件 | 参数 | 语义 |
|---|---|---|
| 文件夹 | `folderId` + `recursive` | 单文件夹或递归含子级 |
| 标签 | `tag` / `notTags` | 含指定标签 / 排除含任一标签的条目 |
| 类型 / 扩展名 | `kinds` / `exts` | 集合内 OR，逗号分隔均可 |
| 评分区间 | `ratingMin` / `ratingMax` | 闭区间；0 = 不设界，`ratingMax≥5` 等价不设上界 |
| 日期区间 | `addedFrom/addedTo`、`createdFrom/createdTo` | 毫秒时间戳闭区间，含边界；0/负值 = 不设界 |
| 颜色 | `color` + `colorTolerance` | RGB 距离阈值匹配 |
| 关键词 | `q` | 名称 / 注释 / 标签 LIKE |
| 状态 | `trash` / `untagged` / `unfiled` | 回收站 / 未打标 / 未分类 |
| 排序 | `sort` + `asc` + `offset/limit` | 白名单排序 + 分页，`random` 带种子分页连续 |

工作台的「筛选」按钮可设置评分区间、日期区间和排除标签，点击「应用筛选」后才更新结果。
侧栏「保存当前筛选」会把条件保存为智能文件夹，点击该文件夹即可恢复这些条件。

### 测试约定

- 测试库/临时文件统一建立在系统临时目录，命名带进程 PID 隔离，测试结束自行清理
- core 测试覆盖：库生命周期、文件夹树（含成环保护）、导入去重（路径级 + 内容级）、
  回收站、批量操作、标签、智能文件夹、重复检测（精确 + dHash 带状索引聚类）、
  查询过滤器与排序白名单、查询引擎新条件（评分区间边界 / 日期区间闭区间 / 否定标签组合）、
  旧库查询 JSON 向后兼容（未知字段忽略、缺省字段中性）、观察文件夹 autoImport 开关、
  Eagle 导入边界（短 id / 非法 ext / 悬空 folder）
- server 测试覆盖：API 契约（重命名文件夹回归、空 folderId 语义、非法目标 400、详情接口返回哈希）、
  批量重命名（空白模式 400 + 碰撞追加序号）、智能文件夹全生命周期（空白名 400 + CRUD）、
  相似搜索 / 重复检测、库管理（switch/create/remove/clear-cache）

## 📋 系统要求

- 缩略图 / EXIF：无需外部依赖（纯 Rust）
- 视频缩略图：可选安装 `ffmpeg`

## 📄 许可证

[AGPL-3.0](LICENSE) © KurohaneKaoruko
