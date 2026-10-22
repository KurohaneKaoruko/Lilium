import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Info, Tag as TagIcon } from "lucide-react";
import { useStore } from "../store/useStore";
import { fileUrl, api, type Exif } from "../api/client";
import { Stars } from "./views/shared";

/** EXIF 中文标签 */
const EXIF_LABELS: Record<string, string> = {
  make: "相机厂商", model: "相机型号", lens: "镜头", iso: "ISO",
  fnumber: "光圈", exposure: "快门", focal: "焦距", date: "拍摄时间",
};

/** 灯箱大图预览：缩放、平移、左右切换、快速评分、EXIF、快速打标 */
export default function Lightbox() {
  const lightboxId = useStore((s) => s.lightboxId);
  const setLightbox = useStore((s) => s.setLightbox);
  const items = useStore((s) => s.items);
  const patchItemLocal = useStore((s) => s.patchItemLocal);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [exif, setExif] = useState<Exif | null>(null);
  const [tagInput, setTagInput] = useState("");
  const refreshMeta = useStore((s) => s.refreshMeta);

  // 切换图片 → 拉取 EXIF,重置视图
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setExif(null);
    if (!lightboxId) return;
    api<{ exif: Exif | null }>(`/items/${lightboxId}`)
      .then((d) => setExif(d.exif))
      .catch(() => setExif(null));
  }, [lightboxId]);

  const addTag = async (name: string) => {
    const n = name.trim();
    if (!n || !lightboxId) return;
    await api(`/items/${lightboxId}/tags/${encodeURIComponent(n)}`, { method: "PUT" });
    useStore.getState().patchItemLocal(lightboxId, { tags: [...(item?.tags ?? []), n] } as never);
    setTagInput("");
    refreshMeta();
  };

  const removeTag = async (t: string) => {
    if (!lightboxId) return;
    await api(`/items/${lightboxId}/tags/${encodeURIComponent(t)}`, { method: "DELETE" });
    useStore.getState().patchItemLocal(lightboxId, { tags: (item?.tags ?? []).filter((x) => x !== t) } as never);
    refreshMeta();
  };

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
      // 输入框聚焦时不拦截按键
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
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
          <button className="btn" onClick={() => setShowInfo((v) => !v)}><Info size={14} /> 信息</button>
          <button className="btn" onClick={() => useStore.getState().setDetail(item.id)}>详情</button>
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

      {/* 右侧信息抽屉 */}
      {showInfo && (
        <div
          className="absolute right-0 top-11 bottom-0 w-72 bg-panel/95 backdrop-blur-md border-l border-border/60 overflow-y-auto p-4 space-y-4 slide-in-right z-10"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400 font-medium">图片信息</span>
            <button className="text-neutral-500 hover:text-white" onClick={() => setShowInfo(false)}><X size={14} /></button>
          </div>

          {/* 快速打标 */}
          <div>
            <div className="text-[11px] text-neutral-500 flex items-center gap-1 mb-1.5"><TagIcon size={11} /> 标签</div>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {item.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 bg-violet-500/15 text-violet-200 text-[11px] px-1.5 py-0.5 rounded">
                  {t}
                  <button onClick={() => removeTag(t)} className="hover:text-white"><X size={10} /></button>
                </span>
              ))}
              {item.tags.length === 0 && <span className="text-[11px] text-neutral-600">暂无标签</span>}
            </div>
            <input
              className="input w-full"
              placeholder="添加标签，回车确认"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addTag(tagInput); }
                e.stopPropagation();
              }}
            />
          </div>

          {/* 基本信息 */}
          <div className="space-y-1.5 text-[11px]">
            <Row k="文件名" v={item.name} />
            <Row k="类型" v={`${item.kind} · ${item.ext.toUpperCase()}`} />
            <Row k="尺寸" v={item.width ? `${item.width}×${item.height}` : "—"} />
            <Row k="大小" v={fmtSize(item.size)} />
            <Row k="添加时间" v={new Date(item.addedAt).toLocaleString()} />
            {item.duration != null && <Row k="时长" v={`${Math.round(item.duration)}s`} />}
            {item.url ? <Row k="来源" v={item.url} /> : null}
          </div>

          {/* EXIF */}
          {exif && Object.keys(exif).length > 0 && (
            <div>
              <div className="text-[11px] text-neutral-500 mb-1.5">EXIF</div>
              <div className="space-y-1.5 text-[11px]">
                {Object.entries(exif).map(([k, v]) => (
                  <Row key={k} k={EXIF_LABELS[k] ?? k} v={String(v)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-neutral-500 shrink-0 w-16">{k}</span>
      <span className="text-neutral-300 break-all">{v}</span>
    </div>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
