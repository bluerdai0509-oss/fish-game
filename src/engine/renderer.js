// ============================================================
// 渲染后端抽象层
// ------------------------------------------------------------
// 游戏逻辑不知道底层是 Canvas2D 还是 WebGL。
//
// Canvas2D 后端：直接画到主 canvas
// PixiJS 后端：每个实体 = 一个 GPU Sprite。
//   纹理只在首次出现时从离屏 canvas 上传一次，
//   之后每帧只更新 position / rotation / alpha，
//   复杂的渐变描边全部在 GPU 上，CPU 几乎零成本。
// ============================================================
import { Application, Sprite, Texture, Container, CanvasSource, Graphics, Text } from 'pixi.js';
import { getEntitySprite, renderKun as renderKunForTexture } from './fishrender.js';
import { getObstacleSprite } from './obstacles.js';
import { createItemPreviewCanvas } from './entities.js';
import { ParticlePool, softDotTexture, streakTexture, toTint, cssAlpha } from './gfx.js';
import { DEPTH, mixTint } from './depth.js';
import { GodRays, DepthFog, FloatingMotes } from './atmosphere.js';
import { zoneTexture } from './zones.js';

/** 离屏 canvas -> GPU 纹理（WeakMap 保证每个 canvas 只上传一次） */
const _texCache = new WeakMap();
function textureOf(canvas) {
  let tex = _texCache.get(canvas);
  if (!tex) {
    const src = new CanvasSource({ resource: canvas });
    src.update();                       // 标记需要上传（canvas 此刻已有内容）
    tex = new Texture({ source: src });
    _texCache.set(canvas, tex);
  }
  return tex;
}

/**
 * 精灵按超采样烘焙后需要缩回逻辑尺寸，缩小采样方式直接决定观感：
 * linear 在高倍缩小时会糊掉细线，mipmap 才能保住鳞片和鳍条的锐度。
 */
function applySpriteSampling(spr) {
  const s = spr.texture.source;
  s.scaleMode = 'linear';
  s.autoGenerateMipmaps = true;
  s.mipmapFilter = 'linear';
}

/**
 * 道具贴图：复用 Item 自己的 Canvas 绘制，只烘焙一次。
 * 道具种类只有 3 种，缓存后零成本。
 */
const _itemTexCache = new Map();
function itemTexture(kind) {
  if (_itemTexCache.has(kind)) return _itemTexCache.get(kind);
  if (typeof createItemPreviewCanvas !== 'function') return null;
  const c = createItemPreviewCanvas(kind);
  if (!c) return null;
  const src = new CanvasSource({ resource: c });
  src.update();
  const tex = new Texture({ source: src });
  _itemTexCache.set(kind, tex);
  return tex;
}

// ============================================================
// Canvas 2D 后端
// ============================================================
export class Canvas2DBackend {
  constructor(canvas) {
    this.type = 'canvas2d';
    this.domCanvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
  }
  async init() { return this; }
  resize(W, H) {
    this.W = W; this.H = H;
    this.domCanvas.width = W;
    this.domCanvas.height = H;
  }
  begin() {
    this.ctx.clearRect(0, 0, this.W, this.H);
    return this.ctx;
  }
  end() {}

  /** Canvas2D 没有 Sprite 概念 —— 下面这些是空实现，
   *  实体会走 scene.render() 里的传统绘制路径 */
  get usesSprites() { return false; }
  syncEntities() {}
  beginWorld() {}
  endWorld() {}
  syncParticles() {}
  syncBubbles() {}
  syncStreaks() {}
  syncZones() {}
  syncItems() {}
  syncMouseTarget() {}
  syncScreenText() {}
  setHurtFlash() {}
  /** Canvas2D 后端没有 GPU 层，淡入淡出由 SceneManager 直接画到 ctx */
  get needsCtxFade() { return true; }
  setFade() {}
  setWorldMode() {}
  skipCanvasScene() {}
}

// ============================================================
// PixiJS 后端（原生 Sprite）
// ============================================================
export class PixiBackend {
  constructor(canvas) {
    this.type = 'pixi';
    this.domCanvas = canvas;
    this.W = canvas.width;
    this.H = canvas.height;
    this.app = null;
    this.world = null;        // 随相机变换的层（鱼群 / 障碍 / 玩家 / 粒子 / 流线）
    this.bgLayer = null;
    this._sprMap = new WeakMap();   // entity -> Sprite
    // 以下为 GPU 原生特效（不再有每帧全屏 canvas 上传）
    this.particles = null;    // 粒子池
    this.bubbles = null;      // 气泡池
    this.streaks = null;      // 水流流线池
    this.fxRoot = null;       // 世界坐标系下的特效根
    this.hudLayer = null;     // 屏幕空间层（红屏等）
    this._hudCanvas = null;
    this._hudCtx = null;
    this._hudSprite = null;
  }

