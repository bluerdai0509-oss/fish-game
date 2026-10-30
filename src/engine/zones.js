// ============================================================
// 特殊物理区域：只有进入这些区域才会受到水流作用力
// ------------------------------------------------------------
// 三种形态：
//   急流 rapids —— **流线型长带**（不是圆盘）。一条有宽度、有弯曲、
//                  有起止端的河道段，沿带方向单向推流。
//   漩涡 vortex —— 圆形涡心，切向旋转 + 向心吸入。
//   涌泉 spring —— 圆形，从中心向外顶开。
//
// 急流用「沿曲线的距离场」判定：区域是一条带弯曲的带状曲线，
// 玩家在带内才受力，受力方向沿曲线切线（自然顺着河走）。
// ============================================================
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 区域类型参数 */
export const ZONE_TYPES = {
  rapids: {
    label: '急流',
    color: 0xbfefff,
    // 带子：长 900~1600、半宽 90~140
    len: [900, 1600],
    halfWidth: [90, 140],
    curveAmp: [110, 210],      // 横向弯曲幅度：要保持小于半宽，否则带子会"自我缠绕"
    dirPush: [270, 380],       // 沿带切线方向的推力
    spin: 0,
  },
  vortex: {
    label: '漩涡',
    color: 0x9fd6ff,
    radius: [170, 250],
    swirl: [180, 260],
    radial: [50, 110],         // 向内吸
    spin: 1.5,
  },
  spring: {
    label: '涌泉',
    color: 0xc8f0e0,
    radius: [150, 220],
    radial: [-170, -250],      // 负值 → 向外推
    spin: -0.6,
  },
};

/** 每幕的区域偏好（第一幕温和、北冥更凶） */
const ACT_MIX = {
  1: ['rapids', 'rapids', 'vortex'],
  2: ['rapids', 'vortex', 'vortex', 'spring'],
  3: ['rapids', 'vortex', 'vortex', 'rapids', 'spring', 'vortex'],
};

/** 每幕的强度倍率 */
const ACT_POWER = { 1: 0.85, 2: 1.0, 3: 1.15 };

/** 平滑衰减：中心 1 → 边缘 0 */
function falloff(d, r) {
  if (d >= r) return 0;
  const k = 1 - d / r;
  return k * k * (3 - 2 * k);   // smoothstep
}

/**
 * 急流带的中心线：以 (0,0) 为中点、沿 +x 延伸的 S 形曲线。
 * y(s) = amp * sin(s * PI * curveFreq)，s ∈ [-len/2, len/2]
 * 纯函数，采样和绘制共用，保证物理与视觉完全一致。
 */
function rapidCenter(band, s) {
  const u = s / band.len;               // -0.5 .. 0.5
  return {
    x: s,
    // 一个完整 S 弯 + 一点二次谐波，避免过于规则的正弦
    y: band.amp * Math.sin(u * Math.PI * 1.35) +
       band.amp * 0.28 * Math.sin(u * Math.PI * 2.7 + 1.1),
  };
}

export class FlowZone {
  constructor(kind, x, y, seed) {
    const T = ZONE_TYPES[kind];
    this.kind = kind;
    this.label = T.label;
    this.color = T.color;
    this.x = x;
    this.y = y;
    this.seed = seed;
    this.t = 0;
    this.dead = false;
    this.spin = T.spin || 0;
    this.power = ACT_POWER[(seed >> 16) & 0xffff] || 1;

    if (kind === 'rapids') {
      // 带状：任意朝向的长条
      this.angle = rand(0, TAU);
      this.len = rand(T.len[0], T.len[1]);
      this.halfWidth = rand(T.halfWidth[0], T.halfWidth[1]);
      this.amp = rand(T.curveAmp[0], T.curveAmp[1]);
      this.dirPush = rand(T.dirPush[0], T.dirPush[1]);
      // 用于"区域是否在视野内"的粗略包围半径
      this.r = this.len * 0.5;
    } else {
      this.r = rand(T.radius[0], T.radius[1]);
      this.swirl = rand(T.swirl[0], T.swirl[1]);
      this.radial = rand(T.radial[0], T.radial[1]);
      this.angle = 0;
    }
  }

