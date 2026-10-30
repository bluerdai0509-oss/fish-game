// ============================================================
// 种族 · 鳌（龙伯钓鳌 · 背负仙山的巨龟）
// 契约：export function draw(ctx, s, pal, p, b)
//   ctx  已经 translate 到中心、rotate 到朝向（头朝 +x）
//   s    半径基准 17~22
//   pal  { body, belly, fin, glow }
//   p    玩家状态 { tailPhase, mouthOpen, formIndex, ... }
//   b    体型构建参数 { len, wide, fin }
//
// 设计：俯视看到龟背。
//   · 甲壳分四层：壳壁（厚度）→ 缘盾圈 → 内甲（肋盾 8 + 椎盾 5 + 颈盾）
//   · 缘盾外缘做成扇贝形凸弧，这是"龟"最强的识别特征
//   · 每片甲片按自身外接框拉伸同一张单位渐变，做出独立的鼓包
//   · 四肢是带肩球与肘弯的桨状鳍足，划水相位错开
// ============================================================
import { TAU, cachedLinear, cachedRadial } from '../engine/draw-common.js';

// ============================================================
// 一、甲壳几何
// 归一化坐标：x 沿身长（前 +），y 沿身宽。绘制时乘 L / Wd。
// ============================================================

// 缘盾圈的 11 个基准点（右半边，从前中到后中）
const ANCHOR_HALF = [
  [0.985, 0.000], [0.950, 0.300], [0.800, 0.600], [0.580, 0.820],
  [0.300, 0.960], [-0.020, 1.020], [-0.340, 0.990], [-0.600, 0.880],
  [-0.800, 0.680], [-0.930, 0.380], [-0.970, 0.000],
];

const MARGIN_N = 20;      // 缘盾片数
const MARGIN_IN = 0.800;  // 缘盾内缘比例
const SCALLOP = 0.034;    // 缘盾外缘外凸量（相对半径）

/** 闭合的 20 个缘盾基准点 */
const ANCHORS = (() => {
  const pts = ANCHOR_HALF.map((p) => [p[0], p[1]]);
  for (let i = 9; i >= 1; i--) pts.push([ANCHOR_HALF[i][0], -ANCHOR_HALF[i][1]]);
  return pts; // 20 个：0=前中 … 10=后中 … 19=前中下方
})();

/** 每段缘盾外缘的外凸控制点（沿原点方向外推） */
const BULGES = (() => {
  const out = [];
  for (let i = 0; i < MARGIN_N; i++) {
    const a = ANCHORS[i], b = ANCHORS[(i + 1) % MARGIN_N];
    let mx = (a[0] + b[0]) * 0.5, my = (a[1] + b[1]) * 0.5;
    const r = Math.hypot(mx, my) || 1;
    const k = 1 + SCALLOP / r;
    out.push([mx * k, my * k]);
  }
  return out;
})();

/** 缘盾内缘点 */
const INNER = ANCHORS.map((p) => [p[0] * MARGIN_IN, p[1] * MARGIN_IN]);

// ============================================================
// 二、内甲片（归一化，只写右半边，绘制时按 side 镜像）
// ============================================================
const COSTALS = [
  // 前肋盾
  [[0.550, 0.145], [0.310, 0.215], [0.290, 0.560], [0.520, 0.680], [0.700, 0.420], [0.730, 0.240]],
  // 中前肋盾
  [[0.310, 0.215], [0.060, 0.255], [0.040, 0.730], [0.260, 0.800], [0.520, 0.680], [0.290, 0.560]],
  // 中后肋盾
  [[0.060, 0.255], [-0.220, 0.245], [-0.200, 0.790], [0.040, 0.815], [0.260, 0.800], [0.040, 0.730]],
  // 后肋盾
  [[-0.220, 0.245], [-0.500, 0.170], [-0.460, 0.710], [-0.200, 0.790]],
];

const VERTEBRALS = [
  [[0.550, -0.145], [0.550, 0.145], [0.450, 0.215], [0.310, 0.215],
   [0.310, -0.215], [0.450, -0.215]],
  [[0.310, -0.215], [0.310, 0.215], [0.185, 0.250], [0.060, 0.255],
   [0.060, -0.255], [0.185, -0.250]],
  [[0.060, -0.255], [0.060, 0.255], [-0.085, 0.262], [-0.220, 0.245],
   [-0.220, -0.245], [-0.085, -0.262]],
  [[-0.220, -0.245], [-0.220, 0.245], [-0.360, 0.228], [-0.500, 0.170],
   [-0.500, -0.170], [-0.360, -0.228]],
  [[-0.500, -0.170], [-0.500, 0.170], [-0.590, 0.132], [-0.665, 0.055],
   [-0.665, -0.055], [-0.590, -0.132]],
];

