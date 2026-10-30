// ============================================================
// 障碍物：礁石 / 珊瑚 / 海草 / 漩涡
// 与背景装饰不同，这些有实际物理效果：
//   礁石 —— 硬碰撞，撞上反弹 + 掉血（大鱼也绕行）
//   珊瑚 —— 软碰撞，穿过但减速
//   海草 —— 缠绕，持续减速（可穿过）
//   漩涡 —— 吸力 + 拉扯方向
// ============================================================
import { TAU, drawGlow } from './draw-common.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 精灵缓存（礁石/珊瑚形状只烘焙一次）----------
const _obstacleCache = new Map();

/** 礁石：不规则多边形岩块 + 苔藓斑 */
function buildReefSprite(r, seed) {
  const key = 'reef|' + Math.round(r / 6) + '|' + (seed % 8);
  let spr = _obstacleCache.get(key);
  if (spr) return spr;

  const dim = Math.ceil(r * 2.8);
  const c = document.createElement('canvas');
  c.width = c.height = dim;
  const g = c.getContext('2d');
  g.translate(dim / 2, dim / 2);

  const pr = Math.random; // 用固定 seed 让同 key 形状一致
  let s0 = (seed * 9301 + 49297) % 233280;
  const rnd = () => { s0 = (s0 * 9301 + 49297) % 233280; return s0 / 233280; };

  // 岩体：12 个顶点的不规则多边形
  const pts = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (0.78 + rnd() * 0.30);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.84]);
  }

  // 阴影层
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(p[0] + r * 0.06, p[1] + r * 0.10) : g.moveTo(p[0] + r * 0.06, p[1] + r * 0.10));
  g.closePath();
  g.fill();

  // 主体渐变（暖灰褐，比之前更亮，避免像黑洞）
  const grad = g.createRadialGradient(-r * 0.28, -r * 0.32, r * 0.12, 0, 0, r * 1.05);
  grad.addColorStop(0, '#9aa89b');
  grad.addColorStop(0.42, '#6e7d70');
  grad.addColorStop(0.78, '#4a574c');
  grad.addColorStop(1, '#2e3830');
  g.fillStyle = grad;
  g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
  g.closePath();
  g.fill();

  // 顶部受光面
  g.save();
  g.clip();
  const topLight = g.createLinearGradient(0, -r, 0, r * 0.4);
  topLight.addColorStop(0, 'rgba(220, 235, 220, 0.42)');
  topLight.addColorStop(0.55, 'rgba(200, 220, 205, 0.10)');
  topLight.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
  g.fillStyle = topLight;
  g.fillRect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
  g.restore();

  // 棱面高光（沿法线的短折线）
  g.strokeStyle = 'rgba(210, 230, 215, 0.34)';
  g.lineWidth = Math.max(1, r * 0.04);
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = rnd() * TAU;
    const r1 = r * (0.25 + rnd() * 0.3);
    const r2 = r * (0.55 + rnd() * 0.28);
    g.beginPath();
    g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.84);
    g.lineTo(Math.cos(a + 0.35) * r2, Math.sin(a + 0.35) * r2 * 0.84);
    g.stroke();
  }

  // 苔藓斑（绿色）
  for (let i = 0; i < 5; i++) {
    const a = rnd() * TAU, rr = rnd() * r * 0.6;
    g.fillStyle = 'rgba(70, 120, 85, ' + (0.20 + rnd() * 0.20) + ')';
    g.beginPath();
    g.ellipse(Math.cos(a) * rr, Math.sin(a) * rr * 0.8, r * (0.10 + rnd() * 0.14), r * (0.07 + rnd() * 0.10), a, 0, TAU);
    g.fill();
  }

  // 外缘描边
  g.strokeStyle = 'rgba(140, 165, 150, 0.30)';
  g.lineWidth = Math.max(1.2, r * 0.035);
  g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
  g.closePath();
  g.stroke();

  spr = { canvas: c, dim, half: dim / 2 };
  if (_obstacleCache.size > 60) _obstacleCache.clear();
  _obstacleCache.set(key, spr);
  return spr;
}

