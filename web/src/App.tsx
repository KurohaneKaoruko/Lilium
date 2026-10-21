import { useEffect, useState } from "react";
import { Wand2, Image as ImageIcon, Inbox, Tags as TagsIcon, Trash2, Keyboard as KeyboardIcon, Settings as SettingsIcon } from "lucide-react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import DetailPanel from "./components/DetailPanel";
import Lightbox from "./components/Lightbox";
import ContextMenu from "./components/ContextMenu";
import GridView from "./components/views/GridView";
import MasonryView from "./components/views/MasonryView";
import ListView from "./components/views/ListView";
import InfiniteView from "./components/views/InfiniteView";
import { DuplicatesModal, BatchRenameModal, SelectionBar, SettingsModal, ShortcutsModal } from "./components/modals/Modals";
import DropOverlay from "./components/DropOverlay";
import CollectionsView from "./components/views/CollectionsView";
import WindowControls from "./components/WindowControls";
import { useStore } from "./store/useStore";
import { api } from "./api/client";

export default function App() {
  const view = useStore((s) => s.view);
  const fetchItems = useStore((s) => s.fetchItems);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const similarIds = useStore((s) => s.similarIds);
  const exitSimilar = useStore((s) => s.exitSimilar);
  const [modal, setModal] = useState<"shortcuts" | "duplicates" | "settings" | null>(null);
  const [renameIds, setRenameIds] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    refreshMeta();
    fetchItems();
  }, [refreshMeta, fetchItems]);

  // 桌面端诊断横幅（临时）
  const [diag, setDiag] = useState<string>("");
  void diag; void setDiag;

  // 批量重命名事件
  useEffect(() => {
    const h = (e: Event) => setRenameIds((e as CustomEvent).detail.ids);
    window.addEventListener("lilium:batch-rename", h);
    return () => window.removeEventListener("lilium:batch-rename", h);
  }, []);

  // MiniRail 呼出的弹窗
  useEffect(() => {
    const a = () => setModal("shortcuts");
    const b = () => setModal("settings");
    window.addEventListener("lilium:open-shortcuts", a);
    window.addEventListener("lilium:open-settings", b);
    return () => {
      window.removeEventListener("lilium:open-shortcuts", a);
      window.removeEventListener("lilium:open-settings", b);
    };
  }, []);

  // 全局快捷键
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        st.selectAll();
        return;
      }
      if (e.key === "Escape") {
        if (st.lightboxId) return; // Lightbox 自己处理
        if (st.view === "infinite") return; // 无限视图自己处理:先收起,再退出
        st.clearSelection();
        st.setDetail(null);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (st.selection.size === 0) return;
        const ids = [...st.selection];
        if (confirm(`删除 ${ids.length} 项到回收站？`)) {
          api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "trash" }) }).then(() => {
            ids.forEach((id) => st.removeItemLocal(id));
            setToast(`已删除 ${ids.length} 项`);
          });
        }
      }
      if (e.key === "Enter" && st.selection.size === 1) {
        st.setLightbox([...st.selection][0]);
      }
      if (e.key === "1") st.setView("masonry");
      if (e.key === "2") st.setView("grid");
      if (e.key === "3") st.setView("list");
      if (e.key === "4") st.setView("infinite");
      if (e.key === "?") setModal("shortcuts");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const fullscreen = view === "infinite";
  const chromeLeft = useStore((s) => s.chromeLeft);
  const setChromeLeft = useStore((s) => s.setChromeLeft);

  // 沉浸视图:顶栏固定常驻;左栏是唯一可收起的面板。
  // - 指针进左边缘热区 → 展开左栏
  // - 离开左栏面板(未悬停在任何面板上) → 收回图标轨
  useEffect(() => {
    if (!fullscreen) return;
    const EDGE = 6;
    const onMove = (e: PointerEvent) => {
      const st = useStore.getState();
      if (e.clientX <= EDGE && !st.chromeLeft) setChromeLeft(true);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [fullscreen, setChromeLeft]);

  // 点击墙面(拖拽/滚轮)→ 左栏收回
  useEffect(() => {
    if (!fullscreen) return;
    const onWall = () => {
      const st = useStore.getState();
      if (!st.chromeHovering && st.chromeLeft) st.setChromeLeft(false);
    };
    window.addEventListener("lilium:wall-interact", onWall);
    return () => window.removeEventListener("lilium:wall-interact", onWall);
  }, [fullscreen]);

  return (
    <div className="h-full flex flex-col">
      {!fullscreen && <TopBar onImported={() => setToast("导入完成")} />}
      <div className="flex-1 flex min-h-0">
        {!fullscreen && <Sidebar />}
        <main className={fullscreen ? "flex-1 flex min-w-0 relative" : "flex-1 flex flex-col min-w-0 relative"}>
          {!fullscreen && similarIds && (
            <div className="h-9 shrink-0 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 px-3 text-xs text-amber-300">
              <Wand2 size={13} />
              相似图片结果 · {similarIds.length} 张
              <button className="btn ml-auto" onClick={exitSimilar}>返回</button>
            </div>
          )}
          {view === "masonry" && <MasonryView />}
          {view === "grid" && <GridView />}
          {view === "list" && <ListView />}
          {view === "infinite" && <InfiniteView />}
          {view === "collections" && <CollectionsView />}
          {!fullscreen && <SelectionBar />}
        </main>
        {!fullscreen && <DetailPanelWrapper />}
      </div>

      {/* 沉浸视图的悬浮工作台:顶栏(含窗口钮)与左栏相互独立,各自呼出/收起 */}
      {fullscreen && (
        <FloatingChrome>
          {(mode) =>
            mode === "top" ? (
              <TopBar immersive onImported={() => setToast("导入完成")} />
            ) : (
              <Sidebar immersive />
            )
          }
        </FloatingChrome>
      )}

      <Lightbox />
      <ContextMenu />
      <DropOverlay />

      {modal === "shortcuts" && <ShortcutsModal onClose={() => setModal(null)} />}
      {modal === "duplicates" && <DuplicatesModal onClose={() => setModal(null)} />}
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} />}
      {renameIds && <BatchRenameModal ids={renameIds} onClose={() => setRenameIds(null)} />}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[80] bg-panel2 border border-border rounded-lg shadow-xl px-4 py-2 text-xs pop-in">
          {toast}
        </div>
      )}
    </div>
  );
}

