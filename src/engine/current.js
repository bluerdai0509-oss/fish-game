// ============================================================
// 水流场：三幕各自的水流物理 + 可视化
// ------------------------------------------------------------
// 世界是无限海，所以流速是「位置到流速」的纯函数 ——
// 不存状态、不需要网格、天然支持无限延展与镜头缩放。
//
// 三种幕的水流形态：
//   1 江河 —— 单向河道流，一条主河道贯穿，靠近岸侧减速
//   2 湖海 —— 缓慢的大尺度环流，无固定方向
//   3 北冥 —— 深水暗流 + 两个反向涡旋
//
// 影响对象：玩家（顺流加速 / 逆流减速）、NPC 鱼（被水推着走）、
//           气泡与浮游粒子（随流漂移）。
// ============================================================
const TAU = Math.PI * 2;

/** 每幕的水流参数 */
export const CURRENT_PRESETS = {
  // 江河：强单向流。一条宽阔主河道，河心最快，两岸减速
  1: {
    kind: 'river',
    base: { x: 148, y: 0 },      // 基流方向与速度（px/s）
    push: 1.0,                   // 对玩家速度的推力系数
    fishPush: 0.85,              // 对 NPC 的推力系数
    bands: 820,                  // 河道半周期：河宽约 820px，相邻河道间距 1640px
    turbulence: 24,              // 湍流幅度
    harrow: 0.42,                // 河心提速倍率
  },
  // 湖海：缓慢环流，几乎没有净位移
  2: {
    kind: 'gyre',
    base: { x: 34, y: -18 },
    push: 0.55,
    fishPush: 0.5,
    gyreRadius: 900,             // 环流尺度
    gyreSpeed: 42,
    turbulence: 16,
  },
  // 北冥：暗流，叠加两个反向涡旋（涡心附近明显更快）
  3: {
    kind: 'abyss',
    base: { x: -30, y: 34 },
    push: 0.75,
    fishPush: 0.7,
    vortexRadius: 520,
    vortexSpeed: 150,
    turbulence: 26,
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** 取小数部分（配合大常数做确定性伪随机） */
const fract = (v) => v - Math.floor(v);

/**
 * 平滑的确定性噪声：两次正弦叠加，避免规则感又不引入随机状态。
 * 同一个 (x, y, t) 永远得到同一个值 —— 保证物理与渲染一致。
 */
function noise2(x, y, t, seed) {
  const a = Math.sin(x * 0.0043 + t * 0.31 + seed) * Math.cos(y * 0.0037 - t * 0.23 + seed * 1.7);
  const b = Math.sin(x * 0.0091 - t * 0.17 + seed * 2.3) * Math.cos(y * 0.0083 + t * 0.29 + seed * 0.9);
  return a * 0.66 + b * 0.34;
}

export class CurrentField {
  constructor(actId) {
    this.setAct(actId);
  }

  setAct(actId) {
    this.actId = actId;
    this.preset = CURRENT_PRESETS[actId] || CURRENT_PRESETS[1];
    this.kind = this.preset.kind;
  }

  /**
   * 采样某点的流速（世界坐标 → px/s 向量）。
   * @param t 全局时间（用于随时间缓慢变化的湍流）
   * @returns {{x:number, y:number, speed:number}}
   */
  sample(x, y, t) {
    const P = this.preset;
    let vx = P.base.x;
    let vy = P.base.y;

    if (this.kind === 'river') {
      // 河道剖面：用平滑的余弦周期性起伏，河心最快、两岸最慢。
      // 用 (1+cos)/2 而不是 cos 本身 —— 后者会让流速穿过负值产生"倒流带"，
      // 在俯视画面里表现为莫名其妙的方向反转。
      const band = 0.5 + 0.5 * Math.cos((y / P.bands) * Math.PI * 2);
      const k = 0.22 + 0.78 * band * band;      // band² 让河心更突出、过渡更软
      vx *= k * (1 + P.harrow);
      vy *= k * 0.22;
      // 蛇曲：横向分量随 x 缓慢摆动
      const meander = Math.sin(x * 0.0012 + t * 0.06) * 46 * band;
      vy += meander;
    } else if (this.kind === 'gyre') {
      // 环流：绕若干中心的大圆，速度随半径衰减
      const R = P.gyreRadius;
      const cx = Math.round(x / (R * 2)) * R * 2;
      const cy = Math.round(y / (R * 2)) * R * 2;
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const falloff = Math.exp(-(d * d) / (R * R * 0.9));
      const spin = P.gyreSpeed * falloff * Math.sign(Math.sin(cx * 0.0007 + cy * 0.0011) || 1);
      vx += (-dy / d) * spin;
      vy += (dx / d) * spin;
    } else if (this.kind === 'abyss') {
      // 涡旋：几对反向旋转的漩涡，中心最快、边缘衰减
      const R = P.vortexRadius;
      for (let i = 0; i < 2; i++) {
        const cx = Math.round(x / (R * 2.4) + i * 0.5) * R * 2.4 - (i ? R * 1.2 : 0);
        const cy = Math.round(y / (R * 2.4) + i * 0.37) * R * 2.4 - (i ? R * 0.8 : 0);
        const dx = x - cx, dy = y - cy;
        const d = Math.hypot(dx, dy) || 1;
        if (d > R * 1.6) continue;
        const falloff = 1 - clamp(d / (R * 1.6), 0, 1);
        const spin = P.vortexSpeed * falloff * falloff * (i ? -1 : 1);
        vx += (-dy / d) * spin;
        vy += (dx / d) * spin;
      }
    }

    // 湍流：低频，让流向不是完美直线
    const n1 = noise2(x, y, t, 1.3);
    const n2 = noise2(x, y, t, 7.9);
    vx += n1 * P.turbulence;
    vy += n2 * P.turbulence;

    return { x: vx, y: vy, speed: Math.hypot(vx, vy) };
  }

  /**
   * 纯视觉流场：只用来驱动流线动画，不产生任何物理效果。
   * 真正的推挤力全部集中在 FlowZone（见 zones.js）。
   */
  intensity(x, y, t) {
    return clamp(this.sample(x, y, t).speed / 220, 0, 1);
  }
}

// ============================================================
// 水流可视化：世界坐标系下绘制的流线
// ============================================================
const _flowCache = new Map();

/**
 * 在水流方向画细长的流线（俯视看水中的悬浮物被水流拉成丝）。
 * 纯世界坐标，随相机自动缩放。
 */
/**
 * 采样视野内的流线位置（供 GPU 渲染使用）。
 * 返回扁平数组 {x, y, vx, vy, speed}，数量约为 视野面积 / cell² × 3。
 * 与 drawCurrentLines 的取样规则完全一致，保证 CPU / GPU 两条路径观感相同。
 */
export function sampleStreaks(field, view, t, quality = true, density = 1, maxCount = 1400) {
  const { x0, y0, x1, y1 } = view;
  // 密度系数：格距越大流线越稀。深色幕用它降密度，避免暗底上"满屏划痕"
  let cell = (quality ? 96 : 150) / Math.max(0.25, density);
  // 视野会随镜头缩放变化（大鱼时视野大得多），
  // 按面积算格子数会暴涨 —— 用目标上限反推格距，保证流线总数稳定。
  const estCount = ((x1 - x0) / cell + 1) * ((y1 - y0) / cell + 1) * 3;
  if (estCount > maxCount) {
    cell *= Math.sqrt(estCount / maxCount);
  }
  const sx = Math.floor(x0 / cell) * cell;
  const sy = Math.floor(y0 / cell) * cell;
  const out = [];
  for (let gx = sx; gx < x1 + cell; gx += cell) {
    for (let gy = sy; gy < y1 + cell; gy += cell) {
      for (let k = 0; k < 3; k++) {
        const j1 = fract(Math.sin(gx * 0.0217 + gy * 0.0143 + k * 3.11) * 43758.5453);
        const j2 = fract(Math.cos(gx * 0.0179 - gy * 0.0231 + k * 5.73) * 24634.6345);
        const px = gx + j1 * cell;
        const py = gy + j2 * cell;
        const c = field.sample(px, py, t);
        if (c.speed < 8) continue;
        // 漂移：与 2D 版本一致，让流线"流动"
        const drift = (t * c.speed * 0.34 + k * cell * 0.7) % (cell * 1.6);
        const nx = c.x / c.speed, ny = c.y / c.speed;
        out.push({
          x: px - nx * drift,
          y: py - ny * drift,
          vx: c.x,
          vy: c.y,
          speed: c.speed,
        });
      }
    }
  }
  return out;
}

/**
 * 在水流方向画细长的流线（Canvas2D 回退路径使用）。
 * 纯世界坐标，随相机自动缩放。
 */
export function drawCurrentLines(ctx, field, view, t, quality = true, dark = false) {
  const { x0, y0, x1, y1 } = view;
  const cell = quality ? 96 : 150;
  const sx = Math.floor(x0 / cell) * cell;
  const sy = Math.floor(y0 / cell) * cell;

  ctx.save();
  ctx.lineCap = 'round';
  for (let gx = sx; gx < x1 + cell; gx += cell) {
    for (let gy = sy; gy < y1 + cell; gy += cell) {
      // 每格 3 条，位置用互相不可通约的频率抖动 —— 避免整齐的网格排列
      for (let k = 0; k < 3; k++) {
        const j1 = fract(Math.sin(gx * 0.0217 + gy * 0.0143 + k * 3.11) * 43758.5453);
        const j2 = fract(Math.cos(gx * 0.0179 - gy * 0.0231 + k * 5.73) * 24634.6345);
        const px = gx + j1 * cell;
        const py = gy + j2 * cell;
        const c = field.sample(px, py, t);
        if (c.speed < 8) continue;

        // 流速越快，流线越长 —— 这是玩家判断"哪里是急流"的主要线索
        const k2 = clamp(c.speed / 240, 0, 1.6);
        const len = 20 + k2 * 78;
        const nx = c.x / c.speed, ny = c.y / c.speed;
        const drift = (t * c.speed * 0.34 + k * cell * 0.7) % (cell * 1.6);
        const ox = px - nx * drift;
        const oy = py - ny * drift;

        // 深水幕用更亮的线（暗底上白线要更强才看得见）
        const a = dark
          ? clamp(0.10 + k2 * 0.30, 0.10, 0.42)
          : clamp(0.07 + k2 * 0.24, 0.07, 0.34);
        ctx.strokeStyle = dark
          ? `rgba(180,220,255,${a})`
          : `rgba(236,252,255,${a})`;
        ctx.lineWidth = quality ? 1.6 : 1.2;

        const bend = Math.sin(px * 0.01 + t * 0.9) * len * 0.16;
        ctx.beginPath();
        ctx.moveTo(ox - nx * len * 0.5, oy - ny * len * 0.5);
        ctx.quadraticCurveTo(
          ox - ny * bend, oy + nx * bend,
          ox + nx * len * 0.5, oy + ny * len * 0.5
        );
        ctx.stroke();

        // 头部亮点：明确指向水流方向
        if (quality && k2 > 0.25) {
          ctx.fillStyle = dark
            ? `rgba(200,232,255,${a * 1.5})`
            : `rgba(248,255,255,${a * 1.4})`;
          ctx.beginPath();
          ctx.arc(ox + nx * len * 0.5, oy + ny * len * 0.5, 1.5, 0, TAU);
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}