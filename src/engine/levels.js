// ============================================================
// 关卡配置校验 + 推进逻辑
// ============================================================
import { LEVELS, ACTS, FISH_TYPES } from '../data/acts.js';

/** schema 校验（启动时跑一次，配置错了控制台直接骂人） */
export function validateLevel(cfg) {
  const need = ['id', 'act', 'name', 'targetGrowth', 'dangerChance', 'fishPool', 'speedMul', 'startForm', 'items'];
  const missing = need.filter((k) => cfg[k] === undefined);
  if (missing.length) { console.warn(`[levels] ${cfg.id || '?'} 缺字段: ${missing.join(',')}`); return false; }
  const act = ACTS.find((a) => a.id === cfg.act);
  if (!act) { console.warn(`[levels] ${cfg.id} 幕 ${cfg.act} 不存在`); return false; }
  const badFish = cfg.fishPool.filter((k) => !FISH_TYPES[k]);
  if (badFish.length) { console.warn(`[levels] ${cfg.id} 未知鱼种: ${badFish.join(',')}`); return false; }
  if (cfg.boss && !['hebo', 'ao', 'jiaolong'].includes(cfg.boss)) {
    console.warn(`[levels] ${cfg.id} 未知 Boss: ${cfg.boss}`); return false;
  }
  return true;
}
LEVELS.forEach(validateLevel);

export function levelIndex(id) { return LEVELS.findIndex((l) => l.id === id); }
export function getLevel(id) { return LEVELS[levelIndex(id)]; }
export function nextLevel(id) {
  const i = levelIndex(id);
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}
export function getAct(actId) { return ACTS.find((a) => a.id === actId); }

/** 下一关是否需要幕间标题卡 */
export function needsActIntro(prevCfg, nextCfg) { return prevCfg.act !== nextCfg.act; }
