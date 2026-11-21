import { useEffect, useId, useState } from "react";
import { Clipboard, ExternalLink, FolderOpen, Maximize, Palette, RotateCcw, Tag, Trash2, X } from "lucide-react";
import { useStore } from "../store/useStore";
import { api, fmtDate, humanSize, type Exif, type Item } from "../api/client";
import { notify, reportError } from "../lib/feedback";
import { KINDS } from "../lib/workspace";
import { Stars, Thumb } from "./views/shared";
import TagEditor from "./ui/TagEditor";

export const EXIF_LABELS: Record<string, string> = {
  make: "相机厂商", model: "相机型号", lens: "镜头", iso: "ISO",
  fnumber: "光圈", exposure: "快门", focal: "焦距", date: "拍摄时间",
};

export async function updateItem(id: string, patch: Partial<Pick<Item, "name" | "url" | "note" | "rating">>) {
  await api(`/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  useStore.getState().patchItemLocal(id, patch);
}

function httpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

export default function DetailPanel({ item, onClose }: { item: Item; onClose: () => void }) {
  const folders = useStore((s) => s.folders);
  const heading = useId();
  const [metadata, setMetadata] = useState<{ exif?: Exif | null; path?: string; hash?: string | null }>({});
  const [move, setMove] = useState(false);
  const [destination, setDestination] = useState(item.folderId ?? "");
  const [busy, setBusy] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [metaError, setMetaError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<typeof metadata>(`/items/${item.id}`, { signal: controller.signal }).then(setMetadata).catch(() => {
      if (!controller.signal.aborted) setMetaError(true);
    });
    return () => controller.abort();
  }, [item.id]);

  const copy = async (value: string, success: string) => {
    try { await navigator.clipboard.writeText(value); notify(success); }
    catch (error) { reportError("无法复制到剪贴板", error); }
  };
  const act = async (action: "move" | "trash" | "restore" | "purge") => {
    if (busy || (action === "purge" && !confirm(`彻底删除「${item.name}」？此操作无法撤销。`))) return;
    setBusy(true);
    try {
      await api("/batch", { method: "POST", body: JSON.stringify({ ids: [item.id], action, folderId: destination }) });
      const st = useStore.getState();
      if (action === "move") { st.patchItemLocal(item.id, { folderId: destination || null }); setMove(false); }
      else st.removeItemLocal(item.id);
      await Promise.all([st.refreshMeta(), st.fetchItems()]);
      notify({ move: "素材已移动", trash: "素材已移到回收站", restore: "素材已还原", purge: "素材已永久删除" }[action]);
    } catch (error) { reportError("操作失败", error); }
    finally { setBusy(false); }
  };
  const source = httpUrl(item.url);

  return <aside className="detail-panel" aria-labelledby={heading}>
    <header className="detail-header"><div><p>素材信息</p><h2 id={heading}>详情</h2></div>
      <button className="icon-button" onClick={onClose} aria-label="关闭详情" title="关闭详情"><X size={18} /></button></header>
    <div className="detail-scroll">
      <button className="detail-cover" type="button" aria-label="打开大图预览" title="打开大图预览" onClick={() => useStore.getState().setLightbox(item.id)}>
        <Thumb id={item.id} kind={item.kind} className="w-full h-full" contain eager /><span className="detail-cover-icon"><Maximize size={14} /></span>
      </button>
      <section className="detail-section detail-identity">
        <SaveField label="名称" field="name" item={item} />
        <div className="detail-rating"><span>评分</span><Stars value={item.rating} onChange={async (rating) => {
          if (ratingBusy) return;
          setRatingBusy(true);
          try { await updateItem(item.id, { rating }); } catch (error) { reportError("无法保存评分", error); }
          finally { setRatingBusy(false); }
        }} size={17} /></div>
        <dl className="detail-tiles">
          <div><dt>类型</dt><dd>{item.ext.toUpperCase() || KINDS[item.kind as keyof typeof KINDS] || "文件"}</dd></div>
          <div><dt>文件大小</dt><dd>{humanSize(item.size)}</dd></div>
          <div><dt>尺寸</dt><dd>{item.width && item.height ? `${item.width} × ${item.height}` : "—"}</dd></div>
        </dl>
      </section>
      <section className="detail-section"><h3><Tag size={15} />标签</h3><TagEditor item={item} /></section>
      {Boolean(item.palette?.length) && <section className="detail-section"><h3><Palette size={15} />调色板</h3>
        <div className="detail-palette">{item.palette?.slice(0, 6).map(({ color, weight }, i) => <button key={i} style={{ backgroundColor: color }}
          title={`复制 ${color} · ${Math.round(weight * 100)}%`} aria-label={`复制颜色 ${color}`} onClick={() => void copy(color, `已复制颜色 ${color}`)} />)}</div>
      </section>}
      <section className="detail-section space-y-3"><SaveField label="注释" field="note" item={item} />
        <SaveField label="来源链接" field="url" item={item} />
        {source && <a className="detail-link" href={source} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /><span className="truncate">打开来源链接</span></a>}
      </section>
      <section className="detail-section"><h3>文件信息</h3><dl className="detail-rows">
        <DataRow label="所在文件夹" value={folders.find((f) => f.id === item.folderId)?.name ?? "未分类"} />
        <DataRow label="添加时间" value={fmtDate(item.addedAt)} /><DataRow label="创建时间" value={fmtDate(item.createdAt)} />
        {item.duration != null && <DataRow label="时长" value={`${Math.round(item.duration)} 秒`} />}
        {metadata.hash && <DataRow label="哈希" value={metadata.hash} />}
      </dl>
      {metaError && <p className="inline-error">当前无法读取文件路径或 EXIF。</p>}</section>
      {metadata.exif && Object.keys(metadata.exif).length > 0 && <details className="detail-section detail-exif"><summary>EXIF 拍摄信息</summary>
        <dl className="detail-rows">{Object.entries(metadata.exif).map(([key, value]) => <DataRow key={key} label={EXIF_LABELS[key] ?? key} value={String(value)} />)}</dl>
      </details>}
      <section className="detail-section">
        {move && <form className="detail-move" onSubmit={(event) => { event.preventDefault(); void act("move"); }}>
          <label className="field-label">目标文件夹<select className="input" value={destination} onChange={(event) => setDestination(event.target.value)}>
            <option value="">未分类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select></label><button className="btn-primary" disabled={busy || destination === (item.folderId ?? "")}>移动</button>
        </form>}
        <div className="detail-actions">
          {!item.trash && <button className="btn" disabled={busy} aria-expanded={move} onClick={() => setMove(!move)}><FolderOpen size={15} />移动到…</button>}
          <button className="btn" disabled={!metadata.path} onClick={() => void copy(metadata.path ?? "", "已复制文件路径")}><Clipboard size={14} />复制路径</button>
          <button className="btn" onClick={() => void api(`/reveal/${item.id}`, { method: "POST" }).catch((error) => reportError("无法打开文件位置", error))}>
            <ExternalLink size={14} />打开目录</button>
          {item.trash && <button className="btn" disabled={busy} onClick={() => void act("restore")}><RotateCcw size={14} />还原素材</button>}
          <button className="btn is-danger" disabled={busy} onClick={() => void act(item.trash ? "purge" : "trash")}><Trash2 size={15} />{item.trash ? "彻底删除" : "移到回收站"}</button>
        </div>
      </section>
    </div>
  </aside>;
}

function SaveField({ item, field, label }: { item: Item; field: "name" | "url" | "note"; label: string }) {
  const value = item[field] ?? "";
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(value); }, [value]);
  const save = async () => {
    const text = field === "note" ? draft : draft.trim();
    if (text === value || busy) return;
    if (field === "name" && !text) { setDraft(value); return; }
    setBusy(true); setError("");
    try { await updateItem(item.id, { [field]: text }); setDraft(text); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div>
    <label className="field-label">
      <span className="flex justify-between">{label}<span className="text-subtle font-normal">{busy ? "保存中…" : "离开时保存"}</span></span>
      {field === "note" ? <textarea className="input w-full resize-y" value={draft} readOnly={busy} placeholder="为这份素材记录一点灵感…"
        onChange={(event) => setDraft(event.target.value)} onBlur={() => void save()} />
        : <input className="input w-full" value={draft} readOnly={busy} placeholder={field === "url" ? "https://…" : undefined} onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur(); }} />}
    </label>
    {error && <p className="inline-error" role="alert">保存失败：{error}</p>}
  </div>;
}

export function DataRow({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd title={value}>{value}</dd></div>;
}
