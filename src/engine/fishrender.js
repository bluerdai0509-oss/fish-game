// ============================================================
// 程序化生物绘制 —— 俯视（背部）视角
// 从水面看下去：脊背 / 左右摆的尾鳍 / 两侧眼睛 / 背鳍脊线
// 水墨感：alpha 叠加 + 留白 + 墨点粒子（无滤镜/blur/shader）
// 全部生物头朝 +x 绘制，由调用方旋转到移动方向
// ============================================================
import * as HeroKun from '../heroes/kun.js';
import * as HeroRay from '../heroes/ray.js';
import * as HeroAo from '../heroes/ao.js';
import * as HeroJiao from '../heroes/jiao.js';

const TAU = Math.PI * 2;

// ============================================================
// 渐变缓存：同尺寸+同颜色的渐变只创建一次，之后复用
// Canvas 渐变对象与坐标无关（只依赖创建时的坐标空间），
// 而所有生物都在本地坐标系里绘制，因此可以安全缓存。
// ============================================================
const _gradCache = new Map();
const GRAD_CACHE_MAX = 400;

function cachedLinear(ctx, key, x0, y0, x1, y1, stops) {
  let g = _gradCache.get(key);
  if (!g) {
    g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [p, c] of stops) g.addColorStop(p, c);
    if (_gradCache.size > GRAD_CACHE_MAX) _gradCache.clear();
    _gradCache.set(key, g);
  }
  return g;
}

function cachedRadial(ctx, key, x0, y0, r0, x1, y1, r1, stops) {
  let g = _gradCache.get(key);
  if (!g) {
    g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const [p, c] of stops) g.addColorStop(p, c);
    if (_gradCache.size > GRAD_CACHE_MAX) _gradCache.clear();
    _gradCache.set(key, g);
  }
  return g;
}

/** 发光晕（已缓存）；color 形如 'rgba(140,190,255,ALPHA)' */
export function drawGlow(ctx, x, y, r, color, alpha = 0.35) {
  // 半径量化到 4px，颜色按 alpha 量化到 0.05，避免缓存爆炸
  const rq = Math.max(4, Math.round(r / 4) * 4);
  const aq = Math.round(alpha * 20) / 20;
  const key = `glow|${color}|${rq}|${aq}`;
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

/** 平滑角度插值（最短弧） */
export function smoothAngle(cur, target, k) {
  let d = target - cur;
  d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return cur + d * k;
}

// ============================================================
// 精灵缓存（决定性优化）
// 普通 NPC 鱼每帧重画要 9 次 fill；改成按「类型+尺寸+尾摆相位」烘焙成
// 离屏位图，每帧只需 1 次 drawImage。
// ============================================================
const _spriteCache = new Map();

/** 把任意尺寸量化到 14 个几何档位（6 → 200px），保证缓存命中率 */
const SIZE_STEPS = [6, 8, 11, 14, 18, 23, 30, 38, 48, 62, 78, 100, 128, 160, 200];
function quantizeSize(px) {
  for (let i = 0; i < SIZE_STEPS.length; i++) {
    if (px <= SIZE_STEPS[i]) return SIZE_STEPS[i];
  }
  return SIZE_STEPS[SIZE_STEPS.length - 1];
}

/**
 * 缓存按「像素预算」而不是条目数淘汰。
 * 超采样后单张纹理面积是 4 倍，按条目数会低估显存；
 * 2400 万像素 ≈ 96MB RGBA，是能接受的常驻上限。
 */
const SPRITE_PIXEL_BUDGET = 24e6;
let _spritePixels = 0;

/**
 * 烘焙超采样倍率。
 * 纹理是 1x 画出来再交给 GPU 拉伸的，在高 DPI 屏或镜头放大时会明显发虚。
 * 小/中号鱼用 2x 烘焙（物理尺寸上限 1024，避免显存爆炸），大号鱼保持 1x。
 */
function spriteSuperSample(dim) {
  return dim <= 512 ? 2 : 1;
}

let _fishTypesRef = null;
export function registerFishTypes(types) { _fishTypesRef = types; }

/**
 * 两个颜色混合。只处理 #rrggbb；rgba()/命名色原样返回（水母等用半透明调色板）。
 * 结果缓存，避免每帧解析十六进制。
 */
const _mixCache2 = new Map();
function mixHex(a, b, t) {
  if (typeof a !== 'string' || typeof b !== 'string') return a;
  if (a.length !== 7 || b.length !== 7 || a[0] !== '#' || b[0] !== '#') return a;
  const key = a + b + t;
  const hit = _mixCache2.get(key);
  if (hit) return hit;
  const ai = parseInt(a.slice(1), 16);
  const bi = parseInt(b.slice(1), 16);
  const r = Math.round(((ai >> 16) & 255) + ((((bi >> 16) & 255) - ((ai >> 16) & 255)) * t));
  const g = Math.round(((ai >> 8) & 255) + ((((bi >> 8) & 255) - ((ai >> 8) & 255)) * t));
  const bl = Math.round((ai & 255) + (((bi & 255) - (ai & 255)) * t));
  const v = '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  if (_mixCache2.size > 300) _mixCache2.clear();
  _mixCache2.set(key, v);
  return v;
}

function _palFor(typeKey) {
  return (_fishTypesRef && _fishTypesRef[typeKey] && _fishTypesRef[typeKey].palette)
    || { body: '#7fb069', belly: '#d8e8c0', fin: '#4a7c3f' };
}

/**
 * 淘汰：按插入顺序删最旧的，直到回到预算的 60%。
 * 只删一部分而不是清空，避免周期性重建尖峰。
 */
function _evictSprites() {
  if (_spritePixels <= SPRITE_PIXEL_BUDGET) return;
  const target = SPRITE_PIXEL_BUDGET * 0.6;
  for (const [k, spr] of _spriteCache) {
    if (_spritePixels <= target) break;
    _spritePixels -= spr.canvas.width * spr.canvas.height;
    _spriteCache.delete(k);
  }
}

/** 写入缓存并登记像素占用 */
function _cacheSprite(key, spr) {
  _spriteCache.set(key, spr);
  _spritePixels += spr.canvas.width * spr.canvas.height;
  _evictSprites();
}


/**
 * 烘焙一个实体精灵。
 * 纹理按 ss 倍超采样绘制，但 `dim` 始终是逻辑尺寸 ——
 * 渲染端按 (size * 4.8) / dim 缩放，不受超采样影响。
 */
function _bakeSprite(f, size) {
  const dim = Math.ceil(size * 4.8);
  const ss = spriteSuperSample(dim);
  const c = document.createElement('canvas');
  c.width = c.height = dim * ss;
  const g = c.getContext('2d');
  g.scale(ss, ss);
  g.translate(dim / 2, dim / 2);

  const pal = _palFor(f.typeKey);
  switch (f.shape) {
    case 'shrimp': drawShrimpDorsal(g, size, pal, 0); break;
    case 'jelly': drawJellyDorsal(g, size, pal, 0); break;
    case 'sword': drawSwordDorsal(g, size, pal, 0); break;
    case 'monster': drawMonsterDorsal(g, size, pal, 0); break;
    case 'humanface': drawHumanFace(g, size, pal, 0); break;
    case 'multi': drawMultiBody(g, size, pal, 0); break;
    case 'winged': drawWinged(g, size, pal, 0, 0); break;
    case 'merfolk': drawMerfolk(g, size, pal, 0); break;
    case 'clam': drawClam(g, size, pal, 0); break;
    case 'serpent': drawSerpent(g, size, pal, 0, 0); break;
    case 'ninehead': drawNineHead(g, size, pal, 0, 0); break;
    case 'chaos': drawChaos(g, size, pal, 0, 0); break;
    case 'turtle': drawTurtle(g, size, pal, 0); break;
    case 'lantern': drawLantern(g, size, pal, 0, 0); break;
    default: drawFishDorsal(g, size, pal, 0, { striped: f.striped });
  }
  return { canvas: c, dim, half: dim / 2 };
}

/** 精灵绘制：任意形状按「类型+尺寸」烘焙一次 */
function drawAnySprite(ctx, f, t) {
  const size = Math.max(8, Math.round(f.size / 4) * 4);
  const key = `a|${f.typeKey}|${size}|${f.striped ? 1 : 0}`;
  let spr = _spriteCache.get(key);
  if (!spr) {
    spr = _bakeSprite(f, size);
    _cacheSprite(key, spr);
  }
  ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.dim, spr.dim);
}

/** 用精灵绘制普通鱼 —— 每条鱼每档尺寸只烘焙一次，尾巴用整体摆动模拟 */
function drawFishSprite(ctx, f, t) {
  const size = Math.max(8, Math.round(f.size / 4) * 4);   // 4px 一档
  const key = `f|${f.typeKey}|${size}|${f.striped ? 1 : 0}`;
  let spr = _spriteCache.get(key);
  if (!spr) {
    spr = _bakeSprite(f, size);
    _cacheSprite(key, spr);
  }
  // 尾巴摆动：对整张精灵做极轻微的角度摆动（视觉上等同摆尾，成本为 0）
  const wobble = Math.sin(f.tailPhase) * 0.045;
  ctx.save();
  ctx.rotate(wobble);
  ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.dim, spr.dim);
  ctx.restore();
}

// ============================================================
// 通用部件：鱼体轮廓 / 体积明暗 / 鳞片 / 鳍膜 / 眼
// 全部用 alpha 叠加（不解析调色板），因此对 rgba() 调色板同样安全
// ============================================================

/** 身形轮廓（归一化 x → 半宽系数），吻端 → 尾柄，左右镜像后平滑闭合 */
const FISH_PROF = [
  [1.000, 0.028], [0.978, 0.170], [0.938, 0.336], [0.874, 0.500],
  [0.790, 0.653], [0.678, 0.788], [0.536, 0.896], [0.374, 0.966],
  [0.196, 0.998], [0.010, 0.990], [-0.176, 0.948], [-0.346, 0.874],
  [-0.506, 0.772], [-0.646, 0.642], [-0.766, 0.482], [-0.856, 0.316],
  [-0.912, 0.164], [-0.940, 0.070],
];

