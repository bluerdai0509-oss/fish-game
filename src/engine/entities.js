// ============================================================
// 实体：NPC 鱼（行为数据驱动）/ 道具 / 粒子 / 俯视水体背景
// 俯视语义：鱼头朝移动方向旋转（angle），不再左右翻转
// ============================================================
import { FISH_TYPES } from '../data/acts.js';
import { assignDepth } from './depth.js';

// ============================================================
// 椭圆体碰撞：鱼是长椭圆形，圆形判定会让「鼻尖已碰上但中心还远」
// 沿中心连线方向取各自椭圆的有效半径，接触点 ≈ 视觉边缘
// ============================================================

/** 各形状的碰撞半长 / 半宽（× size 倍数） */
export const SHAPE_HIT = {
  fish: [1.58, 0.75],
  shrimp: [1.35, 0.62],
  jelly: [0.95, 0.95],
  sword: [1.85, 0.68],
  monster: [1.5, 1.05],
  humanface: [1.6, 0.78],
  multi: [0.6, 0.6],
  winged: [1.5, 1.15],
  merfolk: [1.55, 0.7],
  clam: [1.1, 0.95],
  serpent: [1.65, 0.62],
  ninehead: [1.1, 1.1],
  chaos: [1.3, 1.3],
  turtle: [1.5, 1.0],
  lantern: [1.5, 0.75],
};

/** 椭圆沿「与 x 轴夹角为 local 的方向」的有效半径 */
export function effRadius(localAng, hl, hw) {
  const c = Math.cos(localAng), si = Math.sin(localAng);
  return 1 / Math.sqrt((c / hl) * (c / hl) + (si / hw) * (si / hw));
}

/**
 * 两椭圆体是否接触
 * @param dx,dy   a 指向 b 的位移
 * @param aAng,aHl,aHw   a 的朝向 / 半长 / 半宽
 * @param bAng,bHl,bHw   b 的朝向 / 半长 / 半宽
 * @param forgive 宽容系数（1 = 视觉边缘即接触）
 */