  async init() {
    this.app = new Application();
    await this.app.init({
      width: this.W,
      height: this.H,
      antialias: true,
      // 保留绘制缓冲：否则截图 / 录屏 / toDataURL 抓到的是空帧
      preserveDrawingBuffer: true,
      background: '#04121f',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });

    const holder = this.domCanvas.parentNode;
    holder.replaceChild(this.app.canvas, this.domCanvas);
    this.domCanvas = this.app.canvas;
    this.domCanvas.id = 'game';
    this.domCanvas.style.display = 'block';

    // 层顺序（由下至上）：
    //   bgLayer(水体) → world(实体 + 特效) → hudLayer(屏幕空间，仅在需要时上传)
    // 特效全部并入 world，跟随同一套相机变换，不再需要独立的 CPU 画布。
    this.bgLayer = new Container();
    this.world = new Container();
    this.hudLayer = new Container();
    // 场景层：给菜单/幕间/结算等 Canvas2D 场景用，位于世界之上、HUD 之下
    this.sceneLayer = new Container();
    this.app.stage.addChild(this.bgLayer, this.world, this.sceneLayer, this.hudLayer);

    // ---- 立体光影（伪 3D 的核心）----
    this.world.sortableChildren = true;
    // 体积光柱：直接放进 world（不带 zIndex 的容器默认 0，
    // 靠 zIndex = -99999 保证压在所有实体之下、背景之上）
    this.godRays = new GodRays(7);
    this.godRays.container.zIndex = -99999;
    this.world.addChild(this.godRays.container);
    // 光柱照射查询：实体同步时用它给鱼提亮
    this._rayLight = (x, y, t) => this.godRays.lightAt(x, y);
    // 近景悬浮微粒：压在实体之上（zIndex 极大）
    this.motes = new FloatingMotes();
    this.motes.container.zIndex = 99999;
    // 景深雾：屏幕空间，叠在 hud 之下
    this.depthFog = new DepthFog();
    this.app.stage.addChildAt(this.depthFog.g, 2);
    // 微粒在实体之后；world 已开 sortableChildren，用 zIndex 控制
    this.world.addChild(this.motes.container);

    // ---- GPU 原生特效池 ----
    this.fxRoot = new Container();
    this.particles = new ParticlePool(softDotTexture(), 256);
    this.bubbles = new ParticlePool(softDotTexture(), 64);
    // 流线：视野内约 600~1400 条（随缩放变化），1280 起步、按需扩容
    this.streaks = new ParticlePool(streakTexture(), 1280);
    this.fxRoot.addChild(this.particles.container, this.bubbles.container, this.streaks.container);
    this.world.addChild(this.fxRoot);

    // 需要 Canvas 绘制但尺寸很小的内容（道具 / Boss / 鼠标准星）。
    // 统一放进一张"局部画布"，只上传这一小块，而不是整屏 6MB。
    this.smallLayer = new Container();
    this.world.addChild(this.smallLayer);
    this._smallSprite = null;
    this._smallCanvas = null;
    this._smallCtx = null;
    this._smallUsed = false;

    // 停止 Pixi 自带 ticker —— 渲染节奏由主循环控制，避免双重渲染
    this.app.ticker.stop();

    return this;
  }

  get usesSprites() { return true; }
  /** Pixi 后端用 GPU 画淡入淡出，不要重复画到 ctx */
  get needsCtxFade() { return false; }

  /** 设置当前幕的深度雾色（css 颜色字符串或数字） */
  setFog(color) {
    this._fogColor = typeof color === 'number' ? color : toTint(color);
  }

  /**
   * 按幕调整大气参数。
   * 深水（北冥）光柱更冷更亮、雾更浓 —— 暗底上的光才更像"穿透深水的光"；
   * 浅水（江河）光柱偏暖偏淡，避免压过明快的水色。
   */
  setAtmosphere(actId, dark) {
    if (this._atmoAct === actId) return;
    this._atmoAct = actId;
    if (dark) {
      this.godRays.setColor(0x8fc8ff);
      this.godRays.setIntensity(0.34);
      this.depthFog.color = 0x03060c;
      this.depthFog.strength = 0.9;
    } else if (actId === 2) {
      this.godRays.setColor(0xc8ecff);
      this.godRays.setIntensity(0.26);
      this.depthFog.color = 0x08202e;
      this.depthFog.strength = 0.6;
    } else {
      this.godRays.setColor(0xd8f6ff);
      this.godRays.setIntensity(0.24);
      this.depthFog.color = 0x0a2a26;
      this.depthFog.strength = 0.45;
    }
    this.depthFog._key = '';   // 强制重绘雾层
  }

