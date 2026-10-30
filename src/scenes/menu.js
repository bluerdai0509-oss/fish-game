// ============================================================
// 主菜单：动态水面 + 漫游鱼群 + DOM 面板
// ============================================================
import { Scene } from '../engine/scenes.js';
import { Fish, ParticleSystem, BubbleField, makeReefs, drawReefs, drawWater } from '../engine/entities.js';
import { getAct } from '../engine/levels.js';
import { ui } from '../engine/ui.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

export class MenuScene extends Scene {
  enter() {
    ui.hidePause();
    ui.hideAllScreens();
    ui.showMenu(true);
    ui.showHud(false);
    ui.showGameOver(false);
    ui.showEnding(false);
    this.t = 0;
    this.act = getAct(1);
    this.fishes = [];
    const types = ['xiyu', 'tiaoyu', 'changyu', 'xiabing'];
    for (let i = 0; i < 7; i++) {
      const typeKey = types[i % types.length];
      const a = rand(0, TAU), d = rand(80, 560);
      this.fishes.push(new Fish(typeKey, {
        x: this.app.W / 2 + Math.cos(a) * d,
        y: this.app.H / 2 + Math.sin(a) * d,
        size: rand(12, 26), speed: rand(30, 60),
        heading: rand(0, TAU),
      }));
    }
    this.particles = new ParticleSystem();
    this.bubbles = new BubbleField();
    this.reefs = makeReefs(6, this.app.W, this.app.H);
  }
  exit() { ui.showMenu(false); }
  update(dt) {
    this.t += dt;
    const { W, H } = this.app;
    for (const f of this.fishes) {
      f.update(dt, this.t, null);
      // 漫游鱼：游太远 → 环绕补位
      if (Math.hypot(f.x - W / 2, f.y - H / 2) > 760) {
        const a = rand(0, TAU), d = rand(560, 700);
        f.x = W / 2 + Math.cos(a) * d;
        f.y = H / 2 + Math.sin(a) * d;
        f.heading = Math.atan2(H / 2 - f.y, W / 2 - f.x) + rand(-0.8, 0.8);
      }
    }
    this.bubbles.update(dt, { x0: 0, y0: 0, x1: W, y1: H });
    this.particles.update(dt);
  }
  render(ctx) {
    const { W, H } = this.app;
    drawWater(ctx, { x0: 0, y0: 0, x1: W, y1: H }, this.act.water, this.t);
    drawReefs(ctx, this.reefs, this.t);
    this.bubbles.render(ctx);
    for (const f of this.fishes) f.render(ctx, this.t);
    this.particles.render(ctx);
  }
}
