/**
 * 生成封面墙的「展开重排」查找表。
 *
 * 机制:块格点阵 —— 12×8 块内 12 个槽位精确铺满;某张卡展开成 6×6 时,
 * 其余 11 张卡换用更小的槽位把块内剩余面积**重新精确铺满**(re-gear),
 * 由求解器在所有精确覆盖中挑选「原卡移动量最小」的一组。
 *
 * 输出:web/src/lib/wallReflows.ts —— REFlows[template][orientation][expandedSlot][slot]
 */
import { writeFileSync } from "node:fs";

const W = 12;
const H = 8;
const SLOTS = 12;
const EXP = { w: 6, h: 6 };

/** 三个基础模板:每个 12 槽,恰好铺满 12×8(96 格),含不同位置的大卡 */
const TEMPLATES = [
  // 变体 0:左上/右/左下三个 4×4 主卡
  [
    { x: 0, y: 0, w: 4, h: 4 },
    { x: 4, y: 0, w: 4, h: 2 },
    { x: 8, y: 0, w: 4, h: 4 },
    { x: 4, y: 2, w: 4, h: 2 },
    { x: 0, y: 4, w: 4, h: 4 },
    { x: 4, y: 4, w: 2, h: 2 },
    { x: 6, y: 4, w: 2, h: 2 },
    { x: 4, y: 6, w: 2, h: 2 },
    { x: 6, y: 6, w: 2, h: 2 },
    { x: 8, y: 4, w: 4, h: 2 },
    { x: 8, y: 6, w: 2, h: 2 },
    { x: 10, y: 6, w: 2, h: 2 },
  ],
  // 变体 1:中央 4×4 主卡 + 右下 4×4
  [
    { x: 0, y: 0, w: 2, h: 2 },
    { x: 2, y: 0, w: 2, h: 4 },
    { x: 4, y: 0, w: 4, h: 4 },
    { x: 8, y: 0, w: 4, h: 2 },
    { x: 0, y: 2, w: 2, h: 2 },
    { x: 8, y: 2, w: 2, h: 2 },
    { x: 10, y: 2, w: 2, h: 2 },
    { x: 0, y: 4, w: 2, h: 4 },
    { x: 2, y: 4, w: 6, h: 2 },
    { x: 8, y: 4, w: 4, h: 4 },
    { x: 2, y: 6, w: 3, h: 2 },
    { x: 5, y: 6, w: 3, h: 2 },
  ],
  // 变体 2:双列窄条节奏
  [
    { x: 0, y: 0, w: 3, h: 2 },
    { x: 3, y: 0, w: 3, h: 4 },
    { x: 6, y: 0, w: 3, h: 2 },
    { x: 9, y: 0, w: 3, h: 4 },
    { x: 0, y: 2, w: 3, h: 2 },
    { x: 6, y: 2, w: 3, h: 4 },
    { x: 0, y: 4, w: 3, h: 4 },
    { x: 3, y: 4, w: 3, h: 2 },
    { x: 3, y: 6, w: 3, h: 2 },
    { x: 6, y: 6, w: 3, h: 2 },
    { x: 9, y: 4, w: 3, h: 2 },
    { x: 9, y: 6, w: 3, h: 2 },
  ],
];

// ---- 自检:模板必须恰好铺满 ----
for (const [ti, tpl] of TEMPLATES.entries()) {
  if (tpl.length !== SLOTS) throw new Error(`template ${ti}: ${tpl.length} slots`);
  const grid = Array.from({ length: H }, () => Array(W).fill(-1));
  tpl.forEach((s, i) => {
    for (let y = s.y; y < s.y + s.h; y++)
      for (let x = s.x; x < s.x + s.w; x++) {
        if (grid[y][x] !== -1) throw new Error(`template ${ti} overlap at ${x},${y}`);
        grid[y][x] = i;
      }
  });
  if (grid.flat().some((v) => v === -1)) throw new Error(`template ${ti} has holes`);
}

/** 候选小槽位(展开卡以外可用的齿轮):2..6 边长、面积 ≤ 16 */
const GEARS = [];
for (let w = 2; w <= 6; w++) for (let h = 2; h <= 6; h++) if (w * h <= 16) GEARS.push({ w, h });

const key = (x, y) => y * W + x;

/** 在剩余格子上做精确覆盖,收集解(限制解数防爆炸) */
function* covers(free, rectsLeft, acc, limit) {
  if (acc.length === rectsLeft) {
    yield acc.slice();
    return;
  }
  if (--limit.v <= 0) return;
  // 第一个空格
  let first = -1;
  for (let i = 0; i < free.length; i++)
    if (free[i]) {
      first = i;
      break;
    }
  if (first < 0) return;
  const fx = first % W;
  const fy = (first - fx) / W;
  for (const g of GEARS) {
    if (fx + g.w > W || fy + g.h > H) continue;
    let ok = true;
    const cells = [];
    for (let y = fy; y < fy + g.h && ok; y++)
      for (let x = fx; x < fx + g.w && ok; x++) {
        if (!free[key(x, y)]) ok = false;
        else cells.push(key(x, y));
      }
    if (!ok) continue;
    acc.push({ x: fx, y: fy, w: g.w, h: g.h });
    for (const c of cells) free[c] = false;
    if (acc.length <= rectsLeft) yield* covers(free, rectsLeft, acc, limit);
    for (const c of cells) free[c] = true;
    acc.pop();
  }
}

