// ============================================================
// 相机：x/y 平移 + zoom + shake，ctx.setTransform 封装
// Ending 拉远 / 扶摇直上用；Gameplay 固定镜头 + shake
// ============================================================
export class Camera {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.x = 0; this.y = 0;
    this.zoom = 0.95;   // 广角视野：铺满屏幕
    this.shake = 0;
  }
  addShake(v) { if (this.enabled !== false) this.shake = Math.max(this.shake, v); }
  update(dt) { this.shake = Math.max(0, this.shake - dt * 30); }
  reset() { this.x = 0; this.y = 0; this.zoom = 0.95; this.shake = 0; }
  apply(ctx) {
    ctx.save();
    const jx = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake : 0;
    const jy = this.shake > 0 ? (Math.random() * 2 - 1) * this.shake : 0;
    // screen = (world - cam) * zoom + center
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + jx, -this.y + jy);
  }
  restore(ctx) { ctx.restore(); }
}
