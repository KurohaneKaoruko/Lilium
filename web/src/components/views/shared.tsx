import { useEffect, useMemo, useRef, useState } from "react";
import { Film, FileText, Music, Type as TypeIcon, Package, Star } from "lucide-react";
import { useStore } from "../../store/useStore";
import { itemAspectRatio, thumbUrl } from "../../api/client";

interface Tile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 瀑布流：按列最短优先分配，按可视区域虚拟化 */
export function useMasonryTiles(itemsW: { id: string; aspect: number }[], width: number, colWidth: number, gap = 12): { tiles: Tile[]; height: number } {
  return useMemo(() => {
    const cols = Math.max(1, Math.floor((width + gap) / (colWidth + gap)));
    const colH = new Array(cols).fill(0);
    const tiles: Tile[] = [];
    for (const it of itemsW) {
      let minCol = 0;
      for (let c = 1; c < cols; c++) if (colH[c] < colH[minCol]) minCol = c;
      const w = colWidth;
      const h = Math.round(colWidth / Math.max(0.25, Math.min(3.2, it.aspect)));
      tiles.push({ id: it.id, x: minCol * (colWidth + gap), y: colH[minCol], w, h });
      colH[minCol] += h + gap;
    }
    return { tiles, height: Math.max(0, ...colH) };
  }, [itemsW, width, colWidth, gap]);
}

export function PlaceholderThumb({ kind, size = 28 }: { kind: string; size?: number }) {
  const cls = "text-neutral-500";
  const map: Record<string, React.ReactNode> = {
    video: <Film className={cls} size={size} />,
    audio: <Music className={cls} size={size} />,
    font: <TypeIcon className={cls} size={size} />,
    document: <FileText className={cls} size={size} />,
    other: <Package className={cls} size={size} />,
  };
  return <span className="flex items-center justify-center w-full h-full">{map[kind] ?? <Package className={cls} size={size} />}</span>;
}

export function Stars({ value, onChange, size = 13 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={
            n <= value
              ? "text-amber-400 fill-amber-400"
              : "text-neutral-600"
          }
          onClick={onChange ? (e) => { e.stopPropagation(); onChange(value === n ? 0 : n); } : undefined}
          style={{ cursor: onChange ? "pointer" : "default" }}
        />
      ))}
    </span>
  );
}

/** 条目缩略图：懒加载 + 渐入 */
export function Thumb({
  id,
  kind,
  name,
  style,
  className,
}: {
  id: string;
  kind: string;
  name?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  if (kind !== "image" && kind !== "video") {
    return (
      <div style={style} className={`bg-panel2 ${className ?? ""}`}>
        <PlaceholderThumb kind={kind} />
      </div>
    );
  }
  return (
    <div style={style} className={`bg-panel2 overflow-hidden ${className ?? ""}`}>
      <img
        src={thumbUrl(id)}
        alt={name ?? ""}
        loading="lazy"
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

/** 底部哨兵：触发加载更多 */
export function LoadMoreSentinel() {
  const loadMore = useStore((s) => s.loadMore);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);
  return <div ref={ref} className="h-4" />;
}

export { itemAspectRatio };
