// ============================================================
// 种族 · 鳐（文鳐之属：鱼身而鸟翼，苍文白首赤喙，常以夜飞）
// 契约：export function draw(ctx, s, pal, p, b)
//   ctx  已经 translate 到中心、rotate 到朝向（头 +x，尾 -x）
//   s    半径（基准 17~22）
//   pal  { body, belly, fin, glow }
//   p    { tailPhase, mouthOpen, formIndex, ... }
//   b    体型参数 { len, wide, fin }
//
// 造型：俯视背脊，蝠鲼式"会飞的鱼"。
//   1. 整体是一条统一的轮廓：吻端 → 右前缘 → 右翼梢 → 右后缘 → 尾根
//      → 左后缘 → 左翼梢 → 左前缘 → 回到吻端。翼与体不再分开绘制，
//      因此翼根没有拼接缝，读起来是一个完整的生物。
//   2. 体量靠"内明暗"塑造：中央大面积柔光（隆背）+ 翼根接触影
//      + 脊线，而不是描边。
//   3. 翼缘按展向相位延迟做行波（尾相位 → 翼根 → 翼梢），
//      翼梢摆幅最大，形成自身体向外传播的振翅波。
//   4. 翼面：展向渐变 → 放射翼脉 → 前缘翼骨 / 缘光 → 后缘暗边。
//   5. 头部：白首晕、前伸头鳍、双眼、喷水孔、赤喙（随 mouthOpen 开合）。
//   6. 尾部：细鞭收尖 + 倒钩尾刺 + 根部小尾鳍。
//   7. 化形：尾刺幽光（2）→ 翼梢幽光与星点（3）→ 体内核心光（4）。
// ============================================================
import { TAU, cachedLinear, cachedRadial, drawGlow } from '../engine/draw-common.js';

// ---------- 翼型基样：模块加载时采样一次，逐帧只叠相位 ----------
const HN = 7;    // 头弧
const WN = 22;   // 前缘
const TN = 24;   // 后缘

// 头弧：吻端 (1.00, 0) → 肩点 (0.58, 0.24)
// 只做浅弧 —— 头部太宽太方，俯视会读成"猪鼻"；
// 鳐的头部是窄楔，宽度主要靠翼根展开来给。
const _headX = new Float32Array(HN + 1);
const _headY = new Float32Array(HN + 1);
for (let i = 0; i <= HN; i++) {
  const t = (i / HN) * Math.PI * 0.5;
  const c = Math.cos(t), sn = Math.sin(t);
  _headX[i] = 0.58 + 0.42 * c;
  _headY[i] = 0.24 * Math.pow(sn, 0.70);
}

// 前缘：肩 (0.58,0.24) → 立刻后掠 → 尖翼梢 (-0.42,1.06)
// 关键：控制点 x 必须小于肩点 x —— 若向前凸出，肩线就被抹掉，
// 头与翼会融成一个"团"，读不出生物结构。
const _leadX = new Float32Array(WN + 1);
const _leadY = new Float32Array(WN + 1);
const _leadA = new Float32Array(WN + 1);   // 起伏幅度（归一化到 s）
const _leadG = new Float32Array(WN + 1);   // 相位延迟
for (let i = 0; i <= WN; i++) {
  const u = i / WN, w = 1 - u;
  const b0 = w * w * w, b1 = 3 * w * w * u, b2 = 3 * w * u * u, b3 = u * u * u;
  _leadX[i] = b0 * 0.58 + b1 * 0.45 + b2 * 0.06 + b3 * -0.42;
  _leadY[i] = b0 * 0.24 + b1 * 0.58 + b2 * 0.88 + b3 * 1.06;
  _leadA[i] = 0.008 + 0.235 * Math.pow(u, 2.2);
  _leadG[i] = 2.2 * u;
}

// 后缘：翼梢 (-0.42,1.06) → 斜着内收 → 尾根 (-0.90,0.04)
// 保持接近直线的斜度：圆弧化的后缘会让整只生物变成"盾牌"。
const _trailX = new Float32Array(TN + 1);
const _trailY = new Float32Array(TN + 1);
const _trailA = new Float32Array(TN + 1);
const _trailG = new Float32Array(TN + 1);
for (let i = 0; i <= TN; i++) {
  const v = i / TN, w = 1 - v;
  const b0 = w * w * w, b1 = 3 * w * w * v, b2 = 3 * w * v * v, b3 = v * v * v;
  _trailX[i] = b0 * -0.42 + b1 * -0.54 + b2 * -0.78 + b3 * -0.92;
  // 后缘微扇贝（只在翼中段轻微起伏，翼梢与尾根保持干净）
  const scallop = 0.012 * Math.sin(v * Math.PI * 8) * Math.sin(v * Math.PI);
  _trailY[i] = b0 * 1.06 + b1 * 0.82 + b2 * 0.40 + b3 * 0.04 + scallop;
  _trailA[i] = 0.008 + 0.235 * Math.pow(w, 2.0);
  _trailG[i] = 2.2 * w;
}

