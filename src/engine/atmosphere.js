// ============================================================
// 立体光影：体积光柱 / 景深暗角 / 环境雾霭
// ------------------------------------------------------------
// 这三者共同制造"水下空间"的纵深感，全部用 GPU 绘制、零全屏上传：
//   1. god rays  —— 水面透下的倾斜光柱，随波缓慢摆动
//   2. depth fog —— 屏幕上下角的浓淡，模拟远处水体吞没光线
//   3. floaters  —— 近景悬浮微粒（对焦在玩家层，微粒越大越虚）
// ============================================================
import { Container, Sprite, Texture, CanvasSource, Graphics } from 'pixi.js';

/** 烘焙一根光柱的贴图（柔和渐变，两端收窄） */
let _rayTex = null;
function rayTexture() {
  if (_rayTex) return _rayTex;
  const W = 256, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // 横向：中间亮、两侧透明
  const hx = g.createLinearGradient(0, 0, W, 0);
  hx.addColorStop(0, 'rgba(255,255,255,0)');
  hx.addColorStop(0.42, 'rgba(255,255,255,0.55)');
  hx.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  hx.addColorStop(0.58, 'rgba(255,255,255,0.55)');
  hx.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hx;
  g.fillRect(0, 0, W, H);
  // 纵向：上亮下淡（光从水面射入）
  g.globalCompositeOperation = 'destination-in';
  const vy = g.createLinearGradient(0, 0, 0, H);
  vy.addColorStop(0, 'rgba(255,255,255,0.0)');
  vy.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  vy.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  vy.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = vy;
  g.fillRect(0, 0, W, H);

  const src = new CanvasSource({ resource: c });
  src.update();
  _rayTex = new Texture({ source: src });
  return _rayTex;
}

/**
 * 体积光柱层。
 * 放在世界坐标里（随相机移动），这样光柱像"从水面照下来的固定光"，
 * 玩家游动时会穿过光柱，纵深感最强。
 */
export class GodRays {
  constructor(count = 7) {
    this.container = new Container();
    this.container.eventMode = 'none';
    // 初始隐藏：update() 之前没有任何有效位置/尺寸，
    // 若此时可见，会在屏幕原点画出一块白色亮斑。
    this.container.visible = false;
    this.rays = [];
    this.color = 0xbff0ff;
    this.intensity = 0.38;
    const tex = rayTexture();

    for (let i = 0; i < count; i++) {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 0);
      s.__seed = i * 1.7 + Math.random() * 0.7;
      s.__speed = 0.08 + Math.random() * 0.10;
      s.__len = 700 + Math.random() * 600;
      s.__wide = 90 + Math.random() * 170;
      // 光从水面斜下射入：略微倾斜但不夸张（-12° ~ +4°）
      s.__tilt = -0.22 + Math.random() * 0.14;
      s.__offX = (i / count - 0.5) * 2400 + (Math.random() - 0.5) * 200;
      this.container.addChild(s);
      this.rays.push(s);
    }
  }

  setColor(tint) { this.color = tint; }
  setIntensity(v) { this.intensity = Math.max(0, v); }

  /**
   * 某世界坐标点的"受光强度" 0..1。
   * 用于让鱼游过光柱时被提亮 —— 这是光柱与主体产生交互的关键，
   * 否则光柱只是贴在背景上的一层装饰。
   */
  lightAt(x, y) {
    const cx = this.container.x;
    const cy = this.container.y;
    const lx = x - cx;          // 转成光柱容器的局部坐标
    const ly = y - cy;
    // 快速剔除：视口上半部才有光柱，下方直接跳过（省掉全部 ray 循环）
    if (ly > this._maxBottom) return 0;
    let best = 0;
    for (const s of this.rays) {
      // 把点旋转到光柱的本地坐标系（光柱沿 y 轴向下延伸）
      const c = Math.cos(-s.rotation), si = Math.sin(-s.rotation);
      const rx = lx - s.x;
      const ry = ly - s.y;
      const px = rx * c - ry * si;
      const py = rx * si + ry * c;
      if (py < 0 || py > s.height) continue;
      const halfW = s.width * 0.5;
      const dx = Math.abs(px);
      if (dx > halfW) continue;
      // 横向高斯衰减 × 纵向渐弱 × 该光柱当前亮度
      const lateral = 1 - (dx / halfW) * (dx / halfW);
      const along = 1 - (py / s.height) * 0.55;
      const v = lateral * along * (s.alpha / Math.max(0.001, this.intensity));
      if (v > best) best = v;
    }
    return best;
  }

  /** 光柱以世界坐标的"光锚点"为中心；锚点跟随相机但不完全同步，产生漂移感 */
  update(t, camX, camY, viewH = 900) {
    // 第一次 update 之后才显示（此时位置/尺寸已有效）
    this.container.visible = true;
    this.container.position.set(camX, camY);
    // 光从"屏幕上方之外"斜射进来：起点要在视口顶部之上，
    // 长度盖住整个视口，否则玩家只会看到一条贴在顶边的窄带。
    const topY = -viewH * 0.62;
    this._maxBottom = topY + viewH * 1.55 + 120;   // 光柱能照到的最下沿
    for (const s of this.rays) {
      const ph = t * s.__speed + s.__seed;
      // 横向缓慢摆动
      s.x = s.__offX + Math.sin(ph) * 120;
      // 顶端锚在视口上方，向下延伸
      s.y = topY + Math.sin(ph * 0.7) * 40;
      s.rotation = s.__tilt + Math.sin(ph * 0.9) * 0.035;
      s.width = s.__wide * (0.9 + Math.sin(ph * 1.3) * 0.12);
      // 长度必须够覆盖视口（含倾斜余量）
      s.height = viewH * 1.55 + s.__len * 0.15;
      // 明暗呼吸：不同光柱错开，避免整片一起闪
      const k = 0.65 + Math.sin(ph * 1.7) * 0.35;
      s.alpha = this.intensity * k;
      s.tint = this.color;
    }
  }
}

