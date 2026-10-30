// ============================================================
// 化形过场：白光 + 新旧形态剪影渐变 + 诗句
// ============================================================
import { Scene } from '../engine/scenes.js';
import { FORMS, EVOLVE_LINES } from '../data/acts.js';
import { renderCreature } from '../engine/fishrender.js';
import { audio } from '../engine/audio.js';
import { ui } from '../engine/ui.js';

export class EvolveScene extends Scene {
  enter({ formIndex, oldFormIndex, next }) {
    this.formIndex = formIndex;
    this.oldFormIndex = oldFormIndex;
    this.next = next;               // { scene, params }
    this.t = 0;
    this.dur = 2.6;
    audio.evolve();
    this.app.run.formIndex = formIndex;
    ui.showHud(false);
    ui.hideAllScreens();
  }
  update(dt) {
    this.t += dt;
    if (this.t >= this.dur) {
      this.app.scenes.switchTo(this.next.scene, this.next.params);
    }
  }
  render(ctx) {
    const { W, H } = this.app;
    const t = this.t;
    // 深色底 + 白光脉冲
    ctx.fillStyle = '#04101c';
    ctx.fillRect(0, 0, W, H);
    const flash = Math.max(0, Math.sin(Math.min(1, t / 1.2) * Math.PI)) * 0.75;
    if (flash > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, W * 0.7);
      g.addColorStop(0, `rgba(255,244,214,${flash})`);
      g.addColorStop(1, 'rgba(255,244,214,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    const form = FORMS[this.formIndex];
    const oldForm = FORMS[this.oldFormIndex] || form;
    const y = H / 2;
    const baseR = 17;
    const cy = t / 1.4; // 0→1 形态切换
    // 旧形态淡出
    const oldA = Math.max(0, 1 - cy * 1.6);
    if (oldA > 0.01) {
      renderCreature(ctx, {
        x: W / 2, y, size: baseR * oldForm.sizeMul, shape: 'fish',
        palette: { body: '#2c4252', belly: '#41627a', fin: '#1a2c38' },
        tailPhase: t * 5, face: 1, vy: 0, striped: false,
        alpha: oldA * 0.9,
      }, t);
    }
    // 新形态淡入（带光环）
    const newA = Math.min(1, Math.max(0, (cy - 0.35) * 1.8));
    if (newA > 0.01) {
      renderCreature(ctx, {
        x: W / 2, y, size: baseR * form.sizeMul, shape: 'fish',
        palette: { body: '#2c4252', belly: '#41627a', fin: '#1a2c38' },
        tailPhase: t * 5, face: 1, vy: 0, striped: false,
        alpha: newA,
        glow: true,
      }, t);
    }

    // 文案
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, t / 0.5);
    ctx.fillStyle = '#ffe9c4';
    ctx.font = '600 34px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText(`化形 · ${form.name}`, W / 2, H / 2 - 110);
    const line = EVOLVE_LINES[(this.formIndex - 1) % EVOLVE_LINES.length];
    if (line) {
      ctx.fillStyle = 'rgba(232,246,255,0.75)';
      ctx.font = '300 18px "PingFang SC", "Microsoft YaHei", serif';
      ctx.fillText(line, W / 2, H / 2 + 130);
    }
    ctx.globalAlpha = 1;
  }
}
