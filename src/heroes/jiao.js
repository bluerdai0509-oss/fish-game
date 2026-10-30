// ============================================================
// 种族 · 蛟（鱼身蛇尾 · 俯视背脊）
// 契约：export function draw(ctx, s, pal, p, b)
//   ctx 已 translate 到中心、rotate 到朝向；头朝 +x
//   s 半径基准 17~22 / pal { body, belly, fin, glow }
//   p { tailPhase, mouthOpen, formIndex } / b { len, wide, fin }
// ------------------------------------------------------------
// 造型思路：
//   1. 一条连续脊柱（26 采样），波峰沿脊线向尾传播
//   2. 每个采样点按法线扩出左右轮廓，一笔 fill 成整条蛇身
//   3. 再叠渐变 / 脊背高光 / 鳞片 / 背冠 / 尾鳍 / 龙首
// 气质：灵动、危险、优雅 —— 一条还没化龙的水蛇。
// ============================================================
import { TAU, cachedLinear, cachedRadial, drawGlow } from '../engine/draw-common.js';

// ---------- 脊柱采样缓存（模块级复用，draw 为同步调用，安全） ----------
const N = 34;
const PX = new Float64Array(N);     // 脊柱点
const PY = new Float64Array(N);
const PW = new Float64Array(N);     // 该处半宽
const PNX = new Float64Array(N);    // 单位法线（切向转 90°）
const PNY = new Float64Array(N);
const PTX = new Float64Array(N);    // 单位切向
const PTY = new Float64Array(N);

// 体宽关键帧：颈窄 → 肩宽 → 尾部收细
// [t, 半宽系数]，用余弦插值求值，得到平滑的蛇形轮廓
const W_KEYS = [
  [0.00, 0.74], [0.07, 0.88], [0.16, 1.00], [0.28, 0.96],
  [0.42, 0.80], [0.58, 0.60], [0.74, 0.40], [0.88, 0.20], [1.00, 0.02],
];

function widthAt(t) {
  for (let k = 0; k < W_KEYS.length - 1; k++) {
    const a = W_KEYS[k], b = W_KEYS[k + 1];
    if (t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0] || 1);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * f);
      return a[1] + (b[1] - a[1]) * e;
    }
  }
  return W_KEYS[W_KEYS.length - 1][1];
}

// 从颈（t=0）到尾尖（t=1）
function buildSpine(L, Wd, phase) {
  const neckX = L * 0.52;
  const tailX = -L * 1.56;
  const bodyLen = neckX - tailX;

  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    PX[i] = neckX - t * bodyLen;
    // 波形沿体长向尾传播；颈部几乎不动，尾部摆幅最大
    const env = Math.pow(Math.max(0, t - 0.06) / 0.94, 1.30);
    PY[i] = Wd * 2.30 * env * Math.sin(phase - t * 4.6);
    PW[i] = Math.max(Wd * 0.020, Wd * widthAt(t));
  }

  // 中心差分求切向 / 法线
  for (let i = 0; i < N; i++) {
    const i0 = i > 0 ? i - 1 : i;
    const i1 = i < N - 1 ? i + 1 : i;
    let tx = PX[i1] - PX[i0];
    let ty = PY[i1] - PY[i0];
    const inv = 1 / (Math.hypot(tx, ty) || 1);
    tx *= inv; ty *= inv;
    PTX[i] = tx; PTY[i] = ty;
    PNX[i] = -ty; PNY[i] = tx;
  }
}

// 一侧轮廓：二次曲线过中点，把折线抹顺
function traceEdge(ctx, sign, wMul, off) {
  const w0 = PW[0] * wMul + off;
  ctx.moveTo(PX[0] + PNX[0] * w0 * sign, PY[0] + PNY[0] * w0 * sign);
  for (let i = 1; i < N - 1; i++) {
    const d0 = PW[i] * wMul + off;
    const d1 = PW[i + 1] * wMul + off;
    const x0 = PX[i] + PNX[i] * d0 * sign;
    const y0 = PY[i] + PNY[i] * d0 * sign;
    const x1 = PX[i + 1] + PNX[i + 1] * d1 * sign;
    const y1 = PY[i + 1] + PNY[i + 1] * d1 * sign;
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) * 0.5, (y0 + y1) * 0.5);
  }
  const dl = PW[N - 1] * wMul + off;
  ctx.lineTo(PX[N - 1] + PNX[N - 1] * dl * sign,
    PY[N - 1] + PNY[N - 1] * dl * sign);
}