  update(dt) { this.t += dt; }

  /**
   * 把世界坐标转到急流带的局部坐标系（带子沿局部 x 轴）。
   * 返回沿带方向的参数 s 与横向偏移 d。
   */
  _toBandSpace(x, y) {
    const dx = x - this.x, dy = y - this.y;
    const c = Math.cos(-this.angle), si = Math.sin(-this.angle);
    return { lx: dx * c - dy * si, ly: dx * si + dy * c };
  }

  /**
   * 求局部点 (lx, ly) 到曲线中心线的最近点。
   *
   * 曲线弯曲幅度可能很大（amp 接近 len/4），"同 x 处高度差"的近似
   * 误差会到十几像素，物理边界和视觉会错位。这里直接沿曲线采样
   * 找最近点 —— 16 段已经足够准，成本可忽略。
   */
  _nearestOnBand(lx, ly) {
    const halfL = this.len * 0.5;
    const clampLx = clamp(lx, -halfL, halfL);
    // 第一次粗定位：先按 x 估一个 s
    let bestS = clampLx, bestD = Infinity, bestY = 0;
    const RANGE = halfL;
    const STEPS = 16;
    // 在粗估位置附近 ±(len/6) 内细搜
    const win = this.len / 6;
    const s0 = Math.max(-RANGE, clampLx - win);
    const s1 = Math.min(RANGE, clampLx + win);
    for (let i = 0; i <= STEPS; i++) {
      const s = s0 + (s1 - s0) * (i / STEPS);
      const p = rapidCenter(this, s);
      const d = Math.hypot(p.x - lx, p.y - ly);
      if (d < bestD) { bestD = d; bestS = s; bestY = p.y; }
    }
    // 最后再做一次局部细化
    for (let i = -1; i <= 1; i++) {
      const s = clamp(bestS + i * (s1 - s0) / STEPS / 2, -RANGE, RANGE);
      const p = rapidCenter(this, s);
      const d = Math.hypot(p.x - lx, p.y - ly);
      if (d < bestD) { bestD = d; bestS = s; bestY = p.y; }
    }
    return { s: bestS, cy: bestY, dist: bestD };
  }

  /** 点是否在区域内（含衰减权重 0..1） */
  weightAt(x, y) {
    if (this.kind === 'rapids') {
      const { lx, ly } = this._toBandSpace(x, y);
      const { dist, s } = this._nearestOnBand(lx, ly);
      // 横向衰减 + 两端收口（避免带子末端像被刀切断）
      const halfL = this.len * 0.5;
      const endK = 1 - Math.pow(Math.min(1, Math.abs(s) / halfL), 4);
      return falloff(dist, this.halfWidth) * Math.max(0, endK);
    }
    return falloff(Math.hypot(x - this.x, y - this.y), this.r);
  }

  /**
   * 该点受到的区域流速（px/s）。null = 不在区域内（无物理效果）。
   */
  velocityAt(x, y) {
    if (this.kind === 'rapids') {
      const { lx, ly } = this._toBandSpace(x, y);
      const halfL = this.len * 0.5;
      const near = this._nearestOnBand(lx, ly);
      if (near.dist >= this.halfWidth) return null;

      const w = falloff(near.dist, this.halfWidth) * this.power;
      if (w <= 0.001) return null;
      // 两端渐弱，避免进出带子时速度突变
      const endK = 1 - Math.pow(Math.min(1, Math.abs(near.s) / halfL), 4);
      const k = w * Math.max(0, endK);
      if (k <= 0.0005) return null;

      // 切线方向 = 曲线在该点的导数
      const eps = 10;
      const a = rapidCenter(this, near.s - eps);
      const b = rapidCenter(this, near.s + eps);
      let tx = b.x - a.x, ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;

      // 回到世界坐标
      const c = Math.cos(this.angle), si = Math.sin(this.angle);
      const wx = tx * c - ty * si;
      const wy = tx * si + ty * c;
      return { x: wx * this.dirPush * k, y: wy * this.dirPush * k };
    }

    const d = Math.hypot(x - this.x, y - this.y);
    if (d >= this.r) return null;
    const w = falloff(d, this.r) * this.power;
    if (w <= 0.001) return null;

    let vx = 0, vy = 0;
    if (d > 0.001) {
      const nx = (x - this.x) / d;
      const ny = (y - this.y) / d;
      if (this.swirl) {
        vx += -ny * this.swirl * w;
        vy += nx * this.swirl * w;
      }
      if (this.radial) {
        vx += -nx * this.radial * w;
        vy += -ny * this.radial * w;
      }
    }
    return { x: vx, y: vy };
  }

