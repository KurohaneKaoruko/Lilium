import { useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type MouseEvent } from "react";
import { Check, FileText, Film, ImageOff, LoaderCircle, Music, Package, Star, Type as TypeIcon } from "lucide-react";
import { useStore } from "../../store/useStore";
import { thumbUrl, type Item } from "../../api/client";

type Tile = { id: string; x: number; y: number; w: number; h: number };
const GAP = 14;

export function galleryColumns(width: number, zoom: number) {
  const target = zoom * (width < 380 ? 0.64 : width < 520 ? 0.72 : 1);
  const count = Math.max(1, Math.floor((width + GAP) / (target + GAP)));
  return { count, gap: GAP, cell: (width - (count - 1) * GAP) / count };
}

/** 短列优先排列；视图只挂载可见区附近的卡片。 */
export function useMasonryTiles(items: { id: string; aspect: number }[], width: number, zoom: number) {
  return useMemo(() => {
    const { count, gap, cell } = galleryColumns(width, zoom);
    if (width <= 0) return { tiles: [] as Tile[], height: 0 };
    const colH: number[] = new Array(count).fill(0);
    const tiles = items.map(({ id, aspect }) => {
      let min = 0;
      for (let col = 1; col < count; col++) if (colH[col] < colH[min]) min = col;
      const h = Math.max(72, Math.round(cell / Math.max(0.45, Math.min(3.2, aspect))));
      const tile = { id, x: min * (cell + gap), y: colH[min], w: cell, h };
      colH[min] += h + gap;
      return tile;
    });
    return { tiles, height: Math.max(0, ...colH) };
  }, [items, width, zoom]);
}

export function useGalleryViewport() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const querySeq = useStore((s) => s.querySeq);
  const [viewport, setViewport] = useState({ width: 0, height: 0, top: 0 });
  const measure = () => {
    const scroll = scrollRef.current;
    const inner = innerRef.current;
    if (scroll && inner) {
      const next = { width: inner.clientWidth, height: scroll.clientHeight, top: scroll.scrollTop };
      setViewport((v) => v.width === next.width && v.height === next.height && v.top === next.top ? v : next);
    }
  };
  useLayoutEffect(() => {
    if (!scrollRef.current || !innerRef.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scrollRef.current);
    observer.observe(innerRef.current);
    measure();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    measure();
  }, [querySeq]);
  return { scrollRef, innerRef, measure, ...viewport };
}

export function openAssetMenu(event: MouseEvent<HTMLElement>, id: string) {
  event.preventDefault();
  const st = useStore.getState();
  if (st.loading) return;
  if (!st.selection.has(id)) st.select(id, "set");
  const rect = event.currentTarget.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent("lilium:contextmenu", {
    detail: { x: event.clientX || rect.left + 8, y: event.clientY || rect.top + 8, itemId: id, origin: event.currentTarget },
  }));
}

export function assetInteractions(id: string): HTMLAttributes<HTMLElement> {
  return {
    onClick: (event) => {
      const st = useStore.getState();
      if (st.loading) return;
      const mode = event.ctrlKey || event.metaKey ? "toggle" : event.shiftKey ? "range" : st.selectionMode ? "toggle" : "set";
      st.select(id, mode);
      if (mode === "set" && st.detailId) st.setDetail(id);
    },
    onDoubleClick: () => {
      const st = useStore.getState();
      if (!st.loading && !st.selectionMode) st.setLightbox(id);
    },
    onKeyDown: (event) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      const st = useStore.getState();
      if (st.selectionMode) return; // 保留按钮本身的 Enter / Space 切换选择行为
      event.preventDefault();
      if (!st.loading) { st.select(id, "set"); st.setLightbox(id); }
    },
    onContextMenu: (event) => openAssetMenu(event, id),
    draggable: true,
    onDragStart: (event) => {
      const st = useStore.getState();
      if (st.loading || st.filters.trash || (st.selectionMode && !st.selection.has(id))) { event.preventDefault(); return; }
      const ids = st.selection.has(id) ? [...st.selection] : [id];
      event.dataTransfer.setData("application/x-lilium-items", JSON.stringify(ids));
      event.dataTransfer.effectAllowed = "move";
    },
  };
}