// 整条身体：上缘正走 + 下缘倒走，一笔闭合
function bodyPath(ctx, wMul = 1, off = 0) {
  ctx.beginPath();
  traceEdge(ctx, 1, wMul, off);
  const dl = PW[N - 1] * wMul + off;
  ctx.lineTo(PX[N - 1] - PNX[N - 1] * dl, PY[N - 1] - PNY[N - 1] * dl);
  for (let i = N - 2; i > 0; i--) {
    const d0 = PW[i] * wMul + off;
    const d1 = PW[i - 1] * wMul + off;
    const x0 = PX[i] - PNX[i] * d0;
    const y0 = PY[i] - PNY[i] * d0;
    const x1 = PX[i - 1] - PNX[i - 1] * d1;
    const y1 = PY[i - 1] - PNY[i - 1] * d1;
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) * 0.5, (y0 + y1) * 0.5);
  }
  const d0 = PW[0] * wMul + off;
  ctx.lineTo(PX[0] - PNX[0] * d0, PY[0] - PNY[0] * d0);
  ctx.closePath();
}

// 沿脊柱铺一条变宽带（高光 / 暗部），off 为法线偏移比例
function strokeSpine(ctx, off, wMul, color, alpha) {
  const a0 = ctx.globalAlpha;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < N - 1; i++) {
    ctx.globalAlpha = a0 * alpha * (0.5 + 0.5 * (1 - i / N));
    ctx.lineWidth = Math.max(0.5, (PW[i] + PW[i + 1]) * 0.5 * wMul);
    ctx.beginPath();
    ctx.moveTo(PX[i] + PNX[i] * PW[i] * off, PY[i] + PNY[i] * PW[i] * off);
    ctx.lineTo(PX[i + 1] + PNX[i + 1] * PW[i + 1] * off,
      PY[i + 1] + PNY[i + 1] * PW[i + 1] * off);
    ctx.stroke();
  }
  ctx.globalAlpha = a0;
}