const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** 贪心最小代价匹配:11 张原卡 ↔ 11 个新槽位,总移动量尽量小 */
function assignCost(original, fresh) {
  const pairs = [];
  original.forEach((o, i) => fresh.forEach((f, j) => pairs.push({ i, j, c: dist2(center(o), center(f)) })));
  pairs.sort((a, b) => a.c - b.c);
  const usedO = new Set();
  const usedF = new Set();
  let cost = 0;
  for (const p of pairs) {
    if (usedO.has(p.i) || usedF.has(p.j)) continue;
    usedO.add(p.i);
    usedF.add(p.j);
    cost += p.c;
  }
  return cost;
}

const flipX = (slots) => slots.map((s) => ({ ...s, x: W - s.x - s.w }));
const flipY = (slots) => slots.map((s) => ({ ...s, y: H - s.y - s.h }));
const REFLECTIONS = [(s) => s, flipX, flipY, (s) => flipX(flipY(s))];

const result = [];

for (const tpl of TEMPLATES) {
  const perOrientation = [];
  for (const reflect of REFLECTIONS) {
    const oriented = reflect(tpl);
    const perSlot = [];
    for (let k = 0; k < SLOTS; k++) {
      const origin = oriented[k];
      let best = null;
      // 枚举 6×6 的锚点(需与原槽位相交,展开卡才算"原地长大")
      const anchors = [];
      for (let ax = 0; ax <= W - EXP.w; ax++)
        for (let ay = 0; ay <= H - EXP.h; ay++) {
          if (
            ax + EXP.w <= origin.x ||
            origin.x + origin.w <= ax ||
            ay + EXP.h <= origin.y ||
            origin.y + origin.h <= ay
          )
            continue;
          anchors.push([ax, ay]);
        }
      const others = oriented.filter((_, i) => i !== k);
      for (const [ax, ay] of anchors) {
          const hero = { x: ax, y: ay, w: EXP.w, h: EXP.h };
          const free = Array.from({ length: W * H }, (_, i) => {
            const x = i % W;
            const y = (i - x) / W;
            return !(x >= ax && x < ax + EXP.w && y >= ay && y < ay + EXP.h);
          });
          // 面积守恒剪枝:hero 之外的空格数必须恰好等于 11 卡的面积和
          const freeCells = free.filter(Boolean).length;
          for (const rest of covers(free, SLOTS - 1, [], { v: 3000 })) {
            if (rest.length !== SLOTS - 1) continue;
            const area = rest.reduce((a, s) => a + s.w * s.h, 0);
            if (area !== freeCells) continue;
            const cost = assignCost(others, rest);
            if (!best || cost < best.cost) best = { cost, hero, rest };
          }
      }
      if (!best) throw new Error(`no cover: template slot ${k}`);
      // 输出顺序 = 原槽位顺序(卡的身份保持);k 号卡 = hero
      const layout = [];
      let ri = 0;
      for (let i = 0; i < SLOTS; i++) layout.push(i === k ? best.hero : best.rest[ri++]);
      perSlot.push(layout);
    }
    perOrientation.push(perSlot);
  }
  result.push(perOrientation);
}

// ---- 自检:每个重排表都必须恰好铺满且无重叠 ----
for (const perOrientation of result)
  for (const perSlot of perOrientation)
    for (const layout of perSlot) {
      if (layout.length !== SLOTS) throw new Error("bad slot count");
      const grid = Array.from({ length: H }, () => Array(W).fill(-1));
      layout.forEach((s, i) => {
        for (let y = s.y; y < s.y + s.h; y++)
          for (let x = s.x; x < s.x + s.w; x++) {
            if (grid[y][x] !== -1) throw new Error("overlap in generated layout");
            grid[y][x] = i;
          }
      });
      if (grid.flat().some((v) => v === -1)) throw new Error("hole in generated layout");
      const hero = layout.find((s) => s.w === EXP.w && s.h === EXP.h);
      if (!hero) throw new Error("no 6x6 hero in layout");
    }

const ts = `/**
 * 封面墙「展开重排」查找表(由 scripts/gen-wall-reflows.mjs 生成,勿手改)。
 *
 * WALL_REFLOWS[template][orientation][expandedSlot] = 12 个槽位,
 * 展开卡占 6×6,其余 11 卡换小齿轮把 12×8 块重新精确铺满;
 * 下标 = 原槽位序号,卡的身份在换挡前后保持不变。
 */

export interface BlockSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TEMPLATES: BlockSlot[][] = ${JSON.stringify(TEMPLATES)};

export const WALL_REFLOWS: BlockSlot[][][][] = ${JSON.stringify(result)};

export const REFLECTION_COUNT = 4;
`;

writeFileSync(new URL("../web/src/lib/wallReflows.ts", import.meta.url), ts);
console.log("wallReflows.ts written,", ts.length, "bytes");
