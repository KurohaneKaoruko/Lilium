import { useEffect, useRef, useState, type RefObject } from "react";
import { AlertTriangle, Check, FolderInput, FolderPlus, Layers2, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { api, humanSize } from "../api/client";
import { notify } from "../lib/feedback";
import { formatCount } from "../lib/workspace";
import { useStore } from "../store/useStore";
import Popover from "./ui/Popover";

interface LibEntry { path: string; name: string; kind: string; exists: boolean; current: boolean }

export default function LibraryPanel({ anchorRef, onClose }: { anchorRef: RefObject<HTMLButtonElement>; onClose: () => void }) {
  const info = useStore((s) => s.info);
  const importing = useStore((s) => s.importing);
  const [libs, setLibs] = useState<LibEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"open" | "create" | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const pathRef = useRef<HTMLInputElement>(null);

  const reload = () => api<{ libraries: LibEntry[] }>("/libraries").then((data) => setLibs(data.libraries));
  const setFailure = (error: unknown) => setError(error instanceof Error ? error.message : String(error));
  useEffect(() => { reload().catch(setFailure); }, []);
  useEffect(() => { if (mode) pathRef.current?.focus(); }, [mode]);

  const close = () => { anchorRef.current?.focus(); onClose(); };
  const act = async (key: string, run: () => Promise<unknown>, switching = false) => {
    if (busy || importing) return;
    setError("");
    setBusy(key);
    try {
      await run();
      if (switching) {
        await useStore.getState().resetLibrary();
        close();
        notify("已切换资源库");
      }
    } catch (error) { setFailure(error); }
    finally { setBusy(null); }
  };
  const switchTo = (path: string) => act(path, () => api("/libraries/switch", { method: "POST", body: JSON.stringify({ path }) }), true);
  const create = () => act("create", () => api("/libraries/create", { method: "POST", body: JSON.stringify({ parent: path.trim(), name: name.trim() }) }), true);
  const openForm = (next: "open" | "create") => {
    setError("");
    setPath(next === "create" ? info?.path.replace(/[/\\][^/\\]+$/, "") ?? "" : "");
    setMode(next);
  };
  const current = libs?.find((entry) => entry.current);
  const other = libs?.filter((entry) => !entry.current);
  const disabled = Boolean(busy) || importing;

  return <Popover anchor={anchorRef} align="start" className="library-panel" label="资源库管理" onClose={onClose}>
    <header className="popover-heading"><div><h2>资源库</h2><p>打开、创建或切换你的素材库</p></div>
      <button className="icon-button" type="button" aria-label="关闭资源库面板" onClick={close}><X size={17} /></button></header>
    {(current || info) && <div className="library-current">
      <span className="library-mark"><Layers2 size={18} /></span><div className="min-w-0 flex-1">
        <strong className="block truncate" title={current?.path ?? info?.path}>{current?.name ?? info?.name}</strong>
        <small className="block truncate">{info ? `${formatCount(info.itemCount)} 项 · ${humanSize(info.totalSize)}` : current?.path}</small>
      </div><Check size={17} className="text-accent shrink-0" aria-label="当前资源库" />
    </div>}
    {!libs && !error && <p className="panel-note"><LoaderCircle size={15} className="animate-spin" /> 正在读取资源库</p>}
    {other?.length ? <div className="library-list">
      <p className="menu-caption">最近使用</p>
      {other.map((entry) => <div key={entry.path} className="library-list-row">
        <button type="button" className="menu-row min-w-0" disabled={disabled || !entry.exists} onClick={() => void switchTo(entry.path)} title={entry.path}>
          {!entry.exists ? <AlertTriangle size={16} /> : busy === entry.path ? <LoaderCircle size={16} className="animate-spin" /> : <Layers2 size={16} />}
          <span className="min-w-0"><strong className="block truncate font-medium">{entry.name}</strong><small className="block truncate text-muted">{entry.path}</small></span>
        </button>
        <button className="icon-button" type="button" title="从最近列表移除" aria-label={`从最近列表移除 ${entry.name}`} disabled={disabled}
          onClick={() => { if (confirm(`从最近列表移除「${entry.name}」？不会删除本地文件。`)) void act("remove", async () => {
            await api("/libraries/remove", { method: "POST", body: JSON.stringify({ path: entry.path }) }); await reload();
          }); }}><Trash2 size={15} /></button>
      </div>)}
    </div> : null}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {mode ? <form className="library-form" onSubmit={(event) => {
      event.preventDefault();
      if (!path.trim() || (mode === "create" && !name.trim())) return;
      if (mode === "create") void create(); else void switchTo(path.trim());
    }}>
      <label className="field-label">{mode === "create" ? "存放位置（父文件夹）" : "资源库路径"}
        <input className="input w-full" ref={pathRef} value={path} onChange={(e) => setPath(e.target.value)} placeholder="服务端可访问的绝对路径" required /></label>
      {mode === "create" && <label className="field-label">库名称<input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} required /></label>}
      <div className="dialog-actions"><button className="btn" type="button" disabled={disabled} onClick={() => setMode(null)}>取消</button>
        <button className="btn-primary" disabled={disabled || !path.trim() || (mode === "create" && !name.trim())}>{busy ? "处理中…" : mode === "create" ? "创建并切换" : "打开资源库"}</button></div>
    </form> : <div className="library-actions">
      <button className="menu-row" disabled={disabled} onClick={() => openForm("create")}><FolderPlus size={16} />创建资源库…</button>
      <button className="menu-row" disabled={disabled} onClick={() => openForm("open")}><FolderInput size={16} />打开其他资源库…</button>
      <button className="menu-row" disabled={disabled} onClick={() => {
        if (confirm("清除当前库的缩略图缓存？原始素材不受影响。")) void act("cache", async () => {
          await api("/libraries/clear-cache", { method: "POST" });
          await useStore.getState().fetchItems();
          notify("缩略图缓存已清除，正在后台重新生成");
        });
      }}><RefreshCw size={16} className={busy === "cache" ? "animate-spin" : ""} />重建缩略图缓存</button>
    </div>}
  </Popover>;
}
