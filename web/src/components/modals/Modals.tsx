import { useEffect, useState } from "react";
import { Tags, Star, Trash2, RotateCcw, Search, Wand2, HardDrive, Keyboard, Settings as SettingsIcon, Pencil, Link2, FolderOpen, Save } from "lucide-react";
import { useStore } from "../../store/useStore";
import { api, humanSize } from "../../api/client";
import { Thumb } from "../views/shared";

/** 批量操作栏（选中后底部浮现） */
export function SelectionBar() {
  const selection = useStore((s) => s.selection);
  const clearSelection = useStore((s) => s.clearSelection);
  const fetchItems = useStore((s) => s.fetchItems);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const trash = useStore((s) => s.filters.trash);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(selection.size > 0);
  }, [selection]);

  if (!visible) return null;
  const ids = [...selection];

  const act = async (body: Record<string, unknown>) => {
    await api("/batch", { method: "POST", body: JSON.stringify({ ids, ...body }) });
    clearSelection();
    fetchItems();
    refreshMeta();
  };

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-panel2/95 border border-border rounded-full shadow-2xl px-3 py-1.5 flex items-center gap-1 pop-in backdrop-blur">
      <span className="text-xs text-violet-300 px-2">{ids.length} 项已选</span>
      <div className="w-px h-4 bg-border mx-1" />
      <button className="btn" onClick={() => { const t = prompt("标签名："); if (t?.trim()) act({ action: "tag", tag: t.trim() }); }}><Tags size={13} /> 标签</button>
      <button className="btn" onClick={() => act({ action: "rating", rating: 5 })}><Star size={13} /> 5★</button>
      <button className="btn" onClick={() => act({ action: "rating", rating: 0 })}><Star size={13} /> 清除</button>
      {trash ? (
        <>
          <button className="btn" onClick={() => act({ action: "restore" })}><RotateCcw size={13} /> 还原</button>
          <button className="btn !text-red-400" onClick={() => { if (confirm(`彻底删除 ${ids.length} 项？`)) act({ action: "purge" }); }}><Trash2 size={13} /> 彻底删除</button>
        </>
      ) : (
        <button className="btn !text-red-400" onClick={() => act({ action: "trash" })}><Trash2 size={13} /> 删除</button>
      )}
      <div className="w-px h-4 bg-border mx-1" />
      <button className="btn" onClick={clearSelection}>取消</button>
    </div>
  );
}

