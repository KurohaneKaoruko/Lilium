/**
 * 无限视图封面墙拼贴布局引擎
 *
 * 以「环带」方式向外螺旋生长：
 *   第 0 环：首图置于原点
 *   第 n 环：沿当前包围盒的上/右/下/左边缘铺一条图片带，
 *           带厚由图片纵横比自然形成，错落有致。
 * 这样包围盒向四个方向持续扩张 —— 无论向哪个方向平移，
 * 都能按需生成更多图片带，实现真正的无限画布。
 *
 * 布局确定性：只依赖条目顺序。
 */

export interface WorldTile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ring: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const GAP = 14; // 世界坐标间距
const BASE_HEIGHTS = [190, 230, 270]; // 每条带的目标厚度（带内图片等高）
const TARGET_SPAN = 1500; // 每条带的目标长度

export class MosaicLayout {
  private items: { id: string; aspect: number }[];
  private rings: WorldTile[][] = [];
  private bounds: Rect | null = null;
  private cursor = 0;
  private totalTiles = 0;

  constructor(items: { id: string; aspect: number }[]) {
    this.items = items;
    this.seed();
  }

  get tileCount() {
    return this.totalTiles;
  }

  get currentBounds(): Rect | null {
    return this.bounds;
  }

  private seed() {
    if (this.items.length === 0 || this.bounds) return;
    const first = this.items[0];
    const h = 260;
    const w = h * first.aspect;
    const tile: WorldTile = { id: first.id, x: -w / 2, y: -h / 2, w, h, ring: 0 };
    this.rings.push([tile]);
    this.bounds = { x0: tile.x, y0: tile.y, x1: tile.x + w, y1: tile.y + h };
    this.cursor = 1;
    this.totalTiles = 1;
  }

  /** 生成环带直到包围盒完全覆盖目标区域（或条目用尽） */
  ensureCover(rect: Rect): WorldTile[] {
    this.seed();
    if (!this.bounds) return [];
    let guard = 0;
    while (
      this.cursor < this.items.length &&
      (this.bounds.x0 > rect.x0 - 200 ||
        this.bounds.y0 > rect.y0 - 200 ||
        this.bounds.x1 < rect.x1 + 200 ||
        this.bounds.y1 < rect.y1 + 200)
    ) {
      if (guard++ > 4000) break;
      this.growRing();
    }
    return this.tilesIn(rect);
  }

  /** 覆盖 rect 的所有已生成瓦片 */
  tilesIn(rect: Rect): WorldTile[] {
    const out: WorldTile[] = [];
    for (const ring of this.rings) {
      for (const t of ring) {
        if (t.x < rect.x1 && t.x + t.w > rect.x0 && t.y < rect.y1 && t.y + t.h > rect.y0) {
          out.push(t);
        }
      }
    }
    return out;
  }

  allTiles(): WorldTile[] {
    const out: WorldTile[] = [];
    for (const r of this.rings) out.push(...r);
    return out;
  }

  /** 沿包围盒一条边生成一条图片带，并扩张包围盒 */
  private growRing() {
    if (!this.bounds) return;
    const ringIndex = this.rings.length;
    const side = (ringIndex - 1 + 4) % 4; // 0上 1右 2下 3左
    const b = this.bounds;

    const horizontal = side === 0 || side === 2;
    const targetSpan = horizontal ? b.x1 - b.x0 : b.y1 - b.y0;
    const span = Math.max(targetSpan, 600);

    // 取条目直到铺满目标长度
    const picked: { id: string; aspect: number }[] = [];
    let acc = 0;
    while (this.cursor < this.items.length && acc < span) {
      const it = this.items[this.cursor];
      picked.push(it);
      acc += BASE_HEIGHTS[0] * Math.max(0.3, Math.min(2.6, it.aspect));
      this.cursor++;
    }
    if (picked.length === 0) return;

    // 带厚度：取平均 aspect 对应合理高度，带间轻微交替制造错落
    const avgAspect =
      picked.reduce((s, p) => s + Math.max(0.35, Math.min(2.4, p.aspect)), 0) / picked.length;
    const thickness = Math.max(
      130,
      Math.min(320, Math.round((span / (picked.length * avgAspect)) * (ringIndex % 2 === 0 ? 1.0 : 0.86))),
    );

    const tiles: WorldTile[] = [];
    if (horizontal) {
      let x = b.x0;
      const y = side === 0 ? b.y0 - thickness - GAP : b.y1 + GAP;
      for (const p of picked) {
        const w = Math.round(thickness * Math.max(0.3, Math.min(2.6, p.aspect)));
        tiles.push({ id: p.id, x, y, w, h: thickness, ring: ringIndex });
        x += w + GAP;
      }
      const newY0 = Math.min(b.y0, y);
      const newY1 = Math.max(b.y1, y + thickness);
      const newX1 = Math.max(b.x1, x - GAP);
      this.bounds = { x0: b.x0, y0: newY0, x1: newX1, y1: newY1 };
    } else {
      let y = b.y0;
      const x = side === 3 ? b.x0 - thickness - GAP : b.x1 + GAP;
      for (const p of picked) {
        const h = Math.round(thickness * Math.max(0.3, Math.min(2.6, p.aspect)));
        // 竖直条带：宽度统一为带厚，高度按纵横比
        const w = thickness;
        tiles.push({ id: p.id, x, y, w, h, ring: ringIndex });
        y += h + GAP;
      }
      const newX0 = Math.min(b.x0, x);
      const newX1 = Math.max(b.x1, x + thickness);
      const newY1 = Math.max(b.y1, y - GAP);
      this.bounds = { x0: newX0, y0: b.y0, x1: newX1, y1: newY1 };
    }
    this.rings.push(tiles);
    this.totalTiles += tiles.length;
  }

  /** 世界坐标原点（首图中心） */
  get origin(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
}

export function buildMosaic(items: { id: string; aspect: number }[]): MosaicLayout {
  return new MosaicLayout(items);
}
