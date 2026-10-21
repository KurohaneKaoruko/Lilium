import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store/useStore";
import { thumbUrl } from "../../api/client";
import {
  buildMosaic,
  type MosaicLayout,
  type WorldTile,
} from "../../lib/infinite";
import {
  reflowCurve,
  PAN_INERTIA,
  WHEEL_SMOOTHING,
} from "../../lib/wallMotion";

/**
 * 无限视图(全屏沉浸封面墙):
 *
 * - 周期点阵密铺:12×8 块精确铺满,素材循环取模,任何方向平移都无缝
 * - 相机:拖拽跟手,松手惯性滑行;滚轮离散步长指数平滑追帧;Ctrl+滚轮缩放
 * - 单击卡片:同块 11 卡按弹簧曲线让位重排,该卡放大为 6×6,镜头同步聚焦
 * - 双击打开大图;Esc 先收起再退出
 *
 * 渲染结构与运动模型:
 *   容器(裁剪) ← 镜头层(唯一 transform,每次相机写入直写) ← 瓦片(left/top/w/h)
 *   瓦片的重排动画由 JS 相机循环同帧驱动(与镜头同一条弹簧曲线),不靠 CSS 过渡,
 *   因此任何时刻读到的样式都是「当前帧位置」,多层动画永不脱节。
 */