  /** 视觉包围半径（用于回收判断） */
  get boundR() {
    return this.kind === 'rapids' ? this.len * 0.5 + this.halfWidth : this.r;
  }
}

/** 在玩家周围撒若干区域（世界坐标，无限海） */
export function spawnZones(actId, px, py) {
  const mix = ACT_MIX[actId] || ACT_MIX[1];
  const list = [];
  const tries = 60;
  for (let i = 0; i < mix.length; i++) {
    const kind = mix[i];
    let best = null;
    for (let k = 0; k < tries; k++) {
      const a = rand(0, TAU);
      // 第一个区域放在视野边缘内，开局就能看见
      const d = i === 0 ? rand(300, 620) : rand(650, 1400);
      const x = px + Math.cos(a) * d;
      const y = py + Math.sin(a) * d;
      const cand = new FlowZone(kind, x, y, (actId << 16) | (i + 1));
      // 与已放置区域保持间距（按包围半径算，带子也算得下）
      const clear = list.every((o) =>
        Math.hypot(o.x - x, o.y - y) > (o.boundR + cand.boundR) * 0.85);
      if (clear) { best = cand; break; }
      if (!best) best = cand;
    }
    if (best) list.push(best);
  }
  return list;
}

/** 玩家游远后把区域重新投放到前方 */
export function recycleZone(z, px, py) {
  const a = rand(0, TAU);
  const d = rand(700, 1500);
  z.x = px + Math.cos(a) * d;
  z.y = py + Math.sin(a) * d;
  if (z.kind === 'rapids') z.angle = rand(0, TAU);
  z.t = 0;
  // 贴图按实例缓存，但形状不随位置变 —— 只换位置无需重建
}

/**
 * 汇总某点受到的所有区域作用力。
 * @returns {{x,y,label,zone}|null} null = 不在任何区域内（无物理效果）
 */
export function zoneForceAt(zones, x, y) {
  let vx = 0, vy = 0;
  let best = null, bestW = 0;
  for (const z of zones) {
    const v = z.velocityAt(x, y);
    if (!v) continue;
    vx += v.x;
    vy += v.y;
    const w = z.weightAt(x, y);
    if (w > bestW) { bestW = w; best = z; }
  }
  if (!best) return null;
  return { x: vx, y: vy, label: best.label, zone: best };
}

// ============================================================
// 区域可视化
// ============================================================
const _zoneTex = new Map();

/**
 * 急流：**流线型长带**。
 * 按曲线的实际几何绘制 —— 边缘是不规则的羽化轮廓，
 * 内部是顺流的细长水纹，两端自然收尖，完全不是圆形。
 */
