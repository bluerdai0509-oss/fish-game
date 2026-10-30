// ============================================================
// 核心玩法场景：吃鱼成长 / 冲刺 / 张嘴吞噬 / 道具 / Boss 食气战
// ============================================================
import { Scene } from '../engine/scenes.js';
import { getLevel, getAct, nextLevel, needsActIntro } from '../engine/levels.js';
import { FORMS, FISH_TYPES } from '../data/acts.js';
import { Player } from '../engine/player.js';
import {
  Fish, Item, ParticleSystem, BubbleField,
  drawWater, SHAPE_HIT, effRadius,
} from '../engine/entities.js';
import { Boss } from '../engine/bosses.js';
import { spawnObstacles, recycleObstacle, resolveObstacles, pushOutOfReefs } from '../engine/obstacles.js';
import { audio } from '../engine/audio.js';
import { ui } from '../engine/ui.js';
import { CurrentField, drawCurrentLines, sampleStreaks } from '../engine/current.js';
import { spawnZones, recycleZone, zoneForceAt, zoneTexture } from '../engine/zones.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const ACT_SHORT = { 1: '江河', 2: '湖海', 3: '北冥' };

export class PlayScene extends Scene {
  enter({ levelId, resumeHalf = false }) {
    const app = this.app;
    const run = app.run;
    this.cfg = getLevel(levelId);
    this.act = getAct(this.cfg.act);
    run.levelId = levelId;
    const { W, H } = app;

    // ---- 关卡起始状态（重开亦然：形态回退到本关起始，生命重置）----
    if (resumeHalf) {
      this.halfEvolved = true;
      this.growth = Math.floor(this.cfg.targetGrowth / 2) * this.LV_NEED;
      this.sizeLevel = Math.floor(this.cfg.targetGrowth / 2);
    } else {
      if (this.player) this.player.innerScale = 1;
      this.halfEvolved = false;
      run.formIndex = this.cfg.startForm;
      run.lives = 3;
      this.growth = 0;
    }
    // 体型等级：本关总量 = 基数(随幕递增) ，均分到 requiredLevel 级
    // 这样每关总时长接近，但级数不同；每升一级立刻变大
    const actBase = 1400 + this.cfg.act * 600;
    this.LV_NEED = Math.max(100, Math.round(actBase / (this.cfg.requiredLevel || 3)));
    if (!resumeHalf) this.sizeLevel = 0;

    // ---- 实体（世界坐标，玩家出生在原点，摄像机跟随）----
    this.player = new Player(run.formIndex, run.hero);
    this.player.x = 0; this.player.y = 0;
    this.fishes = [];
    this.items = [];
    this.hazards = [];
    this.particles = new ParticleSystem();
    this.bubbles = new BubbleField();
    this.obstacles = spawnObstacles(this.cfg.act, 0, 0);

    // ---- 水流场：纯视觉动画（流线方向感），不产生任何物理效果 ----
    this.current = new CurrentField(this.cfg.act);

    // ---- 特殊物理区域：只有进入这些区域才受力 ----
    this.zones = spawnZones(this.cfg.act, 0, 0);
    this.zoneSpeed = 0;
    this.zoneAlign = 0;
    this.zoneLabel = null;

    // ---- Boss 状态 ----
    this.boss = null;
    this.bossStarted = false;
    this.bossFight = false;
    this.bossIntroT = 0;
    this.bossDone = false;
    this.switching = false;
    this.qi = 0;
    this.seenLore = {};     // 已展示过的山海经图鉴

    // ---- 计时/流程 ----
    this.t = 0;
    this.bannerT = 2.2;
    this.hurtFlash = 0;
    this.hitstop = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.done = false;

    // ---- 初始鱼群：全部保留（含大鱼），只用距离保证开局安全 ----
    for (let i = 0; i < 26; i++) {
      this.spawnFish(true);
      const f = this.fishes[this.fishes.length - 1];
      if (!f) continue;
      // 比玩家大的鱼：推远到 380 屏外，让玩家看得见威胁但不至于开局就撞死
      if (f.size > this.player.radius * 1.15) {
        const a = Math.atan2(f.y - this.player.y, f.x - this.player.x);
        const d = rand(520, 780);
        f.x = this.player.x + Math.cos(a) * d;
        f.y = this.player.y + Math.sin(a) * d;
      }
    }
    // ---- 道具（环绕分布）----
    const it = this.cfg.items;
    for (let i = 0; i < (it.lingzhu || 0); i++) this.items.push(new Item('lingzhu', ...this._ringPos(200, 600)));
    for (let i = 0; i < (it.guijia || 0); i++) this.items.push(new Item('guijia', ...this._ringPos(200, 600)));
    if (Math.random() < (it.xiancao || 0)) this.items.push(new Item('xiancao', ...this._ringPos(200, 600)));

    // ---- 摄像机归位 + 音频 / UI ----
    app.camera.reset();
    app.camera.x = 0; app.camera.y = 0;
    audio.startAmbient(this.cfg.act);
    ui.showHud(true);
    ui.hideAllScreens();
    ui.setActLevel(`${ACT_SHORT[this.cfg.act]} · ${this.cfg.id}`);
    ui.setForm(FORMS[run.formIndex].name);
    ui.setScore(run.score);
    ui.setLives(run.lives);
    ui.setGrowth(0);
    ui.setBoss(null);
    ui.setQi(0);
    ui.setItems({});
    ui.setCtrl(app.input.mode);
  }

  /** 以玩家为圆心、[min,max] 距离内的随机点（世界坐标） */
  _ringPos(min, max) {
    const a = rand(0, TAU);
    const d = rand(min, max);
    return [this.player.x + Math.cos(a) * d, this.player.y + Math.sin(a) * d];
  }

  // ---- Boss 需要的游戏接口 ----
  get W() { return this.app.W; }
  get H() { return this.app.H; }
  get audio() { return audio; }
  get camera() { return this.app.camera; }
  toast(msg) { ui.toast(msg); }

