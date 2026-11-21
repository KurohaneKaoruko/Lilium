import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, Clipboard, Eye, FolderOpen, Move, PanelRightOpen, Pencil, RotateCcw, Star, Tags, Trash2, WandSparkles } from "lucide-react";
import { useStore } from "../store/useStore";
import { api } from "../api/client";
import { notify, reportError } from "../lib/feedback";
import { formatCount } from "../lib/workspace";

interface MenuState { x: number; y: number; itemId: string; origin?: HTMLElement }
type Submenu = "tags" | "move" | "rating";

export default function ContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [submenu, setSubmenu] = useState<Submenu | null>(null);
  const selection = useStore((s) => s.selection);
  const folders = useStore((s) => s.folders);
  const tags = useStore((s) => s.tags);
  const trash = useStore((s) => s.filters.trash);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = (event: Event) => { setMenu((event as CustomEvent<MenuState>).detail); setSubmenu(null); };
    window.addEventListener("lilium:contextmenu", show);
    return () => window.removeEventListener("lilium:contextmenu", show);
  }, []);

  const close = (restoreFocus = true) => {
    if (restoreFocus) menu?.origin?.focus({ preventScroll: true });
    setMenu(null);
  };

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!menu || !panel) return;
    const position = () => {
      panel.style.left = `${Math.max(10, Math.min(menu.x, window.innerWidth - panel.offsetWidth - 10))}px`;
      panel.style.top = `${Math.max(10, Math.min(menu.y, window.innerHeight - panel.offsetHeight - 10))}px`;
    };
    position(); panel.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!panel.contains(event.target as Node)) close(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (submenu) setSubmenu(null); else close();
      }
    };
    const blur = () => close(false);
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", position);
    window.addEventListener("blur", blur);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("blur", blur);
    };
  }, [menu, submenu]);

  if (!menu) return null;
  const ids = selection.has(menu.itemId) ? [...selection] : [menu.itemId];
  const multi = ids.length > 1;
  const st = useStore.getState();
  const run = async (job: () => Promise<unknown>, errorLabel: string) => {
    close();
    try { await job(); } catch (error) { reportError(errorLabel, error); }
  };
  const batch = (action: string, fields: Record<string, unknown> = {}) => run(async () => {
    await api("/batch", { method: "POST", body: JSON.stringify({ ids, action, ...fields }) });
    await Promise.all([st.fetchItems(), st.refreshMeta()]);
    notify(`已更新 ${formatCount(ids.length)} 项素材`);
  }, "无法更新素材");
  const subTitle = submenu === "tags" ? "添加标签" : submenu === "move" ? "移动到文件夹" : "评分";

  return createPortal(<div className="popover action-menu asset-menu" ref={ref} role="dialog" aria-label={submenu ? subTitle : "素材操作"} tabIndex={-1} data-shortcut-scope>
    {submenu ? <>
      <button type="button" className="menu-row" onClick={() => setSubmenu(null)}><ArrowLeft size={15} />{subTitle}</button>
      <div className="menu-divider" />
      {submenu === "tags" && <>
        <form className="context-tag-form" onSubmit={(event) => {
          event.preventDefault();
          const tag = String(new FormData(event.currentTarget).get("tag") ?? "").trim();
          if (tag) void batch("tag", { tag });
        }}><input name="tag" className="input" aria-label="新标签" placeholder="新的标签…" required /><button className="btn-secondary">添加</button></form>
        {tags.map((tag) => <button type="button" key={tag.name} className="menu-row" onClick={() => void batch("tag", { tag: tag.name })}>
          <span className="color-dot" style={{ backgroundColor: tag.color }} /><span className="truncate">{tag.name}</span></button>)}
      </>}
      {submenu === "move" && <>
        <button className="menu-row" type="button" onClick={() => void batch("move", { folderId: "" })}>未分类</button>
        {folders.map((folder) => <button className="menu-row" key={folder.id} type="button" onClick={() => void batch("move", { folderId: folder.id })}>
          <FolderOpen size={15} /><span className="truncate">{folder.name}</span></button>)}
      </>}
      {submenu === "rating" && [0, 1, 2, 3, 4, 5].map((n) => <button className="menu-row" key={n} type="button" onClick={() => void batch("rating", { rating: n })}>
        <Star size={15} />{n ? `${n} 星` : "清除评分"}</button>)}
    </> : <>
      <p className="menu-caption">{multi ? `已选 ${formatCount(ids.length)} 项` : "素材操作"}</p>
      {!multi && <>
        <button type="button" className="menu-row" onClick={() => { close(); st.setLightbox(menu.itemId); }}><Eye size={16} />大图预览</button>
        <button type="button" className="menu-row" onClick={() => { close(); st.setDetail(menu.itemId); }}><PanelRightOpen size={16} />查看详情</button>
        <button type="button" className="menu-row" onClick={() => void run(async () => {
          const { path } = await api<{ path: string }>(`/items/${menu.itemId}`);
          await navigator.clipboard.writeText(path); notify("已复制文件路径");
        }, "无法复制文件路径")}><Clipboard size={16} />复制文件路径</button>
        <button type="button" className="menu-row" onClick={() => void run(() => api(`/reveal/${menu.itemId}`, { method: "POST" }), "无法打开文件位置")}><FolderOpen size={16} />打开所在目录</button>
        {!trash && <button type="button" className="menu-row" onClick={() => { close(); void st.showSimilar(menu.itemId); }}><WandSparkles size={16} />查找相似素材</button>}
        <div className="menu-divider" />
      </>}
      {!trash && <>
        <button type="button" className="menu-row" onClick={() => setSubmenu("tags")}><Tags size={16} />添加标签<ChevronRight size={13} className="ml-auto" /></button>
        <button type="button" className="menu-row" onClick={() => setSubmenu("move")}><Move size={16} />移动到…<ChevronRight size={13} className="ml-auto" /></button>
        <button type="button" className="menu-row" onClick={() => setSubmenu("rating")}><Star size={16} />评分<ChevronRight size={13} className="ml-auto" /></button>
        {multi && <button type="button" className="menu-row" onClick={() => {
          close(); window.dispatchEvent(new CustomEvent("lilium:batch-rename", { detail: { ids } }));
        }}><Pencil size={16} />批量重命名</button>}
        <div className="menu-divider" />
      </>}
      {trash ? <>
        <button type="button" className="menu-row" onClick={() => void batch("restore")}><RotateCcw size={16} />还原素材</button>
        <button type="button" className="menu-row is-danger" onClick={() => {
          if (confirm(`彻底删除 ${formatCount(ids.length)} 项素材？此操作无法撤销。`)) void batch("purge");
        }}><Trash2 size={16} />彻底删除</button>
      </> : <button type="button" className="menu-row is-danger" onClick={() => void batch("trash")}><Trash2 size={16} />移到回收站</button>}
    </>}
  </div>, document.body);
}
