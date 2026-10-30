// ============================================================
// Boss 战（俯视视角）：食气啃噬通用模型
// 河伯（单阶段·教学）/ 巨鳌（单阶段·绕背）/ 蛟龙（三阶段终战）
// 机制全部复用现有系统：spawn / chase AI / 屏幕特效 / 预警圈
// ============================================================
import { drawGlow, drawFishDorsal, smoothAngle } from './fishrender.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const BOSSES = {
  hebo: {
    name: '河伯', title: '黄河水神', bites: 4,
    r: 62, speed: 55, color: '#37655e', belly: '#7fa89b', fin: '#1e3f38',
    minionEvery: 3.5, minionTypes: ['xiyu', 'tiaoyu'], maxMinions: 4,
  },
  ao: {
    name: '巨鳌', title: '驮山之龟', bites: 5,
    r: 76, speed: 32, color: '#4e6151', belly: '#8ba583', fin: '#2f3d31',
    minionEvery: 4.0, minionTypes: ['qiyu'], maxMinions: 3,
  },
  jiaolong: {
    name: '蛟龙', title: '北冥之主', bites: 6,
    r: 30, speed: 95, color: '#2e4d66', belly: '#7fa8c4', fin: '#1a3348',
    minionEvery: 3.2, minionTypes: ['mingyu', 'shuihu'], maxMinions: 4,
  },
};

export class Boss {
  constructor(kind) {
    const cfg = BOSSES[kind];
    this.kind = kind;
    this.cfg = cfg;
    this.name = cfg.name;
    this.title = cfg.title;
    this.hp = cfg.bites;
    this.maxHp = cfg.bites;
    this.r = cfg.r;

    // 战场锚点（由 PlayScene 设置：Boss 入场时的玩家位置）
    this.arena = { x: 0, y: 0 };
    this.x = 0;
    this.y = 0;
    this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.alpha = 1;
    this.hitFlash = 0;
    this.state = 'active';
    this.deathT = 0;
    this.minionTimer = cfg.minionEvery;
    this.minionCount = 0;
    this.dashTimer = 2.2;
    this.dashLeft = 0;
    this.t = 0;

    // 蛟龙专属
    this.trail = [];
    if (kind === 'jiaolong') { this.trailMax = 26; }
    this.phase = 1;
    this.dropTimer = 2.5;
    this.currentPushX = 0;
    this.currentFlip = 4;
    this.subState = 'sweep';
    this.subTimer = 0;
    this.targetX = 0; this.targetY = 0;
    this._eruptHit = false;
  }

  get hpFrac() { return this.hp / this.maxHp; }

  _smoothAngle(dt, tx, ty, rate = 5) {
    if (Math.hypot(tx, ty) < 1) return;
    this.angle = smoothAngle(this.angle, Math.atan2(ty, tx), clamp(dt * rate, 0, 1));
  }

