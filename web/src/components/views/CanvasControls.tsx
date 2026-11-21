import { LocateFixed, Minus, Plus } from "lucide-react";

export default function CanvasControls({ zoom, min, max, onZoom, onReset }: {
  zoom: number; min: number; max: number; onZoom: (factor: number) => void; onReset: () => void;
}) {
  return <div className="canvas-controls" role="group" aria-label="画布控制">
    <button className="icon-button" type="button" aria-label="缩小画布" title="缩小画布" disabled={zoom <= min} onClick={() => onZoom(1 / 1.2)}><Minus size={15} /></button>
    <output aria-label="画布缩放">{Math.round(zoom * 100)}%</output>
    <button className="icon-button" type="button" aria-label="放大画布" title="放大画布" disabled={zoom >= max} onClick={() => onZoom(1.2)}><Plus size={15} /></button>
    <i aria-hidden="true" />
    <button className="icon-button" type="button" aria-label="重置画布" title="重置画布" onClick={onReset}><LocateFixed size={16} /></button>
  </div>;
}

export function prefersReducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
