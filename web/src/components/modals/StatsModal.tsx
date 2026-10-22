import { useEffect, useState } from "react";
import { BarChart3, X, Images, HardDrive, FolderTree, Star, Trash2, Sparkles } from "lucide-react";
import { api } from "../../api/client";
import { Modal } from "./Modals";

interface Stats {
  itemCount: number;
  totalSize: number;
  trashCount: number;
  tagCount: number;
  folderCount: number;
  smartFolderCount: number;
  withRating: number;
  withTags: number;
  kinds: { kind: string; count: number; size: number }[];
  ratings: { rating: number; count: number }[];
  months: { month: string; count: number }[];
  topTags: { name: string; color: string; count: number }[];
  colors: { r: number; g: number; b: number; count: number }[];
  largest: { id: string; name: string; size: number }[];
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

const KIND_LABELS: Record<string, string> = {
  image: "图片", video: "视频", audio: "音频", text: "文本", font: "字体", other: "其他",
};

/** 概览统计卡片 */
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[.03] border border-border/60 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 mb-1">{icon} {label}</div>
      <div className="text-lg font-semibold text-neutral-200 tabular-nums">{value}</div>
    </div>
  );
}

/** 横向条形 */
function BarRow({ label, value, max, color, right }: { label: string; value: number; max: number; color: string; right?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 shrink-0 text-neutral-500 truncate">{label}</span>
      <div className="flex-1 h-3.5 bg-white/5 rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: max > 0 ? `${Math.max(2, (value / max) * 100)}%` : "0%", background: color, transition: "width .4s cubic-bezier(.22,1,.36,1)" }} />
      </div>
      <span className="w-14 text-right text-neutral-400 tabular-nums">{right ?? value}</span>
    </div>
  );
}

/** 统计仪表盘 */
export default function StatsModal({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>("/stats").then(setStats).catch(() => {});
  }, []);

  const maxMonth = Math.max(1, ...(stats?.months.map((m) => m.count) ?? [1]));
  const maxTag = Math.max(1, ...(stats?.topTags.map((t) => t.count) ?? [1]));
  const totalKinds = stats?.kinds.reduce((s, k) => s + k.count, 0) ?? 0;

  return (
    <Modal title="库统计" onClose={onClose} icon={<BarChart3 size={15} />}>
      {!stats ? (
        <div className="py-10 text-center text-xs text-neutral-500">加载中…</div>
      ) : (
        <div className="space-y-5 w-[560px] max-w-[80vw]">
          {/* 概览 */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard icon={<Images size={12} />} label="图片素材" value={String(stats.itemCount)} />
            <StatCard icon={<HardDrive size={12} />} label="占用空间" value={fmtSize(stats.totalSize)} />
            <StatCard icon={<FolderTree size={12} />} label="文件夹" value={String(stats.folderCount)} />
            <StatCard icon={<Sparkles size={12} />} label="智能文件夹" value={String(stats.smartFolderCount)} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <StatCard icon={<Star size={12} />} label="已评分" value={`${stats.itemCount ? Math.round((stats.withRating / stats.itemCount) * 100) : 0}%`} />
            <StatCard icon={<Sparkles size={12} />} label="已打标" value={`${stats.itemCount ? Math.round((stats.withTags / stats.itemCount) * 100) : 0}%`} />
            <StatCard icon={<Sparkles size={12} />} label="标签数" value={String(stats.tagCount)} />
            <StatCard icon={<Trash2 size={12} />} label="回收站" value={String(stats.trashCount)} />
          </div>

          {/* 类型分布 */}
          {stats.kinds.length > 0 && (
            <div>
              <div className="text-xs text-neutral-400 mb-2">类型分布</div>
              <div className="space-y-1.5">
                {stats.kinds.map((k) => (
                  <BarRow
                    key={k.kind}
                    label={KIND_LABELS[k.kind] ?? k.kind}
                    value={k.count}
                    max={totalKinds}
                    color="#8b5cf6"
                    right={`${k.count} · ${fmtSize(k.size)}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 月度新增 */}
          {stats.months.length > 0 && (
            <div>
              <div className="text-xs text-neutral-400 mb-2">近 12 个月新增</div>
              <div className="flex items-end gap-1.5 h-24">
                {stats.months.map((m) => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="absolute -top-5 hidden group-hover:block text-[10px] text-neutral-400 whitespace-nowrap bg-black/80 px-1.5 py-0.5 rounded">
                      {m.month}: {m.count}
                    </div>
                    <div
                      className="w-full rounded-t bg-gradient-to-t from-violet-600/70 to-violet-400/80"
                      style={{ height: `${(m.count / maxMonth) * 76}px`, minHeight: 3, transition: "height .4s cubic-bezier(.22,1,.36,1)" }}
                    />
                    <span className="text-[9px] text-neutral-600 whitespace-nowrap">{m.month.slice(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-5">
            {/* 标签 Top */}
            {stats.topTags.length > 0 && (
              <div>
                <div className="text-xs text-neutral-400 mb-2">标签 Top 10</div>
                <div className="space-y-1.5">
                  {stats.topTags.map((t) => (
                    <BarRow key={t.name} label={t.name} value={t.count} max={maxTag} color={t.color} />
                  ))}
                </div>
              </div>
            )}

            {/* 主色分布 */}
            {stats.colors.length > 0 && (
              <div>
                <div className="text-xs text-neutral-400 mb-2">主色分布</div>
                <div className="flex flex-wrap gap-1.5">
                  {stats.colors.map((c, i) => (
                    <div
                      key={i}
                      className="w-9 h-9 rounded-md border border-white/10 relative group"
                      style={{ background: `rgb(${c.r},${c.g},${c.b})` }}
                      title={`${c.count} 张`}
                    >
                      <span className="absolute inset-x-0 -bottom-0.5 text-center text-[9px] text-white/90 drop-shadow group-hover:opacity-0">{c.count}</span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-neutral-600 mt-1.5">按图片主色量化统计，悬停查看数量</div>
              </div>
            )}
          </div>

          {/* 最大文件 */}
          {stats.largest.length > 0 && (
            <div>
              <div className="text-xs text-neutral-400 mb-2">占用最大的文件</div>
              <div className="space-y-1">
                {stats.largest.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-[11px]">
                    <span className="flex-1 truncate text-neutral-400">{f.name}</span>
                    <span className="text-neutral-500 tabular-nums">{fmtSize(f.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