  _updatePhase(game) {
    if (this.kind !== 'jiaolong' || this.state !== 'active') return;
    const f = this.hpFrac;
    const newPhase = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      game.audio.bossRoar();
      game.particles.burst(this.x, this.y, '#7fdfff', 30, 260);
      game.toast(this.phase === 2 ? '蛟龙 · 唤潮' : '蛟龙 · 潜地突袭');
    }
  }

  update(dt, game) {
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const player = game.player;
    if (this.state === 'dying') {
      this.deathT += dt;
      this.alpha = Math.max(0, 1 - this.deathT / 1.6);
      if (Math.random() < dt * 8) game.particles.burst(this.x + (Math.random() - 0.5) * this.r * 2, this.y + (Math.random() - 0.5) * this.r, '#8fd3ff', 4, 60);
      return;
    }
    this._updatePhase(game);

    // 护卫鱼
    this.minionTimer -= dt;
    if (this.minionTimer <= 0 && this.minionCount < this.cfg.maxMinions && this.subState !== 'submerge') {
      this.minionTimer = this.cfg.minionEvery;
      const type = this.cfg.minionTypes[Math.floor(Math.random() * this.cfg.minionTypes.length)];
      game.spawnMinion(type, this.x, this.y);
    }

    const W = game.W, H = game.H;
    if (this.kind === 'hebo') this._hebo(dt, player, W, H);
    else if (this.kind === 'ao') this._ao(dt, player, W, H);
    else this._jiaolong(dt, player, W, H, game);

    // 锚定战场：Boss 不追出锚点周围一屏
    this.x = clamp(this.x, this.arena.x - W / 2 + this.r, this.arena.x + W / 2 - this.r);
    this.y = clamp(this.y, this.arena.y - H / 2 + this.r + 30, this.arena.y + H / 2 - this.r - 20);
  }

  _hebo(dt, player, W, H) {
    this.dashTimer -= dt;
    if (this.dashTimer <= 0 && this.dashLeft <= 0) {
      this.dashTimer = 2.6;
      this.dashLeft = 0.9;
      if (player) this.vx = Math.sign(player.x - this.x) * this.cfg.speed * 2.4;
    }
    if (this.dashLeft > 0) {
      this.dashLeft -= dt;
    } else {
      this.vx += (Math.sin(this.t * 0.5) * this.cfg.speed - this.vx) * clamp(dt * 1.2, 0, 1);
    }
    if (player) this.vy = clamp((player.y - this.y) * 0.4, -30, 30);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this._smoothAngle(dt, this.vx, this.vy, 3.5);
  }

  _ao(dt, player, W, H) {
    this.vx += (Math.sin(this.t * 0.3) * this.cfg.speed - this.vx) * clamp(dt * 0.8, 0, 1);
    if (player) {
      this.vy = clamp((player.y - this.y) * 0.3, -22, 22);
      // 龟壳缓慢转向玩家（绕背窗口）
      this._smoothAngle(dt, player.x - this.x, player.y - this.y, 1.1);
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  _jiaolong(dt, player, W, H, game) {
    const sp = this.cfg.speed;
    if (this.phase === 3 && this.subState !== 'sweep') {
      // ---- P3 潜地突袭 ----
      this.subTimer -= dt;
      this.currentPushX = 0;
      if (this.subState === 'submerge') {
        this.alpha += (0.1 - this.alpha) * clamp(dt * 6, 0, 1);
        if (player) { this.targetX = player.x; this.targetY = player.y; }
        if (this.subTimer <= 0) { this.subState = 'warning'; this.subTimer = 0.8; }
      } else if (this.subState === 'warning') {
        this.alpha += (0.1 - this.alpha) * clamp(dt * 6, 0, 1);
        if (this.subTimer <= 0) {
          this.x = this.targetX;
          this.y = this.targetY + 130;
          this.vx = 0; this.vy = -620;
          this.angle = -Math.PI / 2;
          this.subState = 'erupt';
          this.subTimer = 0.45;
          game.audio.bossRoar();
          game.particles.burst(this.x, this.y + 60, '#7fdfff', 24, 240);
          game.camera.addShake(10);
        }
      } else if (this.subState === 'erupt') {
        this.alpha += (1 - this.alpha) * clamp(dt * 10, 0, 1);
        this.y += this.vy * dt;
        this.vy *= 0.9;
        if (this.subTimer > 0.3 && !this._eruptHit && player) {
          const d = Math.hypot(player.x - this.x, player.y - this.y);
          if (d < 85) game.hurtPlayer(null, 'erupt');
          this._eruptHit = true;
        }
        if (this.subTimer <= 0) {
          this.subState = 'sweep';
          this.subTimer = 1.4;
          this.vx = (Math.random() < 0.5 ? -1 : 1) * sp * 2.2;
          this.vy = 0;
        }
      }
      if (this.subState === 'sweep') {
        this.subTimer -= dt;
        this.alpha += (1 - this.alpha) * clamp(dt * 6, 0, 1);
        this.x += this.vx * dt;
        this.vy = Math.sin(this.t * 3) * 60;
        this.y += this.vy * dt;
        if (this.subTimer <= 0) { this.subState = 'submerge'; this.subTimer = 0.7; }
      }
    } else {
      // ---- P1 缠斗 / P2 唤潮 / P3 sweep ----
      this.dashTimer -= dt;
      const dashEvery = this.phase === 1 ? 2.2 : 1.7;
      if (this.dashTimer <= 0 && this.dashLeft <= 0) {
        this.dashTimer = dashEvery;
        this.dashLeft = 0.8;
        if (player) {
          const d = Math.max(1, Math.hypot(player.x - this.x, player.y - this.y));
          this.vx = ((player.x - this.x) / d) * sp * 2.6;
          this.vy = ((player.y - this.y) / d) * sp * 2.6;
        }
      }
      if (this.dashLeft > 0) {
        this.dashLeft -= dt;
      } else {
        this.vx += (Math.sin(this.t * 0.7) * sp - this.vx) * clamp(dt * 1.4, 0, 1);
        if (player) this.vy += (clamp((player.y - this.y) * 0.6, -60, 60) - this.vy) * clamp(dt * 1.4, 0, 1);
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.alpha += (1 - this.alpha) * clamp(dt * 6, 0, 1);

      // P2+: 唤潮 —— 天降雨击（俯视：预警圈 → 落水点 AOE，锚定战场内）
      if (this.phase >= 2) {
        this.dropTimer -= dt;
        if (this.dropTimer <= 0) {
          this.dropTimer = 2.5;
          for (let i = 0; i < 3; i++) {
            game.hazards.push({
              type: 'drop',
              x: this.arena.x - W / 2 + 60 + Math.random() * (W - 120),
              y: this.arena.y - H / 2 + 70 + Math.random() * (H - 150),
              r: 12, telegraph: 0.9,
            });
          }
        }
        this.currentFlip -= dt;
        if (this.currentFlip <= 0) { this.currentFlip = 4; this._pushDir = -(this._pushDir || 1); }
        this.currentPushX = (this._pushDir || 1) * 90;
      } else {
        this.currentPushX = 0;
      }
    }

    this._smoothAngle(dt, this.vx, this.vy, 6);
    // 身体轨迹（蛇形分段）
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > (this.trailMax || 22)) this.trail.pop();
  }

  // 啃噬判定：巨鳌正面（朝向 ±69°）龟甲挡下
  canBiteAt(px, py) {
    if (this.kind !== 'ao') return true;
    const d = Math.atan2(py - this.y, px - this.x) - this.angle;
    const norm = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return Math.abs(norm) > 1.2;
  }

  onBitten(game, px, py) {
    if (this.state !== 'active') return false;
    if (!this.canBiteAt(px, py)) { game.audio.clang(); game.toast('龟甲难破 · 绕背而噬'); return false; }
    this.hp--;
    this.hitFlash = 0.5;
    this.vx = Math.sign(this.x - px) * 260;
    game.audio.bossHit();
    game.audio.bite();
    game.camera.addShake(9);
    game.hitstop = 0.1;
    game.particles.burst(px, py, '#ffd75e', 20, 240);
    if (this.hp <= 0) {
      this.state = 'dying';
      this.deathT = 0;
      game.audio.splash();
    } else {
      game.audio.bossRoar();
    }
    return true;
  }

  render(ctx, t) {
    const a = this.alpha;
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = a;

    if (this.kind === 'jiaolong') this._renderJiaolong(ctx, t);
    else if (this.kind === 'ao') this._renderAo(ctx, t);
    else this._renderHebo(ctx, t);

    if (this.hitFlash > 0) {
      ctx.globalAlpha = a * this.hitFlash * 1.4;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _renderHebo(ctx, t) {
    const s = this.r;
    const pal = { body: this.cfg.color, belly: this.cfg.belly, fin: this.cfg.fin };
    // 身下光晕（水神感）
    drawGlow(ctx, this.x, this.y, s * 2.2, 'rgba(150,220,200,ALPHA)', 0.18 * this.alpha);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    // 巨型背视鱼身
    drawFishDorsal(ctx, s * 1.15, pal, Math.sin(this.t * 3) * 4, { mouth: this.dashLeft > 0 ? 0.7 : 0.1 });
    // 河伯长须（两根向前飘）
    ctx.strokeStyle = '#cfe3d8';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 1.5, side * s * 0.2);
      ctx.quadraticCurveTo(s * 2.2, side * s * 0.55 + Math.sin(this.t * 2 + side) * 6, s * 2.7, side * s * 0.8 + Math.sin(this.t * 1.6 + side * 2) * 8);
      ctx.stroke();
    }
    // 头冠（背视小金冠）
    ctx.fillStyle = '#ffd77a';
    ctx.beginPath();
    ctx.moveTo(s * 0.55, -s * 0.18);
    ctx.lineTo(s * 0.85, -s * 0.26);
    ctx.lineTo(s * 0.8, 0);
    ctx.lineTo(s * 0.85, s * 0.26);
    ctx.lineTo(s * 0.55, s * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _renderAo(ctx, t) {
    const s = this.r;
    const pal = this.cfg;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    // 四鳍（划水）
    ctx.fillStyle = pal.fin;
    const paddle = Math.sin(this.t * 3);
    for (const [fx, fy] of [[0.42, -0.78], [0.42, 0.78], [-0.55, -0.72], [-0.55, 0.72]]) {
      ctx.save();
      ctx.translate(fx * s, fy * s * 0.8);
      ctx.rotate((fy > 0 ? 1 : -1) * (0.5 + paddle * 0.4) * (fx > 0 ? 1 : 0.8));
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.34, s * 0.16, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // 尾
    ctx.beginPath();
    ctx.ellipse(-s * 1.02, 0, s * 0.22, s * 0.14, 0, 0, TAU);
    ctx.fill();
    // 龟壳（六边纹理）
    ctx.fillStyle = pal.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.86, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = pal.belly;
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      for (let j = -1; j <= 1; j++) {
        const hx = i * s * 0.34, hy = j * s * 0.5;
        if (Math.hypot(hx / s, hy / s) > 0.8) continue;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * TAU;
          const px = hx + Math.cos(a) * s * 0.15, py = hy + Math.sin(a) * s * 0.15;
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    // 壳沿
    ctx.strokeStyle = pal.belly;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.86, 0, 0, TAU);
    ctx.stroke();
    // 头（前方）
    ctx.fillStyle = pal.fin;
    ctx.beginPath();
    ctx.ellipse(s * 0.98, 0, s * 0.3, s * 0.24, 0, 0, TAU);
    ctx.fill();
    // 双眼
    ctx.fillStyle = '#ffd77a';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * 1.08, side * s * 0.14, s * 0.06, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _renderJiaolong(ctx, t) {
    const s = this.cfg.r;
    // 蛇形身体（分段，暗水中加辉光提对比）
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      const frac = 1 - i / Math.max(1, this.trail.length);
      const r = s * (0.4 + frac * 0.6);
      if (i % 4 === 0) drawGlow(ctx, p.x, p.y, r * 2.6, 'rgba(120,200,255,ALPHA)', 0.16 * this.alpha);
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r);
      g.addColorStop(0, this.cfg.belly);
      g.addColorStop(1, this.cfg.color);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      // 背鳍（垂直于身体方向的小刺）
      if (i % 2 === 0 && i > 1) {
        const prev = this.trail[i - 1] || p;
        const dx = p.x - prev.x, dy = p.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        ctx.fillStyle = this.cfg.fin;
        ctx.beginPath();
        ctx.moveTo(p.x + nx * r, p.y + ny * r);
        ctx.lineTo(p.x + nx * r * 1.65, p.y + ny * r * 1.65);
        ctx.lineTo(p.x - nx * r * 0.3, p.y - ny * r * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.x - nx * r, p.y - ny * r);
        ctx.lineTo(p.x - nx * r * 1.65, p.y - ny * r * 1.65);
        ctx.lineTo(p.x + nx * r * 0.3, p.y + ny * r * 0.3);
        ctx.closePath();
        ctx.fill();
      }
    }
    // 头（朝向 angle）
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    const hs = s * 1.25;
    const g = ctx.createRadialGradient(0, 0, hs * 0.3, 0, 0, hs);
    g.addColorStop(0, this.cfg.belly);
    g.addColorStop(1, this.cfg.color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, hs * 1.15, hs * 0.8, 0, 0, TAU);
    ctx.fill();
    // 双角（从头两侧向后弯）
    ctx.strokeStyle = '#d8e6f0';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-hs * 0.2, side * hs * 0.5);
      ctx.quadraticCurveTo(-hs * 0.9, side * hs * 0.95, -hs * 1.3, side * hs * 0.7);
      ctx.stroke();
    }
    // 双须（向前）
    ctx.lineWidth = 2.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hs * 0.85, side * hs * 0.22);
      ctx.quadraticCurveTo(hs * 1.5, side * hs * 0.5 + Math.sin(this.t * 3 + side) * 4, hs * 1.95, side * hs * 0.75 + Math.sin(this.t * 2.4 + side * 2) * 6);
      ctx.stroke();
    }
    // 红眼（背视两侧）
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#ff5252';
      ctx.beginPath();
      ctx.arc(hs * 0.42, side * hs * 0.38, hs * 0.14, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#7a1000';
      ctx.beginPath();
      ctx.arc(hs * 0.47, side * hs * 0.38, hs * 0.06, 0, TAU);
      ctx.fill();
    }
    // 张嘴（冲刺/突袭时）：吻端向前张开的 V 形开口
    if (this.dashLeft > 0 || this.subState === 'erupt') {
      ctx.fillStyle = 'rgba(10,6,4,0.85)';
      ctx.beginPath();
      ctx.moveTo(hs * 1.0, 0);
      ctx.lineTo(hs * 1.22, -hs * 0.42);
      ctx.quadraticCurveTo(hs * 1.36, 0, hs * 1.22, hs * 0.42);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
