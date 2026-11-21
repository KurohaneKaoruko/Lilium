import { useState, type RefObject } from "react";
import { CalendarDays, Camera, RotateCcw, Star, Tag, X } from "lucide-react";
import { useStore, type Filters } from "../store/useStore";
import { advancedFilterCount } from "../lib/workspace";
import Popover from "./ui/Popover";

const presets = [{ label: "今天", days: 0 }, { label: "近 7 天", days: 7 }, { label: "近 30 天", days: 30 }, { label: "近一年", days: 365 }];
const reset = { ratingMin: 0, ratingMax: 0, addedFrom: 0, addedTo: 0, createdFrom: 0, createdTo: 0, notTags: [] };

function localInput(ms: number) {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function getTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export default function FiltersPanel({ anchorRef, onClose }: { anchorRef: RefObject<HTMLButtonElement>; onClose: () => void }) {
  const filters = useStore((s) => s.filters);
  const tags = useStore((s) => s.tags);
  const [draft, setDraft] = useState(() => ({ ratingMin: filters.ratingMin, ratingMax: filters.ratingMax === 5 ? 0 : filters.ratingMax,
    addedFrom: filters.addedFrom, addedTo: filters.addedTo, createdFrom: filters.createdFrom, createdTo: filters.createdTo, notTags: filters.notTags }));
  const [tagSearch, setTagSearch] = useState("");
  const patch = (next: Partial<typeof draft>) => setDraft((prev) => ({ ...prev, ...next }));
  const count = advancedFilterCount({ ...filters, ...draft });
  const invalidRating = draft.ratingMax > 0 && draft.ratingMin > draft.ratingMax;
  const invalidDates = (draft.addedFrom && draft.addedTo && draft.addedFrom > draft.addedTo)
    || (draft.createdFrom && draft.createdTo && draft.createdFrom > draft.createdTo);
  const close = () => { anchorRef.current?.focus(); onClose(); };
  const choices = tags.filter((tag) => tag.name.toLowerCase().includes(tagSearch.trim().toLowerCase()));
  const apply = (patch: Partial<Filters>) => { useStore.getState().setFilters(patch); close(); };

  return <Popover anchor={anchorRef} label="高级筛选" onClose={onClose} className="filters-panel">
    <header className="popover-heading"><div><h2>高级筛选</h2><p>缩小范围，更快找到需要的素材</p></div>
      <button className="icon-button" aria-label="关闭筛选" onClick={close}><X size={17} /></button></header>
    <form className="filter-form" onSubmit={(event) => { event.preventDefault(); if (!invalidDates && !invalidRating) apply(draft); }}>
      <div className="filter-scroll">
      <div className="filter-section">
        <h3><Star size={16} />评分区间</h3>
        <div className="filter-fields">
          <label className="field-label">最低评分<select className="input" value={draft.ratingMin} onChange={(e) => patch({ ratingMin: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `${n} 星` : "不限"}</option>)}
          </select></label>
          <label className="field-label">最高评分<select className="input" value={draft.ratingMax} onChange={(e) => patch({ ratingMax: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n ? `${n} 星` : "不限"}</option>)}
          </select></label>
        </div>
        {invalidRating && <p className="inline-error" role="alert">最低评分不能高于最高评分。</p>}
      </div>
      <div className="filter-section">
        <h3><CalendarDays size={16} />添加时间{Boolean(draft.addedFrom || draft.addedTo) && <button type="button" className="text-button ml-auto" onClick={() => patch({ addedFrom: 0, addedTo: 0 })}>清除</button>}</h3>
        <div className="flex flex-wrap gap-1.5">{presets.map(({ label, days }) => <button className="chip" type="button" key={days} onClick={() => {
          const from = new Date();
          if (days) from.setDate(from.getDate() - days); else from.setHours(0, 0, 0, 0);
          patch({ addedFrom: from.getTime(), addedTo: 0 });
        }}>{label}</button>)}</div>
        <DateFields label="添加时间" from={draft.addedFrom} to={draft.addedTo} setFrom={(addedFrom) => patch({ addedFrom })} setTo={(addedTo) => patch({ addedTo })} />
      </div>
      <div className="filter-section">
        <h3><Camera size={16} />拍摄 / 创建时间{Boolean(draft.createdFrom || draft.createdTo) && <button type="button" className="text-button ml-auto" onClick={() => patch({ createdFrom: 0, createdTo: 0 })}>清除</button>}</h3>
        <DateFields label="拍摄时间" from={draft.createdFrom} to={draft.createdTo} setFrom={(createdFrom) => patch({ createdFrom })} setTo={(createdTo) => patch({ createdTo })} />
      </div>
      <div className="filter-section">
        <h3><Tag size={16} />排除标签</h3>
        {(tags.length > 8 || tagSearch) && <input type="search" className="input w-full" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder="查找标签…" aria-label="查找要排除的标签" />}
        <div className="filter-tags">
          {choices.map(({ name, color }) => <button key={name} className="chip" type="button" aria-pressed={draft.notTags.includes(name)} onClick={() => {
            patch({ notTags: draft.notTags.includes(name) ? draft.notTags.filter((x) => x !== name) : [...draft.notTags, name] });
          }}><span className="color-dot" style={{ backgroundColor: color }} /><span className="truncate">{name}</span></button>)}
          {!choices.length && <p className="text-muted text-xs">{tags.length ? "没有匹配的标签" : "资源库还没有标签"}</p>}
        </div>
      </div>
      </div>
      <div className="filter-actions">
        <button className="btn" type="button" onClick={() => patch(reset)} disabled={!count}><RotateCcw size={15} />重置</button>
        <button className="btn-primary" disabled={Boolean(invalidDates || invalidRating)}>应用筛选{count > 0 ? ` · ${count}` : ""}</button>
      </div>
    </form>
  </Popover>;
}

function DateFields({ label, from, to, setFrom, setTo }: { label: string; from: number; to: number; setFrom: (v: number) => void; setTo: (v: number) => void }) {
  return <>
    <div className="filter-fields date-fields">
      <label className="field-label">起始<input type="datetime-local" className="input" value={localInput(from)} aria-label={`${label}起始`} onChange={(e) => setFrom(getTime(e.target.value))} /></label>
      <label className="field-label">结束<input type="datetime-local" className="input" value={localInput(to)} aria-label={`${label}结束`} onChange={(e) => setTo(getTime(e.target.value))} /></label>
    </div>
    {Boolean(from && to && from > to) && <p className="inline-error" role="alert">结束时间不能早于起始时间。</p>}
  </>;
}