/** 查重弹窗 */
export function DuplicatesModal({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<{ reason: string; items: { id: string; name: string; size: number }[] }[] | null>(null);
  useEffect(() => {
    api<{ groups: { reason: string; items: { id: string; name: string; size: number }[] }[] }>("/duplicates").then((d) => setGroups(d.groups));
  }, []);
  return (
    <Modal title="重复文件查找" onClose={onClose} icon={<Wand2 size={14} />}>
      {!groups ? (
        <div className="text-xs text-neutral-500 p-4">分析中…</div>
      ) : groups.length === 0 ? (
        <div className="text-xs text-neutral-500 p-4">未发现重复文件 🎉</div>
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
          ))}          <p className="text-[11px] text-neutral-600">提示：在重复项上右键 → 删除，可清理多余副本。</p>
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
    <Modal title={meta.title} onClose={onClose} icon={meta.icon}>
      <div className="p-4 space-y-3">
        <div className="text-[11px] text-neutral-400 bg-black/30 border border-border rounded-lg p-3 leading-relaxed">
          {meta.hint}
        </div>
        <label className="block text-[11px] text-neutral-500">{meta.inputLabel}</label>
        <input
          autoFocus
          className="input w-full font-mono text-xs"
          placeholder={meta.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {result && (
          <div className={`text-xs px-3 py-2 rounded-lg border ${result.ok ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : "text-red-300 border-red-500/30 bg-red-500/10"}`}>
            {result.ok ? "✓ " : "✗ "}{result.text}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn" onClick={onClose}>{result?.ok ? "关闭" : "取消"}</button>
          <button className="btn-primary" disabled={busy || !text.trim()} onClick={submit}>
            {busy ? "导入中…" : <><Save size={13} /> 导入</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 快捷键说明 */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["Ctrl+F", "聚焦搜索框"],
    ["Ctrl+A", "全选"],
    ["1 / 2 / 3 / 4", "切换 瀑布流 / 网格 / 列表 / 无限视图"],
    ["← → ↑ ↓", "在灯箱中切换图片"],
    ["Enter", "打开大图预览"],
    ["Esc", "关闭弹窗 / 收起左栏 / 取消选择"],
    ["0–5", "灯箱中快速评分"],
    ["Delete", "删除选中项"],
    ["无限视图(默认)", "拖拽平移 · 滚轮平移 · Ctrl+滚轮缩放 · 单击展开 · 双击大图"],
    ["沉浸模式", "顶栏常驻 · 左栏收成图标轨,悬停张开 · 点墙面或 Esc 收起"],
  ];
  return (
    <Modal title="快捷键" onClose={onClose} icon={<Keyboard size={14} />}>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs">
            <kbd className="bg-panel border border-border rounded px-1.5 py-0.5 text-[11px] text-neutral-300">{k}</kbd>
            <span className="text-neutral-500">{v}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** 设置 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const info = useStore((s) => s.info);
  const [watchFolders, setWatchFolders] = useState<string[]>([]);
  const [autoImport, setAutoImport] = useState(true);
  const [scanResult, setScanResult] = useState<string>("");

  useEffect(() => {
    api<{ watchFolders: string[]; autoImport: boolean }>("/settings").then((s) => {
      setWatchFolders(s.watchFolders);
      setAutoImport(s.autoImport);
    });
  }, []);

  const save = async (next: string[], auto: boolean) => {
    setWatchFolders(next);
    await api("/settings", { method: "PATCH", body: JSON.stringify({ key: "watchFolders", value: next }) });
    await api("/settings", { method: "PATCH", body: JSON.stringify({ key: "autoImport", value: auto }) });
  };

  return (
    <Modal title="设置" onClose={onClose} icon={<SettingsIcon size={14} />}>
      <div className="space-y-4 text-xs">
        <div>
          <div className="text-[11px] text-neutral-500 mb-1 flex items-center gap-1"><HardDrive size={11} /> 库位置</div>
          <div className="input w-full !py-1.5 text-[11px] text-neutral-400 truncate">{info?.path}</div>
        </div>

        <div>
          <div className="text-[11px] text-neutral-500 mb-1.5">观察文件夹（自动导入新文件，每 30 秒扫描）</div>
          <div className="space-y-1 mb-1.5">
            {watchFolders.map((w, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="input flex-1 !py-1 text-[11px] truncate">{w}</span>
                <button className="btn !p-1" onClick={() => save(watchFolders.filter((_, j) => j !== i), autoImport)}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              className="btn-primary"
              onClick={() => { const p = prompt("要观察的文件夹绝对路径："); if (p?.trim()) save([...watchFolders, p.trim()], autoImport); }}
            >
              添加
            </button>
            <button className="btn border border-border" onClick={async () => {
              const r = await api<{ imported: number }>("/watch-scan", { method: "POST" });
              setScanResult(`已导入 ${r.imported} 个新文件`);
              useStore.getState().refreshMeta();
              useStore.getState().fetchItems();
            }}><Search size={12} /> 立即扫描</button>
            {scanResult && <span className="text-[11px] text-green-400 self-center">{scanResult}</span>}
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={autoImport} onChange={(e) => save(watchFolders, e.target.checked)} className="accent-violet-400" />
          <span className="text-neutral-300">自动导入观察文件夹中的新文件</span>
        </label>

        <div className="text-[11px] text-neutral-600 border-t border-border pt-3">
          Lilium v0.1.0 · Rust + React · 图片素材管理器
        </div>
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
  const [result, setResult] = useState<string>("");

  const sel = items.filter((i) => ids.includes(i.id));
  const preview = (it: (typeof sel)[number] | undefined, idx: number) => {
    if (!it) return "";
    const stem = it.name.replace(/\.[^.]*$/, "");
    const d = new Date(it.addedAt);
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return pattern
      .replace(/\{name\}/g, stem)
      .replace(/\{index\}/g, String(idx + 1).padStart(3, "0"))
      .replace(/\{date\}/g, date)
      .replace(/\{ext\}/g, it.ext)
      .replace(/\{w\}/g, String(it.width ?? 0))
      .replace(/\{h\}/g, String(it.height ?? 0));
  };

  const apply = async () => {
    setRenaming(true);
    try {
      const r = await api<{ renamed: [string, string][] }>("/batch-rename", {
        method: "POST",
        body: JSON.stringify({ ids, pattern }),
      });
      setResult(`已重命名 ${r.renamed.length} 项`);
      fetchItems();
      setTimeout(onClose, 900);
    } catch (e) {
      setResult(`失败: ${(e as Error).message}`);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <Modal title={`批量重命名（${ids.length} 项）`} onClose={onClose} icon={<Pencil size={14} />}>
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
          <input className="input w-full" value={pattern} onChange={(e) => setPattern(e.target.value)} autoFocus />
        </div>

        <div>
          <div className="text-[11px] text-neutral-500 mb-1.5">预览（前 5 项）</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {sel.slice(0, 5).map((it, i) => (
              <div key={it.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-neutral-500 truncate max-w-[45%]">{it.name}</span>
                <span className="text-neutral-600">→</span>
                <span className="text-violet-300 truncate">{preview(it, ids.indexOf(it.id))}.{it.ext}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-primary" disabled={renaming || !pattern.trim()} onClick={apply}>
            {renaming ? "重命名中…" : "应用"}
          </button>
          {result && <span className="text-[11px] text-green-400">{result}</span>}
        </div>
      </div>
    </Modal>
  );
}

/** 通用弹窗骨架 */
export function Modal({ title, onClose, children, icon }: { title: string; onClose: () => void; children: React.ReactNode; icon?: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center fade-in" onClick={onClose}>
      <div className="bg-panel border border-border rounded-xl shadow-2xl w-[560px] max-w-[92vw] max-h-[82vh] flex flex-col pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          {icon}
          <span className="text-xs font-medium">{title}</span>
          <button className="btn !p-1 ml-auto" onClick={onClose}><Trash2 size={0} className="hidden" /><span className="text-neutral-500 hover:text-neutral-200 text-base leading-none">×</span></button>
        </div>
        <div className="p-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