  // ---------- 生成（无限海：环绕玩家环形生成，远离回收） ----------
  spawnFish(initial = false) {
    const cfg = this.cfg;
    const p = this.player;
    const pR = p.hitRadius;
    // 威胁分布：分「巨型 / 大型 / 同级 / 猎物」四档
    // 开局也允许大鱼存在（只是比例减半），否则画面里全是猎物、没有压迫感
    const danger = this.bossFight ? 0 : (initial ? cfg.dangerChance * 0.5 : cfg.dangerChance);
    const r = Math.random();
    let ratio;
    if (r < danger * 0.45) ratio = rand(2.4, 4.2);        // 巨兽：比你大 2.4~4.2 倍
    else if (r < danger) ratio = rand(1.3, 2.2);          // 大鱼：明显比你大
    else if (r < danger + 0.18) ratio = initial ? rand(0.5, 0.8) : rand(0.93, 1.08);
    else ratio = rand(0.30, 0.85);

    const pool = this.bossFight ? this.act.minionPool : cfg.fishPool;
    const typeKey = pool[Math.floor(Math.random() * pool.length)];
    const type = FISH_TYPES[typeKey];
    // 尺寸：猎物受鱼种上限约束；巨兽直接按玩家半径倍数放大，不受上限限制
    const size = ratio > 2
      ? pR * ratio
      : clamp(pR * ratio, type.size[0], type.size[1]);
    // 基础速度提高：小鱼更快，大鱼也不至于慢得发闷
    const speed = clamp(240 - size * 2.2, 90, 240) * cfg.speedMul * rand(0.9, 1.35) * (type.speedMul || 1);
    // 位置：视野外环形（开局铺在屏内）
    // 刷在「视野边缘之外」：按实际 zoom 计算半屏尺寸，再留 15% 余量
    const cam = this.app.camera;
    const halfW = (this.app.W / 2) / cam.zoom;
    const halfH = (this.app.H / 2) / cam.zoom;
    const offscreen = Math.hypot(halfW, halfH) * 1.15;   // 对角 + 余量
    const a = rand(0, TAU);
    const d = initial ? rand(halfW * 0.3, offscreen * 0.85) : rand(offscreen, offscreen * 1.4);
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    // 航向：朝玩家方向 ±60°（穿过视野，游远后回收）
    const heading = Math.atan2(p.y - y, p.x - x) + rand(-1.0, 1.0);
    this.fishes.push(new Fish(typeKey, { x, y, size, speed, heading }));
  }

  spawnMinion(typeKey, bx, by) {
    const type = FISH_TYPES[typeKey];
    const pR = this.player.hitRadius;
    const size = clamp(pR * rand(0.42, 0.68), type.size[0], Math.min(type.size[1], pR * 0.85));
    const heading = rand(0, TAU);
    const f = new Fish(typeKey, {
      size,
      speed: clamp(130 - size * 0.7, 45, 110) * this.cfg.speedMul,
      heading,
      y: by + rand(-60, 60),
      x: bx + rand(-40, 40),
    });
    f.isMinion = true;
    this.fishes.push(f);
    if (this.boss) this.boss.minionCount++;
    this.particles.burst(bx, by, 'rgba(140,200,255,0.8)', 6, 80);
  }

  // ---------- 玩法事件 ----------
  eatFish(f) {
    const run = this.app.run;
    const p = this.player;
    f.dead = true;
    run.eaten++;
    this.combo++;
    this.comboTimer = 2.5;
    run.comboBest = Math.max(run.comboBest, this.combo);
    const base = Math.round(f.size);
    run.score += Math.max(5, Math.round(base * (1 + (this.combo - 1) * 0.25)));

    // ---- 成长：吃的越多长得越大 ----
    // 基准：一条「与自身相当」的鱼 = 100 点
    // 早期倍率让前几级飞快升级，后期回落
    const levelK = this.app.run.formIndex;              // 0~4
    // 早期倍率：开局升级飞快，2 级后回落到正常
    const earlyBoost = levelK === 0 ? 1.8
                     : levelK === 1 ? 1.5
                     : levelK === 2 ? 1.25
                     : levelK === 3 ? 1.1
                     : 1.0;
    // 体积比：吃与自身相当的给 22 点（1-1 关约需 40 条）
    const ratio = f.size / Math.max(1, this.player.radius);
    const sizeWeight = clamp(0.30 + ratio * 0.85, 0.30, 1.5);
    this.growth += 38 * sizeWeight * earlyBoost;

    // ---- 体型等级：每攒满 LV_NEED 升一级（视觉跳大 + 提示）----
    const beforeLv = this.sizeLevel;
    this.sizeLevel = Math.floor(this.growth / this.LV_NEED);
    if (this.sizeLevel > beforeLv) this.onSizeLevelUp(this.sizeLevel);

    // ---- 体型实时变大（每吃一口立刻可见，不只是关卡结算）----
    p.growPulse = Math.min(1, (p.growPulse || 0) + 0.35);
    const capMul = 2.2;    // 单关内最多长到 2.2 倍
    const targetSize = Math.min(capMul, 1 + (this.growth / this.cfg.targetGrowth) * 1.0);
    p.innerScale = Math.max(p.innerScale || 1, targetSize);
    audio.eat(this.combo);
    // 山海经生物：吃掉时显示典籍原文（首次）
    if (f.lore && !this.seenLore) this.seenLore = {};
    if (f.lore && !this.seenLore[f.typeKey]) {
      this.seenLore[f.typeKey] = true;
      ui.toast(`【${f.label}】${f.lore}`);
    }
    // 鲛人泣珠：掉落灵珠
    if (f.drops) {
      this.items.push(new Item(f.drops, f.x, f.y));
    }
    this.particles.burst(f.x, f.y, typeof f.palette.body === 'string' && f.palette.body.startsWith('#') ? f.palette.body : '#9adcf0', 12);
    // Boss 战：护卫鱼喂食气
    if (this.bossFight && this.boss && this.boss.state === 'active') {
      this.qi = Math.min(3, this.qi + 1);
      ui.setQi(this.qi);
    }
  }

