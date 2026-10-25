"use strict";
/* Lantern activity: Sight (5-4-3-2-1 grounding). Loaded after the core script in game.html and shares its globals
   (ctx, W, H, link, input, save, CFG, go, endRound, assist, world, voice, sfx, fx, ...).
   Every top-level name here starts with sight / SIGHT_ because all activity files share one global scope. */

// ---- Sight: endless 5-4-3-2-1 waves. The three night scenes cycle (harbour, village, under the sea), and
// in each you find 5 of one thing, then 4, 3, 2, 1 of others. Found things come alive and fly a light into
// the jar. Easy to start (wave one is big, bright and still), with a high ceiling: every wave the targets
// get smaller, dimmer and better camouflaged, start to drift, swim and hide, and the decoys multiply and
// become look-alikes. Quick finds in a row (within ~2.5 s) build a combo up to ×8; a mistake (tapping a
// decoy or empty night, touch/mouse only) resets it, and three mistakes end the round gently.
// No timers: slow players simply score less. When stress rises (assist.level), a guide firefly circles
// the next target, targets grow and brighten, decoys fade away, hints come sooner, motion slows
// (challengeFactor) and mistakes stop counting. Calm (world.calm) brightens the scene.

const SIGHT_COUNT_WORDS = ["One", "Two", "Three", "Four", "Five"];
// 5-4-3-2-1 grounding, offered once per kind in the first scene. Never required.
const SIGHT_SENSES = [
  "If you like, notice five things you can see around you, too.",
  "Can you feel four things? The blanket, the pillow, your hands…",
  "Listen for three sounds, near or far.",
  "Notice two things you can smell, or take two slow breaths.",
  "And one kind thing you could say to yourself.",
];

const SIGHT_SCENES = [
  {
    key: "harbour", sky: true, intro: "Let's look around the harbour at night…", done: "The harbour is fast asleep.",
    kinds: [
      { key: "firefly", n: 5, label: "fireflies", one: "firefly", hint: "little green lights over the water", decoy: "an ember", zone: [0.14, 0.5], color: "#d9ff8a", dcolor: "#ff9f5a", anim: "jar" },
      { key: "shell", n: 4, label: "shells", one: "shell", hint: "pink, on the sand", decoy: "a pebble", zone: [0.86, 0.95], color: "#f6c9d6", dcolor: "#7a7a8e", anim: "glow" },
      { key: "star", n: 3, label: "blue stars", one: "blue star", hint: "brighter than the rest", decoy: "a pink star", zone: [0.06, 0.34], color: "#a8d4ff", dcolor: "#ffb0d0", anim: "constellation" },
      { key: "fish", n: 2, label: "fish", one: "fish", hint: "orange, in the water", decoy: "a floating leaf", zone: [0.67, 0.8], color: "#ffb37a", dcolor: "#7fae6b", anim: "leap" },
      { key: "moon", n: 1, label: "moons on the water", one: "moon on the water", hint: "a silver shimmer on the waves", decoy: "a lamp's glow", zone: [0.65, 0.77], xr: [0.55, 0.95], color: "#eef0ff", dcolor: "#ffbe78", anim: "glow" },
    ],
  },
  {
    key: "village", sky: true, intro: "Let's look around the sleeping village…", done: "The whole village is dreaming.",
    kinds: [
      { key: "moth", n: 5, label: "glow-moths", one: "glow-moth", hint: "golden wings fluttering in the night", decoy: "a drifting spark", zone: [0.2, 0.52], color: "#ffe9a8", dcolor: "#ff8a5a", anim: "jar" },
      { key: "window", n: 4, label: "candles in dark windows", one: "candle in a dark window", hint: "a tiny flame behind the glass", decoy: "the moon's reflection", slots: "windows", color: "#ffcf6a", dcolor: "#9fc4ff", anim: "light" },
      { key: "star", n: 3, label: "blue stars", one: "blue star", hint: "brighter than the rest", decoy: "a pink star", zone: [0.06, 0.32], color: "#a8d4ff", dcolor: "#ffb0d0", anim: "constellation" },
      { key: "bird", n: 2, label: "sleeping birds", one: "sleeping bird", hint: "tucked up on the rooftops", decoy: "a chimney pot", slots: "roofs", color: "#c9d3f0", dcolor: "#7a4f4a", anim: "wake" },
      { key: "owl", n: 1, label: "owls", one: "owl", hint: "resting in the big tree", decoy: "a pinecone", slots: "tree", color: "#ffd98a", dcolor: "#7a5636", anim: "wake" },
    ],
  },
  {
    key: "sea", sky: false, intro: "Let's sink down, softly, under the sea…", done: "The sea sways you gently.",
    kinds: [
      { key: "jelly", n: 5, label: "glowing jellyfish", one: "glowing jellyfish", hint: "soft lights drifting in the deep", decoy: "a bubble", zone: [0.2, 0.56], color: "#e0a8ff", dcolor: "#bfe8ff", anim: "jar" },
      { key: "seastar", n: 4, label: "sea stars", one: "sea star", hint: "resting on the sand", decoy: "a pebble", zone: [0.88, 0.96], color: "#ffa98a", dcolor: "#7d7a8a", anim: "glow" },
      { key: "pearl", n: 3, label: "pearls", one: "pearl", hint: "in open shells among the kelp", decoy: "an empty shell", zone: [0.64, 0.83], color: "#f4f0ff", dcolor: "#a49ab8", anim: "glow" },
      { key: "gfish", n: 2, label: "golden fish", one: "golden fish", hint: "swimming slowly by", decoy: "a kelp leaf", zone: [0.3, 0.62], color: "#ffd36a", dcolor: "#6fae7b", anim: "dart" },
      { key: "turtle", n: 1, label: "sea turtles", one: "sea turtle", hint: "gliding through the blue", decoy: "a drifting log", zone: [0.26, 0.56], color: "#9fe0b0", dcolor: "#6b5038", anim: "dart" },
    ],
  },
];

const SIGHT_LIVES = 3, SIGHT_COMBO_MAX = 8;
// the colour each scene's targets fade towards as they get camouflaged
const SIGHT_TONES = { harbour: "#5d6b9e", village: "#6b6890", sea: "#3f7fa6" };
const SIGHT_FLY = { firefly: 1, moth: 1, jelly: 1 }, SIGHT_SWIM = { fish: 1, gfish: 1, turtle: 1 };
const SIGHT_DECOY_CORE = { firefly: "#ffd0a0", moth: "#ffc09a" };
const SIGHT_WAVE_LINES = {
  1: "Some things are pretending now. Look closely…",
  3: "The night grows trickier…",
  5: "Things are drifting and hiding now. Sharp eyes!",
  7: "You see so well. The night is testing you.",
  10: "Deep in the night now. Wonderful seeing.",
};
function SIGHT_LIVES_HTML(left) {  // three small lanterns: lit ones are mistakes still allowed
  let h = "";
  for (let i = 0; i < SIGHT_LIVES; i++) {
    const on = i < left;
    h += `<i style="display:inline-block;width:10px;height:14px;border-radius:5px 5px 4px 4px;background:${on ? "#ffd27a" : "rgba(255,255,255,.18)"};${on ? "box-shadow:0 0 8px rgba(255,210,122,.8);" : ""}"></i>`;
  }
  return h;
}

// ---- small drawing helpers (cached glow sprites are much cheaper than shadowBlur on tablets)

