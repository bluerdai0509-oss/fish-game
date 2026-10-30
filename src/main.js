// ============================================================
// 《鲲 · 逍遥游》主入口：装配 + 输入 + 主循环
// ============================================================
import { SceneManager } from './engine/scenes.js';
import { Camera } from './engine/camera.js';
import { audio } from './engine/audio.js';
import { ui, settings } from './engine/ui.js';
import { registerFishTypes } from './engine/fishrender.js';
import { createBackend } from './engine/renderer.js';
import { FISH_TYPES } from './data/acts.js';
import { getLevel } from './engine/levels.js';
import { MenuScene } from './scenes/menu.js';
import { ActIntroScene } from './scenes/actintro.js';
import { PlayScene } from './scenes/play.js';
import { EvolveScene } from './scenes/evolve.js';
import { EndingScene } from './scenes/ending.js';
import { GameOverScene } from './scenes/gameover.js';

let canvas = document.getElementById('game');
let ctx = canvas.getContext('2d');

// ---- 动态尺寸：canvas 铺满整个窗口 ----
let W = window.innerWidth;
let H = window.innerHeight;

function applySize() {
  W = window.innerWidth;
  H = window.innerHeight;
  if (app && app.backend) {
    app.backend.resize(W, H);        // Pixi 后端自己管理 canvas 尺寸
    canvas = app.backend.domCanvas;
  } else {
    canvas.width = W;
    canvas.height = H;
  }
  if (camera) { camera.w = W; camera.h = H; }
  if (app) { app.W = W; app.H = H; }
}
window.addEventListener('resize', () => applySize());

// ---- 输入（鼠标/键盘独立模式，末次使用的设备接管控制）----
const input = {
  mouse: { x: W / 2, y: H / 2 },
  keys: {},
  mode: 'mouse',
  mouseWorld: { x: 0, y: 0 },
  dashQueued: false,
  clickQueued: false,
  anyKey: false,
};
const MOVE_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  input.mouse.x = (e.clientX - rect.left) * (W / rect.width);
  input.mouse.y = (e.clientY - rect.top) * (H / rect.height);
  input.mode = 'mouse';
});
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  input.mouse.x = (t.clientX - rect.left) * (W / rect.width);
  input.mouse.y = (t.clientY - rect.top) * (H / rect.height);
  input.mode = 'mouse';
}, { passive: false });
canvas.addEventListener('mousedown', () => { input.clickQueued = true; input.mode = 'mouse'; });
canvas.addEventListener('touchstart', (e) => {
  input.clickQueued = true;
  input.mode = 'mouse';
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  input.mouse.x = (t.clientX - rect.left) * (W / rect.width);
  input.mouse.y = (t.clientY - rect.top) * (H / rect.height);
}, { passive: true });

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();

  // ESC：暂停 / 继续（仅在游戏场景内生效）
  if (k === 'escape') {
    e.preventDefault();
    if (app.scenes.name === 'play') {
      if (ui.paused) ui.hidePause();
      else { ui.showPause(); audio.setVolume?.(settings.volume / 100); }
    }
    return;
  }

  input.keys[k] = true;
  input.anyKey = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (MOVE_KEYS.includes(k)) input.mode = 'kb';
  if (k === ' ' || k === 'shift') input.dashQueued = true;
  if (k === 'm') audio.toggleMute();
});
window.addEventListener('keyup', (e) => { input.keys[e.key.toLowerCase()] = false; });

// ---- App 装配 ----
const camera = new Camera(W, H);
const app = {
  get W() { return W; },
  get H() { return H; },
  set W(v) { W = v; },
  set H(v) { H = v; },
  canvas, ctx, input, camera, audio, ui, settings,
  backend: null,
  run: null,
  scenes: null,
  version: '1.2',
  highQuality: true,
  screenShake: true,
};

app.newRun = (heroId) => {
  app.run = {
    score: 0, lives: 3, formIndex: 0, eaten: 0, comboBest: 0,
    levelId: '1-1',
    hero: ui.getHero(),
  };
};

app.openCharSelect = () => {
  audio.init();
  ui.showCharSelect(true);        // 进入选角色页
};

/** 从第一关开始（选角完成后调用） */
app.enterGame = () => {
  audio.init();
  app.newRun();
  app.scenes.switchTo('actintro', { actId: 1, levelId: '1-1' });
};

app.startLevel = (levelId) => {
  audio.init();
  app.newRun();
  const lv = getLevel(levelId);
  const act = lv ? lv.act : 1;
  // 从关卡直接开打：形态从该关 startForm 起步
  app.scenes.switchTo('play', { levelId });
};

