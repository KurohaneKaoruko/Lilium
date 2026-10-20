import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store/useStore";
import { humanSize } from "../../api/client";
import { LoadMoreSentinel, Stars, Thumb } from "./shared";

/** 网格视图：统一方格，紧凑高效 */
export default function GridView() {
  const items = useStore((s) => s.items);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setLightbox = useStore((s) => s.setLightbox);

  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(800);
  const [width, setWidth] = useState(1000);

  const gap = 10;
  const cell = Math.max(96, zoom);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(2, Math.floor((width - gap) / (cell + gap)));
  const rows = Math.ceil(items.length / cols);
  const rowH = cell + 26 + gap;
  const firstRow = Math.max(0, Math.floor((scrollTop - 300) / rowH));
  const lastRow = Math.min(rows, Math.ceil((scrollTop + viewH + 300) / rowH));

  return (
    <div
      ref={ref}
      className="flex-1 overflow-y-auto"
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        setViewH(e.currentTarget.clientHeight);
      }}
    >
      <div className="relative mx-auto" style={{ height: rows * rowH + 40, maxWidth: 2200, padding: "0 12px" }}>
        {Array.from({ length: lastRow - firstRow }, (_, ri) => firstRow + ri).flatMap((row) =>
          Array.from({ length: cols }, (_, ci) => {
            const idx = row * cols + ci;
            const it = items[idx];
            if (!it) return null;
            const selected = selection.has(it.id);
            return (
              <div
                key={it.id}
                className="absolute cursor-pointer group"
                style={{ left: ci * (cell + gap), top: row * rowH, width: cell, height: cell + 24 }}
                onClick={(e) => select(it.id, e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "range" : "set")}
                onDoubleClick={() => setLightbox(it.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selection.has(it.id)) select(it.id, "set");
                  window.dispatchEvent(
                    new CustomEvent("lilium:contextmenu", { detail: { x: e.clientX, y: e.clientY, itemId: it.id } }),
                  );
                }}
              >
                <div
                  className="rounded-md overflow-hidden relative"
                  style={{
                    width: cell,
                    height: cell,
                    boxShadow: selected ? "0 0 0 2px #a78bfa" : undefined,
                  }}
                >
                  <Thumb id={it.id} kind={it.kind} className="w-full h-full" />
                </div>
                <div className="mt-1 px-0.5">
                  <div className={`text-[11px] truncate ${selected ? "text-violet-300" : "text-neutral-400"}`}>
                    {it.name}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-neutral-600">{humanSize(it.size)}</span>
                    {it.rating > 0 && <Stars value={it.rating} size={9} />}
                  </div>
                </div>
              </div>
            );
          }),
        )}
      </div>
      <LoadMoreSentinel />
    </div>
  );
}