/** 珊瑚：分枝结构 */
function buildCoralSprite(r, seed) {
  const key = 'coral|' + Math.round(r / 8) + '|' + (seed % 6);
  let spr = _obstacleCache.get(key);
  if (spr) return spr;

  const dim = Math.ceil(r * 3.0);
  const c = document.createElement('canvas');
  c.width = c.height = dim;
  const g = c.getContext('2d');
  g.translate(dim / 2, dim / 2);

  let s0 = (seed * 7919 + 104729) % 233280;
  const rnd = () => { s0 = (s0 * 9301 + 49297) % 233280; return s0 / 233280; };

  const hue = 330 + rnd() * 40;   // 粉红 / 橙红

  // 递归分枝
  const branch = (x, y, ang, len, w, depth) => {
    if (depth <= 0 || len < r * 0.08) return;
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;

    g.strokeStyle = `hsla(${hue}, ${55 + depth * 6}%, ${52 + depth * 5}%, 0.92)`;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(ex, ey);
    g.stroke();

    // 末端球
    if (depth <= 2) {
      g.fillStyle = `hsla(${hue}, 65%, 68%, 0.75)`;
      g.beginPath();
      g.arc(ex, ey, w * 0.85, 0, TAU);
      g.fill();
    }

    const spread = 0.42 + rnd() * 0.28;
    branch(ex, ey, ang - spread, len * (0.66 + rnd() * 0.12), w * 0.68, depth - 1);
    branch(ex, ey, ang + spread, len * (0.66 + rnd() * 0.12), w * 0.68, depth - 1);
    if (depth >= 3) branch(ex, ey, ang + (rnd() - 0.5) * 0.2, len * 0.72, w * 0.7, depth - 1);
  };

  // 从底部向上分叉 5 根主枝
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.42 + (rnd() - 0.5) * 0.2;
    branch(0, r * 0.35, a, r * (0.52 + rnd() * 0.2), r * 0.11, 4);
  }

  // 根部基石
  g.fillStyle = 'rgba(60, 45, 55, 0.55)';
  g.beginPath();
  g.ellipse(0, r * 0.5, r * 0.42, r * 0.16, 0, 0, TAU);
  g.fill();

  spr = { canvas: c, dim, half: dim / 2 };
  if (_obstacleCache.size > 60) _obstacleCache.clear();
  _obstacleCache.set(key, spr);
  return spr;
}

/** 取障碍物精灵（供 Pixi 后端转纹理）；海草/漩涡无静态精灵，返回 null */
export function getObstacleSprite(ob) {
  if (ob.kind === 'reef') return buildReefSprite(ob.r, ob.seed);
  if (ob.kind === 'coral') return buildCoralSprite(ob.r, ob.seed);
  if (ob.kind === 'urchin') return buildUrchinSprite(ob.r, ob.seed);
  return null;
}