/** 沿轮廓画闭合鱼身（贝塞尔穿过相邻采样点中点，天然平滑） */
function pathFishBody(ctx, L, Wd) {
  const N = FISH_PROF.length;
  const pts = [];
  for (let i = 0; i < N; i++) pts.push([FISH_PROF[i][0] * L, -FISH_PROF[i][1] * Wd]);
  for (let i = N - 1; i >= 0; i--) pts.push([FISH_PROF[i][0] * L, FISH_PROF[i][1] * Wd]);
  const M = pts.length;
  ctx.beginPath();
  ctx.moveTo((pts[M - 1][0] + pts[0][0]) / 2, (pts[M - 1][1] + pts[0][1]) / 2);
  for (let i = 0; i < M; i++) {
    const a = pts[i], b = pts[(i + 1) % M];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.closePath();
}

/** 圆柱体积：两侧压暗 + 脊背受光，让扁平的色块立起来 */
function bodyVolume(ctx, L, Wd) {
  const side = cachedLinear(ctx, `fishvol|${Wd.toFixed(1)}`, 0, -Wd, 0, Wd, [
    [0.00, 'rgba(0,0,0,0.46)'],
    [0.09, 'rgba(0,0,0,0.20)'],
    [0.20, 'rgba(0,0,0,0.02)'],
    [0.34, 'rgba(0,0,0,0)'],
    [0.62, 'rgba(0,0,0,0)'],
    [0.78, 'rgba(0,0,0,0.06)'],
    [0.90, 'rgba(0,0,0,0.24)'],
    [1.00, 'rgba(0,0,0,0.50)'],
  ]);
  ctx.fillStyle = side;
  ctx.fillRect(-L * 1.06, -Wd * 1.1, L * 2.12, Wd * 2.2);

  // 脊背高光带（略偏上，模拟斜上方来光）
  const hi = cachedLinear(ctx, `fishhi|${Wd.toFixed(1)}`, 0, -Wd, 0, Wd, [
    [0.00, 'rgba(255,255,255,0)'],
    [0.16, 'rgba(255,255,255,0.06)'],
    [0.30, 'rgba(255,255,255,0.17)'],
    [0.44, 'rgba(255,255,255,0.04)'],
    [0.58, 'rgba(255,255,255,0)'],
    [1.00, 'rgba(255,255,255,0)'],
  ]);
  ctx.fillStyle = hi;
  ctx.fillRect(-L * 1.06, -Wd * 1.1, L * 2.12, Wd * 2.2);
}

/** 鳞片：两排交错的小弧，亮/暗各一道形成淡淡浮雕 */
function fishScales(ctx, s, L, Wd) {
  if (s < 11) return;
  const r = s * 0.155;
  const rowStep = Wd * 0.20;
  const colStep = L * 0.115;
  ctx.save();
  ctx.lineWidth = Math.max(0.5, s * 0.016);
  for (let i = 0; i < 7; i++) {
    const x = L * 0.34 - i * colStep;
    for (let j = -3; j <= 3; j++) {
      const y = j * rowStep + (i % 2 ? rowStep * 0.5 : 0);
      if (Math.abs(y) > Wd * 0.86) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath();
      ctx.arc(x, y, r, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.beginPath();
      ctx.arc(x - r * 0.06, y + r * 0.16, r, Math.PI * 0.22, Math.PI * 0.78);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 鳃裂：头后一道弧形浅痕 */
function fishGill(ctx, s, L, Wd) {
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = Math.max(0.8, s * 0.03);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(L * 0.46, -Wd * 0.72);
  ctx.quadraticCurveTo(L * 0.34, 0, L * 0.46, Wd * 0.72);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = Math.max(0.6, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(L * 0.50, -Wd * 0.68);
  ctx.quadraticCurveTo(L * 0.38, 0, L * 0.50, Wd * 0.68);
  ctx.stroke();
}

/** 尾鳍：双叶扇 + 鳍条 */
function drawCaudalFin(ctx, s, pal) {
  ctx.globalAlpha *= 0.88;
  ctx.beginPath();
  ctx.moveTo(s * 0.22, 0);
  ctx.bezierCurveTo(-s * 0.06, -s * 0.34, -s * 0.46, -s * 0.66, -s * 0.90, -s * 0.72);
  ctx.bezierCurveTo(-s * 0.78, -s * 0.38, -s * 0.60, -s * 0.12, -s * 0.50, 0);
  ctx.bezierCurveTo(-s * 0.60, s * 0.12, -s * 0.78, s * 0.38, -s * 0.90, s * 0.72);
  ctx.bezierCurveTo(-s * 0.46, s * 0.66, -s * 0.06, s * 0.34, s * 0.22, 0);
  ctx.closePath();
  const g = cachedLinear(ctx, `caudal|${pal.fin}|${pal.belly}|${Math.round(s)}`,
    0, 0, -s * 0.9, 0,
    [[0, pal.fin], [0.55, pal.fin], [1, pal.belly]]);
  ctx.fillStyle = g;
  ctx.fill();

  // 鳍条：自尾柄放射
  ctx.strokeStyle = 'rgba(0,0,0,0.13)';
  ctx.lineWidth = Math.max(0.6, s * 0.022);
  for (let i = 1; i <= 5; i++) {
    const k = i / 6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.02, side * s * 0.03);
      ctx.quadraticCurveTo(-s * 0.34, side * s * 0.16 * k, -s * (0.62 + k * 0.24), side * s * (0.16 + k * 0.52));
      ctx.stroke();
    }
  }
  // 叶尖亮边
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = Math.max(0.7, s * 0.026);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.90, side * s * 0.72);
    ctx.quadraticCurveTo(-s * 0.46, side * s * 0.66, s * 0.16, side * s * 0.08);
    ctx.stroke();
  }
}

/** 胸鳍：半透明柳叶 + 鳍条 */
function drawPectoralFin(ctx, s, pal) {
  ctx.globalAlpha *= 0.72;
  ctx.beginPath();
  ctx.moveTo(s * 0.16, 0);
  ctx.bezierCurveTo(-s * 0.06, -s * 0.10, -s * 0.34, -s * 0.13, -s * 0.56, -s * 0.05);
  ctx.bezierCurveTo(-s * 0.42, s * 0.05, -s * 0.16, s * 0.10, s * 0.16, 0);
  ctx.closePath();
  const g = cachedLinear(ctx, `pec|${pal.fin}|${pal.belly}|${Math.round(s)}`,
    0, 0, -s * 0.56, 0, [[0, pal.fin], [1, pal.belly]]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(0.5, s * 0.018);
  for (let i = 0; i < 3; i++) {
    const k = (i + 1) / 4;
    ctx.beginPath();
    ctx.moveTo(s * 0.06, 0);
    ctx.quadraticCurveTo(-s * 0.22, -s * 0.04 * k, -s * 0.48, -s * 0.07 * k);
    ctx.stroke();
  }
}

/** 精细眼：眼窝 → 眼白 → 虹膜 → 高光
 *  瞳孔占比做大（0.72），小鱼在游戏尺寸下才不会只剩两点白圈 */
function drawFishEye(ctx, s, x, y, r, iris = '#16242e') {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.10, y, r * 1.40, r * 1.24, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = '#eae4d4';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(x + r * 0.14, y, r * 0.74, 0, TAU);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.arc(x + r * 0.34, y - r * 0.34, r * 0.28, 0, TAU);
  ctx.fill();
}

// ---------- 通用背视鱼形（溪鱼/鲦鱼/鲳鱼/冥鱼共用） ----------
export function drawFishDorsal(ctx, s, pal, tailPhase, opts = {}) {
  const baseA = ctx.globalAlpha;
  const L = s * 1.70;    // 半长
  const Wd = s * 0.78;   // 半宽
  const wag = Math.sin(tailPhase) * 0.55;

  // ---- 尾鳍（在身体之后绘制，根部被躯干压住）----
  ctx.save();
  ctx.translate(-L * 0.86, 0);
  ctx.rotate(wag);
  drawCaudalFin(ctx, s, pal);
  ctx.restore();

  // ---- 胸鳍（半透明，向后划水）----
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(s * 0.34, side * Wd * 0.66);
    ctx.rotate(side * (0.76 + Math.sin(tailPhase * 1.3) * 0.20));
    ctx.scale(1, side);
    drawPectoralFin(ctx, s, pal);
    ctx.restore();
  }
  ctx.globalAlpha = baseA;

  // ---- 身体底色 ----
  pathFishBody(ctx, L, Wd);
  ctx.fillStyle = pal.body;
  ctx.fill();

  // ---- 体积 + 纹理（裁剪在体内）----
  ctx.save();
  pathFishBody(ctx, L, Wd);
  ctx.clip();

  bodyVolume(ctx, L, Wd);
  fishScales(ctx, s, L, Wd);

  // 花纹：柔和渐隐的竖带（比原来的硬竖线自然）
  if (opts.striped) {
    for (const k of [-0.42, -0.06, 0.30]) {
      const px = L * k;
      const band = cachedLinear(ctx, `stripe|${Wd.toFixed(1)}|${k}`, px + s * 0.30, 0, px - s * 0.30, 0,
        [[0, 'rgba(0,0,0,0)'], [0.5, 'rgba(0,0,0,0.20)'], [1, 'rgba(0,0,0,0)']]);
      ctx.fillStyle = band;
      ctx.fillRect(px - s * 0.34, -Wd, s * 0.68, Wd * 2);
    }
  }

  // 背脊：一道浅色脊线 + 几节椎骨短痕
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(0.8, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(L * 0.52, 0);
  ctx.quadraticCurveTo(0, -s * 0.035, -L * 0.72, 0);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = Math.max(0.5, s * 0.02);
  for (let i = 0; i < 5; i++) {
    const px = L * (0.28 - i * 0.20);
    ctx.beginPath();
    ctx.moveTo(px, -s * 0.05);
    ctx.lineTo(px, s * 0.05);
    ctx.stroke();
  }
  ctx.restore();

  // ---- 鳃裂 ----
  fishGill(ctx, s, L, Wd);

  // ---- 轮廓：一道细描边，让鱼从水色里"立"出来 ----
  pathFishBody(ctx, L, Wd);
  ctx.strokeStyle = 'rgba(0,0,0,0.26)';
  ctx.lineWidth = Math.max(0.8, s * 0.035);
  ctx.stroke();
  // 上缘受光
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = Math.max(0.6, s * 0.024);
  ctx.beginPath();
  ctx.arc(0, 0, Wd * 0.99, Math.PI * 1.06, Math.PI * 1.62);
  ctx.stroke();

  // ---- 双眼 ----
  const eyeR = Math.max(1.3, s * 0.135);
  for (const side of [-1, 1]) {
    drawFishEye(ctx, s, L * 0.60, side * Wd * 0.46, eyeR, opts.iris || '#16242e');
  }

  // ---- 嘴（吻端）：张嘴 = 紧凑 V 形开口 ----
  const m = opts.mouth || 0;
  if (m > 0.08) {
    ctx.fillStyle = 'rgba(24,10,4,0.78)';
    ctx.beginPath();
    ctx.moveTo(L * 0.97, 0);
    ctx.lineTo(L * 1.04, -Wd * 0.26 * m);
    ctx.quadraticCurveTo(L * 1.09, 0, L * 1.04, Wd * 0.26 * m);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,235,200,0.55)';
    ctx.lineWidth = Math.max(0.8, s * 0.045);
    ctx.beginPath();
    ctx.moveTo(L * 0.96, 0); ctx.lineTo(L * 1.05, -Wd * 0.3 * m);
    ctx.moveTo(L * 0.96, 0); ctx.lineTo(L * 1.05, Wd * 0.3 * m);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = Math.max(0.7, s * 0.05);
    ctx.beginPath();
    ctx.arc(L * 0.94, 0, s * 0.10, -0.85, 0.85);
    ctx.stroke();
  }
}

/** 虾兵（背视）：分节长身 + 前伸双须 + 尾扇 */
function drawShrimpDorsal(ctx, s, pal, tailPhase) {
  const baseA = ctx.globalAlpha;

  // ---- 尾扇：三叶，随摆尾张开 ----（先画，被身体压住根部）
  const fan = Math.sin(tailPhase) * 0.22;
  for (const a of [-0.62 + fan, fan, 0.62 + fan]) {
    ctx.save();
    ctx.translate(-s * 0.86, 0);
    ctx.rotate(a);
    const g = cachedLinear(ctx, `shrimpfan|${pal.fin}|${pal.belly}|${Math.round(s)}`,
      0, 0, -s * 0.56, 0, [[0, pal.fin], [1, pal.belly]]);
    ctx.fillStyle = g;
    ctx.globalAlpha = baseA * 0.92;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.10);
    ctx.bezierCurveTo(-s * 0.26, -s * 0.24, -s * 0.50, -s * 0.22, -s * 0.58, 0);
    ctx.bezierCurveTo(-s * 0.50, s * 0.22, -s * 0.26, s * 0.24, 0, s * 0.10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = Math.max(0.5, s * 0.018);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.05, 0);
      ctx.quadraticCurveTo(-s * 0.30, i * s * 0.06, -s * 0.52, i * s * 0.13);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha = baseA;

  // ---- 步足：两侧细长划水足 ----（在身体之下）
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const px = s * (0.34 - i * 0.26);
    const kick = Math.sin(tailPhase * 1.7 + i * 0.9) * 0.20;
    for (const side of [-1, 1]) {
      ctx.strokeStyle = pal.fin;
      ctx.globalAlpha = baseA * 0.8;
      ctx.lineWidth = Math.max(0.8, s * 0.06);
      ctx.beginPath();
      ctx.moveTo(px, side * s * 0.22);
      ctx.quadraticCurveTo(px - s * 0.10, side * s * (0.42 + kick),
        px - s * 0.26, side * s * (0.50 + kick * 1.4));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = baseA;

  // ---- 触须：长而弯，向前上方 ----
  for (const side of [-1, 1]) {
    ctx.strokeStyle = pal.fin;
    ctx.globalAlpha = baseA * 0.9;
    ctx.lineWidth = Math.max(0.7, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(s * 0.84, side * s * 0.10);
    ctx.bezierCurveTo(s * 1.18, side * s * 0.16, s * 1.56, side * s * 0.44, s * 1.78, side * s * 0.24);
    ctx.stroke();
    ctx.globalAlpha = baseA * 0.55;
    ctx.lineWidth = Math.max(0.5, s * 0.032);
    ctx.beginPath();
    ctx.moveTo(s * 0.84, side * s * 0.06);
    ctx.bezierCurveTo(s * 1.10, side * s * 0.02, s * 1.40, side * s * 0.18, s * 1.62, side * s * 0.02);
    ctx.stroke();
  }
  ctx.globalAlpha = baseA;

  // ---- 体节：从尾柄到头部，逐节增大并各自带弧线分界 ----
  const segs = 5;
  for (let i = segs - 1; i >= 0; i--) {
    const k = i / (segs - 1);
    const px = s * (0.66 - k * 1.12);
    const r = s * (0.58 - k * 0.14);
    const g = cachedLinear(ctx, `shrimpseg|${pal.body}|${pal.belly}|${pal.fin}|${i}|${Math.round(s)}`,
      0, -r, 0, r,
      [[0, pal.fin], [0.20, mixHex(pal.body, '#ffffff', 0.22)], [0.52, pal.body], [1, pal.fin]]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, 0, r * 1.10, r, 0, 0, TAU);
    ctx.fill();
    // 体节高光
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.ellipse(px + r * 0.12, -r * 0.26, r * 0.82, r * 0.34, 0, 0, TAU);
    ctx.fill();
    // 节间阴影（后缘一道弧）
    if (i > 0) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = Math.max(0.6, s * 0.022);
      ctx.beginPath();
      ctx.arc(px, 0, r * 0.94, Math.PI * 0.62, Math.PI * 1.38);
      ctx.stroke();
    }
  }

  // ---- 头甲：扇形盾片 + 额剑 ----
  const hg = cachedLinear(ctx, `shrimphead|${pal.body}|${pal.belly}|${pal.fin}|${Math.round(s)}`,
    0, -s * 0.7, 0, s * 0.7,
    [[0, pal.fin], [0.30, pal.body], [0.66, mixHex(pal.body, '#ffffff', 0.18)], [1, pal.fin]]);
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(s * 0.30, -s * 0.62);
  ctx.bezierCurveTo(s * 0.84, -s * 0.62, s * 1.02, -s * 0.28, s * 0.98, 0);
  ctx.bezierCurveTo(s * 1.02, s * 0.28, s * 0.84, s * 0.62, s * 0.30, s * 0.62);
  ctx.quadraticCurveTo(s * 0.12, 0, s * 0.30, -s * 0.62);
  ctx.closePath();
  ctx.fill();
  // 头甲中脊
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = Math.max(0.7, s * 0.026);
  ctx.beginPath();
  ctx.moveTo(s * 0.34, 0);
  ctx.lineTo(s * 0.94, 0);
  ctx.stroke();
  // 额剑（前端尖刺）
  ctx.fillStyle = pal.fin;
  ctx.beginPath();
  ctx.moveTo(s * 0.94, -s * 0.06);
  ctx.lineTo(s * 1.30, 0);
  ctx.lineTo(s * 0.94, s * 0.06);
  ctx.closePath();
  ctx.fill();

  // ---- 眼： stalks 顶尖的小黑眼珠 ----
  for (const side of [-1, 1]) {
    ctx.fillStyle = pal.belly;
    ctx.beginPath();
    ctx.arc(s * 0.84, side * s * 0.38, s * 0.125, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#101820';
    ctx.beginPath();
    ctx.arc(s * 0.86, side * s * 0.38, s * 0.068, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(s * 0.885, side * s * 0.38 - s * 0.02, s * 0.026, 0, TAU);
    ctx.fill();
  }
}

/** 水母（俯视：放射对称，天生适合背视） */
function drawJellyDorsal(ctx, s, pal, t) {
  const baseA = ctx.globalAlpha;
  const pulse = 1 + Math.sin(t * 3) * 0.16;
  // 触须环（放射，慢旋转）
  ctx.save();
  ctx.rotate(t * 0.25);
  ctx.strokeStyle = pal.fin;
  ctx.lineWidth = Math.max(1.2, s * 0.1);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU;
    const r1 = s * 0.78 * pulse;
    const r2 = r1 + s * (0.3 + Math.sin(t * 2.2 + i * 1.7) * 0.14);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
    ctx.stroke();
  }
  ctx.restore();
  // 伞盖（两层）
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.82 * pulse, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pal.belly;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.5 * pulse, 0, TAU);
  ctx.fill();
  // 斑点
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + t * 0.4;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * s * 0.32, Math.sin(a) * s * 0.32, s * 0.08, 0, TAU);
    ctx.fill();
  }
}

/** 旗鱼（背视）：长吻 + 大脊鳍 */
function drawSwordDorsal(ctx, s, pal, tailPhase) {
  const baseA = ctx.globalAlpha;
  const L = s * 1.9, Wd = s * 0.62;
  const wag = Math.sin(tailPhase) * 0.4;
  // 月牙尾
  ctx.save();
  ctx.translate(-L * 0.95, 0);
  ctx.rotate(wag);
  ctx.fillStyle = pal.fin;
  ctx.beginPath();
  ctx.moveTo(s * 0.2, 0);
  ctx.quadraticCurveTo(-s * 0.35, -s * 0.55, -s * 0.75, -s * 0.5);
  ctx.quadraticCurveTo(-s * 0.35, 0, -s * 0.75, s * 0.5);
  ctx.quadraticCurveTo(-s * 0.35, s * 0.55, s * 0.2, 0);
  ctx.fill();
  ctx.restore();
  // 胸鳍
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(s * 0.45, side * Wd * 0.8);
    ctx.rotate(side * (0.9 + Math.sin(tailPhase * 1.3) * 0.18));
    ctx.fillStyle = pal.fin;
    ctx.globalAlpha = baseA * 0.85;
    ctx.beginPath();
    ctx.ellipse(-s * 0.3, 0, s * 0.4, s * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = baseA;
  // 长吻
  ctx.strokeStyle = pal.body;
  ctx.lineWidth = Math.max(2, s * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(L * 0.85, 0);
  ctx.lineTo(L * 1.55, 0);
  ctx.stroke();
  // 身体
  const grad = cachedLinear(ctx, `sword|${pal.body}|${pal.belly}|${Wd.toFixed(1)}`, 0, -Wd, 0, Wd,
    [[0, pal.belly], [0.4, pal.body], [1, pal.belly]]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, L, Wd, 0, 0, TAU);
  ctx.fill();
  // 大脊鳍（背视沿脊线的旗）
  ctx.fillStyle = pal.fin;
  ctx.globalAlpha = baseA * 0.8;
  ctx.beginPath();
  ctx.ellipse(-L * 0.15, 0, L * 0.5, s * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = baseA;
  // 双眼
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(L * 0.52, side * Wd * 0.55, s * 0.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#10222e';
    ctx.beginPath();
    ctx.arc(L * 0.58, side * Wd * 0.55, s * 0.075, 0, TAU);
    ctx.fill();
  }
}

/** 深海怪（背视）：宽扁巨口 + 沿脊背的刺 */
function drawMonsterDorsal(ctx, s, pal, tailPhase) {
  const baseA = ctx.globalAlpha;
  const L = s * 1.55, Wd = s * 1.15;
  const wag = Math.sin(tailPhase * 0.8) * 0.3;
  // 尾扇
  ctx.save();
  ctx.translate(-L * 0.95, 0);
  ctx.rotate(wag);
  ctx.fillStyle = pal.fin;
  ctx.beginPath();
  ctx.moveTo(s * 0.1, 0);
  ctx.lineTo(-s * 0.6, -s * 0.42);
  ctx.quadraticCurveTo(-s * 0.3, 0, -s * 0.6, s * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // 宽扁身体
  const grad = cachedRadial(ctx, `monster|${pal.body}|${pal.fin}|${L.toFixed(1)}`, 0, 0, s * 0.2, 0, 0, L,
    [[0, pal.body], [1, pal.fin]]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, L, Wd, 0, 0, TAU);
  ctx.fill();
  // 脊背刺
  ctx.fillStyle = pal.fin;
  for (let i = 0; i < 4; i++) {
    const px = L * 0.2 - i * L * 0.38;
    const r = s * (0.16 - i * 0.02);
    ctx.beginPath();
    ctx.moveTo(px - r, 0);
    ctx.lineTo(px, -r * 1.8);
    ctx.lineTo(px + r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = baseA * 0.7;
    ctx.beginPath();
    ctx.moveTo(px - r, 0);
    ctx.lineTo(px, r * 1.4);
    ctx.lineTo(px + r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = baseA;
  }
  // 巨口（前端横贯的暗弧 + 牙）
  ctx.fillStyle = 'rgba(8,6,4,0.8)';
  ctx.beginPath();
  ctx.ellipse(L * 0.68, 0, L * 0.3, Wd * 0.72, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e8e8e0';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const ty = side * Wd * (0.18 + i * 0.2);
      const tx = L * (0.92 - i * 0.07) - Math.abs(ty) * 0.12;
      ctx.beginPath();
      ctx.moveTo(tx, ty - s * 0.05);
      ctx.lineTo(tx - s * 0.16, ty);
      ctx.lineTo(tx, ty + s * 0.05);
      ctx.closePath();
      ctx.fill();
    }
  }
  // 发光小眼（两侧）
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#ffd77a';
    ctx.beginPath();
    ctx.arc(L * 0.28, side * Wd * 0.5, s * 0.12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1a0d00';
    ctx.beginPath();
    ctx.arc(L * 0.31, side * Wd * 0.5, s * 0.05, 0, TAU);
    ctx.fill();
  }
  // 斑点
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 6; i++) {
    const a = i * 1.9, rr = s * (0.3 + (i % 3) * 0.28);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rr, Math.sin(a * 1.3) * Wd * 0.55, s * 0.07, 0, TAU);
    ctx.fill();
  }
}

// ============================================================
// 山海经水族（全部俯视 / 头朝 +x）
// ============================================================

/** 赤鱬：鱼身人面 —— 前端一张人脸，长发向两侧飘；鱼身走通用鱼形，保证与其它鱼同一套质感 */
function drawHumanFace(ctx, s, pal, tailPhase) {
  const baseA = ctx.globalAlpha;
  const L = s * 1.70, Wd = s * 0.80;
  const wag = Math.sin(tailPhase) * 0.50;

  // ---- 尾鳍（扇叶 + 鳍条）----
  ctx.save();
  ctx.translate(-L * 0.88, 0);
  ctx.rotate(wag);
  ctx.globalAlpha = baseA * 0.92;
  drawCaudalFin(ctx, s, pal);
  ctx.restore();
  ctx.globalAlpha = baseA;

  // ---- 胸鳍 ----
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(s * 0.30, side * Wd * 0.62);
    ctx.rotate(side * (0.72 + Math.sin(tailPhase * 1.3) * 0.18));
    ctx.scale(1, side);
    drawPectoralFin(ctx, s, pal);
    ctx.restore();
  }
  ctx.globalAlpha = baseA;

  // ---- 长发：先画（在鱼身之下），从脑后向两侧后方飘散 ----
  ctx.fillStyle = '#2a1a14';
  ctx.globalAlpha = baseA * 0.88;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(L * 0.52, side * s * 0.20);
    ctx.bezierCurveTo(L * 0.42, side * s * 0.72, L * 0.02, side * s * 1.02, -L * 0.46, side * s * 0.80);
    ctx.bezierCurveTo(-L * 0.18, side * s * 0.66, L * 0.16, side * s * 0.46, L * 0.42, side * s * 0.10);
    ctx.closePath();
    ctx.fill();
  }
  // 发丝
  ctx.globalAlpha = baseA * 0.45;
  ctx.strokeStyle = '#6b4a34';
  ctx.lineWidth = Math.max(0.5, s * 0.018);
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(L * 0.44 - i * s * 0.08, side * s * (0.24 + i * 0.06));
      ctx.quadraticCurveTo(L * 0.02, side * s * (0.70 + i * 0.05), -L * (0.30 + i * 0.03), side * s * 0.74);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = baseA;

  // ---- 鱼身：通用鱼形上半 + 人面头部切口（整体收短，头占更大比例）----
  const bodyL = L * 0.92;
  pathFishBody(ctx, bodyL, Wd);
  ctx.fillStyle = pal.body;
  ctx.fill();

  ctx.save();
  pathFishBody(ctx, bodyL, Wd);
  ctx.clip();
  bodyVolume(ctx, bodyL, Wd);
  fishScales(ctx, s, bodyL, Wd);
  ctx.restore();

  // 鳞片轮廓描边
  pathFishBody(ctx, bodyL, Wd);
  ctx.strokeStyle = 'rgba(0,0,0,0.26)';
  ctx.lineWidth = Math.max(0.8, s * 0.032);
  ctx.stroke();

  // ---- 人面：椭圆颅骨 + 下颌收窄 + 五官 ----
  const fx = L * 0.60;
  const fr = s * 0.60;
  const faceG = cachedRadial(ctx, `chiruface|${pal.face}|${Math.round(s)}`,
    fx - fr * 0.20, -fr * 0.24, fr * 0.16, fx, 0, fr * 1.10,
    [[0, mixHex(pal.face, '#ffffff', 0.42)], [0.58, pal.face], [1, mixHex(pal.face, pal.fin, 0.30)]]);
  ctx.fillStyle = faceG;
  ctx.beginPath();
  ctx.ellipse(fx, 0, fr, fr * 0.90, 0, 0, TAU);
  ctx.fill();
  // 下颌
  ctx.beginPath();
  ctx.moveTo(fx + fr * 0.30, -fr * 0.66);
  ctx.quadraticCurveTo(fx + fr * 1.32, -fr * 0.30, fx + fr * 1.26, 0);
  ctx.quadraticCurveTo(fx + fr * 1.32, fr * 0.30, fx + fr * 0.30, fr * 0.66);
  ctx.closePath();
  ctx.fill();
  // 面部轮廓
  ctx.strokeStyle = 'rgba(120,60,50,0.30)';
  ctx.lineWidth = Math.max(0.6, s * 0.022);
  ctx.beginPath();
  ctx.ellipse(fx, 0, fr, fr * 0.90, 0, 0, TAU);
  ctx.stroke();

  // 腮红
  ctx.fillStyle = 'rgba(200,90,80,0.24)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(fx + fr * 0.34, side * fr * 0.52, fr * 0.22, fr * 0.15, 0, 0, TAU);
    ctx.fill();
  }

  // 眼：上眼睑 + 眼白 + 瞳 + 高光
  for (const side of [-1, 1]) {
    const ex = fx + fr * 0.28, ey = side * fr * 0.34;
    ctx.fillStyle = '#f8f5ee';
    ctx.beginPath();
    ctx.ellipse(ex, ey, fr * 0.27, fr * 0.20, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#241812';
    ctx.beginPath();
    ctx.arc(ex + fr * 0.05, ey, fr * 0.125, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(ex + fr * 0.09, ey - fr * 0.045, fr * 0.05, 0, TAU);
    ctx.fill();
    // 眼线（上缘）
    ctx.strokeStyle = 'rgba(50,34,26,0.60)';
    ctx.lineWidth = Math.max(0.6, s * 0.02);
    ctx.beginPath();
    ctx.ellipse(ex, ey, fr * 0.28, fr * 0.21, 0, Math.PI * 1.04, Math.PI * 1.96);
    ctx.stroke();
    // 眉
    ctx.strokeStyle = 'rgba(70,44,32,0.45)';
    ctx.beginPath();
    ctx.moveTo(ex - fr * 0.20, ey - fr * 0.34);
    ctx.quadraticCurveTo(ex + fr * 0.06, ey - fr * 0.46, ex + fr * 0.28, ey - fr * 0.32);
    ctx.stroke();
  }

  // 鼻与唇
  ctx.strokeStyle = 'rgba(150,104,88,0.45)';
  ctx.lineWidth = Math.max(0.5, s * 0.018);
  ctx.beginPath();
  ctx.moveTo(fx + fr * 0.82, -fr * 0.05);
  ctx.quadraticCurveTo(fx + fr * 0.90, 0, fx + fr * 0.82, fr * 0.05);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(168,74,70,0.80)';
  ctx.lineWidth = Math.max(0.7, s * 0.026);
  ctx.beginPath();
  ctx.arc(fx + fr * 0.88, 0, fr * 0.16, 1.15, 1.99);
  ctx.stroke();
}

/** 何罗：一首十身 —— 中央一个头，十条粗壮的身体向后放射 */
function drawMultiBody(ctx, s, pal, t) {
  const baseA = ctx.globalAlpha;

  // ---- 十条身体：粗根 + 尖梢，各自摆动；有粗细变化才不像星芒 ----
  const N = 10;
  for (let i = 0; i < N; i++) {
    // 从 -π/2 起铺满整圈，让十条均匀但不与 x 轴对齐（视觉更自然）
    const a = -Math.PI / 2 + (i / N) * TAU;
    const wob = Math.sin(t * 2.4 + i * 1.4) * 0.16;
    // 十条中只有后半部分（朝尾部）最长，前方几条明显短 —— 破掉放射对称
    const bias = 0.62 + 0.55 * Math.pow(Math.max(0, Math.cos(a + Math.PI / 2)), 0.7);
    const len = s * (1.10 + (i % 3) * 0.05) * bias;

    ctx.save();
    ctx.rotate(a + wob);

    const g = cachedLinear(ctx, `heluo|${pal.body}|${pal.belly}|${pal.fin}|${i}|${Math.round(s)}`,
      0, 0, -len, 0,
      [[0, pal.fin], [0.16, pal.body], [0.62, pal.body], [1, pal.belly]]);
    ctx.fillStyle = g;
    ctx.globalAlpha = baseA * 0.95;

    // 根部半宽 proot，梢部收细：用两条对称贝塞尔围出流线体
    const proot = s * (0.34 - Math.abs(bias - 1) * 0.10);
    ctx.beginPath();
    ctx.moveTo(-s * 0.16, -proot);
    ctx.bezierCurveTo(-len * 0.42, -proot * 0.98, -len * 0.80, -proot * 0.52, -len, -s * 0.075);
    ctx.quadraticCurveTo(-len - s * 0.13, 0, -len, s * 0.075);
    ctx.bezierCurveTo(-len * 0.80, proot * 0.52, -len * 0.42, proot * 0.98, -s * 0.16, proot);
    ctx.quadraticCurveTo(-s * 0.04, 0, -s * 0.16, -proot);
    ctx.closePath();
    ctx.fill();

    // 体侧明暗：越靠外越暗，制造"十条叠在一起"的层次
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.beginPath();
    ctx.ellipse(-len * 0.55, proot * 0.34, len * 0.30, proot * 0.34, 0, 0, TAU);
    ctx.fill();

    // 背线（一条从根到梢的浅色细线）
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = Math.max(0.6, s * 0.022);
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, 0);
    ctx.quadraticCurveTo(-len * 0.6, -proot * 0.10, -len * 0.94, 0);
    ctx.stroke();

    // 梢部小鳍
    ctx.fillStyle = pal.fin;
    ctx.globalAlpha = baseA * 0.7;
    ctx.beginPath();
    ctx.moveTo(-len * 0.86, 0);
    ctx.lineTo(-len - s * 0.16, -s * 0.16);
    ctx.lineTo(-len * 0.90, s * 0.10);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
  ctx.globalAlpha = baseA;

  // ---- 中央头：犬首轮廓，比原来更大更立 ----
  const hx = s * 0.10;
  const headG = cachedRadial(ctx, `heluohead|${pal.body}|${pal.belly}|${pal.fin}|${Math.round(s)}`,
    hx - s * 0.10, -s * 0.10, s * 0.06, hx, 0, s * 0.62,
    [[0, mixHex(pal.belly, '#ffffff', 0.18)], [0.52, pal.belly], [1, pal.fin]]);
  ctx.fillStyle = headG;
  ctx.beginPath();
  ctx.ellipse(hx, 0, s * 0.56, s * 0.50, 0, 0, TAU);
  ctx.fill();

  // 吻部（向前锥出）
  ctx.fillStyle = mixHex(pal.body, pal.belly, 0.5);
  ctx.beginPath();
  ctx.moveTo(hx + s * 0.30, -s * 0.26);
  ctx.quadraticCurveTo(hx + s * 0.68, -s * 0.12, hx + s * 0.72, 0);
  ctx.quadraticCurveTo(hx + s * 0.68, s * 0.12, hx + s * 0.30, s * 0.26);
  ctx.closePath();
  ctx.fill();
  // 鼻头
  ctx.fillStyle = 'rgba(20,16,14,0.8)';
  ctx.beginPath();
  ctx.ellipse(hx + s * 0.62, 0, s * 0.065, s * 0.075, 0, 0, TAU);
  ctx.fill();

  // 双犬耳
  ctx.fillStyle = pal.fin;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx - s * 0.16, side * s * 0.36);
    ctx.quadraticCurveTo(hx - s * 0.34, side * s * 0.66, hx - s * 0.02, side * s * 0.60);
    ctx.quadraticCurveTo(hx + s * 0.06, side * s * 0.44, hx - s * 0.02, side * s * 0.32);
    ctx.closePath();
    ctx.fill();
  }

  // 双犬眼（其音如吠犬）
  for (const side of [-1, 1]) {
    drawFishEye(ctx, s, hx + s * 0.26, side * s * 0.21, Math.max(1.4, s * 0.13), '#1b2b36');
  }
}

/** 蠃鱼/文鳐：鱼身鸟翼 —— 两侧展开的翼，翼膜带羽骨与飞羽分层 */
function drawWinged(ctx, s, pal, tailPhase, t) {
  const baseA = ctx.globalAlpha;
  const L = s * 1.50, Wd = s * 0.62;
  const flap = Math.sin(tailPhase * 1.6);

  // ---- 双翼 ----
  for (const side of [-1, 1]) {
    const spread = 1.72 + flap * 0.42;
    const tipY = side * Wd * spread;

    // 翼膜：根部接体侧，向后上方舒展，后缘呈波浪（飞羽分节）
    const wingG = cachedLinear(ctx, `wing|${pal.fin}|${pal.belly}|${pal.body}|${side}|${Math.round(s)}`,
      L * 0.1, side * Wd * 0.4, -L * 0.7, tipY,
      [[0, mixHex(pal.body, pal.fin, 0.40)], [0.42, pal.fin], [1, pal.belly]]);
    ctx.fillStyle = wingG;
    ctx.globalAlpha = baseA * 0.86;
    ctx.beginPath();
    ctx.moveTo(L * 0.20, side * Wd * 0.42);
    // 前缘：向前上方舒展到翼尖
    ctx.bezierCurveTo(-L * 0.05, side * Wd * (1.05 + flap * 0.30),
      -L * 0.42, side * Wd * (spread - 0.10),
      -L * 0.78, side * Wd * (spread - 0.22));
    // 翼尖圆弧 → 后缘：三段波浪（飞羽）
    ctx.quadraticCurveTo(-L * 0.86, side * Wd * (spread - 0.34), -L * 0.80, side * Wd * (spread - 0.48));
    for (let i = 0; i < 3; i++) {
      const k = i / 3;
      const ax = -L * (0.80 - k * 0.26);
      const ay = side * Wd * (spread - 0.48 - k * 0.40);
      const bx = -L * (0.66 - k * 0.24);
      const by = side * Wd * (spread - 0.62 - k * 0.38);
      ctx.quadraticCurveTo(ax, ay, bx, by);
    }
    ctx.quadraticCurveTo(-L * 0.20, side * Wd * 0.72, L * 0.20, side * Wd * 0.42);
    ctx.closePath();
    ctx.fill();

    // 翼骨：一条主骨 + 三根指骨
    ctx.strokeStyle = mixHex(pal.body, '#ffffff', 0.20);
    ctx.globalAlpha = baseA * 0.65;
    ctx.lineWidth = Math.max(0.9, s * 0.048);
    ctx.beginPath();
    ctx.moveTo(L * 0.12, side * Wd * 0.42);
    ctx.quadraticCurveTo(-L * 0.34, side * Wd * (spread * 0.72), -L * 0.74, side * Wd * (spread - 0.26));
    ctx.stroke();
    ctx.lineWidth = Math.max(0.6, s * 0.028);
    for (let i = 0; i < 3; i++) {
      const k = (i + 1) / 4;
      ctx.beginPath();
      ctx.moveTo(L * 0.02, side * Wd * 0.44);
      ctx.quadraticCurveTo(-L * (0.40 + k * 0.10), side * Wd * (0.72 + k * 0.44),
        -L * (0.62 - k * 0.16), side * Wd * (spread * k - 0.10));
      ctx.stroke();
    }

    // 翼缘亮边
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(0.7, s * 0.030);
    ctx.beginPath();
    ctx.moveTo(L * 0.20, side * Wd * 0.42);
    ctx.bezierCurveTo(-L * 0.05, side * Wd * (1.05 + flap * 0.30),
      -L * 0.42, side * Wd * (spread - 0.10),
      -L * 0.78, side * Wd * (spread - 0.22));
    ctx.stroke();
  }
  ctx.globalAlpha = baseA;

  // ---- 尾鳍 ----
  ctx.save();
  ctx.translate(-L * 0.74, 0);
  ctx.rotate(Math.sin(tailPhase) * 0.30);
  ctx.globalAlpha = baseA * 0.9;
  drawCaudalFin(ctx, s * 0.78, pal);
  ctx.restore();
  ctx.globalAlpha = baseA;

  // ---- 鱼身：通用鱼形，与其它鱼统一质感 ----
  const bodyL = L * 0.80;
  pathFishBody(ctx, bodyL, Wd);
  ctx.fillStyle = pal.body;
  ctx.fill();
  ctx.save();
  pathFishBody(ctx, bodyL, Wd);
  ctx.clip();
  bodyVolume(ctx, bodyL, Wd);
  fishScales(ctx, s, bodyL, Wd);
  ctx.restore();
  pathFishBody(ctx, bodyL, Wd);
  ctx.strokeStyle = 'rgba(0,0,0,0.26)';
  ctx.lineWidth = Math.max(0.7, s * 0.030);
  ctx.stroke();

  // ---- 白首：只覆盖吻端一小段，带羽状过渡，不要整颗白球 ----
  const headG = cachedLinear(ctx, `winghead|${pal.belly}|${pal.body}|${Math.round(s)}`,
    bodyL * 0.92, 0, bodyL * 0.42, 0,
    [[0, mixHex(pal.belly, '#ffffff', 0.30)], [0.55, mixHex(pal.belly, pal.body, 0.25)], [1, pal.body]]);
  ctx.fillStyle = headG;
  ctx.beginPath();
  ctx.ellipse(bodyL * 0.80, 0, bodyL * 0.30, Wd * 0.62, 0, 0, TAU);
  ctx.fill();
  // 过渡羽边
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = Math.max(0.6, s * 0.024);
  ctx.beginPath();
  ctx.ellipse(bodyL * 0.80, 0, bodyL * 0.30, Wd * 0.62, 0, Math.PI * 0.62, Math.PI * 1.38);
  ctx.stroke();

  // ---- 赤喙（前端尖，上下颚分线）----
  ctx.fillStyle = '#d84315';
  ctx.beginPath();
  ctx.moveTo(bodyL * 0.94, -s * 0.13);
  ctx.quadraticCurveTo(bodyL * 1.22, -s * 0.03, bodyL * 1.30, 0);
  ctx.quadraticCurveTo(bodyL * 1.22, s * 0.03, bodyL * 0.94, s * 0.13);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,20,4,0.45)';
  ctx.lineWidth = Math.max(0.6, s * 0.020);
  ctx.beginPath();
  ctx.moveTo(bodyL * 0.96, 0);
  ctx.lineTo(bodyL * 1.28, 0);
  ctx.stroke();

  // ---- 双眼 ----
  for (const side of [-1, 1]) {
    drawFishEye(ctx, s, bodyL * 0.60, side * Wd * 0.46, Math.max(1.2, s * 0.115), '#1a2a34');
  }
}

