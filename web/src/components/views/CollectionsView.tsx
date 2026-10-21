import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Folder as FolderIcon, Tag, ChevronLeft, Plus } from "lucide-react";
import { useStore } from "../../store/useStore";
import { api, thumbUrl } from "../../api/client";
import { PAN_INERTIA, WHEEL_SMOOTHING, reflowCurve } from "../../lib/wallMotion";

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
  sub: string;
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
  const smartFolders = useStore((s) => s.smartFolders);
  const setFilters = useStore((s) => s.setFilters);
  const fetchItems = useStore((s) => s.fetchItems);
  const refreshMeta = useStore((s) => s.refreshMeta);

  const [tab, setTab] = useState<"folders" | "tags">("folders");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  void smartFolders;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const cam = useRef({ tx: 0, ty: 0, z: 1 });
  const [renderTick, forceRender] = useState(0);

  const camAnim = useRef<{
    handle: number | null;
    vx: number; vy: number;
    wx: number; wy: number;
    lastT: number;
  } | null>(null);
  const dragRef = useRef<{
    x: number; y: number; tx: number; ty: number; moved: boolean;
    lastT: number; vx: number; vy: number; px?: number; py?: number;
  } | null>(null);

  const newFolder = async () => {
    const name = prompt("文件夹名称：");
    if (!name?.trim()) return;
    await api("/folders", { method: "POST", body: JSON.stringify({ parentId: null, name: name.trim() }) });
    refreshMeta();
  };

  const cards: Card[] = useMemo(() => {
    if (tab === "folders") {
      return folders.map((f) => ({
        key: `f-${f.id}`,
        kind: "folder" as const,
        id: f.id,
        title: f.name,
        sub: `${f.itemCount ?? 0} 张`,
        cover: f.coverItemId ?? null,
        count: f.itemCount ?? 0,
      }));
    }
    return tags.map((t) => ({
      key: `t-${t.name}`,
      kind: "tag" as const,
      id: t.name,
      title: t.name,
      sub: `${t.count} 张`,
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
  }, []);

  const stopCamAnim = () => {
    if (camAnim.current?.handle != null) clearInterval(camAnim.current.handle);
    camAnim.current = null;
  };

  /** 聚焦镜头到某张卡(弹簧推近+放大);focusKey 为 null 时回中 */
  const focusCard = useCallback(
    (p: { x: number; y: number; scale: number } | null) => {
      const z1 = p ? 1.3 : 0.9;
      const wx = p ? p.x : 0;
      const wy = p ? p.y : 0;
      const endTx = size.w / 2 - wx * z1;
      const endTy = size.h / 2 - wy * z1;
      const dist = Math.hypot(endTx - cam.current.tx, endTy - cam.current.ty);
      const ease = reflowCurve(Math.max(240, dist));
      stopCamAnim();
      const from = { ...cam.current };
      const t0 = performance.now();
      const handle = setInterval(() => {
        const prog = Math.min(1, (performance.now() - t0) / ease.durationMs);
        const e = ease.ease(prog);
        cam.current.tx = from.tx + (endTx - from.tx) * e;
        cam.current.ty = from.ty + (endTy - from.ty) * e;
        cam.current.z = from.z + (z1 - from.z) * e;
        applyCamera();
        if (prog >= 1) clearInterval(handle);
      }, 16);
      camAnim.current = { handle, vx: 0, vy: 0, wx: 0, wy: 0, lastT: performance.now() };
    },
    [size, applyCamera],
  );

  /** 点击卡片:聚焦放大该卡;再点一次收起;双击/再次点击已聚焦卡 → 进入分类 */
  const openCard = (c: Card) => {
    if (focusKey === c.key) {
      // 已聚焦 → 进入分类
      if (c.kind === "folder") {
        setFilters({ folderId: c.id, recursive: true, tag: null, trash: false });
      } else {
        setFilters({ tag: c.id, folderId: null, trash: false });
      }
      setFocusKey(null);
      useStore.setState({ view: "masonry" });
      fetchItems();
      return;
    }
    const p = placed.find((q) => q.card.key === c.key);
    setFocusKey(c.key);
    if (p) focusCard({ x: p.x + CARD_W / 2, y: p.y + CARD_H / 2, scale: p.scale });
  };

  /** 卡片世界坐标:错落有致 —— 网格保证不打架,哈希决定行内偏移/上下沉浮/大小层次 */
  const placed = useMemo(() => {
    const n = cards.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.4)));
    const rows = Math.ceil(n / cols);
    return cards.map((c, i) => {
      const h = hash32(c.key);
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      // 行内错位:奇数行整体右移半格;卡自身再按哈希偏移(±26px 内,不会重叠)
      const rowShift = (gy % 2) * (GRID_X / 2);
      const jx = (((h >>> 8) % 100) / 100 - 0.5) * 52;
      const jy = (((h >>> 16) % 100) / 100 - 0.5) * 46;
      // 大小层次:哈希选三档缩放(0.86 / 1 / 1.14),近大远小的错落感
      const scale = [0.86, 1, 1.14][(h >>> 24) % 3];
      return {
        card: c,
        x: (gx - (cols - 1) / 2) * GRID_X + rowShift + jx,
        y: (gy - (rows - 1) / 2) * GRID_Y + jy,
        scale,
        h,
      };
    });
  }, [cards]);

  // 视口测量:callback ref 挂载即观察
  const attachContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  /** 首帧:卡片云按视口居中 */
  const didCenterRef = useRef(false);
  useEffect(() => {
    if (didCenterRef.current || size.w < 100) return;
    didCenterRef.current = true;
    cam.current.z = 0.9;
    cam.current.tx = size.w / 2;
    cam.current.ty = size.h / 2;
    applyCamera();
    forceRender((v) => v + 1);
  }, [size, applyCamera]);

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

  // 切 tab(卡片集变化)→ 清聚焦并回中
  useEffect(() => {
    if (!didCenterRef.current || size.w < 100) return;
    setFocusKey(null);
    const ease = reflowCurve(600);
    const from = { ...cam.current };
    const to = { tx: size.w / 2, ty: size.h / 2 };
    const t0 = performance.now();
    stopCamAnim();
    const anim = () => {
      const p = Math.min(1, (performance.now() - t0) / ease.durationMs);
      const e = ease.ease(p);
      cam.current.tx = from.tx + (to.tx - from.tx) * e;
      cam.current.ty = from.ty + (to.ty - from.ty) * e;
      applyCamera();
      if (p >= 1) {
        clearInterval(handle);
      }
    };
    const handle = setInterval(anim, 16);
    camAnim.current = { handle, vx: 0, vy: 0, wx: 0, wy: 0, lastT: performance.now() };
    return () => clearInterval(handle);
  }, [tab, size, applyCamera]);

  useEffect(() => () => stopCamAnim(), []);

  /** 墙面交互 → 收回左栏(与无限视图一致) */
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
    const stale = performance.now() - d.lastT > PAN_INERTIA.staleReleaseMs;
    if (d.moved && !stale && Math.hypot(d.vx, d.vy) >= PAN_INERTIA.minSpeed) {
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
        if (focusKey) {
          setFocusKey(null);
          focusCard(null);
        }
        return;
      }
      const card = cards.find((c) => c.key === key);
      if (card) openCard(card);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    wallInteract();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0022);
      cam.current.z = Math.min(1.6, Math.max(0.5, cam.current.z * f));
      applyCamera();
      return;
    }
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const dy = e.shiftKey ? e.deltaX : e.deltaY;
    if (!camAnim.current) startCamAnim();
    camAnim.current!.wx -= dx;
    camAnim.current!.wy -= dy;
  };

  // Esc:聚焦态先取消聚焦回中(App 的 Esc 链先收侧栏,这里只在无侧栏时收聚焦)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key !== "Escape") return;
      const st = useStore.getState();
      if (st.lightboxId || st.chromeLeft) return;
      if (focusKey) {
        setFocusKey(null);
        focusCard(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [focusKey, focusCard]);

  return (
    <div className="relative flex-1 overflow-hidden bg-[#0c0d11] no-select">
      {/* 背景光晕 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(1200px 500px at 30% -10%, rgba(139,92,246,.13), transparent 60%), radial-gradient(900px 500px at 85% 110%, rgba(56,189,248,.08), transparent 60%)",
        }}
      />

      {/* 顶部标题(悬浮,不随镜头动) */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">分类</h1>
        <div className="flex bg-panel2/85 backdrop-blur border border-border rounded-full p-0.5 text-xs">
          {(
            [
              ["folders", `文件夹 (${folders.length})`],
              ["tags", `标签 (${tags.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className={`px-3 py-1 rounded-full transition-colors ${
                tab === k ? "bg-violet-500/25 text-violet-200" : "text-neutral-400 hover:text-neutral-200"
              }`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "folders" && (
          <button className="btn text-xs" title="新建文件夹" onClick={newFolder}>
            <Plus size={13} /> 新建
          </button>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 gap-2">
          {tab === "folders" ? <FolderIcon size={34} /> : <Tag size={34} />}
          <div className="text-sm">{tab === "folders" ? "还没有文件夹" : "还没有标签"}</div>
        </div>
      ) : (
        <div
          ref={attachContainer}
          className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <div ref={worldRef} className="absolute inset-0" style={{ transformOrigin: "0 0" }}>
            {placed.map(({ card: c, x, y, scale, h }) => {
              const focused = focusKey === c.key;
              const dimmed = focusKey !== null && !focused;
              return (
                <div
                  key={c.key}
                  data-card={c.key}
                  className="absolute text-left group"
                  style={{
                    left: x,
                    top: y,
                    width: CARD_W,
                    zIndex: focused ? 100 : 10 + (h % 50),
                    transform: `scale(${focused ? 1.06 : scale})`,
                    transformOrigin: "center center",
                    filter: dimmed ? "brightness(.55) saturate(.8)" : undefined,
                    opacity: dimmed ? 0.75 : 1,
                    transition: "transform 450ms cubic-bezier(.22,1,.36,1), filter 350ms ease, opacity 350ms ease",
                  }}
                >
                  <div
                    className={`rounded-2xl overflow-hidden border bg-panel/95 backdrop-blur pointer-events-auto transition-all duration-300 ${
                      focused
                        ? "border-violet-400/60 shadow-[0_30px_80px_rgba(0,0,0,.75)]"
                        : "border-white/10 shadow-[0_20px_50px_rgba(0,0,0,.5)] group-hover:border-violet-400/40 group-hover:shadow-[0_30px_70px_rgba(0,0,0,.65)]"
                    }`}
                  >
                    <div className="h-[132px] relative overflow-hidden bg-[#181a20]">
                      {c.cover ? (
                        <img
                          src={thumbUrl(c.cover)}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          className="w-full h-full object-cover opacity-85 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center"
                          style={{
                            background:
                              c.kind === "tag"
                                ? `linear-gradient(135deg, ${c.color}44, #1a1c22)`
                                : "linear-gradient(135deg, #232630, #1a1c22)",
                          }}
                        >
                          {c.kind === "tag" ? (
                            <Tag size={28} style={{ color: c.color ?? "#8b5cf6" }} />
                          ) : (
                            <FolderIcon size={30} className="text-neutral-600" />
                          )}
                        </div>
                      )}
                      {/* 数量角标 */}
                      <div className="absolute left-2 top-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] text-neutral-200 border border-white/10">
                        {c.count}
                      </div>
                    </div>
                    <div className="px-3 py-2.5">
                      <div className="text-[13px] text-neutral-100 font-medium truncate flex items-center gap-1.5">
                        {c.kind === "tag" && <Tag size={12} style={{ color: c.color }} className="shrink-0" />}
                        <span className="truncate">{c.title}</span>
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">{c.sub}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 底部提示 */}
      <div className="absolute bottom-3 inset-x-0 h-10 flex items-center justify-center pointer-events-none">
        <div className="bg-black/45 backdrop-blur border border-white/10 rounded-full px-3 py-1 text-[11px] text-neutral-400 flex items-center gap-1.5">
          <ChevronLeft size={11} />
          点击聚焦卡片 · 再点进入 · 拖拽漫游
        </div>
      </div>
    </div>
  );
}
