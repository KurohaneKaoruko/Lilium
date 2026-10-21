import { useMemo, useState } from "react";
import {
  ChevronRight, Folder as FolderIcon, FolderOpen, FolderPlus, Image, Star, Trash2,
  Tags, Palette, X, Bookmark, Pencil, Inbox,
} from "lucide-react";
import { useStore, type Filters } from "../store/useStore";
import { api, type Folder } from "../api/client";
import humanSize from "../lib/human";

interface TreeNode extends Folder {
  children: TreeNode[];
}

function buildTree(folders: Folder[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  folders.forEach((f) => map.set(f.id, { ...f, children: [] }));
  const roots: TreeNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function FolderNode({ node, depth }: { node: TreeNode; depth: number }) {
  const folders = useStore((s) => s.folders);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const fetchItems = useStore((s) => s.fetchItems);
  const [open, setOpen] = useState(depth < 1);
  const [dropping, setDropping] = useState(false);

  const active = filters.folderId === node.id;
  const hasChildren = node.children.length > 0;

  const countIn = useMemo(() => {
    // 统计该节点及子节点的条目数交给后端，这里仅显示直接子数占位
    return null;
  }, []);
  void countIn;

  const createSub = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = prompt("子文件夹名称：");
    if (!name?.trim()) return;
    await api("/folders", { method: "POST", body: JSON.stringify({ parentId: node.id, name: name.trim() }) });
    refreshMeta();
  };

  const rename = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = prompt("重命名文件夹：", node.name);
    if (!name?.trim() || name === node.name) return;
    await api(`/folders/${node.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
    refreshMeta();
  };

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`删除文件夹「${node.name}」？其中的图片会移到未分类。`)) return;
    await api(`/folders/${node.id}`, { method: "DELETE" });
    if (filters.folderId === node.id) {
      setFilters({ folderId: null });
    } else {
      refreshMeta();
      fetchItems();
    }
  };

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md px-1.5 py-[5px] cursor-pointer text-xs ${
          active ? "bg-violet-500/15 text-violet-300" : "hover:bg-white/5 text-neutral-300"
        } ${dropping ? "ring-1 ring-violet-400" : ""}`}
        style={{ paddingLeft: depth * 12 + 6 }}
        onClick={() => setFilters({ folderId: node.id, trash: false, smartId: null })}
        onContextMenu={async (e) => {
          // 简单上下文：用 prompt 流程
          if (e.altKey) return;
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-lilium-items")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDropping(false);
          const raw = e.dataTransfer.getData("application/x-lilium-items");
          if (!raw) return;
          const ids = JSON.parse(raw) as string[];
          await api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "move", folderId: node.id }) });
          useStore.getState().fetchItems();
        }}
      >
        <button
          className={`p-0.5 rounded hover:bg-white/10 ${hasChildren ? "" : "invisible"}`}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        {open && hasChildren ? <FolderOpen size={14} className="text-violet-400/80 shrink-0" /> : <FolderIcon size={14} className="text-violet-400/70 shrink-0" />}
        <span className="truncate flex-1">{node.name}</span>
        <span className="hidden group-hover:flex items-center gap-0.5">
          <button className="p-0.5 rounded hover:bg-white/10" onClick={createSub} title="新建子文件夹"><FolderPlus size={12} /></button>
          <button className="p-0.5 rounded hover:bg-white/10" onClick={rename} title="重命名"><Pencil size={11} /></button>
          <button className="p-0.5 rounded hover:bg-white/10" onClick={remove} title="删除"><Trash2 size={11} /></button>
        </span>
      </div>
      {open && node.children.map((c) => <FolderNode key={c.id} node={c} depth={depth + 1} />)}
    </div>
  );
}

const KINDS: { key: string; label: string }[] = [
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "audio", label: "音频" },
  { key: "font", label: "字体" },
  { key: "document", label: "文档" },
];

const PRESET_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"];