/** 鲛人：人面鱼尾，长发随水流飘散 —— 人形躯干 + 渐细鱼尾 + 尾鳍 */
function drawMerfolk(ctx, s, pal, tailPhase) {
  const baseA = ctx.globalAlpha;
  const wag = Math.sin(tailPhase) * 0.42;

  // ---- 尾鳍：在身体之后，随摆尾偏转 ----
  ctx.save();
  ctx.translate(-s * 1.34, 0);
  ctx.rotate(wag);
  const tailG = cachedLinear(ctx, `mertail|${pal.fin}|${pal.belly}|${Math.round(s)}`,
    0, 0, -s * 0.72, 0, [[0, pal.fin], [1, pal.belly]]);
  ctx.fillStyle = tailG;
  ctx.globalAlpha = baseA * 0.95;
  ctx.beginPath();
  ctx.moveTo(s * 0.10, 0);
  ctx.bezierCurveTo(-s * 0.18, -s * 0.30, -s * 0.50, -s * 0.62, -s * 0.72, -s * 0.52);
  ctx.bezierCurveTo(-s * 0.52, -s * 0.24, -s * 0.40, -s * 0.08, -s * 0.36, 0);
  ctx.bezierCurveTo(-s * 0.40, s * 0.08, -s * 0.52, s * 0.24, -s * 0.72, s * 0.52);
  ctx.bezierCurveTo(-s * 0.50, s * 0.62, -s * 0.18, s * 0.30, s * 0.10, 0);
  ctx.closePath();
  ctx.fill();
  // 鳍条
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(0.6, s * 0.02);
  for (let i = 1; i <= 4; i++) {
    const k = i / 5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.04, 0);
      ctx.quadraticCurveTo(-s * 0.34, side * s * 0.10 * k, -s * (0.48 + k * 0.16), side * s * (0.10 + k * 0.34));
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = baseA;

  // ---- 鱼尾：由胯部向前收细，鳞片从密到疏 ----
  const tail = cachedLinear(ctx, `merbody|${pal.body}|${pal.belly}|${pal.fin}|${Math.round(s)}`,
    s * 0.10, 0, -s * 1.40, 0,
    [[0, pal.body], [0.55, pal.body], [0.86, mixHex(pal.body, pal.fin, 0.45)], [1, pal.fin]]);
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(s * 0.12, -s * 0.46);
  ctx.bezierCurveTo(-s * 0.50, -s * 0.46, -s * 1.06, -s * 0.26, -s * 1.34, -s * 0.09);
  ctx.quadraticCurveTo(-s * 1.40, 0, -s * 1.34, s * 0.09);
  ctx.bezierCurveTo(-s * 1.06, s * 0.26, -s * 0.50, s * 0.46, s * 0.12, s * 0.46);
  ctx.quadraticCurveTo(s * 0.24, 0, s * 0.12, -s * 0.46);
  ctx.closePath();
  ctx.fill();

  // 尾身体积
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(s * 0.12, -s * 0.46);
  ctx.bezierCurveTo(-s * 0.50, -s * 0.46, -s * 1.06, -s * 0.26, -s * 1.34, -s * 0.09);
  ctx.quadraticCurveTo(-s * 1.40, 0, -s * 1.34, s * 0.09);
  ctx.bezierCurveTo(-s * 1.06, s * 0.26, -s * 0.50, s * 0.46, s * 0.12, s * 0.46);
  ctx.quadraticCurveTo(s * 0.24, 0, s * 0.12, -s * 0.46);
  ctx.closePath();
  ctx.clip();
  const sideG = cachedLinear(ctx, `merside|${Math.round(s)}`, 0, -s * 0.46, 0, s * 0.46, [
    [0, 'rgba(0,0,0,0.40)'], [0.16, 'rgba(0,0,0,0.10)'],
    [0.34, 'rgba(0,0,0,0)'], [0.66, 'rgba(0,0,0,0)'],
    [0.84, 'rgba(0,0,0,0.10)'], [1, 'rgba(0,0,0,0.40)'],
  ]);
  ctx.fillStyle = sideG;
  ctx.fillRect(-s * 1.5, -s * 0.5, s * 2.0, s);
  // 鳞片：越靠尾越细
  for (let i = 0; i < 6; i++) {
    const k = i / 5;
    const px = -s * (0.10 + k * 1.10);
    const r = s * (0.115 - k * 0.055);
    if (r < 0.5) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(0.5, s * 0.014);
    ctx.beginPath();
    ctx.arc(px, 0, r, -1.15, 1.15);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.arc(px, -s * 0.20, r * 0.85, -1.0, 1.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, s * 0.20, r * 0.85, -1.0, 1.0);
    ctx.stroke();
  }
  ctx.restore();

  // ---- 腰背：上半身比尾粗一档，形成人形过渡 ----
  const torso = cachedLinear(ctx, `mertorso|${pal.body}|${pal.belly}|${Math.round(s)}`,
    0, -s * 0.52, 0, s * 0.52,
    [[0, pal.fin], [0.24, pal.body], [0.62, mixHex(pal.body, '#ffffff', 0.16)], [1, pal.fin]]);
  ctx.fillStyle = torso;
  ctx.beginPath();
  ctx.ellipse(s * 0.30, 0, s * 0.52, s * 0.52, 0, 0, TAU);
  ctx.fill();

  // ---- 长发：从后脑垂下，两侧各一束并带发丝 ----（在脸之下）
  ctx.fillStyle = '#1b262c';
  ctx.globalAlpha = baseA * 0.92;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.46, side * s * 0.30);
    ctx.bezierCurveTo(s * 0.24, side * s * 0.72, -s * 0.34, side * s * 0.80, -s * 0.86, side * s * 0.54);
    ctx.bezierCurveTo(-s * 0.56, side * s * 0.54, -s * 0.10, side * s * 0.48, s * 0.34, side * s * 0.16);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = baseA * 0.5;
  ctx.strokeStyle = '#4a5c66';
  ctx.lineWidth = Math.max(0.5, s * 0.018);
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 0.36 - i * s * 0.10, side * s * (0.34 + i * 0.06));
      ctx.quadraticCurveTo(-s * 0.16, side * s * (0.66 + i * 0.04), -s * (0.66 + i * 0.06), side * s * (0.50 + i * 0.02));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = baseA;

  // ---- 人面：前额 → 下颌收窄，加鼻、唇、腮红 ----
  const fx = s * 0.56;
  const face = cachedRadial(ctx, `merface|${pal.face}|${Math.round(s)}`,
    fx - s * 0.06, -s * 0.08, s * 0.05, fx, 0, s * 0.44,
    [[0, mixHex(pal.face, '#ffffff', 0.30)], [0.62, pal.face], [1, mixHex(pal.face, '#7a4a3a', 0.28)]]);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(fx, 0, s * 0.44, s * 0.40, 0, 0, TAU);
  ctx.fill();
  // 下颌收窄（下巴）
  ctx.beginPath();
  ctx.moveTo(fx + s * 0.16, -s * 0.30);
  ctx.quadraticCurveTo(fx + s * 0.52, -s * 0.14, fx + s * 0.50, 0);
  ctx.quadraticCurveTo(fx + s * 0.52, s * 0.14, fx + s * 0.16, s * 0.30);
  ctx.closePath();
  ctx.fill();

  // 腮红
  ctx.fillStyle = 'rgba(196,92,86,0.22)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(fx + s * 0.02, side * s * 0.26, s * 0.10, s * 0.07, 0, 0, TAU);
    ctx.fill();
  }

  // 眼：杏眼 + 上眼睑线
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#f7f4ec';
    ctx.beginPath();
    ctx.ellipse(fx + s * 0.12, side * s * 0.16, s * 0.105, s * 0.075, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#16232b';
    ctx.beginPath();
    ctx.arc(fx + s * 0.15, side * s * 0.16, s * 0.052, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(fx + s * 0.17, side * s * 0.16 - s * 0.022, s * 0.022, 0, TAU);
    ctx.fill();
    // 眼线
    ctx.strokeStyle = 'rgba(30,24,20,0.55)';
    ctx.lineWidth = Math.max(0.5, s * 0.018);
    ctx.beginPath();
    ctx.ellipse(fx + s * 0.12, side * s * 0.16, s * 0.108, s * 0.078, 0, Math.PI * 1.06, Math.PI * 1.94);
    ctx.stroke();
  }

  // 鼻与唇
  ctx.strokeStyle = 'rgba(150,104,88,0.5)';
  ctx.lineWidth = Math.max(0.5, s * 0.018);
  ctx.beginPath();
  ctx.moveTo(fx + s * 0.30, -s * 0.03);
  ctx.quadraticCurveTo(fx + s * 0.34, 0, fx + s * 0.30, s * 0.03);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(168,74,70,0.75)';
  ctx.lineWidth = Math.max(0.6, s * 0.024);
  ctx.beginPath();
  ctx.arc(fx + s * 0.34, 0, s * 0.075, 1.2, 1.94);
  ctx.stroke();

  // ---- 额饰：一道细珠链，强化"人"的辨识 ----
  ctx.strokeStyle = 'rgba(226,196,120,0.75)';
  ctx.lineWidth = Math.max(0.6, s * 0.02);
  ctx.beginPath();
  ctx.arc(fx, 0, s * 0.40, -0.85, 0.85);
  ctx.stroke();
  ctx.fillStyle = 'rgba(240,214,150,0.9)';
  ctx.beginPath();
  ctx.arc(fx + s * 0.30, 0, s * 0.038, 0, TAU);
  ctx.fill();
}

