import { useEffect, useState } from "react";
import { ExternalLink, FolderDown, Info, Star, Trash2, X, Tag, Hash } from "lucide-react";
import { useStore } from "../store/useStore";
import { api, fileUrl, fmtDate, humanSize, type Exif } from "../api/client";
import { Stars } from "./views/shared";

/** 右侧详情面板：元数据、标签、评分、注释 */
export default function DetailPanel() {
  const detailId = useStore((s) => s.detailId);
  const setDetail = useStore((s) => s.setDetail);
  const items = useStore((s) => s.items);
  const patchItemLocal = useStore((s) => s.patchItemLocal);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const [exif, setExif] = useState<Exif | null>(null);
  const [path, setPath] = useState<string>("");
  const [tagInput, setTagInput] = useState("");
  const [note, setNote] = useState("");
  const [noteTimer, setNoteTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [url, setUrl] = useState("");

  const item = items.find((i) => i.id === detailId) ?? null;

  useEffect(() => {
    if (!detailId) return;
    setExif(null);
    api<{ exif: Exif | null; path: string }>(`/items/${detailId}`)
      .then((d) => {
        setExif(d.exif);
        setPath(d.path);
      })
      .catch(() => {});
    const it = useStore.getState().items.find((i) => i.id === detailId);
    setNote(it?.note ?? "");
    setUrl(it?.url ?? "");
  }, [detailId]);

  if (!item) return null;

  const setRating = async (v: number) => {
    patchItemLocal(item.id, { rating: v });
    await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ rating: v }) });
  };

  const addTag = async (name: string) => {
    const t = name.trim();
    if (!t) return;
    await api(`/items/${item.id}/tags/${encodeURIComponent(t)}`, { method: "PUT" });
    patchItemLocal(item.id, { tags: [...item.tags.filter((x) => x !== t), t] });
    setTagInput("");
    refreshMeta();
  };

  const removeTag = async (t: string) => {
    await api(`/items/${item.id}/tags/${encodeURIComponent(t)}`, { method: "DELETE" });
    patchItemLocal(item.id, { tags: item.tags.filter((x) => x !== t) });
    refreshMeta();
  };

  const setNoteDebounced = (v: string) => {
    setNote(v);
    if (noteTimer) clearTimeout(noteTimer);
    setNoteTimer(setTimeout(async () => {
      await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ note: v }) });
      patchItemLocal(item.id, { note: v });
    }, 500));
  };

  const setUrlDebounced = (v: string) => {
    setUrl(v);
    if (noteTimer) clearTimeout(noteTimer);
    setNoteTimer(setTimeout(async () => {
      await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ url: v }) });
      patchItemLocal(item.id, { url: v });
    }, 500));
  };

  const trash = async () => {
    await api(`/items/${item.id}`, { method: "DELETE" });
    useStore.getState().removeItemLocal(item.id);
    setDetail(null);
  };

  const moveTo = async () => {
    const folders = useStore.getState().folders;
    const list = folders.map((f) => `${f.name} (${f.id})`).join("\n");
    const pick = prompt(`移动到文件夹 ID（直接回车=移出文件夹）：\n${list}`);
    if (pick === null) return;
    const fid = pick.match(/\(([A-Z0-9]+)\)/)?.[1] || pick.trim() || "";
    await api("/batch", { method: "POST", body: JSON.stringify({ ids: [item.id], action: "move", folderId: fid }) });
    patchItemLocal(item.id, { folderId: fid || null });
  };

  const copyPath = async () => {
    await navigator.clipboard.writeText(path);
  };

  const dims = item.width ? `${item.width} × ${item.height}` : "—";

  return (
    <aside className="w-64 shrink-0 bg-panel border-l border-border overflow-y-auto fade-in">
      {/* 预览 */}
      <div className="relative bg-black/40 group">
        {item.kind === "image" || item.kind === "video" ? (
          <img src={fileUrl(item.id)} alt="" className="w-full max-h-56 object-contain cursor-zoom-in" onClick={() => useStore.getState().setLightbox(item.id)} />
        ) : (
          <div className="h-40 flex items-center justify-center text-neutral-600">无预览</div>
        )}
        <button className="absolute top-1.5 right-1.5 btn !p-1 bg-black/50 opacity-0 group-hover:opacity-100" onClick={() => setDetail(null)}><X size={13} /></button>
      </div>

      <div className="p-3 space-y-4">
        {/* 名称（可编辑） */}
        <input
          className="input w-full text-xs font-medium"
          defaultValue={item.name}
          key={item.id + item.name}
          onBlur={async (e) => {
            const v = e.target.value.trim();
            if (v && v !== item.name) {
              await api(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ name: v }) });
              patchItemLocal(item.id, { name: v });
            }
          }}
        />

        {/* 评分 */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500 flex items-center gap-1"><Star size={11} /> 评分</span>
          <Stars value={item.rating} onChange={setRating} size={15} />
        </div>

        {/* 标签 */}
        <div>
          <div className="text-[11px] text-neutral-500 flex items-center gap-1 mb-1.5"><Tag size={11} /> 标签</div>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {item.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 bg-violet-500/15 text-violet-200 text-[11px] px-1.5 py-0.5 rounded">
                {t}
                <button onClick={() => removeTag(t)} className="hover:text-white"><X size={10} /></button>
              </span>
            ))}
          </div>
          <input
            className="input w-full"
            placeholder="添加标签，回车确认"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTag(tagInput);
            }}
          />
        </div>

        {/* 信息 */}
        <div className="text-[11px] space-y-1">
          <Row k="尺寸" v={dims} />
          <Row k="格式" v={item.ext.toUpperCase()} />
          <Row k="大小" v={humanSize(item.size)} />
          {item.duration ? <Row k="时长" v={`${Math.round(item.duration)}s`} /> : null}
          <Row k="添加于" v={fmtDate(item.addedAt)} />
          <Row k="创建于" v={fmtDate(item.createdAt)} />
          {item.hash && <Row k="哈希" v={item.hash.slice(0, 12) + "…"} />}
        </div>

        {/* 色板 */}
        {Array.isArray(item.palette) && item.palette.length > 0 && (
          <div>
            <div className="text-[11px] text-neutral-500 mb-1.5">调色板</div>
            <div className="flex gap-1">
              {item.palette.slice(0, 6).map((p, i) => (
                <div key={i} className="flex-1 h-6 rounded cursor-pointer relative group" style={{ backgroundColor: p.color }} title={`${p.color} (${Math.round(p.weight * 100)}%)`} onClick={() => navigator.clipboard.writeText(p.color)} />
              ))}
            </div>
          </div>
        )}

        {/* URL */}
        <div>
          <div className="text-[11px] text-neutral-500 mb-1.5 flex items-center gap-1"><ExternalLink size={11} /> 来源 URL</div>
          <input className="input w-full" placeholder="https://…" value={url} onChange={(e) => setUrlDebounced(e.target.value)} />
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="text-[11px] text-violet-300 hover:underline mt-1 inline-block truncate max-w-full">{item.url}</a>
          )}
        </div>

        {/* 注释 */}
        <div>
          <div className="text-[11px] text-neutral-500 mb-1.5">注释</div>
          <textarea className="input w-full h-20 resize-none" placeholder="记录点什么…" value={note} onChange={(e) => setNoteDebounced(e.target.value)} />
        </div>

        {/* EXIF */}
        {exif && Object.keys(exif).length > 0 && (
          <div>
            <div className="text-[11px] text-neutral-500 mb-1.5 flex items-center gap-1"><Hash size={11} /> EXIF</div>
            <div className="text-[11px] space-y-1">
              {Object.entries(exif).map(([k, v]) => <Row key={k} k={k} v={v} />)}
            </div>
          </div>
        )}

        {/* 操作 */}
        <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-border">
          <button className="btn justify-center" onClick={moveTo}><FolderDown size={12} /> 移动到…</button>
          <button className="btn justify-center" onClick={copyPath} title={path}><Info size={12} /> 复制路径</button>
          <button className="btn justify-center" onClick={() => api(`/reveal/${item.id}`, { method: "POST" })}><ExternalLink size={12} /> 打开目录</button>
          <button className="btn justify-center !text-red-400 hover:!bg-red-500/10" onClick={trash}><Trash2 size={12} /> {item.trash ? "彻底删除" : "删除"}</button>
        </div>
      </div>
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-neutral-600 shrink-0">{k}</span>
      <span className="text-neutral-300 truncate text-right" title={v}>{v}</span>
    </div>
  );
}
