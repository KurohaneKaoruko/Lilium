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
import AmbientView from "./components/views/AmbientView";
import CollectionsView from "./components/views/CollectionsView";
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

  return (
    <div className="h-full flex flex-col">
      <TopBar onImported={() => setToast("导入完成")} />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 relative">
          {similarIds && (
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
          {view === "ambient" && <AmbientView />}
          {view === "collections" && <CollectionsView />}
          <SelectionBar />
        </main>
        <DetailPanelWrapper />
      </div>

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
