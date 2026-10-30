// ============================================================
// 幕间标题卡：幕名 + 诗句，2.6s 自动进入或任意键跳过
// ============================================================
import { Scene } from '../engine/scenes.js';
import { getAct } from '../engine/levels.js';
import { ui } from '../engine/ui.js';

export class ActIntroScene extends Scene {
  enter({ actId, levelId }) {
    this.act = getAct(actId);
    this.levelId = levelId;
    this.t = 0;
    this.dur = 2.6;
    this.skipped = false;
    ui.showHud(false);
    ui.hideAllScreens();
    ui.showGameOver(false);
    ui.showEnding(false);
  }
  update(dt) {
    this.t += dt;
    const input = this.app.input;
    if (this.t > 0.5 && (input.clickQueued || input.anyKey)) this.skipped = true;
    if (this.t >= this.dur || this.skipped) {
      input.clickQueued = false; input.anyKey = false;
      this.app.scenes.switchTo('play', { levelId: this.levelId });
    }
  }
  render(ctx) {
    const { W, H } = this.app;
    const a = this.act;
    // 幕水色预览
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, a.water.top);
    g.addColorStop(1, a.water.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 暗角
    ctx.fillStyle = 'rgba(2,8,14,0.35)';
    ctx.fillRect(0, 0, W, H);

    const fade = Math.min(1, this.t / 0.6);
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe9c4';
    ctx.font = '600 44px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText(a.name, W / 2, H / 2 - 30);
    ctx.fillStyle = 'rgba(232,246,255,0.8)';
    ctx.font = '300 20px "PingFang SC", "Microsoft YaHei", serif';
    ctx.fillText(a.poetic, W / 2, H / 2 + 24);
    ctx.globalAlpha = fade * 0.6;
    ctx.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('任意键 继续', W / 2, H / 2 + 80);
    ctx.globalAlpha = 1;
  }
}
