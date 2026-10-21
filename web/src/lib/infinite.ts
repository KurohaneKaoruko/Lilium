/**
 * 无限视图布局引擎 —— 两端对齐（justified）整行密铺
 *
 * 结构：
 *   行 r（整数，可正可负）是一根全宽水平条带：
 *     · 行内所有图片等高（h 随行号伪随机，制造错落）
 *     · 行宽在两个方向上无限延伸（素材按取模循环，周期性拼接）
 *   行从 y=0 向上、向下依次无缝堆叠（y(r+1) = y(r) + h(r) + GAP）
 *
 * 关键性质：
 *   · 任意行在任意 x 区间都能确定性生成 → 整屏永远铺满，零空洞
 *   · 布局只依赖条目顺序，平移/缩放过程中位置稳定不跳变
 *   · 同一张图可重复出现（与参考实现一致的循环平铺）
 */

export interface WorldTile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 所在行号 */
  ring: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const GAP = 8; // 世界坐标间距
const ROW_MIN = 190; // 行高下限
const ROW_MAX = 310; // 行高上限
const SEG_MIN = 6; // 每行周期最少素材数
const SEG_VAR = 4; // 周期素材数浮动（6..9）
const ASPECT_MIN = 0.32; // 宽度按纵横比取值时的下限（极端图轻微裁切）
const ASPECT_MAX = 2.6;

const fract = (x: number) => x - Math.floor(x);
/** 确定性伪随机（0..1） */
const hash01 = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

/** 一行周期的素材序列（dx = 段内偏移） */
interface RowDef {
  r: number;
  h: number;
  base: number; // 本行首个素材在 items 中的序号（可为负，取模使用）
  period: number; // 一个周期的世界宽度（含收尾 GAP）
  offX: number; // 本行的水平相位偏移
  seg: { id: string; w: number; dx: number }[];
}

export class MosaicLayout {
  private items: { id: string; aspect: number }[];
  private tiles: WorldTile[] = [];
  private emitted = new Set<string>();
  private rows = new Map<number, RowDef>();
  private rowY = new Map<number, number>();
  private yMin = 0;
  private yMax = 0;
  private totalTiles = 0;

  constructor(items: { id: string; aspect: number }[]) {
    this.items = items;
  }

  get tileCount() {
    return this.totalTiles;
  }

  /** 行号 r 的行高（确定性） */
  private rowH(r: number) {
    return ROW_MIN + hash01(r) * (ROW_MAX - ROW_MIN);
  }

  /** 行 r 顶边的 y 坐标（从 0 行向两侧懒计算） */
  private y(r: number): number {
    const hit = this.rowY.get(r);
    if (hit !== undefined) return hit;
    if (r === 0) {
      this.rowY.set(0, 0);
      return 0;
    }
    if (r > 0) {
      this.y(r - 1);
      let acc = this.rowY.get(r - 1)!;
      for (let i = this.yMax + 1; i <= r; i++) {
        acc += this.rowH(i - 1) + GAP;
        this.rowY.set(i, acc);
      }
      this.yMax = Math.max(this.yMax, r);
      return this.rowY.get(r)!;
    }
    this.y(r + 1);
    let acc = this.rowY.get(r + 1)!;
    for (let i = this.yMin - 1; i >= r; i--) {
      acc -= this.rowH(i) + GAP;
      this.rowY.set(i, acc);
    }
    this.yMin = Math.min(this.yMin, r);
    return this.rowY.get(r)!;
  }

  /** 行 r 的定义（周期段），行序号必须按 0 向外依次首建以保证 base 连续 */
  private row(r: number): RowDef {
    const hit = this.rows.get(r);
    if (hit) return hit;
    const h = Math.round(this.rowH(r));
    const k = SEG_MIN + Math.floor(hash01(r * 3.7) * SEG_VAR); // 6..9 张
    let base: number;
    if (r === 0) base = 0;
    else if (r > 0) base = this.row(r - 1).base + this.row(r - 1).seg.length;
    else base = this.row(r + 1).base - k;

    const n = this.items.length;
    const seg: { id: string; w: number; dx: number }[] = [];
    let acc = 0;
    for (let i = 0; i < k; i++) {
      const it = this.items[((base + i) % n + n) % n];
      const w = Math.round(h * Math.max(ASPECT_MIN, Math.min(ASPECT_MAX, it.aspect)));
      seg.push({ id: it.id, w, dx: acc });
      acc += w + GAP;
    }
    const def: RowDef = {
      r,
      h,
      base,
      period: acc, // 含收尾 GAP，周期无缝拼接
      offX: (hash01(r * 9.1) - 0.5) * acc * 1.7,
      seg,
    };
    this.rows.set(r, def);
    return def;
  }

  /** 生成行直到完全覆盖目标区域，返回与 rect 相交的瓦片 */
  ensureCover(rect: Rect): WorldTile[] {
    if (this.items.length === 0) return [];
    const pad = 200;
    const avgH = (ROW_MIN + ROW_MAX) / 2 + GAP;
    let rEst = Math.ceil((rect.y1 - rect.y0 + 2 * pad) / avgH / 2) + 2;
    for (;;) {
      for (let r = -rEst; r <= rEst; r++) {
        this.y(r);
        this.row(r);
      }
      const top = this.y(-rEst);
      const bottom = this.y(rEst) + this.row(rEst).h;
      if (top <= rect.y0 - pad && bottom >= rect.y1 + pad) break;
      rEst += 2;
    }

    // 生成与视口 y 相交的行在 x 方向的瓦片
    for (let r = -rEst; r <= rEst; r++) {
      const y = this.y(r);
      const h = this.row(r).h;
      if (y + h < rect.y0 || y > rect.y1) continue;
      this.emitRow(r, rect);
    }
    return this.tilesIn(rect);
  }

  /** 生成一行在目标 x 区间内的所有瓦片（去重后追加） */
  private emitRow(r: number, rect: Rect) {
    const def = this.row(r);
    const y = this.y(r);
    const x0 = rect.x0 - 100;
    const x1 = rect.x1 + 100;
    const kMin = Math.floor((x0 - def.offX) / def.period) - 1;
    const kMax = Math.ceil((x1 - def.offX) / def.period) + 1;
    for (let k = kMin; k <= kMax; k++) {
      for (let i = 0; i < def.seg.length; i++) {
        const s = def.seg[i];
        const x = def.offX + k * def.period + s.dx;
        if (x + s.w < x0 || x > x1) continue;
        const key = `${r}|${k}|${i}`;
        if (this.emitted.has(key)) continue;
        this.emitted.add(key);
        this.tiles.push({ id: s.id, x, y, w: s.w, h: def.h, ring: r });
        this.totalTiles++;
      }
    }
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

  allTiles(): WorldTile[] {
    return this.tiles;
  }
}

export function buildMosaic(items: { id: string; aspect: number }[]): MosaicLayout {
  return new MosaicLayout(items);
}
