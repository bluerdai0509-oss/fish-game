// ============================================================
// 种族 · 鲲（北冥之鱼 · 俯视背脊）
// 契约：export function draw(ctx, s, pal, p, b)
//   ctx  已经 translate 到鱼的中心、rotate 到朝向
//   s    半径（基准 17~22）
//   pal  { body, belly, fin, glow }
//   p    玩家状态 { tailPhase, mouthOpen, formIndex, ... }
//   b    体型构建参数 { len, wide, fin }
// 坐标：鱼头朝 +x，尾朝 -x，脊线沿 x 轴
// 造型：钝头巨鱼 —— 流畅梭形身 + 背脊星斑 + 成排鳃裂 + 大月牙尾
// ============================================================
import { TAU, cachedLinear, cachedRadial, drawGlow } from '../engine/draw-common.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** #rrggbb 追加透明度；其他格式原样返回 */
const tint = (c, a) => (c.length === 7 && c[0] === '#' ? c + a : c);
/** 替换 pal.glow 中的 ALPHA 占位符 */
const glowA = (g, a) => (g || 'rgba(255,220,150,ALPHA)').replace('ALPHA', String(a));

// ---------- 颜色混合（结果缓存，避免每帧解析 hex） ----------
const _mixCache = new Map();
function mix(a, b, t) {
  if (a.length !== 7 || b.length !== 7 || a[0] !== '#' || b[0] !== '#') return a;
  const key = a + b + t;
  let v = _mixCache.get(key);
  if (v) return v;
  const ai = parseInt(a.slice(1), 16), bi = parseInt(b.slice(1), 16);
  const r = Math.round(((ai >> 16) & 255) + ((((bi >> 16) & 255) - ((ai >> 16) & 255)) * t));
  const g = Math.round(((ai >> 8) & 255) + ((((bi >> 8) & 255) - ((ai >> 8) & 255)) * t));
  const c = Math.round((ai & 255) + (((bi & 255) - (ai & 255)) * t));
  v = '#' + ((1 << 24) | (r << 16) | (g << 8) | c).toString(16).slice(1);
  if (_mixCache.size > 240) _mixCache.clear();
  _mixCache.set(key, v);
  return v;
}

// ---------- 身体轮廓 ----------
// [x/L, 半宽/Wd]：圆钝吻(1) → 头 → 最宽处 → 收腰 → 尾柄(-0.93)
const PROF = [
  [1.000, 0.030], [0.994, 0.085], [0.982, 0.155], [0.962, 0.238],
  [0.932, 0.328], [0.892, 0.424], [0.840, 0.526], [0.774, 0.626],
  [0.692, 0.720], [0.596, 0.800], [0.486, 0.866], [0.366, 0.920],
  [0.240, 0.960], [0.108, 0.988], [-0.030, 1.000], [-0.170, 0.988],
  [-0.310, 0.952], [-0.450, 0.892], [-0.580, 0.804], [-0.695, 0.688],
  [-0.795, 0.540], [-0.875, 0.372], [-0.925, 0.190], [-0.950, 0.090],
];

