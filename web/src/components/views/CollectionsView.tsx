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
/** 世界网格步长(含呼吸间距),哈希抖动避免对齐感 */
const GRID_X = 340;
const GRID_Y = 260;

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

  const openCard = (c: Card) => {
    if (c.kind === "folder") {
      setFilters({ folderId: c.id, recursive: true, tag: null, trash: false });
    } else {
      setFilters({ tag: c.id, folderId: null, trash: false });
    }
    useStore.setState({ view: "masonry" });
    fetchItems();
  };

  /** 卡片世界坐标:网格 + 哈希抖动 + 轻微旋转,云质心在原点(少量卡片也居中) */
  const placed = useMemo(() => {
    const n = cards.length;
    // 列数随卡数扩展,行数兜底,网格整体以原点为中心
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.4)));
    return cards.map((c, i) => {
      const h = hash32(c.key);
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      const rows = Math.ceil(n / cols);
      const jx = ((h >>> 8) % 100) / 100 - 0.5;
      const jy = ((h >>> 16) % 100) / 100 - 0.5;
      const rot = (((h >>> 24) % 100) / 100 - 0.5) * 2.4;
      return {
        card: c,
        x: (gx - (cols - 1) / 2) * GRID_X + jx * 70,
        y: (gy - (rows - 1) / 2) * GRID_Y + jy * 60,
        rot,
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

  // 切 tab(卡片集变化)→ 云重新居中
  useEffect(() => {
    if (!didCenterRef.current || size.w < 100) return;
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
      if (!key) return;
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
            {placed.map(({ card: c, x, y, rot, h }) => (
              <div
                key={c.key}
                data-card={c.key}
                className="absolute text-left group"
                style={{
                  left: x,
                  top: y,
                  width: CARD_W,
                  zIndex: 10 + (h % 50),
                  transform: `rotate(${rot.toFixed(2)}deg)`,
                }}
              >
                <div
                  className="rounded-2xl overflow-hidden border border-white/10 bg-panel/95 backdrop-blur pointer-events-auto
                             shadow-[0_20px_50px_rgba(0,0,0,.5)] transition-all duration-300
                             group-hover:-translate-y-2 group-hover:shadow-[0_30px_70px_rgba(0,0,0,.65)]
                             group-hover:border-violet-400/40"
                  style={{ transform: "translateZ(0)" }}
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
            ))}
          </div>
        </div>
      )}

      {/* 底部提示 */}
      <div className="absolute bottom-3 inset-x-0 h-10 flex items-center justify-center pointer-events-none">
        <div className="bg-black/45 backdrop-blur border border-white/10 rounded-full px-3 py-1 text-[11px] text-neutral-400 flex items-center gap-1.5">
          <ChevronLeft size={11} />
          拖拽漫游 · 点击卡片进入分类浏览
        </div>
      </div>
    </div>
  );
}
