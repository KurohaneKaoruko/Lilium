import { useEffect, useRef, useState } from "react";
import { Minus, X, Square, Copy } from "lucide-react";

/**
 * 自绘窗口控制钮 + 拖拽区(桌面端)。
 *
 * - 无系统外框:最小化/最大化/关闭由这里绘制,顶栏收起时一起藏起来
 * - 浏览器/Docker 形态没有窗口控制器 → 不渲染
 * - data-tauri-drag-region 让空白天发系统拖拽移动窗口
 */

type WinControls = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized?: () => Promise<boolean>;
};

function getControls(): WinControls | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (!w.__TAURI_INTERNALS__) return null;
  try {
    // withGlobalTauri=true:api 挂在 window.__TAURI__
    const g = (window as unknown as {
      __TAURI__?: { window?: { getCurrentWindow?: () => WinControls } };
    }).__TAURI__;
    const win = g?.window?.getCurrentWindow?.();
    return win ?? null;
  } catch {
    return null;
  }
}

export default function WindowControls() {
  const [win, setWin] = useState<WinControls | null>(null);
  const [maxed, setMaxed] = useState(false);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    const c = getControls();
    setWin(c);
    if (c?.isMaximized) {
      const check = () => {
        c.isMaximized?.().then(setMaxed).catch(() => {});
      };
      check();
      poll.current = window.setInterval(check, 1500);
    }
    return () => {
      if (poll.current !== null) window.clearInterval(poll.current);
    };
  }, []);

  if (!win) return null;

  const btn =
    "h-full w-11 flex items-center justify-center text-neutral-400 hover:text-white transition-colors";

  return (
    <div className="flex items-center h-full shrink-0" data-tauri-drag-region>
      <button
        className={`${btn} hover:bg-white/10`}
        title="最小化"
        onClick={() => win.minimize().catch(() => {})}
      >
        <Minus size={14} />
      </button>
      <button
        className={`${btn} hover:bg-white/10`}
        title={maxed ? "还原" : "最大化"}
        onClick={() => win.toggleMaximize().catch(() => {})}
      >
        {maxed ? <Copy size={12} className="-scale-x-100" /> : <Square size={11} />}
      </button>
      <button
        className={`${btn} hover:bg-red-500/80 hover:!text-white`}
        title="关闭"
        onClick={() => win.close().catch(() => {})}
      >
        <X size={15} />
      </button>
    </div>
  );
}
