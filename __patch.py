import io

p = 'src/heroes/jiao.js'
s = io.open(p, encoding='utf-8').read()

# ---------- 1. 头宽曲线：颈宽与躯干齐平，颊部略宽 ----------
s = s.replace("""const H_KEYS = [
  [0.00, 0.80], [0.12, 0.94], [0.26, 1.00], [0.40, 0.98],
  [0.54, 0.92], [0.66, 0.84], [0.78, 0.72], [0.88, 0.58],
  [0.96, 0.44], [1.00, 0.34],
];""",
"""const H_KEYS = [
  [0.00, 0.70], [0.14, 0.92], [0.28, 1.00], [0.42, 0.98],
  [0.56, 0.90], [0.68, 0.80], [0.80, 0.68], [0.90, 0.56],
  [1.00, 0.42],
];""")

s = s.replace("  const hw = Wd * 0.72;                   // 颅宽基准（不能比颈粗太多）\n  const hl = Wd * 2.20;                   // 颅长",
              "  const hw = Wd * 1.02;                   // 颅宽基准（颈宽与躯干齐平，颊部略宽）\n  const hl = Wd * 2.05;                   // 颅长")

# ---------- 2. 头顶受光大幅减弱：不再像灯泡 ----------
s = s.replace("  ctx.globalAlpha = baseA * 0.52;\n  ctx.fillStyle = topLight;",
              "  ctx.globalAlpha = baseA * 0.22;\n  ctx.fillStyle = topLight;")

# 头部主渐变压暗：不要把整块头做亮
s = s.replace("""  const hg = cachedLinear(ctx, 'jiao|head|' + pal.body + '|' + pal.belly + '|' + pal.fin + '|' + Math.round(hw),
    0, -hw * 1.05, 0, hw * 1.05,
    [[0, pal.fin], [0.22, pal.body], [0.72, pal.body], [1, pal.fin]]);""",
"""  const hg = cachedLinear(ctx, 'jiao|head|' + pal.body + '|' + pal.belly + '|' + pal.fin + '|' + Math.round(hw),
    0, -hw * 1.05, 0, hw * 1.05,
    [[0, pal.fin], [0.30, pal.body], [0.70, pal.body], [1, pal.fin]]);""")

# ---------- 3. 角加长，明确打破轮廓 ----------
s = s.replace("      hx - hl * (0.86 + form * 0.28), side * hw * (0.90 + form * 0.22) + wave,\n      Wd * 0.30, Wd * 0.006,",
              "      hx - hl * (1.05 + form * 0.32), side * hw * (1.10 + form * 0.26) + wave,\n      Wd * 0.34, Wd * 0.006,")

# ---------- 4. 鳞片：去掉 V 形亮弧（梯子感），改成稀疏柔弧 ----------
start = s.index("// ============================================================\n// 鳞片：沿脊柱的覆瓦鳞列")
end = s.index("// ============================================================\n// 龙首（俯视）")
new_scales = r'''// ============================================================
// 鳞片：俯视下的背部鳞纹
//   只在体侧画稀疏的柔弧（像光在鳞面上滑过），
//   中央保持干净 —— 避免"铁路/肋骨"的规律感。
// ============================================================
function drawScales(ctx, s, Wd, pal, phase) {
  const baseA = ctx.globalAlpha;
  const lanes = [-0.62, 0.62];

  for (let i = 3; i < N - 3; i += 1) {
    const t = i / (N - 1);
    const w = PW[i];
    if (w < Wd * 0.10) break;

    const nx = PNX[i], ny = PNY[i];
    const tx = PTX[i], ty = PTY[i];
    const rot = Math.atan2(ty, tx);
    const sc = Math.max(w * 0.46, Wd * 0.05);

    for (let li = 0; li < lanes.length; li++) {
      const cx = PX[i] + nx * w * lanes[li];
      const cy = PY[i] + ny * w * lanes[li];

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      // 一道贴着体侧走向的柔弧，宽度随体宽衰减
      ctx.globalAlpha = baseA * ((1 - t) * 0.26 + 0.05);
      ctx.strokeStyle = li === 0 ? pal.belly : pal.fin;
      ctx.lineWidth = Math.max(0.4, w * 0.10);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(-sc * 0.25, 0, sc * 0.95, -0.62, 0.62);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 中央一条极淡的脊线亮带（不是线，是渐变带）
  const baseA2 = ctx.globalAlpha;
  ctx.globalAlpha = baseA2 * 0.14;
  ctx.strokeStyle = pal.belly;
  ctx.lineWidth = Math.max(0.5, Wd * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 1; i < N - 5; i++) {
    if (i === 1) ctx.moveTo(PX[i], PY[i]); else ctx.lineTo(PX[i], PY[i]);
  }
  ctx.stroke();
  ctx.globalAlpha = baseA2;
}

// ============================================================
'''
s = s[:start] + new_scales + s[end:]

io.open(p, 'w', encoding='utf-8').write(s)
print('ok')