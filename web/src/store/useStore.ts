import { create } from "zustand";
import { api, type Folder, type Item, type LibraryInfo, type SmartFolder, type Tag } from "../api/client";
import { reportError } from "../lib/feedback";

export type ViewMode = "grid" | "masonry" | "list" | "infinite" | "collections";
export type SortKey = "addedAt" | "createdAt" | "name" | "size" | "width" | "height" | "rating" | "duration" | "random";

export interface Filters {
  folderId: string | null;
  recursive: boolean;
  tag: string | null;
  kinds: string[];
  ratingMin: number;
  /** 评分上限（0/5 = 不设上界） */
  ratingMax: number;
  color: string | null;
  colorTolerance: number;
  q: string;
  trash: boolean;
  smartId: string | null;
  untagged: boolean;
  unfiled: boolean;
  /** 添加时间区间（毫秒时间戳，含边界；0 = 不设界） */
  addedFrom: number;
  addedTo: number;
  /** 拍摄/创建时间区间（毫秒时间戳，含边界；0 = 不设界） */
  createdFrom: number;
  createdTo: number;
  /** 否定标签：排除含任一这些标签的条目 */
  notTags: string[];
}

interface State {
  info: LibraryInfo | null;
  folders: Folder[];
  tags: Tag[];
  smartFolders: SmartFolder[];

  filters: Filters;
  view: ViewMode;
  zoom: number; // grid / masonry thumbnail size
  sort: SortKey;
  asc: boolean;