const NUCHAL = [[0.870, 0], [0.790, 0.190], [0.580, 0.160], [0.580, -0.160], [0.790, -0.190]];

/** 甲片质心与外接框（归一化），预计算一次 */
function plateInfo(poly) {
  let cx = 0, cy = 0;
  for (const v of poly) { cx += v[0]; cy += v[1]; }
  cx /= poly.length; cy /= poly.length;
  let rx = 0, ry = 0;
  for (const v of poly) {
    rx = Math.max(rx, Math.abs(v[0] - cx));
    ry = Math.max(ry, Math.abs(v[1] - cy));
  }
  return { poly, cx, cy, rx: Math.max(rx, 0.02), ry: Math.max(ry, 0.02) };
}

const COSTAL_INFO = COSTALS.map(plateInfo);
const VERT_INFO = VERTEBRALS.map(plateInfo);
const NUCHAL_INFO = plateInfo(NUCHAL);

// ============================================================
// 三、小工具
// ============================================================
const q2 = (v) => Math.max(2, Math.round(v / 2) * 2);

// ---------- 配色混合（缓存，避免每帧解析十六进制）----------
const _mixCache = new Map();
function hexToRgb(h) {
  if (typeof h !== 'string' || h[0] !== '#' || h.length !== 7) return null;
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** 两色调和，t=0 取 a，t=1 取 b；不支持的颜色原样返回 a */
function mix(a, b, t) {
  const key = a + '|' + b + '|' + t;
  let c = _mixCache.get(key);
  if (c) return c;
  const ca = hexToRgb(a), cb = hexToRgb(b);
  if (!ca || !cb) {
    c = a;
  } else {
    c = 'rgb(' + Math.round(ca[0] + (cb[0] - ca[0]) * t) + ','
      + Math.round(ca[1] + (cb[1] - ca[1]) * t) + ','
      + Math.round(ca[2] + (cb[2] - ca[2]) * t) + ')';
  }
  if (_mixCache.size > 240) _mixCache.clear();
  _mixCache.set(key, c);
  return c;
}

/** 描出甲壳外轮廓（含缘盾扇贝边）；k 为整体缩放 */
function traceShell(ctx, L, Wd, k) {
  ctx.beginPath();
  ctx.moveTo(ANCHORS[0][0] * L * k, ANCHORS[0][1] * Wd * k);
  for (let i = 0; i < MARGIN_N; i++) {
    const b = BULGES[i], a = ANCHORS[(i + 1) % MARGIN_N];
    ctx.quadraticCurveTo(b[0] * L * k, b[1] * Wd * k, a[0] * L * k, a[1] * Wd * k);
  }
  ctx.closePath();
}

/** 描出归一化甲片多边形 */
function tracePoly(ctx, poly, L, Wd, side) {
  ctx.beginPath();
  for (let i = 0; i < poly.length; i++) {
    const x = poly[i][0] * L, y = poly[i][1] * Wd * side;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 甲片路径（屏幕坐标，side 已镜像） */
function pathPlate(ctx, info, L, Wd, side) {
  tracePoly(ctx, info.poly, L, Wd, side);
}

/** 以甲片质心为原点按 k 内缩描边 */
function tracePolyScaled(ctx, info, L, Wd, side, k) {
  ctx.beginPath();
  for (let i = 0; i < info.poly.length; i++) {
    const px = (info.cx + (info.poly[i][0] - info.cx) * k) * L;
    const py = (info.cy + (info.poly[i][1] - info.cy) * k) * Wd * side;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * 单片甲片的立体化（宝石式切削）：
 *   1) 整片填深色 → 留下硬边，成为甲片之间的厚缝
 *   2) 内缩面用单位渐变拉伸 → 每片独立鼓起的弧面
 *   3) 内缩面外缘再描一道暗线 → 甲片与厚缝之间的台阶
 * 单位渐变按 CTM 拉伸复用，不会每帧新建渐变对象
 */
function shadePlate(ctx, s, info, L, Wd, side, pal, unitGrad, dark) {
  const sx = info.rx * L, sy = info.ry * Wd;
  if (!(sx > 1.5 && sy > 1.5)) return;

  // 1) 整片填弧面渐变：局部单位坐标，经 CTM 拉伸后贴合甲片形状
  ctx.save();
  ctx.translate(info.cx * L, info.cy * Wd * side);
  ctx.scale(sx, sy);
  ctx.beginPath();
  for (let i = 0; i < info.poly.length; i++) {
    const vx = (info.poly[i][0] - info.cx) / info.rx;
    const vy = (info.poly[i][1] - info.cy) / info.ry;
    if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.fillStyle = unitGrad;
  ctx.fill();
  ctx.restore();

  // 2) 整片描深色缝：相邻两片各描一次，共用边就自然变成更深的沟
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1.1, s * 0.030);
  pathPlate(ctx, info, L, Wd, side);
  ctx.stroke();

  // 3) 内缩一圈的窄亮边：甲片边缘被打磨出的倒角
  ctx.save();
  ctx.strokeStyle = pal.belly;
  ctx.globalAlpha *= 0.34;
  // 注意：此处已按甲片外接框缩放，lineWidth 是局部单位，需换算回屏幕尺度
  ctx.lineWidth = Math.max(0.9, s * 0.022) / Math.max(1, Math.min(sx, sy));
  ctx.translate(info.cx * L, info.cy * Wd * side);
  ctx.scale(sx, sy);
  ctx.beginPath();
  for (let i = 0; i < info.poly.length; i++) {
    const vx = (info.poly[i][0] - info.cx) / info.rx * 0.855;
    const vy = (info.poly[i][1] - info.cy) / info.ry * 0.855;
    if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// 四、鳍足
// ============================================================
/**
 * 桨状鳍足。局部坐标：从肩点出发，+y 指向体外。
 * @param sz  长度尺度（px）
 * @param wid 宽度倍率
 */
function drawFlipper(ctx, s, pal, x, y, side, ang, sz, wid) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(side * ang);
  ctx.scale(wid, side);

  // 水下投影
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.beginPath();
  ctx.ellipse(0.02 * sz, 0.54 * sz, 0.34 * sz, 0.44 * sz, -0.12, 0, TAU);
  ctx.fill();

  // ---- 上臂：从肩球到肘弯，略收腰 ----
  const ag = cachedLinear(ctx, 'aoArm|' + pal.body + '|' + pal.fin + '|' + q2(sz),
    -0.26 * sz, 0.05 * sz, 0.26 * sz, 0.36 * sz,
    [[0, pal.fin], [0.34, pal.body], [1, pal.body]]);
  ctx.fillStyle = ag;
  ctx.beginPath();
  ctx.moveTo(0.24 * sz, -0.02 * sz);
  ctx.quadraticCurveTo(0.20 * sz, 0.24 * sz, 0.24 * sz, 0.38 * sz);
  ctx.lineTo(-0.26 * sz, 0.38 * sz);
  ctx.quadraticCurveTo(-0.30 * sz, 0.18 * sz, -0.26 * sz, 0.00 * sz);
  ctx.quadraticCurveTo(-0.02 * sz, -0.10 * sz, 0.24 * sz, -0.02 * sz);
  ctx.closePath();
  ctx.fill();

  // 肘弯（关节处的深色褶皱）
  ctx.strokeStyle = pal.fin;
  ctx.globalAlpha *= 0.40;
  ctx.lineWidth = Math.max(0.8, sz * 0.040);
  ctx.beginPath();
  ctx.moveTo(0.24 * sz, 0.36 * sz);
  ctx.quadraticCurveTo(0.00 * sz, 0.29 * sz, -0.27 * sz, 0.36 * sz);
  ctx.stroke();
  ctx.globalAlpha /= 0.40;

  // ---- 桨叶：宽根、圆钝桨尖 ----
  const tg = cachedLinear(ctx, 'aoFin|' + pal.body + '|' + pal.fin + '|' + q2(sz),
    -0.34 * sz, 0.34 * sz, 0.30 * sz, 0.95 * sz,
    [[0, pal.body], [0.42, pal.body], [1, pal.fin]]);
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(0.30 * sz, 0.32 * sz);
  ctx.bezierCurveTo(0.34 * sz, 0.52 * sz, 0.26 * sz, 0.72 * sz, 0.10 * sz, 0.86 * sz);
  ctx.quadraticCurveTo(0.00 * sz, 0.94 * sz, -0.10 * sz, 0.86 * sz);
  ctx.bezierCurveTo(-0.26 * sz, 0.72 * sz, -0.34 * sz, 0.52 * sz, -0.30 * sz, 0.32 * sz);
  ctx.quadraticCurveTo(0.00 * sz, 0.24 * sz, 0.30 * sz, 0.32 * sz);
  ctx.closePath();
  ctx.fill();

  // 指骨分节
  ctx.globalAlpha *= 0.28;
  ctx.lineWidth = Math.max(0.7, sz * 0.028);
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo((0.12 + i * 0.11) * sz, 0.36 * sz);
    ctx.quadraticCurveTo((0.09 + i * 0.11) * sz, 0.60 * sz, (0.04 + i * 0.08) * sz, 0.82 * sz);
    ctx.stroke();
  }
  ctx.globalAlpha /= 0.28;

  // 外侧缘高光
  ctx.strokeStyle = pal.belly;
  ctx.globalAlpha *= 0.40;
  ctx.lineWidth = Math.max(0.9, sz * 0.042);
  ctx.beginPath();
  ctx.moveTo(0.30 * sz, 0.32 * sz);
  ctx.bezierCurveTo(0.34 * sz, 0.52 * sz, 0.26 * sz, 0.72 * sz, 0.10 * sz, 0.86 * sz);
  ctx.stroke();
  ctx.globalAlpha /= 0.40;

  // 外轮廓
  ctx.strokeStyle = pal.fin;
  ctx.globalAlpha *= 0.85;
  ctx.lineWidth = Math.max(1, sz * 0.050);
  ctx.beginPath();
  ctx.moveTo(0.30 * sz, 0.32 * sz);
  ctx.bezierCurveTo(0.34 * sz, 0.52 * sz, 0.26 * sz, 0.72 * sz, 0.10 * sz, 0.86 * sz);
  ctx.quadraticCurveTo(0.00 * sz, 0.94 * sz, -0.10 * sz, 0.86 * sz);
  ctx.bezierCurveTo(-0.26 * sz, 0.72 * sz, -0.34 * sz, 0.52 * sz, -0.30 * sz, 0.32 * sz);
  ctx.stroke();
  ctx.globalAlpha /= 0.85;

  // 肩球压在最上，做出"从壳下伸出"的关系
  const sg = cachedRadial(ctx, 'aoShoulder|' + pal.body + '|' + pal.belly + '|' + pal.fin + '|' + q2(sz),
    -0.10 * sz, -0.10 * sz, 0.02 * sz,
    0, 0.02 * sz, 0.38 * sz,
    [[0, pal.belly], [0.34, pal.body], [1, pal.fin]]);
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.ellipse(0, 0.03 * sz, 0.30 * sz, 0.25 * sz, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = pal.fin;
  ctx.globalAlpha *= 0.45;
  ctx.lineWidth = Math.max(0.8, sz * 0.034);
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// 五、头部
// ============================================================
function drawHead(ctx, s, L, Wd, pal, p) {
  const m = Math.max(0, Math.min(1, p.mouthOpen || 0));
  const sway = Math.sin(p.tailPhase * 0.8) * 0.012 * L;
  const hk = 1.16; // 头部整体放大，压得住厚重的甲壳

  ctx.save();
  // 以壳前缘为支点缩放，保证颈部仍插在壳下
  ctx.translate(L * 0.96, 0);
  ctx.scale(hk, hk);
  ctx.translate(-L * 0.96, 0);
  ctx.translate(0, sway);

  // ---- 颈（后半没入壳沿）----
  const ng = cachedLinear(ctx, 'aoNeck|' + pal.body + '|' + pal.fin + '|' + q2(Wd),
    0, -0.30 * Wd, 0, 0.30 * Wd,
    [[0, pal.fin], [0.30, pal.body], [0.70, pal.body], [1, pal.fin]]);
  ctx.fillStyle = ng;
  ctx.beginPath();
  ctx.moveTo(0.72 * L, -0.26 * Wd);
  ctx.quadraticCurveTo(0.86 * L, -0.29 * Wd, 1.02 * L, -0.27 * Wd);
  ctx.lineTo(1.02 * L, 0.27 * Wd);
  ctx.quadraticCurveTo(0.86 * L, 0.29 * Wd, 0.72 * L, 0.26 * Wd);
  ctx.closePath();
  ctx.fill();

  // 颈褶（三道，越靠头越密）
  ctx.strokeStyle = pal.fin;
  ctx.globalAlpha *= 0.34;
  ctx.lineWidth = Math.max(0.7, s * 0.024);
  for (const k of [0.83, 0.90, 0.96]) {
    ctx.beginPath();
    ctx.moveTo(k * L, -0.235 * Wd);
    ctx.quadraticCurveTo((k + 0.02) * L, 0, k * L, 0.235 * Wd);
    ctx.stroke();
  }
  ctx.globalAlpha /= 0.34;

  // ---- 颅骨：后宽前窄的楔形 ----
  const hg = cachedRadial(ctx, 'aoHead|' + pal.body + '|' + pal.belly + '|' + pal.fin + '|' + q2(Wd),
    1.12 * L, -0.13 * Wd, s * 0.04,
    1.18 * L, 0, s * 0.95,
    [[0, pal.belly], [0.30, pal.body], [0.74, pal.body], [1, pal.fin]]);
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(0.885 * L, 0);
  ctx.bezierCurveTo(0.905 * L, -0.15 * Wd, 0.975 * L, -0.27 * Wd, 1.075 * L, -0.305 * Wd);
  ctx.bezierCurveTo(1.195 * L, -0.335 * Wd, 1.315 * L, -0.290 * Wd, 1.395 * L, -0.205 * Wd);
  ctx.bezierCurveTo(1.455 * L, -0.145 * Wd, 1.495 * L, -0.090 * Wd, 1.520 * L, -0.052 * Wd);
  ctx.quadraticCurveTo(1.545 * L, 0, 1.520 * L, 0.052 * Wd);
  ctx.bezierCurveTo(1.495 * L, 0.090 * Wd, 1.455 * L, 0.145 * Wd, 1.395 * L, 0.205 * Wd);
  ctx.bezierCurveTo(1.315 * L, 0.290 * Wd, 1.195 * L, 0.335 * Wd, 1.075 * L, 0.305 * Wd);
  ctx.bezierCurveTo(0.975 * L, 0.27 * Wd, 0.905 * L, 0.15 * Wd, 0.885 * L, 0);
  ctx.closePath();
  ctx.fill();

  // 颅顶高光
  const hl = cachedRadial(ctx, 'aoHeadHi|' + q2(Wd),
    1.10 * L, -0.12 * Wd, 0,
    1.12 * L, -0.05 * Wd, s * 0.44,
    [[0, 'rgba(255,255,255,0.26)'], [1, 'rgba(255,255,255,0)']]);
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.ellipse(1.10 * L, -0.05 * Wd, 0.20 * L, 0.21 * Wd, -0.15, 0, TAU);
  ctx.fill();

  // 颅顶鳞列：沿中线向后收的两排小鳞
  ctx.strokeStyle = pal.fin;
  ctx.globalAlpha *= 0.30;
  ctx.lineWidth = Math.max(0.8, s * 0.026);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0.99 * L, side * 0.035 * Wd);
    ctx.quadraticCurveTo(1.07 * L, side * 0.14 * Wd, 1.15 * L, side * 0.165 * Wd);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(1.07 * L, side * 0.030 * Wd);
    ctx.quadraticCurveTo(1.15 * L, side * 0.11 * Wd, 1.24 * L, side * 0.135 * Wd);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(1.15 * L, side * 0.028 * Wd);
    ctx.quadraticCurveTo(1.23 * L, side * 0.085 * Wd, 1.31 * L, side * 0.100 * Wd);
    ctx.stroke();
  }
  ctx.globalAlpha /= 0.30;

  // 中线脊：一条浅色高光，强调头骨的隆起
  ctx.strokeStyle = pal.belly;
  ctx.globalAlpha *= 0.20;
  ctx.lineWidth = Math.max(0.9, s * 0.045);
  ctx.beginPath();
  ctx.moveTo(0.95 * L, 0);
  ctx.quadraticCurveTo(1.18 * L, 0, 1.36 * L, 0);
  ctx.stroke();
  ctx.globalAlpha /= 0.20;

  // ---- 眉脊：一块凸起的骨质，压出凶相 ----
  for (const side of [-1, 1]) {
    ctx.fillStyle = pal.body;
    ctx.beginPath();
    ctx.moveTo(1.16 * L, side * 0.235 * Wd);
    ctx.quadraticCurveTo(1.26 * L, side * 0.285 * Wd, 1.36 * L, side * 0.215 * Wd);
    ctx.quadraticCurveTo(1.27 * L, side * 0.225 * Wd, 1.16 * L, side * 0.190 * Wd);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = pal.fin;
    ctx.globalAlpha *= 0.55;
    ctx.lineWidth = Math.max(0.9, s * 0.032);
    ctx.stroke();
    ctx.globalAlpha /= 0.55;
  }

  // ---- 喙：角质钩喙 ----
  const bg = cachedLinear(ctx, 'aoBeak|' + pal.belly + '|' + pal.fin + '|' + q2(Wd),
    1.37 * L, -0.13 * Wd, 1.55 * L, 0.13 * Wd,
    [[0, pal.fin], [0.22, pal.belly], [0.66, pal.belly], [1, pal.body]]);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(1.360 * L, -0.130 * Wd);
  ctx.quadraticCurveTo(1.470 * L, -0.118 * Wd, 1.532 * L, -0.045 * Wd);
  ctx.quadraticCurveTo(1.558 * L, 0, 1.532 * L, 0.045 * Wd);
  ctx.quadraticCurveTo(1.470 * L, 0.118 * Wd, 1.360 * L, 0.130 * Wd);
  ctx.quadraticCurveTo(1.395 * L, 0, 1.360 * L, -0.130 * Wd);
  ctx.closePath();
  ctx.fill();

  // 喙面棱线
  ctx.strokeStyle = pal.fin;
  ctx.globalAlpha *= 0.30;
  ctx.lineWidth = Math.max(0.7, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(1.400 * L, -0.080 * Wd);
  ctx.quadraticCurveTo(1.470 * L, 0, 1.400 * L, 0.080 * Wd);
  ctx.stroke();
  ctx.globalAlpha /= 0.30;

  // 喙缝 / 张口
  if (m > 0.06) {
    const jaw = Wd * 0.105 * m;
    ctx.fillStyle = 'rgba(24,9,3,0.92)';
    ctx.beginPath();
    ctx.moveTo(1.565 * L, 0);
    ctx.quadraticCurveTo(1.480 * L, -jaw * 0.62, 1.370 * L, -jaw);
    ctx.quadraticCurveTo(1.415 * L, 0, 1.370 * L, jaw);
    ctx.quadraticCurveTo(1.480 * L, jaw * 0.62, 1.565 * L, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = pal.belly;
    ctx.globalAlpha *= 0.75;
    ctx.lineWidth = Math.max(1, s * 0.030);
    ctx.beginPath();
    ctx.moveTo(1.370 * L, -jaw);
    ctx.quadraticCurveTo(1.480 * L, -jaw * 0.62, 1.565 * L, 0);
    ctx.quadraticCurveTo(1.480 * L, jaw * 0.62, 1.370 * L, jaw);
    ctx.stroke();
    ctx.globalAlpha /= 0.75;
  } else {
    ctx.strokeStyle = 'rgba(28,11,4,0.68)';
    ctx.lineWidth = Math.max(0.9, s * 0.028);
    ctx.beginPath();
    ctx.moveTo(1.372 * L, -0.098 * Wd);
    ctx.quadraticCurveTo(1.470 * L, 0, 1.372 * L, 0.098 * Wd);
    ctx.stroke();
  }

  // 鼻孔
  ctx.fillStyle = 'rgba(22,9,4,0.70)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(1.492 * L, side * 0.038 * Wd, Math.max(0.7, s * 0.016), 0, TAU);
    ctx.fill();
  }

  // ---- 眼：琥珀竖瞳，压在眉脊下 ----
  const ex = 1.245 * L, ey = 0.185 * Wd, er = Math.max(1.8, s * 0.098);
  const ig = cachedRadial(ctx, 'aoIris|' + Math.round(er * 10),
    ex - er * 0.30, -ey - er * 0.30, er * 0.1,
    ex, -ey, er * 1.05,
    [[0, '#fff8d6'], [0.40, '#f6c75f'], [0.78, '#c07f22'], [1, '#66360a']]);
  for (const side of [-1, 1]) {
    const y = side * ey;
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(ex + er * 0.14, y + er * 0.18, er * 1.38, er * 1.18, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.arc(ex, y, er, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#150d05';
    ctx.beginPath();
    ctx.ellipse(ex + er * 0.22, y, er * 0.32, er * 0.66, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(ex - er * 0.26, y - er * 0.42, er * 0.24, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = pal.fin;
    ctx.lineWidth = Math.max(0.9, s * 0.030);
    ctx.beginPath();
    ctx.arc(ex, y, er * 1.03, 0, TAU);
    ctx.stroke();
  }

  // ---- 颌侧触须：化形越高越明显 ----
  const fi = p.formIndex || 0;
  if (fi >= 1) {
    const a = Math.min(0.70, 0.24 + fi * 0.14);
    const wig = Math.sin(p.tailPhase * 1.7) * 0.07;
    ctx.strokeStyle = pal.belly;
    ctx.globalAlpha *= a;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.9, s * (0.026 + fi * 0.004));
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(1.400 * L, side * 0.115 * Wd);
      ctx.quadraticCurveTo(1.380 * L, side * (0.27 + wig) * Wd,
        1.255 * L, side * (0.345 + wig) * Wd);
      ctx.stroke();
    }
    ctx.globalAlpha /= a;
  }

  ctx.restore();
}

// ============================================================
// 六、背甲
// ============================================================
function drawShell(ctx, s, L, Wd, pal, p) {
  const Lq = q2(L), Wq = q2(Wd);
  const sizeKey = Lq + '|' + Wq;
  const palKey = pal.body + '|' + pal.belly + '|' + pal.fin;
  const lineW = Math.max(1, s * 0.044);

  // 水下投影：甲壳是浮在身体上的一块厚板
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(-0.01 * L, 0.075 * Wd, 1.02 * L, 0.99 * Wd, 0, 0, TAU);
  ctx.fill();

  // 壳壁：整块深色，随后被壳面盖住九成，只在边缘露出一圈厚度
  ctx.fillStyle = pal.fin;
  traceShell(ctx, L, Wd, 1.0);
  ctx.fill();

  // 壳面底色：前上受光偏浅，后下压深，形成一整块穹顶
  const base = cachedLinear(ctx, 'aoShell|' + palKey + '|' + sizeKey,
    -0.34 * L, -0.86 * Wd, 0.40 * L, 0.86 * Wd,
    [[0, mix(pal.body, pal.belly, 0.52)],
     [0.40, pal.body],
     [0.78, mix(pal.body, pal.fin, 0.34)],
     [1, pal.fin]]);
  ctx.fillStyle = base;
  traceShell(ctx, L, Wd, 0.952);
  ctx.fill();

  // ---- 内甲：肋盾 / 椎盾 / 颈盾 ----
  // 先铺深色整片，再由 shadePlate 盖上内缩的甲片面，露出深色厚缝
  const dark = mix(pal.fin, '#000000', 0.16);
  const unitGrad = cachedRadial(ctx, 'aoPlateGrad|' + pal.body + '|' + pal.belly + '|' + pal.fin,
    -0.62, -0.70, 0,
    0.06, 0.10, 1.28,
    [[0, 'rgba(255,246,228,0.52)'], [0.22, 'rgba(255,244,222,0.22)'],
     [0.50, 'rgba(255,240,214,0.03)'], [0.76, 'rgba(0,0,0,0.10)'], [1, 'rgba(0,0,0,0.30)']]);

  for (const side of [-1, 1]) {
    for (const info of COSTAL_INFO) shadePlate(ctx, s, info, L, Wd, side, pal, unitGrad, dark);
  }
  for (const info of VERT_INFO) shadePlate(ctx, s, info, L, Wd, 1, pal, unitGrad, dark);
  shadePlate(ctx, s, NUCHAL_INFO, L, Wd, 1, pal, unitGrad, dark);

  // ---- 缘盾圈：按 20 段填，外缘走扇贝弧 ----
  const marginGrad = cachedRadial(ctx, 'aoMarginGrad|' + pal.body + '|' + pal.fin,
    -0.34, -0.36, 0,
    0.16, 0.14, 1.30,
    [[0, 'rgba(255,255,255,0.30)'], [0.48, 'rgba(0,0,0,0.02)'], [1, 'rgba(0,0,0,0.30)']]);
  for (let i = 0; i < MARGIN_N; i++) {
    const a = ANCHORS[i], b = BULGES[i];
    const a2 = ANCHORS[(i + 1) % MARGIN_N];
    const ia = INNER[i], ib = INNER[(i + 1) % MARGIN_N];
    ctx.beginPath();
    ctx.moveTo(a[0] * L, a[1] * Wd);
    ctx.quadraticCurveTo(b[0] * L, b[1] * Wd, a2[0] * L, a2[1] * Wd);
    ctx.lineTo(ib[0] * L, ib[1] * Wd);
    ctx.lineTo(ia[0] * L, ia[1] * Wd);
    ctx.closePath();
    ctx.fillStyle = base;
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1, s * 0.040);
    ctx.stroke();

    // 每片缘盾的自身弧面：沿法线方向由亮到暗
    const mx = (a[0] + b[0] + a2[0]) / 3, my = (a[1] + b[1] + a2[1]) / 3;
    const rx = (Math.abs(b[0] - a[0]) + Math.abs(a2[0] - a[0]) + 0.05) * 0.62;
    const ry = (Math.abs(b[1] - a[1]) + Math.abs(a2[1] - a[1]) + 0.05) * 0.62;
    if (rx * L < 1.2 || ry * Wd < 1.2) continue;
    ctx.save();
    ctx.translate(mx * L, my * Wd);
    ctx.scale(rx * L, ry * Wd);
    ctx.fillStyle = marginGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 缘盾内缘的抛光边：把外圈与内甲干净地分开
  ctx.strokeStyle = pal.belly;
  ctx.globalAlpha *= 0.30;
  ctx.lineWidth = Math.max(0.9, s * 0.028);
  ctx.beginPath();
  ctx.moveTo(INNER[0][0] * L, INNER[0][1] * Wd);
  for (let i = 1; i < MARGIN_N; i++) ctx.lineTo(INNER[i][0] * L, INNER[i][1] * Wd);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha /= 0.30;

  // 椎盾上的年轮细纹（只在中央一片）
  const ring = VERT_INFO[2];
  ctx.strokeStyle = pal.fin;
  ctx.globalAlpha *= 0.22;
  ctx.lineWidth = Math.max(0.7, s * 0.020);
  for (const r of [0.40, 0.66]) {
    ctx.beginPath();
    ctx.ellipse(ring.cx * L, 0, ring.rx * r * L, ring.ry * r * Wd, 0, -1.25, 1.25);
    ctx.stroke();
  }
  ctx.globalAlpha /= 0.22;

  // ---- 穹顶光：整体弧面 ----
  const dome = cachedRadial(ctx, 'aoDome|' + sizeKey,
    -0.26 * L, -0.34 * Wd, s * 0.10,
    -0.05 * L, 0.02 * Wd, 1.58 * s,
    [[0, 'rgba(255,246,224,0.20)'], [0.32, 'rgba(255,240,214,0.06)'],
     [0.62, 'rgba(0,0,0,0.01)'], [0.84, 'rgba(0,0,0,0.13)'], [1, 'rgba(0,0,0,0.30)']]);
  ctx.fillStyle = dome;
  traceShell(ctx, L, Wd, 0.952);
  ctx.fill();

  // ---- 壳沿：深色细描 + 内侧抛光高光，做出厚度 ----
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1.4, s * 0.055);
  traceShell(ctx, L, Wd, 1.0);
  ctx.stroke();

  ctx.save();
  ctx.translate(-0.004 * L, -0.008 * Wd);
  ctx.strokeStyle = pal.belly;
  ctx.globalAlpha *= 0.26;
  ctx.lineWidth = Math.max(0.9, s * 0.022);
  traceShell(ctx, L, Wd, 0.958);
  ctx.stroke();
  ctx.restore();

  // 左上的镜面弧光：让甲壳像被磨过的角质
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(-0.06 * L, -0.30 * Wd, 0.62 * L, 0.62 * Wd, -0.25, 0, TAU);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.globalAlpha *= 0.30;
  ctx.lineWidth = Math.max(1.2, s * 0.05);
  ctx.beginPath();
  ctx.ellipse(-0.10 * L, -0.22 * Wd, 0.70 * L, 0.74 * Wd, -0.2, Math.PI * 0.98, Math.PI * 1.46);
  ctx.stroke();
  ctx.restore();

  // ---- 化形金纹：越高越盛（仙山符箓）----
  const fi = p.formIndex || 0;
  if (fi >= 2) {
    const a = Math.min(0.80, 0.22 + (fi - 2) * 0.20);
    const gold = (pal.glow || 'rgba(255,205,110,ALPHA)').replace('ALPHA', a.toFixed(2));
    ctx.strokeStyle = gold;
    ctx.fillStyle = gold;
    ctx.lineWidth = Math.max(0.9, s * 0.028);
    ctx.lineCap = 'round';
    // 脊线
    ctx.beginPath();
    ctx.moveTo(0.660 * L, 0);
    ctx.quadraticCurveTo(0.0, -0.02 * Wd, -0.665 * L, 0);
    ctx.stroke();
    // 椎盾接缝上的短芒
    for (const u of [0.31, 0.06, -0.22, -0.50]) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(u * L, 0);
        ctx.quadraticCurveTo((u - 0.015) * L, side * 0.10 * Wd,
          (u - 0.045) * L, side * 0.185 * Wd);
        ctx.stroke();
      }
    }
    // 中央印
    ctx.beginPath();
    ctx.arc(-0.085 * L, 0, s * 0.058, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-0.085 * L, 0, s * 0.020, 0, TAU);
    ctx.fill();
    if (fi >= 3) {
      for (const u of [0.31, 0.06, -0.22, -0.50]) {
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(u * L, side * 0.215 * Wd, Math.max(0.8, s * 0.022), 0, TAU);
          ctx.fill();
        }
      }
    }
  }
}

// ============================================================
// 七、短尾
// ============================================================
function drawTail(ctx, s, L, Wd, pal, p) {
  const wag = Math.sin(p.tailPhase * 1.1) * 0.18;
  const tl = 0.34 * L, tw = 0.11 * Wd;
  ctx.save();
  ctx.translate(-0.88 * L, 0);
  ctx.rotate(wag);
  const tg = cachedLinear(ctx, 'aoTail|' + pal.body + '|' + pal.fin + '|' + q2(s),
    0.02 * tl, 0, -tl, 0,
    [[0, pal.body], [1, pal.fin]]);
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(0, -tw);
  ctx.quadraticCurveTo(-tl * 0.55, -tw * 0.85, -tl, 0);
  ctx.quadraticCurveTo(-tl * 0.55, tw * 0.85, 0, tw);
  ctx.quadraticCurveTo(0.10 * tl, 0, 0, -tw);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pal.fin;
  ctx.globalAlpha *= 0.8;
  ctx.lineWidth = Math.max(0.9, s * 0.028);
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// 八、主绘制（层序：后肢 → 尾 → 前肢 → 头 → 背甲）
// ============================================================
export function draw(ctx, s, pal, p, b) {
  const L = s * 1.6 * b.len;    // 壳半长
  const Wd = s * 1.0 * b.wide;  // 壳半宽
  const beat = Math.sin(p.tailPhase * 1.5);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 后肢：略小、更向后掠，划水相位与前肢错开
  for (const side of [-1, 1]) {
    drawFlipper(ctx, s, pal, -0.56 * L, side * 0.74 * Wd,
      side, 0.72 + beat * 0.14, s * 0.80, 0.94);
  }

  drawTail(ctx, s, L, Wd, pal, p);

  // 前肢：更大、更靠前，像船桨一样前后摆
  for (const side of [-1, 1]) {
    drawFlipper(ctx, s, pal, 0.24 * L, side * 0.80 * Wd,
      side, 0.42 - beat * 0.24, s * 1.02, 1.10);
  }

  // 头颈（后半没入壳沿之下）
  drawHead(ctx, s, L, Wd, pal, p);

  // 背甲压在最上：一座会动的山
  drawShell(ctx, s, L, Wd, pal, p);
}