function bakeRapids(band) {
  // 贴图按带子的实际尺寸烘焙（含弯曲余量）
  const pad = band.halfWidth * 3;
  const W = Math.ceil(band.len + pad * 2);
  const H = Math.ceil(band.amp * 2 + band.halfWidth * 6);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // 局部坐标 → 画布坐标：带子沿 x，中心线在画布中线
  const cx = W / 2, cy = H / 2;
  g.translate(cx, cy);

  const N = 90;
  const top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const s = -band.len / 2 + (i / N) * band.len;
    const p = rapidCenter(band, s);
    // 两端收窄：带子在首尾逐渐变细，像河段汇入/流出
    const u = Math.abs(s) / (band.len * 0.5);
    const taper = Math.pow(Math.max(0, 1 - Math.pow(u, 5)), 0.55);
    // 边缘加噪声，避免轮廓像机械曲线
    const wob = Math.sin(s * 0.021 + band.seed) * 0.10
              + Math.sin(s * 0.047 + band.seed * 2) * 0.05;
    const hw = band.halfWidth * taper * (1 + wob);
    top.push([p.x, p.y - hw]);
    bot.push([p.x, p.y + hw]);
  }

  // 带体：从中心向外渐隐的水色
  const path = () => {
    g.beginPath();
    g.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i < top.length; i++) g.lineTo(top[i][0], top[i][1]);
    for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
    g.closePath();
  };
  const grad = g.createLinearGradient(0, -band.halfWidth, 0, band.halfWidth);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.30, 'rgba(255,255,255,0.30)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.46)');
  grad.addColorStop(0.70, 'rgba(255,255,255,0.30)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  path();
  g.fill();

  // 内部流纹：沿曲线走的细长亮线（这才是"流"的观感）
  g.lineCap = 'round';
  for (let line = 0; line < 7; line++) {
    const off = (line / 6 - 0.5) * 1.5;          // 横向偏移（相对半宽）
    const alpha = 0.20 + (1 - Math.abs(off) * 1.2) * 0.26;
    g.strokeStyle = `rgba(255,255,255,${Math.max(0.08, alpha)})`;
    g.lineWidth = 2.4 + (line % 3) * 0.8;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const s = -band.len / 2 + (i / N) * band.len;
      const p = rapidCenter(band, s);
      const u = Math.abs(s) / (band.len * 0.5);
      const taper = Math.pow(Math.max(0, 1 - Math.pow(u, 5)), 0.55);
      const y = p.y + off * band.halfWidth * taper;
      i === 0 ? g.moveTo(p.x, y) : g.lineTo(p.x, y);
    }
    g.stroke();
  }

  // 边缘轮廓：只画上下一道细亮边，强调"这是一条河段"
  g.strokeStyle = 'rgba(255,255,255,0.34)';
  g.lineWidth = 1.8;
  for (const edge of [top, bot]) {
    g.beginPath();
    g.moveTo(edge[0][0], edge[0][1]);
    for (let i = 1; i < edge.length; i++) g.lineTo(edge[i][0], edge[i][1]);
    g.stroke();
  }

  return { canvas: c, w: W, h: H, cx, cy };
}

/** 圆形区域（漩涡 / 涌泉） */
function bakeCircle(kind, radius) {
  const S = Math.ceil(radius * 2.4);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  const R = S / 2 - 4;

  if (kind === 'vortex') {
    g.lineCap = 'round';
    for (let arm = 0; arm < 6; arm++) {
      const base = (arm / 6) * TAU;
      g.strokeStyle = `rgba(255,255,255,${0.26 + arm * 0.02})`;
      g.lineWidth = 5;
      g.beginPath();
      for (let k = 0; k <= 44; k++) {
        const kk = k / 44;
        const ang = base + kk * 4.0;
        const rr = R * (0.08 + kk * 0.86);
        const px = Math.cos(ang) * rr;
        const py = Math.sin(ang) * rr;
        k === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
      }
      g.stroke();
    }
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.34);
    rg.addColorStop(0, 'rgba(255,255,255,0.45)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, 0, R * 0.34, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.40)';
    g.lineWidth = 2;
    g.setLineDash([16, 13]);
    g.beginPath();
    g.arc(0, 0, R * 0.94, 0, TAU);
    g.stroke();
  } else {
    g.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      g.strokeStyle = `rgba(255,255,255,${0.12 + (i % 3) * 0.05})`;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.16, Math.sin(a) * R * 0.16);
      g.lineTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
      g.stroke();
    }
    for (let i = 1; i <= 3; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.30 - i * 0.06})`;
      g.lineWidth = 3.5;
      g.beginPath();
      g.arc(0, 0, R * (0.26 + i * 0.22), 0, TAU);
      g.stroke();
    }
  }
  return { canvas: c, w: S, h: S, cx: S / 2, cy: S / 2 };
}

/** 取区域的烘焙贴图（按区域实例缓存，带子形状各不相同） */
export function zoneTexture(z) {
  const hit = _zoneTex.get(z);
  if (hit) return hit;
  const baked = z.kind === 'rapids'
    ? bakeRapids(z)
    : bakeCircle(z.kind, z.r);
  _zoneTex.set(z, baked);
  return baked;
}

/** 清理缓存（换幕时用） */
export function clearZoneTextures() { _zoneTex.clear(); }