// ============================================================
// 尾鳍：三叶飘带，顺尾尖切向向后展开
// ============================================================
function drawTailFin(ctx, s, Wd, pal, phase, finMul) {
  const iT = N - 1;
  const ang = Math.atan2(PTY[iT], PTX[iT]);
  const len = Wd * 2.2 * finMul;
  const spread = Wd * 1.15 * finMul;
  const baseA = ctx.globalAlpha;

  ctx.save();
  ctx.translate(PX[iT], PY[iT]);
  ctx.rotate(ang + Math.sin(phase - 3.6) * 0.14);

  // 叶：dy = 端部偏移，l = 长度，wid = 根部宽度
  const lobe = (dy, l, wid, a) => {
    ctx.save();
    ctx.globalAlpha = baseA * a;
    ctx.fillStyle = pal.fin;
    ctx.beginPath();
    ctx.moveTo(0, -wid * 0.30);
    ctx.quadraticCurveTo(l * 0.42, dy * 0.36 - wid, l, dy);
    ctx.quadraticCurveTo(l * 0.56, dy * 0.50 + wid * 0.80, 0, wid * 0.30);
    ctx.quadraticCurveTo(l * 0.10, 0, 0, -wid * 0.30);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = pal.belly;
    ctx.globalAlpha = baseA * a * 0.28;
    ctx.lineWidth = Math.max(0.5, Wd * 0.045);
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const f = (k - 1) * 0.34;
      ctx.beginPath();
      ctx.moveTo(l * 0.08, f * wid * 0.5);
      ctx.quadraticCurveTo(l * 0.50, dy * 0.42 + f * wid * 0.8,
        l * 0.90, dy * 0.92 + f * wid * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  };

  lobe(-spread, len * 0.90, spread * 0.46, 0.66);
  lobe(spread, len * 0.90, spread * 0.46, 0.66);
  lobe(0, len, spread * 0.36, 0.90);

  // 尾椎
  ctx.globalAlpha = baseA * 0.55;
  ctx.strokeStyle = pal.belly;
  ctx.lineWidth = Math.max(0.7, Wd * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.36, 0, len * 0.72, 0);
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// 背冠（俯视）
//   俯视看到的是一条沿中脊的窄冠，不是侧视的大帆。
//   冠带贴脊，边缘起伏，尾端收成一点。
// ============================================================
function drawDorsalCrest(ctx, s, Wd, pal, phase, finMul) {
  const baseA = ctx.globalAlpha;
  const iEnd = Math.floor(N * 0.70);

  const halfAt = (i) => {
    const t = i / (N - 1);
    const body = PW[i];
    // 冠带基线宽 + 随身体缓慢起伏 + 相位波动
    const ripple = 1 + 0.34 * Math.sin(t * 9.0 - phase * 0.8);
    const fade = Math.pow(Math.max(0, 1 - t / 0.74), 0.7);
    return body * (0.40 + 0.20 * finMul) * ripple * fade;
  };

  // 冠带：上缘正走 + 下缘倒走
  ctx.globalAlpha = baseA * 0.42;
  ctx.fillStyle = pal.fin;
  ctx.beginPath();
  ctx.moveTo(PX[1] + PNX[1] * halfAt(1), PY[1] + PNY[1] * halfAt(1));
  for (let i = 2; i <= iEnd; i++) {
    const h = halfAt(i);
    ctx.quadraticCurveTo(
      PX[i - 1] + PNX[i - 1] * h, PY[i - 1] + PNY[i - 1] * h,
      PX[i] + PNX[i] * h, PY[i] + PNY[i] * h);
  }
  for (let i = iEnd; i >= 1; i--) {
    const h = halfAt(i);
    ctx.lineTo(PX[i] - PNX[i] * h, PY[i] - PNY[i] * h);
  }
  ctx.closePath();
  ctx.fill();

  // 冠沿高光：中线两侧各一道细弧，像鳍膜的折光
  ctx.globalAlpha = baseA * 0.26;
  ctx.strokeStyle = pal.belly;
  ctx.lineWidth = Math.max(0.4, Wd * 0.045);
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 1; i <= iEnd; i++) {
      const h = halfAt(i) * 0.82 * side;
      const X = PX[i] + PNX[i] * h, Y = PY[i] + PNY[i] * h;
      if (i === 1) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }

  // 脊线中央一笔亮，强化"冠脊"
  ctx.globalAlpha = baseA * 0.34;
  ctx.strokeStyle = pal.belly;
  ctx.lineWidth = Math.max(0.4, Wd * 0.05);
  ctx.beginPath();
  for (let i = 1; i <= iEnd; i++) {
    if (i === 1) ctx.moveTo(PX[i], PY[i]); else ctx.lineTo(PX[i], PY[i]);
  }
  ctx.stroke();

  ctx.globalAlpha = baseA;
}

// ============================================================
// 胸鳍（俯视）：头后一对小叶片，向后外掠，随波轻划
// ============================================================
function drawPectorals(ctx, s, Wd, pal, phase, finMul) {
  const i = 3;
  const px = PX[i], py = PY[i];
  const nx = PNX[i], ny = PNY[i];
  const tx = PTX[i], ty = PTY[i];
  const baseA = ctx.globalAlpha;
  const flap = Math.sin(phase * 1.25);

  for (const side of [-1, 1]) {
    const ax = px + nx * PW[i] * 0.75 * side;
    const ay = py + ny * PW[i] * 0.75 * side;
    const FL = Wd * (1.15 + flap * 0.10) * finMul;
    const FW = Wd * 0.42 * finMul;

    ctx.globalAlpha = baseA * 0.62;
    ctx.fillStyle = pal.fin;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(
      ax - tx * FL * 0.30 + nx * FW * 1.30 * side,
      ay - ty * FL * 0.30 + ny * FW * 1.30 * side,
      ax - tx * FL * 0.86 + nx * FW * 0.72 * side,
      ay - ty * FL * 0.86 + ny * FW * 0.72 * side,
    );
    ctx.quadraticCurveTo(
      ax - tx * FL * 1.04,
      ay - ty * FL * 1.04,
      ax - tx * FL * 0.80 - nx * PW[i] * 0.30 * side,
      ay - ty * FL * 0.80 - ny * PW[i] * 0.30 * side,
    );
    ctx.quadraticCurveTo(
      ax - tx * FL * 0.30 + nx * PW[i] * 0.60 * side,
      ay - ty * FL * 0.30 + ny * PW[i] * 0.60 * side,
      ax, ay,
    );
    ctx.closePath();
    ctx.fill();

    // 鳍条
    ctx.globalAlpha = baseA * 0.26;
    ctx.strokeStyle = pal.belly;
    ctx.lineWidth = Math.max(0.3, Wd * 0.030);
    for (let k = 1; k <= 3; k++) {
      const f = k / 4;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(
        ax - tx * FL * (0.34 + f * 0.60) + nx * FW * (1.22 - f * 1.05) * side,
        ay - ty * FL * (0.34 + f * 0.60) + ny * FW * (1.22 - f * 1.05) * side,
      );
      ctx.stroke();
    }
  }
  ctx.globalAlpha = baseA;
}

// ============================================================
// ============================================================
// 鳞片：俯视下的背部鳞纹
//   只在体侧画稀疏的柔弧（像光在鳞面上滑过），
//   中央保持干净 —— 避免"铁路/肋骨"的规律感。
// ============================================================
function drawScales(ctx, s, Wd, pal, phase) {
  const baseA = ctx.globalAlpha;
  const lanes = [-0.62, 0.62];

  for (let i = 3; i < N - 3; i++) {
    const t = i / (N - 1);
    const w = PW[i];
    if (w < Wd * 0.10) break;

    const nx = PNX[i], ny = PNY[i];
    const tx = PTX[i], ty = PTY[i];
    const rot = Math.atan2(ty, tx);
    const sco = Math.max(w * 0.46, Wd * 0.05);

    for (let li = 0; li < lanes.length; li++) {
      const cx = PX[i] + nx * w * lanes[li];
      const cy = PY[i] + ny * w * lanes[li];

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.globalAlpha = baseA * ((1 - t) * 0.26 + 0.05);
      ctx.strokeStyle = li === 0 ? pal.belly : pal.fin;
      ctx.lineWidth = Math.max(0.4, w * 0.10);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(-sco * 0.25, 0, sco * 0.95, -0.62, 0.62);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 中央一条极淡的脊线亮带
  ctx.globalAlpha = baseA * 0.14;
  ctx.strokeStyle = pal.belly;
  ctx.lineWidth = Math.max(0.5, Wd * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 1; i < N - 5; i++) {
    if (i === 1) ctx.moveTo(PX[i], PY[i]); else ctx.lineTo(PX[i], PY[i]);
  }
  ctx.stroke();
  ctx.globalAlpha = baseA;
}

// ============================================================
// ============================================================
// 龙首（俯视）
//   轮廓由宽度关键帧驱动：颈 0.72 → 颅顶 1.00 → 太阳穴 0.86
//   → 颊 0.92 → 吻 0.44。保证真正收成方吻，而不是一个圆球。
// ============================================================
const H_KEYS = [
  [0.00, 0.80], [0.12, 0.94], [0.26, 1.00], [0.40, 0.98],
  [0.54, 0.92], [0.66, 0.84], [0.78, 0.72], [0.88, 0.58],
  [0.96, 0.44], [1.00, 0.34],
];

function headWidth(u) {
  for (let k = 0; k < H_KEYS.length - 1; k++) {
    const a = H_KEYS[k], b = H_KEYS[k + 1];
    if (u <= b[0]) {
      const f = (u - a[0]) / (b[0] - a[0] || 1);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * f);
      return a[1] + (b[1] - a[1]) * e;
    }
  }
  return H_KEYS[H_KEYS.length - 1][1];
}

// 锥形飘带：起点 → 控制点 → 终点，根宽 w0、梢宽 w1
function taperedRibbon(ctx, x0, y0, cx, cy, x1, y1, w0, w1, fill, alpha) {
  const M = 9;
  const px = new Float64Array(M), py = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const u = i / (M - 1), iu = 1 - u;
    px[i] = iu * iu * x0 + 2 * iu * u * cx + u * u * x1;
    py[i] = iu * iu * y0 + 2 * iu * u * cy + u * u * y1;
  }
  const a0 = ctx.globalAlpha;
  if (alpha != null) ctx.globalAlpha = a0 * alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < M; i++) {
    const i0 = i > 0 ? i - 1 : i, i1 = i < M - 1 ? i + 1 : i;
    let dx = px[i1] - px[i0], dy = py[i1] - py[i0];
    const inv = 1 / (Math.hypot(dx, dy) || 1);
    dx *= inv; dy *= inv;
    const w = (w0 + (w1 - w0) * (i / (M - 1))) * 0.5;
    const X = px[i] - dy * w, Y = py[i] + dx * w;
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  }
  for (let i = M - 1; i >= 0; i--) {
    const i0 = i > 0 ? i - 1 : i, i1 = i < M - 1 ? i + 1 : i;
    let dx = px[i1] - px[i0], dy = py[i1] - py[i0];
    const inv = 1 / (Math.hypot(dx, dy) || 1);
    dx *= inv; dy *= inv;
    const w = (w0 + (w1 - w0) * (i / (M - 1))) * 0.5;
    ctx.lineTo(px[i] + dy * w, py[i] - dx * w);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = a0;
}

function drawHead(ctx, s, Wd, pal, p, phase, form) {
  const hx = PX[0];                       // 颈根
  const hw = Wd * 0.72;                   // 颅宽基准（不能比颈粗太多）
  const hl = Wd * 2.20;                   // 颅长
  const baseA = ctx.globalAlpha;

  // 局部坐标：u=0 颈根，u=1 吻端
  const hxp = (u) => hx + hl * (u - 0.10);
  const HS = 12;

  // ---------- 鳞冠：颅顶两列小棘，代替"角"（俯视更合理） ----------
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const u = 0.10 + k * 0.16;
      const bx = hxp(u);
      const by = side * hw * (0.52 - k * 0.10);
      const tipLen = hw * (0.34 + form * 0.14);
      ctx.fillStyle = k === 0 ? pal.belly : pal.fin;
      ctx.globalAlpha = baseA * (0.55 - k * 0.12);
      ctx.beginPath();
      ctx.moveTo(bx + hl * 0.05, by);
      ctx.quadraticCurveTo(
        bx - hl * 0.04, by + side * tipLen * 0.7,
        bx - hl * 0.16, by + side * tipLen);
      ctx.quadraticCurveTo(
        bx - hl * 0.06, by + side * tipLen * 0.4,
        bx - hl * 0.04, by);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = baseA;

  // ---------- 龙角：从颅顶后缘向后外方伸出（俯视时是两条长角） ----------
  for (const side of [-1, 1]) {
    const wave = Math.sin(phase * 0.8 + side * 1.2) * Wd * 0.05;
    // 主角：长锥，向后外扫
    taperedRibbon(ctx,
      hx + hl * 0.14, side * hw * 0.40,
      hx - hl * 0.34, side * hw * (0.78 + form * 0.06),
      hx - hl * (0.86 + form * 0.28), side * hw * (0.90 + form * 0.22) + wave,
      Wd * 0.30, Wd * 0.006,
      pal.belly, 0.95);
    // 分叉：主枝中段分出一支，向后偏内
    taperedRibbon(ctx,
      hx - hl * 0.34, side * hw * 0.72,
      hx - hl * 0.66, side * hw * (0.90 + form * 0.08),
      hx - hl * (0.98 + form * 0.18), side * hw * (0.94 + form * 0.16) + wave * 0.6,
      Wd * 0.13, Wd * 0.005,
      pal.fin, 0.80);
  }

  // ---------- 头颅：长楔形（颈 → 眉骨最宽 → 颊 → 钝吻） ----------
  const hg = cachedLinear(ctx, 'jiao|head|' + pal.body + '|' + pal.belly + '|' + pal.fin + '|' + Math.round(hw),
    0, -hw * 1.05, 0, hw * 1.05,
    [[0, pal.fin], [0.22, pal.body], [0.72, pal.body], [1, pal.fin]]);
  ctx.fillStyle = hg;
  ctx.beginPath();
  // 颈根（左右各一半宽）
  ctx.moveTo(hxp(0), -hw * 0.62);
  // 上缘：颈 → 眉骨 → 颊
  ctx.bezierCurveTo(
    hxp(0.10), -hw * 0.90,
    hxp(0.26), -hw * 1.02,
    hxp(0.40), -hw * 0.98);
  ctx.bezierCurveTo(
    hxp(0.58), -hw * 0.92,
    hxp(0.74), -hw * 0.76,
    hxp(0.86), -hw * 0.58);
  // 钝吻：向前收窄但保持厚度
  ctx.bezierCurveTo(
    hxp(0.97), -hw * 0.46,
    hxp(1.02), -hw * 0.30,
    hxp(1.02), 0);
  // 下缘镜像
  ctx.bezierCurveTo(
    hxp(1.02), hw * 0.30,
    hxp(0.97), hw * 0.46,
    hxp(0.86), hw * 0.58);
  ctx.bezierCurveTo(
    hxp(0.74), hw * 0.76,
    hxp(0.58), hw * 0.92,
    hxp(0.40), hw * 0.98);
  ctx.bezierCurveTo(
    hxp(0.26), hw * 1.02,
    hxp(0.10), hw * 0.90,
    hxp(0), hw * 0.62);
  ctx.closePath();
  ctx.fill();

  // ---------- 头内明暗：中脊亮、两侧深 ----------
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(hxp(0), -hw * 0.62);
  for (let i = 1; i <= HS; i++) {
    const u = i / HS;
    const w = hw * headWidth(u);
    ctx.lineTo(hxp(u), -w);
  }
  ctx.lineTo(hxp(1.02), 0);
  for (let i = HS; i >= 0; i--) {
    const u = i / HS;
    const w = hw * headWidth(u);
    ctx.lineTo(hxp(u), w);
  }
  ctx.closePath();
  ctx.clip();
  const topLight = cachedLinear(ctx, 'jiao|headlight|' + pal.belly + '|' + Math.round(hw),
    0, -hw * 0.62, 0, hw * 0.62,
    [[0, pal.belly + '00'], [0.36, pal.belly + '58'], [0.64, pal.belly + '58'], [1, pal.belly + '00']]);
  ctx.globalAlpha = baseA * 0.52;
  ctx.fillStyle = topLight;
  ctx.fillRect(hx - hl * 1.4, -hw * 1.8, hl * 3.2, hw * 3.6);
  ctx.restore();

  // ---------- 吻端暗角 ----------
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(hxp(0.66), -hw * 0.86);
  ctx.lineTo(hxp(1.06), -hw * 0.5);
  ctx.lineTo(hxp(1.06), hw * 0.5);
  ctx.lineTo(hxp(0.66), hw * 0.86);
  ctx.closePath();
  ctx.clip();
  const snoutShade = cachedLinear(ctx, 'jiao|snout|' + pal.fin + '|' + Math.round(hw),
    hxp(0.66), 0, hxp(1.06), 0,
    [[0, pal.fin + '00'], [0.55, pal.fin + '28'], [1, pal.fin + '58']]);
  ctx.globalAlpha = baseA * 0.85;
  ctx.fillStyle = snoutShade;
  ctx.fillRect(hx - hl * 1.4, -hw * 1.6, hl * 3.2, hw * 3.2);
  ctx.restore();

  // ---------- 下颌线 ----------
  ctx.globalAlpha = baseA * 0.28;
  ctx.strokeStyle = pal.fin;
  ctx.lineWidth = Math.max(0.4, s * 0.014);
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hxp(1.00), side * hw * 0.34);
    ctx.bezierCurveTo(
      hxp(0.92), side * hw * 0.60,
      hxp(0.80), side * hw * 0.80,
      hxp(0.62), side * hw * 0.86);
    ctx.stroke();
  }
  ctx.globalAlpha = baseA;

  // ---------- 额甲：中脊 + 眶上棱 ----------
  ctx.globalAlpha = baseA * 0.18;
  ctx.strokeStyle = pal.belly;
  ctx.lineWidth = Math.max(0.35, s * 0.013);
  ctx.beginPath();
  ctx.moveTo(hxp(0.06), 0);
  ctx.lineTo(hxp(0.86), 0);
  ctx.stroke();
  ctx.globalAlpha = baseA * 0.14;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hxp(0.16), side * hw * 0.34);
    ctx.quadraticCurveTo(hxp(0.36), side * hw * 0.62,
      hxp(0.56), side * hw * 0.46);
    ctx.stroke();
  }
  ctx.globalAlpha = baseA;

  // ---------- 须：一对长须 ----------
  const wob = Math.sin(phase * 0.9) * Wd * 0.14;
  for (const side of [-1, 1]) {
    taperedRibbon(ctx,
      hxp(0.92), side * hw * 0.34,
      hxp(1.22), side * hw * (0.72 + wob / Wd),
      hxp(1.56), side * hw * (0.42 - wob / Wd * 0.4),
      Wd * 0.10, Wd * 0.005,
      pal.belly, 0.92);
  }

  // ---------- 眼：位于眉骨之后，向侧外凸 ----------
  for (const side of [-1, 1]) {
    const ex = hxp(0.46);
    const ey = side * hw * 0.66;
    const er = Math.max(0.9, s * 0.064);

    ctx.fillStyle = 'rgba(8,6,3,0.34)';
    ctx.beginPath();
    ctx.ellipse(ex + er * 0.30, ey, er * 1.85, er * 1.10, 0.16 * side, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(ex, ey);
    const ig = cachedRadial(ctx, 'jiao|iris|' + Math.round(s),
      0, 0, er * 0.10, 0, 0, er * 1.02,
      [[0, '#fff6d2'], [0.42, '#f4b83c'], [1, '#6a3806']]);
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.arc(0, 0, er, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#07060a';
    ctx.beginPath();
    ctx.ellipse(er * 0.16, 0, er * 0.20, er * 0.80, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(-er * 0.26, -er * 0.44, er * 0.27, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(er * 0.24, er * 0.40, er * 0.12, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ---------- 口 ----------
  const m = p.mouthOpen || 0;
  const mx = hxp(1.02);
  if (m > 0.06) {
    const jaw = hw * 0.52 * m;
    ctx.fillStyle = 'rgba(26,6,3,0.93)';
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.quadraticCurveTo(hxp(0.96), -jaw, hxp(0.62), -jaw * 0.70);
    ctx.lineTo(hxp(0.56), 0);
    ctx.lineTo(hxp(0.62), jaw * 0.70);
    ctx.quadraticCurveTo(hxp(0.96), jaw, mx, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(hxp(0.70), 0, hl * 0.026, jaw * 0.26, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = pal.belly;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const fx = hxp(0.88 - k * 0.10);
        const hh = jaw * (k ? 0.50 : 0.74);
        ctx.beginPath();
        ctx.moveTo(fx - hl * 0.022, side * jaw * 0.10);
        ctx.lineTo(fx, side * hh);
        ctx.lineTo(fx + hl * 0.020, side * jaw * 0.24);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.strokeStyle = 'rgba(255,238,190,0.55)';
    ctx.lineWidth = Math.max(0.4, s * 0.014);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.quadraticCurveTo(hxp(0.96), -jaw, hxp(0.62), -jaw * 0.70);
    ctx.moveTo(mx, 0);
    ctx.quadraticCurveTo(hxp(0.96), jaw, hxp(0.62), jaw * 0.70);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(28,12,4,0.55)';
    ctx.lineWidth = Math.max(0.4, s * 0.015);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(mx - hw * 0.06, 0);
    ctx.lineTo(hxp(0.66), 0);
    ctx.stroke();
    for (const side of [-1, 1]) {
      ctx.fillStyle = 'rgba(28,12,4,0.40)';
      ctx.beginPath();
      ctx.ellipse(hxp(0.88), side * hw * 0.26, s * 0.011, s * 0.018, 0, 0, TAU);
      ctx.fill();
    }
  }
}

// ============================================================
// 躯干：渐变 + 背脊高光 + 腹侧暗部 + 描边
// ============================================================
function drawBody(ctx, s, pal, Wd, form) {
  const WdQ = Math.max(2, Math.round(Wd * 2) / 2);
  const grad = cachedLinear(ctx, 'jiao|body|' + pal.body + '|' + pal.fin + '|' + WdQ,
    0, -WdQ * 1.6, 0, WdQ * 1.6,
    [[0, pal.fin], [0.22, pal.body], [0.50, pal.body],
      [0.78, pal.body], [1, pal.fin]]);

  bodyPath(ctx);
  ctx.fillStyle = grad;
  ctx.fill();

  // 明暗全部裁在身体内，避免溢到外面
  ctx.save();
  bodyPath(ctx);
  ctx.clip();
  strokeSpine(ctx, -0.34, 0.46, pal.belly, 0.30 + form * 0.08);  // 背脊受光
  strokeSpine(ctx, 0.66, 0.42, pal.fin, 0.26);                   // 腹侧压暗
  strokeSpine(ctx, -0.06, 0.16, pal.belly, 0.20);                // 中央细亮线
  ctx.restore();

  // 轮廓
  const baseA = ctx.globalAlpha;
  bodyPath(ctx);
  ctx.globalAlpha = baseA * 0.50;
  ctx.strokeStyle = pal.fin;
  ctx.lineWidth = Math.max(0.8, s * 0.045);
  ctx.stroke();
  ctx.globalAlpha = baseA;
}

// ============================================================
// 对外：draw(ctx, s, pal, p, b)
// ============================================================
export function draw(ctx, s, pal, p, b) {
  const L = s * 1.62 * b.len;
  const Wd = s * 0.66 * b.wide;
  const finMul = b.fin || 1;
  const form = Math.min(1, (p.formIndex || 0) / 4);
  const phase = p.tailPhase || 0;

  buildSpine(L, Wd, phase);

  // 化形光环：贴身体的一层柔光
  if (form > 0.1) {
    drawGlow(ctx, -L * 0.30, 0, L * 1.0, pal.glow, 0.10 + form * 0.22);
  }

  // 由后往前叠：尾鳍 → 背冠 → 胸鳍 → 身体 → 鳞 → 头
  drawTailFin(ctx, s, Wd, pal, phase, finMul * (0.9 + form * 0.25));
  drawPectorals(ctx, s, Wd, pal, phase, finMul);
  drawBody(ctx, s, pal, Wd, form);
  drawScales(ctx, s, Wd, pal, phase);
  drawDorsalCrest(ctx, s, Wd, pal, phase, finMul * (0.9 + form * 0.30));

  // 脊背流光：化形越高越亮
  const baseA = ctx.globalAlpha;
  ctx.strokeStyle = pal.belly;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.5, Wd * 0.075);
  for (let i = 1; i < N - 4; i++) {
    const a = 1 - i / (N - 1);
    ctx.globalAlpha = baseA * (0.06 + form * 0.20) * a;
    ctx.beginPath();
    ctx.moveTo(PX[i] - PTX[i] * 0.5, PY[i] - PTY[i] * 0.5);
    ctx.lineTo(PX[i + 1] + PTX[i + 1] * 0.5, PY[i + 1] + PTY[i + 1] * 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = baseA;

  drawHead(ctx, s, Wd, pal, p, phase, form);

  // 化形后期：额珠 / 幽光
  if (form > 0.45) {
    const bx = PX[0] + Wd * 0.30;
    const pulse = 0.65 + 0.35 * Math.sin(phase * 1.4);
    drawGlow(ctx, bx, 0, s * 0.30 * pulse, pal.glow, 0.30 * form);
    ctx.globalAlpha *= 0.78;
    ctx.fillStyle = pal.belly;
    ctx.beginPath();
    ctx.ellipse(bx, 0, s * 0.026, s * 0.042, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha /= 0.78;
  }
}