app.restartLevel = () => {
  audio.init();
  app.scenes.switchTo('play', { levelId: app.run.levelId });
};

app.toMenu = () => {
  ui.showHud(false);
  app.scenes.switchTo('menu');
};

app.applySettings = () => {
  app.highQuality = settings.quality !== 'low';
  app.screenShake = settings.shake;
  camera.enabled = settings.shake;      // 关闭后 addShake 不生效
  if (audio.setVolume) audio.setVolume(settings.volume / 100);
};

applySize();
registerFishTypes(FISH_TYPES);

const sceneMap = {
  menu: MenuScene,
  actintro: ActIntroScene,
  play: PlayScene,
  evolve: EvolveScene,
  ending: EndingScene,
  gameover: GameOverScene,
};
app.scenes = new SceneManager(app, sceneMap);
ui.init();
// 版本角标：与 main.js 的 version 同步（页面结构新 / 脚本旧时能一眼看出）
{
  const chip = document.getElementById('ver-chip');
  if (chip) chip.textContent = 'v' + app.version;
}

// 设置 → 主程序
ui.onSettingsChanged((s) => app.applySettings());
app.applySettings();

// 关卡选择：点击关卡直接开打（保留当前选中的种族/配色）
ui.onLevelPick((levelId) => app.startLevel(levelId));

// 暂停回调
ui.setPauseCallbacks({
  onResume: () => {},
  onRestart: () => app.restartLevel(),
  onMenu: () => app.toMenu(),
});

// ---- DOM 按钮 ----
document.getElementById('btn-start').addEventListener('click', () => {
  audio.init();
  ui.showCharSelect(true);
});
document.getElementById('btn-levels').addEventListener('click', () => {
  audio.init();
  ui.showLevelSelect(true);
});
document.getElementById('btn-enter-game').addEventListener('click', () => app.enterGame());
document.getElementById('btn-back-title').addEventListener('click', () => ui.showMenu(true));
document.getElementById('btn-levels-back').addEventListener('click', () => ui.showMenu(true));
document.getElementById('btn-restart').addEventListener('click', () => app.restartLevel());
document.getElementById('btn-menu').addEventListener('click', () => app.toMenu());
document.getElementById('btn-again').addEventListener('click', () => app.enterGame());
document.getElementById('btn-home').addEventListener('click', () => app.toMenu());

// ---- 主循环（带帧率上限）----
let lastTime = performance.now();
let rafId = 0;
let frameAccum = 0;

function loop(now) {
  rafId = requestAnimationFrame(loop);

  let rawDt = now - lastTime;
  lastTime = now;
  if (rawDt > 50) rawDt = 50;          // 页面隐藏回来不暴冲

  // 帧率上限（固定步长累加器）：
  //   dt 恒等于 interval —— 游戏速度恒定；
  //   显示帧攒下的余量留到下一轮，长周期上 dt 总和 == 墙钟时间
  if (settings.fpsCap > 0) {
    frameAccum = Math.min(frameAccum + rawDt, 100);
    const interval = 1000 / settings.fpsCap;
    if (frameAccum < interval) return;  // 未到渲染点，跳过本显示帧
    frameAccum -= interval;
    rawDt = interval;
  }

  const dt = Math.max(0, Math.min(0.05, rawDt / 1000));

  // 暂停：世界不更新，但仍渲染（画面静止）
  const frozen = ui.paused;
  if (!frozen) {
    camera.update(dt);
    app.scenes.update(dt);
  }

  const be = app.backend;
  if (!be) return;
  const frameCtx = be.begin();       // 取得本帧的绘制上下文
  // 渲染异常必须隔离：否则一次报错会中断整个场景的绘制，
  // 表现为画面突然全黑且控制台只有一条错（很难定位）。
  try {
    app.scenes.render(frameCtx);
  } catch (err) {
    if (!app.__renderErrLogged) {
      app.__renderErrLogged = true;
      console.error('[render] 场景渲染异常（已跳过本帧）:', err);
    }
  }
  be.end();                          // Pixi: 上传纹理并渲染
}

// ---- 实例守卫 ----
if (window.__kun && typeof window.__kun.stop === 'function') window.__kun.stop();
app.stop = () => cancelAnimationFrame(rafId);

// 开机：初始化渲染后端 → 进主菜单
(async () => {
  app.backend = await createBackend(canvas, 'pixi');
  canvas = app.backend.domCanvas;
  ctx = app.backend.ctx || null;
  applySize();
  app.newRun();
  app.scenes.switchTo('menu');
  rafId = requestAnimationFrame(loop);
})();

window.__kun = app;