import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid, Rows3, List, Infinity as InfinityIcon, Search, Upload, X,
  FolderPlus, RefreshCcw, Keyboard, Settings, Shapes, BarChart3,
} from "lucide-react";
import { useStore, type ViewMode } from "../store/useStore";
import { api } from "../api/client";

const VIEWS: { key: ViewMode; icon: React.ReactNode; label: string }[] = [
  { key: "masonry", icon: <LayoutGrid size={15} />, label: "瀑布流" },
  { key: "grid", icon: <Rows3 size={15} />, label: "网格" },
  { key: "list", icon: <List size={15} />, label: "列表" },
  { key: "infinite", icon: <InfinityIcon size={15} />, label: "无限视图" },
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

export default function TopBar({ onImported, immersive = false }: { onImported: () => void; immersive?: boolean }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  // 沉浸模式:面板透明融入玻璃底,拖拽区交给外层 FloatingChrome
  const shell = immersive
    ? "h-full bg-transparent border-b-0 px-2"
    : "h-11 shrink-0 bg-panel border-b border-border px-3";
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

  return (
    <header className={`${shell} flex items-center gap-2`}>
      {/* 沉浸模式下左端留出 mac 风格拖拽区(外层已有 data-tauri-drag-region 的按钮排) */}
      {immersive && <div className="w-2 shrink-0 self-stretch" data-tauri-drag-region />}
      {/* 视图切换 */}
      <div className="flex items-center bg-panel2 rounded-lg p-1 border border-border gap-0.5">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            title={v.label}
            className={`px-2.5 py-1.5 rounded-md transition-colors ${
              view === v.key
                ? "bg-violet-500/30 text-violet-200 shadow-sm"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-white/5"
            }`}
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
        <label className="btn-primary cursor-pointer">
          <Upload size={13} />
          导入
          <input type="file" multiple className="sr-only" onChange={(e) => doUpload(e.target.files)} />
        </label>
        <button className="btn" title="库统计" onClick={() => window.dispatchEvent(new CustomEvent("lilium:modal", { detail: "stats" }))}>
          <BarChart3 size={13} />
        </button>
        <button className="btn" title="刷新" onClick={() => { refreshMeta(); useStore.getState().fetchItems(); }}>
          <RefreshCcw size={13} />
        </button>
      </div>

    </header>
  );
}

export { Keyboard, Settings };
