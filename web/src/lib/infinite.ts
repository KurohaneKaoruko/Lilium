/**
 * 无限视图布局引擎 —— 周期点阵封面墙
 *
 * 周期点阵块格结构:
 *   · 基本单位是「块」:12×8 格,12 个槽位由模板**精确铺满**(零缝隙)
 *   · 块的模板由「块在单元(cell)内的位置」决定 → 周期性;单元内再按块坐标哈希
 *     选一种镜像翻转,让墙面读不出网格重复感
 *   · 单元的槽位容量 ≥ 条目数,素材按 `cellSlot % total` 循环取模 → 真无限密铺
 *   · 点击展开某张卡时,该卡变成 6×6,同块其余 11 卡按预计算的 reflow 表
 *     **换挡重排**,块内面积依旧精确铺满 —— 不悬浮、不推开、无级联缝隙
 *
 * 坐标系:块以无限整数坐标寻址(可为负);`ensureCover` 按视口懒生成。
 */

import { TEMPLATES, WALL_REFLOWS, REFLECTION_COUNT, type BlockSlot } from "./wallReflows";

export interface WorldTile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 所在行号(兼容旧接口,= 块行) */
  ring: number;
  /** 块的无限坐标 + 槽位,定位/展开重排的寻址键 */
  blockX: number;
  blockY: number;
  slot: number;
  /** 是否处于展开态(由 ensureCover 重排时标注) */
  expanded?: boolean;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const BLOCK_COLS = 12;
export const BLOCK_ROWS = 8;
export const SLOTS_PER_BLOCK = 12;

/** 单元纵横倾向:>1 时水平方向重复更慢,避免墙面读出横向条纹 */
const FIELD_ASPECT = 2.2;
/** 一个视口最多渲染的实例数(极端缩小时的帧率保护) */
const MAX_RENDERED_INSTANCES = 420;

const mixBlockCoords = (col: number, row: number): number => {
  let v = Math.imul(col, 0x9e3779b1) ^ Math.imul(row, 0x85ebca6b);
  v = Math.imul(v ^ (v >>> 15), 0x2c1b3c6d);
  v ^= v >>> 12;
  return v >>> 0;
};

export interface LatticeGeometry {
  blocksPerRow: number;
  blockRows: number;
  cellSlots: number;
  cellWidth: number;
  cellHeight: number;
  blockWidth: number;
  blockHeight: number;
}

export class MosaicLayout {
  private items: { id: string; aspect: number }[];
  private tiles: WorldTile[] = [];
  private emitted = new Set<string>();
  private geometry: LatticeGeometry;
  private pitch: number;
  private gap: number;
  /** 展开中的实例键 `${blockX}:${blockY}:${slot}`(同时只展开一个) */
  private expandedKey: string | null = null;

  constructor(items: { id: string; aspect: number }[], cellSize = 96, gap = 8) {
    this.items = items;
    this.gap = gap;
    this.pitch = cellSize + gap;
    const blockWidth = BLOCK_COLS * this.pitch;
    const blockHeight = BLOCK_ROWS * this.pitch;
    const n = Math.max(1, items.length);
    const blocks = Math.max(1, Math.ceil(n / SLOTS_PER_BLOCK));
    const blocksPerRow =
      blocks <= 1
        ? 1
        : Math.max(1, Math.round(Math.sqrt((FIELD_ASPECT * blocks * BLOCK_ROWS) / BLOCK_COLS)));
    const blockRows = Math.ceil(blocks / blocksPerRow);
    this.geometry = {
      blocksPerRow,
      blockRows,
      cellSlots: blocksPerRow * blockRows * SLOTS_PER_BLOCK,
      cellWidth: blocksPerRow * blockWidth,
      cellHeight: blockRows * blockHeight,
      blockWidth,
      blockHeight,
    };
  }

  get tileCount() {
    return this.tiles.length;
  }

  allTiles(): WorldTile[] {
    return this.tiles;
  }

