import { useEffect, useRef, useState } from "react";
import {
  Check, FolderInput, FolderPlus, Library as LibraryIcon, RefreshCcw,
  Trash2, X, AlertTriangle,
} from "lucide-react";
import { api, type LibraryInfo } from "../api/client";
import { useStore } from "../store/useStore";

interface LibEntry {
  path: string;
  name: string;
  lastOpened: number;
  kind: string;
  exists: boolean;
  current: boolean;
}

/**
 * 资源库面板:侧栏库卡片点击弹出。
 * 库列表 / 打开其它 / 创建资源库 / 清除缓存并重新加载 / 移除记录
 * 切换 = POST /libraries/switch → 全量刷新前端状态
 */
export default function LibraryPanel({ onClose }: { onClose: () => void }) {
  const info = useStore((s) => s.info);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const [libs, setLibs] = useState<LibEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const reload = () => {
    api<{ current: LibraryInfo; libraries: LibEntry[] }>("/libraries")
      .then((d) => setLibs(d.libraries))
      .catch(() => {});
  };
  useEffect(reload, []);

  // 点外面关闭
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [onClose]);

  // 切换后全量重置前端状态
  const resetAfterSwitch = async () => {
    const st = useStore.getState();
    st.setFilters({ ...st.filters, folderId: null, tag: null, smartId: null, trash: false, q: "", unfiled: false, untagged: false, kinds: [] });
    useStore.setState({ detailId: null, lightboxId: null, selection: new Set(), similarIds: null });
    await Promise.all([refreshMeta(), st.fetchItems()]);
  };

  const switchTo = async (path: string) => {
    setBusy(path);
    try {
      await api("/libraries/switch", { method: "POST", body: JSON.stringify({ path }) });
      await resetAfterSwitch();
      onClose();
    } catch (e) {
      alert(`切换失败: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  const openOther = async () => {
    const path = prompt("输入资源库文件夹路径（支持 Lilium 库目录与 Eagle 资源库）:");
    if (!path?.trim()) return;
    await switchTo(path.trim());
  };

  const createLib = async () => {
    // 默认放在当前库同级目录
    const fallbackParent = info?.path ? info.path.replace(/[/\\][^/\\]+$/, "") : "";
    const parent = prompt("新库存放位置（父文件夹路径）:", fallbackParent);
    if (!parent?.trim()) return;
    const name = newName.trim();
    if (!name) return;
    setBusy("__create");
    try {
      await api("/libraries/create", { method: "POST", body: JSON.stringify({ parent: parent.trim(), name }) });
      await resetAfterSwitch();
      onClose();
    } catch (e) {
      alert(`创建失败: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(null);
    }
  };

  const clearCache = async () => {
    if (!confirm("清除当前库的全部缩略图缓存并重新生成？")) return;
    setBusy("__cache");
    try {
      await api("/libraries/clear-cache", { method: "POST" });
      await useStore.getState().fetchItems();
      alert("缓存已清除，缩略图将在后台重新生成");
    } finally {
      setBusy(null);
    }
  };

  const removeEntry = async (e: React.MouseEvent, lib: LibEntry) => {
    e.stopPropagation();
    if (!confirm(`从列表移除「${lib.name}」？（不删除文件）`)) return;
    await api("/libraries/remove", { method: "POST", body: JSON.stringify({ path: lib.path }) });
    reload();
  };

  return (
    <div
      ref={ref}
      className="absolute left-2 top-full mt-1.5 w-72 bg-panel2/98 backdrop-blur-lg border border-border rounded-xl shadow-2xl z-50 pop-in overflow-hidden"
    >
      {/* 库列表 */}
      <div className="max-h-64 overflow-y-auto py-1.5">
        {libs.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-neutral-500">暂无其它资源库记录</div>
        )}
        {libs.map((lib) => (
          <div
            key={lib.path}
            className={`group flex items-center gap-2.5 px-3 py-2 cursor-pointer text-xs ${
              lib.current ? "bg-violet-500/10" : "hover:bg-white/5"
            } ${lib.exists ? "" : "opacity-50"}`}
            onClick={() => !lib.current && lib.exists && switchTo(lib.path)}
            title={lib.path}
          >
            <LibraryIcon size={16} className={lib.current ? "text-violet-400 shrink-0" : "text-neutral-500 shrink-0"} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-neutral-200">{lib.name}</span>
                {!lib.exists && (
                  <span title="路径不存在" className="shrink-0 text-amber-500"><AlertTriangle size={11} /></span>
                )}
              </div>
              <div className="text-[10px] text-neutral-500 truncate">{lib.path}</div>
            </div>
            {lib.current ? (
              <Check size={14} className="text-violet-400 shrink-0" />
            ) : (
              <button
                className="hidden group-hover:block p-1 hover:bg-white/10 rounded text-neutral-500 hover:text-white shrink-0"
                title="从列表移除"
                onClick={(e) => removeEntry(e, lib)}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 操作区 */}
      <div className="border-t border-border py-1.5">
        <PanelBtn icon={<FolderPlus size={14} />} label="创建资源库…" onClick={() => setCreating(true)} />
        <PanelBtn icon={<FolderInput size={14} />} label="打开其它资源库…" onClick={openOther} />
        <PanelBtn
          icon={busy === "__cache" ? <RefreshCcw size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
          label="清除缓存并重新加载"
          onClick={clearCache}
          disabled={busy !== null}
        />
      </div>

      {/* 创建子表单 */}
      {creating && (
        <div className="border-t border-border px-3 py-2.5 space-y-2 bg-black/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-neutral-400">新资源库名称</span>
            <button className="text-neutral-500 hover:text-white" onClick={() => setCreating(false)}><X size={12} /></button>
          </div>
          <input
            autoFocus
            className="input w-full"
            placeholder="例如：二次元图库"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) createLib();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <div className="text-[10px] text-neutral-500">
            将在当前库同级目录创建 <span className="text-neutral-400">{newName.trim() || "库名"}.lilium</span>
          </div>
          <button className="btn-primary w-full justify-center" disabled={!newName.trim() || busy !== null} onClick={createLib}>
            {busy === "__create" ? "创建中…" : "创建并切换"}
          </button>
        </div>
      )}
    </div>
  );
}

function PanelBtn({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 hover:text-white disabled:opacity-40 disabled:pointer-events-none"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="text-neutral-500">{icon}</span>
      {label}
    </button>
  );
}