// ---------- 复用缓冲（避免每帧建对象） ----------
const _hx = new Float32Array(HN + 1), _hy = new Float32Array(HN + 1);
const _lx = new Float32Array(WN + 1), _ly = new Float32Array(WN + 1);
const _tx = new Float32Array(TN + 1), _ty = new Float32Array(TN + 1);
const _ox = new Float32Array(2 * (HN + WN + TN) + 8);
const _oy = new Float32Array(2 * (HN + WN + TN) + 8);
const _sx = new Float32Array(TN + 1), _sy = new Float32Array(TN + 1);

function polyClosed(ctx, xs, ys, n) {
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.closePath();
}
function polyOpen(ctx, xs, ys, n) {
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
}

/** 采样单侧轮廓：写入 _hx/_hy、_lx/_ly、_tx/_ty，side = ±1 */
function sampleSide(side, L, Wd, ph, s) {
  for (let i = 0; i <= HN; i++) {
    _hx[i] = L * _headX[i];
    _hy[i] = side * Wd * _headY[i];
  }
  for (let i = 0; i <= WN; i++) {
    const wv = Math.sin(ph - _leadG[i]);
    _lx[i] = L * _leadX[i];
    _ly[i] = side * (Wd * _leadY[i] + s * _leadA[i] * wv);
  }
  for (let i = 0; i <= TN; i++) {
    const wv = Math.sin(ph - _trailG[i]);
    _tx[i] = L * _trailX[i];
    _ty[i] = side * (Wd * _trailY[i] + s * _trailA[i] * wv);
  }
}