  /**
   * 设置静态背景（水体渐变 + 焦散瓦片）。
   * 只在场景切换/分辨率变化时重绘一次，之后每帧零成本。
   */
  setBackground(drawFn, W, H) {
    const key = `${W}x${H}`;
    if (this._bgKey === key && this._bgSprite) return;

    if (!this._bgCanvas) {
      this._bgCanvas = document.createElement('canvas');
    }
    this._bgCanvas.width = W;
    this._bgCanvas.height = H;
    const g = this._bgCanvas.getContext('2d');
    drawFn(g, W, H);

    if (this._bgSprite) {
      this.bgLayer.removeChild(this._bgSprite);
      this._bgSprite.destroy({ texture: false });
      // 画布内容变了但同一个 canvas 复用 → 必须换新纹理，否则 GPU 上还是旧图
      this._bgSprite = null;
    }
    this._bgCanvasKey = key;
    const tex = textureOf(this._bgCanvas);
    tex.source.update();
    this._bgSprite = new Sprite(tex);
    this._bgSprite.width = W;
    this._bgSprite.height = H;
    // 背景固定在屏幕坐标系：由外层容器施加逆变换，见 beginWorld
    this._bgSprite.eventMode = 'none';
    this.bgLayer.addChild(this._bgSprite);

    this._bgKey = key;
  }

  resize(W, H) {
    this.W = W; this.H = H;
    if (this.app && this.app.renderer) this.app.renderer.resize(W, H);
    this._hudCanvas = null;  // 强制重建屏幕空间层
  }

  /**
   * begin() 返回绘制上下文。
   *
   * 注意这里的分工：
   *   - PlayScene 走 GPU sprite 路径，内部根本不用这个 ctx（传进去也不画）；
   *   - 菜单 / 幕间 / 结算等场景仍是纯 Canvas2D 绘制，它们需要一张**真实尺寸**
   *     的画布，画完后由 end() 上传一次。
   *
   * 之前这里返回 2×2 的 scratch，导致所有纯 Canvas 场景被画进一个 4 像素的
   * 画布里 —— 表现为切场景时整个画面消失、只剩背景色。
   */
  begin() {
    return this._sceneCtx();
  }

  /**
   * 场景级 2D 画布（真实屏幕尺寸）。
   * 只在"该场景确实要 Canvas 绘制"时才创建并清空，PlayScene 不碰它。
   */
  _sceneCtx() {
    if (!this._sceneCanvas || this._sceneCanvas.width !== this.W || this._sceneCanvas.height !== this.H) {
      this._sceneCanvas = document.createElement('canvas');
      this._sceneCanvas.width = this.W;
      this._sceneCanvas.height = this.H;
      this._sceneCtx2d = this._sceneCanvas.getContext('2d');
      if (this._sceneSprite) {
        this.sceneLayer.removeChild(this._sceneSprite);
        this._sceneSprite.destroy({ texture: false });
      }
      const tex = textureOf(this._sceneCanvas);
      tex.source.update();
      this._sceneSprite = new Sprite(tex);
      this.sceneLayer.addChild(this._sceneSprite);
    }
    this._sceneCtx2d.setTransform(1, 0, 0, 1, 0, 0);
    this._sceneCtx2d.clearRect(0, 0, this.W, this.H);
    this._sceneDirty = true;
    return this._sceneCtx2d;
  }

  /**
   * 过场黑幕：由 SceneManager 每帧写入 0..1。
   * 走 GPU Graphics，零上传 —— 这样无论当前是游戏场景（跳过 canvas 层）
   * 还是菜单场景，淡入淡出都能正常显示。
   */
  setFade(alpha) {
    if (!this._fadeG) {
      this._fadeG = new Graphics();
      this._fadeG.eventMode = 'none';
      // 放在 hudLayer 之下、场景层之上
      this.hudLayer.addChildAt(this._fadeG, 0);
    }
    const a = Math.max(0, Math.min(1, alpha));
    if (a <= 0.002) {
      this._fadeG.visible = false;
      return;
    }
    this._fadeG.visible = true;
    const key = `${Math.round(a * 64)}|${this.W}x${this.H}`;
    if (this._fadeKey === key) return;
    this._fadeKey = key;
    this._fadeG.clear();
    this._fadeG.rect(0, 0, this.W, this.H).fill({ color: 0x020810, alpha: a });
  }

  /**
   * 判断本帧是否需要 Canvas 场景层。
   * PlayScene 会显式关闭，避免白白重建整屏画布。
   */
  beginCanvasScene() { return this._sceneCtx(); }

  /**
   * 非游戏场景（菜单 / 幕间 / 结算）：隐藏所有"游戏世界"专用层。
   * 这些层在 PlayScene 之外没有任何有效状态（光柱、微粒、雾、实体），
   * 留着会露出初始化时的默认值 —— 表现为屏幕原点一块白色亮斑。
   */
  setWorldMode(on) {
    if (this._worldMode === on) return;
    this._worldMode = on;
    this.world.visible = on;
    this.depthFog.g.visible = on;
    // 场景层反过来：PlayScene 下不需要
    if (this._sceneSprite) this._sceneSprite.visible = !on;
    if (!on) {
      // 离开游戏时清空实体精灵，避免切入菜单时残留一帧
      this._cleanup(new Set());
      this.clearBossCanvas();
    }
  }

  skipCanvasScene() {
    this._sceneDirty = false;
    if (this._sceneSprite) this._sceneSprite.visible = false;
  }

