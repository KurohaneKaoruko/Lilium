import { useState } from "react";
import { Plus, X } from "lucide-react";
import { api, type Item } from "../../api/client";
import { reportError } from "../../lib/feedback";
import { useStore } from "../../store/useStore";

export default function TagEditor({ item }: { item: Item }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const tags = useStore((s) => s.tags);
  const change = async (tag: string, add: boolean) => {
    const name = tag.trim();
    if (!name || busy) return;
    if (add && item.tags.includes(name)) { setLabel(""); return; }
    setBusy(true);
    try {
      await api(`/items/${item.id}/tags/${encodeURIComponent(name)}`, { method: add ? "PUT" : "DELETE" });
      const store = useStore.getState();
      const current = store.items.find(({ id }) => id === item.id);
      if (current) store.patchItemLocal(item.id, { tags: add ? [...new Set([...current.tags, name])] : current.tags.filter((tag) => tag !== name) });
      if (add) setLabel("");
      void store.refreshMeta();
    } catch (error) { reportError("无法更新标签", error); }
    finally { setBusy(false); }
  };

  return <div className="tag-editor">
    {item.tags.length > 0 && <div className="tag-editor-list">{item.tags.map((tag) => <span key={tag} className="chip">
      {tags.some((entry) => entry.name === tag) && <span className="color-dot" style={{ background: tags.find((entry) => entry.name === tag)?.color }} />}
      <span className="truncate" title={tag}>{tag}</span><button type="button" disabled={busy} aria-label={`移除标签 ${tag}`} onClick={() => void change(tag, false)}><X size={12} /></button>
    </span>)}</div>}
    <form className="tag-editor-form" onSubmit={(event) => { event.preventDefault(); if (!busy) void change(label, true); }}>
      <input className="input" value={label} placeholder="输入标签…" aria-label="添加标签" onChange={(e) => setLabel(e.target.value)} />
      <button className="btn-secondary square-button" type="submit" disabled={busy || !label.trim()} aria-label="保存标签" title="保存标签"><Plus size={17} /></button>
    </form>
  </div>;
}