/** 轮廓在归一化 x 处的半宽（初始化星斑时用） */
function halfWidthAt(xn) {
  for (let i = 0; i < PROF.length - 1; i++) {
    const a = PROF[i], b = PROF[i + 1];
    if (xn <= a[0] && xn >= b[0]) {
      const t = (a[0] - xn) / (a[0] - b[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return 0.08;
}

// 背脊星斑：模块加载时生成一次，运行时只做绘制（少而大，排布有疏密）
const SPOTS = (() => {
  let seed = 913571;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const arr = [];
  for (let i = 0; i < 26; i++) {
    const x = 0.80 - rnd() * 1.56;
    const hw = halfWidthAt(x);
    if (hw < 0.18) continue;
    const yn = (rnd() * 2 - 1) * 0.72;
    const edge = 1 - Math.abs(yn) * 0.6;          // 靠边略小
    const r = (0.030 + rnd() * 0.026) * edge;
    arr.push([x, yn * hw, r, 0.13 + rnd() * 0.14, 0.85 + rnd() * 0.55]);
  }
  return arr;
})();

/** 尾段横向偏移：中段起弯，越靠尾越明显（S 形游姿） */
function bendAt(x, L, ty) {
  const k = clamp01((-x / L - 0.02) / 0.88);
  return ty * k * k * (3 - 2 * k);
}

let _bx = 0, _by = 0;
/** 取第 j 个轮廓采样点（越过 N-1 后镜像到另一侧） */
function pointAt(j, L, Wd, ty) {
  const N = PROF.length;
  const k = j < N ? j : 2 * N - 2 - j;
  const q = PROF[k];
  _bx = q[0] * L;
  _by = (j < N ? -1 : 1) * q[1] * Wd + bendAt(_bx, L, ty);
}

/** 闭合平滑轮廓：二次贝塞尔依次穿过相邻采样点中点 */
function traceBody(ctx, L, Wd, ty) {
  const N = PROF.length, M = N * 2 - 2;
  pointAt(M - 1, L, Wd, ty);
  const px = _bx, py = _by;
  pointAt(0, L, Wd, ty);
  ctx.beginPath();
  ctx.moveTo((px + _bx) * 0.5, (py + _by) * 0.5);
  for (let j = 0; j < M; j++) {
    pointAt(j, L, Wd, ty);
    const cx = _bx, cy = _by;
    pointAt((j + 1) % M, L, Wd, ty);
    ctx.quadraticCurveTo(cx, cy, (cx + _bx) * 0.5, (cy + _by) * 0.5);
  }
  ctx.closePath();
}

/** 单侧开路径（边缘高光用）；side=-1 上缘，1 下缘 */
function traceEdge(ctx, L, Wd, ty, side) {
  const N = PROF.length;
  const at = (j) => pointAt(side < 0 ? j : 2 * N - 2 - j, L, Wd, ty);
  at(0);
  ctx.beginPath();
  ctx.moveTo(_bx, _by);
  for (let j = 1; j < N - 1; j++) {
    at(j);
    const cx = _bx, cy = _by;
    at(j + 1);
    ctx.quadraticCurveTo(cx, cy, (_bx + cx) * 0.5, (_by + cy) * 0.5);
  }
  at(N - 1);
  ctx.lineTo(_bx - L * 0.03, _by);
}

// ---------- 尾鳍 ----------
/** 尾鳍坐标：rootX 为尾柄接点，尺寸以 L/Wd 为基准 */
function tailShape(ctx, L, Wd, rootX, finMul) {
  const W = Wd * finMul;
  ctx.beginPath();
  // 从尾柄上缘出发
  ctx.moveTo(rootX, -Wd * 0.16);
  // 上叶前缘：向后上方舒展
  ctx.bezierCurveTo(rootX - L * 0.16, -W * 0.62, rootX - L * 0.30, -W * 0.98, rootX - L * 0.40, -W * 1.12);
  // 上叶尖（圆钝）
  ctx.bezierCurveTo(rootX - L * 0.47, -W * 1.18, rootX - L * 0.50, -W * 1.06, rootX - L * 0.46, -W * 0.92);
  // 上叶后缘 → 中央凹口
  ctx.bezierCurveTo(rootX - L * 0.40, -W * 0.62, rootX - L * 0.34, -W * 0.30, rootX - L * 0.30, -W * 0.05);
  ctx.quadraticCurveTo(rootX - L * 0.285, 0, rootX - L * 0.30, W * 0.05);
  // 下叶后缘
  ctx.bezierCurveTo(rootX - L * 0.34, W * 0.30, rootX - L * 0.40, W * 0.62, rootX - L * 0.46, W * 0.92);
  // 下叶尖
  ctx.bezierCurveTo(rootX - L * 0.50, W * 1.06, rootX - L * 0.47, W * 1.18, rootX - L * 0.40, W * 1.12);
  // 下叶前缘
  ctx.bezierCurveTo(rootX - L * 0.30, W * 0.98, rootX - L * 0.16, W * 0.62, rootX, W * 0.16);
  ctx.quadraticCurveTo(rootX + L * 0.02, 0, rootX, -Wd * 0.16);
  ctx.closePath();
}

function drawTail(ctx, s, pal, L, Wd, ty, phase, finMul, fine) {
  // 根部深深埋进身体，避免出现接缝
  const rootX = -L * 0.80;
  ctx.save();
  ctx.translate(0, ty);
  ctx.rotate(Math.sin(phase) * 0.14);

  // 先铺一层柔和的根部过渡，让尾与身体融为一体
  ctx.fillStyle = tint(pal.fin, '30');
  ctx.beginPath();
  ctx.moveTo(-L * 0.62, -Wd * 0.22);
  ctx.quadraticCurveTo(-L * 0.76, -Wd * 0.30, rootX + L * 0.05, -Wd * 0.20);
  ctx.quadraticCurveTo(rootX + L * 0.07, 0, rootX + L * 0.05, Wd * 0.20);
  ctx.quadraticCurveTo(-L * 0.76, Wd * 0.30, -L * 0.62, Wd * 0.22);
  ctx.closePath();
  ctx.fill();

  const g = cachedLinear(ctx, 'kun-tail|' + pal.body + '|' + pal.fin + '|' + pal.belly + '|' + Math.round(L / 4),
    rootX, 0, rootX - L * 0.48, 0,
    [[0, mix(pal.body, pal.fin, 0.34)], [0.20, pal.fin],
    [0.72, mix(pal.fin, pal.body, 0.20)], [1, mix(pal.fin, pal.belly, 0.46)]]);
  ctx.fillStyle = g;
  ctx.globalAlpha *= 0.96;
  tailShape(ctx, L, Wd, rootX, finMul);
  ctx.fill();

  // 鳍条：自尾柄放射
  if (fine) {
    ctx.strokeStyle = tint(pal.belly, '30');
    ctx.lineWidth = Math.max(1, s * 0.010);
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const k = (i + 0.5) / 7;
      for (const side of [-1, 1]) {
        const ey = side * Wd * (0.20 + k * 0.86) * finMul;
        ctx.moveTo(rootX - L * 0.02, 0);
        ctx.quadraticCurveTo(rootX - L * (0.16 + k * 0.06), ey * 0.56, rootX - L * (0.34 + k * 0.06), ey);
      }
    }
    ctx.stroke();
  }

  // 叶尖微光
  ctx.strokeStyle = tint(pal.belly, '44');
  ctx.lineWidth = Math.max(1, s * 0.013);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(rootX - L * 0.40, side * Wd * 1.12 * finMul);
    ctx.bezierCurveTo(rootX - L * 0.47, side * Wd * 1.18 * finMul,
      rootX - L * 0.50, side * Wd * 1.06 * finMul, rootX - L * 0.46, side * Wd * 0.92 * finMul);
    ctx.stroke();
  }

  // 尾柄接缝
  ctx.strokeStyle = tint(pal.fin, '55');
  ctx.lineWidth = Math.max(1, s * 0.016);
  ctx.beginPath();
  ctx.moveTo(rootX + L * 0.01, -Wd * 0.14);
  ctx.quadraticCurveTo(rootX + L * 0.025, 0, rootX + L * 0.01, Wd * 0.14);
  ctx.stroke();
  ctx.restore();
}

// ---------- 胸鳍 / 腹鳍 ----------
/** 胸鳍：以显式镜像坐标绘制，保证上下完全对称 */
function drawPectorals(ctx, s, pal, L, Wd, phase, finMul, fine) {
  const flap = Math.sin(phase + 0.7) * 0.06;
  const tipOut = Wd * (1.30 + flap) * finMul;   // 鳍尖离脊线的距离

  for (const side of [-1, 1]) {
    const g = cachedLinear(ctx, 'kun-pec|' + pal.body + '|' + pal.fin + '|' + pal.belly + '|' + side + '|' + Math.round(Wd / 4),
      0, 0, 0, side * tipOut,
      [[0, mix(pal.body, pal.fin, 0.30)], [0.35, pal.fin], [1, mix(pal.fin, pal.belly, 0.55)]]);
    ctx.save();
    ctx.fillStyle = g;
    ctx.globalAlpha *= 0.92;

    // 柳叶形：根部在鳃后体侧，向后下方（镜像）舒展
    ctx.beginPath();
    ctx.moveTo(L * 0.34, side * Wd * 0.80);
    ctx.bezierCurveTo(L * 0.20, side * Wd * 0.98, L * 0.02, side * (tipOut - Wd * 0.10),
      -L * 0.16, side * tipOut);
    ctx.bezierCurveTo(-L * 0.24, side * (tipOut - Wd * 0.30), -L * 0.16, side * Wd * 0.92,
      -L * 0.02, side * Wd * 0.78);
    ctx.quadraticCurveTo(L * 0.18, side * Wd * 0.74, L * 0.34, side * Wd * 0.80);
    ctx.closePath();
    ctx.fill();

    // 前缘亮边
    ctx.globalAlpha *= 1.35;
    ctx.strokeStyle = tint(pal.belly, '7a');
    ctx.lineWidth = Math.max(1, s * 0.016);
    ctx.beginPath();
    ctx.moveTo(L * 0.34, side * Wd * 0.80);
    ctx.bezierCurveTo(L * 0.20, side * Wd * 0.98, L * 0.02, side * (tipOut - Wd * 0.10),
      -L * 0.16, side * tipOut);
    ctx.stroke();

    // 鳍条
    if (fine) {
      ctx.globalAlpha *= 0.55;
      ctx.strokeStyle = pal.belly;
      ctx.lineWidth = Math.max(0.7, s * 0.008);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const k = (i + 0.5) / 4;
        ctx.moveTo(L * 0.28, side * Wd * (0.80 + k * 0.02));
        ctx.quadraticCurveTo(L * (0.06 - k * 0.08), side * Wd * (0.98 + k * 0.10),
          -L * (0.06 + k * 0.08), side * (tipOut - Wd * 0.02 - k * Wd * 0.06));
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawPelvics(ctx, s, pal, L, Wd, phase, finMul) {
  const flap = Math.sin(phase + 2.1) * 0.05;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.fillStyle = tint(pal.fin, 'b8');
    ctx.globalAlpha *= 0.40;
    ctx.beginPath();
    ctx.moveTo(-L * 0.34, side * Wd * 0.60);
    ctx.quadraticCurveTo(-L * 0.44, side * Wd * (0.90 + flap) * finMul,
      -L * 0.62, side * Wd * (0.90 + flap) * finMul);
    ctx.quadraticCurveTo(-L * 0.56, side * Wd * 0.78, -L * 0.50, side * Wd * 0.56);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ---------- 头盾 / 星斑 / 鳃裂 ----------
function drawSkin(ctx, s, pal, L, Wd, ty, fine) {
  ctx.save();
  traceBody(ctx, L, Wd, ty);
  ctx.clip();

  // 体侧纵深：靠近轮廓的一圈压暗
  const sideG = cachedLinear(ctx, 'kun-side|' + pal.fin + '|' + Math.round(Wd / 4),
    0, -Wd, 0, Wd,
    [[0, 'rgba(0,0,0,0.34)'], [0.10, 'rgba(0,0,0,0.10)'], [0.24, 'rgba(0,0,0,0)'],
    [0.5, 'rgba(0,0,0,0)'], [0.76, 'rgba(0,0,0,0)'],
    [0.90, 'rgba(0,0,0,0.10)'], [1, 'rgba(0,0,0,0.34)']]);
  ctx.fillStyle = sideG;
  ctx.fillRect(-L, -Wd * 1.1, L * 2.1, Wd * 2.2);

  // 头部骨质区：吻后一段略亮，无硬边
  const shield = cachedLinear(ctx, 'kun-shield|' + pal.belly + '|' + Math.round(L / 8),
    L * 0.96, 0, L * 0.52, 0,
    [[0, tint(pal.belly, '24')], [0.6, tint(pal.belly, '12')], [1, tint(pal.belly, '00')]]);
  ctx.fillStyle = shield;
  ctx.fillRect(-L, -Wd * 1.1, L * 2.1, Wd * 2.2);

  // 背脊星斑：柔光 + 实心两层（提高对比，像古兽的印记）
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = tint(pal.belly, pass ? '9a' : 'ff');
    for (let i = 0; i < SPOTS.length; i++) {
      const q = SPOTS[i];
      const px = q[0] * L;
      const py = q[1] * Wd + bendAt(px, L, ty) * 0.85;
      const r = s * q[2] * (pass ? 2.3 : 1);
      if (r < 0.45) continue;
      ctx.globalAlpha = pass ? q[3] * 0.42 : q[3] * 1.5;
      ctx.beginPath();
      ctx.ellipse(px, py, r * q[4], r, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // 肌理：极淡的纵向流线（大鱼的侧肌走向，不要像鳞片网格）
  if (fine) {
    ctx.strokeStyle = 'rgba(0,0,0,0.055)';
    ctx.lineWidth = Math.max(0.6, s * 0.008);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const k = (i + 1) / 4;
      for (const side of [-1, 1]) {
        ctx.moveTo(L * 0.66, side * Wd * (0.06 + 0.04 * i));
        ctx.bezierCurveTo(L * 0.28, side * Wd * (0.24 + k * 0.34),
          -L * 0.24, side * Wd * (0.30 + k * 0.40), -L * 0.80, side * Wd * 0.12 + ty * 0.7);
      }
    }
    ctx.stroke();
  }

  // 鳃裂：头后成排短弧
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const cnt = fine ? 4 : 3;
    for (let i = 0; i < cnt; i++) {
      const ox = L * (0.50 - i * 0.042);
      // 裂隙本体（暗）
      ctx.strokeStyle = tint(pal.fin, '62');
      ctx.lineWidth = Math.max(1, s * 0.014);
      ctx.beginPath();
      ctx.moveTo(ox, side * Wd * 0.30);
      ctx.quadraticCurveTo(ox + L * 0.026, side * Wd * 0.50, ox - L * 0.014, side * Wd * 0.66);
      ctx.stroke();
      // 裂隙上缘的骨白高光，制造凹槽厚度
      ctx.strokeStyle = tint(pal.belly, '30');
      ctx.lineWidth = Math.max(0.6, s * 0.006);
      ctx.beginPath();
      ctx.moveTo(ox + L * 0.013, side * Wd * 0.305);
      ctx.quadraticCurveTo(ox + L * 0.039, side * Wd * 0.50, ox - L * 0.001, side * Wd * 0.655);
      ctx.stroke();
    }
  }

  // 侧线
  for (const side of [-1, 1]) {
    ctx.strokeStyle = tint(pal.belly, '1c');
    ctx.lineWidth = Math.max(0.7, s * 0.009);
    ctx.beginPath();
    ctx.moveTo(L * 0.28, side * Wd * 0.60);
    ctx.quadraticCurveTo(-L * 0.20, side * Wd * 0.64, -L * 0.80, side * Wd * 0.20 + ty);
    ctx.stroke();
  }

  // 头顶柔光
  const headLit = cachedRadial(ctx, 'kun-headlit|' + pal.belly + '|' + Math.round(s / 2),
    L * 0.80, -Wd * 0.24, s * 0.03, L * 0.74, 0, s * 0.60,
    [[0, tint(pal.belly, '3a')], [0.55, tint(pal.belly, '10')], [1, tint(pal.belly, '00')]]);
  ctx.fillStyle = headLit;
  ctx.fillRect(-L, -Wd * 1.1, L * 2.1, Wd * 2.2);

  // 吻端折线：暗示硬质吻部
  ctx.strokeStyle = tint(pal.belly, '26');
  ctx.lineWidth = Math.max(0.8, s * 0.011);
  ctx.beginPath();
  ctx.moveTo(L * 0.945, -Wd * 0.44);
  ctx.quadraticCurveTo(L * 0.895, -Wd * 0.18, L * 0.90, 0);
  ctx.quadraticCurveTo(L * 0.895, Wd * 0.18, L * 0.945, Wd * 0.44);
  ctx.stroke();

  // 额印：眼间一枚菱形骨纹，古兽的标记（中段化形后透出灵光）
  const markX = L * 0.66, markY = 0;
  const ms = s * 0.13;
  ctx.strokeStyle = tint(pal.fin, '66');
  ctx.lineWidth = Math.max(0.8, s * 0.012);
  ctx.beginPath();
  ctx.moveTo(markX + ms, markY);
  ctx.quadraticCurveTo(markX, markY - ms * 0.62, markX - ms, markY);
  ctx.quadraticCurveTo(markX, markY + ms * 0.62, markX + ms, markY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(markX + ms * 0.42, markY);
  ctx.quadraticCurveTo(markX, markY - ms * 0.26, markX - ms * 0.42, markY);
  ctx.quadraticCurveTo(markX, markY + ms * 0.26, markX + ms * 0.42, markY);
  ctx.stroke();
  ctx.restore();
}

// ---------- 背脊冠 ----------
function drawCrest(ctx, s, pal, L, Wd, ty, fine, form) {
  ctx.save();
  const h = Wd * 0.070;

  // 薄鳍：贴脊窄膜
  const g = cachedLinear(ctx, 'kun-crest|' + pal.fin + '|' + pal.belly + '|' + Math.round(Wd / 4),
    0, -h, 0, h,
    [[0, tint(pal.fin, '00')], [0.30, tint(pal.fin, '2e')], [0.5, tint(pal.fin, '54')],
    [0.70, tint(pal.fin, '2e')], [1, tint(pal.fin, '00')]]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(L * 0.24, 0);
  ctx.bezierCurveTo(L * 0.04, -h, -L * 0.28, -h * 0.92, -L * 0.66, -h * 0.30 + ty * 0.76);
  ctx.quadraticCurveTo(-L * 0.76, ty * 0.86, -L * 0.885, ty);
  ctx.quadraticCurveTo(-L * 0.76, ty * 0.92, -L * 0.66, h * 0.30 + ty * 0.76);
  ctx.bezierCurveTo(-L * 0.28, h * 0.92, L * 0.04, h, L * 0.24, 0);
  ctx.closePath();
  ctx.fill();

  // 脊线：柔和亮带（整条鱼的最高点）
  const ridge = cachedLinear(ctx, 'kun-ridge|' + pal.belly + '|' + Math.round(Wd / 4),
    0, -h * 0.4, 0, h * 0.4,
    [[0, tint(pal.belly, '00')], [0.5, tint(pal.belly, '5c')], [1, tint(pal.belly, '00')]]);
  ctx.strokeStyle = ridge;
  ctx.lineWidth = Math.max(1.2, s * 0.038);
  ctx.beginPath();
  ctx.moveTo(L * 0.28, 0);
  ctx.quadraticCurveTo(-L * 0.14, ty * 0.24, -L * 0.84, ty * 0.94);
  ctx.stroke();

  // 鳍条暗示
  if (fine && s > 30) {
    ctx.strokeStyle = tint(pal.belly, '1c');
    ctx.lineWidth = Math.max(0.6, s * 0.006);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const k = (i + 0.5) / 8;
      const x = L * (0.18 - 0.92 * k);
      const y = ty * k * 0.92;
      const hh = h * Math.sin(Math.PI * k) * 0.9;
      for (const side of [-1, 1]) {
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x - L * 0.010, y + side * hh * 0.6, x - L * 0.022, y + side * hh);
      }
    }
    ctx.stroke();
  }

  // 脊甲：化形中段起浮现的低对比骨节
  if (form > 0.45) {
    const a = (form - 0.45) / 0.55;
    ctx.fillStyle = tint(pal.belly, '18');
    ctx.strokeStyle = tint(pal.belly, '30');
    ctx.lineWidth = Math.max(0.6, s * 0.007);
    for (let i = 0; i < 5; i++) {
      const k = (i + 0.5) / 5;
      const x = L * (0.06 - 0.78 * k);
      const y = ty * k * 0.9;
      const w = s * (0.048 - 0.011 * k);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + w * 0.9, y);
        ctx.quadraticCurveTo(x + w * 0.2, y + side * w * 0.60, x - w * 0.7, y + side * w * 0.15);
        ctx.quadraticCurveTo(x, y + side * w * 0.11, x + w * 0.9, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.strokeStyle = glowA(pal.glow, 0.07 + a * 0.11);
    ctx.lineWidth = Math.max(1, s * 0.010);
    ctx.beginPath();
    ctx.moveTo(L * 0.10, 0);
    ctx.quadraticCurveTo(-L * 0.32, ty * 0.24, -L * 0.84, ty * 0.92);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- 须（自吻侧贴体向后垂） ----------
function drawBarbels(ctx, s, pal, L, Wd, p, form, fine) {
  if (form < 0.45) return;
  const wave = Math.sin(p.tailPhase * 1.05 + 0.6);
  ctx.save();
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    // 起点在吻侧，沿体侧轮廓内侧向后收，末端不外甩
    const tipX = L * (0.50 - 0.04 * form) + wave * s * 0.03;
    const tipY = side * Wd * (0.88 + 0.06 * form) + wave * s * 0.02 * side;
    ctx.strokeStyle = mix(pal.fin, pal.belly, 0.62);
    ctx.lineWidth = Math.max(1, s * 0.014);
    ctx.beginPath();
    ctx.moveTo(L * 0.92, side * Wd * 0.42);
    ctx.bezierCurveTo(L * 0.84, side * Wd * 0.70, L * 0.68, side * Wd * 0.86, tipX, tipY);
    ctx.stroke();

    // 尖端渐细，微微内收
    ctx.lineWidth = Math.max(0.7, s * 0.008);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.quadraticCurveTo(tipX - L * 0.08, tipY - side * Wd * 0.02,
      tipX - L * 0.15, tipY - side * Wd * 0.03);
    ctx.stroke();

    if (fine && form > 0.85) {
      drawGlow(ctx, tipX - L * 0.15, tipY - side * Wd * 0.03, s * 0.09, pal.glow, 0.13);
    }
  }
  ctx.restore();
}

// ---------- 眼 ----------
function drawEyes(ctx, s, pal, L, Wd, form) {
  const ex = L * 0.795, ey = Wd * 0.50;
  const r = Math.max(1.5, s * 0.068);
  const dark = mix(pal.fin, '#06080b', 0.72);
  for (const side of [-1, 1]) {
    const cy = side * ey;

    // 眼窝：头盾上的浅凹
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(ex, cy, r * 1.75, r * 1.50, 0, 0, TAU);
    ctx.fill();

    if (form > 0.45) drawGlow(ctx, ex, cy, r * 1.9, pal.glow, 0.06 + form * 0.08);

    // 眼球
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(ex, cy, r, 0, TAU);
    ctx.fill();

    // 虹膜：靠前的暖色光
    const iris = cachedRadial(ctx, 'kun-iris|' + pal.body + '|' + pal.belly + '|' + Math.round(r * 2),
      ex + r * 0.12, cy, 0, ex, cy, r * 0.95,
      [[0, mix(pal.body, pal.belly, 0.75)], [0.55, mix(pal.body, pal.fin, 0.18)], [1, 'rgba(0,0,0,0)']]);
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(ex, cy, r * 0.95, 0, TAU);
    ctx.fill();

    // 竖裂瞳孔
    ctx.fillStyle = 'rgba(3,5,8,0.94)';
    ctx.beginPath();
    ctx.ellipse(ex + r * 0.14, cy, r * 0.22, r * 0.62, 0, 0, TAU);
    ctx.fill();

    // 高光
    ctx.fillStyle = 'rgba(255,255,255,0.90)';
    ctx.beginPath();
    ctx.arc(ex - r * 0.24, cy - side * r * 0.26, r * 0.23, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.beginPath();
    ctx.arc(ex + r * 0.30, cy + side * r * 0.30, r * 0.10, 0, TAU);
    ctx.fill();

    // 上眼睑
    ctx.strokeStyle = tint(pal.fin, 'a8');
    ctx.lineWidth = Math.max(1, r * 0.28);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(ex, cy, r * 1.02, side < 0 ? Math.PI * 1.04 : Math.PI * 0.00,
      side < 0 ? Math.PI * 1.54 : Math.PI * 0.50);
    ctx.stroke();
  }
}

// ---------- 嘴 ----------
function drawMouth(ctx, s, pal, L, Wd, m, form, fine) {
  const open = clamp01(m);
  const jaw = Wd * (0.10 + 0.30 * open);
  const snout = L * (0.985 + 0.02 * open);     // 吻端
  const corner = L * (0.86 - 0.06 * open);     // 口角
  const back = L * (0.92 - 0.08 * open);       // 口腔后壁

  if (open < 0.06) {
    // 闭口：吻端一道浅弧唇缝
    ctx.lineCap = 'round';
    ctx.strokeStyle = tint(pal.fin, 'a8');
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    ctx.moveTo(L * 0.955, -Wd * 0.32);
    ctx.quadraticCurveTo(L * 1.000, 0, L * 0.955, Wd * 0.32);
    ctx.stroke();
    ctx.strokeStyle = tint(pal.belly, '4c');
    ctx.lineWidth = Math.max(0.7, s * 0.011);
    ctx.beginPath();
    ctx.moveTo(L * 0.935, -Wd * 0.36);
    ctx.quadraticCurveTo(L * 0.982, 0, L * 0.935, Wd * 0.36);
    ctx.stroke();
    return;
  }

  // 张口：前缘圆钝、口角外张的弧形大口（俯视）
  const cavity = () => {
    ctx.beginPath();
    ctx.moveTo(snout, 0);
    ctx.quadraticCurveTo(L * 0.965, -jaw * 0.78, corner, -jaw);
    ctx.quadraticCurveTo(back, -jaw * 0.50, back, 0);
    ctx.quadraticCurveTo(back, jaw * 0.50, corner, jaw);
    ctx.quadraticCurveTo(L * 0.965, jaw * 0.78, snout, 0);
    ctx.closePath();
  };

  // 口腔：中心近黑、边缘融入鳍色，做出深喉
  const th = cachedRadial(ctx, 'kun-throat|' + pal.fin + '|' + Math.round(L / 4) + '|' + Math.round(jaw / 2),
    L * 0.90, 0, s * 0.02, L * 0.90, 0, jaw * 1.40,
    [[0, 'rgba(4,1,1,0.98)'], [0.40, 'rgba(26,8,3,0.96)'], [1, mix(pal.fin, '#1c0a04', 0.20)]]);
  ctx.fillStyle = th;
  cavity();
  ctx.fill();

  if (form > 0.45) drawGlow(ctx, L * 0.88, 0, jaw * 0.9, pal.glow, 0.05 + form * 0.08);

  // 舌根暖光
  ctx.fillStyle = tint(pal.fin, '44');
  ctx.beginPath();
  ctx.ellipse(L * (0.905 - 0.02 * open), 0, L * 0.020, jaw * 0.26, 0, 0, TAU);
  ctx.fill();

  // 唇缘：上唇亮、下唇沉
  ctx.lineCap = 'round';
  ctx.strokeStyle = tint(pal.belly, '96');
  ctx.lineWidth = Math.max(1, s * 0.020);
  ctx.beginPath();
  ctx.moveTo(snout, 0);
  ctx.quadraticCurveTo(L * 0.965, -jaw * 0.78, corner, -jaw);
  ctx.stroke();
  ctx.strokeStyle = mix(pal.belly, pal.fin, 0.36);
  ctx.beginPath();
  ctx.moveTo(snout, 0);
  ctx.quadraticCurveTo(L * 0.965, jaw * 0.78, corner, jaw);
  ctx.stroke();

  // 口角暗缝 + 向后延伸的颌线（让头部有咬合结构）
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = Math.max(0.7, s * 0.010);
  ctx.beginPath();
  ctx.moveTo(corner, -jaw);
  ctx.quadraticCurveTo(back, -jaw * 0.50, back, 0);
  ctx.quadraticCurveTo(back, jaw * 0.50, corner, jaw);
  ctx.stroke();

  // 颌线：自口角向后上、后下各引一道细弧
  ctx.strokeStyle = tint(pal.fin, '5a');
  ctx.lineWidth = Math.max(0.8, s * 0.011);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(corner, side * jaw * 1.02);
    ctx.quadraticCurveTo(L * (0.60 - 0.04 * open), side * Wd * 0.30,
      L * (0.52 - 0.04 * open), side * Wd * 0.16);
    ctx.stroke();
  }
}

// ---------- 化形纹 ----------
function drawFormMarks(ctx, s, pal, L, Wd, ty, form) {
  if (form < 0.6) return;
  const a = (form - 0.6) / 0.4;
  ctx.save();
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      ctx.strokeStyle = glowA(pal.glow, (0.07 + a * 0.16) * (i ? 0.6 : 1));
      ctx.lineWidth = Math.max(1, s * (0.014 + a * 0.010));
      const off = i * Wd * 0.17;
      ctx.beginPath();
      ctx.moveTo(L * 0.20, side * (Wd * 0.46 + off));
      ctx.bezierCurveTo(-L * 0.12, side * (Wd * 0.62 + off),
        -L * 0.48, side * (Wd * 0.46 + off * 0.5), -L * 0.78, side * Wd * 0.16 + ty);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ============================================================
export function draw(ctx, s, pal, p, b) {
  const L = s * 1.96 * (b.len || 1);
  const Wd = s * 0.78 * (b.wide || 1);
  const finMul = 0.9 + 0.1 * (b.fin || 1);
  const form = clamp01((p.formIndex || 0) / 4);
  const fine = s >= 22;                       // 小体型减细节，保持剪影干净
  const glow = pal.glow || 'rgba(255,220,150,ALPHA)';
  const p2 = { ...pal, glow };
  const ty = Math.sin(p.tailPhase) * Wd * 0.15;

  ctx.save();
  ctx.lineJoin = 'round';

  // 体内灵光
  if (form > 0.05) drawGlow(ctx, 0, 0, L * 0.92, glow, 0.05 + form * 0.10);

  // 1. 鳍（垫在身体之下）
  drawTail(ctx, s, pal, L, Wd, ty, p.tailPhase, finMul, fine);
  drawPelvics(ctx, s, pal, L, Wd, p.tailPhase, finMul);
  drawPectorals(ctx, s, pal, L, Wd, p.tailPhase, finMul, fine);

  // 2. 主体：侧缘深、脊背亮
  const qWd = Math.round(Wd / 4) * 4;
  const bodyG = cachedLinear(ctx, 'kun-body|' + pal.body + '|' + pal.belly + '|' + pal.fin + '|' + qWd,
    0, -qWd, 0, qWd,
    [[0, mix(pal.body, pal.fin, 0.78)], [0.06, mix(pal.body, pal.fin, 0.36)],
    [0.19, pal.body], [0.34, mix(pal.body, pal.belly, 0.22)],
    [0.5, mix(pal.body, pal.belly, 0.42)],
    [0.66, mix(pal.body, pal.belly, 0.22)], [0.81, pal.body],
    [0.94, mix(pal.body, pal.fin, 0.36)], [1, mix(pal.body, pal.fin, 0.78)]]);
  ctx.fillStyle = bodyG;
  traceBody(ctx, L, Wd, ty);
  ctx.fill();

  // 3. 体内光影与纹理
  ctx.save();
  traceBody(ctx, L, Wd, ty);
  ctx.clip();

  // 背部湿光
  const sheen = cachedRadial(ctx, 'kun-sheen|' + pal.belly + '|' + Math.round(L / 8),
    L * 0.06, -Wd * 0.10, s * 0.10, L * 0.00, 0, L * 1.00,
    [[0, tint(pal.belly, '3c')], [0.5, tint(pal.belly, '10')], [1, tint(pal.belly, '00')]]);
  ctx.fillStyle = sheen;
  ctx.fillRect(-L, -Wd * 1.1, L * 2.1, Wd * 2.2);

  // 尾柄收暗
  const tailShade = cachedLinear(ctx, 'kun-tailshade|' + pal.fin + '|' + Math.round(L / 8),
    -L * 0.55, 0, -L * 0.93, 0,
    [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.20)']]);
  ctx.fillStyle = tailShade;
  ctx.fillRect(-L, -Wd * 1.1, L * 2.1, Wd * 2.2);

  drawSkin(ctx, s, pal, L, Wd, ty, fine);
  drawFormMarks(ctx, s, pal, L, Wd, ty, form);
  ctx.restore();

  // 4. 轮廓：深边收形 + 上缘暖光
  traceBody(ctx, L, Wd, ty);
  ctx.strokeStyle = mix(pal.fin, pal.body, 0.10);
  ctx.lineWidth = Math.max(1.4, s * 0.034);
  ctx.stroke();

  traceEdge(ctx, L, Wd, ty, -1);
  ctx.strokeStyle = tint(pal.belly, '54');
  ctx.lineWidth = Math.max(0.9, s * 0.015);
  ctx.stroke();

  // 5. 脊冠 / 须 / 眼 / 嘴
  drawCrest(ctx, s, pal, L, Wd, ty, fine, form);
  drawBarbels(ctx, s, p2, L, Wd, p, form, fine);
  drawEyes(ctx, s, p2, L, Wd, form);
  drawMouth(ctx, s, p2, L, Wd, p.mouthOpen || 0, form, fine);

  ctx.restore();
}