  /** 展开某实例(传 null 收起);受影响块的缓存立即失效以便重排 */
  setExpanded(blockX: number, blockY: number, slot: number) {
    const key = `${blockX}:${blockY}:${slot}`;
    if (this.expandedKey === key) return;
    const prev = this.expandedBlock();
    this.expandedKey = key;
    if (prev) this.invalidateBlock(prev.bx, prev.by);
    this.invalidateBlock(blockX, blockY);
  }

  clearExpanded() {
    if (!this.expandedKey) return;
    const prev = this.expandedBlock();
    this.expandedKey = null;
    if (prev) this.invalidateBlock(prev.bx, prev.by);
  }

  private expandedBlock() {
    if (!this.expandedKey) return null;
    const [bx, by] = this.expandedKey.split(":").map(Number);
    return { bx, by };
  }

  /** 丢弃某块已生成的瓦片(展开/收起后矩形全变) */
  private invalidateBlock(bx: number, by: number) {
    this.tiles = this.tiles.filter((t) => !(t.blockX === bx && t.blockY === by));
    for (let s = 0; s < SLOTS_PER_BLOCK; s++) this.emitted.delete(`${bx}:${by}:${s}`);
  }

  /** 块的 [template, mirror]:模板按单元内位置周期选,镜像按坐标哈希选 */
  private blockStyle(bx: number, by: number): { template: number; mirror: number } {
    const g = this.geometry;
    const cellCol = ((bx % g.blocksPerRow) + g.blocksPerRow) % g.blocksPerRow;
    const cellRow = ((by % g.blockRows) + g.blockRows) % g.blockRows;
    const template = (cellCol + cellRow * 2) % TEMPLATES.length;
    const mirror = mixBlockCoords(bx, by) % REFLECTION_COUNT;
    return { template, mirror };
  }

  private orientationOf(bx: number, by: number): number {
    const { template, mirror } = this.blockStyle(bx, by);
    return template * REFLECTION_COUNT + mirror;
  }

  /** 该块/槽位在展开态使用的重排表(无则返回 null) */
  private reflowFor(bx: number, by: number, slot: number): BlockSlot[] | null {
    const { template, mirror } = this.blockStyle(bx, by);
    return WALL_REFLOWS[template]?.[mirror]?.[slot] ?? null;
  }

  /** 展开实例的 hero(6×6)世界矩形中心(同步计算,不依赖 DOM/缓存) */
  heroRect(bx: number, by: number, slot: number): { cx: number; cy: number } | null {
    const layout = this.reflowFor(bx, by, slot);
    if (!layout) return null;
    const s = layout[slot];
    const g = this.geometry;
    return {
      cx: bx * g.blockWidth + (s.x + s.w / 2) * this.pitch,
      cy: by * g.blockHeight + (s.y + s.h / 2) * this.pitch,
    };
  }

  /** 某块的世界中心 */
  blockCenter(bx: number, by: number): { x: number; y: number } {
    const g = this.geometry;
    return { x: bx * g.blockWidth + g.blockWidth / 2, y: by * g.blockHeight + g.blockHeight / 2 };
  }

  /** 一个槽位在普通态的世界矩形 */
  private instanceRect(bx: number, by: number, slot: number) {
    const g = this.geometry;
    const { template } = this.blockStyle(bx, by);
    const s = TEMPLATES[template][slot];
    const x = bx * g.blockWidth + s.x * this.pitch;
    const y = by * g.blockHeight + s.y * this.pitch;
    return { x, y, w: s.w * this.pitch - this.gap, h: s.h * this.pitch - this.gap };
  }

