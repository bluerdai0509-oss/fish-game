// ============================================================
// 化鹏结局演出（俯视版，时间轴脚本器）
// 0.0 悬停 | 2.0 加速（水面渐亮）| 4.0 破水（扩散环 + 定格 + 留白）
// 5.0 鱼鹏 crossfade | 7.0 相机拉远：海成一盘，扶摇直上 | 10.0 字幕
// ============================================================
import { Scene } from '../engine/scenes.js';
import { renderKun, renderPeng } from '../engine/fishrender.js';
import { audio } from '../engine/audio.js';
import { ui } from '../engine/ui.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, k) => a + (b - a) * k;

export class EndingScene extends Scene {
  enter() {
    const { W, H } = this.app;
    this.t = 0;
    this.freezeT = 0;
    this.sea = { x: W / 2, y: H * 0.62, r: W * 0.72 };
    this.kun = { x: W / 2, y: H * 0.68 };
    this.peng = { x: W / 2, y: H * 0.5 };
    this.splashed = false;
    this.musicStarted = false;
    this.shownPanel = false;
    this.rings = [];        // 破水扩散环
    this.brightness = 0;    // 接近水面的亮化
    // 云（俯视穿云）
    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      this.clouds.push({
        x: rand(-300, W + 300),
        y: rand(-500, H * 0.4),
        r: rand(30, 75),
        layer: 1 + (i % 3),
      });
    }
    this.particles = [];
    ui.showHud(false);
    ui.hideAllScreens();
    ui.showGameOver(false);
    ui.showEnding(false);
    audio.stopAmbient();
    this.app.camera.reset();
  }
  exit() { ui.showEnding(false); }

  _splash(x, y) {
    // 扩散环
    for (let i = 0; i < 3; i++) this.rings.push({ x, y, r: 12 + i * 14, v: 190 + i * 60, life: 1.1 });
    // 放射水珠
    for (let i = 0; i < 34; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(140, 380);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.4, 0.9), maxLife: 0.9, r: rand(2, 5), color: '#eaf6ff',
      });
    }
  }

  update(dt) {
    if (this.freezeT > 0) { this.freezeT -= dt; return; }
    this.t += dt;
    const t = this.t;

    if (t >= 5 && !this.musicStarted) { this.musicStarted = true; audio.playEnding(); }
    if (t >= 12.5 && !this.shownPanel) { this.shownPanel = true; ui.showEnding(true); }

    // 鲲：悬停 → 加速冲向「海心破水点」
    if (t < 2) {
      this.kun.y -= 6 * dt;
      this.kun.y += Math.sin(t * 2) * 10 * dt;
    } else if (t < 4) {
      const k = (t - 2) / 2;
      const speed = lerp(40, 430, k * k);
      const dx = this.sea.x - this.kun.x, dy = this.sea.y - this.kun.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      this.kun.x += (dx / d) * speed * dt;
      this.kun.y += (dy / d) * speed * dt;
      this.brightness = clamp01((t - 2) / 2) * 0.3;
    } else if (!this.splashed) {
      this.splashed = true;
      this.freezeT = 0.3;
      this._splash(this.kun.x, this.kun.y);
      this.app.camera.addShake(9);
      audio.splash();
      this.brightness = 0.45;
    }
    if (this.splashed) this.brightness = Math.max(0.28, this.brightness - dt * 0.05);

    // 破水后：鹏接管
    if (t >= 5) {
      this.peng.x = this.kun.x + Math.sin((t - 5) * 0.7) * 26;
      this.peng.y -= lerp(60, 130, clamp01((t - 7) / 3)) * dt;
    }

    // 扩散环 / 粒子
    for (const r of this.rings) { r.r += r.v * dt; r.life -= dt; }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // 相机：7s 后拉远（海成一盘）+ 跟随上升
    const cam = this.app.camera;
    if (t >= 7) {
      cam.zoom = lerp(1, 0.22, clamp01((t - 7) / 3));
      cam.y = Math.max(0, (this.app.H * 0.62 - this.peng.y) * 0.5);
    }
  }

  render(ctx) {
    const { W, H } = this.app;
    const t = this.t;
    const cam = this.app.camera;
    cam.apply(ctx);

    // 天空（俯视穿云后全是天；矩形足够大以覆盖 0.22 倍拉远视野）
    const sky = ctx.createRadialGradient(W / 2, H * 0.4, 60, W / 2, H * 0.5, W * 0.9);
    sky.addColorStop(0, '#ffe4ae');
    sky.addColorStop(0.5, '#9cc3e0');
    sky.addColorStop(1, '#3d6a8f');
    ctx.fillStyle = sky;
    ctx.fillRect(-3000, -3000, W + 6000, H + 6000);

    // 海（俯视亮盘：世界固定，拉远后自然缩小）
    if (t < 9.5) {
      const seaAlpha = t < 7 ? 1 : clamp01(1 - (t - 7) / 2.5) * 0.9 + 0.1;
      ctx.save();
      ctx.globalAlpha = seaAlpha;
      const sg = ctx.createRadialGradient(this.sea.x, this.sea.y, this.sea.r * 0.1, this.sea.x, this.sea.y, this.sea.r);
      sg.addColorStop(0, '#1a3a5c');
      sg.addColorStop(0.75, '#0d2438');
      sg.addColorStop(1, '#3a6a8a');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(this.sea.x, this.sea.y, this.sea.r, 0, Math.PI * 2);
      ctx.fill();
      // 海面波光弧
      ctx.strokeStyle = 'rgba(255,235,190,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const rr = this.sea.r * (0.3 + i * 0.24) + Math.sin(t * 1.2 + i * 2) * 6;
        ctx.beginPath();
        ctx.arc(this.sea.x, this.sea.y, rr, t * 0.3 + i, t * 0.3 + i + 2.2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 云（俯视：贴海飘过）
    for (const c of this.clouds) {
      const drift = t * (5 + c.layer * 9);
      const cx = ((c.x - drift) % (W + 700) + W + 700) % (W + 700) - 350;
      const cy = c.y + cam.y * (0.3 + c.layer * 0.2);
      ctx.fillStyle = `rgba(255,255,255,${0.14 + c.layer * 0.06})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, c.r * 1.8, c.r * 0.6, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 鲲（crossfade 前主体）
    if (t < 6.2) {
      const aKun = t < 5 ? 1 : Math.max(0, 1 - (t - 5) / 1.2);
      ctx.save();
      ctx.globalAlpha = aKun;
      renderKun(ctx, {
        x: this.kun.x, y: this.kun.y, radius: 54,
        angle: t < 4 ? -Math.PI / 2 : Math.atan2(this.sea.y - H, 0) || -Math.PI / 2,
        tailPhase: t * 7, invincible: 0,
        mouthOpen: t < 2 ? 0.12 : clamp01((t - 2) / 2) * 0.8,
        formIndex: 4, growthFrac: 1,
      }, t);
      ctx.restore();
    }

    // 鹏
    if (t >= 5) {
      renderPeng(ctx, this.peng.x, this.peng.y, 62, t * 5.4, clamp01((t - 5) / 1.2));
    }

    // 扩散环 + 水珠
    for (const r of this.rings) {
      ctx.globalAlpha = clamp01(r.life / 1.1) * 0.8;
      ctx.strokeStyle = '#eaf6ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = clamp01(p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    cam.restore(ctx);

    // 接近水面的亮化
    if (this.brightness > 0.01) {
      ctx.fillStyle = `rgba(255,246,224,${this.brightness})`;
      ctx.fillRect(0, 0, W, H);
    }
    // 破水留白闪
    if (t >= 4 && t < 4.6) {
      ctx.fillStyle = `rgba(255,248,230,${Math.max(0, 0.75 - (t - 4) * 2.2)})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 字幕
    ctx.textAlign = 'center';
    if (t >= 10) {
      ctx.globalAlpha = clamp01((t - 10) / 1.2);
      ctx.fillStyle = '#fff3d9';
      ctx.font = '600 30px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillText('抟扶摇而上者九万里', W / 2, H / 2 - 10);
      ctx.globalAlpha = clamp01((t - 11.2) / 1) * 0.75;
      ctx.font = '300 16px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillText('——《庄子 · 逍遥游》', W / 2, H / 2 + 30);
      ctx.globalAlpha = 1;
    }
  }
}
