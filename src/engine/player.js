// ============================================================
// 玩家（鲲）：交互手感核心
// - 鼠标/键盘独立模式（末次输入设备接管，PlayScene 换算鼠标世界坐标）
// - 无边界世界：坐标即世界坐标，永不撞墙
// - 鱼永不停摆：无输入时沿当前朝向慢速巡游
// - 冲刺：1.6x 速度 0.35s，冷却 1.2s，冲刺中碰撞半径 x0.8
// ============================================================
import { FORMS } from '../data/acts.js';
import { renderKun, smoothAngle } from './fishrender.js';

const BASE_SIZE = 24;
const CRUISE = 120;   // 巡游速度：鱼从不停下
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Player {
  constructor(formIndex, hero) {
    this.formIndex = formIndex;
    // 角色属性倍率（未指定时用均衡默认值）
    this.hero = hero || null;
    this.heroStats = (hero && hero.stats) || { speed: 1, size: 1, growth: 1, dashCd: 1 };
    this.x = 480; this.y = 300;
    this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.tailPhase = 0;
    this.invincible = 0;
    this.mouthOpen = 0;
    this.mouthTarget = 0;
    // 冲刺
    this.dashCd = 0;
    this.dashLeft = 0;
    // 道具效果
    this.speedBoostT = 0;
    this.shield = false;
    // 吃鱼即时成长
    this.innerScale = 1;
    this.growPulse = 0;
    // 撞击僵直
    this.stun = 0;
    this.squash = 0;      // 受击形变（0~1）
  }

  get form() { return FORMS[this.formIndex]; }

  /** 半径：形态基准 × 关内成长 × 等级膨胀 × 角色体型倍率
   *  每升一级 +14%，Lv.0→Lv.13 累计约 5.5 倍体型差（幼体 → 巨兽） */
  /** 目标半径（等级决定），实际半径平滑追踪它 */
  get targetRadius() {
    const grow = this.innerScale || 1;
    const lv = this.sizeLevel || 0;
    return BASE_SIZE * this.form.sizeMul * grow * Math.pow(1.26, lv) * this.heroStats.size;
  }
  get radius() {
    // displayRadius 由 update() 平滑逼近 targetRadius，避免瞬间跳变
    return this.displayRadius || this.targetRadius;
  }

  /** 发育阶段（0~4）：幼体 / 少年 / 成年 / 巨兽 / 完全体，供绘制层做形态差异 */
  get stage() {
    const lv = this.sizeLevel || 0;
    if (lv <= 1) return 0;
    if (lv <= 3) return 1;
    if (lv <= 6) return 2;
    if (lv <= 9) return 3;
    return 4;
  }
  /** 冲刺中碰撞半径 x0.8（可穿缝隙） */
  get hitRadius() { return this.radius * (this.dashLeft > 0 ? 0.8 : 1); }
  get maxSpeed() {
    let s = this.form.speed * this.heroStats.speed;
    if (this.speedBoostT > 0) s *= 1.3;
    if (this.dashLeft > 0) s *= 1.6;
    if (this.stun > 0) s *= 0.35;        // 被撞后短暂失控
    return s;
  }
  get mouthPos() {
    return {
      x: this.x + Math.cos(this.angle) * this.radius * 1.15,
      y: this.y + Math.sin(this.angle) * this.radius * 1.15,
    };
  }

  /** 冲刺请求。返回是否成功触发 */
  queueDash() {
    if (this.dashCd <= 0) {
      this.dashLeft = 0.35;
      this.dashCd = 1.2 * this.heroStats.dashCd;
      return true;
    }
    return false;
  }

  update(dt, input, fx) {
    const p = this;
    p.invincible = Math.max(0, p.invincible - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.stun = Math.max(0, (p.stun || 0) - dt);
    // 体型平滑过渡：每帧向目标半径插值（约 0.5s 长到位）
    const target = p.targetRadius;
    if (!p.displayRadius) p.displayRadius = target;
    p.displayRadius += (target - p.displayRadius) * clamp(dt * 4.5, 0, 1);
    p.growPulse = Math.max(0, (p.growPulse || 0) - dt * 3);
    p.squash = Math.max(0, (p.squash || 0) - dt * 4);
    p.dashLeft = Math.max(0, p.dashLeft - dt);
    p.speedBoostT = Math.max(0, p.speedBoostT - dt);

    // 冲刺拖尾（尾迹在航向反方向）
    if (p.dashLeft > 0 && fx) {
      const bx = p.x - Math.cos(p.angle) * p.radius;
      const by = p.y - Math.sin(p.angle) * p.radius;
      fx.list.push({
        x: bx, y: by + (Math.random() - 0.5) * p.radius,
        vx: -Math.cos(p.angle) * 60, vy: -Math.sin(p.angle) * 60,
        life: 0.35, maxLife: 0.35, r: 3 + Math.random() * 3, color: 'rgba(255,215,120,0.7)',
      });
    }

    let tvx, tvy, k;
    if (input.mode === 'kb') {
      // ---- 键盘模式：完全无视鼠标 ----
      const kb = {
        x: (input.keys['arrowright'] || input.keys['d'] ? 1 : 0) - (input.keys['arrowleft'] || input.keys['a'] ? 1 : 0),
        y: (input.keys['arrowdown'] || input.keys['s'] ? 1 : 0) - (input.keys['arrowup'] || input.keys['w'] ? 1 : 0),
      };
      if (kb.x || kb.y) {
        const len = Math.hypot(kb.x, kb.y);
        tvx = (kb.x / len) * p.maxSpeed;
        tvy = (kb.y / len) * p.maxSpeed;
      } else {
        // 松键巡游：沿朝向缓速前进，鱼不停摆
        tvx = Math.cos(p.angle) * CRUISE;
        tvy = Math.sin(p.angle) * CRUISE;
      }
      k = 8;
    } else {
      // ---- 鼠标模式：完全无视键盘，追世界坐标目标 ----
      const t = input.mouseWorld;
      const dx = t.x - p.x, dy = t.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 10) {
        const sc = clamp(d / 70, 0.22, 1);
        tvx = (dx / d) * p.maxSpeed * sc;
        tvy = (dy / d) * p.maxSpeed * sc;
      } else {
        // 光标贴身：绕光标缓游盘旋
        tvx = Math.cos(p.angle) * CRUISE * 0.45;
        tvy = Math.sin(p.angle) * CRUISE * 0.45;
      }
      k = 6;
    }

    // 僵直期间操控力大幅减弱，让撞击冲量自然衰减
    const ctrl = p.stun > 0 ? 0.18 : 1;

    // ---- 水流：合入「目标速度」，而不是直接累加到当前速度 ----
    // 直接加速度会被下面的插值当成误差拉回去，顺流几乎无感；
    // 合入目标速度才能做出「顺流游得更快、逆流顶着游」的手感。
    const fb = p.flowBias;
    if (fb && (fb.x || fb.y)) {
      tvx += fb.x;
      tvy += fb.y;
      // 但总速不能无限膨胀：水流只能把目标速度抬到 1.7 倍上限
      const tLen = Math.hypot(tvx, tvy);
      const tCap = p.maxSpeed * 1.7;
      if (tLen > tCap) { tvx = tvx / tLen * tCap; tvy = tvy / tLen * tCap; }
    }

    p.vx += (tvx - p.vx) * clamp(dt * k * ctrl, 0, 1);
    p.vy += (tvy - p.vy) * clamp(dt * k * ctrl, 0, 1);
    // 无操控时的水阻
    if (p.stun > 0) {
      p.vx *= (1 - dt * 2.2);
      p.vy *= (1 - dt * 2.2);
    }

    // 无边界：自由游动
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // 头朝移动方向（背视）
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 8) p.angle = smoothAngle(p.angle, Math.atan2(p.vy, p.vx), clamp(dt * 7, 0, 1));
    p.tailPhase += dt * (6 + sp * 0.04);

    // 嘴开合动画
    p.mouthOpen += (p.mouthTarget - p.mouthOpen) * clamp(dt * 10, 0, 1);
  }

  render(ctx, t) { renderKun(ctx, this, t); }
}
