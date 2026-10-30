// ============================================================
// 《鲲·逍遥游》数据层：化形链 / 鱼种注册表 / 三幕九关配置
// 调关卡 = 改这里的表（schema 见 engine/levels.js）
// ============================================================

// 化形进化链（体型 = 基准半径 17px × sizeMul）
export const FORMS = [
  { name: '鱼苗鲲', sizeMul: 1.0, speed: 430 },
  { name: '幼鲲',   sizeMul: 1.4, speed: 440 },
  { name: '潜鲲',   sizeMul: 2.0, speed: 450 },
  { name: '巨鲲',   sizeMul: 2.7, speed: 460 },
  { name: '冥鲲',   sizeMul: 3.2, speed: 470 },
];
export const FORM_PENG = '鲲鹏';

// 鱼种注册表：shape 决定绘制函数，behavior 决定 AI
export const FISH_TYPES = {
  xiyu: {
    label: '溪鱼', shape: 'fish', behavior: 'swim',
    size: [11, 22], speedMul: 1.0, striped: 0.3,
    palette: { body: '#7fb069', belly: '#d8e8c0', fin: '#4a7c3f' },
  },
  tiaoyu: {
    label: '鲦鱼', shape: 'fish', behavior: 'swim',
    size: [9, 18], speedMul: 1.35, striped: 0,
    palette: { body: '#b8c9d9', belly: '#eef4f8', fin: '#7d93a8' },
  },
  xiabing: {
    label: '虾兵', shape: 'shrimp', behavior: 'dart',
    size: [8, 14], speedMul: 1.1, striped: 0,
    palette: { body: '#e8896b', belly: '#ffd9c4', fin: '#b85438' },
  },
  changyu: {
    label: '鲳鱼', shape: 'fish', behavior: 'swim',
    size: [16, 30], speedMul: 0.9, striped: 0.25,
    palette: { body: '#6fa8c9', belly: '#d3e6f2', fin: '#3d7299' },
  },
  shuihu: {
    label: '水母', shape: 'jelly', behavior: 'pulse',
    size: [12, 22], speedMul: 0.55, striped: 0, sting: true,
    palette: { body: 'rgba(196,170,255,0.8)', belly: 'rgba(235,225,255,0.55)', fin: 'rgba(150,120,230,0.65)' },
  },
  qiyu: {
    label: '旗鱼', shape: 'sword', behavior: 'charge',
    size: [20, 34], speedMul: 1.2, striped: 0,
    palette: { body: '#4a6fa5', belly: '#c9d9ec', fin: '#2c4a75' },
  },
  mingyu: {
    label: '冥鱼', shape: 'fish', behavior: 'swim', glow: true,
    size: [18, 34], speedMul: 1.15, striped: 0.2,
    palette: { body: '#3d5a80', belly: '#98c1d9', fin: '#1d3557' },
  },
  guai: {
    label: '深海怪', shape: 'monster', behavior: 'wanderBig',
    size: [40, 64], speedMul: 0.55, striped: 0, heavy: true,
    palette: { body: '#2d3142', belly: '#4f5d75', fin: '#1b1e28' },
  },

  // ===== 山海经 · 水族 =====
  // 南山经：其状如鱼而人面，其音如鸳鸯 —— 赤鱬
  chiru: {
    label: '赤鱬', shape: 'humanface', behavior: 'lure',
    size: [14, 26], speedMul: 0.75, striped: 0, lore: '人面鱼身，其音如鸳鸯',
    palette: { body: '#c1553f', belly: '#f0b39c', fin: '#8c2f20', face: '#f4d2bd' },
  },
  // 北山经：一首而十身 —— 何罗
  heluo: {
    label: '何罗', shape: 'multi', behavior: 'school',
    size: [16, 28], speedMul: 1.0, striped: 0, lore: '一首十身，其音如吠犬',
    palette: { body: '#6b8fa8', belly: '#c3dbe8', fin: '#3f5f77' },
  },
  // 西山经：鱼身而鸟翼，见则其邑大水 —— 蠃鱼
  luoyu: {
    label: '蠃鱼', shape: 'winged', behavior: 'flee',
    size: [12, 22], speedMul: 1.5, striped: 0, lore: '鱼身鸟翼，见则大水',
    palette: { body: '#7ec8c0', belly: '#d8f2ee', fin: '#3f9a91' },
  },
  // 人鱼，泣则珠 —— 鲛人
  jiaoren: {
    label: '鲛人', shape: 'merfolk', behavior: 'flee', drops: 'lingzhu',
    size: [18, 30], speedMul: 1.2, striped: 0, lore: '人面鱼身，泣泪成珠',
    palette: { body: '#5b8fb9', belly: '#d6ebf7', fin: '#2f5f85', face: '#f3dfd0' },
  },
  // 蚌精，吐气成幻 —— 蜃
  shen: {
    label: '蜃', shape: 'clam', behavior: 'drift', neutral: true,
    size: [34, 52], speedMul: 0.35, striped: 0, lore: '大蛤吐气，幻为楼台',
    palette: { body: '#7a5f8f', belly: '#d9c6e8', fin: '#4a3459' },
  },
  // 西山经：鱼身而鸟翼，苍文白首赤喙，以夜飞 —— 文鳐
  wenyao: {
    label: '文鳐', shape: 'winged', behavior: 'swim', glow: true,
    size: [16, 26], speedMul: 1.15, striped: 0, lore: '苍文白首，常以夜飞',
    palette: { body: '#4a6fa5', belly: '#d8e6f5', fin: '#2a4a70' },
  },
  // 南山经：鱼身而蛇尾 —— 虎蛟
  hujiao: {
    label: '虎蛟', shape: 'serpent', behavior: 'ambush', heavy: true,
    size: [26, 44], speedMul: 0.8, striped: 0, lore: '鱼身蛇尾，其音如鸳鸯',
    palette: { body: '#8a6a3f', belly: '#e0cba3', fin: '#5c4426' },
  },
  // 海外北经：九首人面，蛇身而青 —— 相柳
  xiangliu: {
    label: '相柳', shape: 'ninehead', behavior: 'wanderBig', heavy: true,
    size: [44, 70], speedMul: 0.5, striped: 0, lore: '九首人面，蛇身而青',
    palette: { body: '#3f6b5a', belly: '#8fb8a6', fin: '#24463a' },
  },
  // 西山经：状如黄囊，六足四翼，浑敦无面目 —— 帝江
  dijiang: {
    label: '帝江', shape: 'chaos', behavior: 'pulse', glow: true,
    size: [30, 48], speedMul: 0.7, striped: 0, lore: '六足四翼，浑敦无面目',
    palette: { body: '#c98a2e', belly: '#f5d79a', fin: '#8a5510' },
  },
  // 玄龟：负图而出，祥瑞
  xuangui: {
    label: '玄龟', shape: 'turtle', behavior: 'drift', neutral: true, heavy: true,
    size: [28, 42], speedMul: 0.3, striped: 0, lore: '负河图而出，天下平',
    palette: { body: '#2f4a3f', belly: '#7fa08f', fin: '#1a2e26' },
  },
  // 北冥幽光所化，诱猎者 —— 灯笼鱼
  denglong: {
    label: '灯笼鱼', shape: 'lantern', behavior: 'lure', glow: true,
    size: [16, 28], speedMul: 0.6, striped: 0, lore: '幽光诱猎，北冥之烛',
    palette: { body: '#1e2a3a', belly: '#3c5470', fin: '#101a26', lure: '#9fe8ff' },
  },
};

