import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export default function Popover({ anchor, label, onClose, align = "end", className = "", children }: {
  anchor: RefObject<HTMLElement>;
  label: string;
  onClose: () => void;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onClose);
  dismiss.current = onClose;

  useLayoutEffect(() => {
    const panel = ref.current;
    const trigger = anchor.current;
    if (!panel || !trigger) return;

    const position = () => {
      if (!trigger.getClientRects().length) {
        dismiss.current();
        return;
      }
      const edge = 12;
      const gap = 8;
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const clip = trigger.closest("dialog[open]")?.getBoundingClientRect();
      const minX = Math.max(clip?.left ?? 0, viewport?.offsetLeft ?? 0);
      const minY = Math.max(clip?.top ?? 0, viewport?.offsetTop ?? 0);
      const maxX = Math.min(clip?.right ?? window.innerWidth, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth));
      const maxY = Math.min(clip?.bottom ?? window.innerHeight, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
      panel.style.maxWidth = `${Math.max(0, maxX - minX - edge * 2)}px`;
      const below = maxY - rect.bottom - edge - gap;
      const above = rect.top - minY - edge - gap;
      const contents = panel.querySelector<HTMLElement>(".filter-scroll");
      const overflow = contents ? contents.scrollHeight - contents.clientHeight : 0;
      const flip = below < panel.scrollHeight + overflow && above > below;
      const width = panel.offsetWidth;
      const left = align === "end" ? rect.right - width : rect.left;
      panel.style.maxHeight = `${Math.max(0, flip ? above : below)}px`;
      panel.style.left = `${Math.max(minX + edge, Math.min(left, maxX - edge - width))}px`;
      panel.style.top = `${flip ? rect.top - gap - panel.offsetHeight : rect.bottom + gap}px`;
    };
    position();
    panel.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    observer.observe(trigger);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !trigger.contains(event.target)) dismiss.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      const dialog = event.target instanceof Element ? event.target.closest("dialog[open]") : null;
      if (event.key === "Escape" && (!dialog || dialog.contains(panel))) {
        event.preventDefault();
        event.stopPropagation();
        dismiss.current();
        trigger.focus({ preventScroll: true });
      }
      if (event.key === "Tab" && event.target instanceof Node && panel.contains(event.target)) {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]"))
          .filter((element) => element.tabIndex >= 0 && element.getClientRects().length);
        if ((!event.shiftKey && event.target === focusable.at(-1)) || (event.shiftKey && (event.target === panel || event.target === focusable[0]))) {
          event.preventDefault();
          dismiss.current();
          trigger.focus({ preventScroll: true });
        }
      }
    };
    const focusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !trigger.contains(event.target)) dismiss.current();
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("focusin", focusOutside);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("focusin", focusOutside);
    };
  }, [anchor, align]);

  return createPortal(
    <div ref={ref} className={`popover ${className}`} role="dialog" aria-label={label} tabIndex={-1} data-shortcut-scope>
      {children}
    </div>, anchor.current?.closest("dialog[open]") ?? document.body,
  );
}
