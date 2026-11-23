/**
 * Tauri 桌面端原生对话框。
 * 浏览器（自托管 Web）没有文件系统路径权限，调用方需要保留手动输入路径的方式。
 */
export function isDesktopApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function invokeFn(): Invoke | undefined {
  return window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
}

async function openDialog(options: Record<string, unknown>): Promise<string | string[] | null> {
  const invoke = invokeFn();
  if (!invoke || !isDesktopApp()) return null;
  return (await invoke("plugin:dialog|open", { options })) as string | string[] | null;
}

/** 选择单个目录，返回绝对路径；浏览器或取消时返回 null。 */
export async function pickDirectory(title: string): Promise<string | null> {
  const result = await openDialog({ title, directory: true, multiple: false });
  return typeof result === "string" && result ? result : null;
}

/** 选择多个文件，返回绝对路径列表。 */
export async function pickFilePaths(title: string): Promise<string[]> {
  const result = await openDialog({ title, directory: false, multiple: true });
  if (Array.isArray(result)) return result.filter((path): path is string => typeof path === "string" && !!path);
  return typeof result === "string" && result ? [result] : [];
}

/** 把多个路径合并进现有的逗号分隔输入。 */
export function appendPaths(current: string, paths: string | string[]) {
  const additions = (Array.isArray(paths) ? paths : [paths]).map((path) => path.trim()).filter(Boolean);
  const existing = current.trim();
  if (!additions.length) return current;
  return existing ? `${existing}, ${additions.join(", ")}` : additions.join(", ");
}
