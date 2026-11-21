import { ArrowDown, ArrowUp } from "lucide-react";
import { useStore, type SortKey } from "../../store/useStore";
import { fmtDate, humanSize } from "../../api/client";
import { assetInteractions, LoadMoreSentinel, SelectionMark, Stars, Thumb, useGalleryViewport } from "./shared";

const ROW_H = 58;

export default function ListView() {
  const items = useStore((s) => s.items);
  const selection = useStore((s) => s.selection);
  const { scrollRef, innerRef, top, height, measure } = useGalleryViewport();
  const first = Math.max(0, Math.floor((top - 390) / ROW_H));
  const last = Math.min(items.length, Math.ceil((top + height + 350) / ROW_H));
  return <div ref={scrollRef} className="gallery-scroll list-scroll" onScroll={measure}>
    <div className="gallery-inner asset-table" ref={innerRef}>
      <div className="asset-list-head asset-list-grid">
        <SortColumn label="名称" field="name" />
        <SortColumn label="尺寸" field="width" className="list-dimensions" />
        <SortColumn label="大小" field="size" />
        <SortColumn label="评分" field="rating" className="list-rating" />
        <span className="list-tags">标签</span>
        <SortColumn label="添加时间" field="addedAt" className="list-date" />
      </div>
      <div className="relative" style={{ height: items.length * ROW_H }}>
        {items.slice(first, last).map((item, i) => <button key={item.id} type="button" className="asset-list-row asset-list-grid"
          aria-label={item.name} aria-pressed={selection.has(item.id)} title={item.name}
          style={{ top: (first + i) * ROW_H, height: ROW_H }} {...assetInteractions(item.id)}>
          <span className="list-identity"><span className="list-thumb-wrap"><Thumb id={item.id} kind={item.kind} className="list-thumb" fallbackSize={17} />
            <SelectionMark selected={selection.has(item.id)} /></span>
            <span className="min-w-0"><strong className="block truncate">{item.name}</strong><small>{item.ext.toUpperCase() || "文件"}</small></span></span>
          <span className="list-dimensions">{item.width && item.height ? `${item.width} × ${item.height}` : "—"}</span>
          <span className="truncate">{humanSize(item.size)}</span>
          <span className="list-rating"><Stars value={item.rating} size={11} /></span>
          <span className="list-tags truncate" title={item.tags.join("、")}>{item.tags.join("、") || "—"}</span>
          <span className="list-date truncate">{fmtDate(item.addedAt)}</span>
        </button>)}
      </div>
    </div>
    <LoadMoreSentinel />
  </div>;
}

function SortColumn({ label, field, className = "" }: { label: string; field: SortKey; className?: string }) {
  const sort = useStore((s) => s.sort);
  const asc = useStore((s) => s.asc);
  const setSort = useStore((s) => s.setSort);
  const Icon = asc ? ArrowUp : ArrowDown;
  return <button type="button" className={`list-sort ${className}`} onClick={() => setSort(field, sort === field ? !asc : field === "name")}
    aria-label={sort === field ? `${label}，当前${asc ? "升序" : "降序"}` : `按${label}排序`}>{label}{sort === field && <Icon size={12} />}</button>;
}