  /** 玩家碰撞椭圆（与 bodiesTouch 调用处保持同一套系数） */
  _playerHitShape() {
    const h = this.app.run.hero && this.app.run.hero.hit;
    const p = this.player;
    return [p.radius * (h ? h[0] : 1.6), p.radius * (h ? h[1] : 0.8)];
  }

  /**
   * 玩家与某条鱼之间的接触信息。
   * 返回 { nx, ny, overlap }：nx/ny 是「把玩家推出鱼身」的方向，
   * overlap > 0 表示已经重叠了多少像素。
   */
  _contact(f) {
    const p = this.player;
    let ddx = f.x - p.x, ddy = f.y - p.y;
    let d = Math.hypot(ddx, ddy);
    // 完全重合（极端情况：被瞬移或大鱼冲过头）：用一个确定的方向脱出
    if (d < 0.001) {
      const a = p.angle + Math.PI;
      return { nx: Math.cos(a), ny: Math.sin(a), overlap: p.radius + f.size };
    }
    const [aHl, aHw] = this._playerHitShape();
    const hs = SHAPE_HIT[f.shape] || [1.55, 0.78];
    const ra = effRadius(Math.atan2(ddy, ddx) - p.angle, aHl, aHw);
    const rb = effRadius(Math.atan2(-ddy, -ddx) - (f.angle || 0),
      f.size * hs[0], f.size * hs[1]);
    return { nx: -ddx / d, ny: -ddy / d, overlap: ra + rb - d };
  }

  /**
   * 硬性接触：位置分离 + 一次性反弹。
   *
   * 分成两件事，必须分开处理：
   *  - 位置分离：每帧都做（含无敌期间），这样任何情况下都不会穿模；
   *  - 速度反弹：只在「本帧刚接触」时施加一次冲量。
   *    如果每帧都做反射，玩家会被输入持续推向鱼身、反射就持续叠加，
   *    速度会累积到失控（实测能飙到 1700+）。
   */
  _solidContact(f) {
    const p = this.player;
    const c = this._contact(f);
    if (!c) return null;

    if (c.overlap > 0) {
      // 位置分离：完全推出重叠部分（多推 1.5px 余量，保证下一帧不会还嵌着）。
      // 这里不设位移上限 —— 上限会导致深度重叠时连续多帧仍陷在鱼身里（穿模）。
      // 正常游玩每帧位移只有 7px 左右，推出去不会有"瞬移"感。
      const push = c.overlap + 1.5;
      p.x += c.nx * push;
      p.y += c.ny * push;
      // 鱼被反推：鱼越大越推不动
      const massK = Math.pow(f.size / Math.max(1, p.radius), 2);
      const back = push * (1 / (1 + massK)) * (f.heavy ? 0.35 : 1);
      f.x -= c.nx * back;
      f.y -= c.ny * back;
    }

    // 速度反弹：一次接触只结算一次
    const now = this.t;
    if (f.__lastBump !== undefined && now - f.__lastBump < 0.22) return c;
    const vn = p.vx * c.nx + p.vy * c.ny;
    if (vn < 0) {
      f.__lastBump = now;
      // 沿法线反向 + 留一点切向分量，撞完是"滑开"而不是原路弹回
      const restitution = 1.35;
      p.vx -= c.nx * vn * restitution;
      p.vy -= c.ny * vn * restitution;
      // 冲量上限：避免高速冲刺时反弹后飞出屏幕
      const sp = Math.hypot(p.vx, p.vy);
      const cap = p.maxSpeed * 1.9;
      if (sp > cap) { p.vx = p.vx / sp * cap; p.vy = p.vy / sp * cap; }
    }
    return c;
  }

  /** 同级互撞：不扣血，只是互相顶开（有声音和轻微震动，但没有红屏） */
  _sideBump(f, contact) {
    if (this._sideBumpCd > 0) return;
    this._sideBumpCd = 0.28;
    const p = this.player;
    p.stun = Math.max(p.stun || 0, 0.06);
    this.app.camera.addShake(2.5);
    const cx = (p.x + f.x) / 2, cy = (p.y + f.y) / 2;
    this.particles.burst(cx, cy, '#dfe8ea', 5, 90);
    audio.clang();
  }

  /** 物理撞击：两物体按质量比交换动量并弹开 */
  _bumpPhysics(source, impactSpeed) {
    const p = this.player;
    if (!source || source.x === undefined) return;
    const dx = p.x - source.x, dy = p.y - source.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const nx = dx / d, ny = dy / d;

    // 质量比：玩家体型 vs 对方体型
    const pMass = Math.pow(p.radius, 2);
    const sMass = Math.pow(source.size || p.radius, 2);
    const total = pMass + sMass;

    // 玩家获得的速度 = 对方质量的占比 × 冲击速度（大魚撞上来弹得更远）
    const impulse = Math.min(1.4, impactSpeed / 320) * (sMass / total) * 900;
    p.vx += nx * impulse;
    p.vy += ny * impulse;

    // 对方被反作用力推开（小鱼被弹飞，大鱼几乎不动）
    if (source.vx !== undefined) {
      const back = (pMass / total) * impulse * 0.55;
      source.vx -= nx * back;
      source.vy -= ny * back * (source.heavy ? 0.3 : 1);
    }

    // 撞击粒子 + 冲击波
    const cx = (p.x + source.x) / 2, cy = (p.y + source.y) / 2;
    this.particles.burst(cx, cy, '#fff2cc', Math.round(8 + impulse / 90), 220);
    this.particles.burst(cx, cy, '#ff6b6b', 6, 160);
    this.app.camera.addShake(6 + impulse / 60);

    // 短暂僵直（被撞懵的感觉）
    p.stun = 0.18;
  }

