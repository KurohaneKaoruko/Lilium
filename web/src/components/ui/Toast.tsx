import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { Notice } from "../../lib/feedback";

const ToastContext = createContext<{ notice: Notice | null; dismiss: () => void }>({ notice: null, dismiss: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const show = (event: Event) => setNotice((event as CustomEvent<Notice>).detail);
    window.addEventListener("lilium:notice", show);
    return () => window.removeEventListener("lilium:notice", show);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.tone === "error" ? 6500 : 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return <ToastContext.Provider value={{ notice, dismiss: () => setNotice(null) }}>{children}</ToastContext.Provider>;
}

export default function Toast() {
  const { notice, dismiss } = useContext(ToastContext);
  const Icon = notice?.tone === "error" ? AlertCircle : notice?.tone === "info" ? Info : CheckCircle2;
  return <div className="toast-lane" role="status" aria-live="polite">
    {notice && <div className={`toast toast-${notice.tone}`}>
      <Icon size={18} /><span>{notice.message}</span>
      <button className="icon-button" type="button" title="关闭通知" aria-label="关闭通知" onClick={dismiss}><X size={15} /></button>
    </div>}
  </div>;
}
