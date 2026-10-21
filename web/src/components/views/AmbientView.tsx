import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  ListMusic,
  Maximize2,
  ChevronLeft,
  Music2,
} from "lucide-react";
import { useStore } from "../../store/useStore";
import { itemAspectRatio, thumbUrl, fileUrl } from "../../api/client";
import { buildMosaic, type MosaicLayout, type WorldTile } from "../../lib/infinite";

/**
 * 氛围墙（Ambient Wall）：参考音乐沉浸式播放墙效果。
 *
 * - 环形生长封面墙铺满整个屏幕，锁定缩放（可Ctrl+滚轮微调）
 * - 自由拖拽：松手后自动吸附到最近的聚焦卡片
 * - 中央「聚焦卡片」高亮显示名称/标签，其余卡片压暗
 * - 底部播放控制条：上一张/播放暂停/下一张/循环，支持自动轮播
 * - 空格播放暂停，←/→ 切换上一张/下一张
 */
export default function AmbientView() {
  const items = useStore((s) => s.items);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setLightbox = useStore((s) => s.setLightbox);
  const setDetail = useStore((s) => s.setDetail);
  const folders = useStore((s) => s.folders);
  const filters = useStore((s) => s.filters);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [z, setZ] = useState(1);
  /** 当前聚焦的卡片 id（"正在播放"） */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPan = useRef<{ tx: number; ty: number } | null>(null);
  /** 平滑吸附动画 */
  const animRef = useRef<number | null>(null);

  const layout: MosaicLayout = useMemo(
    () => buildMosaic(items.map((it) => ({ id: it.id, aspect: itemAspectRatio(it) }))),
    [items],
  );

  const itemById = useMemo(() => {
    const m = new Map<string, (typeof items)[number]>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  /** 聚焦顺序 = items 顺序（与网格视图一致） */
  const orderedIds = useMemo(() => items.map((i) => i.id), [items]);

  const folderName = useCallback(
    (fid: string | null) => (fid ? folders.find((f) => f.id === fid)?.name : undefined),
    [folders],
  );

  /** 让世界坐标 (wx,wy) 平滑移动到屏幕中心 */
  const glideTo = useCallback(
    (wx: number, wy: number, zz?: number) => {
      const targetZ = zz ?? z;
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      const startTx = tx;
      const startTy = ty;
      const startZ = z;
      const endTx = size.w / 2 - wx * targetZ;
      const endTy = size.h / 2 - wy * targetZ;
      const t0 = performance.now();
      const dur = 550;
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = ease(p);
        setTx(startTx + (endTx - startTx) * e);
        setTy(startTy + (endTy - startTy) * e);
        if (zz !== undefined) setZ(startZ + (targetZ - startZ) * e);
        if (p < 1) animRef.current = requestAnimationFrame(step);
        else animRef.current = null;
      };
      animRef.current = requestAnimationFrame(step);
    },
    [tx, ty, z, size],
  );

  /** 聚焦某张卡片：把它平滑移到屏幕中央 */
  const focusTile = useCallback(
    (id: string, glide = true) => {
      const tile = layout.allTiles().find((t) => t.id === id);
      if (!tile) return;
      setFocusId(id);
      if (glide) glideTo(tile.x + tile.w / 2, tile.y + tile.h / 2);
    },
    [layout, glideTo],
  );

  /** 下一个聚焦目标（items 顺序循环） */
  const stepFocus = useCallback(
    (dir: 1 | -1) => {
      if (orderedIds.length === 0) return;
      let idx = focusId ? orderedIds.indexOf(focusId) : -1;
      idx = (idx + dir + orderedIds.length) % orderedIds.length;
      focusTile(orderedIds[idx]);
    },
    [orderedIds, focusId, focusTile],
  );

  // 初始聚焦第一张
  useEffect(() => {
    if (items.length === 0) return;
    setFocusId((cur) => (cur && itemById.has(cur) ? cur : items[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 初始把焦点卡片居中（不做动画）
  const didCenterRef = useRef(false);
  useEffect(() => {
    if (didCenterRef.current || !focusId || size.w < 100) return;
    const tile = layout.allTiles().find((t) => t.id === focusId);
    if (!tile) return;
    didCenterRef.current = true;
    setTx(size.w / 2 - (tile.x + tile.w / 2) * z);
    setTy(size.h / 2 - (tile.y + tile.h / 2) * z);
  }, [focusId, size, layout, z]);

  // 自动轮播
  useEffect(() => {
    if (!playing || items.length < 2) return;
    const t = setInterval(() => stepFocus(1), 6000);
    return () => clearInterval(t);
  }, [playing, items.length, stepFocus]);

  // 可见区域瓦片
  const tiles: WorldTile[] = useMemo(() => {
    const worldX0 = (0 - tx) / z;
    const worldY0 = (0 - ty) / z;
    const worldX1 = (size.w - tx) / z;
    const worldY1 = (size.h - ty) / z;
    return layout.ensureCover({ x0: worldX0, y0: worldY0, x1: worldX1, y1: worldY1 });
  }, [layout, tx, ty, z, size]);

  // 键盘控制
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (useStore.getState().lightboxId) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") stepFocus(1);
      else if (e.key === "ArrowLeft") stepFocus(-1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [stepFocus]);

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
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
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
    if (d.moved) {
      // 拖拽结束：吸附到视口内最近的卡片中心
      const cx = (size.w / 2 - tx) / z;
      const cy = (size.h / 2 - ty) / z;
      let best: WorldTile | null = null;
      let bestDist = Infinity;
      for (const t of layout.allTiles()) {
        const tcx = t.x + t.w / 2;
        const tcy = t.y + t.h / 2;
        const dist = (tcx - cx) * (tcx - cx) + (tcy - cy) * (tcy - cy);
        if (dist < bestDist) {
          bestDist = dist;
          best = t;
        }
      }
      if (best) focusTile(best.id);
    } else {
      // 单击：命中检测
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tileEl = el?.closest("[data-tile]") as HTMLElement | null;
      const id = tileEl?.dataset.tile;
      if (id) {
        if (e.shiftKey) select(id, "range");
        else if (e.ctrlKey || e.metaKey) select(id, "toggle");
        else {
          select(id, "set");
          setDetail(id);
          focusTile(id);
        }
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    // Ctrl+滚轮 缩放；普通滚轮 = 下一张/上一张
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.08 : 0.92;
      setZ((old) => Math.min(2.2, Math.max(0.5, old * f)));
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      stepFocus(e.deltaX > 0 ? 1 : -1);
    } else {
      stepFocus(e.deltaY > 0 ? 1 : -1);
    }
  };

  // 双击打开灯箱
  const onTileDoubleClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    select(id, "set");
    setLightbox(id);
  };

  const focusItem = focusId ? itemById.get(focusId) : null;
  const focusLabel = focusItem
    ? folderName(focusItem.folderId) ?? (focusItem.tags[0] ? `#${focusItem.tags[0]}` : "Lilium")
    : "Lilium";
  const focusIdx = focusId ? orderedIds.indexOf(focusId) + 1 : 0;

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        没有可显示的图片
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-[#0c0d11] no-select">
      {/* 画布 */}
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
          const it = itemById.get(t.id);
          const focused = t.id === focusId;
          const selected = selection.has(t.id);
          return (
            <div
              key={t.id}
              data-tile={t.id}
              className="absolute overflow-hidden transition-[opacity,box-shadow,filter] duration-500"
              style={{
                transform: `translate3d(${t.x * z + tx}px, ${t.y * z + ty}px, 0)`,
                width: t.w * z,
                height: t.h * z,
                opacity: focused ? 1 : 0.42,
                filter: focused ? "none" : "brightness(0.55) saturate(0.85)",
                borderRadius: focused ? 6 : 3,
                boxShadow: focused
                  ? "0 0 0 1.5px rgba(167,139,250,.9), 0 18px 60px rgba(0,0,0,.6)"
                  : selected
                    ? "0 0 0 1.5px rgba(167,139,250,.55)"
                    : "0 4px 16px rgba(0,0,0,.4)",
                zIndex: focused ? 10 : selected ? 5 : 1,
              }}
              onDoubleClick={(e) => onTileDoubleClick(e, t.id)}
            >
              <img
                src={thumbUrl(t.id)}
                alt=""
                loading="lazy"
                draggable={false}
                className="w-full h-full object-cover pointer-events-none"
                style={{ backgroundColor: "#1a1c22" }}
              />
              {/* 聚焦卡片：渐变遮罩 + 信息 */}
              {focused && (
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-black/70 to-transparent" />
                  <div className="absolute left-4 top-3 right-4">
                    <div className="flex items-center gap-1.5 text-[10px] tracking-wider text-violet-200/90 mb-1">
                      <span className="px-1.5 py-0.5 rounded bg-violet-500/25 border border-violet-400/30">
                        正在展示 · {String(focusIdx).padStart(2, "0")}
                      </span>
                    </div>
                    <div
                      className="text-white font-semibold leading-tight line-clamp-2"
                      style={{ fontSize: Math.max(13, Math.min(20, t.w * z * 0.05)) }}
                    >
                      {it?.name ?? t.id}
                    </div>
                    <div className="text-[11px] text-neutral-300/80 mt-0.5 truncate">{focusLabel}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 顶部渐隐遮罩 */}
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

      {/* 返回/聚焦定位 */}
      <button
        className="absolute left-4 top-4 w-9 h-9 rounded-full bg-black/45 backdrop-blur border border-white/10 text-neutral-200 flex items-center justify-center hover:bg-black/65"
        title="回到当前卡片"
        onClick={() => focusTile(focusId ?? orderedIds[0])}
      >
        <ChevronLeft size={17} />
      </button>

      {/* 底部播放控制条 */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-5 flex items-center gap-1.5 bg-black/55 backdrop-blur-md border border-white/10 rounded-full px-3 py-2 shadow-2xl">
        <CtlBtn title="上一张" onClick={() => stepFocus(-1)}>
          <SkipBack size={16} />
        </CtlBtn>
        <CtlBtn
          title={playing ? "暂停 (空格)" : "播放 (空格)"}
          primary
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause size={17} /> : <Play size={17} className="translate-x-[1px]" />}
        </CtlBtn>
        <CtlBtn title="下一张" onClick={() => stepFocus(1)}>
          <SkipForward size={16} />
        </CtlBtn>
        <div className="w-px h-5 bg-white/15 mx-1" />
        <CtlBtn title="循环轮播" active={loop} onClick={() => setLoop((l) => !l)}>
          <Repeat size={15} />
        </CtlBtn>
        <CtlBtn title="双击卡片打开大图" onClick={() => focusId && setLightbox(focusId)}>
          <Maximize2 size={15} />
        </CtlBtn>
        <CtlBtn
          title="在详情面板查看"
          onClick={() => {
            if (focusId) {
              select(focusId, "set");
              setDetail(focusId);
            }
          }}
        >
          <ListMusic size={15} />
        </CtlBtn>
        <div className="pl-2 pr-1 text-[11px] text-neutral-300 tabular-nums">
          {String(focusIdx).padStart(2, "0")} / {String(items.length).padStart(3, "0")}
        </div>
      </div>

      {/* 当前项标签（右上） */}
      <div className="absolute right-4 top-4 flex items-center gap-2 bg-black/45 backdrop-blur border border-white/10 rounded-full px-3 py-1.5 text-[11px] text-neutral-300">
        <Music2 size={12} className="text-violet-300" />
        <span className="max-w-[220px] truncate">{focusItem?.name ?? "—"}</span>
      </div>

      {/* 隐藏的 fileUrl 预加载（聚焦卡片用原图预热） */}
      <link rel="prefetch" href={focusItem ? fileUrl(focusItem.id) : ""} />
    </div>
  );
}

function CtlBtn({
  children,
  onClick,
  title,
  primary,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  primary?: boolean;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={[
        "rounded-full flex items-center justify-center transition-colors",
        primary
          ? "w-10 h-10 bg-violet-500 hover:bg-violet-400 text-white shadow-lg shadow-violet-500/30"
          : "w-8 h-8 text-neutral-300 hover:text-white hover:bg-white/10",
        active && !primary ? "text-violet-300 bg-violet-500/15" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
