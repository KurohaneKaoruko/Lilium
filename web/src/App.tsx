import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import TopBar, { type ImportMode, type ToolMode } from "./components/TopBar";
import Workspace from "./components/Workspace";
import DetailPanel from "./components/DetailPanel";
import Lightbox from "./components/Lightbox";
import ContextMenu from "./components/ContextMenu";
import { BatchRenameModal, DuplicatesModal, ImportPathModal, SettingsModal, ShortcutsModal } from "./components/modals/Modals";
import StatsModal from "./components/modals/StatsModal";
import DropOverlay from "./components/DropOverlay";
import CommandPalette from "./components/CommandPalette";
import { Dialog } from "./components/ui/Dialog";
import Toast, { ToastProvider } from "./components/ui/Toast";
import { useStore } from "./store/useStore";
import { api } from "./api/client";
import { notify, reportError } from "./lib/feedback";
import { formatCount, isCommandShortcut, isShortcutScope, VIEWS } from "./lib/workspace";

type ModalMode = ToolMode | ImportMode | "commands" | { ids: string[] };

function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

const sidebarKey = "lilium.sidebar.expanded";

export default function App() {
  const mobile = useMedia("(max-width: 719px)");
  const wide = useMedia("(min-width: 1120px)");
  const [sidebarPref, setSidebarPref] = useState<boolean | null>(() => {
    try {
      const value = localStorage.getItem(sidebarKey);
      return value === "true" ? true : value === "false" ? false : null;
    } catch { return null; }
  });
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState<ModalMode | null>(null);
  const started = useRef(false);
  const detail = useStore((s) => s.items.find((item) => item.id === s.detailId));
  const setDetail = useStore((s) => s.setDetail);
  const expanded = sidebarPref ?? wide;
  const closeDrawer = () => setDrawer(false);
  const closeDetail = () => setDetail(null);
  const closeModal = () => setModal(null);

  const toggleSidebar = () => {
    if (mobile) setDrawer((open) => !open);
    else {
      setSidebarPref(!expanded);
      try { localStorage.setItem(sidebarKey, String(!expanded)); } catch { /* optional preference */ }
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const st = useStore.getState();
    void Promise.all([st.refreshMeta(), st.fetchItems()]);
  }, []);

  useEffect(() => {
    if (!mobile) setDrawer(false);
  }, [mobile]);

  useEffect(() => {
    const rename = (event: Event) => setModal((event as CustomEvent<{ ids: string[] }>).detail);
    window.addEventListener("lilium:batch-rename", rename);
    return () => window.removeEventListener("lilium:batch-rename", rename);
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (isCommandShortcut(event) && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        setModal("commands");
        return;
      }
      if (isShortcutScope(event)) return;
      const st = useStore.getState();
      if (st.lightboxId) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && st.view !== "collections" && !st.loading) {
        event.preventDefault();
        st.selectAll();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        if (st.detailId) st.setDetail(null);
        else if (st.selectionMode) st.setSelectionMode(false);
        else if (st.selection.size) st.clearSelection();
        return;
      }
      if (event.key === "?") { setModal("shortcuts"); return; }
      if (/^[1-5]$/.test(event.key)) { st.setView(VIEWS[Number(event.key) - 1].key); return; }
      if (st.loading || st.view === "collections") return;
      if (event.key === "Delete" && !st.filters.trash && st.selection.size && !event.repeat) {
        const ids = [...st.selection];
        if (confirm(`将 ${formatCount(ids.length)} 项素材移到回收站？`)) {
          void api("/batch", { method: "POST", body: JSON.stringify({ ids, action: "trash" }) }).then(() => {
            ids.forEach(st.removeItemLocal);
            void Promise.all([st.fetchItems(), st.refreshMeta()]);
            notify(`已将 ${formatCount(ids.length)} 项移到回收站`);
          }).catch((error) => reportError("无法移动到回收站", error));
        }
      }
      if (event.key === "Enter" && !st.selectionMode && st.selection.size === 1 && !(event.target instanceof Element && event.target.closest("button, a"))) {
        event.preventDefault();
        st.setLightbox([...st.selection][0]);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  return (
    <ToastProvider><div className="app-shell">
      <a href="#workspace" className="skip-link">跳到素材区</a>
      <TopBar sidebarOpen={mobile ? drawer : expanded} toggleSidebar={toggleSidebar} onTool={setModal} onImport={setModal}
        onCommands={() => setModal("commands")} />
      <div className="app-body">
        {!mobile && <Sidebar collapsed={!expanded} onExpand={toggleSidebar} onTool={setModal} />}
        <Workspace />
        {wide && detail && <div className="app-detail"><DetailPanel item={detail} key={detail.id} onClose={closeDetail} /></div>}
      </div>
      {mobile && drawer && <Dialog className="navigation-drawer" label="素材库导航" onClose={closeDrawer}>
        <Sidebar onDismiss={closeDrawer} onNavigate={closeDrawer} onExpand={closeDrawer}
          onTool={(tool) => { closeDrawer(); setModal(tool); }} />
      </Dialog>}
      {!wide && detail && <Dialog className="detail-drawer" label="素材详情" onClose={closeDetail}>
        <DetailPanel item={detail} key={detail.id} onClose={closeDetail} />
      </Dialog>}

      <ContextMenu />
      <Lightbox />
      <DropOverlay />

      {modal === "shortcuts" && <ShortcutsModal onClose={closeModal} />}
      {modal === "duplicates" && <DuplicatesModal onClose={closeModal} />}
      {modal === "settings" && <SettingsModal onClose={closeModal} />}
      {modal === "stats" && <StatsModal onClose={closeModal} />}
      {(modal === "url" || modal === "disk" || modal === "library") && <ImportPathModal key={modal} mode={modal} onClose={closeModal} />}
      {modal && typeof modal === "object" && <BatchRenameModal ids={modal.ids} onClose={closeModal} />}
      {modal === "commands" && <CommandPalette onClose={closeModal} onTool={setModal} onImport={setModal} />}

      <Toast />
    </div></ToastProvider>
  );
}
