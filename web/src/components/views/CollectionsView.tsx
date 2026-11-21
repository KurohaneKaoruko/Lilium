import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Folder as FolderIcon, Tag, Move, Plus } from "lucide-react";
import { defaultFilters, useStore } from "../../store/useStore";
import { api } from "../../api/client";
import { PAN_INERTIA, WHEEL_SMOOTHING, reflowCurve } from "../../lib/wallMotion";
import { formatCount, isShortcutScope } from "../../lib/workspace";
import { notify } from "../../lib/feedback";
import NameDialog from "../ui/NameDialog";
import CanvasControls, { prefersReducedMotion } from "./CanvasControls";
import { Thumb } from "./shared";

/**
 * 分类卡片墙:无限视图同款镜头模型 —— 卡片散布在无限平面上,
 * 拖拽平移(惯性)、滚轮平滑、Ctrl+滚轮缩放,点击卡片进入分类浏览。
 *
 *   容器(裁剪) ← 镜头层(唯一 transform) ← 卡片(left/top,世界坐标)
 */

interface Card {
  key: string;
  kind: "folder" | "tag";
  id: string;
  title: string;
  cover: string | null;
  count: number;
  color?: string;
}

/** 卡片世界尺寸(封面 240×132 + 文本区) */
const CARD_W = 240;
const CARD_H = 196;
/** 世界网格步长(含呼吸间距) */
const GRID_X = 330;
const GRID_Y = 250;

