import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Modal } from "./Dialog";

export default function NameDialog({ title, initial = "", onClose, onSave }: {
  title: string;
  initial?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} icon={<FolderPlus size={18} />} onClose={() => { if (!busy) onClose(); }}>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
          await onSave(name.trim());
          onClose();
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
          setBusy(false);
        }
      }}>
        <label className="field-label">
          名称
          <input className="input w-full" value={name} onChange={(event) => setName(event.target.value)}
            placeholder="输入名称" required disabled={busy} data-dialog-focus />
        </label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn-primary" disabled={!name.trim() || busy}>{busy ? "保存中…" : "保存"}</button>
        </div>
      </form>
    </Modal>
  );
}