const sightSprites = {};
function sightRgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) hex = "#ffd27a";
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
// Mix two hex colours. k is rounded to tenths so the sprite cache stays small however long the round runs.
function sightMixHex(a, b, k) {
  k = Math.round(clamp(k, 0, 1) * 10) / 10;
  const A = sightRgb(a), B = sightRgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, "0")).join("");
}
function sightSprite(hex) {
  let c = sightSprites[hex];
  if (c) return c;
  c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32), [r, gg, b] = sightRgb(hex);
  gr.addColorStop(0, `rgba(${r},${gg},${b},1)`); gr.addColorStop(0.22, `rgba(${r},${gg},${b},0.55)`);
  gr.addColorStop(0.55, `rgba(${r},${gg},${b},0.14)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  sightSprites[hex] = c;
  return c;
}
function sightGlow(x, y, r, hex, a) {
  if (a <= 0.005 || r <= 0) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sightSprite(hex), x - r, y - r, r * 2, r * 2);
}
function sightRoundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function sightStarPath(x, y, rOut, rIn, points, rot) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rIn : rOut, ang = rot + i * Math.PI / points;
    ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
  }
  ctx.closePath();
}

// Where an item is right now (things drift, swim and flutter). Used by both drawing and picking.
// o.fq tweaks the little bob for look-alike decoys; o.mt/o.ax/o.ay are the wave's larger travelling path.
function sightPos(o, t) {
  let x = o.x * W, y = o.y * H;
  const q = o.fq || 1;
  switch (o.kind) {
    case "firefly": x += Math.sin(t * 0.7 * q + o.ph) * 10; y += Math.cos(t * 0.9 * q + o.ph) * 8; break;
    case "moth": x += Math.sin(t * 0.6 * q + o.ph) * 14; y += Math.sin(t * 1.3 * q + o.ph) * 7; break;
    case "fish": x += Math.sin(t * 0.4 * q + o.ph) * 18; break;
    case "gfish": x += Math.sin(t * 0.3 * q + o.ph) * 26; y += Math.sin(t * 0.7 * q + o.ph) * 4; break;
    case "jelly": x += Math.sin(t * 0.25 * q + o.ph) * 8; y += Math.sin(t * 0.6 * q + o.ph) * 10; break;
    case "turtle": x += Math.sin(t * 0.15 * q + o.ph) * 34; y += Math.sin(t * 0.3 * q + o.ph) * 6; break;
  }
  if (o.ax) { x += Math.sin(o.mt * o.fx + o.ph) * o.ax * W; y += Math.sin(o.mt * o.fy + o.ph * 1.7) * o.ay * H; }
  if (o.near > 0.01 && !o.found) x += Math.sin(t * 9 + o.ph) * 2 * o.near;  // a little shiver when noticed
  return [x, y];
}
// Which way a swimmer faces (+1 right, -1 left), from the direction it is drifting.
function sightFacing(o, t) {
  if (o.ax && o.ax * W > 30) return Math.cos(o.mt * o.fx + o.ph) >= 0 ? 1 : -1;
  const sp = o.kind === "fish" ? 0.4 : o.kind === "gfish" ? 0.3 : 0.15;
  return Math.cos(t * sp * (o.fq || 1) + o.ph) >= 0 ? 1 : -1;
}

function sightDrawItem(o, x, y, s, a, time, lit, ex) {
  const c = o.col || (o.decoy ? o.k.dcolor : o.k.color), fake = o.decoy && !o.mimic;  // fake: a decoy with its own shape
  ctx.globalAlpha = a;
  switch (o.kind) {
    case "firefly": {
      const p = 0.7 + 0.3 * Math.sin(time * 3 + o.ph);
      sightGlow(x, y, s * 3.4, c, a * p);
      ctx.globalAlpha = a; ctx.fillStyle = o.core || "#f4ffd6";
      ctx.beginPath(); ctx.arc(x, y, s * 0.55, 0, 6.29); ctx.fill(); break;
    }
    case "moth": {
      sightGlow(x, y, s * 3.2, c, a * (0.75 + 0.25 * Math.sin(time * 2.4 + o.ph)));
      ctx.globalAlpha = a;
      if (!fake) {
        const open = 0.25 + 0.75 * Math.abs(Math.sin(time * 8 * (o.fq || 1) + o.ph));
        ctx.globalAlpha = a * 0.75; ctx.fillStyle = o.core || "#fff0c8";
        ctx.beginPath(); ctx.ellipse(x - s * 0.6, y - s * 0.2, s * 0.9 * open, s * 0.6, -0.5, 0, 6.29); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + s * 0.6, y - s * 0.2, s * 0.9 * open, s * 0.6, 0.5, 0, 6.29); ctx.fill();
      }
      ctx.globalAlpha = a; ctx.fillStyle = o.core || "#fff6dc";
      ctx.beginPath(); ctx.ellipse(x, y, s * 0.35, s * 0.6, 0, 0, 6.29); ctx.fill(); break;
    }
    case "shell": {
      if (lit > 0) sightGlow(x, y, s * 4, c, a * 0.6 * lit);
      ctx.globalAlpha = a; ctx.fillStyle = c;
      if (fake) { ctx.beginPath(); ctx.ellipse(x, y, s * 1.4, s, 0.3, 0, 6.29); ctx.fill(); break; }
      ctx.beginPath(); ctx.moveTo(x, y + s);
      for (let i = 0; i <= 6; i++) { const ang = Math.PI + i * Math.PI / 6; ctx.lineTo(x + Math.cos(ang) * s * 1.6, y + Math.sin(ang) * s * 1.6); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(160,90,120,0.5)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 1; i < 6; i++) { const ang = Math.PI + i * Math.PI / 6; ctx.moveTo(x, y + s); ctx.lineTo(x + Math.cos(ang) * s * 1.4, y + Math.sin(ang) * s * 1.4); }
      ctx.stroke(); break;
    }
    case "star": {
      sightGlow(x, y, s * (3 + 2 * lit), c, a * (0.8 + 0.2 * Math.sin(time * 2 + o.ph)));
      ctx.globalAlpha = a; ctx.fillStyle = lit > 0 ? "#eef6ff" : c;
      sightStarPath(x, y, s * (1.3 + 0.3 * lit), s * 0.35, 4, time * 0.1); ctx.fill(); break;
    }
    case "fish": case "gfish": {
      if (fake) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, s * 1.5, s * 0.5, 0.5, 0, 6.29); ctx.fill();
        ctx.strokeStyle = "rgba(30,60,30,0.6)"; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(x - s * 1.2, y - s * 0.6); ctx.lineTo(x + s * 1.2, y + s * 0.6); ctx.stroke(); break;
      }
      const f = ex.face || sightFacing(o, time), wag = Math.sin(time * 6 + o.ph) * 0.25;
      if (lit > 0 || o.kind === "gfish") sightGlow(x, y, s * 3.5, c, a * (0.25 + 0.4 * lit));
      ctx.save(); ctx.translate(x, y); ctx.rotate(ex.rot || 0); ctx.scale(f, 1);
      ctx.globalAlpha = a; ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(0, 0, s * 1.6, s * 0.7, 0, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s * 1.4, 0); ctx.lineTo(-s * 2.4, -s * (0.8 + wag)); ctx.lineTo(-s * 2.4, s * (0.8 - wag)); ctx.fill();
      ctx.fillStyle = "#1a1530"; ctx.beginPath(); ctx.arc(s * 0.9, -s * 0.15, s * 0.16, 0, 6.29); ctx.fill();
      ctx.restore(); break;
    }
    case "moon": {
      if (lit > 0) sightGlow(x, y + s, s * 5, c, a * 0.5 * lit);
      ctx.fillStyle = o.decoy ? c : "#ebf0ff";
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = a * 0.85 * (0.5 + 0.3 * Math.sin(time * 2 + i + o.ph));
        ctx.beginPath(); ctx.ellipse(x + Math.sin(time + i) * 3, y + i * s * 0.7, s * (2.2 - i * 0.4), s * 0.25, 0, 0, 6.29); ctx.fill();
      }
      break;
    }
    case "window": {
      const sl = o.slot, ww = sl.w * W, wh = sl.h * H;
      ctx.globalAlpha = a;
      ctx.fillStyle = "#0a0d20"; ctx.fillRect(x - ww / 2, y - wh / 2, ww, wh);
      if (fake) {
        ctx.strokeStyle = "rgba(170,205,255,0.7)"; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(x - ww * 0.3, y + wh * 0.1); ctx.lineTo(x - ww * 0.05, y - wh * 0.3);
        ctx.moveTo(x - ww * 0.05, y + wh * 0.3); ctx.lineTo(x + ww * 0.3, y - wh * 0.15); ctx.stroke();
        sightGlow(x, y, ww * 0.6, c, a * 0.3);
      } else {
        if (lit > 0) { ctx.globalAlpha = a * lit * 0.85; ctx.fillStyle = "#ffcf6a"; ctx.fillRect(x - ww / 2, y - wh / 2, ww, wh); }
        const fl = 1 + 0.12 * Math.sin(time * 7 + o.ph) + 0.06 * Math.sin(time * 3.3);
        sightGlow(x, y + wh * 0.05, Math.max(ww, s * 3) * (0.8 + 0.6 * lit), c, a * (0.55 + 0.3 * lit));
        ctx.globalAlpha = a; ctx.fillStyle = "#efe6d6";
        ctx.fillRect(x - s * 0.22, y + wh * 0.12, s * 0.44, wh * 0.3);
        ctx.fillStyle = o.core || "#fff1b8"; ctx.beginPath(); ctx.ellipse(x, y + wh * 0.04, s * 0.26 * fl, s * 0.55 * fl, 0, 0, 6.29); ctx.fill();
      }
      ctx.globalAlpha = a; ctx.strokeStyle = "#2f3460"; ctx.lineWidth = 2; ctx.strokeRect(x - ww / 2, y - wh / 2, ww, wh);
      ctx.beginPath(); ctx.moveTo(x, y - wh / 2); ctx.lineTo(x, y + wh / 2); ctx.stroke();
      break;
    }
    case "bird": {
      if (fake) {
        ctx.fillStyle = c; ctx.fillRect(x - s * 0.55, y - s * 0.6, s * 1.1, s * 1.6);
        ctx.fillStyle = "#94625b"; ctx.fillRect(x - s * 0.75, y - s * 0.8, s * 1.5, s * 0.35); break;
      }
      if (lit > 0) sightGlow(x, y, s * 3.5, c, a * 0.4 * lit);
      ctx.globalAlpha = a; ctx.fillStyle = c;
      const w = ex.wing || 0;
      if (w > 0.05) {
        ctx.beginPath(); ctx.ellipse(x - s * 0.9, y - s * 0.6 * w, s * 0.9, s * 0.35, -0.9 * w, 0, 6.29); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + s * 0.9, y - s * 0.6 * w, s * 0.9, s * 0.35, 0.9 * w, 0, 6.29); ctx.fill();
      }
      ctx.beginPath(); ctx.ellipse(x, y, s * 1.25, s * 0.95, 0, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.arc(x + s * 0.8, y - s * 0.55, s * 0.6, 0, 6.29); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.globalAlpha = a * 0.5; ctx.beginPath(); ctx.ellipse(x + s * 0.2, y + s * 0.3, s * 0.7, s * 0.45, 0, 0, 6.29); ctx.fill();
      ctx.globalAlpha = a; ctx.fillStyle = "#ffb36a";
      ctx.beginPath(); ctx.moveTo(x + s * 1.3, y - s * 0.6); ctx.lineTo(x + s * 1.75, y - s * 0.45); ctx.lineTo(x + s * 1.3, y - s * 0.35); ctx.fill();
      ctx.strokeStyle = "#2a2e50"; ctx.lineWidth = 1.5; ctx.beginPath();
      if (lit > 0.5 && w > 0.05) ctx.arc(x + s * 0.95, y - s * 0.65, s * 0.14, 0, 6.29);
      else ctx.arc(x + s * 0.95, y - s * 0.62, s * 0.18, 0.2, Math.PI - 0.2);
      ctx.stroke(); break;
    }
    case "owl": {
      if (fake) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, s * 0.9, s * 1.4, 0, 0, 6.29); ctx.fill();
        ctx.strokeStyle = "rgba(40,25,15,0.7)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = -1; i <= 1; i++) { ctx.moveTo(x - s * 0.8, y + i * s * 0.5); ctx.lineTo(x + s * 0.8, y + i * s * 0.5 + s * 0.3); }
        ctx.stroke(); break;
      }
      const hop = ex.hop || 0;
      y -= hop;
      sightGlow(x, y - s * 0.4, s * 3, c, a * (0.25 + 0.4 * lit));
      ctx.globalAlpha = a; ctx.fillStyle = "#8a6a48";
      ctx.beginPath(); ctx.ellipse(x, y, s * 1.3, s * 1.7, 0, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - s * 1.1, y - s * 1.1); ctx.lineTo(x - s * 0.9, y - s * 2); ctx.lineTo(x - s * 0.4, y - s * 1.4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + s * 1.1, y - s * 1.1); ctx.lineTo(x + s * 0.9, y - s * 2); ctx.lineTo(x + s * 0.4, y - s * 1.4); ctx.fill();
      ctx.fillStyle = "#c8a77a"; ctx.beginPath(); ctx.ellipse(x, y + s * 0.5, s * 0.8, s * 0.9, 0, 0, 6.29); ctx.fill();
      const blink = Math.sin(time * 0.5 + o.ph) > 0.93 && lit < 0.5, er = s * (0.42 + 0.12 * lit + 0.1 * o.near);
      for (const dx of [-0.5, 0.5]) {
        const ex2 = x + dx * s * 1.1, ey = y - s * 0.55;
        if (blink) { ctx.strokeStyle = "#3a2a1a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ex2 - er, ey); ctx.lineTo(ex2 + er, ey); ctx.stroke(); continue; }
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(ex2, ey, er, 0, 6.29); ctx.fill();
        ctx.fillStyle = "#2a1c10"; ctx.beginPath(); ctx.arc(ex2, ey, er * 0.45, 0, 6.29); ctx.fill();
      }
      ctx.fillStyle = "#e0a050"; ctx.beginPath(); ctx.moveTo(x - s * 0.15, y - s * 0.25); ctx.lineTo(x + s * 0.15, y - s * 0.25); ctx.lineTo(x, y + s * 0.05); ctx.fill();
      break;
    }
    case "jelly": {
      if (fake) {
        ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, s * 1.1, 0, 6.29); ctx.stroke();
        ctx.fillStyle = "#ffffff"; ctx.globalAlpha = a * 0.6; ctx.beginPath(); ctx.arc(x - s * 0.4, y - s * 0.4, s * 0.25, 0, 6.29); ctx.fill(); break;
      }
      const pu = 1 + 0.08 * Math.sin(time * 2 + o.ph);
      sightGlow(x, y, s * (3.6 + 1.5 * lit), c, a * (0.6 + 0.3 * lit));
      ctx.globalAlpha = a * 0.6; ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = -1.5; i <= 1.5; i += 1) {
        const tx = x + i * s * 0.55; ctx.moveTo(tx, y);
        for (let j = 1; j <= 4; j++) ctx.lineTo(tx + Math.sin(time * 2 + o.ph + j + i) * s * 0.3, y + j * s * 0.65);
      }
      ctx.stroke();
      ctx.globalAlpha = a * 0.8; ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(x, y, s * 1.4 * pu, s * 1.1 / pu, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); break;
    }
    case "seastar": {
      ctx.fillStyle = c;
      if (fake) { ctx.beginPath(); ctx.ellipse(x, y, s * 1.3, s * 0.9, 0.4, 0, 6.29); ctx.fill(); break; }
      if (lit > 0) sightGlow(x, y, s * 4, c, a * 0.55 * lit);
      ctx.globalAlpha = a; ctx.fillStyle = c;
      sightStarPath(x, y, s * 1.6, s * 0.65, 5, -Math.PI / 2 + (ex.spin || 0) + o.ph * 0.1); ctx.fill();
      ctx.fillStyle = "rgba(255,240,220,0.7)"; ctx.beginPath(); ctx.arc(x, y, s * 0.25, 0, 6.29); ctx.fill(); break;
    }
    case "pearl": {
      ctx.fillStyle = "#7c6c98";
      ctx.beginPath(); ctx.ellipse(x, y + s * 0.2, s * 1.6, s * 0.75, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#9a8ab5";
      ctx.beginPath(); ctx.ellipse(x, y - s * 0.2, s * 1.5, s * 0.6, -0.25, Math.PI, 0); ctx.closePath(); ctx.fill();
      if (!fake) {
        sightGlow(x, y, s * (2.4 + 2 * lit), c, a * (0.55 + 0.35 * lit));
        ctx.globalAlpha = a; ctx.fillStyle = o.core || "#fbf8ff"; ctx.beginPath(); ctx.arc(x, y + s * 0.05, s * 0.55, 0, 6.29); ctx.fill();
      }
      break;
    }
    case "turtle": {
      if (fake) {
        ctx.fillStyle = c; sightRoundRect(x - s * 1.8, y - s * 0.45, s * 3.6, s * 0.9, s * 0.4); ctx.fill();
        ctx.strokeStyle = "#9a7a58"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x + s * 1.5, y, s * 0.2, s * 0.35, 0, 0, 6.29); ctx.stroke(); break;
      }
      const f = ex.face || sightFacing(o, time), pad = Math.sin(time * 1.6 + o.ph) * 0.4;
      sightGlow(x, y, s * 4, c, a * (0.2 + 0.4 * lit));
      ctx.save(); ctx.translate(x, y); ctx.rotate(ex.rot || 0); ctx.scale(f, 1); ctx.globalAlpha = a;
      ctx.fillStyle = "#7cc496";
      ctx.beginPath(); ctx.ellipse(s * 0.8, -s * 0.9, s * 0.9, s * 0.3, -0.7 + pad, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s * 0.8, s * 0.9, s * 0.9, s * 0.3, 0.7 - pad, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-s * 1.2, -s * 0.7, s * 0.5, s * 0.22, 0.6 - pad, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-s * 1.2, s * 0.7, s * 0.5, s * 0.22, -0.6 + pad, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 2.1, 0, s * 0.5, 0, 6.29); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, s * 1.8, s * 1.25, 0, 0, 6.29); ctx.fill();
      ctx.strokeStyle = "rgba(40,90,60,0.7)"; ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.8, s * 0.55, 0, 0, 6.29); ctx.moveTo(-s * 1.7, 0); ctx.lineTo(-s * 0.8, 0); ctx.moveTo(s * 0.8, 0); ctx.lineTo(s * 1.7, 0); ctx.stroke();
      ctx.restore(); break;
    }
  }
}

// ---- the activity

const SIGHT_MAX_WAVES = 9;  // three trips through the scenes

const Sight = {
  allowComfort: false, act: "sight", keepTouch: true,
  assistLine: "A little firefly will show you the way.",
  enter(meta) {
    this.meta = meta; this.wave = 0; this.found = 0; this.mistakes = 0; this.score = 0; this.ended = null;
    this.tt = 0; this.pt = 0; this.ht = 0; this.drawT = 0; this.trans = null; this.motes = []; this.jar = []; this.bonus = null; this.bonusCaught = 0;
    this.combo = 1; this.bestCombo = 1; this.lastFind = -1e9; this.comboSaid = 0; this.lastStray = -1e9; this.lastNudge = -1e9;
    this.pops = []; this.ripples = []; this.e = 0;
    this.best = (save.best && save.best.sight) || 0; this.beatBest = false;
    this.diff = save.effects.sight.slice(-2).reduce((a, b) => a + b, 0) / 2 < -4 ? 0.7 : 1;
    const ring = 2 * Math.PI * 8.5;
    setUI(`${topBar(`<span class="pill" aria-label="score">🔭 <b id="sScore">0</b></span>`
      + `<span class="pill" aria-label="combo" style="display:inline-flex;align-items:center;gap:6px"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">`
      + `<circle cx="11" cy="11" r="8.5" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="2.5"/>`
      + `<circle id="sRing" cx="11" cy="11" r="8.5" fill="none" stroke="#ffd27a" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${ring.toFixed(2)}" stroke-dashoffset="${ring.toFixed(2)}" transform="rotate(-90 11 11)"/></svg>`
      + `<span>×<b id="sMult">1</b></span></span>`
      + `<span class="pill" id="sLives" aria-label="mistakes left" style="display:inline-flex;align-items:center;gap:5px">${SIGHT_LIVES_HTML(SIGHT_LIVES)}</span>`
      + `<span class="pill">Best <b id="sBest">${this.best}</b></span>`
      + `<button class="btn" id="finish" style="min-height:44px;padding:0 18px">Finish</button>`)}<div class="prompt fade-in" style="margin-top:12px" id="sp"></div><div class="spacer"></div>`);
    wireGear(); wireFinish(this);
    this.el = { score: $("#sScore"), mult: $("#sMult"), ring: $("#sRing"), lives: $("#sLives"), best: $("#sBest"), ringLen: ring };
    this.shown = { score: -1, mult: -1, ring: -1, lives: -1, best: this.best };
    const L = this.lanternPos();
    this.guide = { x: L.x, y: L.y, target: null, trail: [] };
    this.newWave();
  },

  // ---------------------------------------------------------------- layout
  jarGeom() {
    const w = clamp(Math.min(W, H) * 0.1, 52, 88), h = w * 1.3;
    return { x: W - 20 - w / 2, y: H - 20 - h / 2, w, h };
  },
  lanternPos() {
    const J = this.jarGeom(), s = J.w * 0.3;
    return { x: J.x - J.w / 2 - s * 1.7, y: J.y + J.h * 0.1, s };
  },
  blocked(x, y) {  // keep targets clear of the jar, the lantern, the help badge and the moon
    const px = x * W, py = y * H, J = this.jarGeom(), L = this.lanternPos();
    if (px > L.x - L.s * 2 && py > J.y - J.h / 2 - 30) return true;
    if (px < 240 && py > H - 80) return true;
    if (this.sc && this.sc.sky && Math.hypot(px - W * 0.82, py - H * 0.16) < Math.min(W, H) * 0.09) return true;
    return false;
  },

  // ---------------------------------------------------------------- waves
  // Waves never stop: harbour -> village -> sea -> harbour… and each one is a little harder.
  // e (0..~0.9) is the wave's difficulty: 0 on wave one, scaled by challengeFactor() when stress is high.
  newWave() {
    const w = this.wave, sc = SIGHT_SCENES[w % SIGHT_SCENES.length], minD = Math.min(W, H), cf = challengeFactor();
    const e = w === 0 ? 0 : (1 - Math.exp(-w / 4.5)) * this.diff * cf, ew = w * this.diff * cf;
    this.e = e; this.sc = sc; this.items = []; this.starOrder = [];
    this.props = this.buildProps(sc);
    const tone = SIGHT_TONES[sc.key] || "#5d6b9e";
    const camo = lerp(0, 0.38, e), sim = lerp(0.15, 0.68, e), mimicP = clamp((e - 0.22) / 0.4, 0, 1);
    const hideP = clamp((e - 0.3) / 0.5, 0, 0.8), size = lerp(1.15, 0.62, e), alpha = lerp(0.95, 0.5, e);
    const add = (k, decoy, x, y, slot) => {
      const mimic = decoy && Math.random() < mimicP;
      const o = { k, kind: k.key, decoy, mimic, x, y, slot, found: false, gone: false, anim: null, near: 0, vis: 1,
        ph: rand(0, 6.28), alpha, size, fq: 1, ax: 0, ay: 0, fx: 1, fy: 1, sp: 0, mt: rand(0, 20), hide: null,
        col: decoy ? sightMixHex(k.dcolor, k.color, sim) : sightMixHex(k.color, tone, camo), core: null };
      if (decoy) {
        o.core = mimic ? sightMixHex("#ffffff", o.col, 0.4) : (SIGHT_DECOY_CORE[k.key] || null);
        if (mimic) { o.size *= Math.random() < 0.5 ? rand(0.8, 0.88) : rand(1.12, 1.2); o.fq = Math.random() < 0.5 ? 0.7 : 1.35; }
      }
      // movement: flyers wander, swimmers cruise, the moon's reflection drifts; slot things stay put
      if (!slot && e > 0) {
        if (SIGHT_FLY[k.key]) { o.ax = lerp(0, 0.075, e) * minD / W; o.ay = lerp(0, 0.05, e) * minD / H; o.fx = rand(0.8, 1.2); o.fy = rand(1.15, 1.6); o.sp = lerp(0.3, 1.05, e) * rand(0.8, 1.2); }
        else if (SIGHT_SWIM[k.key]) { o.ax = lerp(0.02, 0.2, e); o.ay = 0.012; o.fx = 1; o.fy = 2.1; o.sp = lerp(0.25, 0.75, e) * rand(0.8, 1.2); }
        else if (k.key === "moon") { o.ax = lerp(0, 0.05, e); o.sp = lerp(0.2, 0.5, e); }
        if (decoy && o.sp) o.sp *= o.fq;  // a pretender moves at a slightly different pace
        if (o.ax) o.x = clamp(o.x, 0.05 + o.ax, 0.95 - o.ax);
      }
      if (Math.random() < hideP) o.hide = { per: rand(5, 9) * lerp(1, 0.7, e), frac: lerp(0.2, 0.36, e), ph: rand(0, 1) };
      this.items.push(o);
    };
    const place = (k, decoy) => {
      if (k.slots) {
        const opts = (this.props.slots[k.slots] || []).filter((s) => !s.used && !this.blocked(s.x, s.y));
        if (!opts.length) return;
        const s = opts[Math.floor(Math.random() * opts.length)]; s.used = true;
        add(k, decoy, s.x, s.y, s); return;
      }
      const xr = k.xr || [0.06, 0.94], y1 = k.zone[1], y0 = Math.min(Math.max(k.zone[0], 170 / H), y1 - 0.05);
      let best = null, bestD = -1;
      for (let i = 0; i < 40; i++) {
        const x = rand(xr[0], xr[1]), y = rand(y0, y1);
        if (this.blocked(x, y)) continue;
        let dd = 1e9;
        for (const o of this.items) dd = Math.min(dd, Math.hypot((o.x - x) * W, (o.y - y) * H));
        if (dd > 0.09 * minD) { best = [x, y]; break; }
        if (dd > bestD) { bestD = dd; best = [x, y]; }
      }
      if (best) add(k, decoy, best[0], best[1], null);
    };
    for (const k of sc.kinds) {
      for (let i = 0; i < k.n; i++) place(k, false);
      const decoys = w === 0 ? 0 : Math.min(Math.round(k.n * 1.6) + 1, Math.round(k.n * (0.4 + 0.22 * ew)));
      for (let i = 0; i < decoys; i++) place(k, true);
    }
    this.kind = 0; this.kindT = 0; this.dwell = null; this.streak = 0;
    this.lastFind = this.combo > 1 ? this.pt : this.lastFind;  // a fresh window to carry the combo into the new scene
    this.drift = null; this.driftNext = this.tt + rand(8, 16);
    this.bonusNext = this.tt + rand(14, 24);
    this.guide.target = null;
    voice.say(SIGHT_WAVE_LINES[w] || sc.intro, 4.5);
    this.prompt();
  },
  buildProps(sc) {
    const P = { slots: {} }, minD = Math.min(W, H);
    if (sc.key === "harbour") {
      P.boats = [0.3, 0.5, 0.7].map((x) => ({ x: x + rand(-0.04, 0.04), y: rand(0.628, 0.65), s: rand(0.8, 1.15), ph: rand(0, 6.28), near: 0, px: 0, py: 0 }));
    } else if (sc.key === "village") {
      const n = W > H ? 7 : 5, x0 = 0.17, span = 0.62, ground = 0.86, sBird = minD * 0.013;
      P.houses = []; P.slots.windows = []; P.slots.roofs = []; P.slots.tree = [];
      for (let i = 0; i < n; i++) {
        const wpx = (span / n) * W * rand(0.78, 0.92), hpx = wpx * rand(0.9, 1.25), cx = (x0 + span * (i + 0.5) / n) * W;
        const roof = wpx * 0.45, top = H * ground - hpx;
        const house = { x: cx / W, w: wpx / W, h: hpx / H, roof: roof / H, tint: rand(0, 1), chimney: i % 2 === 0, smokePh: rand(0, 1), windows: [] };
        const ww = wpx * 0.2, wh = wpx * 0.22;
        for (let r = 0; r < 2; r++) for (const cxk of [-0.22, 0.22]) {
          const slot = { x: (cx + cxk * wpx) / W, y: (H * ground - hpx * (0.3 + r * 0.4)) / H, w: ww / W, h: wh / H, used: false,
            l: 0, sp: rand(0.05, 0.14), ph: rand(0, 6.28) };
          house.windows.push(slot); P.slots.windows.push(slot);
        }
        P.houses.push(house);
        if (i !== Math.floor(n / 2)) {
          P.slots.roofs.push({ x: cx / W, y: (top - roof - sBird * 0.9) / H, used: false });
          P.slots.roofs.push({ x: (cx + wpx * 0.27) / W, y: (top - roof * 0.45 - sBird * 0.9) / H, used: false });
        }
      }
      const ch = P.houses[Math.floor(n / 2)], chx = ch.x * W, chw = ch.w * W;
      P.cat = { x: (chx - chw * 0.22) / W, y: (H * ground - ch.h * H - ch.roof * H * 0.5) / H, near: 0, ph: rand(0, 6) };
      const tx = (W > H ? 0.075 : 0.1) * W, trunk = minD * 0.22, cr = minD * 0.09, ty = H * ground - trunk;
      P.tree = { x: tx / W, y: ty / H, r: cr };
      for (const [dx, dy] of [[-0.3, 0.15], [0.35, -0.25], [0.05, 0.5]]) P.slots.tree.push({ x: (tx + dx * cr) / W, y: (ty + dy * cr) / H, used: false });
    } else {
      P.kelp = Array.from({ length: 11 }, (_, i) => ({ x: (i + rand(0.1, 0.9)) / 11, h: rand(0.22, 0.42), ph: rand(0, 6.28), w: rand(4, 8) }));
      P.rocks = Array.from({ length: 4 }, () => ({ x: rand(0.05, 0.75), r: rand(0.04, 0.08) }));
      P.bubbles = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), r: rand(1.5, 4.5), sp: rand(0.03, 0.07), ph: rand(0, 6.28) }));
      P.school = { x: -0.15, y: 0.42, vx: 0.025, dy: 0, fish: Array.from({ length: 7 }, () => [rand(-40, 40), rand(-22, 22), rand(0, 6.28)]) };
    }
    return P;
  },
  current() { return this.sc && this.sc.kinds[this.kind]; },
  prompt() {
    const sp = $("#sp");
    if (!sp) return;
    if (this.trans) { sp.innerHTML = `<h2>${this.sc.done}</h2><p>Drifting somewhere new… wave ${this.wave + 1}</p>`; return; }
    const k = this.current();
    if (!k) return;
    const left = this.items.filter((o) => o.kind === k.key && !o.decoy && !o.found).length;
    sp.innerHTML = `<h2>Find ${left} ${left === 1 ? k.one : k.label}</h2><p>${k.hint}${this.wave === 0 && this.kind === 0 && this.found === 0
      ? (input.usingSleeve() ? " · aim and tap your finger, or hold still on it" : " · tap them, quick finds in a row build a combo") : ""}</p>`;
  },

  // ---------------------------------------------------------------- selecting
  // The touch radius shrinks with the wave but never below a fingertip (30 px).
  hitR() {
    const r = lerp(0.085, 0.05, this.e || 0) * Math.min(W, H) * (input.source === "sleeve" ? 1.35 : 1) * (1 + 0.25 * assist.level);
    return Math.max(30, r);
  },
  // ~2.5 s to keep a combo climbing, a little tighter at each step (~1.15 s at ×7): high combos need real pace.
  // Wider under stress (challengeFactor) and for the coarse sleeve cursor.
  comboWindow() { return 2.5 * (1 - 0.09 * (this.combo - 1)) * (1 + 0.6 * (1 - challengeFactor())) * (input.source === "sleeve" ? 1.3 : 1); },
  hintDelay() { return lerp(12, 3, assist.level); },
  pick(x, y, allowDecoy) {
    const k = this.current();
    if (!k) return null;
    let best = null, bd = this.hitR();
    for (const o of this.items) {
      if (o.found || o.kind !== k.key || o.vis < 0.4 || (o.decoy && !allowDecoy)) continue;
      const p = sightPos(o, this.drawT), d = Math.hypot(p[0] - x, p[1] - y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  },
  // Is there anything at all near a tap (any item, the bonus, the jar corner, the top bar)? If not, it was a stray tap.
  nearAnything(x, y) {
    if (y < 130 || this.blocked(x / W, y / H)) return true;
    const r = Math.max(this.hitR() * 2.2, Math.min(W, H) * 0.12);
    for (const o of this.items) {
      if (o.gone || (o.decoy && o.found)) continue;
      const p = sightPos(o, this.drawT);
      if (Math.abs(p[0] - x) < r && Math.abs(p[1] - y) < r && Math.hypot(p[0] - x, p[1] - y) < r) return true;
    }
    if (this.bonus) { const p = this.bonusPos(this.bonus); if (Math.hypot(p[0] - x, p[1] - y) < r) return true; }
    return false;
  },
  strayTap(x, y) {
    if (this.found === 0 || this.tt - this.lastStray < 0.35) return;  // a first "wake up" tap, or one jittery double-touch, is free
    this.lastStray = this.tt;
    if (this.nearAnything(x, y)) {
      const k = this.current();
      if (k && this.tt - this.lastNudge > 6) { this.lastNudge = this.tt; toast(`Looking for ${k.label} now.`, 1.8); }
      return;
    }
    this.mistake(x, y, null);
  },
  mistake(x, y, o) {
    const k = this.current();
    this.combo = 1; this.streak = 0; this.lastFind = -1e9;
    this.ripples.push({ x, y, t: 0 });
    sfx.soft();
    if (o) { o.found = true; o.fadeAt = this.tt; fx.burst(x, y, { color: "#b9c0d8", n: 6, speed: 25, life: 1, size: 1.6 }); }
    const what = o && k ? `That one's ${k.decoy}.` : "Nothing there, just mist.";
    if (assist.on) { toast(`${what} No harm done.`, 2); return; }  // while the lantern helps, mistakes are free
    this.mistakes++;
    this.uiTick(true);
    if (this.mistakes >= SIGHT_LIVES) { this.finish("The mist rolls in softly."); return; }
    toast(what, 2);
    if (SIGHT_LIVES - this.mistakes === 1) voice.say("One lantern left. Take your time, there's no hurry.", 4);
  },
  select(o, how) {
    const k = this.current(), p = sightPos(o, this.drawT);
    if (o.decoy) { this.mistake(p[0], p[1], o); return; }
    const w = this.wave, win = this.comboWindow(), gap = this.pt - this.lastFind, quick = gap <= win;
    const hinted = this.kindT > this.hintDelay() && assist.level <= 0.3;  // the guide firefly (assist) is free help; the timed hint costs a little
    if (quick && !hinted) this.combo = Math.min(SIGHT_COMBO_MAX, this.combo + 1);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    let pts = (1.2 + 0.08 * w) * this.combo + (quick && !hinted ? (1 - gap / win) * 0.8 : 0);
    if (hinted) pts *= 0.5;
    if (how === "dwell") pts *= 0.8;  // taps are worth a little more than holding still
    pts *= 1 - 0.45 * assist.level;  // the helping hand makes it easier, never more rewarding
    this.score += pts; this.lastFind = this.pt;
    o.found = true; o.anim = { type: k.anim, t: 0 }; this.found++; this.streak++; this.kindT = 0;
    this.pops.push({ x: p[0], y: p[1] - 18, t: 0, txt: `+${Math.max(1, Math.round(pts))}`, big: this.combo >= 4 });
    if (quick && !hinted && (this.combo === 4 || this.combo === SIGHT_COMBO_MAX) && this.comboSaid < this.combo) {
      this.comboSaid = this.combo;
      toast(this.combo === SIGHT_COMBO_MAX ? `×${SIGHT_COMBO_MAX}! Perfect flow.` : "×4. Lovely rhythm.", 2);
    }
    this.checkBest();
    // a little tune: each find in a row climbs the pentatonic scale, then sways near the top
    const st = Math.max(this.streak - 1, this.combo - 1), note = st <= 9 ? st : 9 - ((st - 9) % 4);
    sfx.chime(note, 0.1);
    fx.burst(p[0], p[1], { color: k.color, n: 10 + 2 * Math.min(this.combo, 8), speed: 70, life: 1.2, size: 2.2 });
    if (k.anim === "leap") fx.burst(p[0], p[1], { color: "#bfe2ff", n: 10, speed: 60, life: 0.9, size: 1.8, up: 50 });
    if (k.anim === "jar") o.gone = true;  // the thing itself flies into the jar
    if (k.anim === "constellation") this.starOrder.push(o);
    this.motes.push({ x0: p[0], y0: p[1], t: k.anim === "jar" ? 0 : -0.5, dur: 1.5, color: k.color, big: k.anim === "jar" });
    if (this.guide.target === o) this.guide.target = null;
    if (!this.items.some((i) => i.kind === k.key && !i.decoy && !i.found)) {
      sfx.sparkle();
      if (w === 0) voice.say(`${SIGHT_COUNT_WORDS[k.n - 1]} ${k.n === 1 ? k.one : k.label}. ${SIGHT_SENSES[this.kind] || ""}`, 6);
      this.kind++;
      if (this.kind >= this.sc.kinds.length) {
        this.score += (8 + 4 * w) * (1 - 0.45 * assist.level); this.checkBest(); this.wave++; sfx.swell(2);
        // Sleeve and helping-hand play can't make mistakes, so give every run a natural end.
        if (this.wave >= SIGHT_MAX_WAVES) { this.finish("You've explored every corner of the night."); return; }
        if (w > 0) voice.say(this.sc.done, 3);
        this.trans = { t: 0, swapped: false, mid: w === 0 ? 4.6 : 2.6 };  // longer after scene one, so the grounding line can be read
        this.prompt();
        return;
      }
    }
    this.prompt();
  },
  checkBest() {
    if (this.beatBest || this.best <= 0 || this.score <= this.best) return;
    this.beatBest = true; sfx.sparkle(); toast("New best!", 2.4);
    if (this.el.best && this.el.best.parentNode) this.el.best.parentNode.style.borderColor = "rgba(255,210,122,.8)";
  },
  catchBonus(x, y) {
    const b = this.bonus;
    if (!b) return false;
    const p = this.bonusPos(b);
    if (Math.hypot(p[0] - x, p[1] - y) > this.hitR() * 1.4) return false;
    this.bonus = null; this.bonusCaught++;
    if (this.bonusCaught <= 6) { const pts = 3 + this.wave; this.score += pts; this.pops.push({ x: p[0], y: p[1] - 18, t: 0, txt: `+${pts}`, big: true }); this.checkBest(); }
    fx.burst(p[0], p[1], { color: "#ffe9a0", n: 24, speed: 90, life: 1.4, size: 2.4 });
    sfx.sparkle();
    toast(this.sc.sky ? "A shooting star! Make a little wish." : "A golden bubble! Lovely catch.", 2.6);
    this.motes.push({ x0: p[0], y0: p[1], t: 0, dur: 1.6, color: "#ffe9a0", big: true });
    return true;
  },

  // ---------------------------------------------------------------- update
  visOf(o) {  // hiding things (behind a cloud, under a wave, a curtain drawn): 0 hidden .. 1 shown
    const h = o.hide, u = ((this.ht / h.per + h.ph) % 1 + 1) % 1, edge = 0.08;
    if (u < h.frac) return 0;
    if (u < h.frac + edge) return (u - h.frac) / edge;
    if (u > 1 - edge) return (1 - u) / edge;
    return 1;
  },
  uiTick(force) {
    const E = this.el, S = this.shown;
    if (!E) return;
    const sc = Math.round(this.score);
    if (sc !== S.score && E.score) { S.score = sc; E.score.textContent = sc; }
    if (this.combo !== S.mult && E.mult) { S.mult = this.combo; E.mult.textContent = this.combo; }
    const k = this.trans ? (S.ring >= 0 ? S.ring : 0) : clamp(1 - (this.pt - this.lastFind) / this.comboWindow(), 0, 1);
    if ((force || Math.abs(k - S.ring) > 0.01) && E.ring) { S.ring = k; E.ring.setAttribute("stroke-dashoffset", (E.ringLen * (1 - k)).toFixed(1)); }
    const left = SIGHT_LIVES - this.mistakes;
    if (left !== S.lives && E.lives) { S.lives = left; E.lives.innerHTML = SIGHT_LIVES_HTML(left); }
    if (this.beatBest && sc !== S.best && E.best) { S.best = sc; E.best.textContent = sc; }
  },
  update(dt) {
    this.tt += dt;
    this.updateMotes(dt);
    this.updateAmbient(dt);
    this.updateGuide(dt);
    const cf = challengeFactor();
    if (!this.trans) { this.pt += dt; this.ht += dt * cf; }
    for (const o of this.items) {
      if (!o.found) {
        if (o.sp) o.mt += dt * o.sp * cf;  // drifting slows right down when stress is high
        o.vis = o.hide ? this.visOf(o) : 1;
      } else o.vis = 1;
      if (!o.anim) continue;
      o.anim.t += dt;
      if (o.anim.type === "leap" && !o.splashed && o.anim.t > 1.35) {
        o.splashed = true;
        const p = sightPos(o, this.drawT);
        fx.burst(p[0] + Math.min(W, H) * 0.12 * o.size * sightFacing(o, this.drawT), p[1], { color: "#bfe2ff", n: 10, speed: 50, life: 0.9, size: 1.6, up: 40 });
      }
    }
    for (const q of this.pops) q.t += dt;
    for (const r of this.ripples) r.t += dt;
    if (this.pops.length && this.pops[0].t > 1.1) this.pops = this.pops.filter((q) => q.t <= 1.1);
    if (this.ripples.length && this.ripples[0].t > 1) this.ripples = this.ripples.filter((r) => r.t <= 1);
    this.uiTick(false);
    if (this.trans) {
      input.takeTaps();  // taps while the scene changes don't carry over into the next one
      const tr = this.trans; tr.t += dt;
      if (!tr.swapped && tr.t >= tr.mid && !this.ended) { tr.swapped = true; this.trans = null; this.newWave(); this.trans = tr; }
      if (tr.t >= tr.mid + 1.4) { this.trans = null; this.lastFind = this.combo > 1 ? this.pt : this.lastFind; this.prompt(); }
      return;
    }
    if (this.ended || !this.current()) { input.takeTaps(); return; }
    this.kindT += dt;
    // hover: things notice the cursor (a shiver, a brighter glow)
    const hr = this.hitR() * 1.8;
    for (const o of this.items) {
      let t = 0;
      if (input.has && !o.found) { const p = sightPos(o, this.drawT); t = clamp(1 - Math.hypot(p[0] - input.x, p[1] - input.y) / hr, 0, 1); }
      o.near += (t - o.near) * Math.min(1, dt * 6);
    }
    const allowDecoys = assist.level < 0.6;  // faded decoys can't be picked
    for (const tp of input.takeTaps()) {
      if (this.ended || this.trans) break;
      if (this.catchBonus(tp.x, tp.y)) continue;
      const sleeve = tp.source === "sleeve";
      const o = this.pick(tp.x, tp.y, !sleeve && allowDecoys);  // sleeve taps never pick decoys
      if (o) this.select(o, "tap");
      else if (!sleeve) this.strayTap(tp.x, tp.y);  // sleeve jolts are unreliable: never a mistake
    }
    if (this.ended || this.trans) return;
    // dwell: holding the cursor on a real target for a moment selects it (never a decoy)
    if (input.has && input.source === "sleeve") {
      const o = this.pick(input.x, input.y, false);
      if (o && this.dwell && this.dwell.o === o) { this.dwell.t += dt; if (this.dwell.t > 1.3) { this.dwell = null; this.select(o, "dwell"); } }
      else this.dwell = o ? { o, t: 0 } : null;
    } else this.dwell = null;
  },
  updateMotes(dt) {
    const J = this.jarGeom();
    for (const m of this.motes) {
      m.t += dt;
      if (m.t >= m.dur && !m.done) {
        m.done = true;
        if (this.jar.length < 60) this.jar.push({ c: m.color, rx: rand(-0.3, 0.3), ry: rand(-0.22, 0.34), ph: rand(0, 6.28) });
        fx.sparkle(J.x, J.y, m.color);
      }
    }
    if (this.motes.length && this.motes.every((m) => m.done)) this.motes = [];
  },
  updateAmbient(dt) {
    const P = this.props, calm = world.calm, tt = this.tt;
    if (!P) return;
    const near = (x, y, r) => input.has ? clamp(1 - Math.hypot(x - input.x, y - input.y) / r, 0, 1) : 0;
    // a slow surprise now and then (a whale, a cloud across the moon); calmer = more often
    if (!this.drift && tt > this.driftNext) this.drift = { t: 0, dur: this.sc.key === "village" ? 55 : 42, dir: Math.random() < 0.5 ? 1 : -1 };
    if (this.drift) { this.drift.t += dt; if (this.drift.t > this.drift.dur) { this.drift = null; this.driftNext = tt + rand(10, 22) * (1.4 - 0.6 * calm); } }
    // the bonus: a slow shooting star (or a golden bubble under the sea). Tappable, never needed.
    if (!this.bonus && !this.trans && !this.ended && tt > this.bonusNext) {
      this.bonus = this.sc.sky
        ? { t: 0, dur: 4.2, x0: rand(0.45, 0.9), y0: rand(0.2, 0.26), dx: -rand(0.3, 0.4), dy: rand(0.1, 0.16) }
        : { t: 0, dur: 10, x0: rand(0.2, 0.7), y0: 0.92, dx: rand(-0.08, 0.08), dy: -0.72 };
    }
    if (this.bonus) { this.bonus.t += dt; if (this.bonus.t > this.bonus.dur) { this.bonus = null; this.bonusNext = tt + rand(16, 30) * (1.4 - 0.6 * calm); } }
    if (P.boats) for (const b of P.boats) b.near += (near(b.px, b.py, 120) - b.near) * Math.min(1, dt * 3);
    if (P.cat) P.cat.near += (near(P.cat.x * W, P.cat.y * H, 120) - P.cat.near) * Math.min(1, dt * 4);
    if (P.houses) {
      const thr = 0.75 - 0.9 * calm;  // calmer: more windows lit
      for (const h of P.houses) for (const w of h.windows) {
        const on = Math.sin(tt * w.sp + w.ph) > thr ? 1 : 0;
        w.l += (on - w.l) * Math.min(1, dt * 0.8);
      }
    }
    if (P.bubbles) {
      const active = Math.round(8 + 18 * calm);
      P.bubbles.forEach((b, i) => {
        b.y -= b.sp * dt;
        if (b.y < -0.03) { b.y = i < active ? 1.02 : -0.05; if (i < active) b.x = Math.random(); }
      });
      const S = P.school, sx = S.x * W, sy = (S.y + S.dy) * H, n = near(sx, sy, 140);
      S.x += S.vx * dt * (1 + 3 * n);
      if (n > 0) S.dy += (input.y < sy ? 1 : -1) * n * dt * 0.15;  // the little school darts away
      S.dy *= 1 - dt * 0.2;
      if ((S.vx > 0 && S.x > 1.2) || (S.vx < 0 && S.x < -0.2)) { S.vx = -S.vx; S.y = rand(0.3, 0.55); S.dy = 0; }
    }
  },
  updateGuide(dt) {
    const g = this.guide, A = assist.level, L = this.lanternPos();
    let tx = L.x, ty = L.y - L.s * 0.2;
    const k = this.current();
    if (A > 0.02 && k && !this.trans && !this.ended) {
      if (!g.target || g.target.found || g.target.kind !== k.key) {
        let best = null, bd = 1e12;
        for (const o of this.items) {
          if (o.decoy || o.found || o.kind !== k.key) continue;
          const p = sightPos(o, this.drawT), dd = (p[0] - g.x) ** 2 + (p[1] - g.y) ** 2;
          if (dd < bd) { bd = dd; best = o; }
        }
        g.target = best;
      }
      if (g.target) {
        const p = sightPos(g.target, this.drawT), r = this.hitR() * 0.6;
        tx = p[0] + Math.cos(this.tt * 2.4) * r; ty = p[1] + Math.sin(this.tt * 2.4) * r * 0.75;
      }
    } else g.target = null;
    const kk = 1 - Math.exp(-dt * 2.4);
    g.x += (tx - g.x) * kk; g.y += (ty - g.y) * kk;
    g.trail.push(g.x, g.y);
    if (g.trail.length > 28) g.trail.splice(0, 2);
  },
  bonusPos(b) {
    const k = b.t / b.dur;
    if (this.sc.sky) return [(b.x0 + b.dx * k) * W, (b.y0 + b.dy * k) * H];
    return [(b.x0 + b.dx * k) * W + Math.sin(b.t * 1.6) * 14, (b.y0 + b.dy * k) * H];
  },

  hasProgress() { return this.found > 0; },
  finishEarly() { this.finish("Nice finding. The night is a little brighter."); },
  finish(msg) {
    if (this.ended) return;
    this.ended = msg;
    this.uiTick(true);
    endRound("sight", Math.round(this.score), this.meta, msg, `${this.found} found · wave ${this.wave + 1} · best combo ×${this.bestCombo}`);
  },

  // ---------------------------------------------------------------- drawing
  draw(time) {
    this.drawT = time;
    const sc = this.sc, A = assist.level;
    if (sc.key === "harbour") this.drawHarbour(time);
    else if (sc.key === "village") this.drawVillage(time);
    else this.drawUnderSea(time);
    const dim = 0.3 * (1 - world.calm);  // calmer = brighter scene
    if (dim > 0.01) { ctx.fillStyle = `rgba(4,6,20,${dim})`; ctx.fillRect(0, 0, W, H); }
    this.drawConstellation(time);

    const k = this.current();
    let hintO = null;
    if (k && !this.trans) {
      if (A > 0.3 && this.guide.target) hintO = this.guide.target;
      else if (this.kindT > this.hintDelay()) hintO = this.items.find((o) => o.kind === k.key && !o.decoy && !o.found && o.vis > 0.4) || null;
    }
    const base = Math.min(W, H) * 0.012;
    for (const o of this.items) {
      if (o.gone) continue;
      let a = o.alpha, s = base * o.size;
      if (o.decoy) {
        a *= 1 - A;
        if (o.found) a *= Math.max(0, 1 - (this.tt - o.fadeAt) / 1.2);
      } else if (o.found) a = 0.95;
      else { s *= 1 + 0.4 * A; a = lerp(a, 1, A); }
      a = Math.min(1, a + o.near * 0.15) * o.vis;
      let [x, y] = sightPos(o, time);
      if (o.vis < 0.98 && sc.sky && (o.kind === "star" || o.kind === "moon")) {  // a little cloud slides over
        sightGlow(x + (1 - o.vis) * 6, y, s * 5, "#8f97c0", 0.35 * (1 - o.vis));
      }
      if (a <= 0.01) continue;
      const ex = {}, an = o.anim, at = an ? an.t : 0, lit = an ? Math.min(1, at / 0.8) : 0;
      ctx.save();
      if (an) {
        if (an.type === "leap" && at < 1.4) {
          const q = at / 1.4, f = sightFacing(o, time);
          x += q * s * 10 * f; y -= Math.sin(Math.PI * q) * H * 0.07;
          ex.rot = -Math.cos(Math.PI * q) * 0.9 * f; ex.face = f;
        } else if (an.type === "dart" && at < 1.8) {
          const q = at / 1.8, f = sightFacing(o, time);
          x += Math.sin(q * 6.283) * s * 6 * f; y -= (1 - Math.cos(q * 6.283)) * s * 2.5;
          ex.rot = -Math.sin(q * 6.283) * 0.6; ex.face = f;
        } else if (an.type === "wake") {
          const q = Math.min(1, at / 1.3);
          if (o.kind === "owl") ex.hop = Math.sin(Math.PI * q) * s * 2.5;
          else { y -= Math.sin(Math.PI * q) * s * 3; ex.wing = q < 1 ? Math.abs(Math.sin(q * Math.PI * 5)) : 0; }
        } else if (an.type === "glow" && o.kind === "seastar") ex.spin = Math.min(1, at / 1.2) * 6.283 * 0.4;
        // a widening ring of light when found, then a soft golden halo that stays
        if (at < 1.2) {
          const q = at / 1.2;
          ctx.globalAlpha = (1 - q) * 0.7; ctx.strokeStyle = o.k.color; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(x, y, s * (2 + q * 7), 0, 6.29); ctx.stroke();
        }
        ctx.globalAlpha = 0.3; ctx.strokeStyle = "#ffd27a"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, s * 3, 0, 6.29); ctx.stroke();
      }
      // help: unfound targets get a warm halo, very visible when assist is on
      if (!o.decoy && !o.found && A > 0.02) sightGlow(x, y, s * 5.5, "#fff1c0", 0.3 * A * (0.75 + 0.25 * Math.sin(time * 2.5 + o.ph)));
      if (o === hintO) {
        ctx.globalAlpha = 0.3 + 0.25 * Math.sin(time * 3); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, s * 4, 0, 6.29); ctx.stroke();
      }
      sightDrawItem(o, x, y, s, a, time, o.found && !o.decoy ? lit : 0, ex);
      ctx.restore();
    }
    this.drawGuide(time);
    this.drawBonus(time);
    this.drawPops();
    if (this.trans) {
      const t = this.trans.t, m = this.trans.mid, dark = t < m - 1.4 ? 0 : t < m ? (t - m + 1.4) / 1.4 : Math.max(0, 1 - (t - m) / 1.4);
      if (dark > 0) { ctx.globalAlpha = 1; ctx.fillStyle = `rgba(5,8,22,${0.88 * dark})`; ctx.fillRect(0, 0, W, H); }
    }
    this.drawJar(time);
    this.drawMotes(time);
    if (input.has) drawCursor(input.x, input.y, this.dwell ? this.dwell.t / 1.3 : 0);
  },
  drawPops() {  // floating "+12" over each find, and a grey ripple where a mistake landed
    if (!this.pops.length && !this.ripples.length) return;
    ctx.save();
    for (const r of this.ripples) {
      ctx.globalAlpha = 0.5 * (1 - r.t); ctx.strokeStyle = "#b9c0d8"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(r.x, r.y, 10 + r.t * 40, 0, 6.29); ctx.stroke();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const q of this.pops) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (1.1 - q.t) / 0.4));
      ctx.font = `700 ${q.big ? 22 : 17}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = q.big ? "#ffd27a" : "#fff6dc";
      ctx.fillText(q.txt, q.x, q.y - q.t * 34);
    }
    ctx.restore();
  },
  drawConstellation(time) {
    const so = this.starOrder;
    if (!so || so.length < 2) return;
    ctx.save(); ctx.strokeStyle = "#cfe3ff"; ctx.lineWidth = 1.5;
    const pts = so.map((o) => sightPos(o, time));
    for (let i = 1; i < so.length; i++) {
      ctx.globalAlpha = 0.45 * Math.min(1, so[i].anim.t / 1);
      ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
    }
    const total = this.items.filter((o) => o.kind === "star" && !o.decoy).length;
    if (so.length >= 3 && so.length === total) {  // close the shape when the last star is found
      ctx.globalAlpha = 0.45 * Math.min(1, so[so.length - 1].anim.t / 1.5);
      ctx.beginPath(); ctx.moveTo(pts[so.length - 1][0], pts[so.length - 1][1]); ctx.lineTo(pts[0][0], pts[0][1]); ctx.stroke();
    }
    ctx.restore();
  },
  drawGuide(time) {
    const g = this.guide, A = assist.level;
    if (A < 0.02) return;
    const col = flameColor();
    ctx.save();
    for (let i = 0; i < g.trail.length; i += 2) {
      const q = i / g.trail.length;
      sightGlow(g.trail[i], g.trail[i + 1], 4 + 8 * q, col, A * 0.35 * q);
    }
    const p = 0.85 + 0.15 * Math.sin(time * 4);
    sightGlow(g.x, g.y, 26 * p, col, A * 0.9);
    ctx.globalAlpha = A; ctx.fillStyle = "#fffbe8";
    ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, 6.29); ctx.fill();
    const wo = Math.abs(Math.sin(time * 10)) * 5 + 2;
    ctx.globalAlpha = A * 0.5;
    ctx.beginPath(); ctx.ellipse(g.x - 4, g.y - 3, wo, 3, -0.5, 0, 6.29); ctx.ellipse(g.x + 4, g.y - 3, wo, 3, 0.5, 0, 6.29); ctx.fill();
    ctx.restore();
  },
  drawBonus(time) {
    const b = this.bonus;
    if (!b) return;
    const [x, y] = this.bonusPos(b), fade = Math.min(1, b.t / 0.8, (b.dur - b.t) / 0.8);
    ctx.save();
    if (this.sc.sky) {
      const len = Math.hypot(b.dx * W, b.dy * H) || 1, ux = (b.dx * W) / len, uy = (b.dy * H) / len;
      const g = ctx.createLinearGradient(x, y, x - ux * 110, y - uy * 110);
      g.addColorStop(0, "rgba(255,246,210,0.8)"); g.addColorStop(1, "rgba(255,246,210,0)");
      ctx.globalAlpha = fade; ctx.strokeStyle = g; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * 110, y - uy * 110); ctx.stroke();
      sightGlow(x, y, 16, "#fff1c0", fade);
    } else {
      sightGlow(x, y, 22, "#ffe08a", fade * 0.8);
      ctx.globalAlpha = fade; ctx.strokeStyle = "#ffe9a0"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.29); ctx.stroke();
    }
    ctx.globalAlpha = fade; ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 6.29); ctx.fill();
    ctx.restore();
  },
  drawJar(time) {
    const J = this.jarGeom(), { x, y, w, h } = J, n = this.jar.length, gk = Math.min(1, n / 30), A = assist.level;
    const L = this.lanternPos();
    ctx.save();
    drawLantern(L.x, L.y, L.s, 0.8 + 0.4 * A, time);
    sightGlow(x, y, w * (0.8 + 0.5 * gk), "#ffe7a0", 0.1 + 0.35 * gk);
    const top = y - h / 2 + h * 0.12;
    ctx.globalAlpha = 1;
    sightRoundRect(x - w / 2, top, w, h * 0.88, w * 0.28);
    ctx.fillStyle = "rgba(170,195,255,0.08)"; ctx.fill();
    ctx.strokeStyle = "rgba(220,230,255,0.5)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#7a5a3c"; sightRoundRect(x - w * 0.3, y - h / 2, w * 0.6, h * 0.13, 4); ctx.fill();
    for (const l of this.jar) {
      const lx = x + l.rx * w, ly = y + l.ry * h + Math.sin(time * 0.9 + l.ph) * 3;
      sightGlow(lx, ly, 8, l.c, 0.7);
      ctx.globalAlpha = 0.95; ctx.fillStyle = l.c; ctx.beginPath(); ctx.arc(lx, ly, 2, 0, 6.29); ctx.fill();
    }
    ctx.globalAlpha = 0.25; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - w * 0.3, top + h * 0.15); ctx.lineTo(x - w * 0.3, top + h * 0.45); ctx.stroke();
    // the wave number, and one dot per scene in the cycle: done, current (gently pulsing), still to come
    const cyc = this.wave % SIGHT_SCENES.length;
    ctx.globalAlpha = 0.75; ctx.fillStyle = "#fff6dc"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 13px ui-rounded, system-ui, sans-serif"; ctx.fillText(`wave ${this.wave + 1}`, x, y - h / 2 - 28);
    for (let i = 0; i < SIGHT_SCENES.length; i++) {
      const cx = x + (i - 1) * 13, cy = y - h / 2 - 11, done = i < cyc, cur = i === cyc;
      ctx.globalAlpha = done ? 0.95 : cur ? 0.6 + 0.3 * Math.sin(time * 2) : 0.25;
      ctx.fillStyle = done ? "#ffd27a" : "#ffffff";
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 6.29); ctx.fill();
    }
    ctx.restore();
  },
  drawMotes(time) {
    if (!this.motes.length) return;
    const J = this.jarGeom();
    ctx.save();
    for (const m of this.motes) {
      if (m.done || m.t < 0) continue;
      for (let j = 3; j >= 0; j--) {
        const q = clamp((m.t - j * 0.05) / m.dur, 0, 1), e = q * q * (3 - 2 * q), u = 1 - e;
        const cx = (m.x0 + J.x) / 2, cy = Math.min(m.y0, J.y) - H * 0.15;
        const x = u * u * m.x0 + 2 * u * e * cx + e * e * J.x, y = u * u * m.y0 + 2 * u * e * cy + e * e * J.y;
        const r = (m.big ? 14 : 9) * (1 - 0.4 * e) * (1 - j * 0.2);
        sightGlow(x, y, r, m.color, j ? 0.25 : 0.9);
        if (!j) { ctx.globalAlpha = 1; ctx.fillStyle = "#fffef0"; ctx.beginPath(); ctx.arc(x, y, m.big ? 2.6 : 1.8, 0, 6.29); ctx.fill(); }
      }
    }
    ctx.restore();
  },

  // ---- scene backdrops
  drawHarbour(time) {
    const hz = 0.6, calm = world.calm, minD = Math.min(W, H), P = this.props;
    drawSky(time, save.stage / STAGES.length, hz); drawSea(time, hz);
    // a whale far out, surfacing slowly as it passes
    if (this.drift) {
      const q = this.drift.t / this.drift.dur, wx = W * lerp(-0.1, 1.1, this.drift.dir > 0 ? q : 1 - q), wy = H * hz + 3;
      const ws = minD * 0.07, surf = Math.max(0, Math.sin(q * Math.PI * 4));
      ctx.save(); ctx.globalAlpha = 0.75 * Math.min(1, q * 8, (1 - q) * 8); ctx.fillStyle = "#0a0f2a";
      ctx.beginPath(); ctx.ellipse(wx, wy, ws, ws * 0.22 * surf + 1, 0, Math.PI, 2 * Math.PI); ctx.fill();
      if (surf > 0.85) {
        ctx.fillStyle = "#cfe0ff";
        for (let j = 0; j < 4; j++) { ctx.globalAlpha = 0.3 * (1 - j / 4); ctx.beginPath(); ctx.arc(wx + this.drift.dir * ws * 0.3 + Math.sin(j) * 4, wy - ws * 0.25 - j * 7, 2.5 + j, 0, 6.29); ctx.fill(); }
      }
      ctx.restore();
    }
    // lighthouse with a slow sweeping beam (brighter when calm)
    const lx = W * 0.075, by = H * hz, th = Math.min(H * 0.2, W * 0.3), tw = Math.max(14, minD * 0.03), ly = by - th - tw * 0.35;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const ang = -0.12 + 0.28 * Math.sin(time * 0.35), len = W * 0.75, spread = 0.09;
    const bg = ctx.createLinearGradient(lx, ly, lx + Math.cos(ang) * len, ly + Math.sin(ang) * len);
    bg.addColorStop(0, `rgba(255,236,180,${0.1 + 0.14 * calm})`); bg.addColorStop(1, "rgba(255,236,180,0)");
    ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(lx, ly);
    ctx.lineTo(lx + Math.cos(ang - spread) * len, ly + Math.sin(ang - spread) * len);
    ctx.lineTo(lx + Math.cos(ang + spread) * len, ly + Math.sin(ang + spread) * len); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "#121732"; ctx.beginPath(); ctx.ellipse(lx, by + 4, tw * 2.2, tw * 0.7, 0, Math.PI, 2 * Math.PI); ctx.fill();
    const wAt = (f) => lerp(0.6, 0.4, f) * tw;
    ctx.fillStyle = "#3b4066"; ctx.beginPath();
    ctx.moveTo(lx - wAt(0), by); ctx.lineTo(lx - wAt(1), by - th); ctx.lineTo(lx + wAt(1), by - th); ctx.lineTo(lx + wAt(0), by); ctx.fill();
    ctx.fillStyle = "#6a4f6e";
    for (const [f0, f1] of [[0.3, 0.42], [0.62, 0.74]]) {
      ctx.beginPath(); ctx.moveTo(lx - wAt(f0), by - th * f0); ctx.lineTo(lx - wAt(f1), by - th * f1);
      ctx.lineTo(lx + wAt(f1), by - th * f1); ctx.lineTo(lx + wAt(f0), by - th * f0); ctx.fill();
    }
    ctx.fillStyle = "#ffe7a8"; ctx.fillRect(lx - tw * 0.4, by - th - tw * 0.7, tw * 0.8, tw * 0.7);
    ctx.fillStyle = "#2a2e50"; ctx.beginPath(); ctx.moveTo(lx - tw * 0.55, by - th - tw * 0.7); ctx.lineTo(lx, by - th - tw * 1.2); ctx.lineTo(lx + tw * 0.55, by - th - tw * 0.7); ctx.fill();
    sightGlow(lx, ly, tw * 3, "#ffe7a8", 0.45 + 0.3 * calm);
    ctx.restore();
    // boats bobbing; a boat's lamp warms when you look at it
    for (const b of P.boats) {
      const s = minD * 0.035 * b.s, bx = b.x * W + Math.sin(time * 0.08 + b.ph) * W * 0.01, bby = b.y * H + Math.sin(time * 0.9 + b.ph) * 3;
      b.px = bx; b.py = bby - s * 0.4;
      ctx.save(); ctx.translate(bx, bby); ctx.rotate(Math.sin(time * 0.7 + b.ph) * 0.05);
      ctx.fillStyle = "rgba(170,180,230,0.16)"; ctx.beginPath(); ctx.moveTo(s * 0.08, -s * 1.25); ctx.lineTo(s * 0.08, -s * 0.15); ctx.lineTo(s * 0.8, -s * 0.15); ctx.fill();
      ctx.strokeStyle = "rgba(220,215,200,0.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 1.3); ctx.stroke();
      ctx.fillStyle = "#141936"; ctx.strokeStyle = "rgba(185,191,230,0.3)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-s, -s * 0.1); ctx.quadraticCurveTo(-s * 0.7, s * 0.32, 0, s * 0.32); ctx.quadraticCurveTo(s * 0.7, s * 0.32, s, -s * 0.1); ctx.closePath(); ctx.fill(); ctx.stroke();
      sightGlow(-s * 0.6, -s * 0.3, s * (0.5 + 0.7 * b.near), "#ffd27a", 0.35 + 0.25 * calm + 0.4 * b.near);
      ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.12 + 0.2 * b.near; ctx.fillStyle = "#ffd27a";
      ctx.fillRect(bx - s * 0.65, bby + s * 0.4, s * 0.1, s * (0.4 + 0.3 * Math.sin(time * 1.3 + b.ph)));
      ctx.restore();
    }
    // a strip of sand
    ctx.fillStyle = "#2c2a3e"; ctx.beginPath(); ctx.moveTo(0, H * 0.83);
    for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H * 0.82 + Math.sin(x * 0.01) * 8);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  },
  drawVillage(time) {
    const P = this.props, calm = world.calm, ground = H * 0.86, minD = Math.min(W, H);
    drawSky(time, save.stage / STAGES.length, 0.64);
    // a soft cloud drifting across the moon now and then
    if (this.drift) {
      const q = this.drift.t / this.drift.dur, cx = W * lerp(-0.2, 1.2, this.drift.dir > 0 ? q : 1 - q), cy = H * 0.17;
      ctx.save(); ctx.globalAlpha = 0.2 * Math.min(1, q * 6, (1 - q) * 6); ctx.fillStyle = "#c8cfee";
      for (const [dx, dy, r] of [[-1, 0.1, 0.8], [0, -0.2, 1.1], [1.1, 0.1, 0.75], [0.4, 0.3, 0.9]]) {
        ctx.beginPath(); ctx.ellipse(cx + dx * minD * 0.05, cy + dy * minD * 0.05, r * minD * 0.06, r * minD * 0.035, 0, 0, 6.29); ctx.fill();
      }
      ctx.restore();
    }
    ctx.fillStyle = "#151b3e"; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 24) ctx.lineTo(x, H * 0.63 + Math.sin(x * 0.005 + 1) * H * 0.03 + Math.sin(x * 0.013) * H * 0.012);
    ctx.lineTo(W, H); ctx.fill();
    ctx.fillStyle = "#0f1330"; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 24) ctx.lineTo(x, ground - 6 + Math.sin(x * 0.008) * 5);
    ctx.lineTo(W, H); ctx.fill();
    // the big tree
    const T = P.tree, tx = T.x * W, ty = T.y * H;
    ctx.fillStyle = "#1a1426"; ctx.fillRect(tx - minD * 0.012, ty, minD * 0.024, ground - ty);
    ctx.fillStyle = "#17233b";
    for (const [dx, dy, r] of [[-0.45, 0.2, 0.7], [0.45, 0.15, 0.72], [0, -0.25, 0.85], [0, 0.3, 0.7]]) {
      ctx.beginPath(); ctx.arc(tx + dx * T.r + Math.sin(time * 0.5 + dx) * 1.5, ty + dy * T.r, r * T.r, 0, 6.29); ctx.fill();
    }
    // houses, chimney smoke, windows that wake and sleep (calmer = more lights on)
    for (const h of P.houses) {
      const cx = h.x * W, w = h.w * W, hh = h.h * H, top = ground - hh, roof = h.roof * H;
      if (h.chimney) {
        const chx = cx + w * 0.22, cht = top - roof * 0.75;
        ctx.fillStyle = "#1f2344"; ctx.fillRect(chx - w * 0.06, cht, w * 0.12, roof * 0.6);
        ctx.fillStyle = "#c9cfe8";
        for (let i = 0; i < 5; i++) {
          const q = (time * 0.12 + h.smokePh + i / 5) % 1;
          ctx.globalAlpha = (1 - q) * 0.16 * (0.6 + 0.6 * calm);
          ctx.beginPath(); ctx.arc(chx + Math.sin(q * 5 + i) * 8 + q * 14, cht - q * H * 0.12, 4 + q * 12, 0, 6.29); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = mix("#1b2042", "#232848", h.tint); ctx.fillRect(cx - w / 2, top, w, hh);
      ctx.fillStyle = "#282c52"; ctx.beginPath(); ctx.moveTo(cx - w * 0.58, top); ctx.lineTo(cx, top - roof); ctx.lineTo(cx + w * 0.58, top); ctx.fill();
      ctx.fillStyle = "#11142c"; ctx.fillRect(cx - w * 0.08, ground - hh * 0.26, w * 0.16, hh * 0.26);
      for (const s of h.windows) {
        const ww = s.w * W, wh = s.h * H, wx = s.x * W, wy = s.y * H;
        ctx.fillStyle = "#0a0d20"; ctx.fillRect(wx - ww / 2, wy - wh / 2, ww, wh);
        if (s.l > 0.02 && !s.used) {  // a used window holds a hidden thing, which draws itself
          sightGlow(wx, wy, ww * 1.4, "#ffcf6a", s.l * 0.35);
          ctx.globalAlpha = s.l * 0.8; ctx.fillStyle = "#f7c96a"; ctx.fillRect(wx - ww / 2, wy - wh / 2, ww, wh); ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = "#2f3460"; ctx.lineWidth = 2; ctx.strokeRect(wx - ww / 2, wy - wh / 2, ww, wh);
      }
    }
    // a cat sleeping on a roof; its ear twitches and it peeks when you come near
    const C = P.cat, catX = C.x * W, catY = C.y * H, cs = minD * 0.016, n = C.near;
    ctx.save(); ctx.translate(catX, catY);
    ctx.fillStyle = "#0b0d1e"; ctx.strokeStyle = "rgba(150,160,210,0.35)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cs * 1.1, cs * 0.3);
    ctx.quadraticCurveTo(cs * 2.6, cs * 0.4 + Math.sin(time * (0.8 + 2 * n)) * cs * 0.4, cs * 2.4, -cs * 0.8); ctx.lineWidth = cs * 0.35; ctx.strokeStyle = "#0b0d1e"; ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(150,160,210,0.35)";
    ctx.beginPath(); ctx.ellipse(0, 0, cs * 1.4, cs, 0, 0, 6.29); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-cs * 1.1, -cs * 0.8, cs * 0.75, 0, 6.29); ctx.fill(); ctx.stroke();
    const tw = n * 0.3 * Math.sin(time * 9);
    for (const [ex, rot] of [[-1.55, -0.2 + tw], [-0.7, 0.2]]) {
      ctx.save(); ctx.translate(ex * cs, -cs * 1.35); ctx.rotate(rot);
      ctx.beginPath(); ctx.moveTo(-cs * 0.3, cs * 0.15); ctx.lineTo(0, -cs * 0.5); ctx.lineTo(cs * 0.3, cs * 0.15); ctx.fill(); ctx.restore();
    }
    if (n > 0.5) { ctx.fillStyle = "#b8f0a0"; for (const ex of [-1.4, -0.85]) { ctx.beginPath(); ctx.ellipse(ex * cs, -cs * 0.85, cs * 0.12, cs * 0.18 * (n - 0.4), 0, 0, 6.29); ctx.fill(); } }
    else { ctx.strokeStyle = "rgba(190,200,240,0.55)"; ctx.beginPath(); for (const ex of [-1.4, -0.85]) { ctx.moveTo(ex * cs - cs * 0.14, -cs * 0.85); ctx.lineTo(ex * cs + cs * 0.14, -cs * 0.85); } ctx.stroke(); }
    ctx.restore();
  },
  drawUnderSea(time) {
    const P = this.props, calm = world.calm, minD = Math.min(W, H), floor = H * 0.86;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix("#0b2f52", "#18578a", calm * 0.7)); g.addColorStop(0.55, mix("#081c38", "#0d3058", calm * 0.5)); g.addColorStop(1, "#050f22");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // light from the surface
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const x = W * (0.15 + i * 0.24) + Math.sin(time * 0.2 + i * 1.7) * W * 0.03;
      const rg = ctx.createLinearGradient(0, 0, 0, H * 0.8);
      rg.addColorStop(0, `rgba(150,210,255,${0.06 + 0.07 * calm})`); rg.addColorStop(1, "rgba(150,210,255,0)");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(x - W * 0.03, 0); ctx.lineTo(x + W * 0.03, 0);
      ctx.lineTo(x + W * 0.1, H * 0.8); ctx.lineTo(x - W * 0.02, H * 0.8); ctx.fill();
    }
    ctx.restore();
    // a great whale passing far away in the blue
    if (this.drift) {
      const q = this.drift.t / this.drift.dur, f = this.drift.dir, wx = W * lerp(-0.25, 1.25, f > 0 ? q : 1 - q), wy = H * 0.3 + Math.sin(q * 6) * H * 0.02;
      const ws = minD * 0.2;
      ctx.save(); ctx.globalAlpha = 0.22 * Math.min(1, q * 6, (1 - q) * 6); ctx.fillStyle = "#03101f";
      ctx.translate(wx, wy); ctx.scale(f, 1);
      ctx.beginPath(); ctx.ellipse(0, 0, ws, ws * 0.28, 0, 0, 6.29); ctx.fill();
      const tl = Math.sin(time * 0.8) * ws * 0.08;
      ctx.beginPath(); ctx.moveTo(-ws * 0.9, 0); ctx.lineTo(-ws * 1.35, -ws * 0.22 + tl); ctx.lineTo(-ws * 1.25, tl * 0.3); ctx.lineTo(-ws * 1.35, ws * 0.18 + tl); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ws * 0.1, ws * 0.25, ws * 0.3, ws * 0.06, 0.5, 0, 6.29); ctx.fill();
      ctx.restore();
    }
    // a small school of silver fish (they dart away from the cursor)
    const S = P.school;
    ctx.save(); ctx.fillStyle = "#9fb8d8";
    for (const [dx, dy, ph] of S.fish) {
      const fx2 = S.x * W + dx + Math.sin(time * 1.5 + ph) * 4, fy = (S.y + S.dy) * H + dy + Math.sin(time * 2 + ph) * 3, d = S.vx > 0 ? 1 : -1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(fx2, fy, 6, 2.4, 0, 0, 6.29); ctx.fill();
      ctx.beginPath(); ctx.moveTo(fx2 - d * 5, fy); ctx.lineTo(fx2 - d * 9, fy - 3); ctx.lineTo(fx2 - d * 9, fy + 3); ctx.fill();
    }
    ctx.restore();
    // sand, rocks, kelp swaying
    ctx.fillStyle = "#26304c"; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 24) ctx.lineTo(x, floor + Math.sin(x * 0.009 + 0.5) * 7);
    ctx.lineTo(W, H); ctx.fill();
    ctx.fillStyle = "#1a2138";
    for (const r of P.rocks) { ctx.beginPath(); ctx.ellipse(r.x * W, floor + 6, r.r * minD * 1.4, r.r * minD * 0.7, 0, Math.PI, 2 * Math.PI); ctx.fill(); }
    ctx.save(); ctx.lineCap = "round";
    for (const k of P.kelp) {
      const bx = k.x * W, h = k.h * H;
      ctx.strokeStyle = "#1d5a48"; ctx.globalAlpha = 0.85; ctx.lineWidth = k.w;
      ctx.beginPath(); ctx.moveTo(bx, H * 0.97);
      let lx = bx, ly = H * 0.97;
      for (let j = 1; j <= 6; j++) {
        lx = bx + Math.sin(time * 0.6 + k.ph + j * 0.5) * j * 4; ly = H * 0.97 - h * j / 6;
        ctx.lineTo(lx, ly);
      }
      ctx.stroke();
      ctx.fillStyle = "#2a7a5e";
      for (let j = 2; j <= 5; j += 1.5) {
        const yx = bx + Math.sin(time * 0.6 + k.ph + j * 0.5) * j * 4, yy = H * 0.97 - h * j / 6, side = j % 3 < 1.5 ? 1 : -1;
        ctx.beginPath(); ctx.ellipse(yx + side * k.w * 1.3, yy, k.w * 1.5, k.w * 0.5, side * 0.6, 0, 6.29); ctx.fill();
      }
    }
    ctx.restore();
    // bubbles rising (more when calm)
    ctx.save(); ctx.strokeStyle = "rgba(200,235,255,0.4)"; ctx.lineWidth = 1;
    for (const b of P.bubbles) {
      if (b.y < -0.02 || b.y > 1.01) continue;
      const x = b.x * W + Math.sin(time * 1.2 + b.ph) * 5, y = b.y * H;
      ctx.beginPath(); ctx.arc(x, y, b.r, 0, 6.29); ctx.stroke();
    }
    ctx.restore();
  },
};