// 三幕：水色 / 鱼种池 / 诗句
export const ACTS = [
  {
    id: 1, name: '第一幕 · 江河', poetic: '秋水时至，百川灌河',
    water: { top: '#9fd8c9', bottom: '#2e6e5e', fog: '#2e6e5e' },
    fishPool: ['xiyu', 'tiaoyu', 'xiabing', 'luoyu', 'chiru'],
    minionPool: ['xiyu', 'tiaoyu', 'luoyu'],
  },
  {
    id: 2, name: '第二幕 · 湖海', poetic: '万川归之，不知何时止',
    water: { top: '#3f7cac', bottom: '#123a5c', fog: '#123a5c' },
    fishPool: ['changyu', 'shuihu', 'qiyu', 'tiaoyu', 'jiaoren', 'heluo', 'xuangui'],
    minionPool: ['changyu', 'qiyu', 'heluo'],
  },
  {
    id: 3, name: '第三幕 · 北冥', poetic: '鲲之大，不知其几千里也',
    water: { top: '#1a2438', bottom: '#05070f', dark: true, fog: '#070a14' },
    fishPool: ['mingyu', 'guai', 'shuihu', 'wenyao', 'hujiao', 'xiangliu', 'dijiang', 'denglong', 'shen'],
    minionPool: ['mingyu', 'shuihu', 'denglong'],
  },
];