/**
 * 景深远近雾：屏幕空间的上下压暗层。
 * 用 Graphics 画，只在尺寸变化时重建。
 */
export class DepthFog {
  constructor() {
    this.g = new Graphics();
    this.g.eventMode = 'none';
    this._key = '';
    this.color = 0x08202e;
    this.strength = 0.5;
  }

  setColor(tint) { this.color = tint; }

  resize(W, H) {
    const key = `${W}x${H}`;
    if (key === this._key) return;
    this._key = key;
    const g = this.g;
    g.clear();
    // 上下两条渐变压暗带：模拟远处水体吞没光线的效果。
    // Pixi Graphics 没有渐变填充，用多条不同 alpha 的矩形叠出渐变，
    // 段数固定（12 段），只在 resize 时构建一次。
    const N = 12;
    const bandH = H * 0.20;
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      const a = (1 - k) * 0.10 * this.strength;
      g.rect(0, k * bandH, W, bandH / N + 1).fill({ color: this.color, alpha: a });
      g.rect(0, H - k * bandH - bandH / N - 1, W, bandH / N + 1).fill({ color: this.color, alpha: a });
    }
    // 左右极淡的侧压暗，收拢视线
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1);
      const a = (1 - k) * 0.05 * this.strength;
      const bandW = W * 0.10;
      g.rect(k * bandW, 0, bandW / N + 1, H).fill({ color: this.color, alpha: a });
      g.rect(W - k * bandW - bandW / N - 1, 0, bandW / N + 1, H).fill({ color: this.color, alpha: a });
    }
  }
}

/**
 * 近景悬浮微粒：比气泡更小、更密，且按深度分层大小。
 * 用来强化"镜头前有空间"的感知 —— 这是伪 3D 最廉价的线索。
 */
export class FloatingMotes {
  constructor(count = 90) {
    this.container = new Container();
    this.container.eventMode = 'none';
    this.items = [];
    this._tex = null;
  }

  _texture() {
    if (this._tex) return this._tex;
    const S = 32;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const rad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rad.addColorStop(0, 'rgba(255,255,255,0.95)');
    rad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rad;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.fill();
    const src = new CanvasSource({ resource: c });
    src.update();
    this._tex = new Texture({ source: src });
    return this._tex;
  }

  /** 微粒在世界坐标里缓慢漂浮，按 z 分层 */
  init() {}

  update(t, camX, camY, viewW, viewH) {
    const tex = this._texture();
    const N = 90;
    // 惰性创建：第一次 update 时才建 sprite（需要 texture）
    if (!this.items.length) {
      for (let i = 0; i < N; i++) {
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.__z = Math.random();                       // 0 远 → 1 近
        s.__x = (Math.random() - 0.5) * 2.2;         // 视野归一化坐标
        s.__y = (Math.random() - 0.5) * 2.2;
        s.__ph = Math.random() * Math.PI * 2;
        s.__sp = 0.04 + Math.random() * 0.10;
        this.container.addChild(s);
        this.items.push(s);
      }
    }
    for (const s of this.items) {
      const z = s.__z;
      // 近处微粒更大、更虚；远处更小更淡
      const size = 1.6 + z * 7.5;
      const drift = t * s.__sp * (0.4 + z);
      // 相对相机的位置：近层随相机平移更多（视差）
      const ax = s.__x * viewW * 0.62 + Math.sin(drift + s.__ph) * 26;
      const ay = s.__y * viewH * 0.62 + Math.cos(drift * 0.8 + s.__ph) * 22;
      const par = 0.35 + z * 0.9;
      s.x = camX + ax * par;
      s.y = camY + ay * par;
      s.width = size;
      s.height = size;
      s.alpha = 0.06 + z * 0.22;
      s.tint = 0xdff4ff;
    }
  }
}