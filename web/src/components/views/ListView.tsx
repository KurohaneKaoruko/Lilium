import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store/useStore";
import { fmtDate, humanSize, thumbUrl } from "../../api/client";
import { LoadMoreSentinel, PlaceholderThumb, Stars } from "./shared";

const ROW_H = 44;

/** 列表视图 */
export default function ListView() {
  const items = useStore((s) => s.items);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setLightbox = useStore((s) => s.setLightbox);

  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(800);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = Math.max(0, Math.floor((scrollTop - 300) / ROW_H));
  const last = Math.min(items.length, Math.ceil((scrollTop + viewH + 300) / ROW_H));
  const rows = items.slice(first, last);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto" onScroll={(e) => { setScrollTop(e.currentTarget.scrollTop); }}>
      <div className="relative mx-auto max-w-[1400px]" style={{ height: items.length * ROW_H + 20 }}>
        {/* 表头 */}
        <div className="sticky top-0 z-10 grid grid-cols-[44px_1fr_110px_80px_70px_130px_150px] gap-2 items-center bg-panel border-b border-border px-3 text-[11px] text-neutral-500 h-8">
          <span />
          <span>名称</span>
          <span>尺寸</span>
          <span>大小</span>
          <span>评分</span>
          <span>标签</span>
          <span>添加时间</span>
        </div>
        {rows.map((it, i) => {
          const idx = first + i;
          const selected = selection.has(it.id);
          return (
            <div
              key={it.id}
              className={`absolute grid grid-cols-[44px_1fr_110px_80px_70px_130px_150px] gap-2 items-center px-3 cursor-pointer hover:bg-white/[0.04] ${
                selected ? "bg-violet-500/10" : ""
              }`}
              style={{ top: idx * ROW_H, height: ROW_H, left: 0, right: 0 }}
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
              <div className="w-9 h-9 rounded overflow-hidden bg-panel2 shrink-0">
                {it.kind === "image" || it.kind === "video" ? (
                  <img src={thumbUrl(it.id)} loading="lazy" className="w-full h-full object-cover" alt="" />
                ) : (
                  <PlaceholderThumb kind={it.kind} size={16} />
                )}
              </div>
              <span className={`truncate text-xs ${selected ? "text-violet-300" : ""}`}>{it.name}</span>
              <span className="text-[11px] text-neutral-500">
                {it.width ? `${it.width}×${it.height}` : "—"}
              </span>
              <span className="text-[11px] text-neutral-500">{humanSize(it.size)}</span>
              <Stars value={it.rating} size={11} />
              <span className="truncate text-[11px] text-neutral-500">{it.tags.join(", ")}</span>
              <span className="text-[11px] text-neutral-500">{fmtDate(it.addedAt)}</span>
            </div>
          );
        })}
      </div>
      <LoadMoreSentinel />
    </div>
  );
}
