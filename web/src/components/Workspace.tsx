import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Bookmark, ChevronDown, ChevronLeft, ChevronRight, CloudOff, Folder, Images, ListChecks, LoaderCircle, Plus, RefreshCw, ScanLine, SearchX, SlidersHorizontal, Trash2, WandSparkles, X } from "lucide-react";
import { THUMBNAIL_DEFAULT, THUMBNAIL_MAX, THUMBNAIL_MIN, useStore, type Filters, type SortKey, type ViewMode } from "../store/useStore";
import { advancedFilterCount, formatCount, KINDS, SORTS, VIEWS } from "../lib/workspace";
import FiltersPanel from "./FiltersPanel";
import Popover from "./ui/Popover";
import CollectionsView from "./views/CollectionsView";
import GridView from "./views/GridView";
import InfiniteView from "./views/InfiniteView";
import ListView from "./views/ListView";
import MasonryView from "./views/MasonryView";
import { SelectionBar } from "./modals/Modals";

const GALLERIES = { grid: GridView, masonry: MasonryView, list: ListView, infinite: InfiniteView, collections: CollectionsView };
type BrowseMenu = "sort" | "zoom" | "filters" | null;

export default function Workspace() {
  const view = useStore((s) => s.view);
  const similar = useStore((s) => s.similarIds !== null);
  const filters = useStore((s) => s.filters);
  const folder = useStore((s) => s.folders.find((f) => f.id === filters.folderId));
  const smart = useStore((s) => s.smartFolders.find((f) => f.id === filters.smartId));
  const info = useStore((s) => s.info);
  const total = useStore((s) => s.total);
  const visibleCount = useStore((s) => s.items.length);
  const loading = useStore((s) => s.loading);
  const importing = useStore((s) => s.importing);
  const selectionMode = useStore((s) => s.selectionMode);
  const setSelectionMode = useStore((s) => s.setSelectionMode);
  const error = useStore((s) => s.error);
  const setFilters = useStore((s) => s.setFilters);
  const resetFilters = useStore((s) => s.resetFilters);
  const exitSimilar = useStore((s) => s.exitSimilar);
  const [menu, setMenu] = useState<BrowseMenu>(null);
  useEffect(() => {
    const openFilters = () => {
      const store = useStore.getState();
      if (store.view === "collections") store.setView("masonry");
      setMenu("filters");
    };
    window.addEventListener("lilium:open-filters", openFilters);
    return () => window.removeEventListener("lilium:open-filters", openFilters);
  }, []);
  useEffect(() => {
    if (view === "collections") setMenu(null);
    else if (view !== "grid" && view !== "masonry") setMenu((current) => current === "zoom" ? null : current);
  }, [view]);
  const Gallery = GALLERIES[view];
  const collections = view === "collections";
  const chips = filterChips(filters);
  const scoped = filters.folderId || filters.smartId || filters.trash || filters.unfiled || filters.untagged;
  const title = collections ? "分类墙" : similar ? "相似素材" : smart?.name ?? (filters.trash ? "回收站" : folder?.name
    ?? (filters.unfiled ? "未分类" : filters.untagged ? "未打标签" : "全部素材"));
  const hint = collections ? "浏览文件夹和标签，把灵感按主题归档。"
    : similar ? "根据画面内容查找的相似素材。"
    : filters.trash ? "从这里恢复素材，或将它们永久删除。"
    : smart ? "使用已保存的条件，查看实时更新的素材。"
    : folder ? "浏览此文件夹中的素材。"
    : filters.unfiled ? "这里收集了尚未归入文件夹的素材。"
    : filters.untagged ? "使用标签，让素材更容易找到。"
    : "收集、整理和浏览你的灵感素材。";

  return (
    <main className="workspace" id="workspace" tabIndex={-1} aria-labelledby="workspace-title">
      <div className="workspace-head">
        <div className="workspace-heading">
          {(scoped || similar || collections) && <button type="button" className="breadcrumb-back" title="返回素材库" aria-label="返回素材库"
            onClick={() => {
              if (collections) useStore.getState().setView("infinite");
              if (similar) exitSimilar(); else resetFilters();
            }}><ChevronLeft size={15} /><span>素材库</span></button>}
          <h1 id="workspace-title" title={hint}>{title}</h1>
          {!collections && !error && <span className="count-badge">{loading ? "更新中" : `${formatCount(total)} 项`}</span>}
        </div>
        <div className="workspace-controls">
          {similar && <button type="button" className="btn return-button" title="退出相似搜索" aria-label="退出相似搜索" onClick={exitSimilar}>
            <X size={14} /><span>退出相似</span></button>}
          {!collections && <ViewPicker view={view} />}
          {!collections && <BrowseControls menu={menu} setMenu={setMenu} />}
          {!collections && (visibleCount > 0 || selectionMode) && <button type="button" className="btn-secondary selection-toggle" disabled={!selectionMode && loading}
            aria-pressed={selectionMode} aria-label={selectionMode ? "退出多选" : "多选素材"} title={selectionMode ? "退出多选" : "开启多选"}
            onClick={() => setSelectionMode(!selectionMode)}><ListChecks size={16} /><span>{selectionMode ? "完成" : "多选"}</span></button>}
        </div>
      </div>
      {!collections && !similar && chips.length > 0 && (
        <div className="filter-chips" aria-label="当前筛选条件">
          {chips.map(({ label, patch, color }, index) => <button key={index} className="chip" title={`移除筛选：${label}`}
            aria-label={`移除筛选：${label}`} onClick={() => setFilters(patch)}>
            {color && <span className="color-dot" style={{ backgroundColor: color }} />}
            <span className="truncate">{label}</span><X size={12} />
          </button>)}
          {chips.length > 1 && <button className="text-button" onClick={() => setFilters(refinements)}>清除筛选</button>}
        </div>
      )}

      <div className="gallery-region" aria-busy={!collections && loading} data-selection-mode={selectionMode}>
        {collections ? <Gallery /> : error ? <GalleryState icon={<CloudOff size={27} />} title="无法载入素材"
          text="请检查资源库服务是否运行，然后重试。" action={<button className="btn-primary" onClick={refresh}><RefreshCw size={16} /> 重新加载</button>} />
          : loading && !visibleCount ? <LoadingGallery />
          : !visibleCount ? (
            similar ? <GalleryState icon={<WandSparkles size={27} />} title="没有找到相似素材" text="试试库中其他已生成缩略图的图片。"
              action={<button className="btn-secondary" onClick={exitSimilar}>返回素材库</button>} />
              : chips.length ? <GalleryState icon={<SearchX size={27} />} title="没有匹配的素材" text="试试其他关键词，或移除部分筛选条件。"
                action={<button className="btn-secondary" onClick={() => setFilters(refinements)}>清除筛选</button>} />
              : filters.trash ? <GalleryState icon={<Trash2 size={27} />} title="回收站是空的" text="移到回收站的素材会出现在这里。" />
              : filters.untagged ? <GalleryState icon={<Bookmark size={27} />} title="没有未打标签的素材" text="以后导入的无标签素材会出现在这里。" />
              : <GalleryState welcome={!info?.itemCount && !scoped} icon={folder ? <Folder size={27} /> : <Images size={27} />}
                title={folder ? "这个文件夹还没有素材" : scoped ? "没有可显示的素材" : "从第一份素材开始"}
                text={smart ? "当前没有符合这个智能文件夹条件的素材。" : "把图片、视频或其他文件拖到这里，或从设备选择文件。"}
                action={smart ? undefined : <button className="btn-primary" disabled={importing} onClick={() => window.dispatchEvent(new Event("lilium:choose-files"))}>
                  {importing ? <><LoaderCircle size={17} className="animate-spin" /> 导入中…</> : <><Plus size={17} /> 选择文件</>}</button>}
                secondary={!scoped && <button className="btn" disabled={importing} onClick={() => window.dispatchEvent(new Event("lilium:import-menu"))}>
                  其他导入方式 <ChevronRight size={14} /></button>} />
          ) : <>
            <Gallery />
            {loading && <div className="gallery-updating" role="status" aria-label="正在更新素材"><LoaderCircle size={17} className="animate-spin" /></div>}
          </>}
        {!collections && <SelectionBar />}
      </div>
      <WorkspaceStatus view={view} />
    </main>
  );
}