function DetailPanelWrapper() {
  const detailId = useStore((s) => s.detailId);
  if (!detailId) return null;
  return <DetailPanel />;
}

/**
 * 沉浸视图的悬浮容器:顶栏(含窗口钮)固定常驻;左栏是唯一可收起面板——
 * 收起 = 48px 图标轨,悬停原地张开成 224px 完整侧栏。
 * 过渡:宽度 + 内层反向位移(内容像"从轨后滑出"),叠加交叉淡化,无跳变。
 */
function FloatingChrome({ children }: { children: (mode: "top" | "left") => React.ReactNode }) {
  const chromeLeft = useStore((s) => s.chromeLeft);
  const setChromeLeft = useStore((s) => s.setChromeLeft);

  const hold = () => useStore.setState({ chromeHovering: true });
  const release = () => {
    useStore.setState({ chromeHovering: false });
    window.setTimeout(() => {
      const st = useStore.getState();
      if (!st.chromeHovering && st.chromeLeft) setChromeLeft(false);
    }, 320);
  };

  return (
    <>
      {/* 顶部:窗口控制钮 + 主顶栏(固定,不隐藏) */}
      <div className="absolute top-0 inset-x-0 z-40">
        <div className="flex items-stretch h-11 bg-panel/85 backdrop-blur-md border-b border-border/60 shadow-lg">
          <div className="flex-1 min-w-0">{children("top")}</div>
          <WindowControls />
        </div>
      </div>
      {/* 左栏:同一个容器 —— 收起 = 48px 图标轨,悬停时原地张开成 224px 完整侧栏 */}
      <div
        data-chrome-left
        onPointerEnter={() => {
          hold();
          setChromeLeft(true);
        }}
        onPointerLeave={release}
        className="absolute left-0 top-0 bottom-0 z-30 overflow-hidden"
        style={{
          width: chromeLeft ? 224 : 48,
          transition: "width 340ms cubic-bezier(.22,1,.36,1)",
          boxShadow: "8px 0 24px rgba(0,0,0,.25)",
        }}
      >
        {/* 完整侧栏:固定 224px 宽,收起时向左滑 176px(224-48)藏进裁剪区,叠交叉淡化 */}
        <div
          className="absolute inset-y-0 left-0 w-56 bg-panel/85 backdrop-blur-md border-r border-border/60"
          style={{
            transform: chromeLeft ? "translateX(0)" : "translateX(-176px)",
            opacity: chromeLeft ? 1 : 0,
            pointerEvents: chromeLeft ? "auto" : "none",
            transition: chromeLeft
              ? "transform 340ms cubic-bezier(.22,1,.36,1), opacity 240ms ease 60ms"
              : "transform 340ms cubic-bezier(.22,1,.36,1), opacity 160ms ease",
          }}
          aria-hidden={!chromeLeft}
        >
          {children("left")}
        </div>
        {/* 图标轨 = 侧栏的收起态(同一容器内,张开后淡出) */}
        <MiniRail collapsed={chromeLeft} />
      </div>
    </>
  );
}

