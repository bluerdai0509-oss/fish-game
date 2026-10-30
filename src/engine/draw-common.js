// ============================================================
// 绘制共享工具：渐变缓存 / 发光 / 通用部件
// 所有种族绘制文件（src/heroes/*.js）共用
// ============================================================
export const TAU = Math.PI * 2;

// ---------- 渐变缓存 ----------
const _gradCache = new Map();
const GRAD_CACHE_MAX = 400;

export function cachedLinear(ctx, key, x0, y0, x1, y1, stops) {
  let g = _gradCache.get(key);
  if (!g) {
    g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    if (_gradCache.size > GRAD_CACHE_MAX) _gradCache.clear();
    _gradCache.set(key, g);
  }
  return g;
}

export function cachedRadial(ctx, key, x0, y0, r0, x1, y1, r1, stops) {
  let g = _gradCache.get(key);
  if (!g) {
    g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    if (_gradCache.size > GRAD_CACHE_MAX) _gradCache.clear();
    _gradCache.set(key, g);
  }
  return g;
}

// ---------- 发光晕 ----------
export function drawGlow(ctx, x, y, r, color, alpha = 0.35) {
  const rq = Math.max(4, Math.round(r / 4) * 4);
  const aq = Math.round(alpha * 20) / 20;
  const key = 'glow|' + color + '|' + rq + '|' + aq;
  let g = _gradCache.get(key);
  if (!g) {
    g = ctx.createRadialGradient(0, 0, rq * 0.2, 0, 0, rq);
    g.addColorStop(0, color.replace('ALPHA', aq));
    g.addColorStop(1, color.replace('ALPHA', 0));
    if (_gradCache.size > GRAD_CACHE_MAX) _gradCache.clear();
    _gradCache.set(key, g);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rq, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------- 角度插值 ----------
export function smoothAngle(cur, target, k) {
  let d = target - cur;
  d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return cur + d * k;
}

// ============================================================
// 通用部件（各种族可复用，也可各自覆盖）
// ============================================================

/** 眼睛：一对，位于身体两侧 */
export function drawEyes(ctx, s, Wd, L, opt = {}) {
  const ex = opt.ex ?? 0.6, ey = opt.ey ?? 0.48, r = opt.r ?? 0.19;
  const pupil = opt.pupil || '#10222e';
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(L * ex, side * Wd * ey, s * r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = pupil;
    ctx.beginPath();
    ctx.arc(L * (ex + 0.07), side * Wd * ey, s * r * 0.52, 0, TAU);
    ctx.fill();
    // 高光
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(L * (ex + 0.11), side * Wd * ey - s * 0.06, s * r * 0.22, 0, TAU);
    ctx.fill();
  }
}

/** 张嘴：吻端 V 形开口 */
export function drawMouth(ctx, s, Wd, L, m, jawW = 0.62) {
  if (!(m > 0.06)) return;
  const jaw = Wd * jawW * m;
  ctx.fillStyle = 'rgba(26,8,2,0.88)';
  ctx.beginPath();
  ctx.moveTo(L * 1.0, 0);
  ctx.quadraticCurveTo(L * 0.98, -jaw, L * 0.70, -jaw * 0.92);
  ctx.lineTo(L * 0.66, 0);
  ctx.lineTo(L * 0.70, jaw * 0.92);
  ctx.quadraticCurveTo(L * 0.98, jaw, L * 1.0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,238,190,0.9)';
  ctx.lineWidth = Math.max(1.8, s * 0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(L * 0.94, 0); ctx.lineTo(L * 1.02, -jaw * 1.12);
  ctx.moveTo(L * 0.94, 0); ctx.lineTo(L * 1.02, jaw * 1.12);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.ellipse(L * 0.74, 0, L * 0.06, jaw * 0.5, 0, 0, TAU);
  ctx.fill();
}

/** 尾鳍（扇形，左右摆动） */
export function drawTailFan(ctx, s, pal, L, wag, spread = 0.72) {
  ctx.save();
  ctx.translate(-L * 0.92, 0);
  ctx.rotate(wag);
  ctx.fillStyle = pal.fin;
  ctx.beginPath();
  ctx.moveTo(s * 0.2, 0);
  ctx.lineTo(-s * 1.05, -s * spread);
  ctx.quadraticCurveTo(-s * 0.6, 0, -s * 1.05, s * spread);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 胸鳍（一对，向后划水） */
export function drawPectorals(ctx, s, pal, Wd, phase, sizeMul = 1) {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(-s * 0.05, side * Wd * 0.68);
    ctx.rotate(side * (1.15 + Math.sin(phase * 1.3) * 0.18));
    ctx.fillStyle = pal.fin;
    ctx.globalAlpha = ctx.globalAlpha * 0.55;
    ctx.beginPath();
    ctx.ellipse(-s * 0.2, 0, s * 0.26 * sizeMul, s * 0.085 * sizeMul, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}