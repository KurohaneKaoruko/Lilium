import { useEffect, useState } from "react";
import { CloudUpload } from "lucide-react";
import { useStore } from "../store/useStore";
import { importFiles } from "../lib/importFiles";

export default function DropOverlay() {
  const [depth, setDepth] = useState(0);
  const importing = useStore((s) => s.importing);
  const folder = useStore((s) => !s.filters.trash ? s.folders.find((f) => f.id === s.filters.folderId)?.name : undefined);
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: DragEvent) => { if (hasFiles(event)) setDepth((value) => value + 1); };
    const leave = () => setDepth((value) => Math.max(0, value - 1));
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = useStore.getState().importing ? "none" : "copy";
    };
    const drop = (event: DragEvent) => {
      setDepth(0);
      if (!hasFiles(event)) return;
      event.preventDefault();
      void importFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    const reset = () => setDepth(0);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return depth > 0 && !importing ? <div className="drop-overlay" role="status">
    <div className="drop-message"><span className="state-icon"><CloudUpload size={30} /></span><h2>松开即可导入</h2>
      <p>{folder ? `添加到「${folder}」` : "添加到素材库 · 未分类"}</p></div>
  </div> : null;
}