/** 蜃：大蛤，两扇壳沿铰合线开合 + 吐出的幻气 */
function drawClam(ctx, s, pal, t) {
  const baseA = ctx.globalAlpha;
  const open = 0.5 + Math.sin(t * 1.1) * 0.30;    // 0.2~0.8 开合

  // ---- 幻气：向外扩散的弧带 + 上浮的泡 ----
  for (let i = 0; i < 3; i++) {
    const rr = s * (1.05 + i * 0.42) + Math.sin(t * 0.8 + i) * s * 0.10;
    ctx.strokeStyle = `rgba(200,176,255,${0.26 - i * 0.07})`;
    ctx.lineWidth = Math.max(1.2, s * 0.05);
    ctx.beginPath();
    ctx.arc(0, 0, rr, t * 0.5 + i * 0.8, t * 0.5 + i * 0.8 + 1.5);
    ctx.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const ph = (t * 0.5 + i * 0.37) % 1;
    const a = (i / 5) * TAU + 0.4;
    const rr = s * (0.5 + ph * 1.5);
    ctx.fillStyle = `rgba(214,196,255,${0.24 * (1 - ph)})`;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, s * (0.05 + ph * 0.05), 0, TAU);
    ctx.fill();
  }

  // ---- 两扇壳：以 x 轴为铰合线，上下各一扇，沿 y 压缩模拟开合 ----
  const shellH = 0.34 + open * 0.66;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(1, side * shellH);

    // 壳体
    const g = cachedLinear(ctx, `clamshell|${pal.body}|${pal.belly}|${pal.fin}|${Math.round(s)}|${side}`,
      0, s * 0.10, 0, s * 1.10,
      [[0, mixHex(pal.belly, '#ffffff', 0.16)], [0.42, pal.belly],
       [0.80, pal.body], [1, pal.fin]]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.14, s * 1.02, 0, 0, TAU);
    ctx.fill();

    // 生长纹：同心弧（真实蛤壳是同心层，不是放射线）
    ctx.strokeStyle = pal.fin;
    for (let i = 1; i <= 5; i++) {
      const k = i / 6;
      ctx.globalAlpha = baseA * (0.34 - i * 0.035);
      ctx.lineWidth = Math.max(0.6, s * 0.030);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.14 * k, s * 1.02 * k, 0, Math.PI * 0.10, Math.PI * 0.90);
      ctx.stroke();
    }
    ctx.globalAlpha = baseA;

    // 放射棱：细而淡，只在前半，避免"蜘蛛网"
    ctx.strokeStyle = pal.fin;
    ctx.lineWidth = Math.max(0.5, s * 0.020);
    ctx.globalAlpha = baseA * 0.26;
    for (let i = -4; i <= 4; i++) {
      const a = i * 0.30;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.20, Math.sin(a) * s * 0.18);
      ctx.lineTo(Math.cos(a) * s * 1.06, Math.sin(a) * s * 0.94);
      ctx.stroke();
    }
    ctx.globalAlpha = baseA;

    // 壳缘高光
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = Math.max(1, s * 0.045);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.14, s * 1.02, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    // 铰合线（靠 x 轴一侧加深）
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.14, s * 1.02, 0, 0, TAU);
    ctx.stroke();

    ctx.restore();
  }

  // ---- 壳缝里的珍珠（开得越大越亮） ----
  drawGlow(ctx, 0, 0, s * 0.55 * open, 'rgba(255,240,205,ALPHA)', 0.34 * open);
  const pearl = cachedRadial(ctx, `clampearl|${Math.round(s)}`,
    -s * 0.05, -s * 0.05, s * 0.02, 0, 0, s * 0.20,
    [[0, 'rgba(255,253,240,0.98)'], [0.55, 'rgba(244,232,200,0.85)'], [1, 'rgba(210,190,160,0.35)']]);
  ctx.fillStyle = pearl;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.19 * open, 0, TAU);
  ctx.fill();
}