  /** 体型升级：明显变大 + 提示 */
  onSizeLevelUp(lv) {
    const p = this.player;
    p.sizeLevel = lv;          // ← 关键：Player 读的是自己的 sizeLevel
    p.growPulse = 1;
    audio.levelup();
    const goal = this.cfg.requiredLevel;
    if (lv >= goal) {
      ui.toast(`体型达到 Lv.${lv} —— 已可渡过此关！`);
    } else {
      ui.toast(`体型成长 → Lv.${lv}（目标 Lv.${goal}）`);
    }
    this.app.camera.addShake(4);
    this.particles.burst(p.x, p.y, '#ffe9a0', 22, 200);
  }

  hurtPlayer(source, kind, impactSpeed) {
    const p = this.player;
    const run = this.app.run;
    if (this.done) return;
    // 无敌期间不扣血、不红屏，也不重复施加冲量。
    // 防穿模由 _solidContact 的位置分离保证（调用方已先做过），
    // 这里若每帧都调 _bumpPhysics，冲量会逐帧累加，速度直接失控。
    if (p.invincible > 0) return;
    if (p.shield) {
      p.shield = false;
      p.invincible = 1.5;
      audio.clang();
      ui.toast('龟甲碎 · 有惊无险');
      this.particles.burst(p.x, p.y, '#d7ccc8', 16, 180);
      if (source && source.x !== undefined) this._bumpPhysics(source, impactSpeed || 200);
      return;
    }
    run.lives--;
    this.combo = 0;
    p.invincible = 2;
    p.squash = 1;                  // 受击形变反馈
    p.innerScale = Math.max(1, (p.innerScale || 1) * 0.94);   // 被撞会缩小一点
    this.hurtFlash = 1;
    this.hitstop = 0.08;
    this.app.camera.addShake(14);
    audio.hurt();
    this.particles.burst(p.x, p.y, '#ff6b6b', 18, 200);
    // 物理撞击（有源实体时走动量交换，技能伤害走简单击退）
    if (source && source.x !== undefined) {
      const relSpeed = Math.hypot(
        (p.vx || 0) - (source.vx || 0),
        (p.vy || 0) - (source.vy || 0)
      );
      this._bumpPhysics(source, Math.max(impactSpeed || 0, relSpeed));
    } else {
      let kx = 0, ky = 0;
      if (kind === 'erupt') { ky = 1; }
      else if (kind === 'drop') { ky = 0.6; }
      p.vx = kx * 320; p.vy = ky * 320;
    }
    ui.setLives(run.lives);
    if (run.lives <= 0) {
      audio.over();
      audio.stopAmbient();
      this.switching = true;
      this.app.scenes.switchTo('gameover');
    }
  }

  startBossIntro() {
    this.bossStarted = true;
    const p = this.player;
    this.boss = new Boss(this.cfg.boss);
    // 战场锚定在 Boss 入场时的玩家位置
    this.boss.arena = { x: p.x, y: p.y };
    this.boss.x = p.x - 520;
    this.boss.y = p.y - 60;
    this.bossIntroT = 1.6;
    audio.bossRoar();
    this.app.camera.addShake(6);
    ui.setBoss(this.boss);
    ui.toast(`${this.boss.name} · ${this.boss.title}`);
  }

  completeLevel() {
    if (this.done || this.switching) return;
    this.done = true;
    this.switching = true;
    const run = this.app.run;
    const cfg = this.cfg;
    run.score += 100;
    ui.toast('关卡完成 +100');
    const nl = nextLevel(cfg.id);
    let next;
    if (!nl) next = { scene: 'ending', params: {} };
    else if (needsActIntro(cfg, nl)) next = { scene: 'actintro', params: { actId: nl.act, levelId: nl.id } };
    else next = { scene: 'play', params: { levelId: nl.id } };

    if (cfg.evolveOnComplete != null) {
      this.app.scenes.switchTo('evolve', {
        formIndex: cfg.evolveOnComplete,
        oldFormIndex: run.formIndex,
        next,
      });
    } else {
      this.app.scenes.switchTo(next.scene, next.params);
    }
  }

  // ---------- 更新 ----------
  update(dt) {
    // hitstop：世界冻结（渲染照常）
    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    const app = this.app;
    const { W, H } = app;
    const run = app.run;
    const p = this.player;
    const cfg = this.cfg;
    const cam = app.camera;
    this.t += dt;
    if (this.bannerT > 0) this.bannerT -= dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);

    // 冲刺输入
    if (app.input.dashQueued) {
      app.input.dashQueued = false;
      if (p.queueDash()) audio.dash();
    }

    // 摄像机跟随（鱼永远在屏幕中心）+ 视野矩形 + 鼠标世界坐标
    cam.x = p.x; cam.y = p.y;
    // 体型越大镜头拉得越远：保证大鱼时仍能看到足够多的环境
    const baseZoom = 0.95;
    const targetZoom = baseZoom * clamp(28 / Math.max(24, p.radius), 0.42, 1);
    cam.zoom += (targetZoom - cam.zoom) * clamp(dt * 2.2, 0, 1);
    const vw = W / (2 * cam.zoom), vh = H / (2 * cam.zoom);
    const view = { x0: p.x - vw, y0: p.y - vh, x1: p.x + vw, y1: p.y + vh };
    this.view = view;
    app.input.mouseWorld = {
      x: cam.x + (app.input.mouse.x - W / 2) / cam.zoom,
      y: cam.y + (app.input.mouse.y - H / 2) / cam.zoom,
    };
    ui.setCtrl(app.input.mode);

