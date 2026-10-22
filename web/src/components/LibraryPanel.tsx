import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Check, FolderInput, FolderPlus, Library as LibraryIcon,
  RefreshCcw, Trash2, X,
} from "lucide-react";
import { api } from "../api/client";
import { useStore } from "../store/useStore";
import humanSize from "../lib/human";

interface LibEntry {
  path: string;
  name: string;
  lastOpened: number;
  kind: string;
  exists: boolean;
  current: boolean;
}

/**
 * 资源库面板:侧栏库卡片点击弹出(portal 到 body,免被侧栏 overflow 裁剪)。
 * 当前库信息卡 / 最近库列表 / 创建 / 打开其它 / 清除缓存重载
 */
export default function LibraryPanel({
  anchorRef,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const info = useStore((s) => s.info);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const [libs, setLibs] = useState<LibEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 定位:锚定按钮正下方,右边缘防溢出;paint 前算好避免闪跳
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 308)),
      top: Math.min(r.bottom + 8, window.innerHeight - 80),
    });
  }, [anchorRef]);

  const reload = () => {
    api<{ libraries: LibEntry[] }>("/libraries")
      .then((d) => setLibs(d.libraries))
      .catch(() => {});
  };
  useEffect(() => {
    reload();
  }, []);

  // 点外面 / 按 Esc 关闭
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(t) && !anchorRef.current?.contains(t)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
    };
  }, [onClose, anchorRef]);

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

  const current = libs.find((l) => l.current);
  const others = libs.filter((l) => !l.current);

  return createPortal(
    <div
      ref={rootRef}
      className="fixed z-[70] w-[300px] rounded-2xl bg-[#252932]/[.97] backdrop-blur-xl border border-white/10 shadow-[0_18px_56px_rgba(0,0,0,.55)] overflow-hidden pop-in"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }}
    >
      {/* 标题行 */}
      <div className="flex items-center justify-between pl-4 pr-2.5 pt-2.5 pb-1.5">
        <span className="text-[11px] font-semibold text-neutral-400 tracking-widest">资源库</span>
        <button className="p-1 rounded-md text-neutral-500 hover:text-white hover:bg-white/10 transition-colors" onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      <div className="px-2 pb-1">
        {/* 当前库信息卡 */}
        {current && (
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-violet-500/[.13] border border-violet-400/20 mb-1">
            <div className="w-8.5 h-8.5 w-9 h-9 rounded-lg bg-violet-500/25 flex items-center justify-center shrink-0">
              <LibraryIcon size={15} className="text-violet-200" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-neutral-100 truncate">{current.name}</span>
                <span className="text-[9px] leading-none px-1.5 py-[3px] rounded-full bg-violet-400/25 text-violet-200 shrink-0">当前</span>
              </div>
              <div className="text-[10px] text-neutral-400 truncate mt-0.5">
                {info ? `${info.itemCount} 项 · ${humanSize(info.totalSize)}` : current.path}
              </div>
            </div>
            <Check size={15} className="text-violet-300 shrink-0" />
          </div>
        )}

        {/* 其它库列表 */}
        <div className={`space-y-0.5 max-h-56 overflow-y-auto ${busy && busy !== "__cache" && busy !== "__create" ? "opacity-60 pointer-events-none" : ""}`}>
          {others.map((lib) => (
            <div
              key={lib.path}
              className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl cursor-pointer transition-colors ${
                lib.exists ? "hover:bg-white/[.055]" : "opacity-45 hover:bg-white/[.03]"
              }`}
              onClick={() => lib.exists && switchTo(lib.path)}
              title={lib.path}
            >
              <div className="w-8 h-8 rounded-lg bg-white/[.06] flex items-center justify-center shrink-0 group-hover:bg-white/[.09] transition-colors">
                {lib.kind === "eagle" ? (
                  <span className="text-[10px] font-bold text-amber-400">E</span>
                ) : (
                  <LibraryIcon size={13} className="text-neutral-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-neutral-300 group-hover:text-neutral-100 truncate transition-colors">{lib.name}</span>
                  {lib.kind === "eagle" && (
                    <span className="text-[9px] leading-none px-1 py-[2px] rounded bg-amber-500/15 text-amber-400 shrink-0">Eagle</span>
                  )}
                  {!lib.exists && (
                    <span className="text-amber-500 shrink-0" title="路径不存在">
                      <AlertTriangle size={10} />
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500 truncate mt-px">{lib.path}</div>
              </div>
              {busy === lib.path ? (
                <RefreshCcw size={13} className="text-violet-300 animate-spin shrink-0" />
              ) : (
                <button
                  className="hidden group-hover:block p-1 rounded-md hover:bg-white/10 text-neutral-500 hover:text-white shrink-0 transition-colors"
                  title="从列表移除"
                  onClick={(e) => removeEntry(e, lib)}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}

          {/* 空状态 */}
          {others.length === 0 && (
            <div className="mx-0.5 mb-0.5 rounded-xl border border-dashed border-white/[.09] px-3 py-3.5 text-center">
              <FolderInput size={16} className="mx-auto text-neutral-600 mb-1.5" />
              <div className="text-[11px] text-neutral-500">暂无其它资源库</div>
              <div className="text-[10px] text-neutral-600 mt-0.5">打开或创建后,可在此快速切换</div>
            </div>
          )}
        </div>
      </div>

      {/* 操作区 / 创建表单 */}
      {creating ? (
        <div className="border-t border-white/[.07] p-2.5 space-y-2 bg-black/25">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-neutral-300">创建资源库</span>
            <button className="p-0.5 text-neutral-500 hover:text-white" onClick={() => setCreating(false)}><X size={12} /></button>
          </div>
          <input
            autoFocus
            className="input w-full !py-1.5 text-xs"
            placeholder="资源库名称,例如:二次元图库"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) createLib();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <div className="text-[10px] text-neutral-500">
            将在当前库同级目录创建 <span className="text-neutral-300 font-mono">{newName.trim() || "库名"}.lilium</span>
          </div>
          <div className="flex gap-1.5">
            <button className="btn flex-1 justify-center !py-1.5" onClick={() => setCreating(false)}>取消</button>
            <button className="btn-primary flex-1 justify-center !py-1.5" disabled={!newName.trim() || busy !== null} onClick={createLib}>
              {busy === "__create" ? "创建中…" : "创建并切换"}
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-white/[.07] p-1.5 space-y-0.5">
          <Act
            icon={<FolderPlus size={13} />}
            label="创建资源库…"
            onClick={() => setCreating(true)}
            disabled={busy !== null}
          />
          <Act
            icon={<FolderInput size={13} />}
            label="打开其它资源库…"
            onClick={openOther}
            disabled={busy !== null}
          />
          <Act
            icon={<RefreshCcw size={13} className={busy === "__cache" ? "animate-spin" : ""} />}
            label={busy === "__cache" ? "清除中…" : "清除缓存并重新加载"}
            onClick={clearCache}
            disabled={busy !== null}
          />
        </div>
      )}
    </div>,
    document.body,
  );
}

/** 操作行:图标小方块 + 文字 */
function Act({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left transition-colors hover:bg-white/[.055] disabled:opacity-40 disabled:pointer-events-none"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="w-7 h-7 rounded-lg bg-white/[.06] group-hover:bg-white/[.1] flex items-center justify-center text-neutral-400 group-hover:text-neutral-100 transition-colors shrink-0">
        {icon}
      </span>
      <span className="text-xs text-neutral-300 group-hover:text-white transition-colors">{label}</span>
    </button>
  );
}
