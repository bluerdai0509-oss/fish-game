// ============================================================
// WebAudio 合成器：零素材，全部程序化生成
// ============================================================
let actx = null, master = null;
let muted = false;
let ambientNodes = null;   // { src, filter, gain }

function ensure() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = 0.9;
      master.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}

function blip(freq, dur = 0.12, type = 'sine', vol = 0.15, slide = 0) {
  if (muted || !actx) return;
  const t = actx.currentTime;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}

function noiseBurst(dur = 0.2, vol = 0.12, filterFreq = 800) {
  if (muted || !actx) return;
  const t = actx.currentTime;
  const len = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = filterFreq;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const audio = {
  init() { ensure(); },

  /** 0~1 主音量 */
  setVolume(v) {
    if (!master) return;
    const vol = Math.max(0, Math.min(1, v));
    master.gain.value = muted ? 0 : 0.9 * vol;
  },

  toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.9; return muted; },
  get muted() { return muted; },

  // ---- 玩法音效 ----
  eat(combo) { blip(420 + Math.min(combo, 8) * 60, 0.1, 'sine', 0.16, 260); },
  chomp()    { blip(220, 0.08, 'square', 0.06, -60); noiseBurst(0.08, 0.05, 1200); },
  hurt()     { blip(140, 0.3, 'sawtooth', 0.2, -80); },
  dash()     { noiseBurst(0.18, 0.07, 2400); blip(660, 0.1, 'sine', 0.05, 220); },
  item()     { blip(880, 0.1, 'triangle', 0.12, 220); blip(1320, 0.12, 'triangle', 0.08, 180); },
  levelup()  { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.14, 'triangle', 0.14), i * 90)); },
  evolve()   { [392, 523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sine', 0.1), i * 130)); },
  over()     { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => blip(f, 0.25, 'triangle', 0.16), i * 160)); },

  // ---- Boss 音效 ----
  bossRoar() { blip(90, 0.7, 'sawtooth', 0.22, 60); noiseBurst(0.5, 0.1, 300); },
  bossHit()  { blip(110, 0.2, 'square', 0.2, -40); noiseBurst(0.15, 0.12, 500); },
  bite()     { blip(180, 0.15, 'square', 0.18, -100); noiseBurst(0.12, 0.1, 900); },
  clang()    { blip(1200, 0.06, 'square', 0.08, -400); blip(800, 0.1, 'triangle', 0.06); },
  splash()   { noiseBurst(0.3, 0.14, 1000); },

  // ---- 环境音：每幕低频水声（过滤噪声循环）----
  startAmbient(actId) {
    this.stopAmbient();
    if (muted || !actx) return;
    const len = actx.sampleRate * 2;
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = [220, 320, 150][actId - 1] || 220;
    const g = actx.createGain();
    g.gain.value = 0.035;
    src.connect(filter).connect(g).connect(master);
    src.start();
    ambientNodes = { src, g };
  },
  stopAmbient() {
    if (ambientNodes) {
      try { ambientNodes.src.stop(); } catch (e) { /* already stopped */ }
      ambientNodes = null;
    }
  },

  // ---- 化鹏结局：五声音阶琶音（宫商角徵羽，单振荡器 + 简单包络）----
  playEnding() {
    if (muted || !actx) return;
    const penta = [261.6, 293.7, 329.6, 392.0, 440.0]; // C D E G A
    const seq = [];
    // 上行三组，跨八度
    for (let oct = 0; oct < 3; oct++) {
      for (let i = 0; i < penta.length; i++) {
        seq.push(penta[i] * Math.pow(2, oct));
      }
    }
    const t0 = actx.currentTime + 0.1;
    seq.forEach((freq, i) => {
      const t = t0 + i * 0.42;
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(g).connect(master);
      osc.start(t); osc.stop(t + 0.6);
      // 低八度衬底，每拍一次
      if (i % 5 === 0) {
        const o2 = actx.createOscillator();
        const g2 = actx.createGain();
        o2.type = 'sine';
        o2.frequency.value = freq / 2;
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.08, t + 0.08);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        o2.connect(g2).connect(master);
        o2.start(t); o2.stop(t + 1);
      }
    });
  },
};
