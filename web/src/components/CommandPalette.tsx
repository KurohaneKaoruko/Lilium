import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { BarChart3, FileUp, FolderInput, HardDrive, Keyboard, Link2, RefreshCw, Search, Settings, SlidersHorizontal, WandSparkles, X, type LucideIcon } from "lucide-react";
import { useStore } from "../store/useStore";
import { formatCount, isCommandShortcut, VIEWS } from "../lib/workspace";
import { Dialog } from "./ui/Dialog";
import type { ImportMode, ToolMode } from "./TopBar";

type Command = {
  id: string;
  label: string;
  hint: string;
  keywords?: string;
  icon: LucideIcon;
  disabled?: boolean;
  shortcut?: string;
  current?: boolean;
  run: () => void;
};

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim();

export default function CommandPalette({ onClose, onTool, onImport }: {
  onClose: () => void;
  onTool: (tool: ToolMode) => void;
  onImport: (mode: ImportMode) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const listId = useId();
  const view = useStore((s) => s.view);
  const loading = useStore((s) => s.loading);
  const importing = useStore((s) => s.importing);

  const dispatch = (event: string) => window.dispatchEvent(new Event(event));
  const commands: Command[] = [
    { id: "search", label: "搜索素材", hint: "在素材库中查找名称、注释或标签", keywords: "search find", icon: Search,
      run: () => dispatch("lilium:focus-search") },
    { id: "filters", label: "打开高级筛选", hint: "评分、日期和排除标签", keywords: "filter", icon: SlidersHorizontal,
      run: () => dispatch("lilium:open-filters") },
    { id: "import-files", label: "导入本地文件", hint: importing ? "正在导入其他文件…" : "从设备选择一个或多个文件", keywords: "import upload", icon: FileUp,
      disabled: importing, run: () => dispatch("lilium:choose-files") },
    ...VIEWS.map(({ key, label, icon }, index) => ({ id: `view-${key}`, label: `切换到${label}`, hint: key === view ? "正在使用此视图" : "更改素材排列方式",
      keywords: `${key} view`, icon, current: key === view, shortcut: String(index + 1), run: () => useStore.getState().setView(key) })),
    { id: "import-url", label: "从链接导入", hint: "通过 URL 添加素材", keywords: "import url link", icon: Link2, disabled: importing, run: () => onImport("url") },
    { id: "import-path", label: "从磁盘路径导入", hint: "从服务端可访问的目录或文件导入", keywords: "import path disk", icon: HardDrive, disabled: importing, run: () => onImport("disk") },
    { id: "import-library", label: "迁移现有资源库", hint: "导入 Eagle 资源库", keywords: "import library eagle", icon: FolderInput, disabled: importing, run: () => onImport("library") },
    { id: "refresh", label: "刷新资源库", hint: loading ? "正在更新…" : "重新载入素材和分类", keywords: "refresh reload", icon: RefreshCw, disabled: loading, run: () => {
      const store = useStore.getState();
      void Promise.all([store.refreshMeta(), store.fetchItems()]);
    } },
    { id: "duplicates", label: "查找重复素材", hint: "查看库中的重复文件", keywords: "duplicate", icon: WandSparkles, run: () => onTool("duplicates") },
    { id: "stats", label: "查看库统计", hint: "查看素材、标签和已用空间", keywords: "stats statistics", icon: BarChart3, run: () => onTool("stats") },
    { id: "settings", label: "打开设置", hint: "管理观察文件夹和自动导入", keywords: "settings preferences", icon: Settings, run: () => onTool("settings") },
    { id: "shortcuts", label: "查看键盘快捷键", hint: "了解工作台的键盘操作", keywords: "keyboard shortcuts help", icon: Keyboard, shortcut: "?", run: () => onTool("shortcuts") },
  ];

  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = commands.filter((command) => {
    if (!terms.length) return true;
    const text = normalize(`${command.label} ${command.keywords ?? ""} ${command.hint}`);
    return terms.every((term) => text.includes(term));
  });
  const enabled = matches.filter((command) => !command.disabled);
  const current = enabled.find((command) => command.id === activeId) ?? enabled[0];
  const currentOptionId = current ? `${listId}-${current.id}` : undefined;

  useEffect(() => {
    if (currentOptionId) document.getElementById(currentOptionId)?.scrollIntoView({ block: "nearest" });
  }, [currentOptionId]);

  function execute(command: Command | undefined) {
    if (!command || command.disabled) return;
    // 先解除原生弹窗的焦点限制；文件选择器仍在本次用户手势中打开。
    flushSync(onClose);
    command.run();
  }

  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!enabled.length) return;
      const index = enabled.findIndex((command) => command.id === current?.id);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveId(enabled[(index + direction + enabled.length) % enabled.length].id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      execute(current);
    }
  }

  return <Dialog label="命令面板" className="command-dialog" onClose={onClose}>
    <div className="command-palette" onKeyDown={(event) => {
      if (isCommandShortcut(event.nativeEvent)) { event.preventDefault(); onClose(); }
    }}>
      <div className="command-search">
        <Search size={19} aria-hidden="true" />
        <input data-dialog-focus role="combobox" aria-label="搜索命令" aria-expanded="true" aria-controls={listId}
          aria-autocomplete="list" aria-activedescendant={currentOptionId} autoComplete="off" enterKeyHint="go" value={query}
          placeholder="搜索操作或视图…" onChange={(event) => { setQuery(event.target.value); setActiveId(null); }} onKeyDown={keyboard} />
        <button className="icon-button command-close" title="关闭命令面板 (Esc)" aria-label="关闭命令面板" onClick={onClose}><X size={17} /></button>
      </div>
      <div className="command-list" id={listId} role="listbox" aria-label="可用命令">
        {matches.map((command) => {
          const Icon = command.icon;
          return <button type="button" role="option" key={command.id} id={`${listId}-${command.id}`} tabIndex={-1}
            className="command-item" aria-selected={command.id === current?.id} disabled={command.disabled}
            onPointerMove={(event) => { if (event.pointerType === "mouse" && !command.disabled) setActiveId(command.id); }}
            onMouseDown={(event) => event.preventDefault()} onClick={() => execute(command)}>
            <span className="command-icon"><Icon size={17} aria-hidden="true" /></span>
            <span className="command-item-label"><strong>{command.label}</strong><small>{command.hint}</small></span>
            {command.current ? <span className="command-current">当前</span> : command.shortcut && <kbd className="command-key">{command.shortcut}</kbd>}
          </button>;
        })}
      </div>
      {!matches.length && <div className="command-empty" role="status"><Search size={21} /><div><strong>没有匹配的操作</strong><p>试试「网格」「导入」或「设置」。</p></div></div>}
      <footer className="command-footer">
        <span className="command-key-hint"><kbd>↑</kbd><kbd>↓</kbd>选择</span>
        <span className="command-key-hint"><kbd>Enter</kbd>执行</span>
        <span className="ml-auto tabular-nums">{formatCount(matches.length)} 个操作</span>
      </footer>
    </div>
  </Dialog>;
}
