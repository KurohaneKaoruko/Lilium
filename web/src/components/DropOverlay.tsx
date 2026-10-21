import { useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";
import { useStore } from "../store/useStore";
import { apiBase } from "../api/client";

/** 全局拖放导入：把 OS 里的文件/文件夹拖进窗口即导入到当前文件夹（Eagle 式体验） */
export default function DropOverlay() {
  const [depth, setDepth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const folderId = useStore((s) => s.filters.folderId);
  const refreshMeta = useStore((s) => s.refreshMeta);
  const fetchItems = useStore((s) => s.fetchItems);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      setDepth((d) => d + 1);
    };
    const onLeave = () => setDepth((d) => Math.max(0, d - 1));
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDepth(0);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      setBusy(true);
      setDone(null);
      try {
        const fd = new FormData();
        for (const f of files) fd.append("files", f);
        if (folderId) fd.append("folderId", folderId);
        const res = await fetch(`${apiBase()}/api/import/upload`, {
          method: "POST",
          body: fd,
        });
        const j = await res.json();
        const n = j.items?.length ?? 0;
        setDone(`已导入 ${n} 个文件`);
        refreshMeta();
        fetchItems();
      } catch (err) {
        setDone(`导入失败: ${(err as Error).message}`);
      } finally {
        setBusy(false);
        setTimeout(() => setDone(null), 3000);
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [folderId, refreshMeta, fetchItems]);

  if (depth === 0 && !busy && !done) return null;

  return (
    <div
      className={`fixed inset-0 z-[90] pointer-events-none transition-opacity ${
        depth > 0 || busy ? "opacity-100" : "opacity-0"
      }`}
    >
      {depth > 0 && (
        <div className="absolute inset-2 border-2 border-dashed border-violet-400/70 rounded-xl bg-violet-500/10 backdrop-blur-[2px] flex items-center justify-center">
          <div className="bg-panel border border-violet-400/50 rounded-xl px-6 py-5 shadow-2xl text-center">
            <UploadCloud size={30} className="mx-auto text-violet-300 mb-2" />
            <div className="text-sm text-violet-200">松开导入到图库</div>
            <div className="text-[11px] text-neutral-500 mt-1">
              {folderId ? "将导入到当前文件夹" : "将导入到未分类"}
            </div>
          </div>
        </div>
      )}
      {(busy || done) && (
        <div className="absolute left-1/2 -translate-x-1/2 top-14 bg-panel border border-border rounded-lg px-4 py-2 text-xs shadow-xl">
          {busy ? "导入中…" : done}
        </div>
      )}
    </div>
  );
}