  /**
   * 屏幕空间绘制上下文。
   * 注意：这是唯一还会产生纹理上传的路径，只用于"确实无法 GPU 化"的内容。
   * 受击红屏已改为 GPU Graphics 绘制（见 setHurtFlash），走不到这里。
   */
  beginHud() {
    if (!this._hudCanvas || this._hudCanvas.width !== this.W || this._hudCanvas.height !== this.H) {
      this._hudCanvas = document.createElement('canvas');
      this._hudCanvas.width = this.W;
      this._hudCanvas.height = this.H;
      this._hudCtx = this._hudCanvas.getContext('2d');

      if (this._hudSprite) this.hudLayer.removeChild(this._hudSprite);
      this._hudSprite = new Sprite(textureOf(this._hudCanvas));
      this._hudSprite.texture.source.update();
      this.hudLayer.addChild(this._hudSprite);
    }
    this._hudCtx.clearRect(0, 0, this.W, this.H);
    this._hudDirty = true;
    return this._hudCtx;
  }

  /**
   * 受击红屏：用 GPU Graphics 画，零上传。
   * 构图与旧版一致：整屏红 + 边缘加重（中心留一点通透）。
   */
  setHurtFlash(k) {
    if (!this._flashG) {
      this._flashG = new Graphics();
      this._flashG.eventMode = 'none';
      this.hudLayer.addChild(this._flashG);
    }
    const W = this.W, H = this.H;
    if (!(k > 0.001)) {
      this._flashG.visible = false;
      return;
    }
    this._flashG.visible = true;
    this._flashG.clear();
    // 整屏红
    this._flashG.rect(0, 0, W, H).fill({ color: 0xd62020, alpha: Math.min(1, k) * 0.30 });
    // 边缘加重：四条渐变带（用矩形近似径向渐变，成本极低）
    const edge = Math.min(W, H) * 0.22;
    const a = Math.min(1, k) * 0.42;
    this._flashG.rect(0, 0, W, edge).fill({ color: 0xbe0a0a, alpha: a * 0.75 });
    this._flashG.rect(0, H - edge, W, edge).fill({ color: 0xbe0a0a, alpha: a * 0.75 });
    this._flashG.rect(0, 0, edge, H).fill({ color: 0xbe0a0a, alpha: a * 0.55 });
    this._flashG.rect(W - edge, 0, edge, H).fill({ color: 0xbe0a0a, alpha: a * 0.55 });
  }

  end() {
    // 只有显式调用过 beginHud() 才上传（受击红屏已 GPU 化，常规帧不会走到）
    if (this._hudDirty && this._hudSprite) {
      this._hudSprite.texture.source.update();
      this._hudDirty = false;
    }
    // 场景层：Canvas 场景（菜单/幕间/结算）画完后上传一次；
    // PlayScene 每帧都会 skipCanvasScene()，所以这里不会上传
    if (this._sceneDirty && this._sceneSprite) {
      this._sceneSprite.visible = true;
      this._sceneSprite.texture.source.update();
      this._sceneDirty = false;
    }
    this.app.render();
  }

