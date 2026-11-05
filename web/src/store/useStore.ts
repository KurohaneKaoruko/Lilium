import { create } from "zustand";
import { api, type Folder, type Item, type LibraryInfo, type SmartFolder, type Tag } from "../api/client";

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
  /** 沉浸视图:左侧完整侧栏是否张开(收起 = 48px 图标轨);顶栏固定常驻 */
  chromeLeft: boolean;
  /** 指针正悬停在悬浮面板上(阻止自动收起) */
  chromeHovering: boolean;
  setChromeLeft: (v: boolean) => void;
  zoom: number; // grid 尺寸 / masonry 列宽 / infinite 初始视野
  sort: SortKey;
  asc: boolean;

  items: Item[];
  total: number;
  loading: boolean;
  querySeq: number;
  randomSeed: number;

  selection: Set<string>;
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
  resetFilters: () => void;
  setView: (v: ViewMode) => void;
  setZoom: (z: number) => void;
  setSort: (s: SortKey, asc?: boolean) => void;
  select: (id: string, mode: "set" | "toggle" | "range" | "add") => void;
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

export const useStore = create<State>((set, get) => ({
  info: null,
  folders: [],
  tags: [],
  smartFolders: [],

  filters: { ...defaultFilters },
  view: "infinite",
  chromeLeft: false,
  chromeHovering: false,
  zoom: 240,
  sort: "addedAt",
  asc: false,

  items: [],
  total: 0,
  loading: false,
  querySeq: 0,
  randomSeed: 1,

  selection: new Set(),
  anchorId: null,
  detailId: null,
  lightboxId: null,
  similarIds: null,

  refreshMeta: async () => {
    const [info, folders, tags, smartFolders] = await Promise.all([
      api<LibraryInfo>("/info"),
      api<Folder[]>("/folders"),
      api<Tag[]>("/tags"),
      api<SmartFolder[]>("/smart-folders"),
    ]);
    set({ info, folders, tags, smartFolders });
  },

  fetchItems: async (append = false) => {
    const st = get();
    const mySeq = ++seq;
    set({ loading: true });
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
      if (f.q) params.set("q", f.q);
      if (f.trash) params.set("trash", "true");
      if (f.untagged) params.set("untagged", "true");
      if (f.unfiled) params.set("unfiled", "true");
      params.set("sort", st.sort);
      params.set("asc", String(st.asc));
      const offset = append ? st.items.length : 0;
      params.set("offset", String(offset));
      params.set("limit", "200");
      // 随机排序：每次全新查询换种子（洗牌），追加加载沿用当前种子保证分页连续
      if (st.sort === "random") {
        params.set("seed", append ? String(st.randomSeed) : String(Date.now() % 100000000));
        if (!append) set({ randomSeed: Date.now() % 100000000 });
      }

      const res = await api<{ items: Item[]; total: number }>(`/items?${params}`);
      if (mySeq !== seq) return; // 过期响应
      set({
        items: append ? [...st.items, ...res.items] : res.items,
        total: res.total,
        loading: false,
      });
    } catch (e) {
      if (mySeq === seq) set({ loading: false });
      console.error(e);
    }
  },

  loadMore: async () => {
    const { items, total, loading } = get();
    if (loading || items.length >= total) return;
    await get().fetchItems(true);
  },

  setFilters: (f) => {
    set({
      filters: { ...get().filters, ...f },
      selection: new Set(),
      items: f.smartId !== undefined || Object.keys(f).some((k) => k !== "smartId") ? get().items : get().items,
    });
    get().fetchItems();
  },

  resetFilters: () => {
    set({ filters: { ...defaultFilters }, selection: new Set() });
    get().fetchItems();
  },

  setView: (v) => set({ view: v }),
  setChromeLeft: (v) => set({ chromeLeft: v }),
  setZoom: (z) => set({ zoom: Math.max(80, Math.min(560, z)) }),
  setSort: (s, asc) => {
    set({ sort: s, asc: asc ?? get().asc });
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

  selectAll: () => set({ selection: new Set(get().items.map((i) => i.id)) }),
  clearSelection: () => set({ selection: new Set() }),
  setDetail: (id) => set({ detailId: id }),
  setLightbox: (id) => set({ lightboxId: id }),

  showSimilar: async (id) => {
    try {
      const res = await api<{ items: Item[] }>(`/items/${id}/similar`);
      set({
        similarIds: res.items.map((i) => i.id),
        items: res.items,
        total: res.items.length,
        selection: new Set(),
      });
    } catch (e) {
      console.error(e);
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
    const items = get().items.filter((i) => i.id !== id);
    const sel = new Set(get().selection);
    sel.delete(id);
    set({ items, total: Math.max(0, get().total - 1), selection: sel });
  },
}));
