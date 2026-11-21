import { Grid2X2, Infinity as InfinityIcon, LayoutGrid, List, Shapes, type LucideIcon } from "lucide-react";
import type { Filters, SortKey, ViewMode } from "../store/useStore";

export const KINDS = {
  image: "图片", video: "视频", audio: "音频", font: "字体", document: "文档", other: "其他",
};

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "addedAt", label: "添加时间" }, { key: "createdAt", label: "拍摄 / 创建时间" },
  { key: "name", label: "名称" }, { key: "size", label: "文件大小" },
  { key: "width", label: "宽度" }, { key: "height", label: "高度" },
  { key: "rating", label: "评分" }, { key: "duration", label: "时长" }, { key: "random", label: "随机" },
];

export const VIEWS: { key: ViewMode; icon: LucideIcon; label: string }[] = [
  { key: "masonry", icon: LayoutGrid, label: "瀑布流" }, { key: "grid", icon: Grid2X2, label: "网格" },
  { key: "list", icon: List, label: "列表" }, { key: "infinite", icon: InfinityIcon, label: "无限视图" },
  { key: "collections", icon: Shapes, label: "分类墙" },
];

export const formatCount = (count: number) => count.toLocaleString("zh-CN");

export const shortcutMod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export function isCommandShortcut(event: KeyboardEvent) {
  return !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && !event.altKey && !event.shiftKey
    && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
}

export function advancedFilterCount(filters: Filters) {
  return Number(filters.ratingMin > 0 || (filters.ratingMax > 0 && filters.ratingMax < 5))
    + Number(filters.addedFrom > 0 || filters.addedTo > 0)
    + Number(filters.createdFrom > 0 || filters.createdTo > 0)
    + Number(filters.notTags.length > 0);
}

export function isShortcutScope(event: KeyboardEvent) {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229
    || Boolean(document.querySelector("dialog[open]"))
    || (event.target instanceof HTMLElement && (event.target.isContentEditable
      || Boolean(event.target.closest("input, textarea, select, [data-shortcut-scope]"))));
}