  /**
   * Boss / 唤雨专用的局部画布。
   *
   * 整个游戏里只剩这两类内容还在用 Canvas 2D 绘制（Boss 有 120+ 处
   * save/path/gradient 调用，逐个改写成 Pixi 图形工作量极大且易出错）。
   * 折中方案：把它们画在一张以 Boss 为中心的局部画布上，只上传这一块。
   *
   * 尺寸 1024² 对于 Boss（半径约 90~160px）绰绰有余，
   * 相比原先的整屏 1440×1100 上传量降到约 1/1.5，且与屏幕分辨率无关。
   */
  beginBossCanvas(worldX, worldY) {
    const SIZE = 1024;
    if (!this._bossCanvas) {
      this._bossCanvas = document.createElement('canvas');
      this._bossCanvas.width = this._bossCanvas.height = SIZE;
      this._bossCtx = this._bossCanvas.getContext('2d');
      this._bossSprite = new Sprite(textureOf(this._bossCanvas));
      this._bossSprite.anchor.set(0.5);
      this._bossSprite.eventMode = 'none';
      this.smallLayer.addChild(this._bossSprite);
    }
    const g = this._bossCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);
    // 局部坐标：以 (worldX, worldY) 为原点
    g.translate(SIZE / 2 - worldX, SIZE / 2 - worldY);
    this._bossOrigin = { x: worldX, y: worldY };
    this._bossUsed = true;
    return g;
  }

  endBossCanvas(worldX, worldY) {
    if (!this._bossUsed || !this._bossSprite) return;
    this._bossSprite.position.set(worldX, worldY);
    this._bossSprite.visible = true;
    this._bossSprite.texture.source.update();
    this._bossUsed = false;
  }

  /** Boss 消失时隐藏并跳过上传（避免无谓的显存带宽） */
  clearBossCanvas() {
    if (this._bossSprite && this._bossSprite.visible) {
      this._bossSprite.visible = false;
      this._bossUsed = false;
    }
  }

  /** 应用相机到 Pixi 世界容器 */
  beginWorld(cam, time) {
    if (!this.world) return;
    this._time = time || 0;
    // 深度排序依赖 zIndex：开启后 Pixi 会按 zIndex 决定绘制顺序
    this.world.sortableChildren = true;
    this._camRef = cam;

    // ---- 立体光影驱动 ----
    const t = this._time || 0;
    this.godRays.update(t, cam.x, cam.y, this.H / cam.zoom);
    this.motes.update(t, cam.x, cam.y, this.W / cam.zoom, this.H / cam.zoom);
    this.depthFog.resize(this.W, this.H);

    const jx = cam.shake > 0 ? (Math.random() * 2 - 1) * cam.shake : 0;
    const jy = cam.shake > 0 ? (Math.random() * 2 - 1) * cam.shake : 0;
    this.world.scale.set(cam.zoom);
    this.world.position.set(
      this.W / 2 - (cam.x + jx) * cam.zoom,
      this.H / 2 - (cam.y + jy) * cam.zoom
    );
  }
  endWorld() {}

  // ============================================================
  // GPU 特效同步（替代原先"画到全屏 canvas 再上传"的做法）
  // 全部在世界坐标系下，随 world 容器的相机变换自动跟随。
  // ============================================================

  /** 粒子：圆形软点，颜色取粒子自带的 color 字符串 */
  syncParticles(list) {
    const pool = this.particles;
    if (!pool) return;
    pool.begin();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.life <= 0) continue;
      const q = pool.next();
      const lifeK = p.maxLife ? Math.max(0, Math.min(1, p.life / p.maxLife)) : 1;
      // 贴图直径 64，粒子半径 r → 直径 2r
      const sc = (p.r * 2) / 64;
      q.x = p.x;
      q.y = p.y;
      q.scaleX = sc;
      q.scaleY = sc;
      q.alpha = lifeK * cssAlpha(p.color);
      q.tint = toTint(p.color);
      q.rotation = 0;
    }
    pool.end();
  }

  /** 气泡：空心圆环用软点近似（低透明度边缘更自然），随水流漂移 */
  syncBubbles(list) {
    const pool = this.bubbles;
    if (!pool) return;
    pool.begin();
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const q = pool.next();
      const sc = (b.r * 2.6) / 64;
      q.x = b.x;
      q.y = b.y;
      q.scaleX = sc;
      q.scaleY = sc;
      q.alpha = Math.max(0.06, Math.min(0.38, 0.42 - b.r * 0.032));
      q.tint = 0xd6f0ff;
      q.rotation = 0;
    }
    pool.end();
  }

  /**
   * 水流流线：细长条贴图 + 旋转到流向。
   * 采样点数固定（与视野内格子数一致），全部一次 draw call。
   */
  /**
   * 特殊物理区域：每个区域一张烘焙贴图 + 自转/呼吸。
   * 区域是"有物理的地方"，必须让玩家一眼看出边界，所以画得比流线明确得多。
   */
  syncZones(zones) {
    if (!this._zoneLayer) {
      this._zoneLayer = new Container();
      this._zoneLayer.zIndex = -50000;   // 在流线之下、光柱之上
      this.world.addChild(this._zoneLayer);
      this._zoneMap = new Map();
    }
    const live = new Set(zones);
    for (const z of zones) {
      let spr = this._zoneMap.get(z);
      if (!spr) {
        // zoneTexture 返回 { canvas, w, h, cx, cy }：
        // 急流是按实际曲线烘焙的长条贴图，各自尺寸不同
        const baked = zoneTexture(z);
        const tex = textureOf(baked.canvas);
        tex.source.update();
        spr = new Sprite(tex);
        // 以贴图里"带子中心"为锚点，急流旋转时才绕自己的中心转
        spr.anchor.set(baked.cx / baked.w, baked.cy / baked.h);
        spr.__zone = z;
        spr.__baked = baked;
        this._zoneLayer.addChild(spr);
        this._zoneMap.set(z, spr);
      }
      spr.position.set(z.x, z.y);
      // 贴图已按区域真实尺寸烘焙 → 直接 1:1 摆放，不再缩放
      const breath = 1 + Math.sin(z.t * 1.5 + z.seed) * 0.02;
      spr.scale.set(breath);
      // 急流不转（它是有方向的河道段）；漩涡/涌泉自转
      spr.rotation = z.kind === 'rapids' ? z.angle : z.t * z.spin;
      spr.tint = z.color;
      // 区域是"有物理的地方"，必须清晰可见
      spr.alpha = 0.46 + Math.sin(z.t * 1.2 + z.seed) * 0.05;
    }
    // 回收已移除的区域
    for (const [z, spr] of this._zoneMap) {
      if (!live.has(z)) {
        this._zoneLayer.removeChild(spr);
        spr.destroy({ texture: false });
        this._zoneMap.delete(z);
      }
    }
  }

  syncStreaks(samples, dark) {
    const pool = this.streaks;
    if (!pool) return;
    pool.begin();
    const tint = dark ? 0xb4dcff : 0xecfcff;
    // 流线压暗：现在有光柱和微粒了，流线不该再抢主体。
    // 深色幕尤其要收 —— 暗底上白线对比极强，稍高就变成"满屏划痕"。
    const gain = dark ? 0.30 : 0.38;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (!s || s.speed < 8) continue;
      const q = pool.next();
      // 流线长度随流速，宽度保持细
      const lenK = Math.min(1.6, s.speed / 240);
      const len = 20 + lenK * 78;
      const scX = len / 128;
      const scY = (dark ? 1.5 : 1.2) / 16;
      q.x = s.x;
      q.y = s.y;
      q.scaleX = scX;
      q.scaleY = scY;
      q.rotation = Math.atan2(s.vy, s.vx);
      q.alpha = (dark
        ? Math.min(0.42, 0.10 + lenK * 0.30)
        : Math.min(0.34, 0.07 + lenK * 0.24)) * gain;
      q.tint = tint;
    }
    pool.end();
  }

  /**
   * 道具：每种道具的图形只烘焙一次，之后每次拾取都用同一张纹理。
   * 道具在世界里最多十几个，用 Sprite 池，零上传。
   */
  syncItems(items) {
    if (!this._itemPool) this._itemPool = [];
    const live = new Set(items);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      let spr = this._sprMap.get(it);
      if (!spr) {
        const tex = itemTexture(it.kind);
        if (!tex) continue;
        spr = new Sprite(tex);
        spr.anchor.set(0.5);
        spr.__item = it;
        this.smallLayer.addChild(spr);
        this._sprMap.set(it, spr);
        this._itemPool.push(spr);
      }
      spr.position.set(it.x, it.drawY);
      // 呼吸缩放：轻微脉动，提示"可拾取"
      const bob = 1 + Math.sin((it.bob || 0) * 2) * 0.06;
      spr.scale.set(bob);
      spr.rotation = 0;
      spr.visible = true;
    }
    // 回收已消失的道具精灵
    for (let i = this._itemPool.length - 1; i >= 0; i--) {
      const spr = this._itemPool[i];
      if (!live.has(spr.__item)) {
        this.smallLayer.removeChild(spr);
        this._sprMap.delete(spr.__item);
        spr.destroy({ texture: false });
        this._itemPool.splice(i, 1);
      }
    }
  }

  /**
   * 鼠标目标准星：一个 Graphics，内容只在半径变化超过阈值时重建。
   * 每帧只改 position，无重建、无上传。
   */
  syncMouseTarget(worldPos, t) {
    if (!this._cursorG) {
      this._cursorG = new Graphics();
      this._cursorG.eventMode = 'none';
      this.world.addChild(this._cursorG);
      this._cursorPulse = -1;
    }
    const g = this._cursorG;
    if (!worldPos) { g.visible = false; return; }
    g.visible = true;
    g.position.set(worldPos.x, worldPos.y);

    // 脉动量化到 0.25 档，避免每帧重建图形
    const pulse = Math.round((1 + Math.sin(t * 5) * 0.15) * 4) / 4;
    if (pulse !== this._cursorPulse) {
      this._cursorPulse = pulse;
      g.clear();
      g.circle(0, 0, 13 * pulse).stroke({ width: 1.5, color: 0xfff0c8, alpha: 0.35 });
      g.circle(0, 0, 3).fill({ color: 0xfff0c8, alpha: 0.5 });
    }
  }

  /**
   * 屏幕空间文字（关卡名 banner / Boss 登场）。
   * 用 Pixi Text，代价是文本内容变化时才重建纹理 ——
   * 每关只变一两次，远优于原先每帧上传整屏。
   */
  syncScreenText(items) {
    if (!this._textLayer) {
      this._textLayer = new Container();
      this.hudLayer.addChild(this._textLayer);
      this._textPool = new Map();
      this._textLayoutKey = '';
    }
    // 用一个 key 描述当前要显示的文本集合，没变化就完全不碰
    const key = items.map((i) => `${i.k}|${i.text}|${Math.round(i.alpha * 20)}|${i.size}`).join(';');
    if (key === this._textLayoutKey) return;
    this._textLayoutKey = key;

    const used = new Set();
    for (const it of items) {
      used.add(it.k);
      let txt = this._textPool.get(it.k);
      if (!txt) {
        txt = new Text({
          text: it.text,
          style: {
            fontFamily: it.font || '"PingFang SC", "Microsoft YaHei", serif',
            fontSize: it.size,
            fontWeight: it.weight || '600',
            fill: it.color || '#ffe9c4',
            align: 'center',
          },
        });
        txt.anchor.set(0.5);
        this._textLayer.addChild(txt);
        this._textPool.set(it.k, txt);
      }
      if (txt.text !== it.text) txt.text = it.text;
      txt.x = it.x;
      txt.y = it.y;
      txt.alpha = it.alpha;
      txt.visible = it.alpha > 0.01;
    }
    for (const [k, txt] of this._textPool) {
      if (!used.has(k)) { txt.visible = false; }
    }
  }

  /**
   * 同步实体到 Sprite。
   * 只更新变换属性，纹理复用，这是 WebGL 高性能的关键。
   */
  syncEntities(fishes, obstacles, player) {
    const alive = new Set();

    // ---- 鱼群 ----
    for (const f of fishes) {
      if (f.dead) continue;
      alive.add(f);
      let spr = this._sprMap.get(f);
      const got = getEntitySprite(f);
      if (!spr) {
        const tex = textureOf(got.canvas);
        tex.source.update();
        spr = new Sprite(tex);
        spr.anchor.set(0.5);
        spr.__ent = f;
        applySpriteSampling(spr);
        this.world.addChild(spr);
        this._sprMap.set(f, spr);
      } else if (!spr.texture || !spr.texture.source || spr.texture.source.resource !== got.canvas) {
        // 尺寸档位变了（或精灵被回收过）→ 换纹理
        spr.texture = textureOf(got.canvas);
        spr.texture.source.update();
        applySpriteSampling(spr);
      }
      spr.position.set(f.x, f.y);
      spr.rotation = f.angle || 0;
      // 缩放到「真实 f.size」的目标显示尺寸。
      // 分母必须用纹理的实际像素尺寸（可能带超采样），
      // 不能用逻辑 dim，否则高倍烘焙的精灵会被同比放大。
      const scaleK = (f.size * 4.8) / got.canvas.width;

      // ---- 深度：近大远小 + 雾化 + 微视差 ----
      const z = f.depthNow !== undefined ? f.depthNow : (f.depth || 0);
      const clarity = DEPTH.clarityOf(z);
      spr.anchor.set(0.5);

      // ---- 伪 3D：非等比缩放模拟"从斜上方俯视"的透视缩短 ----
      // 近层（z>0）的物体更靠近镜头，纵向被略微压缩；
      // 远层更"平"。这个细微差异是立体感的关键来源之一。
      const sx = scaleK * DEPTH.scaleOf(z);
      const sy = sx * (1 - Math.max(0, z) * 0.14);
      spr.scale.set(sx, sy);

      // 越深越淡（水下能见度衰减）
      spr.alpha = (f.alpha !== undefined ? f.alpha : 1) * (0.70 + clarity * 0.30);
      // 远处向水体色混合 —— 空气透视；近处保持本色
      const fog = this._fogColor || 0x0a2434;
      let tint = z < 0 ? mixTint(0xffffff, fog, (1 - clarity) * 0.55) : 0xffffff;

      // ---- 光柱照亮：鱼游过光柱时被提亮，是"光真的照在它身上"的直观线索 ----
      if (this._rayLight) {
        const lit = this._rayLight(f.x, f.y, this._time || 0);
        if (lit > 0.01) tint = mixTint(tint, 0xffffff, Math.min(0.35, lit * 0.45));
      }
      spr.tint = tint;
      // 视差：近层随相机方向轻微外扩，远层轻微内收（营造空间层次）
      if (this._camRef) {
        const pz = z * 0.05;
        spr.position.set(f.x + this._camRef.x * pz, f.y + this._camRef.y * pz);
      }
      // 深度排序：远处先画、近处后画（z 越大越靠前）
      spr.zIndex = Math.round(z * 1000);
    }

    // ---- 障碍物 ----
    for (const ob of obstacles) {
      if (ob.dead) continue;
      const got = getObstacleSprite(ob);
      if (!got) continue;          // 海草/漩涡走特效层
      alive.add(ob);
      let spr = this._sprMap.get(ob);
      if (!spr) {
        const tex = textureOf(got.canvas);
        tex.source.update();
        spr = new Sprite(tex);
        spr.anchor.set(0.5);
        spr.__ent = ob;
        this.world.addChild(spr);
        this._sprMap.set(ob, spr);
      }
      spr.position.set(ob.x, ob.y);
      spr.rotation = ob.seed * 0.01;
      // 同理：按障碍物实际尺寸缩放
      const obScale = ob.drawR * 2.6 / got.dim;

      // 障碍物固定在远层：礁石/珊瑚是"沉在水底"的静物，
      // 比鱼群更远、更暗，强调它们属于环境而不是主体
      const oz = ob.depth !== undefined ? ob.depth : -0.55;
      const oClarity = DEPTH.clarityOf(oz);
      spr.scale.set(obScale * DEPTH.scaleOf(oz));
      spr.anchor.set(0.5);
      spr.alpha = 0.80 + oClarity * 0.20;
      spr.tint = mixTint(0xffffff, this._fogColor || 0x0a2434, (1 - oClarity) * 0.62);
      spr.zIndex = Math.round(oz * 1000);
    }

    // ---- 回收不再存在的 Sprite ----
    this._cleanup(alive);
  }

  /**
   * 玩家：外形每帧都在变（尾巴摆动 / 张嘴 / 阶段特效），
   * 所以单独用一块离屏 canvas 每帧重绘并上传。
   * 只有 1 个对象，成本可接受。
   */
  syncPlayer(player, visible = true) {
    if (!player) return;
    if (!this._playerCanvas) {
      this._playerCanvas = document.createElement('canvas');
      this._playerCtx = this._playerCanvas.getContext('2d');
      const tex = textureOf(this._playerCanvas);
      this._playerSprite = new Sprite(tex);
      this._playerSprite.anchor.set(0.5);
      this.world.addChild(this._playerSprite);   // 加在最后 = 层级最高
    }

    const spr = this._playerSprite;
    spr.visible = visible;
    if (!visible) return;

    // 固定画布尺寸 + Sprite scale 缩放 = 永不重建纹理
    // 尺寸在底座时一次定好，之后只清空重绘，避免 GPU 纹理抖动
    const BASE = 48;
    const pad = BASE * 6;     // 6 倍：容纳旋转后的长度、尾鳍、发光
    if (this._playerCanvas.width !== pad) {
      this._playerCanvas.width = this._playerCanvas.height = pad;
      const newSrc = new CanvasSource({ resource: this._playerCanvas });
      newSrc.update();
      spr.texture = new Texture({ source: newSrc });
      spr.anchor.set(0.5);
    }

    // 只在「外观参数」变化时才重绘整张纹理，否则每帧全画一遍太贵
    const look = Math.round(player.tailPhase * 6) * 1000
               + Math.round((player.mouthOpen || 0) * 10) * 10
               + (player.stage || 0);
    if (look !== this._playerLook) {
      this._playerLook = look;
      const g = this._playerCtx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pad, pad);

      const savedX = player.x, savedY = player.y;
      player.x = 0; player.y = 0;
      Object.defineProperty(player, 'radius', { value: BASE, configurable: true, writable: true });
      g.save();
      g.translate(pad / 2, pad / 2);
      renderKunForTexture(g, player, 0);
      g.restore();
      delete player.radius;
      player.x = savedX; player.y = savedY;

      spr.texture.source.update();
    }

    spr.position.set(player.x, player.y);
    // 纹理里鱼占 BASE 半径；显示时按真实半径缩放
    const k = player.radius / BASE;
    spr.scale.set(k);
    spr.anchor.set(0.5);
    // 玩家固定在游玩层（z=0），但用 zIndex 保证压在远处鱼群之上
    spr.zIndex = 500;
    // 玩家永远清晰、不发雾（近景主元素）
    spr.tint = 0xffffff;
    spr.alpha = 1;
    // 投影：玩家下方的软化暗影，强化"浮在水中"的立体感
    if (!this._playerShadow) {
      this._playerShadow = new Graphics();
      this._playerShadow.eventMode = 'none';
      this.world.addChild(this._playerShadow);
    }
    const sh = this._playerShadow;
    sh.zIndex = 499;
    sh.position.set(player.x + player.radius * 0.10, player.y + player.radius * 0.16);
    const shR = player.radius * 1.05;
    const shKey = Math.round(shR / 6) * 6;
    if (sh.__key !== shKey) {
      sh.__key = shKey;
      sh.clear();
      // 多层同心椭圆叠出柔和阴影
      for (let i = 5; i >= 1; i--) {
        const k = i / 5;
        sh.ellipse(0, 0, shKey * k, shKey * 0.52 * k)
          .fill({ color: 0x04141c, alpha: 0.055 });
      }
    }
    sh.rotation = player.angle || 0;
    sh.visible = true;

    // 玩家叠在最上：靠 zIndex（已开启 sortableChildren），
    // 不能再用 addChild 反复移动节点 —— 那会打乱深度排序
    spr.zIndex = 500;
  }

  _cleanup(aliveSet) {
    for (let i = this.world.children.length - 1; i >= 0; i--) {
      const spr = this.world.children[i];
      // 只清理标记了 __ent 的实体精灵；玩家精灵、特效容器没有该标记，不会被误删
      if (spr.__ent && !aliveSet.has(spr.__ent)) {
        this.world.removeChild(spr);
        // 必须同步移除映射：否则同一个对象再次出现时会拿到已销毁的 Sprite
        this._sprMap.delete(spr.__ent);
        spr.destroy({ texture: false });
      }
    }
  }

  destroy() { if (this.app) this.app.destroy(true, { children: true }); }
}

// ============================================================
// 工厂
// ============================================================
export async function createBackend(canvas, preferred = 'pixi') {
  if (preferred === 'canvas2d') return new Canvas2DBackend(canvas).init();
  try {
    const be = new PixiBackend(canvas);
    await be.init();
    console.log('[render] PixiJS WebGL backend ready (native sprites)');
    return be;
  } catch (e) {
    console.warn('[render] Pixi failed, falling back to Canvas2D:', e.message);
    return new Canvas2DBackend(canvas).init();
  }
}