export function SelectionMark({ selected }: { selected: boolean }) {
  return <span className="asset-check" data-selected={selected} aria-hidden="true">{selected && <Check size={13} />}</span>;
}

export function PlaceholderThumb({ kind, size = 26 }: { kind: string; size?: number }) {
  const kinds = { image: ImageOff, video: Film, audio: Music, font: TypeIcon, document: FileText };
  const Icon = kinds[kind as keyof typeof kinds] ?? Package;
  return <span className="thumb-placeholder" aria-hidden="true"><Icon size={size} strokeWidth={1.5} /></span>;
}

export function Stars({ value, onChange, size = 13 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  const stars = [1, 2, 3, 4, 5];
  return onChange ? <div className="stars stars-editor" role="group" aria-label="评分">
    {stars.map((n) => <button key={n} type="button" title={value === n ? "清除评分" : `评为 ${n} 星`}
      aria-label={`评为 ${n} 星`} aria-pressed={value === n} onClick={() => onChange(value === n ? 0 : n)}>
      <Star size={size} className={n <= value ? "is-rated" : ""} />
    </button>)}
  </div> : <span className="stars" role="img" aria-label={value ? `${value} 星` : "未评分"} title={value ? `${value} 星` : "未评分"}>
    {stars.map((n) => <Star key={n} aria-hidden="true" size={size} className={n <= value ? "is-rated" : ""} />)}
  </span>;
}

export function Thumb({ id, kind, name, style, className = "", fallbackSize, eager, contain }: {
  id: string; kind: string; name?: string; style?: React.CSSProperties; className?: string; fallbackSize?: number; eager?: boolean; contain?: boolean;
}) {
  return <span style={style} className={`asset-thumb ${className}`}>
    {kind === "image" || kind === "video" ? <ThumbImage key={id} {...{ id, kind, name, fallbackSize, eager, contain }} />
      : <PlaceholderThumb kind={kind} size={fallbackSize} />}
  </span>;
}

function ThumbImage({ id, kind, name, fallbackSize, eager, contain }: { id: string; kind: string; name?: string; fallbackSize?: number; eager?: boolean; contain?: boolean }) {
  const [status, setStatus] = useState<"pending" | "ready" | "error">("pending");
  return status === "error" ? <PlaceholderThumb kind={kind} size={fallbackSize} /> :
    <img src={thumbUrl(id)} alt={name ?? ""} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false}
      onLoad={() => setStatus("ready")} onError={() => setStatus("error")} className={`${status === "ready" ? "is-ready" : ""} ${contain ? "is-contained" : ""}`} />;
}

export function AssetMeta({ item }: { item: Item }) {
  return <span className="asset-meta">
    <span className="file-type">{item.ext ? item.ext.toUpperCase() : "文件"}</span>
    {item.width && item.height ? <span className="truncate tabular-nums">{item.width} × {item.height}</span> : null}
    {item.rating > 0 && <span className="asset-rating"><Star size={11} />{item.rating}</span>}
  </span>;
}

/** 底部哨兵仅在能追加且无失败时自动加载，出错则提供明确的重试。 */
export function LoadMoreSentinel() {
  const loadMore = useStore((s) => s.loadMore);
  const hasMore = useStore((s) => s.items.length < s.total);
  const count = useStore((s) => s.items.length);
  const loading = useStore((s) => s.loading);
  const loadingMore = useStore((s) => s.loadingMore);
  const error = useStore((s) => s.pageError);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || loading || loadingMore || error) return;
    const scroll = el.closest(".gallery-scroll");
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void loadMore(); }, { root: scroll, rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, hasMore, loading, loadingMore, count, error]);
  return <div ref={ref} className="gallery-pagination">
    {hasMore && !loading && (loadingMore ? <span role="status"><LoaderCircle size={15} className="animate-spin" />正在加载更多素材…</span>
      : <button className="btn" title={error ?? undefined} onClick={() => void loadMore()}>{error ? "载入失败 · 重试" : "加载更多"}</button>)}
  </div>;
}