export function bodiesTouch(dx, dy, aAng, aHl, aHw, bAng, bHl, bHw, forgive = 0.95) {
  const d = Math.hypot(dx, dy);
  // 完全重合：必然接触（避免 atan2(0,0) 与除零）
  if (d < 0.5) return true;
  // a 的有效半径：连线方向转到 a 的局部系
  const la = Math.atan2(dy, dx) - aAng;
  const ra = effRadius(la, aHl, aHw);
  // b 的有效半径：方向相反
  const lb = Math.atan2(-dy, -dx) - bAng;
  const rb = effRadius(lb, bHl, bHw);
  return d < (ra + rb) * forgive;
}
import { renderCreature, smoothAngle } from './fishrender.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 粒子 ----------
export class ParticleSystem {
  constructor() { this.list = []; }
  burst(x, y, color, n = 10, spd = 140) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(spd * 0.3, spd);
      this.list.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
        life: rand(0.4, 0.8), maxLife: 0.8, r: rand(1.5, 4), color,
      });
    }
  }
  update(dt) {
    for (const p of this.list) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 60 * dt; p.vx *= 0.98;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }
  render(ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// ---------- 气泡（俯视：升向镜头，随视野生成，世界坐标） ----------
export class BubbleField {
  constructor() { this.list = []; }
  /**
   * @param view  当前视野矩形
   * @param cur   可选的水流场：气泡会被水流带着漂
   */
  update(dt, view, cur, t = 0) {
    if (Math.random() < dt * 2.4) {
      this.list.push({
        x: rand(view.x0, view.x1), y: rand(view.y0, view.y1),
        r: rand(1.5, 3), vy: rand(8, 20), wob: rand(0, TAU),
      });
    }
    for (const b of this.list) {
      b.y -= b.vy * dt * 0.2;
      b.x += Math.sin(b.y * 0.05 + b.wob) * 10 * dt;
      // 随水流漂移：气泡轻，几乎完全跟随水流
      if (cur) {
        const c = cur.sample(b.x, b.y, t);
        b.x += c.x * dt * 0.55;
        b.y += c.y * dt * 0.55;
      }
      b.r += dt * 1.6;
    }
    this.list = this.list.filter((b) =>
      b.r < 9 && b.x > view.x0 - 80 && b.x < view.x1 + 80 && b.y > view.y0 - 80 && b.y < view.y1 + 80
    );
  }
  render(ctx) {
    for (const b of this.list) {
      ctx.globalAlpha = clamp(0.38 - b.r * 0.03, 0.08, 0.38);
      ctx.strokeStyle = 'rgba(210, 240, 255, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ---------- 礁石/水藻团（俯视：暗色斑块） ----------
export function makeReefs(n, W, H) {
  const reefs = [];
  for (let i = 0; i < n; i++) {
    reefs.push({
      x: rand(40, W - 40),
      y: rand(60, H - 40),
      r: rand(22, 50),
      seed: rand(0, TAU),
    });
  }
  return reefs;
}
// 礁石精灵缓存：9 次 draw call 压到 1 次
const _reefCache = new Map();
function _reefSprite(r) {
  const rq = Math.max(12, Math.round(r / 6) * 6);
  let spr = _reefCache.get(rq);
  if (spr) return spr;
  const dim = Math.ceil(rq * 2.6);
  const c = document.createElement('canvas');
  c.width = c.height = dim;
  const g = c.getContext('2d');
  g.translate(dim / 2, dim / 2);
  g.fillStyle = 'rgba(8, 22, 20, 0.32)';
  g.beginPath();
  g.ellipse(0, 0, rq, rq * 0.66, 0, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(30, 68, 52, 0.26)';
  g.beginPath();
  g.ellipse(rq * 0.15, -rq * 0.1, rq * 0.55, rq * 0.36, 0.4, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(52, 100, 76, 0.4)';
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    g.beginPath();
    g.moveTo(Math.cos(a) * rq * 0.5, Math.sin(a) * rq * 0.34);
    g.lineTo(Math.cos(a) * rq * 0.78, Math.sin(a) * rq * 0.52);
    g.stroke();
  }
  spr = { canvas: c, dim, half: dim / 2 };
  if (_reefCache.size > 40) _reefCache.clear();
  _reefCache.set(rq, spr);
  return spr;
}

export function drawReefs(ctx, reefs, t) {
  for (const s of reefs) {
    const spr = _reefSprite(s.r);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.seed + Math.sin(t * 0.3 + s.seed) * 0.05);
    ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.dim, spr.dim);
    ctx.restore();
  }
}

// ============================================================
// 俯视水体背景（无限海）
// 性能关键：焦散/幽光/暗角全部预渲染到离屏 canvas，按世界坐标平铺。
// 每帧只做少量 drawImage，不再创建任何渐变对象。
// ============================================================
const WATER_TILE = 512;          // 离屏瓦片尺寸
const _tileCache = new Map();    // key -> { canvas, caustic, glow }
const _vignetteCache = new Map();

function _makeTile(kind, water, alpha) {
  const key = `${kind}|${water.top}|${water.bottom}|${alpha}`;
  let c = _tileCache.get(key);
  if (c) return c;

  c = document.createElement('canvas');
  c.width = c.height = WATER_TILE;
  const g = c.getContext('2d');
  if (kind === 'caustic') {
    // 焦散：细亮的"光网"。
    // 俯视看水下，水面折射出来的是一张由亮线围成的网，
    // 而不是一团团光斑 —— 画成光斑会被误读成气泡。
    let s0 = 20291;
    const rnd = () => { s0 = (s0 * 9301 + 49297) % 233280; return s0 / 233280; };

    // 两层弯曲亮线：一层近水平、一层近垂直，交叉成不规则网格
    g.lineCap = 'round';
    for (const layer of [0, 1]) {
      const lines = layer ? 4 : 3;
      for (let i = 0; i < lines; i++) {
        const base = (i / lines) * WATER_TILE + rnd() * (WATER_TILE / lines) * 0.6;
        const amp = 22 + rnd() * 40;
        const phase = rnd() * TAU;
        // 每层都画 3 条稍偏移的副本，叠加出"发亮"的手感
        for (let pass = 0; pass < 3; pass++) {
          const thick = (3 - pass) * (2.4 + rnd() * 1.6);
          g.strokeStyle = `rgba(238,252,255,${alpha * (0.07 + pass * 0.09)})`;
          g.lineWidth = thick;
          for (const shift of [0, WATER_TILE, -WATER_TILE]) {
            g.beginPath();
            for (let k = 0; k <= 16; k++) {
              const u = (k / 16) * WATER_TILE;
              // 频率取整数倍 → 首尾相位一致，平铺无接缝
              const wob = Math.sin(u / WATER_TILE * TAU * 2 + phase + i) * amp
                        + Math.sin(u / WATER_TILE * TAU * 3 + phase * 2) * amp * 0.35;
              const px = layer ? base + wob + shift : u + shift;
              const py = layer ? u : base + wob;
              k ? g.lineTo(px, py) : g.moveTo(px, py);
            }
            g.stroke();
          }
        }
      }
    }
  } else if (kind === 'glow') {
    for (let i = 0; i < 3; i++) {
      const bx = ((i * 233) % WATER_TILE);
      const by = ((i * 411) % WATER_TILE);
      const r = 110 + i * 30;
      const col = i % 2 ? '120,160,255' : '180,120,255';
      for (const [ox, oy] of [[0, 0], [WATER_TILE, 0], [-WATER_TILE, 0], [0, WATER_TILE], [0, -WATER_TILE]]) {
        const rg = g.createRadialGradient(bx + ox, by + oy, r * 0.2, bx + ox, by + oy, r);
        rg.addColorStop(0, `rgba(${col},0.07)`);
        rg.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = rg;
        g.beginPath();
        g.arc(bx + ox, by + oy, r, 0, TAU);
        g.fill();
      }
    }
  }
  if (_tileCache.size > 30) _tileCache.clear();
  _tileCache.set(key, c);
  return c;
}

/** 用图案平铺离屏瓦片（pattern 的坐标系跟随当前 transform，即世界坐标） */
function _tilePatterns(ctx, c, view, offsetX, offsetY) {
  const pat = ctx.createPattern(c, 'repeat');
  if (!pat) return null;
  const m = ctx.getTransform();
  pat.setTransform(new DOMMatrix().translate(offsetX, offsetY).multiply(m.inverse()).multiply(m));
  return pat;
}

export function drawWater(ctx, view, water, t) {
  const { x0, y0, x1, y1 } = view;
  const w = x1 - x0, h = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rw = w / 2, rh = h / 2;

  // 底色：单次径向渐变（每帧 1 个，可接受）
  const g = ctx.createRadialGradient(cx, cy, 60, cx, cy, Math.max(rw, rh) * 0.95);
  g.addColorStop(0, water.top);
  g.addColorStop(1, water.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, h);

  // 焦散光斑：预渲染瓦片平铺（缓慢漂移用取模偏移，避免每帧建渐变）
  const caustic = _makeTile('caustic', water, water.dark ? 0.055 : 0.105);
  const ox = (Math.sin(t * 0.22) * 90) % WATER_TILE;
  const oy = (Math.cos(t * 0.18) * 70) % WATER_TILE;
  const pat = _tilePatterns(ctx, caustic, view, ox, oy);
  if (pat) {
    ctx.save();
    ctx.fillStyle = pat;
    ctx.fillRect(x0, y0, w, h);
    ctx.restore();
  }

  // 浮游生物：批量小点（无渐变，代价低）
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  const P2 = 520;
  const startX = Math.floor(x0 / P2) * P2, startY = Math.floor(y0 / P2) * P2;
  for (let tx = startX; tx < x1 + P2; tx += P2) {
    for (let ty = startY; ty < y1 + P2; ty += P2) {
      for (let i = 0; i < 6; i++) {
        const px = tx + ((i * 137 + t * 18) % P2);
        const py = ty + ((i * 211 + Math.sin(t * 0.3 + i) * 26) % P2);
        ctx.fillRect(px, py, 2, 2);
      }
    }
  }

  // 边缘暗角：缓存一个离屏径向图，缩放贴到视野
  const vkey = `vig|${Math.round(w)}|${Math.round(h)}`;
  let vig = _vignetteCache.get(vkey);
  if (!vig) {
    vig = document.createElement('canvas');
    vig.width = Math.max(2, Math.round(w));
    vig.height = Math.max(2, Math.round(h));
    const vg = vig.getContext('2d');
    const v = vg.createRadialGradient(w / 2, h / 2, Math.max(rw, rh) * 0.45, w / 2, h / 2, Math.max(rw, rh) * 1.02);
    v.addColorStop(0, 'rgba(2,6,14,0)');
    v.addColorStop(1, 'rgba(2,6,14,0.42)');
    vg.fillStyle = v;
    vg.fillRect(0, 0, w, h);
    if (_vignetteCache.size > 8) _vignetteCache.clear();
    _vignetteCache.set(vkey, vig);
  }
  ctx.drawImage(vig, x0, y0, w, h);

  // 北冥幽光：预渲染瓦片平铺
  if (water.dark) {
    const glow = _makeTile('glow', water, 1);
    const gx = (Math.sin(t * 0.4) * 60) % WATER_TILE;
    const gy = (Math.cos(t * 0.3) * 50) % WATER_TILE;
    const gp = _tilePatterns(ctx, glow, view, gx, gy);
    if (gp) {
      ctx.save();
      ctx.fillStyle = gp;
      ctx.fillRect(x0, y0, w, h);
      ctx.restore();
    }
  }
}

// ---------- NPC 鱼（无限海：任意航向） ----------
export class Fish {
  /**
   * @param typeKey FISH_TYPES 键
   * @param opts { x, y, size(px 半径), speed(px/s), heading(弧度) }
   */
  constructor(typeKey, opts) {
    const type = FISH_TYPES[typeKey];
    this.typeKey = typeKey;
    this.label = type.label;
    this.shape = type.shape;
    this.behavior = type.behavior;
    this.palette = type.palette;
    this.striped = Math.random() < (type.striped || 0);
    this.glow = !!type.glow;
    this.sting = !!type.sting;
    this.heavy = !!type.heavy;
    this.neutral = !!type.neutral;      // 中性生物：不可吃也不伤人（蜃、玄龟）
    this.lore = type.lore || '';        // 山海经原文
    this.drops = type.drops || null;    // 击杀掉落道具
    this.speedMul = type.speedMul || 1;

    this.size = opts.size;
    this.speed = opts.speed;
    this.heading = opts.heading ?? 0;
    this.x = opts.x;
    this.y = opts.y;
    this.vx = Math.cos(this.heading) * this.speed;
    this.vy = Math.sin(this.heading) * this.speed;
    this.angle = this.heading;
    this.tailPhase = rand(0, TAU);
    this.wobbleSeed = rand(0, TAU);
    this.wobbleAmp = rand(6, 16);
    this.pulse = 1;
    this.mouth = 0;
    this.chasing = false;

    // 行为状态
    this.dartTimer = rand(1, 3);
    this.dashLeft = 0;
    this.chargeState = 'patrol';
    this.chargeTimer = 0;
    this.chargeCd = 0;
    this.dead = false;

    // 深度层：决定渲染时的缩放 / 视差 / 雾化（大鱼沉在深处，小鱼靠近水面）
    this.depth = assignDepth(this);
    // 缓慢的上下浮沉：让深度不是死值，画面有纵向呼吸感
    this.depthPhase = rand(0, TAU);
    this.depthAmp = rand(0.04, 0.13);
  }

  update(dt, t, player) {
    const bx = Math.cos(this.heading) * this.speed;
    const by = Math.sin(this.heading) * this.speed;

    switch (this.behavior) {
      case 'swim': {
        if (!this.chasing) {
          this.vx += (bx - this.vx) * clamp(dt * 1.5, 0, 1);
          this.vy += (by - this.vy) * clamp(dt * 1.5, 0, 1);
          // 垂直于航向的轻微摆动
          const wob = Math.sin(t * 1.5 + this.wobbleSeed) * this.wobbleAmp * dt * 10;
          this.vx += -Math.sin(this.heading) * wob;
          this.vy += Math.cos(this.heading) * wob;
        }
        break;
      }
      case 'dart': {
        this.dartTimer -= dt;
        if (this.dartTimer <= 0 && this.dashLeft <= 0) {
          this.dashLeft = 0.35;
          this.dartTimer = rand(1.5, 3);
        }
        if (this.dashLeft > 0) {
          this.dashLeft -= dt;
          this.vx = Math.cos(this.heading) * this.speed * 3;
          this.vy = Math.sin(this.heading) * this.speed * 3;
        } else {
          this.vx += (Math.cos(this.heading) * this.speed * 0.4 - this.vx) * clamp(dt * 2, 0, 1);
          this.vy += (Math.sin(this.heading) * this.speed * 0.4 - this.vy) * clamp(dt * 2, 0, 1);
        }
        break;
      }
      case 'pulse': {
        this.vx = bx;
        this.vy = by;
        const wob = Math.sin(t * 1.6 + this.wobbleSeed) * 26;
        this.vx += -Math.sin(this.heading) * wob * dt * 10;
        this.vy += Math.cos(this.heading) * wob * dt * 10;
        this.pulse = 1 + Math.sin(t * 3 + this.wobbleSeed) * 0.16;
        break;
      }
      case 'charge': {
        this.chargeCd -= dt;
        if (this.chargeState === 'patrol') {
          this.vx = bx; this.vy = by;
          if (player && this.chargeCd <= 0) {
            const dx = player.x - this.x, dy = player.y - this.y;
            const d = Math.hypot(dx, dy);
            const ahead = Math.cos(Math.atan2(dy, dx) - this.angle) > 0.5;
            const lateral = Math.abs(-Math.sin(this.angle) * dx + Math.cos(this.angle) * dy);
            if (lateral < 60 && ahead && d < 380) {
              this.chargeState = 'telegraph';
              this.chargeTimer = 0.5;
            }
          }
        } else if (this.chargeState === 'telegraph') {
          this.chargeTimer -= dt;
          this.vx *= 0.9; this.vy *= 0.9;
          if (this.chargeTimer <= 0) {
            this.chargeState = 'charging';
            this.chargeTimer = 0.7;
          }
        } else if (this.chargeState === 'charging') {
          this.chargeTimer -= dt;
          this.vx = Math.cos(this.angle) * this.speed * 4.2;
          this.vy = Math.sin(this.angle) * this.speed * 4.2;
          if (this.chargeTimer <= 0) {
            this.chargeState = 'patrol';
            this.chargeCd = 2.2;
          }
        }
        break;
      }
      case 'wanderBig': {
        this.vx += (bx - this.vx) * clamp(dt * 0.8, 0, 1);
        this.vy += (by - this.vy) * clamp(dt * 0.8, 0, 1);
        if (player) {
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (d < 200 && d > 1) {
            this.vx += ((player.x - this.x) / d) * 88 * dt;
            this.vy += ((player.y - this.y) / d) * 88 * dt;
          }
        }
        break;
      }

      // ===== 山海经行为 =====
      // 诱猎：静止伪装，玩家靠近突然扑击
      case 'lure': {
        if (!this.lungeT) this.lungeT = 0;
        if (!this.lureCd) this.lureCd = 0;
        this.lureCd = Math.max(0, this.lureCd - dt);
        if (player && this.lungeT <= 0 && this.lureCd <= 0) {
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (d < 130) {
            this.lungeT = 0.45;
            this.lureCd = 2.4;
            const a = Math.atan2(player.y - this.y, player.x - this.x);
            this.vx = Math.cos(a) * this.speed * 4.5;
            this.vy = Math.sin(a) * this.speed * 4.5;
          }
        }
        if (this.lungeT > 0) {
          this.lungeT -= dt;
          this.vx *= 0.96; this.vy *= 0.96;
        } else {
          // 伪装悬停：几乎不动，只轻微摆尾
          this.vx += (bx * 0.12 - this.vx) * clamp(dt * 1.2, 0, 1);
          this.vy += (by * 0.12 - this.vy) * clamp(dt * 1.2, 0, 1);
        }
        break;
      }
      // 成群：跟随最近同类，保持队形
      case 'school': {
        this.vx += (bx - this.vx) * clamp(dt * 1.2, 0, 1);
        this.vy += (by - this.vy) * clamp(dt * 1.2, 0, 1);
        if (this.school && this.school.length > 1) {
          let cx = 0, cy = 0, n = 0;
          for (const o of this.school) {
            if (o === this || o.dead) continue;
            cx += o.x; cy += o.y; n++;
          }
          if (n) {
            cx /= n; cy /= n;
            const d = Math.hypot(cx - this.x, cy - this.y);
            if (d > 1) {
              // 朝群体中心靠拢，但保持间距
              const pull = d > 90 ? 0.9 : d < 45 ? -0.6 : 0.1;
              this.vx += ((cx - this.x) / d) * this.speed * pull * dt * 1.6;
              this.vy += ((cy - this.y) / d) * this.speed * pull * dt * 1.6;
            }
          }
          // 与队友分离，避免重叠
          for (const o of this.school) {
            if (o === this || o.dead) continue;
            const dd = Math.hypot(o.x - this.x, o.y - this.y);
            const minD = (this.size + o.size) * 1.5;
            if (dd > 0.1 && dd < minD) {
              this.vx += ((this.x - o.x) / dd) * 80 * dt;
              this.vy += ((this.y - o.y) / dd) * 80 * dt;
            }
          }
        }
        break;
      }
      // 逃跑：玩家靠近就加速远离
      case 'flee': {
        if (player) {
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (d < 190 && d > 1) {
            const fear = 1 - d / 190;
            this.vx += ((this.x - player.x) / d) * this.speed * 3.2 * fear * dt;
            this.vy += ((this.y - player.y) / d) * this.speed * 3.2 * fear * dt;
            // 保持上限
            const sp = Math.hypot(this.vx, this.vy);
            const cap = this.speed * 2.4;
            if (sp > cap) { this.vx = this.vx / sp * cap; this.vy = this.vy / sp * cap; }
            break;
          }
        }
        this.vx += (bx - this.vx) * clamp(dt * 1.5, 0, 1);
        this.vy += (by - this.vy) * clamp(dt * 1.5, 0, 1);
        break;
      }
      // 漂流：无威胁，缓慢随波逐流
      case 'drift': {
        this.vx += (bx * 0.55 - this.vx) * clamp(dt * 0.5, 0, 1);
        this.vy += (by * 0.55 - this.vy) * clamp(dt * 0.5, 0, 1);
        // 缓慢竖直漂移
        this.vy += Math.sin(t * 0.5 + this.wobbleSeed) * 8 * dt;
        break;
      }
      // 伏击：先静默接近，进入突袭距离后爆发冲刺
      case 'ambush': {
        if (!this.ambushT) this.ambushT = 0;
        if (!this.ambushCd) this.ambushCd = 0;
        this.ambushCd = Math.max(0, this.ambushCd - dt);
        if (player && this.ambushT <= 0 && this.ambushCd <= 0) {
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (d < 300) {
            // 潜行接近
            const a = Math.atan2(player.y - this.y, player.x - this.x);
            this.vx += (Math.cos(a) * this.speed * 0.9 - this.vx) * clamp(dt * 1.8, 0, 1);
            this.vy += (Math.sin(a) * this.speed * 0.9 - this.vy) * clamp(dt * 1.8, 0, 1);
            if (d < 120) {
              this.ambushT = 0.4;
              this.ambushCd = 3.2;
              this.vx = Math.cos(a) * this.speed * 5;
              this.vy = Math.sin(a) * this.speed * 5;
            }
            break;
          }
        }
        if (this.ambushT > 0) { this.ambushT -= dt; this.vx *= 0.95; this.vy *= 0.95; break; }
        this.vx += (bx - this.vx) * clamp(dt * 1.0, 0, 1);
        this.vy += (by - this.vy) * clamp(dt * 1.0, 0, 1);
        break;
      }
    }

    // 追击（大体型压迫，由 PlayScene 设置 chasing）
    if (this.chasing && player) {
      const d = Math.max(1, Math.hypot(player.x - this.x, player.y - this.y));
      const wantVx = ((player.x - this.x) / d) * this.speed * 1.3;
      const wantVy = ((player.y - this.y) / d) * this.speed * 1.3;
      this.vx += (wantVx - this.vx) * clamp(dt * 2.5, 0, 1);
      this.vy += (wantVy - this.vy) * clamp(dt * 2.5, 0, 1);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 头朝移动方向（背视：旋转）
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 8) {
      this.angle = smoothAngle(this.angle, Math.atan2(this.vy, this.vx), clamp(dt * 6, 0, 1));
    }
    this.tailPhase += dt * (5 + sp * 0.05);
    // 深度浮沉：在基准层附近缓慢上下游动
    this.depthPhase += dt * 0.55;
    this.depthNow = this.depth + Math.sin(this.depthPhase) * this.depthAmp;
  }

  render(ctx, t) { renderCreature(ctx, this, t); }
}

/**
 * 把某种道具烘焙成一张离屏 canvas（供 Pixi 转纹理，避免每帧上传）。
 * 尺寸 64²，中心即道具原点。
 */
export function createItemPreviewCanvas(kind) {
  if (!ITEM_DEFS[kind]) return null;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  const c2 = ITEM_DEFS[kind].color;
  // 光晕
  const rad = g.createRadialGradient(0, 0, 2, 0, 0, 22);
  rad.addColorStop(0, c2 + '66');
  rad.addColorStop(1, c2 + '00');
  g.fillStyle = rad;
  g.beginPath();
  g.arc(0, 0, 22, 0, TAU);
  g.fill();

  if (kind === 'lingzhu') {
    g.fillStyle = c2;
    g.beginPath();
    g.arc(0, 0, 8, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.arc(-2.5, -2.5, 2.5, 0, TAU);
    g.fill();
  } else if (kind === 'guijia') {
    g.fillStyle = '#8d6e63';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU - Math.PI / 2;
      const px = Math.cos(a) * 9, py = Math.sin(a) * 9;
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = '#d7ccc8';
    g.lineWidth = 1.5;
    g.stroke();
  } else {
    g.strokeStyle = c2;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, 9); g.lineTo(0, -2);
    g.moveTo(0, 0); g.quadraticCurveTo(-6, -4, -7, -10);
    g.moveTo(0, 0); g.quadraticCurveTo(6, -4, 7, -10);
    g.stroke();
  }
  return c;
}

// ---------- 道具 ----------
const _itemGlowCache = new Map();

export const ITEM_DEFS = {
  lingzhu: { label: '灵珠 · 疾', color: '#4dd0e1', desc: '移速 +30%' },
  guijia:  { label: '龟甲 · 御', color: '#a1887f', desc: '抵挡一次伤害' },
  xiancao: { label: '仙草 · 命', color: '#81c784', desc: '生命 +1' },
};

export class Item {
  constructor(kind, x, y) {
    this.kind = kind;
    this.x = x; this.y = y;
    this.bob = rand(0, TAU);
    this.dead = false;
    this.r = 13;
  }
  update(dt, t) { this.bob += dt * 2; this.yFloat = Math.sin(this.bob) * 5; }
  get drawY() { return this.y + (this.yFloat || 0); }
  render(ctx, t) {
    const y = this.drawY;
    ctx.save();
    ctx.translate(this.x, y);
    const c = ITEM_DEFS[this.kind].color;
    // 光晕：缓存（同色同尺寸只建一次）
    let g = _itemGlowCache.get(c);
    if (!g) {
      g = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
      g.addColorStop(0, c + '66');
      g.addColorStop(1, c + '00');
      _itemGlowCache.set(c, g);
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, TAU);
    ctx.fill();

    if (this.kind === 'lingzhu') {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(-2.5, -2.5, 2.5, 0, TAU);
      ctx.fill();
    } else if (this.kind === 'guijia') {
      ctx.fillStyle = '#8d6e63';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU - Math.PI / 2;
        const px = Math.cos(a) * 9, py = Math.sin(a) * 9;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#d7ccc8';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 9); ctx.lineTo(0, -2);
      ctx.moveTo(0, 0); ctx.quadraticCurveTo(-6, -4, -7, -10);
      ctx.moveTo(0, 0); ctx.quadraticCurveTo(6, -4, 7, -10);
      ctx.stroke();
    }
    ctx.restore();
  }
}
