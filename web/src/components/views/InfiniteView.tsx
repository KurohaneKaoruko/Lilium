import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStore } from "../../store/useStore";
import { itemAspectRatio, thumbUrl } from "../../api/client";
import { buildMosaic, type MosaicLayout, type WorldTile } from "../../lib/infinite";

/**
 * 无限视图（全屏沉浸画布）：封面墙铺满整个屏幕。
 *
 * - 全屏接管：顶栏/侧栏/详情面板隐藏，Esc 或左上角按钮退出
 * - 瓦片按纵横比完整显示整张图片，素材循环取模，任何方向都密铺到底
 * - 画布式交互：滚轮平移（Shift+滚轮横向）、Ctrl+滚轮缩放、拖拽自由平移
 * - 单击瓦片：镜头平滑居中并放大为「当前展示」卡（约 2/3 视口高，细白描边），
 *   其余图片压暗；再点一次还原；双击打开大图
 * - ←/→ 步进展示目标
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
  /** 当前放大强调的卡片 id */
  const [pickedId, setPickedId] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPan = useRef<{ tx: number; ty: number } | null>(null);
  /** 镜头平滑动画 */
  const animRef = useRef<number | null>(null);
  /** 防止双击时第二次单击把刚放大的图还原 */
  const lastClick = useRef<{ id: string; t: number } | null>(null);

  // 量取视口尺寸
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const layout: MosaicLayout = useMemo(
    () => buildMosaic(items.map((it) => ({ id: it.id, aspect: itemAspectRatio(it) }))),
    [items],
  );

  /** 步进顺序 = items 顺序 */
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);

  /** 把世界坐标 (wx,wy) 平滑移到屏幕中心 */
  const glideTo = useCallback(
    (wx: number, wy: number) => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      const startTx = tx;
      const startTy = ty;
      const endTx = size.w / 2 - wx * z;
      const endTy = size.h / 2 - wy * z;
      const t0 = performance.now();
      const dur = 550;
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

  /** 选中呈现：镜头平滑居中该图，配合内层放大到接近参考的展示尺寸 */
  const pickTile = useCallback(
    (id: string, opts?: { instant?: boolean }) => {
      const tile = layout.allTiles().find((t) => t.id === id);
      setPickedId(id);
      if (!tile) return;
      if (opts?.instant) {
        if (animRef.current !== null) {
          cancelAnimationFrame(animRef.current);
          animRef.current = null;
        }
        setTx(size.w / 2 - (tile.x + tile.w / 2) * z);
        setTy(size.h / 2 - (tile.y + tile.h / 2) * z);
      } else {
        glideTo(tile.x + tile.w / 2, tile.y + tile.h / 2);
      }
    },
    [layout, glideTo, z, size],
  );

  /** 下一个放大目标（items 顺序，循环） */
  const stepPick = useCallback(
    (dir: 1 | -1) => {
      if (orderedIds.length === 0) return;
      let idx = pickedId ? orderedIds.indexOf(pickedId) : -1;
      idx = (idx + dir + orderedIds.length) % orderedIds.length;
      pickTile(orderedIds[idx]);
    },
    [orderedIds, pickedId, pickTile],
  );

  // 首帧：画布基准缩放（按视口高度定密度），并把第一张放到中心，不做动画
  const didCenterRef = useRef(false);
  useEffect(() => {
    if (didCenterRef.current || size.w < 100 || !containerRef.current) return;
    const first = items[0];
    if (!first) return;
    const tile = layout.allTiles().find((t) => t.id === first.id);
    if (!tile) return;
    didCenterRef.current = true;
    const z0 = Math.min(1.8, Math.max(0.55, size.h / 1150));
    setZ(z0);
    setTx(size.w / 2 - (tile.x + tile.w / 2) * z0);
    setTy(size.h / 2 - (tile.y + tile.h / 2) * z0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, layout]);

  // 可见区域瓦片
  const tiles: WorldTile[] = useMemo(() => {
    const worldX0 = (0 - tx) / z;
    const worldY0 = (0 - ty) / z;
    const worldX1 = (size.w - tx) / z;
    const worldY1 = (size.h - ty) / z;
    return layout.ensureCover({ x0: worldX0, y0: worldY0, x1: worldX1, y1: worldY1 });
  }, [layout, tx, ty, z, size]);

  // 素材循环复用后同一 id 可能出现多个实例：放大"距屏幕中心最近"的那个
  const nearestPickedTile: WorldTile | null = useMemo(() => {
    if (!pickedId) return null;
    const cx = (size.w / 2 - tx) / z;
    const cy = (size.h / 2 - ty) / z;
    let best: WorldTile | null = null;
    let bd = Infinity;
    const consider = (t: WorldTile) => {
      if (t.id !== pickedId) return;
      const dx = t.x + t.w / 2 - cx;
      const dy = t.y + t.h / 2 - cy;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = t;
      }
    };
    for (const t of tiles) consider(t);
    // 完全不在视野时，回退到全局最近实例（保证 ←/→ 步进有落点）
    if (!best) for (const t of layout.allTiles()) consider(t);
    return best as WorldTile | null;
  }, [tiles, layout, pickedId, tx, ty, z, size]);

  // 键盘：←/→ 步进放大目标，Esc 退出
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (useStore.getState().lightboxId) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        stepPick(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepPick(-1);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [stepPick]);

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
    // 捕获指针：拖到窗口外/快速移动也不丢事件
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
    if (!d) return;
    // 自由平移：不吸附、不回弹
    if (!d.moved) {
      // 单击：命中检测
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tileEl = el?.closest("[data-tile]") as HTMLElement | null;
      const id = tileEl?.dataset.tile;
      if (id) {
        if (e.shiftKey) select(id, "range");
        else if (e.ctrlKey || e.metaKey) select(id, "toggle");
        else {
          // 双击的第二次点击不再还原，交给 dblclick 打开大图
          const prev = lastClick.current;
          const rapid = prev && prev.id === id && Date.now() - prev.t < 350;
          lastClick.current = { id, t: Date.now() };
          if (!rapid) {
            if (id === pickedId) setPickedId(null);
            else pickTile(id);
          }
        }
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    // 画布式：滚轮 = 平移（shift+滚轮横向），Ctrl+滚轮 = 缩放
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0022);
      setZ((old) => Math.min(3, Math.max(0.3, old * f)));
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? e.deltaX : e.deltaY;
    if (dx) schedulePan(tx - dx, ty);
    if (dy) schedulePan(tx, ty - dy);
  };

  // 双击打开灯箱
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
      {/* 画布：图片密铺填满整屏 */}
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
          const picked = t === nearestPickedTile;
          const selected = selection.has(t.id);
          const key = `${t.id}#${Math.round(t.x)}x${Math.round(t.y)}`;
          // 选中放大倍率：约 66% 视口高、55% 视口宽封顶，限制在 1.15–4
          let pickScale = 1;
          if (picked) {
            const sh = t.h * z;
            const sw = t.w * z;
            pickScale = Math.min(
              4,
              Math.max(1.15, Math.min((size.h * 0.66) / sh, (size.w * 0.55) / sw)),
            );
          }
          return (
            <div
              key={key}
              data-tile={t.id}
              className="absolute"
              style={{
                transform: `translate3d(${t.x * z + tx}px, ${t.y * z + ty}px, 0)`,
                width: t.w * z,
                height: t.h * z,
                zIndex: picked ? 30 : selected ? 5 : 1,
              }}
              onDoubleClick={(e) => onTileDoubleClick(e, t.id)}
            >
              {/* 内层负责缩放动画：只有被选中的那张动，平移始终零延迟 */}
              <div
                className="absolute inset-0 overflow-hidden transition-[transform,opacity,box-shadow,filter] duration-500 ease-out"
                style={{
                  transform: `scale(${picked ? pickScale : 1})`,
                  transformOrigin: "center",
                  opacity: pickedId ? (picked ? 1 : 0.62) : 0.92,
                  filter: pickedId && !picked ? "brightness(0.5)" : "none",
                  borderRadius: picked ? 4 : 0,
                  boxShadow: picked
                    ? "0 0 0 1.5px rgba(255,255,255,.9), 0 24px 70px rgba(0,0,0,.5)"
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