  /** 生成块直到覆盖目标区域;返回与 rect 相交的瓦片(展开块内为重排后的矩形) */
  ensureCover(rect: Rect): WorldTile[] {
    if (this.items.length === 0) return [];
    const g = this.geometry;
    const bx0 = Math.floor((rect.x0 - 200) / g.blockWidth) - 1;
    const bx1 = Math.floor((rect.x1 + 200) / g.blockWidth) + 1;
    const by0 = Math.floor((rect.y0 - 200) / g.blockHeight) - 1;
    const by1 = Math.floor((rect.y1 + 200) / g.blockHeight) + 1;

    // 实例数保护(极端缩小)
    const want = (bx1 - bx0 + 1) * (by1 - by0 + 1) * SLOTS_PER_BLOCK;
    let sx = 0;
    let sy = 0;
    let ex = 0;
    let ey = 0;
    if (want > MAX_RENDERED_INSTANCES) {
      // 以视口中心向外裁剪块范围
      const cx = (rect.x0 + rect.x1) / 2;
      const cy = (rect.y0 + rect.y1) / 2;
      const cbx = Math.floor(cx / g.blockWidth);
      const cby = Math.floor(cy / g.blockHeight);
      const maxBlocks = Math.max(1, Math.floor(MAX_RENDERED_INSTANCES / SLOTS_PER_BLOCK));
      const half = Math.max(1, Math.floor(Math.sqrt(maxBlocks) / 2));
      sx = Math.max(bx0, cbx - half);
      ex = Math.min(bx1, cbx + half);
      sy = Math.max(by0, cby - half);
      ey = Math.min(by1, cby + half);
    } else {
      sx = bx0;
      ex = bx1;
      sy = by0;
      ey = by1;
    }

    for (let by = sy; by <= ey; by++) {
      for (let bx = sx; bx <= ex; bx++) {
        // 展开块:emit 重排后的 12 槽;普通块:emit 模板 12 槽
        const isExpandedBlock = this.expandedKey?.startsWith(`${bx}:${by}:`) ?? false;
        const expSlot = isExpandedBlock ? Number(this.expandedKey!.split(":")[2]) : -1;
        const layout = isExpandedBlock ? this.reflowFor(bx, by, expSlot) : null;
        for (let slot = 0; slot < SLOTS_PER_BLOCK; slot++) {
          const key = `${bx}:${by}:${slot}`;
          if (this.emitted.has(key)) continue;
          const cellSlot =
            ((((by % this.geometry.blockRows) + this.geometry.blockRows) % this.geometry.blockRows) *
              this.geometry.blocksPerRow +
              (((bx % this.geometry.blocksPerRow) + this.geometry.blocksPerRow) % this.geometry.blocksPerRow)) *
            SLOTS_PER_BLOCK +
            slot;
          const id = this.items[cellSlot % this.items.length].id;
          let r: { x: number; y: number; w: number; h: number };
          let expanded = false;
          if (layout) {
            const s = layout[slot];
            r = {
              x: bx * g.blockWidth + s.x * this.pitch,
              y: by * g.blockHeight + s.y * this.pitch,
              w: s.w * this.pitch - this.gap,
              h: s.h * this.pitch - this.gap,
            };
            expanded = slot === expSlot;
          } else {
            r = this.instanceRect(bx, by, slot);
          }
          this.emitted.add(key);
          this.tiles.push({ id, ...r, ring: by, blockX: bx, blockY: by, slot, expanded });
        }
      }
    }
    return this.tilesIn(rect);
  }

  /** 与 rect 相交的已生成瓦片 */
  tilesIn(rect: Rect): WorldTile[] {
    const out: WorldTile[] = [];
    for (const t of this.tiles) {
      if (t.x < rect.x1 && t.x + t.w > rect.x0 && t.y < rect.y1 && t.y + t.h > rect.y0) {
        out.push(t);
      }
    }
    return out;
  }

  /** 全库范围找某条目的代表性实例(用于步进定位) */
  findTile(id: string): WorldTile | null {
    for (const t of this.tiles) if (t.id === id) return t;
    return null;
  }
}

export function buildMosaic(items: { id: string; aspect: number }[]): MosaicLayout {
  return new MosaicLayout(items);
}