export default function Sidebar({ immersive = false, collapsed = false }: { immersive?: boolean; collapsed?: boolean }) {
  const info = useStore((s) => s.info);
  const folders = useStore((s) => s.folders);
  const tags = useStore((s) => s.tags);
  const smartFolders = useStore((s) => s.smartFolders);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const resetFilters = useStore((s) => s.resetFilters);
  const refreshMeta = useStore((s) => s.refreshMeta);

  const [tagFilter, setTagFilter] = useState("");
  const tree = useMemo(() => buildTree(folders), [folders]);

  const toggleKind = (k: string) => {
    const kinds = filters.kinds.includes(k) ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k];
    setFilters({ kinds });
  };

  const saveSmart = async () => {
    const name = prompt("智能文件夹名称：");
    if (!name?.trim()) return;
    const q: Partial<Filters> = { ...filters };
    await api("/smart-folders", { method: "POST", body: JSON.stringify({ name: name.trim(), query: q }) });
    refreshMeta();
  };

  const newFolder = async () => {
    const name = prompt("文件夹名称：");
    if (!name?.trim()) return;
    await api("/folders", { method: "POST", body: JSON.stringify({ parentId: null, name: name.trim() }) });
    refreshMeta();
  };

  const deleteSmart = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("删除该智能文件夹？")) return;
    await api(`/smart-folders/${id}`, { method: "DELETE" });
    if (filters.smartId === id) setFilters({ smartId: null });
    else refreshMeta();
  };

  const filteredTags = tags.filter((t) => !tagFilter || t.name.toLowerCase().includes(tagFilter.toLowerCase()));

  return (
    <aside
      className={`flex flex-col overflow-y-auto overflow-x-hidden ${
        immersive ? "h-full pt-11 bg-panel/85 backdrop-blur-md border-r border-border/60" : "w-56 shrink-0 bg-panel border-r border-border"
      }`}
      style={{
        width: immersive ? (collapsed ? 48 : 224) : undefined,
        transition: immersive ? "width 340ms cubic-bezier(.22,1,.36,1)" : undefined,
        boxShadow: immersive ? "8px 0 24px rgba(0,0,0,.25)" : undefined,
      }}
    >
      {/* 库信息(沉浸态不显示,避免顶栏遮挡) */}
      {!immersive && (
        <div className="px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-lg shrink-0">🌸</span>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{info?.name ?? "Lilium"}</div>
              <div className="text-[10px] text-neutral-500">
                {info ? `${info.itemCount} 项 · ${humanSize(info.totalSize)}` : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 固定 224px 内层列:宽度过渡期间内容零重排,aside 只做裁剪 */}
      <div className="w-56 shrink-0">
        {/* 快速入口:始终可见,图标左对齐(收/展位置一致,不跳动) */}
        <div className="px-2 py-2 space-y-0.5 border-b border-border">
          <SideBtn collapsed={collapsed} active={!filters.folderId && !filters.trash && !filters.smartId && !filters.tag && !filters.unfiled && !filters.untagged} onClick={() => resetFilters()} icon={<Image size={16} />} label="全部图片" />
          <SideBtn collapsed={collapsed} active={filters.unfiled} onClick={() => setFilters({ unfiled: !filters.unfiled, folderId: null, trash: false, smartId: null })} icon={<Inbox size={16} />} label="未分类" />
          <SideBtn collapsed={collapsed} active={filters.untagged} onClick={() => setFilters({ untagged: !filters.untagged, folderId: null, trash: false, smartId: null })} icon={<Tags size={16} />} label="未加标签" />
          <SideBtn collapsed={collapsed} active={filters.trash} onClick={() => setFilters({ trash: !filters.trash, folderId: null, smartId: null })} icon={<Trash2 size={16} />} label="回收站" />
        </div>

        {/* 其余分区:收起时整体淡出(不卸载,不换 DOM),展开原位恢复 */}
        <div
          className={collapsed ? "opacity-0 pointer-events-none" : "opacity-100"}
          style={{ transition: "opacity 160ms ease" }}
        >
          {/* 文件夹 */}
          <Section title="文件夹" action={<button className="btn !p-1" onClick={newFolder} title="新建文件夹"><FolderPlus size={13} /></button>}>
            <div className="px-1">
              {tree.length === 0 && <div className="text-[11px] text-neutral-600 px-2 py-1 whitespace-nowrap overflow-hidden">右键/按钮新建文件夹</div>}
              {tree.map((n) => <FolderNode key={n.id} node={n} depth={0} />)}
            </div>
          </Section>

          {/* 智能文件夹 */}
      <Section title="智能文件夹" action={<button className="btn !p-1" onClick={saveSmart} title="将当前筛选保存为智能文件夹"><Bookmark size={13} /></button>}>
        <div className="px-1">
          {smartFolders.length === 0 && <div className="text-[11px] text-neutral-600 px-2 py-1 whitespace-nowrap overflow-hidden">保存当前筛选条件，快速复用</div>}
          {smartFolders.map((sf) => (
            <div
              key={sf.id}
              className={`group flex items-center gap-1.5 rounded-md px-2 py-[5px] cursor-pointer text-xs ${
                filters.smartId === sf.id ? "bg-violet-500/15 text-violet-300" : "hover:bg-white/5 text-neutral-300"
              }`}
              onClick={() => {
                useStore.setState({ filters: { ...useStore.getState().filters, ...(sf.query as Partial<Filters>), smartId: sf.id } });
                useStore.getState().fetchItems();
              }}
            >
              <Bookmark size={13} className="text-amber-400/80 shrink-0" />
              <span className="truncate flex-1">{sf.name}</span>
              <button className="hidden group-hover:block p-0.5 hover:bg-white/10 rounded" onClick={(e) => deleteSmart(e, sf.id)}><Trash2 size={11} /></button>
            </div>
          ))}
        </div>
      </Section>

          {/* 类型 */}
          <Section title="类型">
            <div className="px-2 flex flex-wrap gap-1">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                    filters.kinds.includes(k.key)
                      ? "bg-violet-500/20 border-violet-400/50 text-violet-200"
                      : "border-border text-neutral-400 hover:bg-white/5"
                  }`}
                  onClick={() => toggleKind(k.key)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </Section>

          {/* 评分 */}
          <Section title="评分">
            <div className="px-2 flex items-center gap-1">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  title={n === 0 ? "全部评分" : `${n} 星及以上`}
                  className={`px-1.5 py-0.5 rounded text-[11px] shrink-0 ${
                    filters.ratingMin === n ? "bg-violet-500/25 text-violet-200" : "text-neutral-500 hover:bg-white/5"
                  }`}
                  onClick={() => setFilters({ ratingMin: n })}
                >
                  {n === 0 ? "A" : `${n}★`}
                </button>
              ))}
              <Star size={11} className="text-amber-400/60 ml-0.5" />
            </div>
          </Section>

          {/* 颜色 */}
          <Section title="颜色" action={filters.color ? <button className="btn !p-1" onClick={() => setFilters({ color: null })}><X size={12} /></button> : undefined}>
            <div className="px-2 flex flex-wrap items-center gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${filters.color === c ? "border-white" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setFilters({ color: c, colorTolerance: 60 })}
                  title={c}
                />
              ))}
              <label className="w-5 h-5 rounded-full border border-dashed border-neutral-500 flex items-center justify-center cursor-pointer hover:border-violet-400" title="自定义颜色">
                <Palette size={10} className="text-neutral-400" />
                <input
                  type="color"
                  className="sr-only"
                  onChange={(e) => setFilters({ color: e.target.value, colorTolerance: 60 })}
                />
              </label>
            </div>
          </Section>

          {/* 标签 */}
          <Section title={`标签 (${tags.length})`}>
            <div className="px-2 pb-1">
              <input className="input w-full mb-1.5" placeholder="搜索标签…" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} />
            </div>
            <div className="px-1 flex flex-col">
              {filteredTags.slice(0, 60).map((t) => (
                <div
                  key={t.name}
                  className={`group flex items-center gap-2 rounded-md px-2 py-[4px] cursor-pointer text-xs ${
                    filters.tag === t.name ? "bg-violet-500/15 text-violet-300" : "hover:bg-white/5 text-neutral-300"
                  }`}
                  onClick={() => setFilters({ tag: filters.tag === t.name ? null : t.name })}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="truncate flex-1">{t.name}</span>
                  <span className="text-[10px] text-neutral-600">{t.count}</span>
                </div>
              ))}
              {filteredTags.length === 0 && <div className="text-[11px] text-neutral-600 px-2 py-1 whitespace-nowrap overflow-hidden">暂无标签</div>}
            </div>
          </Section>

          <div className="mt-auto px-3 py-2 text-[10px] text-neutral-600 border-t border-border whitespace-nowrap overflow-hidden">
            Lilium · 本地优先的图片管理
          </div>
        </div>
      </div>
    </aside>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="border-b border-border py-2">
      <div className="flex items-center justify-between px-3 mb-1">
        <button className="text-[10px] font-medium tracking-wider text-neutral-500 uppercase hover:text-neutral-300" onClick={() => setCollapsed(!collapsed)}>
          {title}
        </button>
        {action}
      </div>
      {!collapsed && children}
    </div>
  );
}

function SideBtn({ active, onClick, icon, label, collapsed = false }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; collapsed?: boolean }) {
  // 同一 DOM 两种状态:高度恒定 h-7(28px),行距 space-y-0.5 不变 → 收/展零位移;
  // 图标中心:展开 = px-2(8) + w-4/2(8),收起 = w-8 居中(16),在容器 px-2 下同为 cx=24。
  return (
    <button
      title={label}
      className={`flex items-center h-7 rounded-md text-xs transition-colors ${
        collapsed ? "w-8 justify-center" : "w-full gap-2 px-2"
      } ${active ? "bg-violet-500/15 text-violet-300" : "text-neutral-300 hover:bg-white/5"}`}
      onClick={onClick}
    >
      <span className="shrink-0 w-4 flex justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}