/** 海胆：球形本体 + 放射尖刺（撞上会掉血） */
function buildUrchinSprite(r, seed) {
  const key = 'urchin|' + Math.round(r / 6) + '|' + (seed % 6);
  let spr = _obstacleCache.get(key);
  if (spr) return spr;

  const spikeLen = r * 0.85;
  const dim = Math.ceil((r + spikeLen) * 2.4);
  const c = document.createElement('canvas');
  c.width = c.height = dim;
  const g = c.getContext('2d');
  g.translate(dim / 2, dim / 2);

  let s0 = (seed * 6367 + 27644437) % 233280;
  const rnd = () => { s0 = (s0 * 9301 + 49297) % 233280; return s0 / 233280; };

  // 尖刺：两层（长刺 + 短刺），带渐变
  const spikeCount = 22;
  for (let layer = 0; layer < 2; layer++) {
    const len = layer === 0 ? spikeLen : spikeLen * 0.55;
    const n = layer === 0 ? spikeCount : spikeCount / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (layer ? 0.14 : 0) + rnd() * 0.12;
      const baseR = r * 0.82;
      const tipR = r + len * (0.75 + rnd() * 0.4);
      const px = Math.cos(a) * baseR, py = Math.sin(a) * baseR;
      const tx = Math.cos(a) * tipR, ty = Math.sin(a) * tipR;
      const nx = -Math.sin(a) * r * 0.16, ny = Math.cos(a) * r * 0.16;

      const sg = g.createLinearGradient(px, py, tx, ty);
      sg.addColorStop(0, layer ? '#3a1030' : '#5c1a3d');
      sg.addColorStop(0.6, layer ? '#6b2148' : '#8f2d55');
      sg.addColorStop(1, '#e8b04a');       // 刺尖泛黄，警示色
      g.fillStyle = sg;
      g.beginPath();
      g.moveTo(px + nx, py + ny);
      g.lineTo(tx, ty);
      g.lineTo(px - nx, py - ny);
      g.closePath();
      g.fill();
    }
  }

  // 球体
  const bg = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.15, 0, 0, r * 0.95);
  bg.addColorStop(0, '#a03a5e');
  bg.addColorStop(0.55, '#6d2040');
  bg.addColorStop(1, '#2e0a1c');
  g.fillStyle = bg;
  g.beginPath();
  g.arc(0, 0, r * 0.92, 0, TAU);
  g.fill();

  // 表面斑点
  for (let i = 0; i < 10; i++) {
    const a = rnd() * TAU, rr = rnd() * r * 0.7;
    g.fillStyle = 'rgba(255, 180, 120, ' + (0.10 + rnd() * 0.18) + ')';
    g.beginPath();
    g.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * (0.05 + rnd() * 0.07), 0, TAU);
    g.fill();
  }

  // 高光
  g.fillStyle = 'rgba(255, 210, 190, 0.30)';
  g.beginPath();
  g.ellipse(-r * 0.28, -r * 0.30, r * 0.26, r * 0.17, -0.5, 0, TAU);
  g.fill();

  spr = { canvas: c, dim, half: dim / 2 };
  if (_obstacleCache.size > 60) _obstacleCache.clear();
  _obstacleCache.set(key, spr);
  return spr;
}

// ============================================================
// 障碍物实体
// ============================================================
export class Obstacle {
  /**
   * @param kind 'reef' | 'coral' | 'kelp' | 'whirlpool'
   */
  constructor(kind, x, y, r) {
    this.kind = kind;
    this.x = x; this.y = y;
    this.r = r;
    this.seed = Math.floor(Math.random() * 1000);
    this.phase = Math.random() * TAU;
    this.dead = false;

    // 各类型的物理参数
    switch (kind) {
      case 'reef':
        this.solid = true;        // 硬碰撞
        this.damage = true;       // 撞击掉血
        this.slow = 1;            // 不减速（直接弹开）
        break;
      case 'coral':
        this.solid = false;
        this.damage = false;
        this.slow = 0.45;         // 穿过时大幅减速
        break;
      case 'kelp':
        this.solid = false;
        this.damage = false;
        this.slow = 0.60;
        this.wrap = true;         // 缠绕：持续拉扯
        break;
      case 'whirlpool':
        this.solid = false;
        this.damage = false;
        this.slow = 1;
        this.pull = 340;          // 向心吸力
        break;
      case 'urchin':
        this.solid = true;
        this.damage = true;       // 尖刺：撞上掉血
        this.slow = 1;
        break;
    }
  }

  get drawR() {
    // 海草和漩涡的视觉半径与碰撞半径不同
    if (this.kind === 'kelp') return this.r * 1.4;
    if (this.kind === 'whirlpool') return this.r * 1.6;
    if (this.kind === 'urchin') return this.r * 1.75;   // 含尖刺
    return this.r;
  }

  update(dt, t) {
    this.phase += dt;
  }

  render(ctx, t) {
    switch (this.kind) {
      case 'reef': this._renderReef(ctx); break;
      case 'coral': this._renderCoral(ctx); break;
      case 'kelp': this._renderKelp(ctx, t); break;
      case 'whirlpool': this._renderWhirlpool(ctx, t); break;
      case 'urchin': this._renderUrchin(ctx, t); break;
    }
  }

