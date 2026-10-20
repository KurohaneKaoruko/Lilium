import { useEffect, useState } from "react";
import { Eye, FolderOpen, Copy, Pencil, Star, Trash2, RotateCcw, Search, Move, Tags, X, Wand2 } from "lucide-react";
import { useStore } from "../store/useStore";
import { api } from "../api/client";

interface MenuState {
  x: number;
  y: number;
  itemId: string | null;
}

/** 全局右键菜单：多选批量操作 */
export default function ContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [submenu, setSubmenu] = useState<"tags" | "move" | "rating" | null>(null);
  const selection = useStore((s) => s.selection);
  const folders = useStore((s) => s.folders);
  const tags = useStore((s) => s.tags);
  const fetchItems = useStore((s) => s.fetchItems);
  const refreshMeta = useStore((s) => s.refreshMeta);

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setMenu({ x: d.x, y: d.y, itemId: d.itemId });
      setSubmenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener("lilium:contextmenu", open);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("lilium:contextmenu", open);
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  if (!menu) return null;

  const ids = menu.itemId && selection.has(menu.itemId) ? [...selection] : menu.itemId ? [menu.itemId] : [];
  const multi = ids.length > 1;
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - (submenu ? 320 : 400));

  const act = async (fn: () => Promise<unknown>) => {
    setMenu(null);
    setSubmenu(null);
    await fn();
    fetchItems();
    refreshMeta();
  };

  return (
    <div
      className="fixed z-[60] w-52 bg-panel2 border border-border rounded-lg shadow-2xl py-1 pop-in text-xs"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {!multi && menu.itemId && (
        <>
          <Mi icon={<Eye size={13} />} label="大图预览" onClick={() => act(async () => useStore.getState().setLightbox(menu.itemId!))} />
          <Mi icon={<FolderOpen size={13} />} label="打开所在目录" onClick={() => act(() => api(`/reveal/${menu.itemId}`, { method: "POST" }))} />
          <Mi icon={<Copy size={13} />} label="复制文件路径" onClick={() => act(async () => {
            const d = await api<{ path: string }>(`/items/${menu.itemId}`);
            navigator.clipboard.writeText(d.path);
          })} />
          <Sep />
        </>
      )}

      {/* 标签子菜单 */}
      <div className="relative">
        <Mi icon={<Tags size={13} />} label={multi ? `为 ${ids.length} 项添加标签` : "添加标签"} arrow onClick={() => setSubmenu(submenu === "tags" ? null : "tags")} />
        {submenu === "tags" && (
          <div className="absolute left-full top-0 ml-1 w-44 max-h-72 overflow-y-auto bg-panel2 border border-border rounded-lg shadow-2xl py-1">
            {tags.slice(0, 40).map((t) => (
              <Mi key={t.name} dot={t.color} label={t.name} onClick={() => act(() => api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "tag", tag: t.name }) }))} />
            ))}
            <Sep />
            <TagInputRow onSubmit={(name) => act(() => api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "tag", tag: name }) }))} />
          </div>
        )}
      </div>

      {/* 移动子菜单 */}
      <div className="relative">
        <Mi icon={<Move size={13} />} label={multi ? `移动 ${ids.length} 项到…` : "移动到…"} arrow onClick={() => setSubmenu(submenu === "move" ? null : "move")} />
        {submenu === "move" && (
          <div className="absolute left-full top-0 ml-1 w-44 max-h-72 overflow-y-auto bg-panel2 border border-border rounded-lg shadow-2xl py-1">
            <Mi label="（移出文件夹）" onClick={() => act(() => api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "move", folderId: "" }) }))} />
            {folders.map((f) => (
              <Mi key={f.id} icon={<FolderOpen size={12} />} label={f.name} onClick={() => act(() => api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "move", folderId: f.id }) }))} />
            ))}
          </div>
        )}
      </div>

      {/* 评分子菜单 */}
      <div className="relative">
        <Mi icon={<Star size={13} />} label="评分" arrow onClick={() => setSubmenu(submenu === "rating" ? null : "rating")} />
        {submenu === "rating" && (
          <div className="absolute left-full top-0 ml-1 bg-panel2 border border-border rounded-lg shadow-2xl py-1">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <Mi key={n} label={n === 0 ? "清除评分" : "★".repeat(n)} onClick={() => act(() => api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "rating", rating: n }) }))} />
            ))}
          </div>
        )}
      </div>

      {/* 智能查找相似 */}
      {!multi && menu.itemId && (
        <Mi icon={<Wand2 size={13} />} label="查找相似图片" onClick={() => act(async () => {
          await useStore.getState().showSimilar(menu.itemId!);
          if (useStore.getState().items.length === 0) alert("未找到相似图片（需要更多已分析图片）");
        })} />
      )}

      <Sep />
      {multi && (
        <Mi icon={<Pencil size={13} />} label={`批量重命名 ${ids.length} 项`} onClick={() => {
          setMenu(null);
          window.dispatchEvent(new CustomEvent("lilium:batch-rename", { detail: { ids } }));
        }} />
      )}
      <Sep />
      {useStore.getState().filters.trash ? (
        <>
          <Mi icon={<RotateCcw size={13} />} label={multi ? `还原 ${ids.length} 项` : "还原"} onClick={() => act(() => api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "restore" }) }))} />
          <Mi icon={<Trash2 size={13} />} label={multi ? `彻底删除 ${ids.length} 项` : "彻底删除"} danger onClick={() => { if (confirm(`彻底删除 ${ids.length} 项？不可恢复！`)) return act(() => api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "purge" }) })); }} />
        </>
      ) : (
        <Mi icon={<Trash2 size={13} />} label={multi ? `删除 ${ids.length} 项` : "删除到回收站"} danger onClick={() => act(() => api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "trash" }) }))} />
      )}
    </div>
  );
}

function Mi({ icon, label, onClick, danger, arrow, dot }: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  arrow?: boolean;
  dot?: string;
}) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/8 text-left ${danger ? "text-red-400 hover:bg-red-500/10" : ""}`}
      onClick={onClick}
    >
      {dot ? <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} /> : icon}
      <span className="flex-1 truncate">{label}</span>
      {arrow && <span className="text-neutral-600">›</span>}
    </button>
  );
}

function Sep() {
  return <div className="my-1 border-t border-border" />;
}

function TagInputRow({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <Search size={12} className="text-neutral-600" />
      <input
        autoFocus
        className="input flex-1 !py-1"
        placeholder="新标签…"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) {
            onSubmit(v.trim());
          }
          if (e.key === "Escape") setV("");
        }}
      />
      <button className="p-0.5 hover:bg-white/10 rounded" onClick={() => v.trim() && onSubmit(v.trim())}><X size={11} className="text-neutral-500" /></button>
    </div>
  );
}