/** 虎蛟：鱼身蛇尾，伏击型 */
function drawSerpent(ctx, s, pal, tailPhase, t) {
  const baseA = ctx.globalAlpha;

  // ---- 蛇尾：一条渐细的实体尾巴，沿 S 曲线收梢 ----
  const segs = 12;
  const tailPts = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    tailPts.push([
      -s * (0.52 + k * 1.42),
      Math.sin(t * 2.0 - k * 2.7) * s * 0.62 * k,
    ]);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 由粗到细逐段描粗线（比纯线条有体积）
  for (let i = segs - 1; i >= 0; i--) {
    const k = i / segs;
    ctx.strokeStyle = i > segs * 0.55 ? mixHex(pal.fin, pal.body, 0.35) : pal.fin;
    ctx.globalAlpha = baseA * (1 - k * 0.35);
    ctx.lineWidth = s * (0.40 - k * 0.34);
    ctx.beginPath();
    ctx.moveTo(tailPts[i][0], tailPts[i][1]);
    ctx.lineTo(tailPts[i + 1][0], tailPts[i + 1][1]);
    ctx.stroke();
  }
  // 尾下缘高光
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.globalAlpha = baseA;
  ctx.lineWidth = Math.max(0.8, s * 0.03);
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const px = tailPts[i][0], py = tailPts[i][1] + s * (0.16 - k * 0.14);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = baseA;

  // ---- 躯干：梭形实体 ----
  const L = s * 1.15, Wd = s * 0.60;
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.moveTo(L * 0.86, -Wd * 0.34);
  ctx.bezierCurveTo(L * 0.50, -Wd * 1.02, -L * 0.30, -Wd * 0.90, -L * 0.82, -Wd * 0.20);
  ctx.quadraticCurveTo(-L * 0.90, 0, -L * 0.82, Wd * 0.20);
  ctx.bezierCurveTo(-L * 0.30, Wd * 0.90, L * 0.50, Wd * 1.02, L * 0.86, Wd * 0.34);
  ctx.quadraticCurveTo(L * 1.00, 0, L * 0.86, -Wd * 0.34);
  ctx.closePath();
  ctx.fill();

  // 体积明暗
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(L * 0.86, -Wd * 0.34);
  ctx.bezierCurveTo(L * 0.50, -Wd * 1.02, -L * 0.30, -Wd * 0.90, -L * 0.82, -Wd * 0.20);
  ctx.quadraticCurveTo(-L * 0.90, 0, -L * 0.82, Wd * 0.20);
  ctx.bezierCurveTo(-L * 0.30, Wd * 0.90, L * 0.50, Wd * 1.02, L * 0.86, Wd * 0.34);
  ctx.quadraticCurveTo(L * 1.00, 0, L * 0.86, -Wd * 0.34);
  ctx.closePath();
  ctx.clip();
  bodyVolume(ctx, L, Wd);
  ctx.restore();

  // ---- 虎纹：横向短带，粗细分档、左右交替，不是均匀直线 ----
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    const px = s * (0.34 - k * 1.10);
    const bw = s * (0.075 + (i % 2) * 0.028);
    ctx.fillStyle = mixHex(pal.fin, '#1a1206', 0.35);
    ctx.globalAlpha = baseA * 0.42;
    ctx.beginPath();
    ctx.ellipse(px, 0, bw, Wd * (0.66 - k * 0.16), 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = baseA;

  // ---- 背鳍：沿脊线一列软鳍 ----
  ctx.fillStyle = pal.fin;
  ctx.globalAlpha = baseA * 0.7;
  for (let i = 0; i < 5; i++) {
    const px = s * (0.20 - i * 0.26);
    ctx.beginPath();
    ctx.moveTo(px + s * 0.10, -Wd * 0.16);
    ctx.quadraticCurveTo(px - s * 0.02, -Wd * 0.52, px - s * 0.14, -Wd * 0.14);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = baseA;

  // 轮廓描边
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = Math.max(0.8, s * 0.032);
  ctx.beginPath();
  ctx.moveTo(L * 0.86, -Wd * 0.34);
  ctx.bezierCurveTo(L * 0.50, -Wd * 1.02, -L * 0.30, -Wd * 0.90, -L * 0.82, -Wd * 0.20);
  ctx.quadraticCurveTo(-L * 0.90, 0, -L * 0.82, Wd * 0.20);
  ctx.bezierCurveTo(-L * 0.30, Wd * 0.90, L * 0.50, Wd * 1.02, L * 0.86, Wd * 0.34);
  ctx.quadraticCurveTo(L * 1.00, 0, L * 0.86, -Wd * 0.34);
  ctx.closePath();
  ctx.stroke();

  // ---- 头：宽扁虎首，带一处吻部与细齿 ----
  const hx = s * 0.82;
  ctx.fillStyle = mixHex(pal.body, pal.belly, 0.22);
  ctx.beginPath();
  ctx.ellipse(hx, 0, s * 0.50, s * 0.44, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.24)';
  ctx.lineWidth = Math.max(0.7, s * 0.026);
  ctx.stroke();

  // 闭口线 + 两颗露出的小牙
  ctx.strokeStyle = 'rgba(20,10,4,0.6)';
  ctx.lineWidth = Math.max(0.7, s * 0.028);
  ctx.beginPath();
  ctx.arc(hx + s * 0.24, 0, s * 0.30, -0.62, 0.62);
  ctx.stroke();
  ctx.fillStyle = '#f0ece0';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx + s * 0.44, side * s * 0.10);
    ctx.lineTo(hx + s * 0.34, side * s * 0.03);
    ctx.lineTo(hx + s * 0.44, side * s * 0.01);
    ctx.closePath();
    ctx.fill();
  }

  // 虎眼（竖瞳）
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#ffca3a';
    ctx.beginPath();
    ctx.ellipse(hx + s * 0.04, side * s * 0.22, s * 0.115, s * 0.105, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#140b02';
    ctx.beginPath();
    ctx.ellipse(hx + s * 0.05, side * s * 0.22, s * 0.030, s * 0.078, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(hx + s * 0.08, side * s * 0.22 - s * 0.035, s * 0.028, 0, TAU);
    ctx.fill();
  }
}

/** 相柳：九首人面，蛇身而青 —— 粗壮青蛇身 + 九条颈分两层错落伸出 */
function drawNineHead(ctx, s, pal, tailPhase, t) {
  const baseA = ctx.globalAlpha;

  // ---- 蛇身：由粗到细的实心躯体，走 S 曲线（比一串圆更连贯） ----
  const segs = 16;
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    pts.push([
      -s * (0.34 + k * 1.62),
      Math.sin(t * 1.5 - k * 2.9) * s * 0.66 * k,
    ]);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = segs - 1; i >= 0; i--) {
    const k = i / segs;
    ctx.strokeStyle = mixHex(pal.fin, pal.body, 0.20 + k * 0.35);
    ctx.globalAlpha = baseA * (1 - k * 0.25);
    ctx.lineWidth = s * (0.78 - k * 0.58);
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
  // 背脊高光
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.globalAlpha = baseA;
  ctx.lineWidth = Math.max(0.8, s * 0.035);
  ctx.beginPath();
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const px = pts[i][0], py = pts[i][1] - s * (0.20 - k * 0.16);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  // 腹鳞：尾段横向短痕
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = Math.max(0.5, s * 0.02);
  for (let i = 3; i < segs; i += 2) {
    const k = i / segs;
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1] - s * (0.20 - k * 0.16));
    ctx.lineTo(pts[i][0], pts[i][1] + s * (0.20 - k * 0.16));
    ctx.stroke();
  }
  ctx.globalAlpha = baseA;

  // ---- 九个颈：前层五条 + 后层四条，错落张开成冠 ----
  const heads = [];
  // 前层（大、近）：-62° ~ +62° 均分五条
  for (let i = 0; i < 5; i++) {
    const a = (-62 + i * 31) * Math.PI / 180 + Math.sin(t * 1.9 + i) * 0.06;
    const reach = s * (1.44 + Math.abs(i - 2) * 0.08);
    heads.push({ a, layer: 1, x: Math.cos(a) * reach, y: Math.sin(a) * reach, r: s * 0.235 });
  }
  // 后层（略小、穿插在前层之间）：-46° ~ +46° 均分四条
  for (let i = 0; i < 4; i++) {
    const a = (-46 + i * 30.5) * Math.PI / 180 + Math.sin(t * 1.9 + i * 2.1) * 0.06;
    const reach = s * (1.12 + Math.abs(i - 1.5) * 0.07);
    heads.push({ a, layer: 0, x: Math.cos(a) * reach, y: Math.sin(a) * reach, r: s * 0.195 });
  }
  heads.sort((p, q) => p.layer - q.layer);

  for (const h of heads) {
    const neckFrom = { x: s * 0.14, y: 0 };
    const g = cachedLinear(ctx, `xiangneck|${pal.body}|${pal.fin}|${h.layer}|${Math.round(s)}`,
      neckFrom.x, neckFrom.y, h.x, h.y,
      [[0, pal.fin], [0.35, pal.body], [1, mixHex(pal.body, pal.belly, 0.30)]]);
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    ctx.lineWidth = h.r * 1.30;
    ctx.beginPath();
    ctx.moveTo(neckFrom.x, neckFrom.y);
    ctx.quadraticCurveTo(h.x * 0.42, h.y * 0.88, h.x, h.y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = Math.max(0.6, h.r * 0.30);
    ctx.beginPath();
    ctx.moveTo(neckFrom.x, neckFrom.y - h.r * 0.34);
    ctx.quadraticCurveTo(h.x * 0.42, h.y * 0.88 - h.r * 0.30, h.x, h.y - h.r * 0.30);
    ctx.stroke();

    // ---- 人面：先发后脸，发只在"朝躯体那一侧"露出一圈 ----
    const hx = h.x, hy = h.y;
    // 发（整圈略大的深色底，只在脸后方可见）
    ctx.fillStyle = '#17322b';
    ctx.beginPath();
    ctx.arc(hx, hy, h.r * 1.14, 0, TAU);
    ctx.fill();
    // 发髻（更后一点的一小团）
    ctx.beginPath();
    ctx.arc(hx - Math.cos(h.a) * h.r * 0.92, hy - Math.sin(h.a) * h.r * 0.92, h.r * 0.46, 0, TAU);
    ctx.fill();
    // 脸（向"朝外"方向偏，让五官出现在正面）
    const faceX = hx + Math.cos(h.a) * h.r * 0.22;
    const faceY = hy + Math.sin(h.a) * h.r * 0.22;
    const faceG = cachedRadial(ctx, `xiangface|${pal.belly}|${Math.round(s)}|${h.layer}`,
      faceX - h.r * 0.2, faceY - h.r * 0.2, h.r * 0.2, faceX, faceY, h.r * 0.92,
      [[0, mixHex(pal.belly, '#ffffff', 0.34)], [0.66, pal.belly], [1, mixHex(pal.belly, pal.fin, 0.30)]]);
    ctx.fillStyle = faceG;
    ctx.beginPath();
    ctx.arc(faceX, faceY, h.r * 0.92, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.20)';
    ctx.lineWidth = Math.max(0.5, h.r * 0.09);
    ctx.stroke();

    // 红瞳双眼（位于脸的前段，左右分开）
    const exC = faceX + Math.cos(h.a) * h.r * 0.34;
    const eyC = faceY + Math.sin(h.a) * h.r * 0.34;
    for (const side of [-1, 1]) {
      const px = exC - Math.sin(h.a) * side * h.r * 0.34;
      const py = eyC + Math.cos(h.a) * side * h.r * 0.34;
      ctx.fillStyle = '#f6f2e8';
      ctx.beginPath();
      ctx.arc(px, py, h.r * 0.235, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e33b3b';
      ctx.beginPath();
      ctx.arc(px, py, h.r * 0.145, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2a0000';
      ctx.beginPath();
      ctx.arc(px, py, h.r * 0.062, 0, TAU);
      ctx.fill();
    }
    // 小口（脸最前端）
    ctx.strokeStyle = 'rgba(120,50,44,0.72)';
    ctx.lineWidth = Math.max(0.5, h.r * 0.10);
    ctx.beginPath();
    ctx.arc(faceX + Math.cos(h.a) * h.r * 0.72, faceY + Math.sin(h.a) * h.r * 0.72,
      h.r * 0.22, h.a - 0.75, h.a + 0.75);
    ctx.stroke();
  }
}

/** 帝江：浑敦无面目，六足四翼 —— 一个圆囊 + 翼 + 足 */
function drawChaos(ctx, s, pal, tailPhase, t) {
  const baseA = ctx.globalAlpha;
  const puls = 1 + Math.sin(t * 2.2) * 0.08;

  // ---- 四翼：两对，各带翼膜与翼骨，扇动相位错开 ----
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * 0.25 + (i / 4) * TAU;
    const flap = Math.sin(tailPhase * 2.6 + i * 1.6) * 0.26;
    ctx.save();
    ctx.rotate(a + flap);
    ctx.globalAlpha = baseA * 0.78;

    // 翼膜：根部窄、梢部宽的柳叶
    const wingG = cachedLinear(ctx, `chaoswing|${pal.fin}|${pal.belly}|${Math.round(s)}`,
      -s * 0.5, 0, -s * 1.9, 0,
      [[0, mixHex(pal.fin, pal.body, 0.30)], [0.45, pal.fin], [1, pal.belly]]);
    ctx.fillStyle = wingG;
    ctx.beginPath();
    ctx.moveTo(-s * 0.44, 0);
    ctx.bezierCurveTo(-s * 0.92, -s * 0.30, -s * 1.55, -s * 0.34, -s * 1.92, -s * 0.10);
    ctx.bezierCurveTo(-s * 1.60, s * 0.06, -s * 1.00, s * 0.20, -s * 0.44, 0);
    ctx.closePath();
    ctx.fill();

    // 翼骨 + 翼脉
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = Math.max(0.6, s * 0.022);
    for (let k = 1; k <= 3; k++) {
      const kk = k / 4;
      ctx.beginPath();
      ctx.moveTo(-s * 0.50, 0);
      ctx.quadraticCurveTo(-s * (1.0 + kk * 0.4), -s * 0.10 * kk, -s * (1.30 + kk * 0.55), -s * (0.06 + kk * 0.14));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = Math.max(0.8, s * 0.030);
    ctx.beginPath();
    ctx.moveTo(-s * 0.44, 0);
    ctx.lineTo(-s * 1.90, -s * 0.10);
    ctx.stroke();

    ctx.restore();
  }
  ctx.globalAlpha = baseA;

  // ---- 六足：三节，关节可见 ----
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4;
    const kick = Math.sin(t * 3.4 + i) * 0.13;
    const kx1 = Math.cos(a) * s * 1.02, ky1 = Math.sin(a) * s * 1.02;
    const kx2 = Math.cos(a + kick * 0.5) * s * 1.30, ky2 = Math.sin(a + kick * 0.5) * s * 1.30;
    const kx3 = Math.cos(a + kick) * s * 1.56, ky3 = Math.sin(a + kick) * s * 1.56;

    ctx.strokeStyle = pal.fin;
    ctx.globalAlpha = baseA * 0.92;
    ctx.lineWidth = Math.max(1.0, s * 0.070);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * s * 0.66, Math.sin(a) * s * 0.66);
    ctx.lineTo(kx1, ky1);
    ctx.stroke();
    // 第二节更细
    ctx.strokeStyle = mixHex(pal.fin, pal.belly, 0.35);
    ctx.lineWidth = Math.max(0.8, s * 0.048);
    ctx.beginPath();
    ctx.moveTo(kx1, ky1);
    ctx.lineTo(kx2, ky2);
    ctx.stroke();
    // 末节 + 爪
    ctx.lineWidth = Math.max(0.6, s * 0.032);
    ctx.beginPath();
    ctx.moveTo(kx2, ky2);
    ctx.lineTo(kx3, ky3);
    ctx.stroke();
    ctx.fillStyle = pal.fin;
    ctx.beginPath();
    ctx.arc(kx3, ky3, Math.max(0.7, s * 0.040), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = baseA;

  // ---- 黄囊本体：球体明暗 + 一圈腹部反光 + 内部浑敦微光 ----
  const R = s * 0.94 * puls;
  const rr = Math.round(R / 3) * 3;
  const g = cachedRadial(ctx, `chaosbody|${pal.body}|${pal.belly}|${pal.fin}|${rr}`,
    -R * 0.34, -R * 0.38, R * 0.10, 0, 0, R * 1.10,
    [[0, mixHex(pal.belly, '#ffffff', 0.45)], [0.30, pal.belly],
     [0.66, pal.body], [0.90, mixHex(pal.body, pal.fin, 0.55)], [1, pal.fin]]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();

  // 边缘反光（暗色轮廓上的一圈冷光，让球体脱离背景）
  ctx.strokeStyle = 'rgba(255,236,180,0.28)';
  ctx.lineWidth = Math.max(1, s * 0.038);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.985, Math.PI * 0.62, Math.PI * 1.42);
  ctx.stroke();

  // 高光（明确的光源方向）
  const hl = cachedRadial(ctx, `chaoshl|${Math.round(R)}`,
    -R * 0.36, -R * 0.40, 0, -R * 0.36, -R * 0.40, R * 0.52,
    [[0, 'rgba(255,252,232,0.55)'], [1, 'rgba(255,252,232,0)']]);
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.fill();

  // 无面目的浑敦：内部缓慢流转的暗纹，不画眼睛
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.94, 0, TAU);
  ctx.clip();
  ctx.strokeStyle = 'rgba(120,72,16,0.16)';
  ctx.lineWidth = Math.max(1, s * 0.05);
  for (let i = 0; i < 3; i++) {
    const ph = t * 0.5 + i * 2.0;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * (0.42 + i * 0.18), R * (0.24 + i * 0.20), ph, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** 玄龟：负图而出的祥瑞龟（俯视龟壳） */
function drawTurtle(ctx, s, pal, t) {
  const baseA = ctx.globalAlpha;
  // 四鳍
  ctx.fillStyle = pal.fin;
  for (const [fx, fy] of [[0.55, -0.72], [0.55, 0.72], [-0.6, -0.66], [-0.6, 0.66]]) {
    ctx.save();
    ctx.translate(fx * s, fy * s);
    ctx.rotate((fy > 0 ? 1 : -1) * (0.6 + Math.sin(t * 2.4) * 0.22));
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.42, s * 0.17, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // 尾
  ctx.beginPath();
  ctx.ellipse(-s * 1.12, 0, s * 0.2, s * 0.12, 0, 0, TAU);
  ctx.fill();
  // 壳
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.0, s * 0.88, 0, 0, TAU);
  ctx.fill();
  // 河图纹（中央方格 + 放射线）
  ctx.strokeStyle = pal.belly;
  ctx.lineWidth = Math.max(1.2, s * 0.06);
  ctx.globalAlpha = baseA * 0.8;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * s * 0.28, Math.sin(a) * s * 0.25);
    ctx.lineTo(Math.cos(a) * s * 0.92, Math.sin(a) * s * 0.8);
    ctx.stroke();
  }
  ctx.strokeRect(-s * 0.26, -s * 0.22, s * 0.52, s * 0.44);
  ctx.globalAlpha = baseA;
  // 壳沿
  ctx.strokeStyle = pal.belly;
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.0, s * 0.88, 0, 0, TAU);
  ctx.stroke();
  // 头
  ctx.fillStyle = pal.fin;
  ctx.beginPath();
  ctx.ellipse(s * 1.05, 0, s * 0.3, s * 0.24, 0, 0, TAU);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#ffd77a';
    ctx.beginPath();
    ctx.arc(s * 1.14, side * s * 0.13, s * 0.055, 0, TAU);
    ctx.fill();
  }
}