  _renderReef(ctx) {
    const spr = buildReefSprite(this.r, this.seed);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.seed * 0.01);
    ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.dim, spr.dim);
    ctx.restore();
  }

  _renderCoral(ctx) {
    const spr = buildCoralSprite(this.r, this.seed);
    ctx.save();
    ctx.translate(this.x, this.y);
    // 轻微摇曳
    ctx.rotate(Math.sin(this.phase * 0.9 + this.seed) * 0.045);
    ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.dim, spr.dim);
    ctx.restore();
  }

  _renderKelp(ctx, t) {
    const n = 7;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const baseAng = (i / n) * TAU + this.seed * 0.02;
      const sway = Math.sin(t * 1.1 + this.phase + i * 1.4) * 0.34;
      const len = this.r * (1.1 + 0.30 * Math.sin(this.phase * 0.7 + i));
      const bx = Math.cos(baseAng) * this.r * 0.28;
      const by = Math.sin(baseAng) * this.r * 0.28;

      ctx.strokeStyle = `hsla(${120 + i * 8}, 42%, ${28 + i * 2}%, 0.72)`;
      ctx.lineWidth = Math.max(2, this.r * 0.10);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      let px = bx, py = by;
      for (let k = 1; k <= 4; k++) {
        const kk = k / 4;
        const ang = baseAng + sway * kk;
        px += Math.cos(ang) * (len / 4);
        py += Math.sin(ang) * (len / 4);
        ctx.lineTo(px, py);
      }
      ctx.stroke();

      // 叶片
      ctx.fillStyle = `hsla(${115 + i * 8}, 38%, 34%, 0.45)`;
      ctx.beginPath();
      ctx.ellipse(px, py, this.r * 0.13, this.r * 0.26, baseAng + sway, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _renderUrchin(ctx, t) {
    const spr = buildUrchinSprite(this.r, this.seed);
    ctx.save();
    ctx.translate(this.x, this.y);
    // 缓慢自转 + 轻微脉动（活物感）
    ctx.rotate(t * 0.25 + this.seed * 0.01);
    const pulse = 1 + Math.sin(t * 1.6 + this.phase) * 0.045;
    ctx.scale(pulse, pulse);
    ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.dim, spr.dim);
    ctx.restore();
  }

  _renderWhirlpool(ctx, t) {
    const R = this.drawR;
    ctx.save();
    ctx.translate(this.x, this.y);

    // 中心暗洞
    const g = ctx.createRadialGradient(0, 0, R * 0.05, 0, 0, R);
    g.addColorStop(0, 'rgba(2, 10, 18, 0.75)');
    g.addColorStop(0.45, 'rgba(8, 30, 48, 0.42)');
    g.addColorStop(1, 'rgba(8, 30, 48, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();

    // 旋转的螺旋臂
    ctx.strokeStyle = 'rgba(150, 220, 255, 0.30)';
    ctx.lineWidth = Math.max(1.4, R * 0.028);
    ctx.lineCap = 'round';
    const arms = 4;
    for (let a = 0; a < arms; a++) {
      const baseA = (a / arms) * TAU + t * 1.6;
      ctx.beginPath();
      for (let k = 0; k <= 18; k++) {
        const kk = k / 18;
        const ang = baseA + kk * 3.4;
        const rr = R * (0.12 + kk * 0.86);
        const px = Math.cos(ang) * rr;
        const py = Math.sin(ang) * rr;
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // 中心亮点
    drawGlow(ctx, 0, 0, R * 0.5, 'rgba(140,220,255,ALPHA)', 0.20);
    ctx.restore();
  }
}

// ============================================================
// 障碍物生成
// ============================================================

/** 环绕玩家生成一圈障碍物（世界坐标） */
export function spawnObstacles(actId, playerX, playerY) {
  const list = [];
  // 每幕的障碍物配比
  const mix = actId === 1
    ? [['reef', 4], ['kelp', 3], ['coral', 2], ['urchin', 1]]
    : actId === 2
      ? [['reef', 3], ['coral', 3], ['kelp', 2], ['whirlpool', 1], ['urchin', 2]]
      : [['reef', 3], ['whirlpool', 2], ['coral', 2], ['kelp', 1], ['urchin', 3]];

  for (const entry of mix) {
    const [kind, count] = entry;
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const d = rand(260, 900);
      let r;
      if (kind === 'reef') r = rand(34, 68);
      else if (kind === 'coral') r = rand(26, 44);
      else if (kind === 'kelp') r = rand(32, 56);
      else if (kind === 'urchin') r = rand(22, 38);
      else r = rand(70, 110);

      list.push(new Obstacle(
        kind,
        playerX + Math.cos(a) * d,
        playerY + Math.sin(a) * d,
        r
      ));
    }
  }
  return list;
}

/** 障碍物远离玩家后，在环形范围内重新投放 */
export function recycleObstacle(ob, playerX, playerY) {
  const a = rand(0, TAU);
  const d = rand(620, 980);
  ob.x = playerX + Math.cos(a) * d;
  ob.y = playerY + Math.sin(a) * d;
  ob.seed = Math.floor(Math.random() * 1000);
  ob.phase = Math.random() * TAU;
}

// ============================================================
// 碰撞与效果
// ============================================================
/**
 * 玩家与所有障碍物的交互
 * @returns {{ hit: Obstacle|null, slowMul: number, pullX: number, pullY: number }}
 */
export function resolveObstacles(player, obstacles, dt) {
  let slowMul = 1;
  const pull = { x: 0, y: 0 };
  let hit = null;

  for (const ob of obstacles) {
    const dx = player.x - ob.x;
    const dy = player.y - ob.y;
    const dist = Math.hypot(dx, dy) || 1;
    const pr = player.radius;

    if (ob.kind === 'reef') {
      // 硬碰撞：把玩家推出岩体（不掉血）
      const minDist = ob.r * 0.86 + pr * 0.72;
      if (dist < minDist) {
        const nx = dx / dist, ny = dy / dist;
        const push = minDist - dist;
        player.x += nx * push;
        player.y += ny * push;
        hit = ob;
      }
    } else if (ob.kind === 'urchin') {
      // 海胆：尖刺扎人 —— 推开的瞬间判定伤害
      const minDist = ob.r * 0.92 + pr * 0.78;
      if (dist < minDist) {
        const nx = dx / dist, ny = dy / dist;
        const push = minDist - dist;
        player.x += nx * push;
        player.y += ny * push;
        hit = ob;
      }
    } else if (ob.kind === 'coral') {
      // 软碰撞：靠近就减速
      const range = ob.r * 1.1 + pr;
      if (dist < range) {
        const k = 1 - dist / range;
        slowMul = Math.min(slowMul, 1 - k * (1 - ob.slow));
      }
    } else if (ob.kind === 'kelp') {
      // 缠绕：减速 + 轻微拉扯向中心
      const range = ob.r * 1.5 + pr;
      if (dist < range) {
        const k = 1 - dist / range;
        slowMul = Math.min(slowMul, 1 - k * (1 - ob.slow));
        pull.x -= (dx / dist) * 40 * k;
        pull.y -= (dy / dist) * 40 * k;
      }
    } else if (ob.kind === 'whirlpool') {
      // 漩涡：向心吸力，越近越强
      const range = ob.r * 1.7;
      if (dist < range) {
        const k = 1 - dist / range;
        const f = ob.pull * k * k;
        pull.x -= (dx / dist) * f;
        pull.y -= (dy / dist) * f;
      }
    }
  }

  return { hit, slowMul, pullX: pull.x, pullY: pull.y };
}

/** 阻挡鱼的移动（大鱼绕礁石） */
export function pushOutOfReefs(entity, obstacles) {
  for (const ob of obstacles) {
    if (ob.kind !== 'reef') continue;
    const dx = entity.x - ob.x;
    const dy = entity.y - ob.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minDist = ob.r * 0.86 + (entity.size || entity.radius || 10) * 0.7;
    if (dist < minDist) {
      const nx = dx / dist, ny = dy / dist;
      entity.x = ob.x + nx * minDist;
      entity.y = ob.y + ny * minDist;
      // 沿切线滑走，避免卡死
      const tx = -ny, ty = nx;
      const vdot = (entity.vx || 0) * nx + (entity.vy || 0) * ny;
      if (vdot < 0) {
        entity.vx = (entity.vx || 0) - vdot * nx * 1.4 + tx * 30;
        entity.vy = (entity.vy || 0) - vdot * ny * 1.4 + ty * 30;
      }
    }
  }
}