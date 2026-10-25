"use strict";
/* Lantern activity: Roots, a gentle endless runner. Loaded after the core script in game.html and shares its globals
   (ctx, W, H, link, input, save, CFG, go, endRound, assist, voice, sfx, fx, world, mood, ...).

   A glowing seed runs along a winding vine on its own; the player only steers up and down (finger tilt with the
   sleeve, or a finger / mouse) to keep it on the glowing band. It starts slow, wide and almost straight, then the
   night grows wilder: faster, curvier, narrower, with thorn clusters to slip past, forks where only the glowing
   branch holds, and gaps to leap. Leaving the vine or touching thorns wilts a leaf; three wilts and the vine
   rests. Running true near the centre builds a combo, and flowers bloom behind the seed as notes of a melody.
   The seed travels through four looping places: a moonlit meadow, a glowing-mushroom grove, a stream with a
   waterfall and lily pads, and a starry hilltop. When stress rises the helping hand slows the run, widens and
   gilds the vine, smooths the curves ahead, clears thorns and catches wilting leaves. */

const ROOTS_BIOMES = [
  { line: "A moonlit meadow. The seed is on its way.", again: "Back through the meadow…", skyT: "#0b1736", skyB: "#22405a", far: "#16304d", mid: "#0f2236",
    ground: "#0c1d1a", grass: "#1f4d3c", fly: "#e9ffa6", drop: "#bfefff", star: 0.55,
    hues: ["#ffb3c7", "#fff1a8", "#c7b8ff", "#ffd0a0"] },
  { line: "Into the mushroom grove…", again: "The mushrooms glow brighter now…", skyT: "#120c2e", skyB: "#2c1b4c", far: "#261a44", mid: "#1a1233",
    ground: "#150f26", grass: "#2c2552", fly: "#9ff7e8", drop: "#d6b8ff", star: 0.35,
    hues: ["#9ff7e8", "#c7a4ff", "#ff9ed8"] },
  { line: "Listen… a little waterfall.", again: "The waterfall again, rushing now…", skyT: "#06182a", skyB: "#14404f", far: "#113246", mid: "#0b2333",
    ground: "#0a1d24", grass: "#1d4b47", fly: "#cfefff", drop: "#bfefff", star: 0.45,
    hues: ["#ffc2d9", "#f4f1ff", "#8fd8ff"] },
  { line: "Up onto the starry hilltop…", again: "Over the hilltop once more…", skyT: "#040820", skyB: "#1c2156", far: "#121b40", mid: "#0c1330",
    ground: "#0b1026", grass: "#28325c", fly: "#ffe7a6", drop: "#ffe7a6", star: 1,
    hues: ["#ffe7a6", "#bcd2ff", "#ffffff"] },
];
const ROOTS_CHEER = ["Lovely and steady.", "Just like that.", "The garden is waking up behind you.", "Eyes ahead, hands soft.",
  "You're doing beautifully.", "Smooth as moonlight."];
const ROOTS_TIER = ["The night grows wilder…", "Faster now. Let your eyes run ahead.", "The wind is picking up…",
  "Wilder still. Soft, steady hands.", "The night is racing, and so are you."];
const ROOTS_WILT = ["A leaf rests. That's all right.", "Easy does it. Back to the glow.", "Let the vine come to you."];
const ROOTS_CRITTER = [
  { kind: "fox", line: "Look, a fox!" }, { kind: "owl", line: "An owl is keeping watch over you." },
  { kind: "frog", line: "A little frog says hello." }, { kind: "rabbit", line: "A rabbit came to see the stars too." },
];
const ROOTS_PHRASE = [0, 2, 4, 2, 1, 3, 5, 3];  // pentatonic steps; the base climbs with the combo
const ROOTS_SPAN = 18;                          // screen heights per place; the four places loop
const ROOTS_COMBO_MAX = 8;
const ROOTS_THORN_BALLS = [[0, 0, 0.62], [-0.36, 0.3, 0.42], [0.35, -0.3, 0.44]];  // [dx, dy, size] in thorn radii

// ---- small drawing helpers (uniquely named: every Lantern file shares one global scope)

