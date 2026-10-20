import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Info } from "lucide-react";
import { useStore } from "../store/useStore";
import { fileUrl } from "../api/client";
import { Stars } from "./views/shared";
import { api } from "../api/client";

/** 灯箱大图预览：缩放、平移、左右切换、快速评分 */
export default function Lightbox() {
  const lightboxId = useStore((s) => s.lightboxId);
  const setLightbox = useStore((s) => s.setLightbox);
  const items = useStore((s) => s.items);
  const patchItemLocal = useStore((s) => s.patchItemLocal);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const idx = items.findIndex((i) => i.id === lightboxId);
  const item = idx >= 0 ? items[idx] : null;

  const go = useCallback(
    (d: number) => {
      const next = items[idx + d];
      if (next) {
        setLightbox(next.id);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    },
    [idx, items, setLightbox],
  );

  useEffect(() => {
    if (!lightboxId) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (/^[1-5]$/.test(e.key)) {
        const v = Number(e.key);
        patchItemLocal(lightboxId, { rating: v });
        api(`/items/${lightboxId}`, { method: "PATCH", body: JSON.stringify({ rating: v }) });
      } else if (e.key === "0") {
        patchItemLocal(lightboxId, { rating: 0 });
        api(`/items/${lightboxId}`, { method: "PATCH", body: JSON.stringify({ rating: 0 }) });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lightboxId, go, setLightbox, patchItemLocal]);

  if (!lightboxId || !item) return null;

  const isMedia = item.kind === "image" || item.kind === "video";

  return (
    <div className="fixed inset-0 z-50 bg-black/90 fade-in flex items-center justify-center">
      {/* 顶栏 */}
      <div className="absolute top-0 inset-x-0 h-11 flex items-center gap-3 px-4 bg-gradient-to-b from-black/70 to-transparent z-10">
        <span className="text-xs text-neutral-300 truncate max-w-[40%]">{item.name}</span>
        <span className="text-[11px] text-neutral-500">{idx + 1} / {items.length}</span>
        {item.width ? <span className="text-[11px] text-neutral-500">{item.width}×{item.height}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          <Stars
            value={item.rating}
            onChange={(v) => {
              patchItemLocal(item.id, { rating: v });
              api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ rating: v }) });
            }}
            size={16}
          />
          <button className="btn" onClick={() => useStore.getState().setDetail(item.id)}><Info size={14} /> 详情</button>
          <button className="btn" onClick={() => setZoom((z) => Math.min(8, z * 1.3))}><ZoomIn size={15} /></button>
          <button className="btn" onClick={() => setZoom((z) => Math.max(0.2, z / 1.3))}><ZoomOut size={15} /></button>
          <button className="btn" onClick={() => setLightbox(null)}><X size={16} /></button>
        </div>
      </div>

      {/* 图片 */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onWheel={(e) => {
          e.preventDefault();
          setZoom((z) => Math.max(0.2, Math.min(8, z * (e.deltaY < 0 ? 1.12 : 0.9))));
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onPointerUp={() => (drag.current = null)}
        style={{ cursor: drag.current ? "grabbing" : "grab" }}
      >
        {isMedia ? (
          item.kind === "video" ? (
            <video
              src={fileUrl(item.id)}
              controls
              autoPlay
              className="max-w-[92vw] max-h-[86vh]"
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
            />
          ) : (
            <img
              src={fileUrl(item.id)}
              alt=""
              draggable={false}
              className="max-w-[92vw] max-h-[86vh] object-contain transition-transform duration-75"
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
            />
          )
        ) : (
          <div className="text-neutral-500">该格式暂不支持预览</div>
        )}
      </div>

      {/* 左右切换 */}
      {idx > 0 && (
        <button className="absolute left-3 top-1/2 -translate-y-1/2 btn !p-2 bg-black/50 rounded-full" onClick={() => go(-1)}>
          <ChevronLeft size={20} />
        </button>
      )}
      {idx < items.length - 1 && (
        <button className="absolute right-3 top-1/2 -translate-y-1/2 btn !p-2 bg-black/50 rounded-full" onClick={() => go(1)}>
          <ChevronRight size={20} />
        </button>
      )}

      <div className="absolute bottom-3 text-[11px] text-neutral-500">滚轮缩放 · 拖拽移动 · ← → 切换 · 0-5 评分 · Esc 关闭</div>
    </div>
  );
}

import { useRef } from "react";
