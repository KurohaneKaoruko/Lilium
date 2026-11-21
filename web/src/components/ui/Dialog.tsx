import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Toast from "./Toast";

export function Dialog({ label, labelledBy, className = "", onClose, children }: {
  label?: string;
  labelledBy?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-dialog-focus]")?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-label={label}
      aria-labelledby={labelledBy}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {children}
      <Toast />
    </dialog>, document.body,
  );
}

export function Modal({ title, onClose, children, icon }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const heading = useId();
  return (
    <Dialog labelledBy={heading} onClose={onClose}>
      <div className="dialog-layout">
        <header className="dialog-header">
          {icon && <span className="dialog-icon" aria-hidden="true">{icon}</span>}
          <h2 id={heading}>{title}</h2>
          <button type="button" className="icon-button ml-auto" aria-label="关闭弹窗" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="dialog-content">{children}</div>
      </div>
    </Dialog>
  );
}