export default function InfiniteView() {
  const items = useStore((s) => s.items);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setLightbox = useStore((s) => s.setLightbox);
  const setView = useStore((s) => s.setView);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // 相机状态用 ref(每帧直写 DOM,不走 React 状态 —— 与手势同频,零重渲染)
  const cam = useRef({ tx: 0, ty: 0, z: 1 });
  const [renderTick, forceRender] = useState(0);

  /** 展开中的实例 */
  const [picked, setPicked] = useState<{ bx: number; by: number; slot: number } | null>(null);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  const dragRef = useRef<{
    x: number; y: number; tx: number; ty: number; moved: boolean;
    lastT: number; vx: number; vy: number; px?: number; py?: number;
  } | null>(null);
  const lastClick = useRef<{ key: string; t: number } | null>(null);

  /** 相机动画循环:目标驱动(惯性/滚轮/聚焦共用)。raf 字段实为 interval handle */
  const camAnim = useRef<{
    raf: number | null;
    // 惯性速度
    vx: number; vy: number;
    // 滚轮待走位移
    wx: number; wy: number;
    // 聚焦弹簧(null = 无;记录「起点→终点」的位移,便于中断重定向)
    focusDx: number | null; focusDy: number | null;
    startTx: number; startTy: number; focusT0: number;
    focusDuration: number;
    ease: (p: number) => number;
    progress: number;
    lastT: number;
  } | null>(null);

  const stopCamAnim = () => {
    if (camAnim.current?.raf != null) clearInterval(camAnim.current.raf);
    camAnim.current = null;
  };

  /** 相机「已生成瓦片」时的状态;漂移超过半块宽/高 → ensureCover 扩边 */
  const camAnchor = useRef<{ tx: number; ty: number; spanX: number; spanY: number } | null>(null);

  /** 把相机直写到镜头层,并按需扩边补发瓦片 */
  const applyCamera = useCallback(() => {
    const el = worldRef.current;
    if (!el) return;
    const { tx, ty, z } = cam.current;
    el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${z.toFixed(4)})`;
    // 相机离上次生成瓦片时的位置漂移超过半块宽/高 → 需要扩边,走一次 React 渲染补瓦片
    const anchor = camAnchor.current;
    if (anchor && (Math.abs(tx - anchor.tx) > anchor.spanX || Math.abs(ty - anchor.ty) > anchor.spanY)) {
      forceRender((v) => v + 1);
    }
  }, []);

  const startCamAnim = useCallback(() => {
    if (camAnim.current) return;
    camAnim.current = {
      raf: null, vx: 0, vy: 0, wx: 0, wy: 0,
      focusDx: null, focusDy: null, startTx: 0, startTy: 0, focusT0: 0,
      focusDuration: 1, ease: (p) => p, progress: 1,
      lastT: performance.now(),
    };
    const tick = () => {
      const s = camAnim.current;
      if (!s) return;
      const now = performance.now();
      const dt = Math.min((now - s.lastT) / 1000, WHEEL_SMOOTHING.maxFrameMs / 1000);
      s.lastT = now;
      const c = cam.current;

      // 1) 聚焦弹簧(与让位同一数值积分,同频同落定)
      if (s.focusDx != null && s.focusDy != null) {
        if (!s.focusT0) {
          s.focusT0 = now;
          s.progress = 0;
        }
        s.progress = Math.min(1, s.progress + dt * 1000 / s.focusDuration);
        const e = s.progress >= 1 ? 1 : s.ease(s.progress);
        c.tx = s.startTx + s.focusDx * e;
        c.ty = s.startTy + s.focusDy * e;
        if (s.progress >= 1) {
          c.tx = s.startTx + s.focusDx;
          c.ty = s.startTy + s.focusDy;
          s.focusDx = null;
          s.focusDy = null;
          s.focusT0 = 0;
          s.progress = 1;
        }
      }

      // 2) 惯性滑行
      if (s.vx !== 0 || s.vy !== 0) {
        const decay = Math.exp((-dt * 1000) / PAN_INERTIA.timeConstant);
        c.tx += s.vx * dt;
        c.ty += s.vy * dt;
        s.vx *= decay;
        s.vy *= decay;
        if (Math.hypot(s.vx, s.vy) < PAN_INERTIA.minSpeed) {
          s.vx = 0;
          s.vy = 0;
        }
      }

      // 3) 滚轮待走位移指数追帧
      if (s.wx !== 0 || s.wy !== 0) {
        const alpha = 1 - Math.exp((-dt * 1000) / WHEEL_SMOOTHING.timeConstantMs);
        const stepX = s.wx * alpha;
        const stepY = s.wy * alpha;
        c.tx += stepX;
        c.ty += stepY;
        s.wx -= stepX;
        s.wy -= stepY;
        if (Math.hypot(s.wx, s.wy) < WHEEL_SMOOTHING.restDistancePx) {
          s.wx = 0;
          s.wy = 0;
        }
      }

      applyCamera();
      if (
        s.focusDx == null &&
        s.vx === 0 && s.vy === 0 &&
        s.wx === 0 && s.wy === 0
      ) {
        camAnim.current = null;
        clearInterval(handle);
        return;
      }
    };
    // setInterval 而非 rAF:窗口被遮挡/切后台时 rAF 冻结,镜头会僵在半路;interval 靠
    // lastT 的 dt 计时,节流时只是变慢、不跳变,恢复可见后无缝继续
    const handle = setInterval(tick, 16);
    camAnim.current.raf = handle;
  }, [applyCamera]);

  /** 平滑聚焦世界点(与让位同一弹簧曲线,同频同落定) */
  const glideTo = useCallback(
    (wx: number, wy: number) => {
      const c = cam.current;
      const endTx = size.w / 2 - wx * c.z;
      const endTy = size.h / 2 - wy * c.z;
      const dist = Math.hypot(endTx - c.tx, endTy - c.ty) / Math.max(c.z, 0.01);
      const ease = reflowCurve(dist);
      if (!camAnim.current) startCamAnim();
      const s = camAnim.current!;
      s.startTx = c.tx;
      s.startTy = c.ty;
      s.focusDx = endTx - c.tx;
      s.focusDy = endTy - c.ty;
      s.focusDuration = ease.durationMs;
      s.ease = ease.ease;
      s.focusT0 = 0;
    },
    [size, startCamAnim],
  );

  // 视口尺寸:容器挂载即观察(items 未就绪时组件早退占位,容器此时才真正出现)
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  // 布局引擎实例(带真实纵横比,展开卡按原图比例显示)
  const layout = useMemo(
    () => buildMosaic(items.map((it) => ({ id: it.id, aspect: it.width && it.height ? it.width / it.height : 1 }))),
    [items],
  );

  /** 刚发生过展开/收起 → 瓦片布局属性带弹簧过渡;起止状态稳定后移除 */
  const [reflowing, setReflowing] = useState(false);
  const reflowTimer = useRef<number | null>(null);
  const beginReflow = useCallback(() => {
    setReflowing(true);
    if (reflowTimer.current !== null) window.clearTimeout(reflowTimer.current);
    reflowTimer.current = window.setTimeout(
      () => setReflowing(false),
      (reflowCurve(816).durationMs | 0) + 60,
    );
  }, []);
  useEffect(
    () => () => {
      if (reflowTimer.current !== null) window.clearTimeout(reflowTimer.current);
    },
    [],
  );
  /** 展开/收起都走同一物理:重排 + 镜头弹簧聚焦;返回实际生效的目标 */
  const applyPicked = useCallback(
    (p: { bx: number; by: number; slot: number } | null) => {
      beginReflow();
      if (p) {
        layout.setExpanded(p.bx, p.by, p.slot);
        setPicked(p);
        const hero = layout.heroRect(p.bx, p.by, p.slot);
        if (hero) glideTo(hero.cx, hero.cy);
      } else {
        layout.clearExpanded();
        setPicked(null);
        if (pickedRef.current) {
          // 镜头回到被收起卡所在块的中心
          const q = pickedRef.current;
          const c = layout.blockCenter(q.bx, q.by);
          glideTo(c.x, c.y);
        }
      }
    },
    [layout, glideTo, beginReflow],
  );

  // 首帧:按视口定缩放,把原点块放到中心(视口测量就绪即定位,不等 items)
  const didCenterRef = useRef(false);
  useEffect(() => {
    if (didCenterRef.current || size.w < 100) return;
    didCenterRef.current = true;
    const z0 = Math.min(1.6, Math.max(0.5, size.h / 1000));
    cam.current.z = z0;
    cam.current.tx = size.w / 2;
    cam.current.ty = size.h / 2;
    applyCamera();
    forceRender((v) => v + 1);
  }, [size, applyCamera]);

  // 可见瓦片(picked/size/扩边请求变化时重算;平时相机平移直写 DOM,不重算)
  const tiles: WorldTile[] = useMemo(() => {
    const c = cam.current;
    const worldX0 = (0 - c.tx) / c.z;
    const worldY0 = (0 - c.ty) / c.z;
    const worldX1 = (size.w - c.tx) / c.z;
    const worldY1 = (size.h - c.ty) / c.z;
    const next = layout.ensureCover({ x0: worldX0, y0: worldY0, x1: worldX1, y1: worldY1 });
    // 记录「瓦片已覆盖」的相机位置:ensureCover 只垫 200 世界像素,漂移要在这之内触发扩边
    camAnchor.current = {
      tx: c.tx,
      ty: c.ty,
      spanX: 120 * c.z,
      spanY: 120 * c.z,
    };
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, size, picked, renderTick]);

  // 键盘:Esc → 先收左栏,再收起展开卡,最后退出视图(顶栏固定,不参与)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (useStore.getState().lightboxId) return;
      if (e.key === "Escape") {
        const st = useStore.getState();
        if (st.chromeLeft) {
          st.setChromeLeft(false);
          return;
        }
        if (pickedRef.current) applyPicked(null);
        else setView("masonry");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [applyPicked, setView]);

  /** 墙面交互(拖拽/滚轮)→ 收回左栏 */
  const wallInteract = useCallback(() => {
    const st = useStore.getState();
    if (!st.chromeHovering && st.chromeLeft) st.setChromeLeft(false);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    stopCamAnim();
    wallInteract();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const c = cam.current;
    dragRef.current = {
      x: e.clientX, y: e.clientY, tx: c.tx, ty: c.ty, moved: false,
      lastT: performance.now(), vx: 0, vy: 0,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const now = performance.now();
    const dt = Math.max(now - d.lastT, 1) / 1000;
    // 速度低通(供惯性)
    const instVx = (e.clientX - (d.px ?? e.clientX)) / dt;
    const instVy = (e.clientY - (d.py ?? e.clientY)) / dt;
    d.vx = d.vx * 0.7 + instVx * 0.3;
    d.vy = d.vy * 0.7 + instVy * 0.3;
    d.px = e.clientX;
    d.py = e.clientY;
    d.lastT = now;
    const c = cam.current;
    c.tx = d.tx + dx;
    c.ty = d.ty + dy;
    applyCamera();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    // 惯性:距离松手足够近且速度够大才滑
    const stale = performance.now() - d.lastT > PAN_INERTIA.staleReleaseMs;
    if (d.moved && !stale && Math.hypot(d.vx, d.vy) >= PAN_INERTIA.minSpeed) {
      const vx = Math.max(-PAN_INERTIA.maxSpeed, Math.min(PAN_INERTIA.maxSpeed, d.vx));
      const vy = Math.max(-PAN_INERTIA.maxSpeed, Math.min(PAN_INERTIA.maxSpeed, d.vy));
      if (!camAnim.current) startCamAnim();
      camAnim.current!.vx = vx;
      camAnim.current!.vy = vy;
    }
    if (!d.moved) {
      // 单击命中
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
      const prev = lastClick.current;
      const id = tileEl.dataset.tile;
      if (prev && prev.key === key && Date.now() - prev.t < 350) {
        // 双击(350ms 内同瓦片二次单击)→ 大图预览
        lastClick.current = null;
        if (id) {
          select(id, "set");
          setLightbox(id);
        }
        return;
      }
      lastClick.current = { key, t: Date.now() };
      if (pickedRef.current?.bx === bx && pickedRef.current?.by === by && pickedRef.current?.slot === slot) {
        applyPicked(null);
        return;
      }
      applyPicked({ bx, by, slot });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    wallInteract();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0022);
      cam.current.z = Math.min(2.5, Math.max(0.3, cam.current.z * f));
      applyCamera();
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? e.deltaX : e.deltaY;
    if (!camAnim.current) startCamAnim();
    camAnim.current!.wx -= dx;
    camAnim.current!.wy -= dy;
  };

  /** 兜底:容器上原生 dblclick(合成单击检测可能因瓦片重排丢序)也打开灯箱 */
  const onContainerDoubleClick = (e: React.MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tileEl = el?.closest("[data-tile]") as HTMLElement | null;
    const id = tileEl?.dataset.tile;
    if (!id) return;
    e.stopPropagation();
    select(id, "set");
    setLightbox(id);
  };

  const onTileDoubleClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    select(id, "set");
    setLightbox(id);
  };

  // 让位曲线:块内重排的最大位移决定时长;所有瓦片共用一条(线性系统,同曲线同终点)
  const reflow = useMemo(() => {
    if (!picked) return null;
    // 预热曲线缓存(块内位移 ≤ 块宽)
    return reflowCurve(816);
  }, [picked]);


  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm bg-[#0a0b0f]">
        没有可显示的图片
      </div>
    );
  }

  // 让位弹簧的时长/曲线;调暗与描边过渡跟它同频,视觉上一步到位不脱节
  const settle = reflowCurve(816).durationMs | 0;
  const easeCss = reflowCurve(816).css;
  const tileTransition = reflowing
    ? ["left", "top", "width", "height"].map((p) => `${p} ${settle}ms ${easeCss}`).join(", ")
    : undefined;

  return (
    <div className="relative flex-1 overflow-hidden bg-[#0a0b0f] no-select">
      <div
        ref={attachContainer}
        className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onContainerDoubleClick}
      >
        <div ref={worldRef} className="absolute inset-0" style={{ transformOrigin: "0 0" }}>
          {tiles.map((t) => {
            const key = `${t.blockX}:${t.blockY}:${t.slot}`;
            const isPicked = !!t.expanded;
            const selected = selection.has(t.id);
            return (
              <div
                key={key}
                data-tile={t.id}
                data-key={key}
                className={`absolute tile-outer ${isPicked ? "" : ""}`}
                style={{
                  left: t.x,
                  top: t.y,
                  width: t.w,
                  height: t.h,
                  zIndex: isPicked ? 20 : selected ? 5 : 1,
                  transition: tileTransition,
                }}
                onDoubleClick={(e) => onTileDoubleClick(e, t.id)}
              >
                <div
                  data-picked={isPicked ? "1" : "0"}
                  className={`absolute inset-0 overflow-hidden pointer-events-auto tile-wrap ${isPicked ? "!cursor-default" : ""}`}
                  style={{
                    transition: picked
                      ? `filter ${settle}ms ${easeCss}, box-shadow ${settle}ms ${easeCss}, border-radius ${settle}ms ${easeCss}`
                      : "none",
                    filter: picked && !isPicked ? "brightness(0.72)" : "none",
                    borderRadius: isPicked ? 3 : 0,
                    boxShadow: isPicked
                      ? "0 0 0 1.5px rgba(255,255,255,.95), 0 0 0 5px rgba(255,255,255,.14), 0 24px 80px rgba(0,0,0,.6)"
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
      </div>

      {/* 顶部/底部渐隐遮罩 */}
      <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
    </div>
  );
}