/** 灯笼鱼：深渊诱猎者，头顶一根发光诱饵 */
function drawLantern(ctx, s, pal, tailPhase, t) {
  const baseA = ctx.globalAlpha;
  const L = s * 1.5, Wd = s * 0.72;
  // 尾
  const wag = Math.sin(tailPhase) * 0.4;
  ctx.save();
  ctx.translate(-L * 0.9, 0);
  ctx.rotate(wag);
  ctx.fillStyle = pal.fin;
  ctx.beginPath();
  ctx.moveTo(s * 0.1, 0);
  ctx.lineTo(-s * 0.7, -s * 0.45);
  ctx.quadraticCurveTo(-s * 0.4, 0, -s * 0.7, s * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // 身体（暗色）
  const grad = cachedRadial(ctx, `lantern|${pal.body}|${pal.belly}|${L.toFixed(1)}`, 0, 0, s * 0.15, 0, 0, L,
    [[0, pal.belly], [1, pal.body]]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, L, Wd, 0, 0, TAU);
  ctx.fill();
  // 巨口尖牙（前端）
  ctx.fillStyle = 'rgba(6,4,2,0.85)';
  ctx.beginPath();
  ctx.ellipse(L * 0.72, 0, L * 0.3, Wd * 0.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e8f4ff';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const tx = L * (0.88 - i * 0.09);
      const ty = side * Wd * (0.2 + i * 0.16);
      ctx.beginPath();
      ctx.moveTo(tx, ty - s * 0.05);
      ctx.lineTo(tx - s * 0.14, ty);
      ctx.lineTo(tx, ty + s * 0.05);
      ctx.closePath();
      ctx.fill();
    }
  }
  // 诱饵：头顶伸出的杆 + 发光球
  const sway = Math.sin(t * 1.8) * s * 0.3;
  ctx.strokeStyle = pal.fin;
  ctx.lineWidth = Math.max(1.5, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(L * 0.25, -Wd * 0.5);
  ctx.quadraticCurveTo(L * 0.55, -s * 1.5, L * 0.85 + sway, -s * 1.75);
  ctx.stroke();
  const lureX = L * 0.85 + sway, lureY = -s * 1.75;
  drawGlow(ctx, lureX, lureY, s * 0.75, 'rgba(159,232,255,ALPHA)', 0.55);
  ctx.fillStyle = pal.lure || '#9fe8ff';
  ctx.beginPath();
  ctx.arc(lureX, lureY, s * 0.17, 0, TAU);
  ctx.fill();
  // 小眼
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(L * 0.35, side * Wd * 0.45, s * 0.1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.arc(L * 0.37, side * Wd * 0.45, s * 0.045, 0, TAU);
    ctx.fill();
  }
}

/**
 * 取实体的离屏精灵（供 Pixi 后端直接转成 GPU 纹理）
 * 返回 { canvas, dim, half }，与 drawAnySprite 内部使用同一份缓存
 */
export function getEntitySprite(f) {
  // 尺寸分档：用 12 个相对档位，而不是绝对像素。
  // 否则玩家长大后，鱼尺寸连续变化 → 无限新建纹理 → 卡死。
  const size = quantizeSize(f.size);
  const key = `a|${f.typeKey}|${size}|${f.striped ? 1 : 0}`;
  const cached = _spriteCache.get(key);
  if (cached) return cached;

  // 未命中则烘焙一次
  const spr = _bakeSprite(f, size);
  _cacheSprite(key, spr);
  return spr;
}

/** NPC 绘制总入口（平移到自身位置 + 旋转到移动方向） */
export function renderCreature(ctx, f, t) {
  const s = f.size;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle || 0);
  if (f.alpha !== undefined && f.alpha < 1) ctx.globalAlpha = f.alpha;

  if (f.glow) drawGlow(ctx, 0, 0, s * 2.4, 'rgba(140,190,255,ALPHA)', 0.3);

  // 所有 NPC 走精灵缓存（1 次 drawImage）；只有需要张嘴等动态特征时才实绘
  if (!(f.mouth > 0.06)) {
    drawAnySprite(ctx, f, t);
    ctx.restore();
    return;
  }

  switch (f.shape) {
    case 'shrimp': drawShrimpDorsal(ctx, s, f.palette, f.tailPhase); break;
    case 'jelly': drawJellyDorsal(ctx, s * (f.pulse || 1), f.palette, t + (f.wobbleSeed || 0)); break;
    case 'sword': drawSwordDorsal(ctx, s, f.palette, f.tailPhase); break;
    case 'monster': drawMonsterDorsal(ctx, s, f.palette, f.tailPhase); break;
    // ===== 山海经水族 =====
    case 'humanface': drawHumanFace(ctx, s, f.palette, f.tailPhase); break;
    case 'multi': drawMultiBody(ctx, s, f.palette, t); break;
    case 'winged': drawWinged(ctx, s, f.palette, f.tailPhase, t); break;
    case 'merfolk': drawMerfolk(ctx, s, f.palette, f.tailPhase); break;
    case 'clam': drawClam(ctx, s, f.palette, t); break;
    case 'serpent': drawSerpent(ctx, s, f.palette, f.tailPhase, t); break;
    case 'ninehead': drawNineHead(ctx, s, f.palette, f.tailPhase, t); break;
    case 'chaos': drawChaos(ctx, s, f.palette, f.tailPhase, t); break;
    case 'turtle': drawTurtle(ctx, s, f.palette, t); break;
    case 'lantern': drawLantern(ctx, s, f.palette, f.tailPhase, t); break;
    default: drawFishDorsal(ctx, s, f.palette, f.tailPhase, { striped: f.striped });
  }
  ctx.restore();
}

