// ============================================================
// 可选种族（4 种，外形与玩法都不同）× 4 种配色
// 种族决定：外形轮廓、属性特长、被动效果
// 配色决定：体色
// ============================================================

/** 种族：外形 + 数值特长 */
export const SPECIES = [
  {
    id: 'kun',
    name: '鲲',
    title: '北冥之鲲',
    lore: '北冥有鱼，其名为鲲。鲲之大，不知其几千里也。',
    desc: '均衡 · 新手推荐',
    shape: 'kun',              // renderKun 里的形态分支
    build: { len: 1.0, wide: 1.0, fin: 1.0 },
    hit: [1.62, 0.78],
    stats: { speed: 1.0, size: 1.0, growth: 1.0, dashCd: 1.0 },
    perks: ['各项属性均衡', '成长速度标准'],
    cons: [],
  },
  {
    id: 'kunpeng',
    name: '鳐',
    title: '文鳐之属',
    lore: '鱼身而鸟翼，苍文白首赤喙，常以夜飞。',
    desc: '迅捷 · 宽翼滑行',
    shape: 'ray',              // 扁平宽翼
    build: { len: 1.15, wide: 1.9, fin: 1.5 },
    hit: [1.5, 1.55],
    stats: { speed: 1.22, size: 0.94, growth: 0.95, dashCd: 0.6 },
    perks: ['移速 +22%', '冲刺冷却 -40%'],
    cons: ['成长收益 -5%'],
  },
  {
    id: 'ao',
    name: '鳌',
    title: '龙伯之鳌',
    lore: '巨鳌载山，其背如岛。',
    desc: '力量 · 厚重坚韧',
    shape: 'turtle',           // 带甲壳的宽厚背
    build: { len: 0.92, wide: 1.35, fin: 0.8 },
    hit: [1.55, 1.2],
    stats: { speed: 0.86, size: 1.26, growth: 1.18, dashCd: 1.15 },
    perks: ['体型 +26%，吞噬范围大', '成长收益 +18%'],
    cons: ['移速 -14%，冲刺冷却 +15%'],
  },
  {
    id: 'jiao',
    name: '蛟',
    title: '鱼身蛇尾',
    lore: '鱼身而蛇尾，其音如鸳鸯。',
    desc: '灵巧 · 长身蛇行',
    shape: 'serpent',          // 细长蛇形
    build: { len: 1.55, wide: 0.66, fin: 1.2 },
    hit: [1.5, 0.68],
    stats: { speed: 1.08, size: 1.15, growth: 1.05, dashCd: 0.85 },
    perks: ['转向极灵活', '冲刺冷却 -15%'],
    cons: ['身体细长，碰撞范围小但视觉也窄'],
  },
];

/** 配色：每种族可选 */
export const PALETTES = [
  { id: 'gold',  name: '赤金', body: '#f5a623', bodyDeep: '#b8600a', bodyLight: '#ffe6a8', glow: 'rgba(255,190,80,ALPHA)' },
  { id: 'azure', name: '青碧', body: '#3fa7c4', bodyDeep: '#14566f', bodyLight: '#c6eef7', glow: 'rgba(110,210,240,ALPHA)' },
  { id: 'jade',  name: '玉白', body: '#d9e4dc', bodyDeep: '#7d968a', bodyLight: '#ffffff', glow: 'rgba(220,255,240,ALPHA)' },
  { id: 'ink',   name: '玄墨', body: '#4a4170', bodyDeep: '#221d38', bodyLight: '#b8aede', glow: 'rgba(170,140,255,ALPHA)' },
];

export function getSpecies(id) {
  return SPECIES.find((s) => s.id === id) || SPECIES[0];
}
export function getPalette(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

/** 组合出战斗用的角色对象 */
export function makeHero(speciesId, paletteId) {
  const sp = getSpecies(speciesId);
  const pal = getPalette(paletteId);
  return {
    ...sp,
    palette: pal,
    // 兼容旧字段
    color: pal.body,
    colorDeep: pal.bodyDeep,
    colorLight: pal.bodyLight,
  };
}