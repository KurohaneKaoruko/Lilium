import { api, type Item } from "../api/client";
import { useStore } from "../store/useStore";
import { notify, reportError } from "./feedback";

export async function importFiles(files: File[]) {
  if (!files.length || useStore.getState().importing) return;
  const { filters, refreshMeta, fetchItems } = useStore.getState();
  useStore.setState({ importing: true });
  try {
    const body = new FormData();
    if (filters.folderId && !filters.trash) body.append("folderId", filters.folderId);
    for (const file of files) body.append("files", file, file.name);
    const { items, errors } = await api<{ items: Item[]; errors: string[] }>("/import/upload", { method: "POST", body });
    if (items.length) await Promise.all([refreshMeta(), fetchItems()]);
    if (errors.length) {
      notify(`已导入 ${items.length} 项，${errors.length} 项未导入：${errors[0]}`, items.length ? "info" : "error");
    } else {
      notify(`已导入 ${items.length.toLocaleString()} 项素材`);
    }
  } catch (error) {
    reportError("导入失败", error);
  } finally {
    useStore.setState({ importing: false });
  }
}