  items: Item[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  importing: boolean;
  error: string | null;
  pageError: string | null;
  metaError: string | null;
  querySeq: number;
  randomSeed: number;

  selection: Set<string>;
  selectionMode: boolean;
  anchorId: string | null;
  detailId: string | null;
  lightboxId: string | null;
  /** 相似图片模式：显示这些 id 而非常规查询 */
  similarIds: string[] | null;

  // actions
  refreshMeta: () => Promise<void>;
  fetchItems: (append?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  setFilters: (f: Partial<Filters>) => void;
  setSearch: (q: string, immediate?: boolean) => void;
  resetFilters: () => void;
  resetLibrary: () => Promise<void>;
  setView: (v: ViewMode) => void;
  setZoom: (z: number) => void;
  setSort: (s: SortKey, asc?: boolean) => void;
  select: (id: string, mode: "set" | "toggle" | "range" | "add") => void;
  setSelectionMode: (enabled: boolean) => void;
  selectMany: (ids: string[]) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setDetail: (id: string | null) => void;
  setLightbox: (id: string | null) => void;
  showSimilar: (id: string) => Promise<void>;
  exitSimilar: () => void;
  patchItemLocal: (id: string, patch: Partial<Item>) => void;
  removeItemLocal: (id: string) => void;
}

export const defaultFilters: Filters = {
  folderId: null,
  recursive: true,
  tag: null,
  kinds: [],
  ratingMin: 0,
  ratingMax: 0,
  color: null,
  colorTolerance: 60,
  q: "",
  trash: false,
  smartId: null,
  untagged: false,
  unfiled: false,
  addedFrom: 0,
  addedTo: 0,
  createdFrom: 0,
  createdTo: 0,
  notTags: [],
};

export const THUMBNAIL_MIN = 110;
export const THUMBNAIL_MAX = 420;
export const THUMBNAIL_DEFAULT = 208;

/**
 * 应用智能文件夹保存的查询到当前筛选（保持筛选器其余部分不动）。
 * 旧库 query JSON 缺少新字段时回落默认值（不迁移、不报错、未知字段忽略）——
 * 保证「旧智能文件夹点开后」不会带上上次会话遗留的新字段值。
 */
export function filtersFromQuery(query: Record<string, unknown> | null | undefined): Partial<Filters> {
  const q = (query ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  const strArr = (v: unknown): string[] => {
    if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    return [];
  };
  return {
    folderId: typeof q.folderId === "string" && q.folderId ? q.folderId : null,
    recursive: q.recursive === undefined ? true : Boolean(q.recursive),
    tag: typeof q.tag === "string" && q.tag ? q.tag : null,
    kinds: strArr(q.kinds),
    ratingMin: Math.min(5, Math.max(0, num(q.ratingMin))),
    ratingMax: Math.min(5, Math.max(0, num(q.ratingMax))),
    color: typeof q.color === "string" && q.color ? q.color : null,
    colorTolerance: num(q.colorTolerance) || 60,
    q: typeof q.q === "string" ? q.q : "",
    trash: Boolean(q.trash),
    untagged: Boolean(q.untagged),
    unfiled: Boolean(q.unfiled),
    addedFrom: num(q.addedFrom),
    addedTo: num(q.addedTo),
    createdFrom: num(q.createdFrom),
    createdTo: num(q.createdTo),
    notTags: strArr(q.notTags),
  };
}

let seq = 0;
let metaSeq = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let itemRequest: AbortController | undefined;
const preferenceKey = "lilium.workspace.preferences";
const validViews: ViewMode[] = ["grid", "masonry", "list", "infinite", "collections"];
const validSorts: SortKey[] = ["addedAt", "createdAt", "name", "size", "width", "height", "rating", "duration", "random"];
type WorkspacePreferences = Pick<State, "view" | "zoom" | "sort" | "asc">;
const clampThumbnailSize = (zoom: number) => Math.round(Math.max(THUMBNAIL_MIN, Math.min(THUMBNAIL_MAX, zoom)));

function readWorkspacePreferences(): Partial<WorkspacePreferences> {
  try {
    const parsed = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}") as Partial<WorkspacePreferences> | null;
    if (!parsed) return {};
    return {
      view: parsed.view && validViews.includes(parsed.view) ? parsed.view : undefined,
      zoom: typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom) ? clampThumbnailSize(parsed.zoom) : undefined,
      sort: parsed.sort && validSorts.includes(parsed.sort) ? parsed.sort : undefined,
      asc: typeof parsed.asc === "boolean" ? parsed.asc : undefined,
    };
  } catch { return {}; }
}
const preferences = typeof window === "undefined" ? {} : readWorkspacePreferences();
function nextItemRequest() {
  itemRequest?.abort();
  itemRequest = new AbortController();
  return itemRequest;
}
const emptySelection = () => ({ selection: new Set<string>(), anchorId: null });
const selectionAndPanels = () => ({ ...emptySelection(), selectionMode: false, lightboxId: null, detailId: null });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export const useStore = create<State>((set, get) => ({
  info: null,
  folders: [],
  tags: [],
  smartFolders: [],

  filters: { ...defaultFilters },
  view: preferences.view ?? "infinite",
  zoom: preferences.zoom ?? THUMBNAIL_DEFAULT,
  sort: preferences.sort ?? "addedAt",
  asc: preferences.asc ?? false,

  items: [],
  total: 0,
  loading: true,
  loadingMore: false,
  importing: false,
  error: null,
  pageError: null,
  metaError: null,
  querySeq: 0,
  randomSeed: 1,

  selection: new Set(),
  selectionMode: false,
  anchorId: null,
  detailId: null,
  lightboxId: null,
  similarIds: null,

  refreshMeta: async () => {
    const mySeq = ++metaSeq;
    try {
      const [info, folders, tags, smartFolders] = await Promise.all([
        api<LibraryInfo>("/info"), api<Folder[]>("/folders"),
        api<Tag[]>("/tags"), api<SmartFolder[]>("/smart-folders"),
      ]);
      if (mySeq === metaSeq) set({ info, folders, tags, smartFolders, metaError: null });
    } catch (error) {
      if (mySeq === metaSeq) set({ metaError: errorMessage(error) });
    }
  },

  fetchItems: async (append = false) => {
    const st = get();
    if (append && (st.loading || st.loadingMore || st.items.length >= st.total || st.similarIds)) return;
    clearTimeout(searchTimer);
    const mySeq = ++seq;
    const request = nextItemRequest();
    const randomSeed = append || st.sort !== "random" ? st.randomSeed : Date.now() % 100000000;
    set(append ? { loadingMore: true, pageError: null } : {
      loading: true, loadingMore: false, error: null, pageError: null, similarIds: null,
      querySeq: st.querySeq + 1, randomSeed,
    });
    try {
      const f = st.filters;
      const params = new URLSearchParams();
      if (f.folderId) params.set("folderId", f.folderId);
      params.set("recursive", String(f.recursive));
      if (f.tag) params.set("tag", f.tag);
      if (f.kinds.length) f.kinds.forEach((k) => params.append("kinds", k));
      if (f.ratingMin > 0) params.set("ratingMin", String(f.ratingMin));
      if (f.ratingMax > 0 && f.ratingMax < 5) params.set("ratingMax", String(f.ratingMax));
      if (f.addedFrom > 0) params.set("addedFrom", String(f.addedFrom));
      if (f.addedTo > 0) params.set("addedTo", String(f.addedTo));
      if (f.createdFrom > 0) params.set("createdFrom", String(f.createdFrom));
      if (f.createdTo > 0) params.set("createdTo", String(f.createdTo));
      f.notTags.forEach((t) => params.append("notTags", t));
      if (f.color) {
        params.set("color", f.color);
        params.set("colorTolerance", String(f.colorTolerance));
      }
      if (f.q.trim()) params.set("q", f.q.trim());
      if (f.trash) params.set("trash", "true");
      if (f.untagged) params.set("untagged", "true");
      if (f.unfiled) params.set("unfiled", "true");
      params.set("sort", st.sort);
      params.set("asc", String(st.asc));
      const offset = append ? st.items.length : 0;
      params.set("offset", String(offset));
      params.set("limit", "200");
      // 随机排序：每次全新查询换种子（洗牌），追加加载沿用当前种子保证分页连续
      if (st.sort === "random") params.set("seed", String(randomSeed));

      const res = await api<{ items: Item[]; total: number }>(`/items?${params}`, { signal: request.signal });
      if (mySeq !== seq) return; // 过期响应
      const current = get();
      if (append) {
        const loaded = new Set(current.items.map((item) => item.id));
        const next = res.items.filter((item) => !loaded.has(item.id));
        set({ items: [...current.items, ...next], total: res.total, loadingMore: false,
          pageError: next.length ? null : "素材列表已变化，请刷新后重试" });
      } else {
        const valid = new Set(res.items.map((item) => item.id));
        set({ items: res.items, total: res.total, loading: false,
          selectionMode: !!res.items.length && current.selectionMode,
          selection: new Set([...current.selection].filter((id) => valid.has(id))),
          anchorId: current.anchorId && valid.has(current.anchorId) ? current.anchorId : null,
          detailId: current.detailId && valid.has(current.detailId) ? current.detailId : null,
          lightboxId: current.lightboxId && valid.has(current.lightboxId) ? current.lightboxId : null });
      }
    } catch (error) {
      if (mySeq !== seq) return;
      set(append ? { loadingMore: false, pageError: errorMessage(error) } : {
        items: [], total: 0, loading: false, error: errorMessage(error), ...selectionAndPanels(),
      });
    }
  },

  loadMore: async () => {
    await get().fetchItems(true);
  },

  setFilters: (f) => {
    set({ filters: { ...get().filters, ...f }, ...selectionAndPanels() });
    get().fetchItems();
  },

  setSearch: (q, immediate = false) => {
    const st = get();
    if (q === st.filters.q && !immediate) return;
    clearTimeout(searchTimer);
    seq++;
    itemRequest?.abort();
    set({ filters: { ...st.filters, q }, view: st.view === "collections" && q.trim() ? "masonry" : st.view,
      loading: true, loadingMore: false, error: null,
      pageError: null, similarIds: null, ...selectionAndPanels() });
    if (immediate) get().fetchItems();
    else searchTimer = setTimeout(() => get().fetchItems(), 280);
  },

  resetFilters: () => get().setFilters(defaultFilters),

  resetLibrary: async () => {
    set({ filters: { ...defaultFilters }, info: null, folders: [], tags: [], smartFolders: [],
      items: [], total: 0, metaError: null, ...selectionAndPanels() });
    await Promise.all([get().refreshMeta(), get().fetchItems()]);
  },

  setView: (view) => {
    if (view === get().view) return;
    set(view === "collections" ? { view, ...selectionAndPanels() } : { view });
  },
  setZoom: (zoom) => { if (Number.isFinite(zoom)) set({ zoom: clampThumbnailSize(zoom) }); },
  setSort: (s, asc) => {
    const st = get();
    const next = asc ?? st.asc;
    if (s === st.sort && next === st.asc && s !== "random") return;
    set({ sort: s, asc: next });
    get().fetchItems();
  },

  select: (id, mode) => {
    const { selection, items, anchorId } = get();
    if (mode === "set") {
      set({ selection: new Set([id]), anchorId: id });
      return;
    }
    if (mode === "toggle" || mode === "add") {
      const next = new Set(selection);
      if (next.has(id) && mode === "toggle") next.delete(id);
      else next.add(id);
      set({ selection: next, anchorId: id });
      return;
    }
    // range
    const a = items.findIndex((i) => i.id === anchorId);
    const b = items.findIndex((i) => i.id === id);
    if (a < 0 || b < 0) {
      set({ selection: new Set([id]), anchorId: id });
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const next = new Set(selection);
    for (let i = lo; i <= hi; i++) next.add(items[i].id);
    set({ selection: next });
  },

  setSelectionMode: (enabled) => {
    const st = get();
    if (enabled === st.selectionMode || (enabled && (st.loading || !st.items.length || st.view === "collections"))) return;
    set(enabled ? { selectionMode: true, detailId: null } : { selectionMode: false, ...emptySelection() });
  },
  selectAll: () => set({ selection: new Set(get().items.map((i) => i.id)) }),
  selectMany: (ids) => set({ selection: new Set(ids), anchorId: ids[0] ?? null }),
  clearSelection: () => set(emptySelection()),
  setDetail: (id) => set({ detailId: id }),
  setLightbox: (id) => set({ lightboxId: id }),

  showSimilar: async (id) => {
    clearTimeout(searchTimer);
    const mySeq = ++seq;
    const request = nextItemRequest();
    set({ loading: true, loadingMore: false, error: null, pageError: null });
    try {
      const res = await api<{ items: Item[] }>(`/items/${id}/similar`, { signal: request.signal });
      if (mySeq !== seq) return;
      set({
        similarIds: res.items.map((i) => i.id),
        querySeq: get().querySeq + 1,
        items: res.items,
        total: res.items.length,
        loading: false,
        ...selectionAndPanels(),
      });
    } catch (error) {
      if (mySeq !== seq) return;
      set({ loading: false });
      reportError("无法查找相似素材", error);
    }
  },

  exitSimilar: () => {
    set({ similarIds: null });
    get().fetchItems();
  },

  patchItemLocal: (id, patch) =>
    set({
      items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }),

  removeItemLocal: (id) => {
    const st = get();
    const items = st.items.filter((i) => i.id !== id);
    const selection = new Set(st.selection);
    selection.delete(id);
    set({ items, total: Math.max(0, st.total - (st.items.length - items.length)), selection,
      similarIds: st.similarIds?.filter((itemId) => itemId !== id) ?? null,
      detailId: st.detailId === id ? null : st.detailId, lightboxId: st.lightboxId === id ? null : st.lightboxId,
      anchorId: st.anchorId === id ? null : st.anchorId });
  },
}));

useStore.subscribe(({ view, zoom, sort, asc }, previous) => {
  if (view === previous.view && zoom === previous.zoom && sort === previous.sort && asc === previous.asc) return;
  try { localStorage.setItem(preferenceKey, JSON.stringify({ view, zoom, sort, asc })); }
  catch { /* Storage may be unavailable; the current session still works. */ }
});