    // ---- 障碍物 ----
    for (const ob of this.obstacles) {
      ob.update(dt, this.t);
      // 太远就重新投放
      if (Math.hypot(ob.x - p.x, ob.y - p.y) > 1500) recycleObstacle(ob, p.x, p.y);
    }
    const obsFx = resolveObstacles(p, this.obstacles, dt);
    if (obsFx.hit) {
      const ob = obsFx.hit;
      if (ob.kind === 'urchin') {
        // 海胆：尖刺扎伤 —— 扣血 + 强力弹开
        if (p.invincible <= 0) {
          this.hurtPlayer(null, 'urchin');
          const d = Math.max(1, Math.hypot(p.x - ob.x, p.y - ob.y));
          p.vx = ((p.x - ob.x) / d) * 400;
          p.vy = ((p.y - ob.y) / d) * 400;
          this.particles.burst(p.x, p.y, '#e8b04a', 16, 220);
        }
      } else if (!this._bumpCd || this._bumpCd <= 0) {
        // 礁石：只阻挡，不掉血
        const d = Math.max(1, Math.hypot(p.x - ob.x, p.y - ob.y));
        p.vx = ((p.x - ob.x) / d) * 260;
        p.vy = ((p.y - ob.y) / d) * 260;
        this._bumpCd = 0.35;
        this.particles.burst(p.x, p.y, '#8fa89a', 8, 150);
        this.app.camera.addShake(5);
        audio.clang();
      }
    }
    this._bumpCd = Math.max(0, (this._bumpCd || 0) - dt);
    this._sideBumpCd = Math.max(0, (this._sideBumpCd || 0) - dt);
    this.obsSlow = obsFx.slowMul;
    this.obsPullX = obsFx.pullX;
    this.obsPullY = obsFx.pullY;

    // 玩家（无边界世界坐标）
    p.sizeLevel = this.sizeLevel;
    p.growthFrac = clamp(this.growth / cfg.targetGrowth, 0, 1);

    // ---- 特殊物理区域：自转动画 + 远处回收 ----
    for (const z of this.zones) {
      z.update(dt);
      // 回收距离要按区域自身尺寸算：急流带子有 1600 长，
// 用固定 1700 会在带子还没完全离开视野时就把它搬走。
      if (Math.hypot(z.x - p.x, z.y - p.y) > 1800 + z.boundR) recycleZone(z, p.x, p.y);
    }

    // ---- 特殊物理区域 ----
    // 只有进入 FlowZone 才会受力；其余水域的水流只是视觉动画，不推动任何东西。
    // 必须在 update() 之前写入 flowBias：Player 会把它合入「目标速度」，
    // 这样在急流里才是"游得更快 / 顶着游"，而不是被生硬位移。
    let zoneHit = null;
    if (this.zones && this.zones.length) {
      zoneHit = zoneForceAt(this.zones, p.x, p.y);
      if (zoneHit) {
        p.flowBias = { x: zoneHit.x * 0.55, y: zoneHit.y * 0.55 };
        const sp = Math.hypot(zoneHit.x, zoneHit.y);
        this.zoneAlign = sp > 1
          ? (Math.cos(p.angle) * zoneHit.x + Math.sin(p.angle) * zoneHit.y) / sp
          : 0;
        this.zoneSpeed = sp;
        this.zoneLabel = zoneHit.label;
        ui.setCurrent(this.zoneAlign, sp, zoneHit);
      } else {
        p.flowBias = null;
        this.zoneSpeed = 0;
        this.zoneLabel = null;
        ui.setCurrent(0, 0, null);
      }
    }

    p.update(dt, app.input, this.particles);
    // 障碍物效果：减速 / 吸力
    if (this.obsSlow < 1) { p.vx *= this.obsSlow; p.vy *= this.obsSlow; }
    if (this.obsPullX || this.obsPullY) {
      p.vx += this.obsPullX * dt;
      p.vy += this.obsPullY * dt;
    }

    // 连击窗口
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // Boss 流程
    if (this.bossIntroT > 0) {
      this.bossIntroT -= dt;
      if (this.boss.x < this.boss.arena.x) this.boss.x += 200 * dt;
      if (this.bossIntroT <= 0) this.bossFight = true;
    } else if (this.boss) {
      this.boss.update(dt, this);
      if (this.boss.state === 'dying' && this.boss.deathT > 1.6 && !this.bossDone) {
        this.bossDone = true;
        run.score += 250;
        ui.setBoss(null);
        ui.toast(`${this.boss.name} 败退 +250`);
        this.completeLevel();
      }
    }

    // 自然刷鱼
    if (this.fishes.length < 30) this.spawnFish();

    // 成群生物：维护同类型群体的引用（何罗等）
    const schoolTypes = new Set();
    for (const f of this.fishes) if (f.behavior === 'school') schoolTypes.add(f.typeKey);
    for (const tk of schoolTypes) {
      const group = this.fishes.filter((f) => !f.dead && f.typeKey === tk);
      for (const f of group) f.school = group;
    }

    // 鱼：追击标记 + 更新 + 距离回收（无限海）
    const pR = p.hitRadius;
    for (const f of this.fishes) {
      if (f.dead) continue;
      const ratio = f.size / pR;
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      // 中性生物不追人
      f.chasing = !f.neutral && ratio >= 1.15 && p.invincible <= 0 && d < 200;
      f.update(dt, this.t, p);
      pushOutOfReefs(f, this.obstacles);
      // 游太远 → 回收（环形补位由自然刷新完成）
      // 回收距离按视野放大，避免大视角下鱼过早消失
      if (d > (1150 / Math.max(0.5, cam.zoom))) f.dead = true;
    }

