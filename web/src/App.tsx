import { useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
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
              <Sidebar immersive collapsed={!chromeLeft} />
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
 * 沉浸视图的悬浮容器:顶栏固定常驻;左栏就是 Sidebar 本身这一个 box——
 * 收起 48px(只露出每行最左的图标),悬停原地张开 224px,内容随宽度自然呈现。
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
      {/* 左栏:一个 box,48 ⇄ 224,悬停张开;宽度过渡直接由 Sidebar 自己承担 */}
      <div
        data-chrome-left
        onPointerEnter={() => {
          hold();
          setChromeLeft(true);
        }}
        onPointerLeave={release}
        className="absolute left-0 top-0 bottom-0 z-30"
      >
        {children("left")}
      </div>
    </>
  );
}

