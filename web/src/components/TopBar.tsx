import { useEffect, useRef, useState } from "react";
import { BarChart3, ChevronDown, Command, Ellipsis, FileUp, FolderInput, HardDrive, Keyboard, Link2, LoaderCircle, PanelLeft, PanelLeftClose, Plus, RefreshCw, Search, Settings, WandSparkles, X } from "lucide-react";
import { importFiles } from "../lib/importFiles";
import { shortcutMod } from "../lib/workspace";
import { useStore } from "../store/useStore";
import Popover from "./ui/Popover";
import WindowControls from "./WindowControls";

export type ToolMode = "shortcuts" | "settings" | "stats" | "duplicates";
export type ImportMode = "url" | "disk" | "library";

export default function TopBar({ sidebarOpen, toggleSidebar, onTool, onImport, onCommands }: {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  onTool: (mode: ToolMode) => void;
  onImport: (mode: ImportMode) => void;
  onCommands: () => void;
}) {
  const query = useStore((s) => s.filters.q);
  const setSearch = useStore((s) => s.setSearch);
  const importing = useStore((s) => s.importing);
  const searchRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const [composition, setComposition] = useState<string | null>(null);
  const [menu, setMenu] = useState<"tools" | "import" | null>(null);
  const close = () => setMenu(null);

  useEffect(() => {
    const focusSearch = () => { searchRef.current?.focus(); searchRef.current?.select(); };
    const searchShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !event.isComposing && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        focusSearch();
      }
    };
    const chooseFiles = () => uploadRef.current?.click();
    const openImport = () => setMenu("import");
    window.addEventListener("keydown", searchShortcut);
    window.addEventListener("lilium:choose-files", chooseFiles);
    window.addEventListener("lilium:import-menu", openImport);
    window.addEventListener("lilium:focus-search", focusSearch);
    return () => {
      window.removeEventListener("keydown", searchShortcut);
      window.removeEventListener("lilium:choose-files", chooseFiles);
      window.removeEventListener("lilium:import-menu", openImport);
      window.removeEventListener("lilium:focus-search", focusSearch);
    };
  }, []);

  const tool = (mode: ToolMode) => {
    toolsTrigger.current?.focus();
    close();
    onTool(mode);
  };
  const importFrom = (mode: ImportMode) => {
    importTrigger.current?.focus();
    close();
    onImport(mode);
  };

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-brand" data-tauri-drag-region>
        <button type="button" className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"} title={sidebarOpen ? "收起侧栏" : "展开侧栏"}>
          {sidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeft size={19} />}
        </button>
        <div className="brand" data-tauri-drag-region>
          <img src="/lilium-mark.webp" width="32" height="32" alt="" draggable={false} data-tauri-drag-region />
          <span data-tauri-drag-region>Lilium</span>
        </div>
      </div>

      <div className="topbar-search" data-tauri-drag-region>
        <form className="search-field" role="search" onSubmit={(event) => {
          event.preventDefault();
          if (!composing.current) setSearch(query, true);
        }}>
          <Search size={17} aria-hidden="true" />
          <input type="search" ref={searchRef} value={composition ?? query} placeholder="搜索素材名称、注释或标签…" aria-label="搜索素材"
            onChange={(event) => composing.current ? setComposition(event.target.value) : setSearch(event.target.value)}
            onCompositionStart={(event) => { composing.current = true; setComposition(event.currentTarget.value); }}
            onCompositionEnd={(event) => { composing.current = false; setComposition(null); setSearch(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                if (query) setSearch("", true);
                else event.currentTarget.blur();
              }
            }} />
          {query ? <button type="button" className="icon-button" aria-label="清除搜索" title="清除搜索"
            onClick={() => { setSearch("", true); searchRef.current?.focus(); }}><X size={15} /></button>
            : <kbd aria-hidden="true">{shortcutMod} F</kbd>}
        </form>
      </div>

      <div className="topbar-actions" data-tauri-drag-region>
        <input ref={uploadRef} type="file" multiple hidden onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void importFiles(files);
        }} />
        <button type="button" className="icon-button topbar-command" aria-label="打开命令面板" aria-haspopup="dialog"
          title={`命令面板（${shortcutMod}+K）`} onClick={onCommands}><Command size={17} /></button>
        <button className="btn-primary import-button" ref={importTrigger} type="button" disabled={importing}
          aria-expanded={menu === "import"} aria-haspopup="dialog" onClick={() => setMenu(menu === "import" ? null : "import")}>
          {importing ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={17} />}
          <span>{importing ? "导入中…" : "导入素材"}</span><ChevronDown size={13} className="import-chevron" />
        </button>
        {menu === "import" && (
          <Popover anchor={importTrigger} label="导入方式" onClose={close} className="action-menu">
            <p className="menu-caption">添加到素材库</p>
            <button className="menu-row" onClick={() => { importTrigger.current?.focus(); close(); uploadRef.current?.click(); }}><FileUp size={16} />选择文件…</button>
            <button className="menu-row" onClick={() => importFrom("url")}><Link2 size={16} />从链接导入…</button>
            <button className="menu-row" onClick={() => importFrom("disk")}><HardDrive size={16} />从磁盘路径导入…</button>
            <button className="menu-row" onClick={() => importFrom("library")}><FolderInput size={16} />迁移现有资源库…</button>
          </Popover>
        )}
        <button type="button" className="icon-button more-button" ref={toolsTrigger} title="更多工具" aria-label="更多工具"
          aria-expanded={menu === "tools"} aria-haspopup="dialog" onClick={() => setMenu(menu === "tools" ? null : "tools")}><Ellipsis size={21} /></button>
        {menu === "tools" && (
          <Popover anchor={toolsTrigger} label="更多工具" onClose={close} className="action-menu">
            <p className="menu-caption">资源库工具</p>
            <button className="menu-row touch-command" onClick={() => { toolsTrigger.current?.focus(); close(); onCommands(); }}>
              <Command size={16} />打开命令面板<kbd>{shortcutMod} K</kbd></button>
            <button className="menu-row" onClick={() => tool("stats")}><BarChart3 size={16} />库统计</button>
            <button className="menu-row" onClick={() => tool("duplicates")}><WandSparkles size={16} />查找重复素材</button>
            <button className="menu-row" onClick={() => {
              toolsTrigger.current?.focus();
              close();
              const st = useStore.getState();
              void Promise.all([st.refreshMeta(), st.fetchItems()]);
            }}><RefreshCw size={16} />刷新资源库</button>
            <div className="menu-divider" />
            <button className="menu-row" onClick={() => tool("settings")}><Settings size={16} />设置</button>
            <button className="menu-row" onClick={() => tool("shortcuts")}><Keyboard size={16} />键盘快捷键<kbd>?</kbd></button>
          </Popover>
        )}
        <WindowControls />
      </div>
    </header>
  );
}
