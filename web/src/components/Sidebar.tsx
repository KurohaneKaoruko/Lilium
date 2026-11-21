import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ChevronDown, ChevronRight, Ellipsis, Folder, FolderOpen, FolderPlus, Images, Inbox, Keyboard, Layers2, Palette, Pencil, Plus, RefreshCw, Settings, SlidersHorizontal, Tags, Trash2, X } from "lucide-react";
import { defaultFilters, filtersFromQuery, useStore, type Filters } from "../store/useStore";
import { api, humanSize, type Folder as FolderEntry, type SmartFolder } from "../api/client";
import { notify, reportError } from "../lib/feedback";
import { formatCount, KINDS } from "../lib/workspace";
import LibraryPanel from "./LibraryPanel";
import NameDialog from "./ui/NameDialog";
import Popover from "./ui/Popover";
import type { ToolMode } from "./TopBar";

interface TreeNode extends FolderEntry { children: TreeNode[] }
const PRESET_COLORS = ["#ef5350", "#f49842", "#e5bc4a", "#70bc7f", "#51bbbc", "#639bf0", "#9b76ee", "#e07aa6"];

function buildTree(folders: FolderEntry[]) {
  const map = new Map<string, TreeNode>(folders.map((f) => [f.id, { ...f, children: [] }]));
  const roots: TreeNode[] = [];
  map.forEach((node) => {
    const parent = node.parentId ? map.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

type Edit = { kind: "folder"; entry?: FolderEntry; parent?: TreeNode } | { kind: "smart"; entry?: SmartFolder };
type OpenActions = { label: string; run: () => void; icon: React.ReactNode; danger?: boolean }[];

export default function Sidebar({ collapsed = false, onDismiss, onNavigate, onExpand, onTool }: {
  collapsed?: boolean;
  onDismiss?: () => void;
  onNavigate?: () => void;
  onExpand: () => void;
  onTool: (tool: ToolMode) => void;
}) {
  const info = useStore((s) => s.info);
  const folders = useStore((s) => s.folders);
  const tags = useStore((s) => s.tags);
  const smartFolders = useStore((s) => s.smartFolders);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const [tagSearch, setTagSearch] = useState("");
  const [tagLimit, setTagLimit] = useState(12);
  const [libOpen, setLibOpen] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const libButton = useRef<HTMLButtonElement>(null);
  const tree = useMemo(() => buildTree(folders), [folders]);
  const ancestors = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const ids = new Set<string>();
    let parent = filters.folderId ? byId.get(filters.folderId)?.parentId : null;
    while (parent && !ids.has(parent)) { ids.add(parent); parent = byId.get(parent)?.parentId; }
    return ids;
  }, [folders, filters.folderId]);
  const libraryName = info?.name ?? "Lilium 资源库";
  const filteredTags = tags.filter((tag) => tag.name.toLowerCase().includes(tagSearch.trim().toLowerCase()));

  const go = (scope: Partial<Filters>) => {
    const st = useStore.getState();
    if (st.view === "collections") st.setView("masonry");
    st.setFilters({ ...defaultFilters, ...scope });
    onNavigate?.();
  };
  const applyTag = (tag: string) => {
    const st = useStore.getState();
    if (st.view === "collections") st.setView("masonry");
    setFilters({ tag: filters.tag === tag ? null : tag, untagged: false });
    onNavigate?.();
  };
  const save = async (name: string) => {
    if (!edit) return;
    if (edit.kind === "folder") {
      if (edit.entry) await api(`/folders/${edit.entry.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      else await api("/folders", { method: "POST", body: JSON.stringify({ name, parentId: edit.parent?.id ?? null }) });
    } else {
      const query = edit.entry?.query ?? useStore.getState().filters;
      await api(edit.entry ? `/smart-folders/${edit.entry.id}` : "/smart-folders", {
        method: edit.entry ? "PUT" : "POST", body: JSON.stringify({ name, query }),
      });
    }
    await refreshMeta();
    notify(edit.entry ? "名称已更新" : edit.kind === "folder" ? "文件夹已创建" : "筛选条件已保存");
  };
  const removeFolder = async (node: TreeNode) => {
    if (!confirm(`删除文件夹「${node.name}」？此操作不会删除文件夹中的素材。`)) return;
    try {
      await api(`/folders/${node.id}`, { method: "DELETE" });
      const st = useStore.getState();
      if (st.filters.folderId === node.id) st.resetFilters();
      else void st.fetchItems();
      await refreshMeta();
      notify("已删除文件夹");
    } catch (error) { reportError("无法删除文件夹", error); }
  };
  const removeSmart = async (entry: SmartFolder) => {
    if (!confirm(`删除智能文件夹「${entry.name}」？`)) return;
    try {
      await api(`/smart-folders/${entry.id}`, { method: "DELETE" });
      if (useStore.getState().filters.smartId === entry.id) useStore.getState().resetFilters();
      await refreshMeta();
      notify("已删除智能文件夹");
    } catch (error) { reportError("无法删除智能文件夹", error); }
  };
  const updateSmart = async (entry: SmartFolder) => {
    try {
      await api(`/smart-folders/${entry.id}`, { method: "PUT", body: JSON.stringify({ name: entry.name, query: useStore.getState().filters }) });
      await refreshMeta();
      notify("已更新智能文件夹的筛选条件");
    } catch (error) { reportError("无法更新智能文件夹", error); }
  };

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`} aria-label="素材库侧栏">
      <div className="sidebar-workspace">
        {!collapsed && <div className="sidebar-eyebrow">工作空间
          {onDismiss && <button className="icon-button sidebar-mini" aria-label="关闭侧栏" onClick={onDismiss}><X size={16} /></button>}
        </div>}
        <button type="button" ref={libButton} className="library-trigger" title="管理资源库" aria-label="管理资源库" aria-haspopup="dialog"
          aria-expanded={libOpen} onClick={() => setLibOpen((open) => !open)}>
          <span className="library-mark"><Layers2 size={17} /></span>
          {!collapsed && <><span className="min-w-0 flex-1"><strong className="block truncate" title={libraryName}>{libraryName}</strong>
            <small>{info ? `${formatCount(info.itemCount)} 项 · ${humanSize(info.totalSize)}` : "本地素材库"}</small></span><ChevronDown size={14} /></>}
        </button>
        {libOpen && <LibraryPanel anchorRef={libButton} onClose={() => setLibOpen(false)} />}
      </div>

      <nav className="sidebar-scroll" aria-label="素材分类">
        <div className="sidebar-section">
          {!collapsed && <h2 className="sidebar-eyebrow">素材库</h2>}
          <NavButton icon={<Images size={17} />} label="全部素材" collapsed={collapsed}
            active={!filters.folderId && !filters.smartId && !filters.trash && !filters.unfiled && !filters.untagged && !filters.tag}
            onClick={() => go({})} count={info?.itemCount} />
          <NavButton icon={<Inbox size={17} />} label="未分类" collapsed={collapsed} active={filters.unfiled && !filters.smartId}
            onClick={() => go({ unfiled: true })} />
          <NavButton icon={<Tags size={17} />} label="未打标签" collapsed={collapsed} active={filters.untagged && !filters.smartId}
            onClick={() => go({ untagged: true })} />
          <NavButton icon={<Trash2 size={17} />} label="回收站" collapsed={collapsed} active={filters.trash && !filters.smartId}
            onClick={() => go({ trash: true })} />
        </div>

        {collapsed ? (
          <div className="sidebar-section rail-sections">
            <NavButton collapsed icon={<Folder size={17} />} label="展开文件夹" active={Boolean(filters.folderId && !filters.smartId)} onClick={onExpand} />
            <NavButton collapsed icon={<Bookmark size={17} />} label="展开智能文件夹" active={Boolean(filters.smartId)} onClick={onExpand} />
            <NavButton collapsed icon={<Tags size={17} />} label="展开标签" active={Boolean(filters.tag)} onClick={onExpand} />
            <NavButton collapsed icon={<SlidersHorizontal size={17} />} label="展开快速筛选" active={Boolean(filters.kinds.length || filters.color || filters.ratingMin)} onClick={onExpand} />
          </div>
        ) : <>
          <Section title="文件夹" action={<button className="icon-button sidebar-mini" title="新建文件夹" aria-label="新建文件夹"
            onClick={() => setEdit({ kind: "folder" })}><Plus size={16} /></button>}>
            {tree.length ? tree.map((node) => <FolderNode key={node.id} node={node} depth={0} ancestors={ancestors}
              activeId={!filters.smartId && !filters.trash ? filters.folderId : null}
              onOpen={(id) => go({ folderId: id })} onNew={(parent) => setEdit({ kind: "folder", parent })}
              onRename={(entry) => setEdit({ kind: "folder", entry })} onDelete={removeFolder} />)
              : <button className="sidebar-empty" onClick={() => setEdit({ kind: "folder" })}><FolderPlus size={15} /> 新建文件夹</button>}
          </Section>
          <Section title="智能文件夹" action={<button className="icon-button sidebar-mini" title="保存当前筛选" aria-label="保存当前筛选"
            onClick={() => setEdit({ kind: "smart" })}><Plus size={16} /></button>}>
            {smartFolders.length ? smartFolders.map((entry) => <div className={`sidebar-tree-row ${filters.smartId === entry.id ? "is-active" : ""}`} key={entry.id}>
              <NavButton icon={<Bookmark size={15} />} label={entry.name} active={filters.smartId === entry.id}
                onClick={() => go({ ...filtersFromQuery(entry.query), smartId: entry.id })} />
              <RowActions label={entry.name} actions={[
                { icon: <RefreshCw size={15} />, label: "用当前筛选覆盖", run: () => void updateSmart(entry) },
                { icon: <Pencil size={15} />, label: "重命名", run: () => setEdit({ kind: "smart", entry }) },
                { icon: <Trash2 size={15} />, label: "删除智能文件夹", run: () => void removeSmart(entry), danger: true },
              ]} />
            </div>) : <button className="sidebar-empty" onClick={() => setEdit({ kind: "smart" })}><Bookmark size={15} /> 保存当前筛选</button>}
          </Section>
          <Section title="标签" badge={tags.length || undefined}>
            {tags.length > 8 && <input className="input sidebar-tag-search" aria-label="搜索标签" placeholder="搜索标签…"
              value={tagSearch} onChange={(event) => { setTagSearch(event.target.value); setTagLimit(12); }} />}
            {filteredTags.slice(0, tagLimit).map((tag) => <NavButton key={tag.name} icon={<span className="color-dot" style={{ background: tag.color }} />}
              label={tag.name} active={filters.tag === tag.name} count={tag.count} onClick={() => applyTag(tag.name)} />)}
            {!filteredTags.length && <p className="sidebar-note">{tags.length ? "没有匹配的标签" : "给素材打上标签后，会显示在这里"}</p>}
            {filteredTags.length > tagLimit && <button className="text-button sidebar-more" onClick={() => setTagLimit(tagLimit + 30)}>查看更多标签</button>}
          </Section>
          <Section title="快速筛选" initiallyOpen={false} badge={filters.kinds.length + Number(Boolean(filters.color)) + Number(filters.ratingMin > 0) || undefined}>
            <div className="sidebar-refine">
              <p>素材类型</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(KINDS).map(([kind, label]) => <button key={kind} className="chip" aria-pressed={filters.kinds.includes(kind)}
                  onClick={() => setFilters({ kinds: filters.kinds.includes(kind) ? filters.kinds.filter((k) => k !== kind) : [...filters.kinds, kind] })}>{label}</button>)}
              </div>
              <label className="field-label">最低评分
                <select className="input" value={filters.ratingMin} onChange={(e) => {
                  const ratingMin = Number(e.target.value);
                  setFilters({ ratingMin, ...(filters.ratingMax && ratingMin > filters.ratingMax ? { ratingMax: 0 } : {}) });
                }}>
                  {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `${n} 星及以上` : "不限"}</option>)}
                </select>
              </label>
              <div className="flex items-center justify-between"><p>主色</p>{filters.color && <button className="text-button" onClick={() => setFilters({ color: null })}>清除</button>}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {PRESET_COLORS.map((color) => <button className="swatch" key={color} style={{ background: color }} title={color}
                  aria-pressed={filters.color === color} aria-label={`主色 ${color}`} onClick={() => setFilters({ color: filters.color === color ? null : color, colorTolerance: 60 })} />)}
                <label className="swatch swatch-custom" title="自定义主色"><Palette size={13} />
                  <input type="color" aria-label="自定义主色" className="sr-only" value={filters.color ?? "#9b76ee"}
                    onChange={(event) => setFilters({ color: event.target.value, colorTolerance: 60 })} /></label>
              </div>
            </div>
          </Section>
        </>}
      </nav>

      <div className="sidebar-footer">
        <NavButton collapsed={collapsed} icon={<Settings size={17} />} label="设置" onClick={() => onTool("settings")} />
        <NavButton collapsed={collapsed} icon={<Keyboard size={17} />} label="键盘快捷键" onClick={() => onTool("shortcuts")} />
      </div>
      {edit && <NameDialog title={edit.entry ? "重命名" : edit.kind === "smart" ? "保存为智能文件夹" : edit.parent ? "新建子文件夹" : "新建文件夹"}
        initial={edit.entry?.name} onClose={() => setEdit(null)} onSave={save} />}
    </aside>
  );
}

