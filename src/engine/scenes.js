// ============================================================
// 场景基类 + 场景管理器（淡入淡出切换）
// 场景清单：menu / actintro / play / evolve / ending / gameover
// ============================================================
export class Scene {
  /** @param {import('../main.js').App} app */
  constructor(app) { this.app = app; }
  enter(params) {} exit() {}
  update(dt) {} render(ctx) {}
}

export class SceneManager {
  constructor(app, sceneMap) {
    this.app = app;
    this.sceneMap = sceneMap;
    this.current = null;
    this.name = '';
    this.fade = 1;          // 1 = 全黑
    this.fadeDir = -1;      // -1 淡入中, 0 停, 1 淡出中
    this.pending = null;    // { name, params }
  }
  switchTo(name, params = {}) {
    this.pending = { name, params };
    this.fadeDir = 1;
  }
  _doSwitch(name, params) {
    if (this.current) this.current.exit();
    const S = this.sceneMap[name];
    this.current = new S(this.app);
    this.current.name = name;
    this.name = name;
    // 只有 play 场景需要游戏世界层（光柱/微粒/雾/实体）。
    // 其他场景里这些层没有任何有效状态，留着会露出初始默认值。
    const be = this.app.backend;
    if (be && be.setWorldMode) be.setWorldMode(name === 'play');
    this.current.enter(params || {});
  }
  update(dt) {
    if (this.pending && this.fadeDir === 1) {
      this.fade += dt * 2.6;
      if (this.fade >= 1) {
        this.fade = 1;
        this._doSwitch(this.pending.name, this.pending.params);
        this.pending = null;
        this.fadeDir = -1;
      }
    } else if (this.fadeDir === -1) {
      this.fade = Math.max(0, this.fade - dt * 2.2);
      if (this.fade <= 0) this.fadeDir = 0;
    }
    if (this.current) this.current.update(dt);
  }
  render(ctx) {
    if (this.current) this.current.render(ctx);
    // 淡入淡出：
    //   - Pixi 后端走 GPU（见 Renderer.setFade）—— 游戏场景不用 canvas 层，
    //     若画在 ctx 上过场黑幕会完全丢失；
    //   - Canvas2D 后端仍直接画到主画布。
    const be = this.app.backend;
    if (be && be.setFade) be.setFade(this.fade);
    if (this.fade > 0.001 && (!be || be.needsCtxFade)) {
      const { W, H } = this.app;
      ctx.fillStyle = `rgba(2, 8, 14, ${this.fade})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}
