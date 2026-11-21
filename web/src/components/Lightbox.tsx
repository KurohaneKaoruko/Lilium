import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Info, Maximize, Minus, PanelRightOpen, Plus, X } from "lucide-react";
import { useStore } from "../store/useStore";
import { api, fileUrl, fmtDate, humanSize, type Exif, type Item } from "../api/client";
import { KINDS } from "../lib/workspace";
import { reportError } from "../lib/feedback";
import { Dialog } from "./ui/Dialog";
import TagEditor from "./ui/TagEditor";
import { DataRow, EXIF_LABELS, updateItem } from "./DetailPanel";
import { PlaceholderThumb, Stars, Thumb } from "./views/shared";

export default function Lightbox() {
  const id = useStore((s) => s.lightboxId);
  const items = useStore((s) => s.items);
  const setLightbox = useStore((s) => s.setLightbox);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return <Viewer items={items} index={index} onSelect={setLightbox} onClose={() => setLightbox(null)} />;
}

const clampZoom = (zoom: number) => Math.min(8, Math.max(1, zoom));
const origin = { x: 0, y: 0, zoom: 1 };

function Viewer({ items, index, onSelect, onClose }: { items: Item[]; index: number; onSelect: (id: string) => void; onClose: () => void }) {
  const item = items[index];
  const [showInfo, setShowInfo] = useState(false);
  const [transform, setTransform] = useState(origin);
  const [isDragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; tx: number; ty: number } | null>(null);
  const ratingBusy = useRef(false);
  const zoom = transform.zoom;
  const image = item.kind === "image";

  const setZoom = (factor: number) => setTransform((view) => {
    const zoom = clampZoom(view.zoom * factor);
    return zoom === 1 ? origin : { ...view, zoom };
  });
  useEffect(() => {
    const area = stageRef.current;
    if (!image || !area) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = area.getBoundingClientRect();
      const x = event.clientX - bounds.left - bounds.width / 2;
      const y = event.clientY - bounds.top - bounds.height / 2;
      const step = event.deltaMode === 1 ? event.deltaY * 15 : event.deltaY;
      setTransform((view) => {
        const zoom = clampZoom(view.zoom * Math.exp(-step * .0019));
        if (zoom === 1) return origin;
        const scale = zoom / view.zoom;
        return { zoom, x: x - (x - view.x) * scale, y: y - (y - view.y) * scale };
      });
    };
    area.addEventListener("wheel", wheel, { passive: false });
    return () => area.removeEventListener("wheel", wheel);
  }, [image]);

  const select = (next: Item | undefined) => {
    if (!next || next.id === item.id) return;
    setTransform(origin); setFailed(false); drag.current = null; setDragging(false);
    onSelect(next.id);
    stageRef.current?.focus({ preventScroll: true });
  };
  const rate = async (rating: number) => {
    if (ratingBusy.current) return;
    ratingBusy.current = true;
    try { await updateItem(item.id, { rating }); } catch (error) { reportError("无法保存评分", error); }
    finally { ratingBusy.current = false; }
  };
  const filmStart = Math.max(0, Math.min(index - 2, items.length - 5));

  return <Dialog label="大图预览" className="lightbox-dialog" onClose={onClose}>
    <div className="viewer" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, video, audio, [contenteditable]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); select(items[index + (event.key === "ArrowLeft" ? -1 : 1)]);
      } else if (/^[0-5]$/.test(event.key)) { event.preventDefault(); void rate(Number(event.key)); }
    }}>
      <header className="viewer-header">
        <div className="viewer-title"><small>素材预览 · {index + 1} / {items.length}</small><h2 title={item.name}>{item.name}</h2></div>
        <div className="viewer-top-actions">
          <a href={fileUrl(item.id)} download className="icon-button" aria-label="下载原文件" title="下载原文件"><Download size={17} /></a>
          <button className="icon-button" aria-pressed={showInfo} onClick={() => setShowInfo(!showInfo)} aria-label="预览信息" title="预览信息"><Info size={18} /></button>
          <button className="icon-button" aria-label="编辑素材详情" title="编辑素材详情" onClick={() => {
            onClose(); useStore.getState().setDetail(item.id);
          }}><PanelRightOpen size={18} /></button>
          <button className="icon-button viewer-close" data-dialog-focus onClick={onClose} aria-label="关闭预览" title="关闭预览 (Esc)"><X size={20} /></button>
        </div>
      </header>

      <div className="viewer-body">
        <div className="viewer-canvas">
          <div ref={stageRef} tabIndex={-1} className={`viewer-stage ${image && zoom > 1 ? "can-pan" : ""} ${isDragging ? "is-dragging" : ""}`}
            onPointerDown={(event) => {
              if (!image || failed || zoom <= 1 || event.button !== 0 || !event.isPrimary) return;
              drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y };
              event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
            }} onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.pointer !== event.pointerId) return;
              setTransform({ zoom, x: start.tx + event.clientX - start.x, y: start.ty + event.clientY - start.y });
            }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
            {failed ? <div className="viewer-unsupported"><PlaceholderThumb kind={item.kind} /><p>无法加载该素材的预览</p>
              <a className="btn-secondary" download href={fileUrl(item.id)}><Download size={16} /> 下载原文件</a></div>
              : image ? <img src={fileUrl(item.id)} key={item.id} alt={item.name} draggable={false}
                onError={() => setFailed(true)} style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${zoom})`,
                  maxWidth: item.width ? `min(96%, ${item.width * 2}px)` : undefined, maxHeight: item.height ? `min(96%, ${item.height * 2}px)` : undefined }} />
              : item.kind === "video" ? <video key={item.id} src={fileUrl(item.id)} controls playsInline onError={() => setFailed(true)} />
              : item.kind === "audio" ? <audio key={item.id} src={fileUrl(item.id)} controls onError={() => setFailed(true)} />
              : <div className="viewer-unsupported"><PlaceholderThumb kind={item.kind} /><p>此文件格式不支持预览</p>
                <a className="btn-secondary" download href={fileUrl(item.id)}><Download size={16} /> 下载原文件</a></div>}
          </div>
          {index > 0 && <button className="icon-button viewer-prev" aria-label="上一项" title="上一项 (←)" onClick={() => select(items[index - 1])}><ChevronLeft size={24} /></button>}
          {index < items.length - 1 && <button className="icon-button viewer-next" aria-label="下一项" title="下一项 (→)" onClick={() => select(items[index + 1])}><ChevronRight size={24} /></button>}
        </div>
        {showInfo && <ViewerInfo key={item.id} item={item} onClose={() => setShowInfo(false)} />}
      </div>

      <footer className="viewer-footer">
        <div className="viewer-zoom">
          {image && !failed && <>
            <button className="icon-button" aria-label="缩小预览" disabled={zoom <= 1} onClick={() => setZoom(1 / 1.25)}><Minus size={17} /></button>
            <output aria-label="预览缩放">{Math.round(zoom * 100)}%</output>
            <button className="icon-button" aria-label="放大预览" disabled={zoom >= 8} onClick={() => setZoom(1.25)}><Plus size={17} /></button>
            <button className="icon-button" aria-label="适应窗口" title="适应窗口" onClick={() => setTransform(origin)}><Maximize size={15} /></button>
          </>}
        </div>
        {items.length > 1 && <div className="viewer-filmstrip" aria-label="快速切换素材">
          {items.slice(filmStart, filmStart + 5).map((thumb) => <button key={thumb.id} type="button" aria-label={`预览 ${thumb.name}`} aria-current={item.id === thumb.id ? "true" : undefined}
            title={thumb.name} onClick={() => select(thumb)}><Thumb id={thumb.id} kind={thumb.kind} className="w-full h-full" fallbackSize={15} /></button>)}
        </div>}
        <div className="viewer-rating"><Stars value={item.rating} onChange={rate} size={17} /></div>
      </footer>
    </div>
  </Dialog>;
}

function ViewerInfo({ item, onClose }: { item: Item; onClose: () => void }) {
  const [exif, setExif] = useState<Exif | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{ exif: Exif | null }>(`/items/${item.id}`, { signal: controller.signal }).then(({ exif }) => setExif(exif)).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [item.id]);
  return <aside className="viewer-info" aria-label="预览信息">
    <header><h3>素材信息</h3><button className="icon-button" aria-label="关闭预览信息" onClick={onClose}><X size={17} /></button></header>
    <div className="detail-section"><h3>基本信息</h3><dl className="detail-rows">
      <DataRow label="类型" value={`${KINDS[item.kind as keyof typeof KINDS] ?? item.kind} · ${item.ext.toUpperCase()}`} />
      <DataRow label="尺寸" value={item.width && item.height ? `${item.width} × ${item.height}` : "—"} />
      <DataRow label="大小" value={humanSize(item.size)} /><DataRow label="添加时间" value={fmtDate(item.addedAt)} />
    </dl></div>
    <div className="detail-section"><h3>标签</h3><TagEditor item={item} /></div>
    {item.note && <div className="detail-section"><h3>注释</h3><p className="text-muted text-xs whitespace-pre-wrap break-words">{item.note}</p></div>}
    {exif && Object.keys(exif).length > 0 && <div className="detail-section"><h3>EXIF</h3>
      <dl className="detail-rows">{Object.entries(exif).map(([key, value]) => <DataRow key={key} label={EXIF_LABELS[key] ?? key} value={String(value)} />)}</dl>
    </div>}
    {failed && <p className="inline-error p-3">EXIF 信息暂不可用。</p>}
  </aside>;
}
