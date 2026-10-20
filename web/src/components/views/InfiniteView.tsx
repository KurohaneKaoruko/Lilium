import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useStore } from "../../store/useStore";
import { itemAspectRatio, thumbUrl } from "../../api/client";
import { buildMosaic, type MosaicLayout, type WorldTile } from "../../lib/infinite";

/**
 * 无限视图：全部图片拼贴在同一平面，可向任意方向平移、缩放浏览。
 * - 拖拽平移；滚轮缩放（以光标为中心）；Shift+滚轮 垂直平移
 * - 点击选择，Ctrl+点击 多选，Shift+点击 范围选择
 * - 双击打开大图预览
 * - 布局按需惰性生成（环形生长算法），数万张图也流畅
 */
export default function InfiniteView() {
  const items = useStore((s) => s.items);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setLightbox = useStore((s) => s.setLightbox);
  const setDetail = useStore((s) => s.setDetail);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [z, setZ] = useState(0.62);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);

  const layout: MosaicLayout = useMemo(
    () => buildMosaic(items.map((it) => ({ id: it.id, aspect: itemAspectRatio(it) }))),
    [items],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    // 初始定位到原点附近
    setTx(el.clientWidth / 2);
    setTy(el.clientHeight / 2);
    return () => ro.disconnect();
  }, []);

  // 世界→屏幕
  const sx = (wx: number) => wx * z + tx;
  const sy = (wy: number) => wy * z + ty;

  // 平移时用 rAF 节流，避免高频 setState
  const rafRef = useRef<number | null>(null);
  const pendingPan = useRef<{ tx: number; ty: number } | null>(null);
  const schedulePan = (nextTx: number, nextTy: number) => {
    pendingPan.current = { tx: nextTx, ty: nextTy };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const p = pendingPan.current;
        if (p) {
          setTx(p.tx);
          setTy(p.ty);
        }
      });
    }
  };

  const tiles: WorldTile[] = useMemo(() => {
    const worldX0 = (0 - tx) / z;
    const worldY0 = (0 - ty) / z;
    const worldX1 = (size.w - tx) / z;
    const worldY1 = (size.h - ty) / z;
    return layout.ensureCover({ x0: worldX0, y0: worldY0, x1: worldX1, y1: worldY1 });
  }, [layout, tx, ty, z, size]);

  // ID→条目映射（替代列表里的 O(n) find）
  const itemById = useMemo(() => {
    const m = new Map<string, (typeof items)[number]>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  // ---- 交互 ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (e.shiftKey) {
      marqueeStart.current = { x: e.clientX, y: e.clientY };
      setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
    } else {
      dragRef.current = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      schedulePan(d.tx + dx, d.ty + dy);
      return;
    }
    const m = marqueeStart.current;
    if (m) {
      setMarquee((prev) => (prev ? { ...prev, x1: e.clientX, y1: e.clientY } : prev));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    const m = marqueeStart.current;
    marqueeStart.current = null;
    if (m && marquee) {
      // 框选：转换为世界坐标命中
      const wx0 = (Math.min(marquee.x0, marquee.x1) - tx) / z;
      const wx1 = (Math.max(marquee.x0, marquee.x1) - tx) / z;
      const wy0 = (Math.min(marquee.y0, marquee.y1) - ty) / z;
      const wy1 = (Math.max(marquee.y0, marquee.y1) - ty) / z;
      const hits = layout
        .allTiles()
        .filter((t) => t.x < wx1 && t.x + t.w > wx0 && t.y < wy1 && t.y + t.h > wy0)
        .map((t) => t.id);
      const next = new Set(useStore.getState().selection);
      for (const id of hits) next.add(id);
      useStore.setState({ selection: next });
      setMarquee(null);
      return;
    }
    if (d && !d.moved) {
      const target = e.target as HTMLElement;
      const tileId = target.closest("[data-tile]")?.getAttribute("data-tile");
      if (tileId) {
        if (e.ctrlKey || e.metaKey) select(tileId, "toggle");
        else if (e.shiftKey) select(tileId, "range");
        else select(tileId, "set");
        setDetail(tileId);
      } else {
        useStore.getState().clearSelection();
      }
    }
  };

  const onTileDoubleClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setLightbox(id);
  };

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey || !e.shiftKey) {
        // 缩放
        const factor = Math.exp(-e.deltaY * 0.0016);
        const nz = Math.max(0.12, Math.min(3.2, z * factor));
        const k = nz / z;
        setTx(mx - (mx - tx) * k);
        setTy(my - (my - ty) * k);
        setZ(nz);
      } else {
        setTy(ty - e.deltaY);
      }
    },
    [z, tx, ty],
  );

  const recenter = () => {
    setTx(size.w / 2);
    setTy(size.h / 2);
    setZ(0.62);
  };

  const zoomBy = (f: number) => {
    const nz = Math.max(0.12, Math.min(3.2, z * f));
    const k = nz / z;
    setTx(size.w / 2 - (size.w / 2 - tx) * k);
    setTy(size.h / 2 - (size.h / 2 - ty) * k);
    setZ(nz);
  };

  // 空状态
  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500">
        <div className="text-center">
          <Maximize2 className="mx-auto mb-3 text-neutral-600" size={40} />
          <p>没有图片 —— 导入一些图片来体验无限视图</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-[#141519] no-select">
      {/* 点阵背景 */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, #2a2c33 1px, transparent 1px)",
          backgroundSize: `${44 * z}px ${44 * z}px`,
          backgroundPosition: `${tx}px ${ty}px`,
        }}
      />

      <div
        ref={containerRef}
        className="absolute inset-0 touch-none"
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {tiles.map((t) => {
          const selected = selection.has(t.id);
          return (
            <div
              key={t.id}
              data-tile={t.id}
              className="absolute overflow-hidden rounded-[3px]"
              style={{
                left: sx(t.x),
                top: sy(t.y),
                width: Math.max(2, t.w * z),
                height: Math.max(2, t.h * z),
                boxShadow: selected
                  ? "0 0 0 2px #a78bfa, 0 6px 18px rgba(0,0,0,.45)"
                  : "0 3px 10px rgba(0,0,0,.35)",
                zIndex: selected ? 5 : 1,
              }}
              onDoubleClick={(e) => onTileDoubleClick(e, t.id)}
            >
              <img
                src={thumbUrl(t.id)}
                alt=""
                loading="lazy"
                draggable={false}
                className="w-full h-full object-cover pointer-events-none"
                style={{ backgroundColor: "#26282f" }}
              />
            </div>
          );
        })}
      </div>

      {/* 框选矩形 */}
      {marquee && (
        <div
          className="absolute border border-violet-400/80 bg-violet-400/10 pointer-events-none"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}

      {/* 控制按钮 */}
      <div className="absolute right-4 bottom-4 flex flex-col gap-1.5 bg-panel/90 border border-border rounded-lg p-1 backdrop-blur">
        <button className="btn justify-center" title="放大" onClick={() => zoomBy(1.25)}>
          <ZoomIn size={15} />
        </button>
        <button className="btn justify-center" title="缩小" onClick={() => zoomBy(0.8)}>
          <ZoomOut size={15} />
        </button>
        <button className="btn justify-center" title="回到起点" onClick={recenter}>
          <Crosshair size={15} />
        </button>
        <button className="btn justify-center" title="全览" onClick={() => zoomBy(0.35)}>
          <Maximize2 size={15} />
        </button>
      </div>

      <div className="absolute left-4 bottom-4 text-[11px] text-neutral-500 bg-panel/80 border border-border rounded px-2 py-1 backdrop-blur">
        拖拽平移 · 滚轮缩放 · Shift+拖拽框选 · 双击预览 · 共 {items.length} 张
      </div>
    </div>
  );
}