export function draw(ctx, s, pal, p, b) {
  const L = s * 1.48 * b.len;
  const Wd = s * 1.00 * b.wide;
  const finMul = b.fin || 1.4;
  const fi = p.formIndex || 0;
  const m = Math.max(0, Math.min(1, p.mouthOpen || 0));
  const glow = pal.glow || 'rgba(255,255,255,ALPHA)';

  const ph = (p.tailPhase || 0) * 1.15;
  const ta = Math.sin(ph - 0.4);
  const tb = Math.sin(ph - 1.2);
  const bh = Wd * 0.26;               // 躯干半宽（只用于内明暗，不构成轮廓）

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ==========================================================
  // 一、尾部（画在最底层，根部由身体压住）
  // ==========================================================
  const t0x = -L * 0.72;
  const t1x = -L * 1.12;
  const t1y = Wd * 0.06 * ta;
  const t2x = -L * (1.48 + 0.13 * finMul);
  const t2y = Wd * 0.15 * tb;
  const tW = s * 0.062;

  // 根部小尾鳍
  ctx.save();
  ctx.globalAlpha *= 0.58;
  ctx.fillStyle = pal.fin;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-L * 0.74, side * Wd * 0.015);
    ctx.bezierCurveTo(-L * 0.90, side * Wd * 0.11, -L * 1.04, side * (Wd * 0.19 + s * 0.03 * tb),
      -L * 1.18, side * (Wd * 0.22 + s * 0.05 * tb));
    ctx.bezierCurveTo(-L * 1.04, side * (Wd * 0.12 + s * 0.02 * tb),
      -L * 0.88, side * Wd * 0.05, -L * 0.74, side * Wd * 0.006);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 鞭尾：由粗到细
  ctx.fillStyle = pal.fin;
  ctx.beginPath();
  ctx.moveTo(t0x, -tW);
  ctx.bezierCurveTo(-L * 0.92, -tW * 0.92, t1x, t1y - tW * 0.22, t2x, t2y - s * 0.008);
  ctx.bezierCurveTo(t1x, t1y + tW * 0.22, -L * 0.92, tW * 0.92, t0x, tW);
  ctx.closePath();
  ctx.fill();

  // 尾脊高光
  ctx.strokeStyle = pal.body + 'a0';
  ctx.lineWidth = Math.max(1, s * 0.020);
  ctx.beginPath();
  ctx.moveTo(t0x, 0);
  ctx.quadraticCurveTo(t1x, t1y, t2x, t2y);
  ctx.stroke();

  // 尾刺：末端倒钩刃
  const tdx = t2x - t1x, tdy = t2y - t1y;
  const tdl = Math.hypot(tdx, tdy) || 1;
  const ux = tdx / tdl, uy = tdy / tdl;
  ctx.fillStyle = pal.belly;
  ctx.beginPath();
  ctx.moveTo(t2x + ux * s * 0.03, t2y + uy * s * 0.03);
  ctx.lineTo(t2x - ux * s * 0.12 - uy * s * 0.05, t2y - uy * s * 0.12 + ux * s * 0.05);
  ctx.lineTo(t2x - ux * s * 0.28, t2y - uy * s * 0.28);
  ctx.lineTo(t2x - ux * s * 0.12 + uy * s * 0.05, t2y - uy * s * 0.12 - ux * s * 0.05);
  ctx.closePath();
  ctx.fill();
  if (fi >= 2) drawGlow(ctx, t2x, t2y, s * 0.44, glow, 0.30);

  // ==========================================================
  // 二、统一轮廓（双翼 + 躯干，一笔画完）
  // ==========================================================
  // 右半：吻端 → 头弧 → 前缘 → 后缘 → 尾根
  sampleSide(1, L, Wd, ph, s);
  let n = 0;
  _ox[n] = L * 1.00; _oy[n] = 0; n++;
  for (let i = 1; i <= HN; i++) { _ox[n] = _hx[i]; _oy[n] = _hy[i]; n++; }
  for (let i = 1; i <= WN; i++) { _ox[n] = _lx[i]; _oy[n] = _ly[i]; n++; }
  for (let i = 1; i <= TN; i++) { _ox[n] = _tx[i]; _oy[n] = _ty[i]; n++; }
  _ox[n] = -L * 0.98; _oy[n] = 0; n++;
  // 左半：尾根 → 后缘 → 前缘 → 头弧 → 吻端（镜像倒序）
  const rightN = n;
  for (let i = TN; i >= 1; i--) { _ox[n] = _tx[i]; _oy[n] = -_ty[i]; n++; }
  for (let i = WN; i >= 1; i--) { _ox[n] = _lx[i]; _oy[n] = -_ly[i]; n++; }
  for (let i = HN; i >= 1; i--) { _ox[n] = _hx[i]; _oy[n] = -_hy[i]; n++; }

  // ---- 翼膜：展向渐变（脊侧体色 → 翼梢深色）----
  const wingGrad = cachedLinear(ctx,
    'rayg|' + pal.body + '|' + pal.fin + '|' + Math.round(Wd),
    0, 0, 0, Wd * 1.04,
    [[0, pal.body], [0.30, pal.body], [0.68, pal.fin], [1, pal.fin]]);
  ctx.fillStyle = wingGrad;
  ctx.beginPath();
  polyClosed(ctx, _ox, _oy, n);
  ctx.fill();

  // ---- 翼梢压暗 ----
  const tipShade = cachedLinear(ctx, 'rayt|' + pal.fin,
    0, 0, 0, Wd * 1.04,
    [[0, 'rgba(0,0,0,0)'], [0.62, 'rgba(0,0,0,0.05)'], [1, 'rgba(0,0,0,0.22)']]);
  ctx.fillStyle = tipShade;
  ctx.beginPath();
  polyClosed(ctx, _ox, _oy, n);
  ctx.fill();

  // ---- 翼脉：只在中段到翼梢排布，且从躯干外缘起笔 ----
  for (const side of [-1, 1]) {
    for (let k = 2; k <= 7; k++) {
      const u = 0.16 + k * 0.115;                    // 沿前缘参数
      const li = Math.round(u * WN);
      const ti = Math.round(Math.min(1, u * 1.10) * TN);
      const ax = L * _leadX[li];
      const ay = side * (Wd * _leadY[li] + s * _leadA[li] * Math.sin(ph - _leadG[li]));
      const bx = L * _trailX[ti];
      const by = side * (Wd * _trailY[ti] + s * _trailA[ti] * Math.sin(ph - _trailG[ti]));
      // 起点向内退，留出前缘翼骨的位置
      const sx = ax - L * 0.03, sy = ay * 0.86;
      const ex = bx + L * 0.02, ey = by * 0.90;
      const mx = (sx + ex) * 0.5 - L * 0.02;
      const my = side * (Math.abs(sy + ey) * 0.48);
      ctx.strokeStyle = pal.fin + (k > 5 ? '1e' : '34');
      ctx.lineWidth = Math.max(1, s * (k % 3 === 2 ? 0.024 : 0.015));
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();
    }
  }

  // ---- 躯干：用横向明暗塑造背部体积（不用中央亮带 —— 那会变成"金属横梁"）----
  // 只给脊线两侧极淡的一圈受光，靠翼根接触影反衬出中央隆起。
  const hump = cachedRadial(ctx, 'rayc|' + pal.body + '|' + pal.belly + '|' + Math.round(bh),
    0, 0, 0.02, 0, 0, 1,
    [[0, pal.belly + '1c'], [0.45, pal.body + '12'], [1, pal.body + '00']]);
  ctx.save();
  ctx.translate(L * 0.14, 0);
  ctx.scale(L * 0.56, bh * 1.25);
  ctx.fillStyle = hump;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();

  // 脊背受光：极细的一条，仅暗示脊线走向
  ctx.strokeStyle = pal.belly + '3a';
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.beginPath();
  ctx.moveTo(-L * 0.50, 0);
  ctx.quadraticCurveTo(L * 0.10, -s * 0.02, L * 0.80, 0);
  ctx.stroke();

  // 翼根接触影：贴近体侧的两道柔暗弧（宽而淡 → 视觉上模糊）
  ctx.strokeStyle = pal.fin + '34';
  ctx.lineWidth = Math.max(1.5, s * 0.085);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(L * 0.64, side * bh * 0.58);
    ctx.bezierCurveTo(L * 0.38, side * bh * 1.05, L * 0.00, side * bh * 1.05,
      -L * 0.44, side * bh * 0.62);
    ctx.stroke();
  }

  // 脊线：细亮，自头后延伸到尾根
  ctx.strokeStyle = pal.belly + 'a8';
  ctx.lineWidth = Math.max(1, s * 0.020);
  ctx.beginPath();
  ctx.moveTo(-L * 0.64, 0);
  ctx.quadraticCurveTo(L * 0.04, -s * 0.024, L * 0.82, 0);
  ctx.stroke();

  // 苍文：背部人字纹（向尾收小，压低对比只作质感）
  ctx.strokeStyle = pal.fin + '33';
  ctx.lineWidth = Math.max(1, s * 0.017);
  for (let i = 0; i < 5; i++) {
    const x0 = L * (0.24 - i * 0.15);
    const w = bh * (0.78 - i * 0.07);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x0, side * bh * 0.28);
      ctx.quadraticCurveTo(x0 - L * 0.035, side * w * 0.68, x0 - L * 0.085, side * w);
      ctx.stroke();
    }
  }

  // ---- 前缘翼骨（单层深色；加第二道内侧线会读成"折页"）----
  for (const side of [-1, 1]) {
    sampleSide(side, L, Wd, ph, s);
    ctx.strokeStyle = pal.fin + '9c';
    ctx.lineWidth = Math.max(1.3, s * 0.036);
    ctx.beginPath();
    polyOpen(ctx, _lx, _ly, WN + 1);
    ctx.stroke();

    // 后缘：单层描边（暗边在线内，缘光在外侧，形成一条干净的"翼缘"）
    // 注意：两层线不要用不同 y 缩放 —— 那会产生"双线接缝"。
    ctx.strokeStyle = pal.fin + '90';
    ctx.lineWidth = Math.max(1.2, s * 0.036);
    ctx.beginPath();
    polyOpen(ctx, _tx, _ty, TN + 1);
    ctx.stroke();

    // 缘光：同一条线，只向下压一点点，靠透明度自然过渡
    ctx.strokeStyle = pal.belly + '4a';
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.beginPath();
    polyOpen(ctx, _tx, _ty, TN + 1);
    ctx.stroke();
  }

  // ---- 化形光效：翼梢幽光 + 星点 ----
  for (const side of [-1, 1]) {
    const tipX = _lx[WN], tipY = side * Math.abs(_ly[WN]);
    if (fi >= 3) drawGlow(ctx, tipX, tipY, s * 0.46, glow, 0.26);
    if (fi >= 2) {
      ctx.fillStyle = 'rgba(255,255,246,0.58)';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(L * (0.12 - i * 0.15), side * Wd * (0.50 + i * 0.15), s * 0.022, 0, TAU);
        ctx.fill();
      }
    }
  }

  // 化形核心幽光
  if (fi >= 4) drawGlow(ctx, L * 0.28, 0, s * 0.95, glow, 0.20);

  // ==========================================================
  // 三、头部：白首 · 头鳍 · 眼 · 喷水孔 · 赤喙
  // ==========================================================
  // 白首：吻端浅色晕（用体色过渡，避免中央出现一块白斑）
  const headGrad = cachedRadial(ctx, 'rayh|' + pal.belly + '|' + pal.body + '|' + Math.round(L),
    L * 0.80, 0, s * 0.02, L * 0.80, 0, L * 0.30,
    [[0, pal.belly + '58'], [0.42, pal.belly + '24'], [0.75, pal.body + '10'], [1, pal.body + '00']]);
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.ellipse(L * 0.80, 0, L * 0.30, bh * 1.15, 0, 0, TAU);
  ctx.fill();

  // 头鳍：从头部两侧向前伸的两根柔软触角（短，不越过吻端太多）
  for (const side of [-1, 1]) {
    const lw = Math.sin(ph - 0.5) * s * 0.045;
    ctx.strokeStyle = pal.fin;
    ctx.lineWidth = Math.max(1.6, s * 0.048);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(L * 0.78, side * bh * 0.62);
    ctx.quadraticCurveTo(L * 0.94, side * (bh * 0.86 + lw),
      L * 1.02, side * (bh * 1.02 + lw * 1.3));
    ctx.stroke();
    // 端部小圆点：像触角末梢
    ctx.fillStyle = pal.belly + 'cc';
    ctx.beginPath();
    ctx.arc(L * 1.02, side * (bh * 1.02 + lw * 1.3), s * 0.030, 0, TAU);
    ctx.fill();
  }

  // 潜鲲以上的长触须（贴头侧向后飘）
  if (fi >= 2) {
    ctx.strokeStyle = pal.belly + 'cc';
    ctx.lineWidth = Math.max(1, s * 0.017);
    for (const side of [-1, 1]) {
      const sw = Math.sin(ph * 0.9 + side) * s * 0.065;
      ctx.beginPath();
      ctx.moveTo(L * 0.82, side * bh * 0.80);
      ctx.quadraticCurveTo(L * 0.54, side * (bh * 1.70 + sw),
        L * 0.22, side * (bh * 2.20 + sw * 1.6));
      ctx.stroke();
    }
  }

  // 双眼：头侧偏内，避开翼缘（否则会像贴在翼面上）
  for (const side of [-1, 1]) {
    const ex = L * 0.70, ey = side * bh * 0.80, tilt = side * 0.34;
    ctx.fillStyle = 'rgba(8,18,26,0.55)';
    ctx.beginPath();
    ctx.ellipse(ex, ey, s * 0.130, s * 0.092, tilt, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pal.belly;
    ctx.beginPath();
    ctx.ellipse(ex, ey, s * 0.079, s * 0.056, tilt, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0a161d';
    ctx.beginPath();
    ctx.ellipse(ex + s * 0.014, ey, s * 0.033, s * 0.046, tilt, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex - s * 0.018, ey - side * s * 0.020, s * 0.020, 0, TAU);
    ctx.fill();

    // 喷水孔（眼后暗点）
    ctx.fillStyle = 'rgba(10,20,28,0.24)';
    ctx.beginPath();
    ctx.ellipse(L * 0.52, side * bh * 0.76, s * 0.025, s * 0.014, tilt, 0, TAU);
    ctx.fill();
  }

  // 赤喙：挂在吻端之外（bkx 必须 ≥ 吻端 x，否则会被轮廓遮住）
  const bkx = L * 0.99, bLen = L * 0.15;
  const rot = 0.045 + m * 0.42;
  const gap = Math.sin(rot) * bLen * 0.82;
  if (m > 0.02) {
    ctx.fillStyle = 'rgba(46,12,6,0.92)';
    ctx.beginPath();
    ctx.moveTo(bkx - L * 0.03, 0);
    ctx.quadraticCurveTo(bkx + bLen * 0.36, -gap * 0.92, bkx + bLen * 0.82, -gap);
    ctx.lineTo(bkx + bLen * 0.82, gap);
    ctx.quadraticCurveTo(bkx + bLen * 0.36, gap * 0.92, bkx - L * 0.03, 0);
    ctx.closePath();
    ctx.fill();
  }
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(bkx, 0);
    ctx.rotate(side * rot);
    ctx.fillStyle = '#d9472b';
    ctx.beginPath();
    ctx.moveTo(-L * 0.02, side * s * 0.005);
    ctx.quadraticCurveTo(bLen * 0.42, side * s * 0.050, bLen * 1.02, side * s * 0.004);
    ctx.quadraticCurveTo(bLen * 0.46, side * s * 0.008, -L * 0.012, side * s * 0.001);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,226,192,0.52)';
    ctx.lineWidth = Math.max(1, s * 0.013);
    ctx.beginPath();
    ctx.moveTo(bLen * 0.06, side * s * 0.019);
    ctx.quadraticCurveTo(bLen * 0.46, side * s * 0.027, bLen * 0.88, side * s * 0.007);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(72,22,10,0.48)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(L * 0.84, side * s * 0.014, s * 0.011, s * 0.006, 0, 0, TAU);
    ctx.fill();
  }
}