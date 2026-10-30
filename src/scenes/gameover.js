// ============================================================
// 结算：从当前关重开（关内检查点，不清全局进度）
// ============================================================
import { Scene } from '../engine/scenes.js';
import { getLevel } from '../engine/levels.js';
import { ui } from '../engine/ui.js';

const ACT_NAMES = { 1: '江河', 2: '湖海', 3: '北冥' };

export class GameOverScene extends Scene {
  enter() {
    const run = this.app.run;
    const cfg = getLevel(run.levelId);
    ui.showHud(false);
    ui.hideAllScreens();
    ui.showGameOver(true);
    ui.showEnding(false);
    ui.setGameOverStats({
      score: run.score,
      actLabel: `${ACT_NAMES[cfg.act]} ${cfg.id} · ${cfg.name}`,
      eaten: run.eaten,
    });
    this.t = 0;
  }
  update(dt) { this.t += dt; }
  render(ctx) {
    const { W, H } = this.app;
    ctx.fillStyle = '#04101c';
    ctx.fillRect(0, 0, W, H);
  }
}
