export interface Item {
  id: string;
  name: string;
  ext: string;
  kind: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  rating: number;
  note: string;
  url: string;
  folderId: string | null;
  trash: boolean;
  addedAt: number;
  createdAt: number;
  thumb: number;
  r: number | null;
  g: number | null;
  b: number | null;
  palette: PaletteEntry[] | null;
  tags: string[];
  hash?: string | null;
  phash?: string | null;
}

export interface PaletteEntry {
  color: string;
  weight: number;
}

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
}

export interface Tag {
  name: string;
  color: string;
  count: number;
}

export interface SmartFolder {
  id: string;
  name: string;
  query: Record<string, unknown>;
  position: number;
}

export interface LibraryInfo {
  name: string;
  path: string;
  itemCount: number;
  totalSize: number;
  tagCount: number;
  folderCount: number;
}

export interface Exif {
  [key: string]: string;
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}/api${path}`, {
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/**
 * API 基地址：
 * - 浏览器 / 自托管：空字符串（同源，经 vite 代理或直接由 Axum 托管）
 * - Tauri 桌面端：由 get_api_base() 注入（内嵌服务，端口可能动态分配）
 */
declare global {
  interface Window {
    __LILIUM_API__?: string;
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: {
      core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

let cachedBase: string | null = null;

export function apiBase(): string {
  if (cachedBase !== null) return cachedBase;
  if (window.__LILIUM_API__ !== undefined) {
    cachedBase = window.__LILIUM_API__;
    return cachedBase;
  }
  return "";
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

/**
 * Tauri 桌面端初始化：从 Rust 侧取内嵌 API 地址。
 * 内嵌服务在后台线程启动，可能晚于窗口加载 → 带重试。
 */
export async function initDesktopApi(retries = 20, delayMs = 300): Promise<boolean> {
  if (!isDesktop()) return false;
  const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
  if (!invoke) return false;
  for (let i = 0; i < retries; i++) {
    try {
      const base = (await invoke("get_api_base")) as string;
      cachedBase = base;
      window.__LILIUM_API__ = base;
      // 服务就绪才返回（info 探测通过）
      const res = await fetch(`${base}/api/info`);
      if (res.ok) return true;
    } catch {
      /* 下一次重试 */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

export const thumbUrl = (id: string) => `${apiBase()}/api/thumbs/${id}`;
export const fileUrl = (id: string) => `${apiBase()}/api/items/${id}/file`;

export function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${bytes} B` : `${v.toFixed(1)} ${units[i]}`;
}

export function fmtDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function itemAspectRatio(it: Item): number {
  if (it.width && it.height && it.height > 0) return it.width / it.height;
  return 1;
}
