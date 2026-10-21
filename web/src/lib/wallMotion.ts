/**
 * 封面墙的运动参数与曲线生成(无第三方依赖)。
 *
 * - 让位/展开走「近临界阻尼弹簧」(stiffness 300 / damping 34,阻尼比 ≈0.98):
 *   单调趋近、不过冲不回弹,大位移小位移同一条进度曲线 —— 墙面统一的动感
 * - 弹簧进度采样成 CSS `linear()` 缓动 + 对应时长,CSS 与 JS 逐帧一致
 * - 相机:拖拽直接跟手,松手按指数惯性滑行;滚轮把离散步长累加为指数平滑追帧
 */

/** 让位弹簧参数(mass 1,阻尼比 34/(2·√300)≈0.98) */
export const REFLOW_SPRING = { stiffness: 300, damping: 34 } as const;

/** 相机惯性(拖拽松手) */
export const PAN_INERTIA = {
  minSpeed: 40,
  maxSpeed: 4000,
  timeConstant: 280,
  restDelta: 0.5,
  /** 最后一次移动距松手超过这么久(ms)算停住,不滑行 */
  staleReleaseMs: 80,
} as const;

/** 滚轮平滑追帧 */
export const WHEEL_SMOOTHING = {
  timeConstantMs: 80,
  restDistancePx: 0.5,
  maxFrameMs: 50,
} as const;

/** 展开卡聚焦镜头的弹簧(轻微欠阻尼,带一点点回弹落定) */
export const FOCUS_SPRING = { stiffness: 360, damping: 24 } as const;

/** 弹簧解析解进度(0..1,zeta<1 时会过冲后回落) */
export function springProgress(t: number, stiffness: number, damping: number): number {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  if (zeta >= 1) {
    // 过阻尼
    const wd = w0 * Math.sqrt(zeta * zeta - 1);
    const A = 1;
    const B = (zeta * w0 * A - 0) / wd;
    return 1 - (A * Math.cosh(wd * t) + B * Math.sinh(wd * t)) * Math.exp(-zeta * w0 * t);
  }
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t)) * Math.exp(-zeta * w0 * t);
}

/** 弹簧走到静止(速度与剩余都够小)的毫秒数 */
export function springSettleMs(distance = 1, stiffness = REFLOW_SPRING.stiffness, damping = REFLOW_SPRING.damping): number {
  const dt = 4;
  const limit = 5000;
  for (let t = 0; t < limit; t += dt) {
    const remaining = 1 - springProgress(t / 1000, stiffness, damping);
    if (remaining * distance < 0.5 && remaining * distance * stiffness < 2) {
      // 再多走两帧确保视觉完全静止
      return t + dt * 2;
    }
  }
  return limit;
}

export interface ReflowCurve {
  /** 建议的过渡时长(ms) */
  durationMs: number;
  /** CSS linear() 缓动串 */
  css: string;
  /** 同一条曲线的 JS 插值(0..1 进度) */
  ease: (p: number) => number;
}

const curveCache = new Map<number, ReflowCurve>();

/** 按位移(世界单位)生成/取缓存的弹簧曲线;块内位移有限,缓存命中极高 */
export function reflowCurve(distance: number): ReflowCurve {
  const span = Math.min(Math.max(Math.abs(distance), 1), 8192);
  const bucket = Math.round(span / 32); // 32 单位一档,同档共用
  const hit = curveCache.get(bucket);
  if (hit) return hit;
  const durationMs = springSettleMs(span);
  const step = 4;
  const pts: number[] = [];
  for (let t = 0; t <= durationMs; t += step) {
    pts.push(springProgress(t / 1000, REFLOW_SPRING.stiffness, REFLOW_SPRING.damping));
  }
  pts.push(1);
  const n = pts.length - 1;
  const ease = (p: number) => {
    const x = Math.min(Math.max(p, 0), 1) * n;
    const i = Math.floor(x);
    const f = x - i;
    return pts[i] + (pts[Math.min(i + 1, n)] - pts[i]) * f;
  };
  const css = `linear(${pts.map((v) => v.toFixed(4)).join(", ")})`;
  const curve = { durationMs, css, ease };
  curveCache.set(bucket, curve);
  return curve;
}

/** 一条固定时长的通用弹簧曲线(位移未知时用,例如相机飞行) */
export const GENERIC_CURVE = reflowCurve(600);
