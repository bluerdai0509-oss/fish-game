// ============================================================
// UI 控制器：选角色 / 暂停 / 设置 / 结算
// ============================================================
import { SPECIES, PALETTES, makeHero } from '../data/heroes.js';
import { LEVELS } from '../data/acts.js';
import { renderKun } from './fishrender.js';

const $ = (id) => document.getElementById(id);

const TAU = Math.PI * 2;

export const settings = {
  volume: 70,
  fpsCap: 60,         // 默认锁 60 帧（高刷屏上 421fps 纯浪费且帧距不匀）
  shake: true,
  quality: 'high',
};

export const ui = {
  els: {},
  selectedSpecies: 'kun',
  selectedPalette: 'gold',
  _animId: 0,
  _paused: false,
  _settingsReturn: 'menu',   // 设置面板返回目标
  _onResume: null,

  init() {
    const e = this.els = {
      hud: $('hud'), score: $('hud-score'), actlevel: $('hud-actlevel'), form: $('hud-form'),
      growthFill: $('growth-fill'), lives: $('hud-lives'), itemFx: $('item-fx'),
      ctrlMode: $('ctrl-mode'),
      currentChip: $('current-chip'), currentArrow: $('current-arrow'), currentLabel: $('current-label'),
      bossBar: $('boss-bar'), bossFill: $('boss-fill'), bossName: $('boss-name'), qiDots: $('qi-dots'),
      toast: $('toast'),
      menu: $('overlay'), pause: $('pause'), settingsPanel: $('settings'),
      charselect: $('charselect'), levelselect: $('levelselect'), levelGrid: $('level-grid'),
      gameover: $('gameover'), ending: $('ending'),
      finalScore: $('final-score'), finalAct: $('final-act'), finalEaten: $('final-eaten'),
      heroList: $('hero-list'),
    };
    this._renderHeroes();
    this._bindSettings();
    this._bindPause();
    this.loadSettings();
  },

  // ---------- 角色选择 ----------
  _renderHeroes() {
    const list = this.els.heroList;
    list.innerHTML = '';

    // 种族卡
    for (const sp of SPECIES) {
      const card = document.createElement('div');
      card.className = 'hero-card' + (sp.id === this.selectedSpecies ? ' selected' : '');
      card.dataset.species = sp.id;
      card.style.setProperty('--hero-glow', this._pal().body + '66');
      const perks = sp.perks.map((x) => `<span class="perk">· ${x}</span>`).join('<br>');
      const cons = (sp.cons || []).map((c) => `<br><span class="con">· ${c}</span>`).join('');
      card.innerHTML = `
        <div class="hero-emblem"><canvas class="hero-fish" width="132" height="132"></canvas></div>
        <div class="hero-name">${sp.name}</div>
        <div class="hero-title">${sp.title}</div>
        <div class="hero-desc">${perks}${cons}</div>
      `;
      card.addEventListener('click', () => this.selectSpecies(sp.id));
      list.appendChild(card);
    }

    // 配色条
    const swatchWrap = document.getElementById('palette-row');
    if (swatchWrap) {
      swatchWrap.innerHTML = '';
      for (const pal of PALETTES) {
        const sw = document.createElement('button');
        sw.className = 'palette-swatch' + (pal.id === this.selectedPalette ? ' selected' : '');
        sw.dataset.palette = pal.id;
        sw.title = pal.name;
        sw.style.setProperty('--sw', pal.body);
        sw.style.setProperty('--sw-light', pal.bodyLight);
        sw.innerHTML = `<span class="sw-dot"></span><span class="sw-name">${pal.name}</span>`;
        sw.addEventListener('click', () => this.selectPalette(pal.id));
        swatchWrap.appendChild(sw);
      }
    }

    this._redrawAll();
    this._startAnim();
  },

  _pal() {
    return PALETTES.find((p) => p.id === this.selectedPalette) || PALETTES[0];
  },

  /** 重绘所有预览 canvas */
  _redrawAll() {
    const pal = this._pal();
    for (const card of this.els.heroList.children) {
      const sp = SPECIES.find((x) => x.id === card.dataset.species);
      if (!sp) continue;
      card.style.setProperty('--hero-glow', pal.body + '66');
      const cv = card.querySelector('.hero-fish');
      this._drawHeroFish(cv, sp, 0);
    }
  },

  /** 预览动画：尾部摆动 + 轻微浮动 */
  _startAnim() {
    if (this._animId) cancelAnimationFrame(this._animId);
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / 1000;
      if (this.els.menu.classList.contains('hidden')) {
        this._animId = requestAnimationFrame(tick);
        return;
      }
      let i = 0;
      for (const card of this.els.heroList.children) {
        const sp = SPECIES.find((x) => x.id === card.dataset.species);
        if (!sp) continue;
        const cv = card.querySelector('.hero-fish');
        this._drawHeroFish(cv, sp, t + i * 0.7);
        i++;
      }
      this._animId = requestAnimationFrame(tick);
    };
    this._animId = requestAnimationFrame(tick);
  },

  /** 在小 canvas 上绘制种族的鲲（带动画相位） */
  _drawHeroFish(canvas, species, t) {
    const g = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = 140, cssH = 140;
    if (canvas.width !== cssW * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    const pal = this._pal();

    // 背景柔光
    const bg = g.createRadialGradient(cssW / 2, cssH / 2, 4, cssW / 2, cssH / 2, cssW * 0.52);
    bg.addColorStop(0, pal.body + '30');
    bg.addColorStop(1, pal.body + '00');
    g.fillStyle = bg;
    g.fillRect(0, 0, cssW, cssH);

    const bob = Math.sin(t * 1.6) * 3;
    const fakePlayer = {
      x: cssW / 2,
      y: cssH / 2 + bob,
      radius: species.shape === 'ray' ? 13
            : species.shape === 'serpent' ? 13
            : species.shape === 'turtle' ? 15
            : 17,
      angle: -Math.PI / 3.2,
      tailPhase: t * 5,
      invincible: 0,
      mouthOpen: 0.35 + Math.sin(t * 2.2) * 0.3,
      formIndex: 0,
      growthFrac: 0,
      hero: makeHero(species.id, this.selectedPalette),
    };
    renderKun(g, fakePlayer, t);
  },

  selectSpecies(id) {
    this.selectedSpecies = id;
    for (const c of this.els.heroList.children) {
      c.classList.toggle('selected', c.dataset.species === id);
    }
  },

  selectPalette(id) {
    this.selectedPalette = id;
    const wrap = document.getElementById('palette-row');
    if (wrap) {
      for (const b of wrap.children) b.classList.toggle('selected', b.dataset.palette === id);
    }
    this._redrawAll();
  },

  getHero() {
    return makeHero(this.selectedSpecies, this.selectedPalette);
  },

  // ---------- 暂停 ----------
  _bindPause() {
    $('btn-resume').addEventListener('click', () => this.hidePause());
    $('btn-pause-restart').addEventListener('click', () => {
      this.hidePause();
      this._onRestart && this._onRestart();
    });
    $('btn-pause-menu').addEventListener('click', () => {
      this.hidePause();
      this._onMenu && this._onMenu();
    });
    $('btn-pause-settings').addEventListener('click', () => {
      this._settingsReturn = 'pause';
      this.els.settingsPanel.classList.remove('hidden');
    });
  },

  setPauseCallbacks({ onResume, onRestart, onMenu }) {
    this._onResume = onResume;
    this._onRestart = onRestart;
    this._onMenu = onMenu;
  },

  showPause() {
    this._paused = true;
    this.els.pause.classList.remove('hidden');
  },
  hidePause() {
    this._paused = false;
    this.els.pause.classList.add('hidden');
    this._onResume && this._onResume();
  },
  get paused() { return this._paused; },

  // ---------- 设置 ----------
  _bindSettings() {
    $('btn-settings').addEventListener('click', () => {
      this._settingsReturn = 'menu';
      this.els.settingsPanel.classList.remove('hidden');
    });
    $('btn-settings-close').addEventListener('click', () => {
      this.els.settingsPanel.classList.add('hidden');
      if (this._settingsReturn === 'pause') {
        // 返回暂停界面（保持暂停）
      }
    });

    const vol = $('set-volume');
    vol.addEventListener('input', () => {
      settings.volume = +vol.value;
      $('set-volume-val').textContent = vol.value;
      vol.style.setProperty('--fill', vol.value + '%');
      this.applySettings();
    });

    $('set-fps').addEventListener('change', (ev) => {
      settings.fpsCap = +ev.target.value;
      this.applySettings();
    });
    $('set-shake').addEventListener('change', (ev) => {
      settings.shake = ev.target.checked;
      this.applySettings();
    });
    $('set-quality').addEventListener('change', (ev) => {
      settings.quality = ev.target.value;
      this.applySettings();
    });
  },

  applySettings() {
    this.saveSettings();
    if (this._onSettingsChanged) this._onSettingsChanged(settings);
  },

  saveSettings() {
    try { localStorage.setItem('kun-settings-v2', JSON.stringify(settings)); } catch (e) {}
  },

  loadSettings() {
    try {
      const raw = localStorage.getItem('kun-settings-v2');
      if (raw) Object.assign(settings, JSON.parse(raw));
    } catch (e) {}
    // 同步到控件
    const vol = $('set-volume');
    vol.value = settings.volume;
    $('set-volume-val').textContent = settings.volume;
    vol.style.setProperty('--fill', settings.volume + '%');
    $('set-fps').value = String(settings.fpsCap);
    $('set-shake').checked = settings.shake;
    $('set-quality').value = settings.quality;
  },

  onSettingsChanged(fn) { this._onSettingsChanged = fn; },
  onLevelPick(fn) { this._onLevelPick = fn; },

  // ---------- 显隐 ----------
  showHud(v) { this.els.hud.classList.toggle('hidden', !v); },
  /** 隐藏所有菜单类界面（标题/选角/关卡/结算/结局），进游戏场景前调用 */
  hideAllScreens() {
    this.els.menu.classList.add('hidden');
    this.els.charselect.classList.add('hidden');
    this.els.levelselect.classList.add('hidden');
    this.els.gameover.classList.add('hidden');
    this.els.ending.classList.add('hidden');
    this._syncAnim();
  },
  showMenu(v) {
    this.els.menu.classList.toggle('hidden', !v);
    if (v) { this.els.charselect.classList.add('hidden'); this.els.levelselect.classList.add('hidden'); }
    this._syncAnim();
  },
  showCharSelect(v) {
    this.els.charselect.classList.toggle('hidden', !v);
    if (v) {
      this.els.menu.classList.add('hidden');
      this.els.levelselect.classList.add('hidden');
      this._renderHeroes();          // 重进时重绘（配色可能变过）
      this._syncAnim();
    }
  },
  showLevelSelect(v) {
    this.els.levelselect.classList.toggle('hidden', !v);
    if (v) {
      this.els.menu.classList.add('hidden');
      this.els.charselect.classList.add('hidden');
      this._renderLevelGrid();
      this._syncAnim();
    }
  },
  showGameOver(v) { this.els.gameover.classList.toggle('hidden', !v); },
  showEnding(v) { this.els.ending.classList.toggle('hidden', !v); },

  /** 预览动画只在可见的界面跑 */
  _syncAnim() {
    const menuVisible = !this.els.menu.classList.contains('hidden');
    const charVisible = !this.els.charselect.classList.contains('hidden');
    if (!menuVisible && !charVisible && this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = 0;
    } else if ((menuVisible || charVisible) && !this._animId) {
      this._startAnim();
    }
  },

  /** 关卡网格（默认全解锁） */
  _renderLevelGrid() {
    const grid = this.els.levelGrid;
    grid.innerHTML = '';
    for (const lv of LEVELS) {
      const b = document.createElement('button');
      b.className = 'level-card';
      b.innerHTML = `
        <span class="lv-id">${lv.id}</span>
        <span class="lv-name">${lv.name}</span>
        <span class="lv-goal">目标体型 Lv.${lv.requiredLevel}</span>
        ${lv.boss ? '<span class="lv-boss">🐉 Boss</span>' : ''}
      `;
      b.addEventListener('click', () => {
        this.els.levelselect.classList.add('hidden');
        this._onLevelPick && this._onLevelPick(lv.id);
      });
      grid.appendChild(b);
    }
  },

  /** 体型等级 HUD */
  setLevelHud(cur, goal) {
    this._lvCur = cur; this._lvGoal = goal;
    const el = this.els.levelHud;
    if (el) el.textContent = `体型 Lv.${cur} / ${goal}`;
  },

  // ---------- HUD 数据 ----------
  setScore(n) { this.els.score.textContent = n; },
  setActLevel(t) { this.els.actlevel.textContent = t; },
  setForm(n) { this.els.form.textContent = n; },
  setGrowth(frac) { this.els.growthFill.style.width = Math.min(100, frac * 100) + '%'; },
  setLives(n, max = 4) {
    let h = '';
    for (let i = 0; i < max; i++) {
      if (i >= 3 && n < 4) break;
      h += `<span class="${i < n ? '' : 'lost'}">❤️</span>`;
    }
    this.els.lives.innerHTML = h;
  },
  setItems({ speedT, shield }) {
    let h = '';
    if (speedT > 0) h += `<span class="item-chip">灵珠 ${Math.ceil(speedT)}s</span>`;
    if (shield) h += `<span class="item-chip">龟甲</span>`;
    this.els.itemFx.innerHTML = h;
  },
  setCtrl(mode) {
    const text = mode === 'kb' ? '⌨️ 键盘' : '🖱️ 鼠标';
    if (this.els.ctrlMode.textContent !== text) this.els.ctrlMode.textContent = text;
  },

  /**
   * 水流指示：箭头指向水流方向，文字说明顺流/逆流。
   * @param align  水流方向与玩家朝向的点积：1 = 完美顺流，-1 = 正逆流
   * @param speed  当前采样点流速（px/s）
   * @param dir    水流方向向量（世界坐标）
   */
  setCurrent(align, speed, dir) {
    const chip = this.els.currentChip;
    if (!chip) return;
    if (!speed || speed < 12) { chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');

    // 箭头按水流在世界里的方向旋转（屏幕上方 = -y）
    const ang = Math.atan2(dir.y, dir.x);
    this.els.currentArrow.style.transform = `rotate(${ang}rad)`;

    // 只在进入特殊物理区域时显示区域名 —— 这些区域才有推力，
    // 普通水域的流线只是动画，不该让玩家以为自己在被推。
    const zoneName = dir.label || '';
    let label;
    if (align > 0.45) label = '顺流';
    else if (align < -0.45) label = '逆流';
    else label = '横流';
    const level = speed > 150 ? '强' : speed > 70 ? '中' : '弱';
    const text = zoneName ? `${zoneName} · ${level}` : `${label} · ${level}`;
    if (this.els.currentLabel.textContent !== text) {
      this.els.currentLabel.textContent = text;
      chip.dataset.kind = align > 0.45 ? 'good' : align < -0.45 ? 'bad' : 'side';
    }
  },
  hideCurrent() {
    if (this.els.currentChip) this.els.currentChip.classList.add('hidden');
  },

  setBoss(boss) {
    this.els.bossBar.classList.toggle('hidden', !boss);
    this.els.qiDots.classList.toggle('hidden', !boss);
    if (boss) {
      this.els.bossName.textContent = `${boss.name} · ${boss.title}`;
      this.setBossHp(boss.hpFrac);
    }
  },
  setBossHp(frac) { this.els.bossFill.style.width = Math.max(0, frac * 100) + '%'; },
  setQi(n) {
    [...this.els.qiDots.children].forEach((d, i) => d.classList.toggle('on', i < n));
  },

  toast(msg) {
    const t = this.els.toast;
    t.textContent = msg;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  },

  setGameOverStats({ score, actLabel, eaten }) {
    this.els.finalScore.textContent = score;
    this.els.finalAct.textContent = actLabel;
    this.els.finalEaten.textContent = eaten;
  },
};