// 九关配置：boss 只设在每幕第 3 关（进化度达标后 Boss 入场，通关条件改为击败 Boss）
// evolveAtHalf: 进化度过半时化形（formIndex）；evolveOnComplete: 通关时化形
// targetGrowth 按「成长 = 猎物/自身 × 100」结算：一条常规猎物约给 50~85 点
// 因此 targetGrowth / 65 ≈ 本关需吃的鱼条数（1-1 约 40 条，3-3 约 105 条）
export const LEVELS = [
  { id: '1-1', act: 1, name: '初入江河', targetGrowth: 2600, dangerChance: 0.15,
    requiredLevel: 3,
    fishPool: ['xiyu', 'tiaoyu', 'luoyu'], speedMul: 1.0, startForm: 0,
    items: { lingzhu: 2, guijia: 1, xiancao: 0.25 },
    evolveAtHalf: null, evolveOnComplete: null, boss: null },

  { id: '1-2', act: 1, name: '百川灌河', targetGrowth: 3100, dangerChance: 0.20,
    requiredLevel: 4,
    fishPool: ['xiyu', 'tiaoyu', 'xiabing', 'luoyu', 'chiru'], speedMul: 1.05, startForm: 0,
    items: { lingzhu: 2, guijia: 1, xiancao: 0.25 },
    evolveAtHalf: 1, evolveOnComplete: null, boss: null },

  { id: '1-3', act: 1, name: '河伯问津', targetGrowth: 3600, dangerChance: 0.22,
    requiredLevel: 5,
    fishPool: ['xiyu', 'tiaoyu', 'xiabing', 'luoyu', 'chiru'], speedMul: 1.1, startForm: 1,
    items: { lingzhu: 3, guijia: 1, xiancao: 0.4 },
    evolveAtHalf: null, evolveOnComplete: 2, boss: 'hebo' },

  { id: '2-1', act: 2, name: '万川归之', targetGrowth: 4100, dangerChance: 0.26,
    requiredLevel: 7,
    fishPool: ['changyu', 'shuihu', 'heluo', 'jiaoren'], speedMul: 1.1, startForm: 2,
    items: { lingzhu: 2, guijia: 1, xiancao: 0.3 },
    evolveAtHalf: null, evolveOnComplete: null, boss: null },

  { id: '2-2', act: 2, name: '鱼跃于渊', targetGrowth: 4600, dangerChance: 0.30,
    requiredLevel: 8,
    fishPool: ['changyu', 'shuihu', 'qiyu', 'heluo', 'jiaoren'], speedMul: 1.15, startForm: 2,
    items: { lingzhu: 2, guijia: 1, xiancao: 0.3 },
    evolveAtHalf: null, evolveOnComplete: null, boss: null },

  { id: '2-3', act: 2, name: '龙伯钓鳌', targetGrowth: 5100, dangerChance: 0.32,
    requiredLevel: 9,
    fishPool: ['changyu', 'shuihu', 'qiyu', 'heluo', 'jiaoren'], speedMul: 1.2, startForm: 2,
    items: { lingzhu: 3, guijia: 1, xiancao: 0.4 },
    evolveAtHalf: null, evolveOnComplete: 3, boss: 'ao' },

  { id: '3-1', act: 3, name: '北冥有鱼', targetGrowth: 5600, dangerChance: 0.34,
    requiredLevel: 11,
    fishPool: ['mingyu', 'guai', 'wenyao', 'denglong', 'shen'], speedMul: 1.2, startForm: 3,
    items: { lingzhu: 3, guijia: 1, xiancao: 0.35 },
    evolveAtHalf: null, evolveOnComplete: 4, boss: null },

  { id: '3-2', act: 3, name: '其名为鲲', targetGrowth: 6200, dangerChance: 0.38,
    requiredLevel: 12,
    fishPool: ['mingyu', 'guai', 'shuihu', 'wenyao', 'hujiao', 'denglong', 'xuangui'], speedMul: 1.25, startForm: 4,
    items: { lingzhu: 3, guijia: 1, xiancao: 0.35 },
    evolveAtHalf: null, evolveOnComplete: null, boss: null },

  { id: '3-3', act: 3, name: '抟扶摇者', targetGrowth: 6800, dangerChance: 0.40,
    requiredLevel: 13,
    fishPool: ['mingyu', 'guai', 'shuihu', 'wenyao', 'hujiao', 'xiangliu', 'dijiang', 'denglong', 'shen'], speedMul: 1.3, startForm: 4,
    items: { lingzhu: 3, guijia: 1, xiancao: 0.5 },
    evolveAtHalf: null, evolveOnComplete: null, boss: 'jiaolong' },
];

// 化形链文案（Evolve 场景用）
export const EVOLVE_LINES = [
  '北冥有鱼，其名为鲲',
  '化而为鸟，其名为鹏',
  '鹏之背，不知其几千里也',
  '怒而飞，其翼若垂天之云',
  '海运则将徙于南冥',
];
