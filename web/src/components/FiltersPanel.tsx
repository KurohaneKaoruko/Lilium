import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Star, X } from "lucide-react";
import { defaultFilters, useStore } from "../store/useStore";

/** 日期快捷区间（毫秒） */
const DAY = 86_400_000;
const DATE_PRESETS: { label: string; fromDays: number | null }[] = [
  { label: "今天", fromDays: 0 },
  { label: "近 7 天", fromDays: 7 },
  { label: "近 30 天", fromDays: 30 },
  { label: "近一年", fromDays: 365 },
];

/** 毫秒时间戳 → datetime-local 输入值（本地时区） */
function toLocalInput(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): number {
  if (!v) return 0;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 高级筛选面板：TopBar 漏斗按钮弹出（portal 到 body）。
 * 覆盖智能文件夹查询引擎的新条件类型：评分区间 / 日期区间 / 否定标签。
 * 关闭即应用（面板只改 store，查询由 store 的 setFilters 统一触发）。
 */
export default function FiltersPanel({ anchorRef, onClose }: { anchorRef: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const tags = useStore((s) => s.tags);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.right - 300, window.innerWidth - 316)),
      top: Math.min(r.bottom + 8, window.innerHeight - 200),
    });
  }, [anchorRef]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorRef]);

  if (!pos) return null;

  const addedActive = filters.addedFrom > 0 || filters.addedTo > 0;
  const createdActive = filters.createdFrom > 0 || filters.createdTo > 0;
  const advancedActive = filters.ratingMax > 0 || addedActive || createdActive || filters.notTags.length > 0;

  const patch = (p: Parameters<typeof setFilters>[0]) => setFilters(p);

  return createPortal(
    <div
      ref={rootRef}
      className="fixed z-[70] w-[300px] rounded-xl border border-border bg-panel shadow-2xl p-3 space-y-3 text-xs"
      style={{ left: pos.left, top: pos.top }}
    >
      {/* 评分区间 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-neutral-400 flex items-center gap-1"><Star size={11} /> 评分区间</span>
          {(filters.ratingMin > 0 || filters.ratingMax > 0) && (
            <button className="text-neutral-500 hover:text-neutral-200" onClick={() => patch({ ratingMin: 0, ratingMax: 0 })}><X size={11} /></button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <select
            className="input !py-0.5 !px-1 flex-1"
            value={filters.ratingMin}
            onChange={(e) => patch({ ratingMin: Number(e.target.value) })}
            title="最低评分"
          >
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? "不限" : `≥ ${n} 星`}</option>)}
          </select>
          <span className="text-neutral-600">–</span>
          <select
            className="input !py-0.5 !px-1 flex-1"
            value={filters.ratingMax}
            onChange={(e) => patch({ ratingMax: Number(e.target.value) })}
            title="最高评分"
          >
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 || n === 5 ? "不限" : `≤ ${n} 星`}</option>)}
          </select>
        </div>
      </div>

      {/* 日期区间 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-neutral-400">📅 添加时间</span>
          {addedActive && (
            <button className="text-neutral-500 hover:text-neutral-200" onClick={() => patch({ addedFrom: 0, addedTo: 0 })}><X size={11} /></button>
          )}
        </div>
        <div className="flex items-center gap-1 mb-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.label}
              className="px-1.5 py-0.5 rounded bg-panel2 border border-border hover:bg-white/5 text-[11px]"
              onClick={() => patch({ addedFrom: p.fromDays === 0 ? startOfToday() : Date.now() - p.fromDays! * DAY, addedTo: 0 })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="datetime-local"
            className="input !py-0.5 !px-1 flex-1"
            value={toLocalInput(filters.addedFrom)}
            onChange={(e) => patch({ addedFrom: fromLocalInput(e.target.value) })}
          />
          <span className="text-neutral-600">–</span>
          <input
            type="datetime-local"
            className="input !py-0.5 !px-1 flex-1"
            value={toLocalInput(filters.addedTo)}
            onChange={(e) => patch({ addedTo: fromLocalInput(e.target.value) })}
          />
        </div>
      </div>

      {/* 拍摄/创建时间区间 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-neutral-400">📷 拍摄时间</span>
          {createdActive && (
            <button className="text-neutral-500 hover:text-neutral-200" onClick={() => patch({ createdFrom: 0, createdTo: 0 })}><X size={11} /></button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="datetime-local"
            className="input !py-0.5 !px-1 flex-1"
            value={toLocalInput(filters.createdFrom)}
            onChange={(e) => patch({ createdFrom: fromLocalInput(e.target.value) })}
          />
          <span className="text-neutral-600">–</span>
          <input
            type="datetime-local"
            className="input !py-0.5 !px-1 flex-1"
            value={toLocalInput(filters.createdTo)}
            onChange={(e) => patch({ createdTo: fromLocalInput(e.target.value) })}
          />
        </div>
      </div>

      {/* 否定标签 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-neutral-400">🚫 排除标签</span>
          {filters.notTags.length > 0 && (
            <button className="text-neutral-500 hover:text-neutral-200" onClick={() => patch({ notTags: [] })}><X size={11} /></button>
          )}
        </div>
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {tags.length === 0 && <span className="text-neutral-600">暂无标签</span>}
          {tags.map((t) => {
            const on = filters.notTags.includes(t.name);
            return (
              <button
                key={t.name}
                title={on ? "取消排除" : "排除含该标签的图片"}
                className={`px-1.5 py-0.5 rounded border text-[11px] transition-colors ${
                  on ? "bg-red-500/20 border-red-400/60 text-red-300" : "bg-panel2 border-border hover:bg-white/5"
                }`}
                onClick={() => patch({ notTags: on ? filters.notTags.filter((x) => x !== t.name) : [...filters.notTags, t.name] })}
              >
                {on ? "✕ " : ""}{t.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* 重置全部 */}
      <button
        className="btn w-full justify-center"
        onClick={() => setFilters({ ...defaultFilters, smartId: filters.smartId })}
        title="恢复默认筛选"
      >
        重置筛选
      </button>

      {advancedActive && (
        <div className="text-[10px] text-violet-300/80 text-center">有高级筛选生效中</div>
      )}
    </div>,
    document.body
  );
}

/** 本地时区今天 0 点 */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
