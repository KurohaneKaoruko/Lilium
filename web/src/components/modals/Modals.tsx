import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Ellipsis, Eye, PanelRightOpen, Tags, Star, Trash2, RotateCcw, Search, Wand2, HardDrive, Keyboard, Settings as SettingsIcon, Pencil, Link2, FolderOpen, Plus, Save, X } from "lucide-react";
import { useStore } from "../../store/useStore";
import { api, humanSize } from "../../api/client";
import { notify, reportError } from "../../lib/feedback";
import { formatCount, shortcutMod } from "../../lib/workspace";
import { Thumb } from "../views/shared";
import { Modal } from "../ui/Dialog";
import NameDialog from "../ui/NameDialog";
import Popover from "../ui/Popover";

/** 批量操作栏（选中后底部浮现） */
export function SelectionBar() {
  const selection = useStore((s) => s.selection);
  const selectionMode = useStore((s) => s.selectionMode);
  const loading = useStore((s) => s.loading);
  const items = useStore((s) => s.items);
  const trash = useStore((s) => s.filters.trash);
  const folders = useStore((s) => s.folders);
  const [menu, setMenu] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const ids = [...selection];
  const selectedSize = useMemo(() => selection.size ? items.reduce((sum, item) => selection.has(item.id) ? sum + item.size : sum, 0) : 0, [items, selection]);
  if ((!selection.size && !selectionMode) || loading) return null;
  const closeMenu = () => { anchor.current?.focus(); setMenu(false); };

  const act = async (action: string, fields: Record<string, unknown> = {}) => {
    await api("/batch", { method: "POST", body: JSON.stringify({ ids, action, ...fields }) });
    const st = useStore.getState();
    st.clearSelection();
    await Promise.all([st.fetchItems(), st.refreshMeta()]);
    const message: Record<string, string> = { trash: "已移到回收站", restore: "已恢复素材", purge: "已彻底删除", move: "已移动素材", tag: "已添加标签", rating: "已更新评分" };
    notify(`${message[action]} · ${formatCount(ids.length)} 项`);
  };
  const run = async (action: string, fields: Record<string, unknown> = {}) => {
    if (busy) return;
    closeMenu();
    setBusy(true);
    try { await act(action, fields); }
    catch (error) { reportError("批量操作失败", error); }
    finally { setBusy(false); }
  };

  return (
    <div className="selection-dock" role="group" aria-label="已选素材的操作">
      <span className="selection-summary" aria-live="polite">
        <strong className="selection-count">{ids.length ? `已选 ${formatCount(ids.length)} 项` : "多选模式"}</strong>
        {ids.length ? <small className="selection-size" title="所选素材总大小">{humanSize(selectedSize)}</small>
          : <small>点按素材以选择</small>}
      </span>
      {ids.length === 0 && <button className="btn-secondary select-loaded" onClick={() => useStore.getState().selectAll()} aria-label="全选已载入的素材">全选已载入</button>}
      {ids.length === 1 && <>
        <button className="btn selection-preview" aria-label="预览所选素材" title="预览所选素材" onClick={() => useStore.getState().setLightbox(ids[0])}><Eye size={16} /><span>预览</span></button>
        <button className="btn" aria-label="查看详情" title="查看详情" onClick={() => useStore.getState().setDetail(ids[0])}><PanelRightOpen size={16} /><span>详情</span></button>
      </>}
      {ids.length > 0 && (trash ? <button className="btn" disabled={busy} aria-label="还原所选素材" title="还原所选素材" onClick={() => void run("restore")}><RotateCcw size={16} /><span>还原</span></button>
        : <button className="btn is-danger" disabled={busy} aria-label="将所选素材移到回收站" title="移到回收站" onClick={() => void run("trash")}><Trash2 size={16} /><span>回收站</span></button>)}
      {ids.length > 0 && <button ref={anchor} className="icon-button" type="button" aria-label="更多素材操作" title="更多素材操作" aria-haspopup="dialog" aria-expanded={menu}
        onClick={() => { setDestination(""); setMenu(!menu); }}><Ellipsis size={18} /></button>}
      {menu && ids.length > 0 && <Popover anchor={anchor} label="更多素材操作" onClose={() => setMenu(false)} className="action-menu">
        <button className="menu-row" onClick={() => { closeMenu(); useStore.getState().selectAll(); }}>全选已载入的素材</button>
        {trash ? <button className="menu-row is-danger" disabled={busy} onClick={() => {
          if (confirm(`彻底删除 ${formatCount(ids.length)} 项素材？此操作无法撤销。`)) void run("purge");
        }}><Trash2 size={16} />彻底删除</button> : <>
          <button className="menu-row" onClick={() => { closeMenu(); setTagging(true); }}><Tags size={16} />添加标签…</button>
          {ids.length > 1 && <button className="menu-row" onClick={() => {
            closeMenu(); window.dispatchEvent(new CustomEvent("lilium:batch-rename", { detail: { ids } }));
          }}><Pencil size={16} />批量重命名…</button>}
          <div className="menu-divider" />
          <div className="p-2 space-y-2">
            <label className="field-label"><span className="flex items-center gap-1.5"><Star size={14} />批量评分</span>
              <select className="input" value="" onChange={(event) => void run("rating", { rating: Number(event.target.value) })}>
                <option value="" disabled>选择评分</option>
                {[0, 1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating ? `${rating} 星` : "清除评分"}</option>)}
              </select>
            </label>
            <label className="field-label">移动到
              <select className="input" value={destination} onChange={(event) => setDestination(event.target.value)}>
                <option value="">未分类</option>{folders.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <button className="btn-secondary w-full" disabled={busy} onClick={() => void run("move", { folderId: destination })}>移动素材</button>
          </div>
        </>}
      </Popover>}
      <button className="icon-button" onClick={() => {
        setMenu(false);
        const store = useStore.getState();
        if (ids.length) store.clearSelection(); else store.setSelectionMode(false);
      }} aria-label={ids.length ? "取消选择" : "退出多选"} title={ids.length ? "取消选择" : "退出多选"}><X size={17} /></button>
      {tagging && <NameDialog title="添加标签" onSave={(tag) => act("tag", { tag })} onClose={() => setTagging(false)} />}
    </div>
  );
}

