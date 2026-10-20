import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store/useStore";
import { itemAspectRatio, humanSize, fmtDate } from "../../api/client";
import { LoadMoreSentinel, Stars, Thumb, useMasonryTiles } from "./shared";

/** 瀑布流视图 */
export default function MasonryView() {
  const items = useStore((s) => s.items);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setLightbox = useStore((s) => s.setLightbox);
  const setDetail = useStore((s) => s.setDetail);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(800);

  const itemsW = useMemo(() => items.map((it) => ({ id: it.id, aspect: itemAspectRatio(it) })), [items]);
  const { tiles, height } = useMasonryTiles(itemsW, width, zoom);

  const itemById = useMemo(() => {
    const m = new Map<string, (typeof items)[number]>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const visible = tiles.filter(
    (t) => t.y + t.h > scrollTop - 400 && t.y < scrollTop + viewH + 400,
  );

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto"
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        setViewH(e.currentTarget.clientHeight);
      }}
    >
      <div className="relative mx-auto" style={{ height, maxWidth: 1920, padding: `0 ${Math.max(8, zoom * 0.04)}px` }}>
        {visible.map((t) => {
          const it = itemById.get(t.id);
          if (!it) return null;
          const selected = selection.has(t.id);
          return (
            <div
              key={t.id}
              className="absolute rounded-md overflow-hidden cursor-pointer group"
              style={{
                left: t.x,
                top: t.y,
                width: t.w,
                height: t.h,
                boxShadow: selected ? "0 0 0 2px #a78bfa" : undefined,
                zIndex: selected ? 5 : 1,
              }}
              onClick={(e) =>
                select(t.id, e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "range" : "set")
              }
              onDoubleClick={() => setLightbox(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selection.has(t.id)) select(t.id, "set");
                window.dispatchEvent(
                  new CustomEvent("lilium:contextmenu", { detail: { x: e.clientX, y: e.clientY, itemId: t.id } }),
                );
              }}
            >
              <Thumb id={t.id} kind={it.kind} className="w-full h-full" />
              <div className="absolute inset-x-0 bottom-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/75 to-transparent px-2 pt-6 pb-1.5 pointer-events-none">
                <div className="text-[11px] text-white truncate">{it.name}</div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-neutral-400">
                    {it.width}×{it.height} · {humanSize(it.size)}
                  </span>
                  {it.rating > 0 && <Stars value={it.rating} size={10} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <LoadMoreSentinel />
      <div className="text-center text-[11px] text-neutral-600 py-3">
        {items.length} / {totalFmt(useStore.getState().total)}
      </div>
      <span className="hidden">{fmtDate(0)}</span>
    </div>
  );
}

function totalFmt(n: number) {
  return n;
}
