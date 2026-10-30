// ============================================================
// GPU 特效层：粒子 / 气泡 / 流线 / 道具 / Boss 全部走 Pixi 原生绘制
// ------------------------------------------------------------
// 旧实现把这些内容画到一张全屏 2D canvas，每帧 texture.update() 整张上传：
//   1440×1100×4B = 6MB/帧，60fps → 363MB/s，是卡顿的主因。
// 现在改为：
//   - 粒子/气泡/道具/流线 → ParticleContainer（一次 draw call，零上传）
//   - 单张粒子贴图在初始化时烘焙一次，之后常驻显存
//   - 世界坐标由容器 transform 跟随相机，不需要重画
// ============================================================
import { Container, Sprite, Texture, CanvasSource, ParticleContainer, Particle } from 'pixi.js';

/**
 * 生成一张柔和的圆形粒子贴图（白色，靠 tint 上色）。
 * 所有粒子共用这一张，才能走 ParticleContainer 的批量路径。
 */
let _softDot = null;
export function softDotTexture() {
  if (_softDot) return _softDot;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.45, 'rgba(255,255,255,0.92)');
  rad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rad;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fill();

  const src = new CanvasSource({ resource: c });
  src.update();
  _softDot = new Texture({ source: src });
  return _softDot;
}

/** 生成一张"流线"贴图：细长渐变条，两端淡出（用于水流） */
let _streakTex = null;
export function streakTexture() {
  if (_streakTex) return _streakTex;
  const W = 128, H = 16;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.28, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.82, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  // 纵向也做淡出，避免边缘生硬
  g.beginPath();
  g.moveTo(0, H / 2);
  g.bezierCurveTo(W * 0.28, 0, W * 0.82, 0, W, H / 2);
  g.bezierCurveTo(W * 0.82, H, W * 0.28, H, 0, H / 2);
  g.closePath();
  g.fill();

  const src = new CanvasSource({ resource: c });
  src.update();
  _streakTex = new Texture({ source: src });
  return _streakTex;
}

/** 把 css 颜色转成 Pixi tint 数字（支持 #rgb / #rrggbb / rgba()） */
const _colorCache = new Map();
export function toTint(css) {
  if (typeof css === 'number') return css;
  if (typeof css !== 'string') return 0xffffff;
  const hit = _colorCache.get(css);
  if (hit !== undefined) return hit;

  let out = 0xffffff;
  const s = css.trim();
  if (s[0] === '#') {
    if (s.length === 4) {
      const r = parseInt(s[1] + s[1], 16), g = parseInt(s[2] + s[2], 16), b = parseInt(s[3] + s[3], 16);
      out = (r << 16) | (g << 8) | b;
    } else if (s.length >= 7) {
      out = parseInt(s.slice(1, 7), 16);
    }
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((x) => parseFloat(x));
      out = ((p[0] | 0) << 16) | ((p[1] | 0) << 8) | (p[2] | 0);
    } else if (s === 'white') out = 0xffffff;
    else if (s === 'black') out = 0x000000;
  }
  if (_colorCache.size > 512) _colorCache.clear();
  _colorCache.set(s, out);
  return out;
}

/** 提取 css 颜色里的 alpha（rgba(r,g,b,a) → a；否则 1） */
export function cssAlpha(css) {
  if (typeof css !== 'string') return 1;
  const m = css.match(/rgba\([^)]*,\s*([0-9.]+)\s*\)/);
  return m ? Math.min(1, parseFloat(m[1])) : 1;
}

/**
 * 一个池化的 ParticleContainer。
 *
 * 两个关键点（踩过的坑）：
 *  1. 构造时必须显式传 texture，否则 shader 直到首次渲染才初始化；
 *  2. 增删粒子后必须调用 container.update() 重建缓冲区，
 *     否则新粒子不会被渲染（表现为"数据都有但画面空白"）。
 */
export class ParticlePool {
  constructor(texture, capacity = 512, extraDyn = {}) {
    this.texture = texture;
    this.capacity = capacity;
    this.container = new ParticleContainer({
      texture,
      dynamicProperties: {
        position: true,
        rotation: true,
        color: true,
        vertex: false,
        uvs: false,
        ...extraDyn,
      },
    });
    this.items = [];
    this.used = 0;
    this._grow(capacity);
  }

  _grow(n) {
    for (let i = 0; i < n; i++) {
      const p = new Particle({ texture: this.texture, x: -99999, y: -99999, alpha: 0 });
      p.anchorX = 0.5;
      p.anchorY = 0.5;
      this.items.push(p);
      this.container.addParticle(p);
    }
    this.capacity = this.items.length;
    this.container.update();
  }

  /** 开始新一帧：把上一个"帧"用过的粒子全部隐藏 */
  begin() { this.used = 0; }

  /** 取下一个可用粒子（自动扩容） */
  next() {
    if (this.used >= this.items.length) this._grow(Math.max(64, this.items.length));
    return this.items[this.used++];
  }

  /** 隐藏本帧未使用到的粒子 */
  end() {
    for (let i = this.used; i < this.items.length; i++) {
      const p = this.items[i];
      if (p.alpha !== 0) { p.alpha = 0; p.x = -9999; p.y = -9999; }
    }
  }

  destroy() { this.container.destroy({ children: true }); }
}