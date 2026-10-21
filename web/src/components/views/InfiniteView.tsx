import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStore } from "../../store/useStore";
import { thumbUrl } from "../../api/client";
import {
  buildMosaic,
  type MosaicLayout,
  type WorldTile,
} from "../../lib/infinite";

/**
 * 无限视图(全屏沉浸封面墙,沉浸式封面墙):
 *
 * - 周期点阵密铺:12×8 块精确铺满,素材循环取模,任何方向平移都无缝
 * - 滚轮平移(Shift 横向)、Ctrl+滚轮缩放、拖拽自由平移
 * - 单击卡片:同块 11 卡「换挡重排」,该卡放大为 6×6,块内依旧精确铺满
 *   —— 不悬浮、不推开、无黑洞;再点一次还原
 * - 双击打开大图;Esc 或左上角按钮退出
 */
export default function InfiniteView() {
  const items = useStore((s) => s.items);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setLightbox = useStore((s) => s.setLightbox);
  const setView = useStore((s) => s.setView);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [z, setZ] = useState(1);
  /** 展开中的实例 */
  const [picked, setPicked] = useState<{ bx: number; by: number; slot: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPan = useRef<{ tx: number; ty: number } | null>(null);
  const animRef = useRef<number | null>(null);
  const lastClick = useRef<{ key: string; t: number } | null>(null);

  // 视口尺寸
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 布局引擎实例
  const layout = useMemo(() => buildMosaic(items.map((it) => ({ id: it.id, aspect: 1 }))), [items]);

  /** 展开/收起:立即同步给引擎(失效受影响块的缓存),再更新 React 状态触发重渲染 */
  const applyPicked = useCallback(
    (p: { bx: number; by: number; slot: number } | null) => {
      if (p) layout.setExpanded(p.bx, p.by, p.slot);
      else layout.clearExpanded();
      setPicked(p);
    },
    [layout],
  );

  /** 平滑居中世界点 */
  const glideTo = useCallback(
    (wx: number, wy: number) => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      const startTx = tx;
      const startTy = ty;
      const endTx = size.w / 2 - wx * z;
      const endTy = size.h / 2 - wy * z;
      const t0 = performance.now();
      const dur = 500;
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = ease(p);
        setTx(startTx + (endTx - startTx) * e);
        setTy(startTy + (endTy - startTy) * e);
        if (p < 1) animRef.current = requestAnimationFrame(step);
        else animRef.current = null;
      };
      animRef.current = requestAnimationFrame(step);
    },
    [tx, ty, z, size],
  );

  // 首帧:按视口定缩放,把原点块放到中心
  const didCenterRef = useRef(false);
  useEffect(() => {
    if (didCenterRef.current || size.w < 100 || !containerRef.current) return;
    didCenterRef.current = true;
    const z0 = Math.min(1.6, Math.max(0.5, size.h / 1000));
    setZ(z0);
    setTx(size.w / 2);
    setTy(size.h / 2);
  }, [size]);

  // 可见瓦片
  const tiles: WorldTile[] = useMemo(() => {
    const worldX0 = (0 - tx) / z;
    const worldY0 = (0 - ty) / z;
    const worldX1 = (size.w - tx) / z;
    const worldY1 = (size.h - ty) / z;
    return layout.ensureCover({ x0: worldX0, y0: worldY0, x1: worldX1, y1: worldY1 });
  }, [layout, tx, ty, z, size, picked]);

  // 键盘:Esc 退出
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (useStore.getState().lightboxId) return;
      if (e.key === "Escape") {
        if (picked) applyPicked(null);
        else setView("masonry");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [picked, setView]);

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

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      schedulePan(d.tx + dx, d.ty + dy);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved) return;
    // 单击命中检测
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tileEl = el?.closest("[data-tile]") as HTMLElement | null;
    const key = tileEl?.dataset.key;
    if (!key) return;
    const [bx, by, slot] = key.split(":").map(Number);
    if (e.shiftKey) {
      const id = tileEl.dataset.tile;
      if (id) select(id, "range");
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const id = tileEl.dataset.tile;
      if (id) select(id, "toggle");
      return;
    }
    // 双击的第二次点击交给 dblclick
    const prev = lastClick.current;
    if (prev && prev.key === key && Date.now() - prev.t < 350) return;
    lastClick.current = { key, t: Date.now() };
    // 展开该卡:平滑把块中心带到视口中心
    if (picked?.bx === bx && picked?.by === by && picked?.slot === slot) {
      applyPicked(null);
      return;
    }
    applyPicked({ bx, by, slot });
    const t = tiles.find((tt) => tt.blockX === bx && tt.blockY === by && tt.slot === slot);
    if (t) glideTo(t.x + t.w / 2, t.y + t.h / 2);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0022);
      setZ((old) => Math.min(2.5, Math.max(0.3, old * f)));
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? e.deltaX : e.deltaY;
    if (dx) schedulePan(tx - dx, ty);
    if (dy) schedulePan(tx, ty - dy);
  };

  const onTileDoubleClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    select(id, "set");
    setLightbox(id);
  };

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm bg-[#0a0b0f]">
        没有可显示的图片
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-[#0a0b0f] no-select">
      <div
        ref={containerRef}
        className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {tiles.map((t) => {
          const key = `${t.blockX}:${t.blockY}:${t.slot}`;
          const isPicked = !!t.expanded;
          const selected = selection.has(t.id);
          return (
            <div
              key={key}
              data-tile={t.id}
              data-key={key}
              className="absolute"
              style={{
                transform: `translate3d(${t.x * z + tx}px, ${t.y * z + ty}px, 0)`,
                width: t.w * z,
                height: t.h * z,
                zIndex: isPicked ? 20 : selected ? 5 : 1,
              }}
              onDoubleClick={(e) => onTileDoubleClick(e, t.id)}
            >
              <div
                className="absolute inset-0 overflow-hidden"
                style={{
                  transition: "filter 400ms ease, box-shadow 400ms ease",
                  filter: picked && !isPicked ? "brightness(0.8)" : "none",
                  borderRadius: isPicked ? 2 : 0,
                  boxShadow: isPicked
                    ? "0 0 0 1.2px rgba(255,255,255,.95), 0 10px 40px rgba(0,0,0,.4)"
                    : selected
                      ? "inset 0 0 0 2px rgba(167,139,250,.6)"
                      : "none",
                }}
              >
                <img
                  src={thumbUrl(t.id)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="w-full h-full object-cover pointer-events-none"
                  style={{ backgroundColor: "#15171c" }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 顶部/底部渐隐遮罩 */}
      <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />

      {/* 退出按钮 */}
      <button
        className="absolute left-4 top-4 w-9 h-9 rounded-full bg-black/55 backdrop-blur border border-white/10 text-neutral-200 flex items-center justify-center hover:bg-black/75 z-30"
        title="退出 (Esc)"
        onClick={() => setView("masonry")}
      >
        <X size={17} />
      </button>
    </div>
  );
}