    // 张嘴 + 吸入 + 碰撞
    const mouth = p.mouthPos;
    let chompNear = false;
    for (const f of this.fishes) {
      if (f.dead) continue;
      const ratio = f.size / pR;
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      if (ratio <= 0.92) {
        const dm = Math.hypot(f.x - mouth.x, f.y - mouth.y);
        if (dm < pR * 2.2) chompNear = true;
        if (dm < pR * 1.5 && dm > 1) {
          // 吸入：位置级拉拽
          f.x += ((mouth.x - f.x) / dm) * 150 * dt;
          f.y += ((mouth.y - f.y) / dm) * 150 * dt;
        }
      }
      // 椭圆体接触：沿连线方向取双方有效半径，视觉边缘即触发
      const touch = this._contact(f);
      if (touch && touch.overlap > 0) {
        if (f.neutral) continue;              // 中性生物：穿过不触发任何效果
        if (ratio <= 0.92) {
          this.eatFish(f);
        } else if (f.sting || ratio >= 1.15) {
          // 大鱼 / 带刺：先做硬性分离（无敌期间也生效，绝不穿模），
          // 再结算伤害 —— 只有真正受伤时才扣血、红屏、震屏
          this._solidContact(f);
          const rel = Math.hypot((p.vx || 0) - (f.vx || 0), (p.vy || 0) - (f.vy || 0));
          this.hurtPlayer(f, 'bump', rel);
        } else {
          // 同级（0.92~1.15）：撞不动对方，但会被弹开 —— 不能穿过去
          this._solidContact(f);
          this._sideBump(f, touch);
        }
      }
    }
    p.mouthTarget = chompNear ? 1 : 0;

    // Boss 身体碰撞（啃噬 / 受伤）
    if (this.bossFight && this.boss && this.boss.state === 'active') {
      const b = this.boss;
      const db = Math.hypot(p.x - b.x, p.y - b.y);
      if (db < (pR * 0.9 + b.r) * 0.95) {
        if (this.qi >= 3) {
          const ok = b.onBitten(this, p.x, p.y);
          if (ok) { this.qi = 0; ui.setQi(0); }
          else {
            // 龟甲弹开
            const d = Math.max(1, db);
            p.vx = ((p.x - b.x) / d) * 300;
            p.vy = ((p.y - b.y) / d) * 300;
          }
        } else {
          this.hurtPlayer(b);
        }
      }
      // 蛟龙 P2 水流推挤
      if (b.currentPushX) p.vx += b.currentPushX * dt * 2;
    }

    // 道具（拾取 + 游太远时环绕补位）
    for (const it of this.items) {
      it.update(dt, this.t);
      const d = Math.hypot(it.x - p.x, it.drawY - p.y);
      if (d < pR + it.r + 6) {
        it.dead = true;
        audio.item();
        this.particles.burst(it.x, it.drawY, '#ffe9a0', 10, 120);
        if (it.kind === 'lingzhu') { p.speedBoostT = 6; ui.toast('灵珠 · 疾'); }
        else if (it.kind === 'guijia') { p.shield = true; ui.toast('龟甲 · 御'); }
        else { run.lives = Math.min(4, run.lives + 1); ui.setLives(run.lives); ui.toast('仙草 · 命'); }
      } else if (d > 900) {
        [it.x, it.y] = this._ringPos(350, 650);
      }
    }
    this.items = this.items.filter((i) => !i.dead);
    ui.setItems({ speedT: p.speedBoostT, shield: p.shield });

    // 唤雨危害（俯视：预警圈 → 落水点 AOE）
    for (const h of this.hazards) {
      if (h.telegraph > 0) { h.telegraph -= dt; continue; }
      if (!h.hitDone) {
        h.hitDone = true;
        h.impactT = 0.35;
        audio.splash();
        this.particles.burst(h.x, h.y, '#7fdfff', 14, 180);
        if (Math.hypot(h.x - p.x, h.y - p.y) < 40 + p.hitRadius * 0.5) {
          this.hurtPlayer(null, 'drop');
        }
      }
      h.impactT -= dt;
      if (h.impactT <= 0) h.dead = true;
    }
    this.hazards = this.hazards.filter((h) => !h.dead);

    // 环境（气泡随视野生成）+ 礁石环绕补位
    this.bubbles.update(dt, view, null, this.t);
    // 水流流线采样放在 update 里：渲染阶段只负责提交给 GPU
    if (this.current) {
      // 深色幕流线降密度：暗底上白线对比太强，密了就像满屏划痕
      const sDensity = this.act.water.dark ? 0.55 : 1;
      this.currentStreaks = sampleStreaks(this.current, view, this.t, this.app.highQuality, sDensity);
    }
    this.particles.update(dt);

    // 清尸
    for (const f of this.fishes) {
      if (f.dead && f.isMinion && this.boss) this.boss.minionCount = Math.max(0, this.boss.minionCount - 1);
    }
    this.fishes = this.fishes.filter((f) => !f.dead);

    // 关卡推进判定
    const goalLv = cfg.requiredLevel || 3;
    const reached = this.sizeLevel >= goalLv;
    if (!this.done && reached) {
      if (cfg.boss) {
        if (!this.bossStarted) this.startBossIntro();
      } else {
        this.completeLevel();
      }
    }
    // 半程化形（只触发一次，且切换中不再触发）
    const halfLv = Math.floor(goalLv / 2);
    if (!this.done && !this.switching && !this.halfEvolved && cfg.evolveAtHalf != null &&
        this.sizeLevel >= halfLv && this.growth > 0) {
      this.halfEvolved = true;
      this.switching = true;
      this.app.scenes.switchTo('evolve', {
        formIndex: cfg.evolveAtHalf,
        oldFormIndex: run.formIndex,
        next: { scene: 'play', params: { levelId: cfg.id, resumeHalf: true } },
      });
    }