/** 玩家（鲲）：背视金橙 + 化形光环 + 触须 + 张嘴 V 楔 */
export function renderKun(ctx, p, t) {
  const s = p.radius;
  const hero = p.hero;
  const sp = hero && hero.palette ? hero.palette : null;
  const pal = sp
    ? { body: sp.body, belly: sp.bodyLight, fin: sp.bodyDeep, glow: sp.glow }
    : { body: '#f59d1e', belly: '#ffe082', fin: '#c95f0a', glow: 'rgba(255,215,120,ALPHA)' };

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle || 0);
  if (p.invincible > 0 && Math.floor(t * 10) % 2 === 0) ctx.globalAlpha = 0.35;

  // ============ 发育阶段（0幼体 → 4完全体）============
  const stage = p.stage || 0;

  // ---- 阶段光环：越成年光晕越强 ----
  if (stage > 0) {
    drawGlow(ctx, 0, 0, s * (2.2 + stage * 0.5), pal.glow, 0.10 + stage * 0.07);
  }

  const shape = (hero && hero.shape) || 'kun';
  const build = (hero && hero.build) || { len: 1, wide: 1, fin: 1 };

  // ---- 成年后：背脊光纹（在身体之后、鳞片之前叠加）----
  if (stage >= 2) {
    ctx.save();
    ctx.globalAlpha = 0.10 + stage * 0.05;
    ctx.strokeStyle = pal.belly;
    ctx.lineWidth = Math.max(1, s * 0.045);
    ctx.lineCap = 'round';
    const pulse = 0.7 + Math.sin(t * 2.4) * 0.3;
    ctx.globalAlpha *= pulse;
    ctx.beginPath();
    ctx.moveTo(-s * 1.1, 0);
    ctx.quadraticCurveTo(0, -s * 0.10, s * 1.2, 0);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const k = (i - 1) * 0.55;
      ctx.beginPath();
      ctx.moveTo(k * s, -s * 0.06);
      ctx.lineTo(k * s, s * 0.06);
      ctx.stroke();
    }
    ctx.restore();
  }

  switch (shape) {
    case 'ray':     HeroRay.draw(ctx, s, pal, p, build); break;
    case 'turtle':  HeroAo.draw(ctx, s, pal, p, build); break;
    case 'serpent': HeroJiao.draw(ctx, s, pal, p, build); break;
    default:        HeroKun.draw(ctx, s, pal, p, build); break;
  }

  // ============ 成年装饰（画在身体之上）============
  if (stage >= 1) {
    // 少年起：身体外描一圈细边，轮廓更硬朗
    ctx.save();
    ctx.globalAlpha = 0.18 + stage * 0.06;
    ctx.strokeStyle = pal.belly;
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * build.len * 1.55, s * build.wide * 0.78, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  if (stage >= 3) {
    // 巨兽起：环绕身躯的能量环
    ctx.save();
    const rot = t * 0.9;
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * TAU;
      const rr = s * (1.5 + 0.12 * Math.sin(t * 3 + i));
      ctx.globalAlpha = 0.16 + 0.10 * Math.sin(t * 2 + i);
      ctx.fillStyle = pal.glow.replace('ALPHA', '1');
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.7, s * 0.055, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  if (stage >= 4) {
    // 完全体：背部金色纹章 + 呼吸式强光
    ctx.save();
    const br = 0.75 + Math.sin(t * 1.8) * 0.25;
    ctx.globalAlpha = 0.22 * br;
    ctx.fillStyle = pal.belly;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const r1 = s * 0.32, r2 = s * 0.58;
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.7);
      ctx.lineTo(Math.cos(a + 0.25) * r2, Math.sin(a + 0.25) * r2 * 0.7);
      ctx.lineTo(Math.cos(a - 0.25) * r2, Math.sin(a - 0.25) * r2 * 0.7);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
    drawGlow(ctx, 0, 0, s * 3.4, pal.glow, 0.10 * br);
  }

  ctx.restore();
}