/** 查重弹窗 */
export function DuplicatesModal({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<{ reason: string; items: { id: string; name: string; size: number }[] }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ groups: NonNullable<typeof groups> }>("/duplicates").then((d) => setGroups(d.groups)).catch((error: Error) => setError(error.message));
  }, []);
  return (
    <Modal title="重复文件查找" onClose={onClose} icon={<Wand2 size={14} />}>
      {error ? <p className="inline-error" role="alert">无法查找重复文件：{error}</p> : !groups ? (
        <div className="text-xs text-muted p-4" role="status">正在分析重复素材…</div>
      ) : groups.length === 0 ? (
        <div className="text-sm text-muted p-4">未发现重复文件。</div>
      ) : (
        <div className="space-y-4">
          {groups.map((g, gi) => (
            <div key={gi}>
              <div className="text-[11px] text-neutral-500 mb-1.5">{g.reason}</div>
              <div className="flex flex-wrap gap-2">
                {g.items.map((it) => (
                  <div key={it.id} className="w-24">
                    <Thumb id={it.id} kind="image" className="w-24 h-24 rounded" />
                    <div className="text-[10px] text-neutral-500 truncate mt-0.5">{it.name}</div>
                    <div className="text-[10px] text-neutral-600">{humanSize(it.size)}</div>
                  </div>
                ))}
              </div>
            </div>
           ))}
        </div>
      )}
    </Modal>
  );
}


