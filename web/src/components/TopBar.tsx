import { useEffect, useRef } from "react";
import {
  LayoutGrid, Rows3, List, Sparkles, Search, Upload, Link2, Import, X,
  FolderPlus, RefreshCcw, Keyboard, Settings, AudioWaveform, Shapes,
} from "lucide-react";
import { useStore, type ViewMode } from "../store/useStore";
import { api } from "../api/client";

const VIEWS: { key: ViewMode; icon: React.ReactNode; label: string }[] = [
  { key: "masonry", icon: <LayoutGrid size={15} />, label: "瀑布流" },
  { key: "grid", icon: <Rows3 size={15} />, label: "网格" },
  { key: "list", icon: <List size={15} />, label: "列表" },
  { key: "infinite", icon: <Sparkles size={15} />, label: "无限画布" },
  { key: "ambient", icon: <AudioWaveform size={15} />, label: "氛围墙" },
  { key: "collections", icon: <Shapes size={15} />, label: "分类墙" },
];

const SORTS: { key: string; label: string }[] = [
  { key: "addedAt", label: "添加时间" },
  { key: "createdAt", label: "拍摄/创建时间" },
  { key: "name", label: "名称" },
  { key: "size", label: "文件大小" },
  { key: "width", label: "宽度" },
  { key: "rating", label: "评分" },
  { key: "random", label: "随机" },
];

export default function TopBar({ onImported }: { onImported: () => void }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const sort = useStore((s) => s.sort);
  const asc = useStore((s) => s.asc);
  const setSort = useStore((s) => s.setSort);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const total = useStore((s) => s.total);
  const loading = useStore((s) => s.loading);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl+F 聚焦搜索
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // 搜索防抖：只在这里触发查询（setFilters 只更新状态不请求 q 字段）
  useEffect(() => {
    const t = setTimeout(() => {
      useStore.getState().fetchItems();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  const doUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    fd.append("folderId", filters.folderId ?? "");
    for (const f of Array.from(files)) fd.append("files", f, f.name);
    await api("/import/upload", { method: "POST", body: fd });
    refreshMeta();
    useStore.getState().fetchItems();
    onImported();
  };

  const importFromDisk = async () => {
    const p = prompt("输入要导入的文件/文件夹的绝对路径（服务端本地路径，支持批量逗号分隔）：");
    if (!p?.trim()) return;
    const paths = p.split(",").map((s) => s.trim()).filter(Boolean);
    await api("/import/paths", { method: "POST", body: JSON.stringify({ paths, folderId: filters.folderId }) });
    refreshMeta();
    useStore.getState().fetchItems();
    onImported();
  };

  const importFromUrl = async () => {
    const url = prompt("输入图片/资源的 URL：");
    if (!url?.trim()) return;
    await api("/import/url", { method: "POST", body: JSON.stringify({ url: url.trim(), folderId: filters.folderId }) });
    refreshMeta();
    useStore.getState().fetchItems();
    onImported();
  };

  const importEagle = async () => {
    const p = prompt("输入 Eagle 库目录的绝对路径（例如 ~/Pictures/Design.library）：");
    if (!p?.trim()) return;
    const r = await api<{ report: { folders: number; items: number; tags: number; skipped: number } }>(
      "/import/eagle",
      { method: "POST", body: JSON.stringify({ path: p.trim() }) },
    );
    alert(
      `Eagle 库导入完成：\n文件夹 ${r.report.folders} · 条目 ${r.report.items} · 标签 ${r.report.tags}${r.report.skipped ? ` · 跳过 ${r.report.skipped}` : ""}`,
    );
    refreshMeta();
    useStore.getState().fetchItems();
    onImported();
  };

  return (
    <header className="h-11 shrink-0 bg-panel border-b border-border flex items-center gap-2 px-3">
      {/* 视图切换 */}
      <div className="flex items-center bg-panel2 rounded-md p-0.5 border border-border">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            title={v.label}
            className={`px-2 py-1 rounded ${view === v.key ? "bg-violet-500/25 text-violet-200" : "text-neutral-400 hover:text-neutral-200"}`}
            onClick={() => setView(v.key)}
          >
            {v.icon}
          </button>
        ))}
      </div>

      {/* 缩放 */}
      <input
        type="range"
        min={100}
        max={460}
        value={zoom}
        onChange={(e) => setZoom(Number(e.target.value))}
        className="w-24 accent-violet-400"
        title="缩放"
      />

      {/* 排序 */}
      <select
        className="input !py-1 w-[110px]"
        value={sort}
        onChange={(e) => setSort(e.target.value as never)}
        title="排序方式"
      >
        {SORTS.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
      <button className="btn" title={asc ? "升序" : "降序"} onClick={() => setSort(sort, !asc)}>
        {asc ? "↑" : "↓"}
      </button>

      {/* 搜索 */}
      <div className="relative flex-1 max-w-md ml-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          ref={searchRef}
          className="input w-full pl-7 pr-7"
          placeholder="搜索名称、注释、标签… (Ctrl+F)"
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
        />
        {filters.q && (
          <button className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-200" onClick={() => setFilters({ q: "" })}>
            <X size={12} />
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <span className="text-[11px] text-neutral-500 mr-1">
          {loading ? "加载中…" : `${total} 项`}
        </span>
        <button className="btn" onClick={importFromUrl} title="从 URL 导入"><Link2 size={14} /> URL</button>
        <button className="btn" onClick={importFromDisk} title="从磁盘路径导入"><Import size={14} /> 磁盘</button>
        <button className="btn" onClick={importEagle} title="导入 Eagle 库"><FolderPlus size={14} /> Eagle 库</button>
        <label className="btn-primary cursor-pointer">
          <Upload size={13} />
          导入
          <input type="file" multiple className="sr-only" onChange={(e) => doUpload(e.target.files)} />
        </label>
        <button className="btn" title="刷新" onClick={() => { refreshMeta(); useStore.getState().fetchItems(); }}>
          <RefreshCcw size={13} />
        </button>
      </div>
    </header>
  );
}

export { Keyboard, Settings };