function FolderNode({ node, depth, activeId, ancestors, onOpen, onNew, onRename, onDelete }: {
  node: TreeNode; depth: number; activeId: string | null; ancestors: Set<string>;
  onOpen: (id: string) => void; onNew: (node: TreeNode) => void; onRename: (node: TreeNode) => void; onDelete: (node: TreeNode) => void;
}) {
  const [open, setOpen] = useState(() => depth === 0 || ancestors.has(node.id));
  const [dropping, setDropping] = useState(false);
  const below = ancestors.has(node.id);
  useEffect(() => { if (below) setOpen(true); }, [below]);
  const active = activeId === node.id;
  const hasChildren = node.children.length > 0;

  return <div>
    <div className={`sidebar-tree-row ${active ? "is-active" : ""} ${dropping ? "is-dropping" : ""}`} style={{ paddingInlineStart: Math.min(depth, 5) * 10 }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("application/x-lilium-items")) return;
        event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropping(true);
      }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
      onDrop={async (event) => {
        setDropping(false);
        const raw = event.dataTransfer.getData("application/x-lilium-items");
        if (!raw) return;
        event.preventDefault();
        try {
          const ids = JSON.parse(raw) as string[];
          await api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "move", folderId: node.id }) });
          const st = useStore.getState();
          st.clearSelection();
          await Promise.all([st.fetchItems(), st.refreshMeta()]);
          notify(`已移动到「${node.name}」`);
        } catch (error) { reportError("无法移动素材", error); }
      }}>
      {hasChildren ? <button className="sidebar-disclosure" type="button" aria-expanded={open} aria-label={`${open ? "折叠" : "展开"} ${node.name}`}
        onClick={() => setOpen((value) => !value)}><ChevronRight size={13} className={open ? "rotate-90" : ""} /></button>
        : <span className="sidebar-disclosure" />}
      <NavButton icon={open && hasChildren ? <FolderOpen size={16} /> : <Folder size={16} />} label={node.name} active={active}
        count={node.itemCount} onClick={() => onOpen(node.id)} />
      <RowActions label={node.name} actions={[
        { icon: <FolderPlus size={15} />, label: "新建子文件夹", run: () => { setOpen(true); onNew(node); } },
        { icon: <Pencil size={15} />, label: "重命名", run: () => onRename(node) },
        { icon: <Trash2 size={15} />, label: "删除文件夹", run: () => onDelete(node), danger: true },
      ]} />
    </div>
    {open && node.children.map((child) => <FolderNode key={child.id} node={child} depth={depth + 1}
      {...{ ancestors, activeId, onOpen, onNew, onRename, onDelete }} />)}
  </div>;
}