function refresh() {
  const st = useStore.getState();
  void Promise.all([st.refreshMeta(), st.fetchItems()]);
}

function ViewPicker({ view }: { view: ViewMode }) {
  const setView = useStore((s) => s.setView);
  return <div className="view-picker" role="group" aria-label="浏览视图">
    {VIEWS.map(({ key, icon: Icon, label }, index) => (
      <button type="button" aria-pressed={view === key} aria-label={label} title={`${label}（${index + 1}）`}
        key={key} onClick={() => setView(key)}><Icon size={17} /><span>{label}</span></button>
    ))}
  </div>;
}

function BrowseControls({ menu, setMenu }: { menu: BrowseMenu; setMenu: (menu: BrowseMenu) => void }) {
  const view = useStore((s) => s.view);
  const sort = useStore((s) => s.sort);
  const setSort = useStore((s) => s.setSort);
  const asc = useStore((s) => s.asc);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const active = useStore((s) => advancedFilterCount(s.filters));
  const sortRef = useRef<HTMLButtonElement>(null);
  const zoomRef = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLButtonElement>(null);
  const close = () => setMenu(null);
  const open = (key: BrowseMenu) => setMenu(menu === key ? null : key);
  const sizeControl = view === "masonry" || view === "grid";

  return <div className="browse-controls">
    <button className="btn-secondary sort-button" type="button" ref={sortRef} aria-label="排序方式" title="排序方式"
      aria-haspopup="dialog" aria-expanded={menu === "sort"} onClick={() => open("sort")}>
      {asc && sort !== "random" ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      <span>{SORTS.find((option) => option.key === sort)?.label}</span><ChevronDown size={13} className="sort-chevron" />
    </button>
    {menu === "sort" && <Popover anchor={sortRef} label="排序方式" onClose={close} className="action-menu">
      <label className="field-label p-2">排序字段
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      {sort === "random" ? <button className="menu-row" onClick={() => setSort("random")}><RefreshCw size={15} />重新洗牌</button>
        : <div className="p-2 pt-0 flex gap-1.5" role="group" aria-label="排序方向">
          <button className="chip flex-1 justify-center" aria-pressed={asc} onClick={() => setSort(sort, true)}><ArrowUp size={14} />升序</button>
          <button className="chip flex-1 justify-center" aria-pressed={!asc} onClick={() => setSort(sort, false)}><ArrowDown size={14} />降序</button>
        </div>}
    </Popover>}
    {sizeControl && <button className="btn-secondary square-button thumbnail-button" type="button" ref={zoomRef}
      aria-haspopup="dialog" aria-expanded={menu === "zoom"} aria-label="缩略图大小" title="缩略图大小" onClick={() => open("zoom")}><ScanLine size={16} /></button>}
    {sizeControl && menu === "zoom" && <Popover anchor={zoomRef} label="缩略图大小" onClose={close} className="p-3 w-64">
      <label className="field-label">缩略图大小
        <input className="w-full accent-accent" type="range" min={THUMBNAIL_MIN} max={THUMBNAIL_MAX} step={1}
          value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
      </label>
      <div className="flex items-center justify-between text-xs text-muted mt-1"><span>{zoom} px</span>
        <button className="text-button" onClick={() => setZoom(THUMBNAIL_DEFAULT)}>恢复默认</button></div>
    </Popover>}
    <button className="btn-secondary filter-button" type="button" ref={filterRef} aria-label="高级筛选" title="高级筛选"
      aria-haspopup="dialog" aria-expanded={menu === "filters"} onClick={() => open("filters")}>
      <SlidersHorizontal size={16} /><span className="filter-label">筛选</span>{active > 0 && <span className="filter-count">{active}</span>}
    </button>
    {menu === "filters" && <FiltersPanel anchorRef={filterRef} onClose={close} />}
  </div>;
}

const refinements: Partial<Filters> = {
  q: "", tag: null, kinds: [], ratingMin: 0, ratingMax: 0, color: null,
  addedFrom: 0, addedTo: 0, createdFrom: 0, createdTo: 0, notTags: [],
};

function filterChips(f: Filters) {
  const chips: { label: string; patch: Partial<Filters>; color?: string }[] = [];
  const add = (label: string, patch: Partial<Filters>, color?: string) => chips.push({ label, patch, color });
  if (f.q.trim()) add(`搜索：${f.q.trim()}`, { q: "" });
  if (f.tag) add(`标签：${f.tag}`, { tag: null });
  f.kinds.forEach((kind) => add(KINDS[kind as keyof typeof KINDS] ?? kind, { kinds: f.kinds.filter((item) => item !== kind) }));
  const max = f.ratingMax > 0 && f.ratingMax < 5 ? f.ratingMax : 0;
  if (f.ratingMin || max) add(`${f.ratingMin ? `≥ ${f.ratingMin}` : ""}${f.ratingMin && max ? " · " : ""}${max ? `≤ ${max}` : ""} 星`, { ratingMin: 0, ratingMax: 0 });
  if (f.color) add(`主色 ${f.color.toUpperCase()}`, { color: null }, f.color);
  if (f.addedFrom || f.addedTo) add("添加时间范围", { addedFrom: 0, addedTo: 0 });
  if (f.createdFrom || f.createdTo) add("拍摄时间范围", { createdFrom: 0, createdTo: 0 });
  f.notTags.forEach((tag) => add(`排除：${tag}`, { notTags: f.notTags.filter((item) => item !== tag) }));
  return chips;
}

function WorkspaceStatus({ view }: { view: ViewMode }) {
  const count = useStore((s) => s.items.length);
  const total = useStore((s) => s.total);
  const loading = useStore((s) => s.loading);
  const loadingMore = useStore((s) => s.loadingMore);
  const error = useStore((s) => s.error ?? s.metaError);
  const pageError = useStore((s) => s.pageError);
  const ready = useStore((s) => s.info !== null);
  const loadMore = useStore((s) => s.loadMore);
  return <footer className="status-bar">
    {error ? <button type="button" className="status-source" onClick={refresh} title={error}><span className="status-dot is-offline" />重试连接</button>
      : <span className="status-source"><span className={`status-dot ${ready ? "is-ready" : ""}`} />{ready ? "资源库已连接" : "正在连接"}</span>}
    <span className="status-separator" />
    <span className="status-view">{VIEWS.find((v) => v.key === view)?.label}</span>
    <div className="ml-auto flex min-w-0 items-center gap-2.5">
      {view !== "collections" && !error && !loading && <span className="tabular-nums truncate">{count < total
        ? `已载入 ${formatCount(count)} / ${formatCount(total)} 项` : `${formatCount(total)} 项素材`}</span>}
      {view === "infinite" && !loading && !error && count < total && <button className="text-button shrink-0" disabled={loadingMore} title={pageError ?? undefined}
        onClick={() => void loadMore()}>{loadingMore ? "载入中…" : pageError ? "重试" : "加载更多"}</button>}
    </div>
  </footer>;
}

export function GalleryState({ icon, title, text, action, secondary, welcome }: {
  icon: ReactNode; title: string; text: string; action?: ReactNode; secondary?: ReactNode; welcome?: boolean;
}) {
  return <div className={`gallery-state ${welcome ? "is-welcome" : ""}`}>
    <div className="gallery-state-content">
      {welcome ? <EmptyArt /> : <div className="state-icon" aria-hidden="true">{icon}</div>}
      {welcome && <div className="state-kicker"><span /> LILIUM <span /></div>}
      <h2>{title}</h2><p>{text}</p>
      {(action || secondary) && <div className="state-actions">{action}{secondary}</div>}
    </div>
  </div>;
}

function EmptyArt() {
  return <svg className="empty-art" viewBox="0 0 280 166" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="lilium-picture" x1="49" y1="9" x2="110" y2="100" gradientUnits="userSpaceOnUse">
        <stop stopColor="#625297" /><stop offset="1" stopColor="#27223c" />
      </linearGradient>
    </defs>
    <path d="M23 115c12 28 78 38 151 24 63-13 103-42 91-64-12-23-74-29-144-15C62 72 33 89 23 102" stroke="#9b83fa" strokeOpacity=".32" strokeDasharray="2 5" />
    <path d="M29 78h12m-6-6v12M232 43h14m-7-7v14M229 130h8m-4-4v8" stroke="#b9a6ff" strokeOpacity=".78" strokeLinecap="round" />
    <circle cx="62" cy="44" r="3" fill="#9e87fc" /><circle cx="255" cy="104" r="2.5" fill="#9e87fc" /><circle cx="51" cy="132" r="2" fill="#9e87fc" opacity=".48" />
    <g transform="translate(56 40) rotate(-12 55 49)">
      <rect width="116" height="88" rx="12" fill="#1c1a2d" stroke="#544574" />
      <rect x="9" y="9" width="98" height="60" rx="6" fill="#302748" />
      <path d="m9 64 29-30 18 19 15-12 36 23v5H9z" fill="#463564" />
      <path d="M15 78h32" stroke="#6f5f93" strokeLinecap="round" />
    </g>
    <g transform="translate(98 29) rotate(9 61 47)">
      <rect width="130" height="100" rx="13" fill="#26213c" stroke="#8e76c7" />
      <rect x="9" y="9" width="112" height="70" rx="7" fill="url(#lilium-picture)" />
      <circle cx="86" cy="31" r="11" fill="#d5befa" />
      <path d="M9 71 49 32l25 24 14-12 33 26v2a7 7 0 0 1-7 7H16a7 7 0 0 1-7-7z" fill="#9279c8" />
      <path d="m9 73 29-20 17 11 18-6 25 21H16a7 7 0 0 1-7-6z" fill="#534376" />
      <path d="M16 89h30m59 0h8" stroke="#ae95df" strokeOpacity=".72" strokeWidth="2" strokeLinecap="round" />
    </g>
    <circle cx="114" cy="132" r="17" fill="#9e82f6" stroke="#29213c" strokeWidth="4" />
    <path d="M109 132h10m-5-5v10" stroke="#201936" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

function LoadingGallery() {
  return <div className="loading-gallery" role="status" aria-label="正在载入素材">
    {Array.from({ length: 10 }, (_, index) => <div className="loading-card" aria-hidden="true" key={index}><span /><i /><i /></div>)}
  </div>;
}