    // UI 同步（进度条 = 距下一级体型）
    ui.setScore(run.score);
    ui.setGrowth(clamp((this.growth % this.LV_NEED) / this.LV_NEED, 0, 1));
    ui.setLevelHud(this.sizeLevel, goalLv);
    ui.setItems({ speedT: p.speedBoostT, shield: p.shield });
  }

  // ---------- 渲染辅助 ----------
  _renderMouseTarget(ctx) {
    if (this.app.input.mode !== 'mouse') return;
    const mw = this.app.input.mouseWorld;
    const pul = 1 + Math.sin(this.t * 5) * 0.15;
    ctx.strokeStyle = 'rgba(255,240,200,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mw.x, mw.y, 13 * pul, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mw.x, mw.y, 3, 0, TAU);
    ctx.fillStyle = 'rgba(255,240,200,0.5)';
    ctx.fill();
  }

  _renderBoss(ctx) {
    const b = this.boss;
    if (!b) return;
    if (b.kind === 'jiaolong' && b.subState === 'warning') {
      const k = clamp(b.subTimer / 0.8, 0, 1);
      ctx.strokeStyle = `rgba(255,82,82,${0.7 - k * 0.3})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(b.targetX, b.targetY, 60 + 80 * k + Math.sin(this.t * 10) * 4, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    b.render(ctx, this.t);
  }

  _renderHazards(ctx) {
    for (const h of this.hazards) {
      if (h.telegraph > 0) {
        const k = clamp(h.telegraph / 0.9, 0, 1);
        ctx.strokeStyle = `rgba(255,180,120,${0.4 + (1 - k) * 0.5})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 12 + 46 * k, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.x, h.y, 6, 0, TAU);
        ctx.stroke();
      } else {
        const k = 1 - clamp(h.impactT / 0.35, 0, 1);
        ctx.strokeStyle = `rgba(160,225,255,${1 - k})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 12 + k * 42, 0, TAU);
        ctx.stroke();
      }
    }
  }

  /**
   * 受击红屏。
   * 旧实现是中心完全透明的径向渐变 —— 而玩家永远在屏幕中心，
   * 导致"受伤却看不到红"。改成：红色实铺全屏 + 中心略淡，
   * 保证任何分辨率下都能明确看到一下红。
   */
  _renderHurtFlash(ctx, W, H) {
    if (this.hurtFlash <= 0) return;
    const k = clamp(this.hurtFlash, 0, 1);
    // 红色实铺（整屏都能看见）
    ctx.fillStyle = `rgba(214,32,32,${k * 0.30})`;
    ctx.fillRect(0, 0, W, H);
    // 边缘再加重一圈，强化"被撞"的压迫感
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.18, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(255,40,40,0)');
    g.addColorStop(1, `rgba(190,10,10,${k * 0.46})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** 屏幕空间：受击红屏 + 文字 */
  _renderScreenSpace(ctx, W, H, F) {
    this._renderHurtFlash(ctx, W, H);
    ctx.textAlign = 'center';
    if (F.text === false) return;
    if (this.bannerT > 0) {
      const a = clamp(this.bannerT / 0.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffe9c4';
      ctx.font = '600 30px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillText(`${this.cfg.name} · ${this.cfg.id}`, W / 2, 90);
      ctx.globalAlpha = 1;
    }
    if (this.bossIntroT > 0 && this.boss) {
      const a = clamp(this.bossIntroT / 1.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ff8a80';
      ctx.font = '600 42px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillText(`${this.boss.name} · ${this.boss.title}`, W / 2, H / 2 - 20);
      ctx.font = '300 18px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillStyle = 'rgba(255,235,235,0.85)';
      ctx.fillText('吞噬护卫鱼积攒食气 · 食气满则噬之', W / 2, H / 2 + 24);
      ctx.globalAlpha = 1;
    }
  }

  /** 屏幕空间文字（关卡 banner / Boss 登场）：提交给 GPU Text，内容不变则零成本 */
  _syncScreenText(be, F) {
    if (!be.syncScreenText) return;
    const { W, H } = this.app;
    const items = [];
    if (F.text !== false) {
      if (this.bannerT > 0) {
        items.push({
          k: 'banner',
          text: `${this.cfg.name} · ${this.cfg.id}`,
          x: W / 2, y: 90,
          size: 30, color: '#ffe9c4',
          alpha: clamp(this.bannerT / 0.6, 0, 1),
        });
      }
      if (this.bossIntroT > 0 && this.boss) {
        const a = clamp(this.bossIntroT / 1.6, 0, 1);
        items.push({
          k: 'bossname',
          text: `${this.boss.name} · ${this.boss.title}`,
          x: W / 2, y: H / 2 - 20,
          size: 42, color: '#ff8a80', alpha: a,
        });
        items.push({
          k: 'bosstip',
          text: '吞噬护卫鱼积攒食气 · 食气满则噬之',
          x: W / 2, y: H / 2 + 24,
          size: 18, weight: '300', color: 'rgba(255,235,235,0.85)', alpha: a,
        });
      }
    }
    be.syncScreenText(items);
  }

  // ---------- 渲染 ----------
  render(ctx) {
    const { W, H } = this.app;
    const cam = this.app.camera;
    const view = this.view || { x0: 0, y0: 0, x1: W, y1: H };
    const F = window.__rf || {};
    const be = this.app.backend;
    const spriteMode = be && be.usesSprites;

    // === WebGL 路径：全部内容交给 GPU，不做任何全屏纹理上传 ===
    if (spriteMode) {
      // PlayScene 不用 Canvas 场景层：关掉它，省掉整屏画布的重建与上传
      if (be.skipCanvasScene) be.skipCanvasScene();
      // 深度雾色：远景实体向当前幕的水体色衰减
      if (be.setFog) {
        be.setFog(this.act.water.fog || this.act.water.bottom);
      }
      // 大气参数按幕切换（光柱冷暖/强度、屏幕雾浓淡）
      if (be.setAtmosphere) {
        be.setAtmosphere(this.cfg.act, !!this.act.water.dark);
      }
      be.syncEntities(this.fishes, this.obstacles, this.player);
      // 水体背景：只烘焙一次，常驻 GPU（相机移动时通过 world 变换跟随）
      if (F.water !== false && be.setBackground) {
        be.setBackground((g, w, h) => {
          // 全屏坐标系：0,0 到 w,h
          g.fillStyle = this.act.water.bottom;
          g.fillRect(0, 0, w, h);
          drawWater(g, { x0: 0, y0: 0, x1: w, y1: h }, this.act.water, 0);
        }, W, H);
      }
      // ---- 特效：GPU 粒子池（零上传）----
      if (F.bubbles !== false) be.syncBubbles(this.bubbles.list);
      else be.syncBubbles([]);
      if (F.particles !== false) be.syncParticles(this.particles.list);
      else be.syncParticles([]);
      // ---- 特殊物理区域（画在流线之下，边界清晰）----
      if (F.zones !== false && be.syncZones) be.syncZones(this.zones || []);
      else if (be.syncZones) be.syncZones([]);
      if (F.current !== false && this.current) {
        be.syncStreaks(this.currentStreaks || [], !!this.act.water.dark);
      } else {
        be.syncStreaks([], false);
      }

      // ---- 道具：预烘焙精灵，GPU 直出（零上传）----
      if (F.items !== false) be.syncItems(this.items);
      else be.syncItems([]);

      // ---- 鼠标准星：GPU Graphics ----
      be.syncMouseTarget(
        this.app.input.mode === 'mouse' ? this.app.input.mouseWorld : null,
        this.t
      );

      // ---- Boss / 唤雨：只有这两者仍需要 Canvas 绘制，
      //      用一张以 Boss 为中心的局部画布，只上传这一块（而不是整屏 6MB）----
      if (F.boss !== false && (this.boss || this.hazards.length)) {
        const cx = this.boss ? this.boss.x : this.player.x;
        const cy = this.boss ? this.boss.y : this.player.y;
        const bc = be.beginBossCanvas(cx, cy);
        this._renderBoss(bc);
        this._renderHazards(bc);
        be.endBossCanvas(cx, cy);
      } else if (be.clearBossCanvas) {
        be.clearBossCanvas();
      }

      // ---- 屏幕文字：GPU Text（不再走全屏画布）----
      this._syncScreenText(be, F);

      // ---- 应用相机变换 + 玩家精灵（必须在所有世界内容之后）----
      be.beginWorld(cam, this.t);
      be.syncPlayer(this.player, F.player !== false);
      be.endWorld(cam);

      // ---- 受击红屏：GPU Graphics，零上传 ----
      if (be.setHurtFlash) be.setHurtFlash(this.hurtFlash);
      return;
    }

    // === Canvas2D 路径（原逻辑）===
    cam.apply(ctx);

    if (F.water !== false) drawWater(ctx, view, this.act.water, this.t);
    // 特殊物理区域（Canvas2D 回退路径，复用同一份烘焙贴图）
    if (F.zones !== false) {
      for (const z of this.zones) {
        const b = zoneTexture(z);
        ctx.save();
        ctx.globalAlpha = 0.46;
        ctx.translate(z.x, z.y);
        // 急流是有方向的河道段（不转），漩涡/涌泉自转
        ctx.rotate(z.kind === 'rapids' ? z.angle : z.t * z.spin);
        // 贴图以 (cx, cy) 为区域中心
        ctx.drawImage(b.canvas, -b.cx, -b.cy);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    if (F.current !== false && this.current) {
      drawCurrentLines(ctx, this.current, view, this.t, this.app.highQuality, !!this.act.water.dark);
    }
    if (F.bubbles !== false) this.bubbles.render(ctx);

    this._renderMouseTarget(ctx);

    if (F.items !== false) for (const it of this.items) it.render(ctx, this.t);
    if (F.fish !== false) for (const f of this.fishes) f.render(ctx, this.t);

    // Boss（含 P3 预警圈）
    if (F.boss !== false && this.boss) {
      if (this.boss.kind === 'jiaolong' && this.boss.subState === 'warning') {
        const b = this.boss;
        const k = clamp(b.subTimer / 0.8, 0, 1);
        ctx.strokeStyle = `rgba(255,82,82,${0.7 - k * 0.3})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(b.targetX, b.targetY, 60 + 80 * k + Math.sin(this.t * 10) * 4, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      this.boss.render(ctx, this.t);
    }

    // 唤雨（预警圈 / 落水冲击圈）
    if (F.boss !== false) for (const h of this.hazards) {
      if (h.telegraph > 0) {
        const k = clamp(h.telegraph / 0.9, 0, 1);
        ctx.strokeStyle = `rgba(255,180,120,${0.4 + (1 - k) * 0.5})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 12 + 46 * k, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.x, h.y, 6, 0, TAU);
        ctx.stroke();
      } else {
        const k = 1 - clamp(h.impactT / 0.35, 0, 1);
        ctx.strokeStyle = `rgba(160,225,255,${1 - k})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 12 + k * 42, 0, TAU);
        ctx.stroke();
      }
    }

    if (F.obstacles !== false) {
      for (const ob of this.obstacles) ob.render(ctx, this.t);
    }
    if (F.player !== false) this.player.render(ctx, this.t);
    if (F.particles !== false) this.particles.render(ctx);
    cam.restore(ctx);

    // 受击红屏
    this._renderHurtFlash(ctx, W, H);

    // ---- 屏幕空间文字 ----
    ctx.textAlign = 'center';
    if (F.text === false) return;
    // 关卡名 banner
    if (this.bannerT > 0) {
      const a = clamp(this.bannerT / 0.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffe9c4';
      ctx.font = '600 30px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillText(`${this.cfg.name} · ${this.cfg.id}`, W / 2, 90);
      ctx.globalAlpha = 1;
    }
    // Boss 登场 banner
    if (this.bossIntroT > 0 && this.boss) {
      const a = clamp(this.bossIntroT / 1.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ff8a80';
      ctx.font = '600 42px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillText(`${this.boss.name} · ${this.boss.title}`, W / 2, H / 2 - 20);
      ctx.font = '300 18px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillStyle = 'rgba(255,235,235,0.85)';
      ctx.fillText('吞噬护卫鱼积攒食气 · 食气满则噬之', W / 2, H / 2 + 24);
      ctx.globalAlpha = 1;
    }
  }
}