/** 导入路径弹窗（URL / 磁盘路径 / 库迁移）——代替早期的 prompt() */
export function ImportPathModal({
  mode,
  onClose,
}: {
  mode: "url" | "disk" | "library";
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const inputId = useId();
  const refreshMeta = useStore((s) => s.refreshMeta);
  const fetchItems = useStore((s) => s.fetchItems);
  const folderId = useStore((s) => s.filters.folderId);

  const meta = {
    url: {
      title: "URL 导入",
      icon: <Link2 size={14} />,
      placeholder: "https://example.com/image.png",
      hint: "粘贴图片直链或网页 URL，服务端会抓取后入库。",
      inputLabel: "URL",
    },
    disk: {
      title: "磁盘导入",
      icon: <HardDrive size={14} />,
      placeholder: "/home/user/Pictures/photos 或 /a.png, /b/c.zip",
      hint: "导入发生在服务端进程内：浏览器安全限制不允许直接读取本机目录，因此需要填写服务器（或桌面版本机）可以访问的绝对路径，可逗号分隔多个。",
      inputLabel: "路径（可逗号分隔）",
    },
    library: {
      title: "库迁移导入",
      icon: <FolderOpen size={14} />,
      placeholder: "/home/user/Pictures/Design.library",
      hint: "把现有图片管理软件的库目录迁移进来：完整保留文件夹树、标签（含颜色）、评分、注释、调色板等；同样需要服务器本机可见的绝对路径，可重复执行以增量导入。",
      inputLabel: "库目录路径",
    },
  }[mode];

  const submit = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    setResult(null);
    try {
      if (mode === "url") {
        await api("/import/url", { method: "POST", body: JSON.stringify({ url: v, folderId }) });
        setResult({ ok: true, text: "导入完成" });
      } else if (mode === "disk") {
        const paths = v.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
        const r = await api<{ imported: number; errors: string[] }>("/import/paths", {
          method: "POST",
          body: JSON.stringify({ paths, folderId }),
        });
        setResult({ ok: true, text: `导入 ${r.imported} 项${r.errors?.length ? `（${r.errors.length} 项失败：${r.errors.slice(0, 3).join("；")}${r.errors.length > 3 ? "…" : ""}）` : ""}` });
      } else {
        const r = await api<{ report: { folders: number; items: number; tags: number; skipped: number } }>(
          "/import/eagle",
          { method: "POST", body: JSON.stringify({ path: v }) },
        );
        setResult({
          ok: true,
          text: `迁移完成：文件夹 ${r.report.folders} · 条目 ${r.report.items} · 标签 ${r.report.tags}${r.report.skipped ? ` · 跳过 ${r.report.skipped}` : ""}`,
        });
      }
      refreshMeta();
      fetchItems();
    } catch (e) {
      setResult({ ok: false, text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={meta.title} onClose={() => { if (!busy) onClose(); }} icon={meta.icon}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="text-xs text-muted bg-panel2 border border-border rounded-lg p-3 leading-relaxed">
          {meta.hint}
        </div>
        <label className="field-label" htmlFor={inputId}>{meta.inputLabel}
          <input id={inputId} data-dialog-focus className="input w-full" placeholder={meta.placeholder} value={text}
            onChange={(e) => setText(e.target.value)} disabled={busy} />
        </label>
        {result && (
          <div role={result.ok ? "status" : "alert"} className={`text-xs px-3 py-2 rounded-lg border break-words ${result.ok ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : "text-red-300 border-red-500/30 bg-red-500/10"}`}>
            {result.ok ? "✓ " : "✗ "}{result.text}
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>{result?.ok ? "关闭" : "取消"}</button>
          <button className="btn-primary" disabled={busy || !text.trim()}>
            {busy ? "导入中…" : <><Save size={13} /> 导入</>}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 快捷键说明 */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    [`${shortcutMod} + F`, "聚焦素材搜索框"],
    [`${shortcutMod} + K`, "打开命令面板"],
    [`${shortcutMod} + A`, "全选已载入的素材"],
    ["1 / 2 / 3 / 4 / 5", "切换 瀑布流 / 网格 / 列表 / 无限视图 / 分类墙"],
    ["← / →", "在预览中切换素材"],
    ["Enter", "打开大图预览"],
    ["Esc", "关闭弹层、详情或取消选择"],
    ["0–5", "灯箱中快速评分"],
    ["Delete", "删除选中项"],
    [`${shortcutMod} + 滚轮`, "在画布中以光标为中心缩放"],
    ["Shift + 拖动", "在无限画布中框选素材"],
  ];
  return (
    <Modal title="快捷键" onClose={onClose} icon={<Keyboard size={14} />}>
      <div className="shortcut-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <kbd>{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** 设置 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const info = useStore((s) => s.info);
  const [settings, setSettings] = useState<{ watchFolders: string[]; autoImport: boolean } | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const showError = (error: unknown) => setError(error instanceof Error ? error.message : String(error));

  useEffect(() => {
    api<NonNullable<typeof settings>>("/settings").then(setSettings).catch(showError);
  }, []);

  const update = async (key: "watchFolders" | "autoImport", value: string[] | boolean) => {
    if (!settings || busy) return false;
    setBusy(true); setError(""); setResult("");
    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify({ key, value }) });
      setSettings({ ...settings, [key]: value });
      setResult("设置已保存");
      return true;
    } catch (error) { showError(error); return false; }
    finally { setBusy(false); }
  };
  const scan = async () => {
    setBusy(true); setError(""); setResult("");
    try {
      const result = await api<{ imported: number }>("/watch-scan", { method: "POST" });
      setResult(`已导入 ${formatCount(result.imported)} 个新文件`);
      const st = useStore.getState();
      await Promise.all([st.refreshMeta(), st.fetchItems()]);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  const watched = settings?.watchFolders ?? [];

  return (
    <Modal title="设置" onClose={onClose} icon={<SettingsIcon size={14} />}>
      <div className="space-y-4">
        <label className="field-label"><span className="flex items-center gap-1.5"><HardDrive size={15} /> 当前资源库位置</span>
          <input className="input w-full" readOnly value={info?.path ?? ""} />
        </label>
        {!settings && !error && <p className="text-muted text-xs" role="status">正在读取设置…</p>}
        {settings && <section className="settings-watch">
          <h3>观察文件夹</h3><p>开启自动导入后，每 30 秒检查一次这些目录。</p>
          {watched.length ? <ul>{watched.map((folder) => <li key={folder}>
            <FolderOpen size={16} /><span className="truncate" title={folder}>{folder}</span>
            <button type="button" className="icon-button is-danger" disabled={busy} title="停止观察" aria-label={`停止观察 ${folder}`}
              onClick={() => void update("watchFolders", watched.filter((item) => item !== folder))}><Trash2 size={15} /></button>
          </li>)}</ul> : <p className="settings-empty">还没有观察文件夹</p>}
          <form className="settings-add" onSubmit={async (event) => {
            event.preventDefault();
            if (path.trim() && !watched.includes(path.trim()) && await update("watchFolders", [...watched, path.trim()])) setPath("");
          }}>
            <input className="input" value={path} onChange={(event) => setPath(event.target.value)} placeholder="目录绝对路径" aria-label="要观察的目录" />
            <button className="btn-secondary" disabled={busy || !path.trim() || watched.includes(path.trim())}><Plus size={15} /> 添加</button>
          </form>
          <div className="settings-toggle-row">
            <label><input type="checkbox" role="switch" checked={settings.autoImport} disabled={busy} onChange={(event) => void update("autoImport", event.target.checked)} />自动导入新文件</label>
            <button className="btn-secondary" disabled={busy || !watched.length || !settings.autoImport} onClick={() => void scan()}><Search size={15} />立即扫描</button>
          </div>
        </section>}
        {error && <p className="inline-error" role="alert">无法完成操作：{error}</p>}
        {result && <p className="text-emerald-300 text-xs" role="status">{result}</p>}
      </div>
    </Modal>
  );
}

/** 批量重命名（支持实时预览） */
const RENAME_TOKENS = ["{name}", "{index}", "{date}", "{ext}", "{w}", "{h}"];

export function BatchRenameModal({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [pattern, setPattern] = useState("{name}_{index}");
  const items = useStore((s) => s.items);
  const fetchItems = useStore((s) => s.fetchItems);
  const [renaming, setRenaming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const sel = items.filter((i) => ids.includes(i.id));
  const preview = (it: (typeof sel)[number] | undefined, idx: number) => {
    if (!it) return "";
    const stem = it.name.replace(/\.[^.]*$/, "");
    const d = new Date(it.addedAt);
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return pattern
      .replace(/\{name\}/g, () => stem)
      .replace(/\{index\}/g, String(idx + 1).padStart(3, "0"))
      .replace(/\{date\}/g, date)
      .replace(/\{ext\}/g, it.ext)
      .replace(/\{w\}/g, String(it.width ?? 0))
      .replace(/\{h\}/g, String(it.height ?? 0));
  };

  const apply = async () => {
    setRenaming(true);
    setResult(null);
    try {
      const r = await api<{ renamed: [string, string][] }>("/batch-rename", {
        method: "POST",
        body: JSON.stringify({ ids, pattern }),
      });
      setResult({ ok: true, text: `已重命名 ${r.renamed.length} 项` });
      await fetchItems();
    } catch (e) {
      setResult({ ok: false, text: `重命名失败：${(e as Error).message}` });
    } finally {
      setRenaming(false);
    }
  };

  return (
    <Modal title={`批量重命名（${ids.length} 项）`} onClose={() => { if (!renaming) onClose(); }} icon={<Pencil size={14} />}>
      <div className="space-y-3 text-xs">
        <div>
          <div className="text-[11px] text-neutral-500 mb-1.5">模式（可用占位符）</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {RENAME_TOKENS.map((t) => (
              <button key={t} className="px-1.5 py-0.5 rounded bg-panel2 border border-border text-[11px] text-neutral-300 hover:border-violet-400" onClick={() => setPattern((p) => p + t)}>
                {t}
              </button>
            ))}
          </div>
          <input className="input w-full" aria-label="批量重命名模式" value={pattern} onChange={(e) => setPattern(e.target.value)} data-dialog-focus />
        </div>

        <div>
          <div className="text-[11px] text-neutral-500 mb-1.5">预览（前 5 项）</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {sel.slice(0, 5).map((it) => (
              <div key={it.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-neutral-500 truncate max-w-[45%]">{it.name}</span>
                <span className="text-neutral-600">→</span>
                <span className="text-violet-300 truncate">{preview(it, ids.indexOf(it.id))}.{it.ext}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {result?.ok ? <button className="btn-primary" onClick={onClose}>完成</button>
            : <button className="btn-primary" disabled={renaming || !pattern.trim()} onClick={apply}>{renaming ? "重命名中…" : "应用"}</button>}
          {result && <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-danger"}`} role={result.ok ? "status" : "alert"}>{result.text}</span>}
        </div>
      </div>
    </Modal>
  );
}