/** 鹏（结局，俯视）：双翼 + 扇尾，朝屏幕上方飞 */
export function renderPeng(ctx, x, y, r, wingPhase, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  const flap = Math.sin(wingPhase);
  drawGlow(ctx, 0, 0, r * 2.6, 'rgba(255,205,110,ALPHA)', 0.3 * alpha);
  // 扇尾
  ctx.fillStyle = '#241a0c';
  for (const a of [-0.4, 0, 0.4]) {
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, r * 1.15, r * 0.16, r * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // 双翼（大幅挥动）
  for (const side of [-1, 1]) {
    const spread = side * (1.1 + flap * 0.35);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.15);
    ctx.quadraticCurveTo(spread * r * 1.1, r * (0.1 - flap * 0.25), spread * r * 1.5, r * (0.55 + flap * 0.2));
    ctx.quadraticCurveTo(spread * r * 0.6, r * (0.5 + flap * 0.1), 0, r * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  // 身体
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.42, r * 0.85, 0, 0, TAU);
  ctx.fill();
  // 头 + 喙（朝上）
  ctx.beginPath();
  ctx.arc(0, -r * 0.95, r * 0.24, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-r * 0.1, -r * 1.12);
  ctx.lineTo(0, -r * 1.42);
  ctx.lineTo(r * 0.1, -r * 1.12);
  ctx.closePath();
  ctx.fill();
  // 金边
  ctx.strokeStyle = 'rgba(255,205,110,0.7)';
  ctx.lineWidth = Math.max(1.5, r * 0.05);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.42, r * 0.85, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}