const rootsSprites = new Map();
function rootsRgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function rootsSprite(hex) {  // a cached soft glow, much cheaper than shadowBlur on tablets
  let c = rootsSprites.get(hex);
  if (c) return c;
  c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rootsRgba(hex, 1)); gr.addColorStop(0.22, rootsRgba(hex, 0.5));
  gr.addColorStop(0.55, rootsRgba(hex, 0.12)); gr.addColorStop(1, rootsRgba(hex, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  rootsSprites.set(hex, c);
  return c;
}
function rootsGlow(hex, x, y, r, a) {
  if (!(a > 0.003) || !(r > 0.5)) return;
  ctx.globalAlpha = Math.min(1, a); ctx.drawImage(rootsSprite(hex), x - r, y - r, r * 2, r * 2);
}
function rootsSmooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
function rootsPop(t) { t = clamp(t, 0, 1); const u = t - 1; return 1 + 2.7 * u * u * u + 1.7 * u * u; }  // ease-out-back
function rootsHash(i) { return (Math.imul((i | 0) ^ 0x5bd1e995, 2654435761) >>> 0) / 4294967296; }
function rootsEll(x, y, rx, ry, rot) {  // add an ellipse subpath (no joining line), never with a negative radius
  rx = Math.max(0.01, rx); ry = Math.max(0.01, ry);
  ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); ctx.ellipse(x, y, rx, ry, rot, 0, 6.2832);
}
function rootsCirc(x, y, r) { r = Math.max(0.01, r); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
function rootsWeights(bl) { const w = [0, 0, 0, 0]; w[bl.i] += 1 - bl.k; w[bl.j] += bl.k; return w; }
function rootsFarY(u, lift) { return 0.58 + lift + 0.05 * Math.sin(u * 1.7) + 0.03 * Math.sin(u * 4.3 + 2); }
function rootsMidY(u, lift) { return 0.75 + lift + 0.035 * Math.sin(u * 2.3) + 0.02 * Math.sin(u * 5.1 + 1); }
function rootsNearY(x) { return 0.915 + 0.018 * Math.sin(x * 2.1) + 0.01 * Math.sin(x * 5.7 + 1); }

// mid-layer scenery
function rootsTree(x, y, s, col) {
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x - s * 0.06, y); ctx.lineTo(x - s * 0.035, y - s * 0.6); ctx.lineTo(x + s * 0.035, y - s * 0.6); ctx.lineTo(x + s * 0.06, y);
  rootsCirc(x, y - s * 0.78, s * 0.3); rootsCirc(x - s * 0.24, y - s * 0.58, s * 0.22); rootsCirc(x + s * 0.24, y - s * 0.6, s * 0.23);
  ctx.fill();
  ctx.strokeStyle = "rgba(205,220,255,0.10)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y - s * 0.78, s * 0.3, -2.4, -0.5); ctx.stroke();
}
function rootsBigMushroom(x, y, s, time, bright) {
  const pulse = 0.75 + 0.25 * Math.sin(time * 0.6 + x * 0.01);
  ctx.globalCompositeOperation = "lighter";
  rootsGlow("#9ff7e8", x, y - s * 0.6, s * 0.75, 0.22 * pulse * bright);
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  ctx.fillStyle = "#3a3160";
  ctx.beginPath(); ctx.moveTo(x - s * 0.07, y); ctx.quadraticCurveTo(x - s * 0.02, y - s * 0.35, x - s * 0.04, y - s * 0.62);
  ctx.lineTo(x + s * 0.04, y - s * 0.62); ctx.quadraticCurveTo(x + s * 0.03, y - s * 0.35, x + s * 0.08, y); ctx.fill();
  ctx.fillStyle = "#4b3486";
  ctx.beginPath(); ctx.ellipse(x, y - s * 0.6, s * 0.34, s * 0.2, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rootsRgba("#9ff7e8", 0.35 + 0.4 * pulse * bright);
  ctx.beginPath(); rootsCirc(x - s * 0.15, y - s * 0.68, s * 0.035); rootsCirc(x + s * 0.05, y - s * 0.74, s * 0.045); rootsCirc(x + s * 0.2, y - s * 0.65, s * 0.03); ctx.fill();
}
function rootsWillow(x, y, s, time, col) {
  ctx.fillStyle = col; ctx.strokeStyle = col;
  ctx.beginPath(); ctx.moveTo(x - s * 0.06, y); ctx.quadraticCurveTo(x, y - s * 0.4, x - s * 0.02, y - s * 0.7); ctx.lineTo(x + s * 0.04, y - s * 0.7); ctx.lineTo(x + s * 0.06, y); ctx.fill();
  ctx.beginPath(); rootsEll(x, y - s * 0.78, s * 0.32, s * 0.14, 0); ctx.fill();
  ctx.lineWidth = 2; ctx.beginPath();
  for (let j = 0; j < 9; j++) {
    const bx = x + (j - 4) * s * 0.07, sway = Math.sin(time * 0.7 + j) * s * 0.03;
    ctx.moveTo(bx, y - s * 0.8); ctx.quadraticCurveTo(bx + (j - 4) * s * 0.03, y - s * 0.55, bx + (j - 4) * s * 0.04 + sway, y - s * (0.25 + 0.1 * (j % 3)));
  }
  ctx.stroke();
}
function rootsWaterfall(x, y, s, time) {
  ctx.fillStyle = "#091822";
  ctx.beginPath(); ctx.moveTo(x - s * 0.42, y); ctx.lineTo(x - s * 0.36, y - s * 1.2); ctx.lineTo(x - s * 0.1, y - s * 1.38);
  ctx.lineTo(x + s * 0.18, y - s * 1.32); ctx.lineTo(x + s * 0.4, y - s * 1.1); ctx.lineTo(x + s * 0.46, y); ctx.fill();
  ctx.fillStyle = "rgba(150,210,240,0.16)"; ctx.fillRect(x - s * 0.12, y - s * 1.34, s * 0.24, s * 1.34);
  ctx.strokeStyle = "rgba(205,238,255,0.4)"; ctx.lineWidth = 1.6; ctx.setLineDash([s * 0.12, s * 0.08]);
  ctx.lineDashOffset = -(time * s * 0.5) % (s * 0.4);
  ctx.beginPath();
  for (let j = 0; j < 5; j++) { const lx = x - s * 0.1 + j * s * 0.05; ctx.moveTo(lx, y - s * 1.33); ctx.lineTo(lx + Math.sin(j) * 2, y); }
  ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
  ctx.fillStyle = "rgba(150,210,240,0.2)"; ctx.beginPath(); rootsEll(x, y, s * 0.3, s * 0.05, 0); ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  rootsGlow("#cfefff", x, y - s * 0.05, s * 0.45, 0.28 + 0.06 * Math.sin(time * 0.8));
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
}
function rootsPine(x, y, s, col) {
  ctx.fillStyle = col; ctx.beginPath();
  for (let j = 0; j < 3; j++) {
    const top = y - s * (0.55 + j * 0.2), wd = s * (0.24 - j * 0.06);
    ctx.moveTo(x - wd, top + s * 0.3); ctx.lineTo(x, top); ctx.lineTo(x + wd, top + s * 0.3); ctx.closePath();
  }
  ctx.fill(); ctx.fillRect(x - s * 0.03, y - s * 0.3, s * 0.06, s * 0.3);
}

// a flower blooming on the vine; kind = biome (0 meadow bloom, 1 mushroom, 2 lotus, 3 star-flower)
function rootsFlower(x, y, fl, k, time, bright) {
  const h = fl.h * H * k;
  if (h < 0.5) return;
  const r = h * 0.22;
  ctx.save(); ctx.translate(x, y);
  if (!fl.up && fl.kind !== 1) {  // a little bell hanging under the vine
    ctx.rotate(Math.sin(time * 0.9 + fl.sw) * 0.08);
    ctx.strokeStyle = "#5fbf86"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(h * 0.35, h * 0.2, h * 0.3, h * 0.62); ctx.stroke();
    ctx.globalCompositeOperation = "lighter"; rootsGlow(fl.hue, h * 0.3, h * 0.78, h * 0.7, 0.45 * bright * Math.min(1, k));
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 0.65 + 0.35 * bright;
    ctx.fillStyle = fl.hue; ctx.beginPath(); ctx.ellipse(h * 0.3, h * 0.82, Math.max(0.01, h * 0.17), Math.max(0.01, h * 0.2), 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.restore(); return;
  }
  ctx.rotate(Math.sin(time * 0.9 + fl.sw) * 0.1);
  const hx = 0, hy = -h;
  if (fl.kind === 1) {  // glowing mushroom
    ctx.globalCompositeOperation = "lighter"; rootsGlow(fl.hue, 0, -h * 0.7, h * 1.1, (0.25 + 0.4 * bright) * Math.min(1, k));
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.fillStyle = "#e6dcf5"; ctx.fillRect(-h * 0.07, -h * 0.72, h * 0.14, h * 0.72);
    ctx.globalAlpha = 0.7 + 0.3 * bright; ctx.fillStyle = fl.hue;
    ctx.beginPath(); ctx.ellipse(0, -h * 0.7, Math.max(0.01, h * 0.36), Math.max(0.01, h * 0.26), 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.beginPath(); rootsCirc(-h * 0.14, -h * 0.82, h * 0.05); rootsCirc(h * 0.1, -h * 0.88, h * 0.04); ctx.fill();
    ctx.restore(); return;
  }
  ctx.strokeStyle = "#6fbf8f"; ctx.lineWidth = Math.max(1.4, h * 0.06);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(h * 0.22, -h * 0.5, hx, hy); ctx.stroke();
  ctx.fillStyle = "#79d29c"; ctx.beginPath(); rootsEll(h * 0.13, -h * 0.38, h * 0.14, h * 0.05, -0.6); ctx.fill();
  ctx.globalCompositeOperation = "lighter"; rootsGlow(fl.hue, hx, hy, h * 0.9, (0.2 + 0.45 * bright) * Math.min(1, k));
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 0.7 + 0.3 * bright; ctx.fillStyle = fl.hue;
  ctx.beginPath();
  if (fl.kind === 0) {
    for (let p = 0; p < 5; p++) { const a = p * 1.2566 + fl.sw; rootsEll(hx + Math.cos(a) * r * 0.9, hy + Math.sin(a) * r * 0.9, r * 0.75, r * 0.42, a); }
    ctx.fill(); ctx.fillStyle = "#fff3b0"; ctx.beginPath(); rootsCirc(hx, hy, r * 0.45);
  } else if (fl.kind === 2) {
    for (const a of [-0.7, 0, 0.7]) {
      const tx = hx + Math.sin(a) * r * 1.6, ty = hy - Math.cos(a) * r * 1.6;
      ctx.moveTo(hx, hy + r * 0.4);
      ctx.quadraticCurveTo(hx + Math.cos(a) * r * 0.9 + Math.sin(a) * r, hy + Math.sin(a) * r * 0.9 - r * 0.4, tx, ty);
      ctx.quadraticCurveTo(hx - Math.cos(a) * r * 0.9 + Math.sin(a) * r, hy - Math.sin(a) * r * 0.9 - r * 0.4, hx, hy + r * 0.4);
    }
  } else {
    for (let p = 0; p < 10; p++) {
      const a = -Math.PI / 2 + p * 0.6283, rr = p % 2 ? r * 0.55 : r * 1.4;
      p === 0 ? ctx.moveTo(hx + Math.cos(a) * rr, hy + Math.sin(a) * rr) : ctx.lineTo(hx + Math.cos(a) * rr, hy + Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

// creatures (screen coordinates; s = size in px)
function rootsFox(x, y, s, k, time) {
  if (k < 0.01) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(x - s * 2, y - s * 3, s * 4, s * 3); ctx.clip();
  ctx.translate(x, y + s * (1.3 - 2.3 * rootsSmooth(k))); ctx.rotate(Math.sin(time * 0.7) * 0.07);
  ctx.fillStyle = "#d27c46"; ctx.beginPath();
  ctx.moveTo(-s * 0.55, -s * 0.15); ctx.lineTo(-s * 0.42, -s * 0.95); ctx.lineTo(-s * 0.08, -s * 0.42); ctx.closePath();
  ctx.moveTo(s * 0.55, -s * 0.15); ctx.lineTo(s * 0.42, -s * 0.95); ctx.lineTo(s * 0.08, -s * 0.42); ctx.closePath();
  rootsEll(0, 0, s * 0.6, s * 0.48, 0); rootsEll(0, s * 0.75, s * 0.55, s * 0.5, 0); ctx.fill();
  ctx.fillStyle = "#4a2a20"; ctx.beginPath();
  ctx.moveTo(-s * 0.45, -s * 0.3); ctx.lineTo(-s * 0.4, -s * 0.75); ctx.lineTo(-s * 0.2, -s * 0.42); ctx.closePath();
  ctx.moveTo(s * 0.45, -s * 0.3); ctx.lineTo(s * 0.4, -s * 0.75); ctx.lineTo(s * 0.2, -s * 0.42); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#f3e4d4"; ctx.beginPath(); rootsEll(-s * 0.24, s * 0.18, s * 0.28, s * 0.2, 0.3); rootsEll(s * 0.24, s * 0.18, s * 0.28, s * 0.2, -0.3); ctx.fill();
  ctx.fillStyle = "#24160f"; ctx.beginPath(); rootsCirc(0, s * 0.22, s * 0.07); ctx.fill();
  const blink = (time % 4.6) < 0.16 || k < 0.6;
  if (blink) {
    ctx.strokeStyle = "#24160f"; ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.beginPath(); ctx.arc(-s * 0.22, -s * 0.06, s * 0.07, 0.2, 2.9); ctx.moveTo(s * 0.29, -s * 0.06); ctx.arc(s * 0.22, -s * 0.06, s * 0.07, 0.2, 2.9); ctx.stroke();
  } else {
    ctx.beginPath(); rootsCirc(-s * 0.22, -s * 0.06, s * 0.065); rootsCirc(s * 0.22, -s * 0.06, s * 0.065); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); rootsCirc(-s * 0.2, -s * 0.09, s * 0.02); rootsCirc(s * 0.24, -s * 0.09, s * 0.02); ctx.fill();
  }
  ctx.restore();
}
function rootsOwl(x, y, s, k, time, look) {
  ctx.save();
  ctx.strokeStyle = "#0b0d1c"; ctx.lineWidth = s * 0.22; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x - s * 4, -10); ctx.quadraticCurveTo(x - s * 1.5, y + s * 0.4, x + s * 1.6, y + s * 0.85); ctx.stroke();
  ctx.fillStyle = "#16314a"; ctx.beginPath(); rootsEll(x - s * 1.6, y + s * 0.15, s * 0.32, s * 0.12, 0.6); rootsEll(x + s * 1.1, y + s * 0.95, s * 0.3, s * 0.11, -0.4); ctx.fill();
  ctx.translate(x, y); ctx.rotate(look * 0.12 * k);
  ctx.fillStyle = "#6f6284"; ctx.beginPath();
  ctx.moveTo(-s * 0.42, -s * 0.5); ctx.lineTo(-s * 0.36, -s * 0.95); ctx.lineTo(-s * 0.12, -s * 0.62); ctx.closePath();
  ctx.moveTo(s * 0.42, -s * 0.5); ctx.lineTo(s * 0.36, -s * 0.95); ctx.lineTo(s * 0.12, -s * 0.62); ctx.closePath();
  rootsEll(0, 0, s * 0.55, s * 0.75, 0); ctx.fill();
  ctx.fillStyle = "#a998c0"; ctx.beginPath(); rootsEll(0, s * 0.25, s * 0.34, s * 0.42, 0); ctx.fill();
  ctx.fillStyle = "#d9d0ea"; ctx.beginPath(); rootsCirc(-s * 0.22, -s * 0.3, s * 0.2); rootsCirc(s * 0.22, -s * 0.3, s * 0.2); ctx.fill();
  const open = k * ((time % 5.3) < 0.18 ? 0.1 : 1);
  if (open > 0.15) {
    ctx.globalCompositeOperation = "lighter"; rootsGlow("#ffd27a", 0, -s * 0.3, s * 0.7, 0.25 * k);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffd27a"; ctx.beginPath(); rootsEll(-s * 0.22, -s * 0.3, s * 0.12, s * 0.12 * open, 0); rootsEll(s * 0.22, -s * 0.3, s * 0.12, s * 0.12 * open, 0); ctx.fill();
    ctx.fillStyle = "#1a1020"; ctx.beginPath(); rootsEll(-s * 0.22 + look * s * 0.04, -s * 0.3, s * 0.055, s * 0.055 * open, 0); rootsEll(s * 0.22 + look * s * 0.04, -s * 0.3, s * 0.055, s * 0.055 * open, 0); ctx.fill();
  } else {
    ctx.strokeStyle = "#4a3f5c"; ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath(); ctx.moveTo(-s * 0.32, -s * 0.28); ctx.quadraticCurveTo(-s * 0.22, -s * 0.22, -s * 0.12, -s * 0.28);
    ctx.moveTo(s * 0.12, -s * 0.28); ctx.quadraticCurveTo(s * 0.22, -s * 0.22, s * 0.32, -s * 0.28); ctx.stroke();
  }
  ctx.fillStyle = "#e0b060"; ctx.beginPath(); ctx.moveTo(-s * 0.06, -s * 0.14); ctx.lineTo(s * 0.06, -s * 0.14); ctx.lineTo(0, s * 0.02); ctx.fill();
  ctx.restore();
}
function rootsFrog(x, y, s, hop, croak, time, x2) {
  ctx.fillStyle = "#2f7a5a";
  ctx.beginPath(); ctx.moveTo(x, y); ctx.ellipse(x, y, s * 0.95, s * 0.3, 0, 0.35, 5.93); ctx.closePath();
  ctx.moveTo(x2, y + s * 0.1); ctx.ellipse(x2, y + s * 0.1, s * 0.8, s * 0.26, 0, -2.8, 2.8); ctx.closePath(); ctx.fill();
  const fx0 = lerp(x, x2, rootsSmooth(hop)), fy = y - s * 0.25 - Math.sin(Math.PI * clamp(hop, 0, 1)) * s * 1.4 + Math.sin(time * 1.3) * s * 0.03;
  ctx.save(); ctx.translate(fx0, fy);
  ctx.fillStyle = "#62bb72"; ctx.beginPath();
  rootsEll(0, 0, s * 0.55, s * 0.36, 0); rootsCirc(-s * 0.26, -s * 0.3, s * 0.15); rootsCirc(s * 0.26, -s * 0.3, s * 0.15);
  rootsEll(-s * 0.48, s * 0.22, s * 0.22, s * 0.1, 0.3); rootsEll(s * 0.48, s * 0.22, s * 0.22, s * 0.1, -0.3); ctx.fill();
  if (croak > 0) { ctx.fillStyle = "#cdf2b8"; ctx.beginPath(); rootsEll(0, s * 0.22, s * 0.2 * (0.6 + 0.4 * Math.sin(croak * 9)), s * 0.14, 0); ctx.fill(); }
  ctx.fillStyle = "#14231a"; ctx.beginPath(); rootsCirc(-s * 0.26, -s * 0.32, s * 0.06); rootsCirc(s * 0.26, -s * 0.32, s * 0.06); ctx.fill();
  ctx.strokeStyle = "#1e4a2c"; ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath(); ctx.arc(0, -s * 0.02, s * 0.22, 0.4, 2.74); ctx.stroke();
  ctx.restore();
}
function rootsRabbit(x, y, s, k, time) {
  ctx.save(); ctx.translate(x, y);
  const up = rootsSmooth(k);
  ctx.fillStyle = "#b8bcd6"; ctx.beginPath();
  rootsEll(0, -s * 0.45, s * 0.48, s * (0.42 + 0.14 * up), 0);
  const hx = s * 0.22, hy = -s * (0.85 + 0.3 * up);
  rootsCirc(hx, hy, s * 0.3);
  const ear = -1.2 + 1.0 * up + Math.sin(time * 1.1) * 0.05 * up;
  rootsEll(hx - s * 0.05 + Math.cos(ear - 1.57) * -s * 0.45, hy + Math.sin(ear - 1.57) * s * 0.45, s * 0.42, s * 0.1, ear - 1.57 + 3.1416);
  rootsEll(hx + s * 0.1 + Math.cos(ear - 1.4) * -s * 0.4, hy + Math.sin(ear - 1.4) * s * 0.4, s * 0.4, s * 0.1, ear - 1.4 + 3.1416);
  ctx.fill();
  ctx.fillStyle = "#eef0ff"; ctx.beginPath(); rootsCirc(-s * 0.45, -s * 0.3, s * 0.13); ctx.fill();
  ctx.fillStyle = "#1a1830"; ctx.beginPath(); rootsCirc(hx + s * 0.12, hy - s * 0.04, s * 0.05); ctx.fill();
  ctx.fillStyle = "#e8a7bd"; ctx.beginPath(); rootsCirc(hx + s * 0.29, hy + s * 0.06 + Math.sin(time * 7) * s * 0.01 * up, s * 0.035); ctx.fill();
  ctx.restore();
}

function rootsThorn(x, y, r, a, time, hit) {  // a soft-looking thorn cluster; reads as "go around", not as danger
  ctx.globalCompositeOperation = "lighter";
  rootsGlow("#ff8fb8", x, y, r * 1.9, 0.2 * a * (0.8 + 0.2 * Math.sin(time * 3 + x * 0.01)));
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = a;
  ctx.fillStyle = hit ? "#5a3a48" : "#3a2036";
  ctx.beginPath();
  for (const [ox, oy, s] of ROOTS_THORN_BALLS) {
    const cx = x + ox * r, cy = y + oy * r, rr = s * r;
    for (let j = 0; j < 14; j++) {
      const ang = j * 0.4488 + s * 3, rad = j % 2 ? rr * 0.55 : rr;
      j ? ctx.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad) : ctx.moveTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.strokeStyle = "rgba(255,170,210,0.55)"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.globalAlpha = 1;
}

// ---- Roots: the seed runs along the vine by itself; the player steers it up and down

// While the helping hand is on the run is far easier, so points are worth less: help never pays more.
function rootsHelpPay() { return 1 - 0.45 * assist.level; }

const Roots = {
  allowComfort: false, act: "roots",
  assistLine: "Your lantern is helping: the vine grows wider and it guards your leaves.",
  enter(meta) {
    this.meta = meta;
    this.diff = save.effects.roots.slice(-2).reduce((a, b) => a + b, 0) / 2 < -4 ? 0.8 : 1;  // ramp hurt? slow it
    this.step = 0.02;                 // path resolution (screen heights)
    // D: distance run (screen heights). R: "wildness" distance; it grows slower while stress is high.
    this.D = 0; this.R = 0; this.seedY = 0.5; this.speed = 0;
    this.score = 0; this.dew = 0; this.combo = 1; this.comboProg = 0; this.bestCombo = 1; this.wilts = 0; this.saved = 0;
    this.inv = 0; this.offT = 0; this.slow = 1; this.resumeK = 1; this.runT = 0; this.centred = false; this.lightOn = false;
    this.knots = [{ x: -8, y: 0.5 }, { x: -4, y: 0.5 }, { x: 0, y: 0.5 }, { x: 1.6, y: 0.5 }];
    this.kc = 0; this.pts = []; this.q = { y: 0.5, iy: 0.5, hw: 0.2, gap: false }; this.breather = 0;
    this.gi = -Math.ceil((W / H + 0.6) / this.step);
    this.thorns = []; this.forks = []; this.gaps = []; this.drops = []; this.nextDew = 2.4;
    this.flowers = []; this.flowerAcc = 0; this.notes = 0; this.lastNote = -1e9;
    this.critters = []; this.critN = 0; this.biomeSeen = 0; this.pruneT = 0; this.pillT = 1; this.shown = {};
    this.best0 = (save.best && save.best.roots) || 0; this.beatBest = false;
    this.ended = null; this.started = false; this.paused = false; this.sleeveRun = false;
    this.flies = Array.from({ length: 30 }, () => ({ x: W * 0.3 + rand(-0.3, 0.3) * H, y: H * rand(0.25, 0.75), vx: 0, vy: 0,
      ph: rand(0, 6.28), hx: rand(-0.65, 0.12), hy: rand(-0.3, 0.3), a: 0 }));
    this.trail = []; this.guideT = 0; this.lastCam = null;
    this.lastSay = -1e9; this.pendingLine = null; this.wasAssist = false;
    this.shoot = null; this.nextShoot = clock() + 6; this.palKey = ""; this.pal = null; this.waterGrad = null; this.waterH = 0;
    this.ensure();
    const best = this.best0;
    setUI(`${topBar(`<span class="pill" id="rleaf" title="Leaves">🌿🌿🌿</span><span class="pill" id="rsc" title="Score">✦ <b>0</b></span><span class="pill" id="rcb" title="Combo">combo <b>×1</b></span>${best ? `<span class="pill" id="rbest" title="Your best">best <b>${best}</b></span>` : ""}<button class="btn" id="finish" style="min-height:44px;padding:0 18px">Finish</button>`)}<div class="spacer"></div>
      <div class="prompt fade-in" id="rp"><h2>${input.usingSleeve() ? "Point at the seed" : "Touch the seed to begin"}</h2>
      <p>It runs along the vine by itself. Steer it up and down to keep it on the glow.</p>
      ${input.usingSleeve() ? `<div class="row" style="margin-top:14px;pointer-events:auto"><button class="btn primary" id="rstart">Start</button></div>` : ""}</div>
      <div class="spacer" style="flex:3"></div>`);
    const rs = $("#rstart"); if (rs) rs.onclick = () => { this.wantStart = true; };
    wireGear(); wireFinish(this);
    this.stillFor = 0;
  },

  // ---- the course
  sx() { return W * (W >= H ? 0.28 : 0.2); },   // the seed's screen x: most of the screen shows the way ahead
  cam() { return this.D - this.sx() / H; },
  dOf(R) { return Math.pow(clamp((R - 5) / 90, 0, 1), 0.8); },          // 0 for the first ~20 s, 1 after ~4-5 min
  vOf(R) { return Math.min(1.02, 0.26 + 0.0046 * R); },                 // forward speed, screen heights per second
  grace() { return this.R < 6 ? 1.2 : lerp(0.45, 0.22, this.dOf(this.R)); },  // seconds off the vine before a wilt
  comboNeed() { return 3 + 1.1 * this.combo; },                       // centred distance per combo step
  hwMul() { return (input.source === "sleeve" ? 1.15 : 1) * (1 + 0.5 * assist.level); },
  planKnot() {
    const k = this.knots, a = k[k.length - 1];
    const R = this.R + Math.max(0, a.x - this.D), d = this.dOf(R), lv = assist.level, calm = R < 6;
    let L = (calm ? 1.6 : lerp(1.0, 0.42, d)) * (1 + 0.5 * lv) * rand(0.85, 1.15);
    const amp = (calm ? 0.05 : lerp(0.14, 0.48, d)) * (1 - 0.55 * lv);  // the helping hand smooths the curves ahead
    let type = "plain", y;
    if (this.breather > 0) this.breather--;
    else if (!calm && lv < 0.3) {
      const r = Math.random(), pF = R > 20 ? lerp(0.1, 0.18, d) : 0, pG = R > 30 ? lerp(0.1, 0.18, d) : 0, pT = R > 9 ? lerp(0.28, 0.4, d) : 0;
      type = r < pF ? "fork" : r < pF + pG ? "gap" : r < pF + pG + pT ? "thorn" : "plain";
    }
    if (type === "fork") {  // two branches; only the glowing one holds
      L = Math.max(L, 1.1);
      let lo = a.y - rand(0.13, 0.22), hi = a.y + rand(0.13, 0.22);
      if (lo < 0.13) { hi += 0.13 - lo; lo = 0.13; }
      if (hi > 0.87) { lo -= hi - 0.87; hi = 0.87; }
      const upTrue = Math.random() < 0.5; y = upTrue ? lo : hi;
      this.forks.push({ x0: a.x, x1: a.x + L, tip: a.x + L + 0.35, off: (upTrue ? hi : lo) - y });
      this.breather = 1;
    } else if (type === "gap") {  // the vine dips out of sight; be at the right height where it comes back
      L = Math.max(L, 0.75);
      y = this.wander(a.y, rand(0.16, 0.3));
      this.gaps.push({ x0: a.x + 0.2 * L, x1: a.x + 0.85 * L, ly: null, done: false });
      this.breather = 1;
    } else if (type === "thorn") {  // 1-3 clusters, alternating sides: slip past on the free half
      const n = d < 0.35 ? 1 : d < 0.7 ? 2 : 3;
      L = Math.max(L, 0.45 * n + 0.35);
      y = this.wander(a.y, amp * 0.4 * rand(0.5, 1));
      let side = Math.random() < 0.5 ? -1 : 1;
      for (let j = 0; j < n; j++, side = -side) {
        this.thorns.push({ x: a.x + L * (j + 1) / (n + 1), side, y: null, r: 0, hit: false, touched: false, passed: false, fade: 1, dissolve: false });
      }
      this.breather = d < 0.5 ? 1 : 0;
    } else y = this.wander(a.y, amp * rand(0.45, 1));
    k.push({ x: a.x + L, y });
  },
  wander(y0, dy) {
    const s = Math.random() < 0.5 ? -1 : 1;
    let y = y0 + s * dy;
    if (y < 0.14 || y > 0.86) y = y0 - s * dy;
    return clamp(y, 0.14, 0.86);
  },
  sample(x) {  // one path point: smooth monotone spline through the knots, plus whatever sits on it here
    const k = this.knots;
    for (;;) {
      while (k.length < this.kc + 4) this.planKnot();
      if (k[this.kc + 1].x <= x) this.kc++; else break;
    }
    const i = this.kc, a = k[i], b = k[i + 1], p = i > 0 ? k[i - 1] : a, n = k[i + 2], h = b.x - a.x;
    const tg = (p, a, b) => ((a.y - p.y) * (b.y - a.y) <= 0 || b.x === p.x ? 0 : (b.y - p.y) / (b.x - p.x));
    const t = clamp((x - a.x) / h, 0, 1), t2 = t * t, t3 = t2 * t;
    let y = (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * tg(p, a, b) * h + (3 * t2 - 2 * t3) * b.y + (t3 - t2) * tg(a, b, n) * h;
    y = clamp(y, 0.07, 0.93);
    const R = this.R + Math.max(0, x - this.D), hw0 = Math.max(0.055, lerp(0.19, 0.06, this.dOf(R)));
    let hw = hw0, iy = y, near = 0;
    for (const th of this.thorns) {  // the vine swells around thorns so the free half stays followable
      const u = Math.abs(x - th.x);
      if (u >= 0.3) continue;
      const bump = Math.pow(Math.cos(u / 0.3 * 1.5708), 2), hwT = lerp(hw0, Math.max(hw0 * 1.35, 0.11), bump);
      hw = Math.max(hw, hwT); near = Math.max(near, bump);
      iy -= th.side * 0.5 * hwT * bump;
      if (th.y == null && x >= th.x) { th.y = y + th.side * 0.3 * hwT; th.r = 0.5 * hwT; }
    }
    let gap = false, dy = null, fork = false;
    for (const g of this.gaps) {
      if (x > g.x0 && x < g.x1) gap = true;
      if (g.ly == null && x >= g.x1) g.ly = y;
    }
    for (const f of this.forks) {
      if (x < f.x0 || x > f.tip) continue;
      fork = true; dy = y + f.off * rootsSmooth((x - f.x0) / (f.x1 - f.x0));
    }
    if (x >= this.nextDew) {
      if (gap || fork || near > 0.02) this.nextDew += 0.1;
      else {
        const bl = this.biomeAt(x);
        this.drops.push({ x, y: clamp(y + (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.75) * hw0, 0.06, 0.94),
          col: ROOTS_BIOMES[bl.k > 0.5 ? bl.j : bl.i].drop, ph: rand(0, 6.28), got: false, missed: false, t: 0 });
        this.nextDew = x + rand(1.1, 2.2);
      }
    }
    return { x, y, iy: clamp(iy, 0.05, 0.95), hw, gap, dy, fork };
  },
  ensure() {  // keep the path generated a little past the right edge, and forget what's far behind
    const need = this.D + W / H + 0.6;
    while (this.gi * this.step < need) { this.pts.push(this.sample(this.gi * this.step)); this.gi++; }
    const keep = this.cam() - 0.4, P = this.pts;
    let n = 0; while (n < P.length - 2 && P[n].x < keep) n++;
    if (n > 40) P.splice(0, n);
    if (this.kc > 6) { this.knots.splice(0, this.kc - 3); this.kc = 3; }
  },
  at(x) {  // the path at world x (interpolated; reuses one object)
    const P = this.pts, g = (x - P[0].x) / this.step, i = clamp(Math.floor(g), 0, P.length - 2), f = clamp(g - i, 0, 1);
    const a = P[i], b = P[i + 1], q = this.q;
    q.y = lerp(a.y, b.y, f); q.iy = lerp(a.iy, b.iy, f); q.hw = lerp(a.hw, b.hw, f); q.gap = f < 0.5 ? a.gap : b.gap;
    return q;
  },
  biomeAt(x) {  // { i, j, k }: biome i crossfading into j by k; the four places loop
    const u = Math.max(0, x) / ROOTS_SPAN, n = Math.floor(u), fr = u - n, z = 0.12, i = n % 4;
    if (fr > 1 - z) return { i, j: (n + 1) % 4, k: rootsSmooth((fr - (1 - z)) / (2 * z)) };
    if (fr < z && n > 0) return { i: (n + 3) % 4, j: i, k: rootsSmooth(0.5 + fr / (2 * z)) };
    return { i, j: i, k: 0 };
  },
  palette(bl) {
    const q = Math.round(bl.k * 48), key = `${bl.i}|${bl.j}|${q}|${H}`;
    if (key === this.palKey) return this.pal;
    const a = ROOTS_BIOMES[bl.i], b = ROOTS_BIOMES[bl.j], k = q / 48, m = (f) => mix(a[f], b[f], k);
    const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, m("skyT")); sky.addColorStop(1, m("skyB"));
    this.pal = { sky, far: m("far"), mid: m("mid"), ground: m("ground"), grass: m("grass"), star: lerp(a.star, b.star, k), fly: k < 0.5 ? a.fly : b.fly };
    this.palKey = key;
    return this.pal;
  },
  // voice: event lines wait 5 s after the last line; encouragement waits 20 s
  say(text, event) {
    const now = clock();
    if (event) { if (now - this.lastSay < 5) { this.pendingLine = text; return; } }
    else if (now - this.lastSay < 20) return;
    voice.say(text, 4); this.lastSay = now;
  },
  prompt(kind) {
    const rp = $("#rp");
    if (!rp) return;
    if (!kind) { rp.style.visibility = "hidden"; return; }
    rp.innerHTML = `<h2>Paused</h2><p>${this.sleeveRun ? "Point back at the screen" : "Touch the screen"} whenever you're ready.</p>`;
    rp.style.visibility = "visible";
  },

  // ---- the run
  update(dt) {
    if (this.ended) return;
    if (!this.started) {
      const sx = this.sx(), sy = this.seedY * H;
      const begin = () => {
        if (this.started || this.ended) return;
        this.started = true; this.sleeveRun = input.usingSleeve(); this.prompt(null);
        this.resumeK = 0.3; this.say(ROOTS_BIOMES[0].line, true);
      };
      if (input.usingSleeve()) {
        // Sleeve: wherever the finger rests now becomes "on the seed", which also clears slow drift.
        this.stillFor = handSteady() ? this.stillFor + dt : 0;
        if ((this.stillFor > 1.0 || this.wantStart) && !this.recentering) {
          this.recentering = true;
          waitAck("imu_recenter", (ack) => {
            this.recentering = false;
            if (!ack.ok) { this.stillFor = 0; this.wantStart = false; toast("Point a little more toward the screen.", 2.5); return; }
            input.sleeve.x = sx; input.sleeve.y = sy;
            begin();
          });
          link.send({ cmd: "imu_recenter" });
        }
      } else if (input.has && Math.hypot(input.x - sx, input.y - sy) < 0.15 * H) begin();
      return;
    }
    const now = clock();
    if (this.pendingLine && now - this.lastSay >= 5) { const t = this.pendingLine; this.pendingLine = null; this.say(t, true); }
    if (!input.has) {  // hand lifted, sleeve not aimed, nurse visit: just pause, never penalise
      this.lightOn = false;
      if (!this.paused) { this.paused = true; this.prompt("pause"); }
      return;
    }
    if (this.paused) { this.paused = false; this.prompt(null); this.resumeK = 0; this.inv = Math.max(this.inv, 1); this.offT = 0; }
    if (assist.on !== this.wasAssist) {
      this.wasAssist = assist.on;
      if (assist.on) {
        this.lastSay = now;  // the core just spoke the assist line
        if (this.wilts > 0) { this.wilts--; fx.burst(this.sx(), this.seedY * H, { color: "#9dffb8", n: 18, speed: 60, life: 1.3 }); }
        for (const t of this.thorns) if (t.x > this.D + 0.6 && !t.dissolve) { t.dissolve = true; }
        this.shown.leaf = null;
      }
    }
    this.runT += dt;
    this.slow = Math.min(1, this.slow + dt / 2.5); this.resumeK = Math.min(1, this.resumeK + dt);
    this.inv = Math.max(0, this.inv - dt);
    const view = clamp((W - this.sx()) / H / 0.85, 0.7, 1);  // a narrow (portrait) screen shows less ahead: run a bit slower
    const cf = challengeFactor(), v = this.vOf(this.R) * cf * timeScale() * this.slow * (0.25 + 0.75 * this.resumeK) * view;
    this.speed = v;
    const ty = clamp(input.y / H, 0.03, 0.97), dist = v * dt, n = Math.max(1, Math.ceil(dist / 0.012)), h = dt / n, ds = dist / n;
    const kS = 1 - Math.exp(-h / 0.06);
    for (let s = 0; s < n && !this.ended; s++) {
      this.seedY += (ty - this.seedY) * kS;
      this.D += ds; this.R += ds * cf * this.diff;
      this.score += 0.5 * ds * this.combo * rootsHelpPay();  // half a point per screen-height run, times the combo
      this.check(h, ds);
    }
    if (this.ended) return;
    this.ensure();
    this.life(dt);
  },
  check(h, ds) {  // one sub-step: stay on the vine, slip past thorns, land after gaps, gather dew
    const D = this.D, y = this.seedY, q = this.at(D), hwE = q.hw * this.hwMul();
    for (const g of this.gaps) {
      if (g.done || D < g.x1) continue;
      g.done = true;
      const ly = g.ly == null ? q.y : g.ly;
      if (Math.abs(y - ly) <= hwE * 1.1 + 0.01) {
        this.score += 2 * this.combo * rootsHelpPay(); sfx.chime(7, 0.07);
        fx.burst(this.sx(), ly * H, { color: "#fff1b8", n: 12, speed: 70, life: 1, size: 2 });
      } else if (this.inv <= 0) this.wilt();
    }
    if (this.ended) return;
    if (q.gap) { this.lightOn = true; this.centred = false; }
    else {
      const on = Math.abs(y - q.y) <= hwE + 0.01;
      this.lightOn = on;
      if (on) this.offT = Math.max(0, this.offT - h * 2);
      else if (this.inv <= 0) { this.offT += h; if (this.offT > this.grace()) { this.wilt(); if (this.ended) return; } }
      this.centred = on && Math.abs(y - q.iy) < Math.max(0.03, 0.45 * hwE);
      if (this.centred) {
        this.comboProg += ds;
        const need = this.comboNeed();
        if (this.comboProg >= need) {
          if (this.combo < ROOTS_COMBO_MAX) { this.comboProg -= need; this.combo++; this.comboUp(); }
          else this.comboProg = need;
        }
      } else if (on) this.comboProg = Math.max(0, this.comboProg - ds * 0.5);
      else this.comboProg = 0;
    }
    for (const t of this.thorns) {
      if (t.y == null || t.passed) continue;
      const ex = Math.min(0.045, t.r * 0.8);
      if (D > t.x + ex) { t.passed = true; if (!t.touched && t.fade > 0.5) this.score += 0.5 * this.combo * rootsHelpPay(); continue; }
      if (t.fade < 0.5 || D < t.x - ex || Math.abs(y - t.y) >= t.r * 0.75) continue;
      t.touched = true;
      if (!t.hit && this.inv <= 0) { t.hit = true; this.wilt(); if (this.ended) return; }
    }
    for (const d of this.drops) {
      if (d.got || d.missed) continue;
      if (Math.abs(d.x - D) < 0.03 && Math.abs(d.y - y) < 0.045) {
        d.got = true; this.dew++; this.score += this.combo * rootsHelpPay();
        fx.burst(this.sx(), d.y * H, { color: d.col, n: 14, speed: 70, life: 1.2, size: 2.2, up: 20 });
        sfx.chime(5 + (this.dew % 5), 0.06);
      } else if (d.x < D - 0.03) d.missed = true;
    }
  },
  wilt() {
    this.offT = 0;
    const sx = this.sx(), sy = this.seedY * H;
    if (assist.on) {  // the helping hand catches it: no leaf lost, the combo stays
      this.inv = 1.5; this.slow = Math.min(this.slow, 0.75); this.saved++;
      fx.burst(sx, sy, { color: "#ffd27a", n: 14, speed: 70, life: 1.1, size: 2 }); sfx.chime(4, 0.05);
      return;
    }
    this.wilts++; this.combo = 1; this.comboProg = 0; this.inv = 2; this.slow = 0.55;
    fx.burst(sx, sy, { color: "#c9a46a", n: 16, speed: 80, life: 1.4, size: 2.4 }); sfx.soft();
    this.shown.leaf = null; this.pills(true);
    if (this.wilts >= 3) { this.finish("The vine rests here."); return; }
    this.say(ROOTS_WILT[(this.wilts - 1) % ROOTS_WILT.length], true);
  },
  comboUp() {
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    sfx.chime(2 + this.combo, 0.07);
    fx.burst(this.sx(), this.seedY * H, { color: "#ffd27a", n: 8 + this.combo * 2, speed: 60, life: 1, size: 2 });
    if (this.combo >= 3) this.say(ROOTS_CHEER[Math.floor(Math.random() * ROOTS_CHEER.length)], false);
  },
  life(dt) {  // flowers, places, creatures, milestones, the top bar
    const D = this.D, now = clock();
    if (this.centred) {  // flowers bloom behind the seed while it runs true, each one the next note of a phrase
      this.flowerAcc += this.speed * dt;
      if (this.flowerAcc > 0.32) {
        this.flowerAcc = 0;
        const q = this.at(D), bl = this.biomeAt(D), kind = Math.random() < bl.k ? bl.j : bl.i, hues = ROOTS_BIOMES[kind].hues;
        const fl = { x: D, y: q.y, up: kind === 1 || Math.random() < 0.72, h: rand(0.035, 0.07), kind,
          hue: hues[Math.floor(Math.random() * hues.length)], born: now, sw: rand(0, 6.28) };
        this.flowers.push(fl);
        fx.sparkle(this.sx(), fl.y * H + (fl.up ? -1 : 1) * fl.h * H, fl.hue);
        if (now - this.lastNote > 0.3) {
          this.lastNote = now;
          sfx.chime(Math.min(9, ROOTS_PHRASE[this.notes % ROOTS_PHRASE.length] + Math.min(4, this.combo - 1)), 0.04 + 0.03 * world.calm);
          this.notes++;
        }
      }
    }
    for (const t of this.thorns) if (t.dissolve && t.fade > 0) {
      if (t.fade === 1 && t.y != null) fx.sparkle((t.x - this.cam()) * H, t.y * H, "#ffd27a");
      t.fade = Math.max(0, t.fade - dt * 1.5);
    }
    // a new place: the night grows wilder
    const b = Math.floor(D / ROOTS_SPAN);
    if (b > this.biomeSeen) {
      this.biomeSeen = b;
      const place = ROOTS_BIOMES[b % 4];
      this.say(`${b < 4 ? place.line : place.again} ${ROOTS_TIER[(b - 1) % ROOTS_TIER.length]}`, true);
      sfx.swell(0.9);
    }
    // one creature per place
    while (this.critN < 1e4 && this.critN * ROOTS_SPAN + ROOTS_SPAN * 0.55 < D + W / H + 1) {
      const n = this.critN++, c = ROOTS_CRITTER[n % 4];
      this.critters.push({ kind: c.kind, line: c.line, x: n * ROOTS_SPAN + ROOTS_SPAN * 0.55,
        k: c.kind === "frog" ? 1 : c.kind === "rabbit" ? 0.25 : 0, met: false, hop: 0, hopping: false, croak: 0 });
    }
    for (const c of this.critters) {
      if (c.met || D < c.x - 0.45) continue;
      c.met = true; this.say(c.line, true);
      if (c.kind === "fox") { sfx.tone(sfx.PENTA[7], { vol: 0.05, dur: 0.7 }); sfx.tone(sfx.PENTA[9], { vol: 0.04, dur: 0.9, delay: 0.18 }); }
      else if (c.kind === "owl") { sfx.tone(392, { vol: 0.05, dur: 0.6, type: "triangle" }); sfx.tone(330, { vol: 0.05, dur: 0.9, type: "triangle", delay: 0.45 }); }
      else if (c.kind === "frog") { c.hopping = true; c.hop = 0; c.croak = 1.4; sfx.tone(175, { vol: 0.06, dur: 0.25, type: "triangle" }); sfx.tone(196, { vol: 0.05, dur: 0.3, type: "triangle", delay: 0.32 }); }
      else sfx.sparkle();
    }
    if (this.best0 > 0 && !this.beatBest && this.score > this.best0) {
      this.beatBest = true; this.lastSay = -1e9; this.say("New best!", true);
      sfx.sparkle(); fx.burst(W / 2, H * 0.2, { color: "#ffd27a", n: 30, speed: 130 });
    }
    if ((this.pruneT += dt) > 1) {
      this.pruneT = 0;
      const old = this.cam() - 0.6, keep = (a, f) => a.filter((o) => f(o) > old);
      this.thorns = keep(this.thorns, (t) => t.x); this.gaps = keep(this.gaps, (g) => g.x1 + 0.2);
      this.forks = keep(this.forks, (f) => f.tip); this.drops = keep(this.drops, (d) => d.x + 0.3);
      this.flowers = keep(this.flowers, (f) => f.x + 0.2); this.critters = keep(this.critters, (c) => c.x + 0.8);
    }
    this.pills(false, dt);
  },
  pills(force, dt = 0) {
    if (!force && (this.pillT += dt) < 0.25) return;
    this.pillT = 0;
    const sh = this.shown, s = Math.floor(this.score), set = (id, k, v, html) => {
      if (sh[k] === v) return;
      sh[k] = v; const el = $(id); if (el) el.innerHTML = html;
    };
    set("#rsc", "s", s, `✦ <b>${s}</b>`);
    set("#rcb", "c", this.combo, `combo <b>×${this.combo}</b>`);
    set("#rleaf", "leaf", this.wilts, "🌿".repeat(Math.max(0, 3 - this.wilts)) + "🍂".repeat(Math.min(3, this.wilts)));
    if (this.best0) set("#rbest", "b", Math.max(this.best0, s), `${this.beatBest ? "new best" : "best"} <b>${Math.max(this.best0, s)}</b>`);
  },
  metres() { return Math.round(this.D * 3); },
  hasProgress() { return this.started && this.D > 0.5; },
  finishEarly() { this.finish("Nice running. Your garden grew."); },
  finish(msg) {
    if (this.ended) return;
    this.ended = msg;
    const score = Math.max(0, Math.round(this.score));
    fx.burst(this.sx(), this.seedY * H, { color: flameColor(), n: 30, speed: 90, life: 1.8, up: 30 });
    sfx.soft(); sfx.swell(1.2);
    endRound("roots", score, this.meta, msg,
      `${this.metres()} m · ${this.dew} dewdrop${this.dew === 1 ? "" : "s"} · best combo ×${this.bestCombo}`);
  },

  // ---- drawing
  draw(time, dt) {
    dt = dt || 0.016;
    const cam = this.cam(), bl = this.biomeAt(this.D), w = rootsWeights(bl), P = this.palette(bl);
    this.drawBackdrop(time, cam, w, P);
    this.drawMid(time, cam, w, P);
    this.drawNear(time, cam, w, P);
    this.drawVine(time, dt, cam);
    this.drawLife(time, dt, cam);
    this.drawFlies(time, dt, cam, P);
    this.drawSeed(time, cam);
    this.drawGrass(time, cam, w, P);
    this.drawLight();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    // progress to the next combo step: a thin line of light along the bottom
    const need = this.comboNeed(), k = this.combo >= ROOTS_COMBO_MAX ? 1 : clamp(this.comboProg / need, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(W * 0.2, H - 10, W * 0.6, 3);
    ctx.fillStyle = this.combo >= ROOTS_COMBO_MAX ? "#ffd27a" : "#8fe3b0"; ctx.fillRect(W * 0.2, H - 10, W * 0.6 * k, 3);
  },
  drawBackdrop(time, cam, w, P) {
    ctx.fillStyle = P.sky; ctx.fillRect(0, 0, W, H);
    // stars: the hilltop gets a second, mirrored field
    const sa = P.star * (0.6 + 0.6 * world.calm);
    ctx.fillStyle = "#fff";
    for (const s of STARS) {
      const a = (0.3 + 0.35 * Math.sin(time * s.sp + s.ph)) * sa;
      if (a > 0.02) { ctx.globalAlpha = Math.min(1, a); ctx.beginPath(); ctx.arc(s.x * W, s.y * H * 0.9, s.r, 0, 6.29); ctx.fill(); }
      if (w[3] > 0.02) {
        const b = (0.3 + 0.35 * Math.sin(time * s.sp * 0.8 + s.ph + 2)) * w[3] * (0.6 + 0.5 * world.calm);
        if (b > 0.02) { ctx.globalAlpha = Math.min(1, b); ctx.beginPath(); ctx.arc((1 - s.x) * W, (0.04 + s.y * 0.85) * H, s.r * 0.8, 0, 6.29); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1;
    // the moon sways very slowly as the journey goes on
    const mx = W * 0.8 - H * 0.08 * Math.sin(cam * 0.01), my = H * 0.16, mr = H * 0.045;
    ctx.globalCompositeOperation = "lighter";
    rootsGlow("#dfe6ff", mx, my, mr * 5, 0.22 + 0.15 * world.calm);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.fillStyle = "#f2efdc"; ctx.beginPath(); rootsCirc(mx, my, mr); ctx.fill();
    ctx.fillStyle = "rgba(180,180,170,0.25)"; ctx.beginPath(); rootsCirc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22); rootsCirc(mx + mr * 0.35, my + mr * 0.25, mr * 0.15); ctx.fill();
    // a slow, soft shooting star now and then on the hilltop
    const now = clock();
    if (w[3] > 0.5 && !this.shoot && now > this.nextShoot) { this.shoot = { t0: now, x: rand(0.15, 0.6) * W, y: rand(0.06, 0.28) * H }; this.nextShoot = now + rand(10, 18); }
    if (this.shoot) {
      const u = (now - this.shoot.t0) / 2.6;
      if (u >= 1) this.shoot = null;
      else {
        const hx = this.shoot.x + u * 0.25 * W, hy = this.shoot.y + u * 0.08 * H;
        ctx.strokeStyle = "#fff6cf"; ctx.lineWidth = 1.5; ctx.globalAlpha = Math.sin(Math.PI * u) * 0.55 * w[3];
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - 60, hy - 19); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    // far hills
    const lift = 0.06 * w[3], off = cam * 0.12;
    ctx.fillStyle = P.far; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 24; x += 24) ctx.lineTo(x, H * rootsFarY(off + x / H, lift));
    ctx.lineTo(W + 24, H); ctx.closePath(); ctx.fill();
    if (w[1] > 0.02) {  // distant glowing mushrooms dot the far hills of the grove
      ctx.globalCompositeOperation = "lighter";
      const k0 = Math.floor(off / 0.09), k1 = Math.ceil((off + W / H) / 0.09);
      for (let k = k0; k <= k1; k++) {
        if (rootsHash(k) < 0.45) continue;
        const u = k * 0.09 + rootsHash(k + 7) * 0.06;
        rootsGlow("#9ff7e8", (u - off) * H, H * (rootsFarY(u, lift) + 0.02 + rootsHash(k + 3) * 0.05), 6, w[1] * (0.35 + 0.25 * Math.sin(time * 0.5 + k)));
      }
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    }
  },
  drawMid(time, cam, w, P) {
    const f = 0.4, off = cam * f, A = W / H, sp = 0.24, lift = 0.05 * w[3], bright = 0.5 + 0.5 * world.calm;
    const k0 = Math.floor((off - 0.4) / sp), k1 = Math.ceil((off + A + 0.4) / sp);
    for (let k = k0; k <= k1; k++) {
      const u = k * sp + rootsHash(k * 3 + 1) * 0.14, xEq = (u - 0.5 * A) / f + 0.5 * A, b = this.biomeAt(xEq);
      const type = rootsHash(k * 3 + 2) < b.k ? b.j : b.i, s = (0.13 + rootsHash(k * 3 + 3) * 0.1) * H;
      const x = (u - off) * H, y = rootsMidY(u, lift) * H + 4;
      if (x < -s || x > W + s) continue;
      if (type === 0) rootsTree(x, y, s * 1.2, P.mid);
      else if (type === 1) rootsBigMushroom(x, y, s * 1.3, time, bright);
      else if (type === 2) { if (((k % 3) + 3) % 3 === 0) rootsWaterfall(x, y, s * 1.1, time); else rootsWillow(x, y, s * 1.2, time, P.mid); }
      else if (rootsHash(k * 3 + 5) < 0.4) rootsPine(x, y, s * 0.8, P.mid);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = P.mid; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 24; x += 24) ctx.lineTo(x, H * rootsMidY(off + x / H, lift));
    ctx.lineTo(W + 24, H); ctx.closePath(); ctx.fill();
  },
  drawNear(time, cam, w, P) {
    const A = W / H;
    ctx.fillStyle = P.ground; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W + 24; x += 24) ctx.lineTo(x, H * rootsNearY(cam + x / H));
    ctx.lineTo(W + 24, H); ctx.closePath(); ctx.fill();
    if (w[2] < 0.02) return;
    // the stream: water, moonlight shimmer and lily pads
    if (!this.waterGrad || this.waterH !== H) {
      this.waterH = H; this.waterGrad = ctx.createLinearGradient(0, H * 0.88, 0, H);
      this.waterGrad.addColorStop(0, "#1a5168"); this.waterGrad.addColorStop(1, "#0a2333");
    }
    ctx.globalAlpha = w[2]; ctx.fillStyle = this.waterGrad; ctx.fillRect(0, H * 0.885, W, H * 0.115);
    ctx.strokeStyle = "#cfefff"; ctx.lineWidth = 1.2;
    const k0 = Math.floor(cam / 0.12), k1 = Math.ceil((cam + A) / 0.12);
    for (let k = k0; k <= k1; k++) {
      const x = (k * 0.12 + rootsHash(k) * 0.1 - cam) * H, y = H * (0.9 + rootsHash(k + 11) * 0.09), l = 8 + rootsHash(k + 5) * 22;
      ctx.globalAlpha = w[2] * (0.12 + 0.12 * Math.sin(time * 0.8 + k * 1.7));
      ctx.beginPath(); ctx.moveTo(x - l / 2, y); ctx.lineTo(x + l / 2, y); ctx.stroke();
    }
    const frog = this.critters.find((c) => c.kind === "frog");
    const p0 = Math.floor(cam / 0.3), p1 = Math.ceil((cam + A) / 0.3);
    for (let k = p0; k <= p1; k++) {
      const px = k * 0.3 + rootsHash(k + 21) * 0.15, ws = rootsWeights(this.biomeAt(px))[2];
      if (ws < 0.02 || (frog && Math.abs(px - frog.x - 0.06) < 0.25)) continue;  // the frog brings its own pads
      const x = (px - cam) * H, y = H * (0.905 + rootsHash(k + 31) * 0.06), r = H * (0.028 + rootsHash(k + 41) * 0.015);
      ctx.globalAlpha = ws; ctx.fillStyle = "#2f7a5a";
      ctx.beginPath(); ctx.moveTo(x, y); ctx.ellipse(x, y, r, r * 0.32, 0, 0.35, 5.93); ctx.closePath(); ctx.fill();
      if (rootsHash(k + 51) < 0.35) {
        ctx.globalCompositeOperation = "lighter"; rootsGlow("#ffc2d9", x, y - r * 0.2, r * 1.3, ws * (0.25 + 0.3 * world.calm));
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = ws; ctx.fillStyle = "#ffd6e6";
        ctx.beginPath(); rootsEll(x - r * 0.18, y - r * 0.22, r * 0.2, r * 0.1, -0.6); rootsEll(x + r * 0.18, y - r * 0.22, r * 0.2, r * 0.1, 0.6); rootsEll(x, y - r * 0.3, r * 0.1, r * 0.22, 0); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },
  bandPath(a, b, cam, hm) {  // the safe band between two point indices, as one closed subpath
    const P = this.pts;
    for (let i = a; i <= b; i++) { const p = P[i], x = (p.x - cam) * H, y = (p.y - p.hw * hm) * H; i === a ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    for (let i = b; i >= a; i--) { const p = P[i]; ctx.lineTo((p.x - cam) * H, (p.y + p.hw * hm) * H); }
    ctx.closePath();
  },
  drawVine(time, dt, cam) {
    const P = this.pts, A = W / H, X = (x) => (x - cam) * H;
    if (P.length < 2) return;
    const base = P[0].x, idx = (x) => clamp(Math.round((x - base) / this.step), 0, P.length - 1);
    const i0 = idx(cam - 0.1), i1 = idx(cam + A + 0.1), si = idx(this.D), lv = assist.level, hm = this.hwMul();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // 1. the safe band ahead, drawn exactly as wide as it counts; the helping hand widens it and turns it gold
    ctx.beginPath();
    let run = -1;
    for (let i = Math.max(i0, si - 12); i <= i1 + 1; i++) {
      const ok = i <= i1 && !P[i].gap;
      if (ok && run < 0) run = i;
      else if (!ok && run >= 0) { if (i - 1 > run) this.bandPath(run, i - 1, cam, hm); run = -1; }
    }
    const bandCol = lv > 0.01 ? mix("#8fe3b0", "#ffd27a", lv) : "#8fe3b0";
    ctx.fillStyle = bandCol; ctx.globalAlpha = 0.09 + 0.14 * lv; ctx.fill();
    ctx.strokeStyle = bandCol; ctx.lineWidth = 1.2 + lv; ctx.globalAlpha = 0.22 + 0.3 * lv; ctx.stroke();
    // 2. decoy branches: dull, unlit, ending in a withered tip
    for (const f of this.forks) {
      if (f.tip < cam - 0.1 || f.x0 > cam + A + 0.1) continue;
      const ia = idx(f.x0), ib = idx(f.tip);
      ctx.beginPath();
      let pen = false;
      for (let i = ia; i <= ib; i++) { const p = P[i]; if (p.dy == null) continue; pen ? ctx.lineTo(X(p.x), p.dy * H) : ctx.moveTo(X(p.x), p.dy * H); pen = true; }
      ctx.globalAlpha = 0.9; ctx.strokeStyle = "#1d3a2d"; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = "#3f5f4c"; ctx.lineWidth = 2.5; ctx.stroke();
      const tp = P[ib];
      if (tp && tp.dy != null) rootsThorn(X(tp.x), tp.dy * H, 0.022 * H, 0.8, time, true);
      // the true branch shimmers through the fork
      const ja = Math.max(ia, si), jb = Math.min(i1, idx(f.x1 + 0.2));
      if (jb > ja) {
        ctx.beginPath();
        for (let i = ja; i <= jb; i++) { const p = P[i]; i === ja ? ctx.moveTo(X(p.x), p.y * H) : ctx.lineTo(X(p.x), p.y * H); }
        ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "#fff1b8"; ctx.lineWidth = 7;
        ctx.globalAlpha = 0.18 + 0.12 * Math.sin(time * 4); ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.globalAlpha = 1;
    // 3. the vine ahead: a bright core with drifting light
    ctx.beginPath();
    let pen = false;
    for (let i = si; i <= i1; i++) { const p = P[i]; if (p.gap) { pen = false; continue; } pen ? ctx.lineTo(X(p.x), p.y * H) : ctx.moveTo(X(p.x), p.y * H); pen = true; }
    ctx.strokeStyle = "#245c43"; ctx.globalAlpha = 0.9; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = "#7fe0a6"; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = "#e8fff0"; ctx.globalAlpha = 0.6; ctx.lineWidth = 2; ctx.setLineDash([2, 12]);
    ctx.lineDashOffset = (P[si].x * H) % 14; ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
    // 4. gaps: a glowing bud marks where the vine comes back, with a ring as wide as the landing
    for (const g of this.gaps) {
      if (g.ly == null || g.done) continue;
      const x = X(g.x1); if (x < -40 || x > W + 40) continue;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3), r = this.at(g.x1).hw * hm * 1.1 * H;
      ctx.globalCompositeOperation = "lighter"; rootsGlow("#fff1b8", x, g.ly * H, 0.05 * H, 0.45 + 0.3 * pulse);
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#fff1b8"; ctx.lineWidth = 2; ctx.globalAlpha = 0.35 + 0.25 * pulse;
      ctx.beginPath(); ctx.moveTo(x, g.ly * H - r); ctx.lineTo(x, g.ly * H + r); ctx.stroke(); ctx.globalAlpha = 1;
      if (lv > 0.02) {  // the helping hand traces the hidden vine
        const ia = idx(g.x0), ib = idx(g.x1);
        ctx.beginPath(); for (let i = ia; i <= ib; i++) { const p = P[i]; i === ia ? ctx.moveTo(X(p.x), p.y * H) : ctx.lineTo(X(p.x), p.y * H); }
        ctx.strokeStyle = "#ffd27a"; ctx.globalAlpha = 0.4 * lv; ctx.setLineDash([3, 9]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    // 5. the grown vine behind the seed, leafy
    if (si > i0) {
      ctx.beginPath();
      pen = false;
      for (let i = i0; i <= si; i++) { const p = P[i]; if (p.gap) { pen = false; continue; } pen ? ctx.lineTo(X(p.x), p.y * H) : ctx.moveTo(X(p.x), p.y * H); pen = true; }
      ctx.strokeStyle = "#245c43"; ctx.lineWidth = 9; ctx.stroke();
      ctx.strokeStyle = "#5fbf86"; ctx.lineWidth = 5.5; ctx.stroke();
      ctx.strokeStyle = "rgba(190,255,215,0.45)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath();  // leaves, smallest (youngest) near the seed
      for (let i = i0; i < si; i++) {
        const p = P[i], q = P[i + 1], gid = Math.round(p.x / this.step);
        if (p.gap || ((gid % 3) + 3) % 3) continue;
        const ang = Math.atan2((q.y - p.y) * H, this.step * H), side = gid % 2 ? 1 : -1;
        const L = 0.02 * H * (0.7 + 0.5 * rootsHash(gid)) * clamp((si - i) / 12, 0.15, 1);
        rootsEll(X(p.x) - Math.sin(ang) * side * L * 0.9, p.y * H + Math.cos(ang) * side * L * 0.9, L, L * 0.42, ang + side * 0.8 + Math.sin(time * 0.8 + gid) * 0.08);
      }
      ctx.fillStyle = "#6fd39a"; ctx.fill();
    }
    // 6. thorn clusters
    for (const t of this.thorns) {
      if (t.y == null || t.fade <= 0.01) continue;
      const x = X(t.x); if (x < -60 || x > W + 60) continue;
      rootsThorn(x, t.y * H, t.r * H, t.fade, time, t.hit);
    }
    // 7. with the helping hand, golden motes drift along the best line ahead
    if (lv > 0.02 && !this.ended) {
      ctx.globalCompositeOperation = "lighter";
      for (let m = 0; m < 6; m++) {
        const u = (time * 0.22 + m / 6) % 1, fi = si + 3 + u * 50, i = Math.floor(fi);
        if (i + 1 > i1 || P[i].gap) continue;
        const y = lerp(P[i].iy, P[i + 1].iy, fi - i) * H, x = X(lerp(P[i].x, P[i + 1].x, fi - i));
        rootsGlow("#ffd27a", x, y, 16 + 10 * lv, lv * Math.sin(Math.PI * u) * 0.9);
      }
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      this.guideT += dt * 6 * lv;
      while (this.guideT > 1) {
        this.guideT -= 1;
        const i = Math.min(i1, si + Math.floor(rand(6, 45)));
        fx.sparkle(X(P[i].x) + rand(-8, 8), P[i].y * H + rand(-8, 8), "#ffd27a");
      }
    }
    // 8. off the vine: a soft pulse on the vine shows the way back
    if (this.started && !this.lightOn && !this.paused && !this.ended) {
      const q = this.at(this.D), u = (time * 1.6) % 1;
      ctx.strokeStyle = "#fff1b8"; ctx.lineWidth = 2; ctx.globalAlpha = 0.6 * (1 - u);
      ctx.beginPath(); ctx.arc(this.sx(), q.y * H, 0.02 * H + u * 0.04 * H, 0, 6.29); ctx.stroke(); ctx.globalAlpha = 1;
    }
  },
  drawLife(time, dt, cam) {
    const X = (x) => (x - cam) * H, now = clock(), bright = 0.4 + 0.6 * world.calm, D = this.D;
    for (const fl of this.flowers) {
      const x = X(fl.x); if (x < -60 || x > W + 60) continue;
      rootsFlower(x, fl.y * H, fl, rootsPop((now - fl.born) / 1.1), time, bright);
    }
    ctx.globalAlpha = 1;
    // dewdrops
    for (const d of this.drops) {
      if (d.got) continue;
      const x = X(d.x); if (x < -30 || x > W + 30) continue;
      if (d.missed) d.t += dt;
      const fade = d.missed ? 1 - d.t / 1.5 : 1;
      if (fade <= 0) continue;
      const r = 0.011 * H, y = d.y * H + Math.sin(time * 1.5 + d.ph) * 3 - (d.missed ? d.t * 20 : 0);
      ctx.globalCompositeOperation = "lighter"; rootsGlow(d.col, x, y, r * 4, fade * (0.45 + 0.25 * Math.sin(time * 1.2 + d.ph)));
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = fade * 0.9; ctx.fillStyle = d.col;
      ctx.beginPath(); ctx.moveTo(x, y - r * 1.7);
      ctx.bezierCurveTo(x + r * 1.2, y - r * 0.4, x + r, y + r, x, y + r); ctx.bezierCurveTo(x - r, y + r, x - r * 1.2, y - r * 0.4, x, y - r * 1.7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); rootsCirc(x - r * 0.3, y - r * 0.1, r * 0.22); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // creatures
    for (const c of this.critters) {
      const near = D > c.x - 0.6 && D < c.x + 0.7;
      const target = c.kind === "frog" ? 1 : c.kind === "rabbit" ? (near ? 1 : 0.25) : near ? 1 : 0;
      c.k += (target - c.k) * Math.min(1, dt * 2.2);
      if (c.hopping) { c.hop += dt; if (c.hop >= 1) { c.hop = 1; c.hopping = false; } }
      if (c.croak > 0) c.croak = Math.max(0, c.croak - dt);
      const x = X(c.x), look = Math.sign(this.sx() - x) || 1;
      if (x < -0.3 * H || x > W + 0.3 * H) continue;
      if (c.kind === "fox") rootsFox(x, H * 0.985, 0.075 * H, c.k, time);
      else if (c.kind === "owl") rootsOwl(x, H * 0.13, 0.065 * H, c.k, time, look);
      else if (c.kind === "frog") rootsFrog(x, H * 0.93, 0.05 * H, c.hop, c.croak, time, x + 0.12 * H);
      else rootsRabbit(x, H * 0.95, 0.06 * H, c.k, time);
    }
    ctx.globalAlpha = 1;
  },
  drawFlies(time, dt, cam, P) {
    // fireflies trail behind the seed, swirl around it and scatter from the light; calm brings more of them
    const dc = this.lastCam == null ? 0 : (cam - this.lastCam) * H; this.lastCam = cam;
    const sx = this.sx(), sy = this.seedY * H, n = Math.round(10 + 20 * world.calm);
    const lx = input.has ? this.lightX() : -1e5, ly = input.has ? input.y : -1e5;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i];
      f.x -= dc;
      const tx = sx + f.hx * H + Math.cos(time * 0.5 + f.ph) * 40, ty = sy + f.hy * H + Math.sin(time * 0.63 + f.ph * 1.3) * 30;
      let ax = (tx - f.x) * 0.9, ay = (ty - f.y) * 0.9;
      const dx = f.x - sx, dy = f.y - sy, d = Math.hypot(dx, dy) + 1, sw = 120 * Math.exp(-d / 160);
      ax += -dy / d * sw; ay += dx / d * sw;
      for (let j = 0; j < 2; j++) {
        const px = j ? lx : sx, py = j ? ly : sy, ex = f.x - px, ey = f.y - py, e = Math.hypot(ex, ey) + 1;
        if (e < 90) { const push = 900 * (1 - e / 90); ax += ex / e * push; ay += ey / e * push; }
      }
      const damp = Math.exp(-1.8 * dt);
      f.vx = (f.vx + ax * dt) * damp; f.vy = (f.vy + ay * dt) * damp;
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || Math.abs(f.x - sx) > 3 * W) { f.x = sx; f.y = sy; f.vx = f.vy = 0; }
      f.a += ((i < n ? 1 : 0) - f.a) * Math.min(1, dt * 0.6);
      const tw = 0.55 + 0.45 * Math.sin(time * 1.9 + f.ph * 3);
      rootsGlow(P.fly, f.x, f.y, 11, f.a * tw * 0.8);
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  },
  drawSeed(time, cam) {
    const sx = this.sx(), sy = this.seedY * H, lv = assist.level, fc = flameColor();
    // a short trail of light where the seed has been
    const tr = this.trail;
    if (this.started && !this.paused && !this.ended) { tr.push({ x: this.D, y: this.seedY }); if (tr.length > 14) tr.shift(); }
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < tr.length - 1; i++) { const k = (i + 1) / tr.length; rootsGlow(fc, (tr[i].x - cam) * H, tr[i].y * H, 5 + 10 * k, 0.22 * k); }
    const blink = this.inv > 0 && this.started ? 0.5 + 0.5 * Math.cos(time * 16) : 1;
    rootsGlow(this.lightOn || !this.started ? fc : "#bcd2ff", sx, sy, 0.09 * H, (0.55 + 0.1 * Math.sin(time * 1.4)) * blink);
    if (lv > 0.02) rootsGlow("#ffd27a", sx, sy, 0.15 * H, 0.35 * lv);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    if (lv > 0.02) {  // a slow, soft ring breathing out from the seed while the lantern helps
      const u = (time * 0.55) % 1;
      ctx.strokeStyle = "#ffd27a"; ctx.lineWidth = 2; ctx.globalAlpha = lv * 0.4 * (1 - u);
      ctx.beginPath(); ctx.arc(sx, sy, 0.03 * H + u * 0.07 * H, 0, 6.29); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (!this.started) {  // a gentle beckoning glow before the run begins
      ctx.strokeStyle = "#fff4c4"; ctx.lineWidth = 2; ctx.globalAlpha = 0.25 + 0.12 * Math.sin(time * 1.5);
      ctx.beginPath(); ctx.arc(sx, sy, 0.055 * H + 0.012 * H * Math.sin(time * 1.5), 0, 6.29); ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.sin(time * 1.6) * 0.12);
    ctx.globalAlpha = 0.4 + 0.6 * blink;
    // three leaves: the top one wilts first, then the right, then the left
    const leaves = [[-0.009, -0.024, 0.011, -0.7], [0.009, -0.025, 0.012, 0.7], [0, -0.03, 0.01, 1.5708]];
    for (let j = 0; j < 3; j++) {
      const [lx, ly, lr, rot] = leaves[j], alive = j < 3 - this.wilts;
      ctx.fillStyle = alive ? "#7fd99f" : "#a08455"; ctx.beginPath();
      if (alive) rootsEll(lx * H, ly * H, lr * H, 0.005 * H, rot);
      else rootsEll(lx * H * 1.3, (ly + 0.016) * H, lr * H * 0.8, 0.004 * H, rot + (lx < 0 ? -1.1 : 1.1));
      ctx.fill();
    }
    ctx.fillStyle = "#fff4c4"; ctx.beginPath(); rootsEll(0, 0, 0.022 * H, 0.019 * H, 0); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.beginPath(); rootsCirc(-0.007 * H, -0.006 * H, 0.005 * H); ctx.fill();
    ctx.restore();
  },
  drawGrass(time, cam, w, P) {
    const f = 1.25, off = cam * f, sp = 0.022, k0 = Math.floor(off / sp) - 1, k1 = Math.ceil((off + W / H) / sp) + 1;
    const hMul = 1 + 0.35 * w[2] - 0.35 * w[3], bend = input.has && input.y > H * 0.7 ? (input.y - H * 0.7) / (H * 0.3) : 0;
    const bx = this.lightX();
    ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      const h1 = rootsHash(k), h2 = rootsHash(k + 999);
      if (h2 < w[2] * 0.55) continue;  // reeds stand sparser along the water
      const x = (k * sp + h2 * sp * 0.8 - off) * H, hgt = (0.03 + 0.055 * h1) * H * hMul;
      let sway = Math.sin(time * 0.9 + k * 0.7) * 0.15 * hgt;
      if (bend > 0) { const dl = x - bx; if (Math.abs(dl) < 90) sway += Math.sign(dl) * (1 - Math.abs(dl) / 90) * hgt * 0.5 * bend; }
      ctx.moveTo(x, H + 2); ctx.quadraticCurveTo(x + sway * 0.3, H - hgt * 0.5, x + sway, H - hgt);
    }
    ctx.strokeStyle = P.grass; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke();
  },
  lightX() { return this.started ? this.sx() + 0.07 * H : input.x; },  // once running only the height matters
  drawLight() {
    // the light the seed steers toward: a soft glow just ahead of it, never a hard ring
    if (!input.has || this.ended) return;
    const x = this.lightX(), y = clamp(input.y, 0, H), col = this.lightOn ? "#fff1b8" : "#dfe6ff";
    ctx.globalCompositeOperation = "lighter";
    rootsGlow(col, x, y, 30, this.lightOn ? 0.5 : 0.38);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#fffdf2"; ctx.beginPath(); rootsCirc(x, y, 3.5); ctx.fill(); ctx.globalAlpha = 1;
  },
};
function drawSkyStarsOnly(time) {
  for (const s of STARS) {
    ctx.globalAlpha = 0.25 + 0.3 * Math.sin(time * s.sp + s.ph); ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.29); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