function RowActions({ label, actions }: { label: string; actions: OpenActions }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return <>
    <button type="button" className="icon-button sidebar-mini sidebar-row-actions" ref={anchor} title={`${label}的操作`}
      aria-label={`${label}的操作`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><Ellipsis size={16} /></button>
    {open && <Popover anchor={anchor} className="action-menu" label={`${label}的操作`} onClose={() => setOpen(false)}>
      {actions.map((action) => <button key={action.label} className={`menu-row ${action.danger ? "is-danger" : ""}`} onClick={() => {
        anchor.current?.focus(); setOpen(false); action.run();
      }}>{action.icon}{action.label}</button>)}
    </Popover>}
  </>;
}

function NavButton({ icon, label, onClick, active, collapsed, count }: {
  icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; collapsed?: boolean; count?: number;
}) {
  return <button className={`sidebar-link ${active ? "is-active" : ""}`} type="button" title={label} aria-label={label}
    aria-current={active ? "true" : undefined} onClick={onClick}>
    <span className="sidebar-link-icon" aria-hidden="true">{icon}</span>
    {!collapsed && <><span className="min-w-0 flex-1 truncate">{label}</span>{count !== undefined && <span className="sidebar-count">{formatCount(count)}</span>}</>}
  </button>;
}

function Section({ title, action, badge, children, initiallyOpen = true }: {
  title: string; action?: React.ReactNode; badge?: number; children: React.ReactNode; initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return <section className="sidebar-section">
    <div className="sidebar-section-header">
      <h2><button className="sidebar-eyebrow" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {title}{badge !== undefined && <span className="sidebar-count">{formatCount(badge)}</span>}
        <ChevronRight size={11} className={open ? "rotate-90" : ""} />
      </button></h2>{action}
    </div>
    {open && children}
  </section>;
}