/** 确定性哈希:同 key 永远同位置 */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export default function CollectionsView() {
  const folders = useStore((s) => s.folders);
  const tags = useStore((s) => s.tags);
  const setFilters = useStore((s) => s.setFilters);
  const refreshMeta = useStore((s) => s.refreshMeta);

  const [tab, setTab] = useState<"folders" | "tags">("folders");
  const [creating, setCreating] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const cam = useRef({ tx: 0, ty: 0, z: 1 });
  const [zoom, setZoom] = useState(1);
  /** 当前聚焦卡 key(applyCamera 每帧读取) */
  const focusKeyRef = useRef<string | null>(null);
  /** 深度趟的元素缓存(key → 卡中心世界坐标) */
  const depthElsRef = useRef<{ el: HTMLElement; x: number; y: number }[]>([]);

  const camAnim = useRef<{
    handle: number | null;
    vx: number; vy: number;
    wx: number; wy: number;
    lastT: number;
  } | null>(null);
  const dragRef = useRef<{
    x: number; y: number; tx: number; ty: number; moved: boolean;
    lastT: number; vx: number; vy: number; px?: number; py?: number; pointer: number;
  } | null>(null);

  const newFolder = async (name: string) => {
    await api("/folders", { method: "POST", body: JSON.stringify({ parentId: null, name }) });
    await refreshMeta();
    notify("文件夹已创建");
  };

  const cards: Card[] = useMemo(() => {
    if (tab === "folders") {
      return folders.map((f) => ({
        key: `f-${f.id}`,
        kind: "folder" as const,
        id: f.id,
        title: f.name,
        cover: f.coverItemId ?? null,
        count: f.itemCount ?? 0,
      }));
    }
    return tags.map((t) => ({
      key: `t-${t.name}`,
      kind: "tag" as const,
      id: t.name,
      title: t.name,
      cover: null,
      count: t.count,
      color: t.color,
    }));
  }, [tab, folders, tags]);

  /** 镜头层 transform 直写(每帧) */
  const applyCamera = useCallback(() => {
    const el = worldRef.current;
    if (!el) return;
    const { tx, ty, z } = cam.current;
    el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${z.toFixed(4)})`;
    // 近大远小:卡中心离视口中心越远越小越淡;聚焦卡永远满档
    const fk = focusKeyRef.current;
    const { w, h } = sizeRef.current;
    if (w > 0 && depthElsRef.current.length) {
      const cx = w / 2;
      const cy = h / 2;
      for (const { el: cel, x, y } of depthElsRef.current) {
        // 卡中心在屏幕上的位置
        const sx = x * z + tx;
        const sy = y * z + ty;
        const dx = (sx - cx) / (w * 0.5);
        const d = Math.sqrt(dx * dx + ((sy - cy) / (h * 0.5)) ** 2);
        const near = Math.max(0, 1 - d / 1.55);
        if (fk != null && cel.dataset.card === fk) {
          cel.style.zIndex = "100";
          cel.style.transform = "scale(1)";
          cel.style.filter = "brightness(1)";
          cel.style.opacity = "1";
          continue;
        }
        const sc = 0.62 + 0.38 * near;
        cel.style.transform = `scale(${sc.toFixed(3)})`;
        cel.style.filter = `brightness(${(0.55 + 0.45 * near).toFixed(3)})`;
        cel.style.opacity = (0.5 + 0.5 * near).toFixed(3);
        cel.style.zIndex = fk != null ? "1" : String(1 + Math.round(near * 98));
      }
    }
  }, []);

  const stopCamAnim = () => {
    if (camAnim.current?.handle != null) clearInterval(camAnim.current.handle);
    camAnim.current = null;
  };

  /** 聚焦镜头到某张卡(弹簧推近+放大);p 为 null 时回中 */
  const focusCard = useCallback(
    (p: { x: number; y: number } | null) => {
      const { w, h } = sizeRef.current;
      const z1 = p ? Math.min(1.3, Math.max(.75, (w - 42) / CARD_W)) : w < 500 ? .72 : .92;
      const wx = p ? p.x : 0;
      const wy = p ? p.y : 0;
      const endTx = w / 2 - wx * z1;
      const endTy = h / 2 - wy * z1;
      const dist = Math.hypot(endTx - cam.current.tx, endTy - cam.current.ty);
      const ease = reflowCurve(Math.max(240, dist));
      stopCamAnim();
      if (prefersReducedMotion()) {
        cam.current = { tx: endTx, ty: endTy, z: z1 };
        setZoom(z1); applyCamera(); return;
      }
      const from = { ...cam.current };
      const t0 = performance.now();
      const handle = setInterval(() => {
        const prog = Math.min(1, (performance.now() - t0) / ease.durationMs);
        const e = ease.ease(prog);
        cam.current.tx = from.tx + (endTx - from.tx) * e;
        cam.current.ty = from.ty + (endTy - from.ty) * e;
        cam.current.z = from.z + (z1 - from.z) * e;
        applyCamera();
        if (prog >= 1) { clearInterval(handle); camAnim.current = null; setZoom(z1); }
      }, 16);
      camAnim.current = { handle, vx: 0, vy: 0, wx: 0, wy: 0, lastT: performance.now() };
    },
    [applyCamera],
  );

  /** 设置聚焦卡(视觉由 applyCamera 深度趟统一驱动) */
  const setFocused = useCallback(
    (key: string | null) => {
      focusKeyRef.current = key;
      if (key == null) {
        focusCard(null);
        return;
      }
      const p = placedByKeyRef.current.get(key);
      if (p) focusCard({ x: p.x + CARD_W / 2, y: p.y + CARD_H / 2 });
    },
    [focusCard],
  );

  /** 点击卡片:聚焦放大该卡;再点一次进入;聚焦态点别的卡 → 切换聚焦;点空白收起 */
  const openCard = (c: Card) => {
    if (focusKeyRef.current === c.key) {
      // 已聚焦 → 进入分类
      if (c.kind === "folder") {
        setFilters({ ...defaultFilters, folderId: c.id });
      } else {
        setFilters({ ...defaultFilters, tag: c.id });
      }
      focusKeyRef.current = null;
      useStore.getState().setView("masonry");
      return;
    }
    setFocused(c.key);
  };

  /** 卡片世界坐标:错落有致 —— 网格保证不打架,哈希决定行内偏移/上下沉浮;大小交给近大远小 */
  const placed = useMemo(() => {
    const n = cards.length;
    const cols = Math.min(Math.max(n, 1), Math.max(1, Math.ceil(Math.sqrt(n * 1.4))));
    const rows = Math.ceil(n / cols);
    return cards.map((c, i) => {
      const h = hash32(c.key);
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      // 行内错位:奇数行整体右移半格;卡自身再按哈希偏移(±26px 内,不会重叠)
      const rowShift = (gy % 2) * (GRID_X / 2);
      const jx = (((h >>> 8) % 100) / 100 - 0.5) * 52;
      const jy = (((h >>> 16) % 100) / 100 - 0.5) * 46;
      return {
        card: c,
        x: (gx - (cols - 1) / 2) * GRID_X + rowShift + jx - CARD_W / 2,
        y: (gy - (rows - 1) / 2) * GRID_Y + jy - CARD_H / 2,
      };
    });
  }, [cards]);

  const placedByKey = useMemo(() => new Map(placed.map((p) => [p.card.key, p])), [placed]);
  // 稳定访问(setFocused 的 useCallback 依赖里不放 placedByKey)
  const placedByKeyRef = useRef(placedByKey);
  placedByKeyRef.current = placedByKey;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
      setSize(sizeRef.current);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const startCamAnim = useCallback(() => {
    if (camAnim.current) return;
    camAnim.current = { handle: null, vx: 0, vy: 0, wx: 0, wy: 0, lastT: performance.now() };
    const tick = () => {
      const s = camAnim.current;
      if (!s) return;
      const now = performance.now();
      const dt = Math.min((now - s.lastT) / 1000, WHEEL_SMOOTHING.maxFrameMs / 1000);
      s.lastT = now;
      const c = cam.current;
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
      if (s.vx === 0 && s.vy === 0 && s.wx === 0 && s.wy === 0) {
        camAnim.current = null;
        clearInterval(s.handle!);
      }
    };
    // setInterval 而非 rAF:遮挡/切后台时不冻结(与无限视图同一选择)
    const handle = setInterval(tick, 16);
    camAnim.current.handle = handle;
  }, [applyCamera]);

  const reset = useCallback(() => {
    stopCamAnim();
    focusKeyRef.current = null;
    const { w, h } = sizeRef.current;
    const z = w < 500 ? .72 : .92;
    cam.current = { tx: w / 2, ty: h / 2, z };
    setZoom(z); applyCamera();
  }, [applyCamera]);
  useLayoutEffect(() => reset(), [tab, size.w, size.h, reset]);

  useEffect(() => () => stopCamAnim(), []);

  // 每次渲染后:清理已卸载卡片的深度缓存,并立即直写一帧(近大远小即时呈现)
  useEffect(() => {
    const list = depthElsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].el.isConnected) list.splice(i, 1);
    }
    applyCamera();
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary || !cards.length) return;
    stopCamAnim();
    setZoom(cam.current.z);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const c = cam.current;
    dragRef.current = {
      x: e.clientX, y: e.clientY, tx: c.tx, ty: c.ty, moved: false,
      lastT: performance.now(), vx: 0, vy: 0, pointer: e.pointerId,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    const now = performance.now();
    const dt = Math.max(now - d.lastT, 1) / 1000;
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
    if (!d || d.pointer !== e.pointerId) return;
    dragRef.current = null;
    const stale = performance.now() - d.lastT > PAN_INERTIA.staleReleaseMs;
    if (d.moved && !stale && !prefersReducedMotion() && Math.hypot(d.vx, d.vy) >= PAN_INERTIA.minSpeed) {
      const vx = Math.max(-PAN_INERTIA.maxSpeed, Math.min(PAN_INERTIA.maxSpeed, d.vx));
      const vy = Math.max(-PAN_INERTIA.maxSpeed, Math.min(PAN_INERTIA.maxSpeed, d.vy));
      if (!camAnim.current) startCamAnim();
      camAnim.current!.vx = vx;
      camAnim.current!.vy = vy;
    }
    if (!d.moved) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cardEl = el?.closest("[data-card]") as HTMLElement | null;
      const key = cardEl?.dataset.card;
      if (!key) {
        // 点空白:聚焦态下收起聚焦回中
        if (focusKeyRef.current) {
          focusKeyRef.current = null;
          focusCard(null);
        }
        return;
      }
      const card = cards.find((c) => c.key === key);
      if (card) openCard(card);
    }
  };

  const adjustZoom = useCallback((factor: number, x = sizeRef.current.w / 2, y = sizeRef.current.h / 2) => {
    stopCamAnim();
    const c = cam.current;
    const z = Math.max(.5, Math.min(1.6, c.z * factor));
    c.tx = x - (x - c.tx) * z / c.z; c.ty = y - (y - c.ty) * z / c.z; c.z = z;
    setZoom(z); applyCamera();
  }, [applyCamera]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!cards.length) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        adjustZoom(Math.exp(-e.deltaY * unit * .0022), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        const dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit;
        const dy = (e.shiftKey ? e.deltaX : e.deltaY) * unit;
        if (prefersReducedMotion()) { stopCamAnim(); cam.current.tx -= dx; cam.current.ty -= dy; applyCamera(); return; }
        if (focusKeyRef.current) { stopCamAnim(); focusKeyRef.current = null; setZoom(cam.current.z); }
        if (!camAnim.current) startCamAnim();
        camAnim.current!.wx -= dx;
        camAnim.current!.wy -= dy;
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [adjustZoom, applyCamera, cards.length, startCamAnim]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isShortcutScope(e) && focusKeyRef.current) {
        e.preventDefault();
        focusKeyRef.current = null;
        focusCard(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [focusCard]);

  return (
    <div className="canvas-shell canvas-collections no-select">
      <div className="collection-header">
        <div className="view-picker" role="group" aria-label="分类类型">
          {(
            [
              ["folders", `文件夹 ${formatCount(folders.length)}`],
              ["tags", `标签 ${formatCount(tags.length)}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              aria-pressed={tab === k}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "folders" && (
          <button className="btn-secondary" title="新建文件夹" onClick={() => setCreating(true)}>
            <Plus size={13} /> 新建
          </button>
        )}
      </div>

        <div
          ref={containerRef}
          className="canvas-viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onLostPointerCapture={() => { dragRef.current = null; }}
        >
          <div ref={worldRef} className="absolute inset-0" style={{ transformOrigin: "0 0" }}>
            {placed.map(({ card: c, x, y }) => (
              <button type="button"
                key={c.key}
                data-card={c.key}
                ref={(el) => {
                  if (!el) return;
                  // 深度趟需要卡中心世界坐标(left/top 是左上角)
                  const list = depthElsRef.current;
                  const entry = list.find((q) => q.el === el);
                  const cx = x + CARD_W / 2;
                  const cy = y + CARD_H / 2;
                  if (entry) {
                    entry.x = cx;
                    entry.y = cy;
                  } else {
                    list.push({ el, x: cx, y: cy });
                  }
                }}
                className="absolute text-left group collection-card"
                aria-label={`打开${c.kind === "folder" ? "文件夹" : "标签"} ${c.title}`}
                onClick={(event) => {
                  if (event.detail !== 0) return; // 鼠标/触摸由画布指针手势处理
                  focusKeyRef.current = c.key;
                  openCard(c);
                }}
                style={{
                  left: x,
                  top: y,
                  width: CARD_W,
                  transformOrigin: "center center",
                  // 大小/明暗/z 序由 applyCamera 每帧直写(近大远小)
                  transition: "filter 120ms linear, opacity 120ms linear",
                }}
              >
                <div
                  className="collection-card-inner"
                >
                  <div className="h-[132px] relative overflow-hidden bg-panel2">
                      {c.cover ? (
                         <Thumb id={c.cover} kind="image" className="w-full h-full" />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center"
                          style={{
                            background:
                              c.kind === "tag"
                                 ? `linear-gradient(135deg, ${c.color ?? "#9b76ee"}44, #1e1928)`
                                 : "linear-gradient(135deg, #3c3057, #211c30)",
                          }}
                        >
                          {c.kind === "tag" ? (
                            <Tag size={28} style={{ color: c.color ?? "#8b5cf6" }} />
                          ) : (
                             <FolderIcon size={30} className="text-accent" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2.5 flex items-center justify-between gap-2">
                      <div className="text-[13px] text-neutral-100 font-medium truncate flex items-center gap-1.5">
                        {c.kind === "tag" && <Tag size={12} style={{ color: c.color }} className="shrink-0" />}
                        <span className="truncate">{c.title}</span>
                      </div>
                       <span className="text-[11px] text-muted shrink-0">{formatCount(c.count)} 项</span>
                     </div>
                   </div>
                 </button>
              ))}
          </div>
        </div>
      {!cards.length && <div className="collection-empty">
        <span className="state-icon">{tab === "folders" ? <FolderIcon size={27} /> : <Tag size={27} />}</span>
        <h2>{tab === "folders" ? "还没有文件夹" : "还没有标签"}</h2>
        <p>{tab === "folders" ? "用文件夹把相关的素材整理在一起。" : "为素材添加标签后，就能从这里浏览。"}</p>
        {tab === "folders" && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> 创建文件夹</button>}
      </div>}
      {cards.length > 0 && <>
        <p className="canvas-tip"><Move size={14} /><span className="canvas-help-full">点击聚焦 · 再点进入 · 拖动平移</span><span className="canvas-help-short">点击浏览</span></p>
        <CanvasControls zoom={zoom} min={.5} max={1.6} onZoom={adjustZoom} onReset={reset} />
      </>}
      {creating && <NameDialog title="新建文件夹" onSave={newFolder} onClose={() => setCreating(false)} />}
    </div>
  );
}
