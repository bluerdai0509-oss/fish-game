// ============================================================
// 深度层：把纯 2D 俯视画面变成有纵深的水下空间
// ------------------------------------------------------------
// 世界仍是 2D 玩法坐标 (x, y)，额外给每个实体一个深度 z：
//   z = -1  最远（靠近水底/背景）
//   z =  0  玩家所在的游玩层
//   z = +1  最近（贴近镜头，也就是"水面"）
//
// 渲染时由 z 推导出四个可感知的视觉线索：
//   1. 缩放  —— 近大远小（视差的核心）
//   2. 视差位移 —— 相机移动时，越近的物体相对位移越大
//   3. 亮度/饱和 —— 越深越暗、越偏水色（水下能见度衰减）
//   4. 雾化    —— 远处叠一层水体色，制造空气透视
//
// 这些全部在 GPU 侧用 sprite 的 scale / tint / alpha 完成，
// 不需要额外的绘制通道，成本接近零。
// ============================================================

/** 深度 → 视觉参数的统一换算（所有实体共用，保证画面一致） */
export const DEPTH = {
  /** 缩放：z=+1 放大 1.22 倍，z=-1 缩到 0.80 倍 */
  scaleOf(z) {
    return 1 + z * 0.21;
  },

  /**
   * 视差：世界坐标 → 渲染偏移。
   * 越近（z 大）的物体，相对镜头移动得越多。
   * camX/camY 是相机世界坐标，parallax 是强度系数。
   */
  parallaxOf(z, camX, camY, k = 1) {
    // 以玩家深度为基准层，近层反向补正、远层跟随
    return { x: camX * z * 0.06 * k, y: camY * z * 0.06 * k };
  },

  /**
   * 深度衰减系数 0..1：1 = 完全清晰（近），0 = 完全被水吞没（远）。
   * 用于 tint 与 alpha。
   */
  clarityOf(z) {
    return Math.max(0.35, Math.min(1, 1 + z * 0.34));
  },

  /**
   * 把实体深度和「屏幕空间迷雾色」混合，得到最终 tint。
   * 远处偏水色、近处接近本色（略提亮）。
   */
  tintOf(z, baseTint, fogColor = 0x0a2434) {
    const c = clarityOf(z);
    // 远处向雾色混合，近处向白色提亮
    if (z < 0) return mixTint(baseTint, fogColor, (1 - c) * 0.85);
    return mixTint(baseTint, 0xffffff, (c - 1) * 0.30 + 0.04);
  },

  /** 深度排序键：值越小越先画（远的在下） */
  sortKey(z) {
    return -z;
  },
};

/** 两个 RGB 整数颜色按 t 混合 */
export function mixTint(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

/**
 * 给实体分配一个深度。
 * 规则：同一幕里，小鱼贴近水面、巨兽沉在深处 ——
 * 这既符合「大鱼在深水」的直觉，也让体型层次一眼可辨。
 */
export function assignDepth(ent, rand = Math.random) {
  if (ent.depth !== undefined) return ent.depth;
  const sizeK = Math.min(1, (ent.size || 20) / 90);
  // 大鱼沉在深处（负 z），小鱼贴近水面；再叠加随机让画面不呆板。
  // 关键：拉力要给足 —— 否则大小鱼都挤在同一层，看不出纵深。
  const base = (0.35 - sizeK) * 0.95 + (rand() - 0.5) * 0.75;
  ent.depth = Math.max(-1, Math.min(0.85, base));
  return ent.depth;
}

/**
 * 相机倾斜：俯视时带一点透视抬升，让世界不是完全正交俯视。
 * 返回 0..1 的透视强度（0 = 纯俯视）。
 */
export function tiltOf(actId) {
  // 江河视野开阔，倾斜更明显；北冥深邃，几乎垂直俯视
  return actId === 1 ? 0.16 : actId === 2 ? 0.12 : 0.08;
}