/** 左栏收起态的图标轨:与完整侧栏同处一个容器,张开后淡出让位 */
function MiniRail({ collapsed }: { collapsed: boolean }) {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const resetFilters = useStore((s) => s.resetFilters);
  const info = useStore((s) => s.info);

  const item = (active: boolean) =>
    `w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
      active
        ? "bg-violet-500/25 text-violet-200"
        : "text-neutral-400 hover:text-neutral-200 hover:bg-white/10"
    }`;

  return (
    <div
      className="absolute inset-y-0 left-0 w-12 bg-panel/85 backdrop-blur-md flex flex-col items-center py-2 gap-1"
      style={{
        opacity: collapsed ? 0 : 1,
        pointerEvents: collapsed ? "none" : "auto",
        transition: collapsed ? "opacity 120ms ease" : "opacity 220ms ease 60ms",
      }}
      aria-hidden={collapsed}
    >
      <div className="text-lg leading-none mb-1" title={info?.name ?? "Lilium"}>
        🌸
      </div>
      <button
        className={item(
          !filters.folderId && !filters.trash && !filters.smartId && !filters.tag && !filters.unfiled && !filters.untagged,
        )}
        title="全部图片"
        onClick={() => resetFilters()}
      >
        <ImageIcon size={15} />
      </button>
      <button
        className={item(filters.unfiled)}
        title="未分类"
        onClick={() => setFilters({ unfiled: true, folderId: null, trash: false, smartId: null })}
      >
        <Inbox size={15} />
      </button>
      <button
        className={item(filters.untagged)}
        title="未加标签"
        onClick={() => setFilters({ untagged: true, folderId: null, trash: false, smartId: null })}
      >
        <TagsIcon size={15} />
      </button>
      <button
        className={item(filters.trash)}
        title="回收站"
        onClick={() => setFilters({ trash: true, folderId: null, smartId: null })}
      >
        <Trash2 size={15} />
      </button>
      <div className="flex-1" />
      <button
        className={item(false)}
        title="快捷键 (?)"
        onClick={() => window.dispatchEvent(new CustomEvent("lilium:open-shortcuts"))}
      >
        <KeyboardIcon size={15} />
      </button>
      <button
        className={item(false)}
        title="设置"
        onClick={() => window.dispatchEvent(new CustomEvent("lilium:open-settings"))}
      >
        <SettingsIcon size={15} />
      </button>
    </div>
  );
}
