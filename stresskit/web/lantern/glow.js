"use strict";
/* Lantern activity: Glow (a breath charges the lighthouse, then you aim its beam). Loaded after the core script
   in game.html and shares its globals (ctx, W, H, link, input, save, CFG, go, endRound, assist, world, voice, sfx, fx, ...).

   The skin sensor can't see slow breathing; it can only see one big quick inhale, as a skin response that
   peaks 1-13 s later. So each breath is: a big quick breath in (cued, so the server tags the response), then
   a long slow breath out that is only guided visually. Nothing moves on the sea while you breathe, and the game
   never gives up on the breath: no response in the cue window means a gentle "once more" and a new cue, as often
   as it takes, and with no skin contact it waits for the hand before asking again. Only Finish leaves early.
   A seen breath charges the lighthouse, its beam reveals something new, and then the player aims the beam: hold
   the light on boats, ducklings, fireflies, a whale, shooting stars or a rare golden fish until a ring fills to
   guide it home. Quick catches build a chain (up to x6); light resting on empty water lets it cool. Each breath
   makes the sea busier; challengeFactor() and the helping hand slow it all down. Between breaths the lantern says
   a kind word for the player to say back (as in the Kind words scene), and each one said adds a star. */

// ---- small drawing helpers (all names prefixed glow*, every lantern file shares one global scope)

const glowSprites = new Map();
function glowSprite(rgb) {  // a soft round blob, cached per colour; drawImage is far cheaper than a gradient
  const key = rgb.join(",");
  let c = glowSprites.get(key);
  if (c) return c;
  c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, `rgba(${key},1)`); r.addColorStop(0.3, `rgba(${key},.5)`); r.addColorStop(1, `rgba(${key},0)`);
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  glowSprites.set(key, c);
  return c;
}
function glowBlob(x, y, r, rgb, a) {
  if (a <= 0.003 || r <= 0) return;
  ctx.globalAlpha = Math.min(1, a); ctx.drawImage(glowSprite(rgb), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1;
}
const glowRgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(a, 0, 1).toFixed(3)})`;
const glowLerpRGB = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], k)));
const glowQ = (k) => Math.round(clamp(k, 0, 1) * 4) / 4;  // quantised, so tinted sprites stay few
const glowEase = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function glowHex(h) {
  if (typeof h !== "string" || h.length < 7) return [255, 199, 107];
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const GLOW_BEAM = [255, 238, 200], GLOW_BEAM_WARM = [255, 186, 110];
const GLOW_MIST = [205, 222, 255], GLOW_MIST_WARM = [255, 214, 170];
const GLOW_RING = [255, 196, 130];

// ---- what the lighthouse beam finds, one per breath (positions are fractions of the screen)

const GLOW_REVEALS = [
  { x: 0.74, y: 0.735, got: "A whale is surfacing to say hello.",
    rest: "Watch the whale breathe out its little spout." },
  { x: 0.40, y: 0.615, got: "A ship, with warm lit windows.",
    rest: "Someone on the ship has left a lamp on for you." },
  { x: 0.87, y: 0.62, got: "A little island, with a glowing tree.",
    rest: "Fireflies are visiting the glowing tree." },
  { x: 0.30, y: 0.87, got: "The sea is blooming with jellyfish lights.",
    rest: "The jellyfish drift slowly. No hurry at all." },
  { x: 0.72, y: 0.615, got: "The far shore. A whole village, lit up for you.",
    rest: "" },
];
const GLOW_VOICE = { 0: "You lit the lighthouse!", 2: "Look at everything you've found.", 4: "The whole sea is glowing now." };
const GLOW_SAY = { in: "Take a deep breath in.", again: "Big breath in.", out: "And slowly out.", heard: "The lighthouse heard you." };
const GLOW_FEEL = "Rest your fingers in the straps. I'll wait for you.";
const GLOW_KW_AGAIN = "Take your time. Say it whenever you're ready.";

// ---- waiting for the breath: the skin's answer to a cued breath may peak up to GLOW_CUE_S later
const GLOW_CUE_S = 14;  // late responders often peak 10-13 s after the breath
const GLOW_RETRY = [  // [heading, prompt, spoken], taken in turn for as many tries as it takes
  ["Let's try that once more", "Whenever you're ready: one big, quick breath in through your nose, like smelling a flower.",
    "Let's try once more. Nice and big."],
  ["Take your time", "Let your shoulders drop, then fill your lungs all the way up. The lighthouse is listening.",
    "Take your time. Fill your lungs all the way."],
  ["One more, nice and deep", "Some breaths are too quiet to feel. Sit up tall and take the biggest breath you can.",
    "A big, deep one. You're doing fine."],
  ["The lighthouse is still listening", "Breathe in quick and full, as if you were about to dive under the water.",
    "Whenever you're ready. Big breath in."],
];
// the skin sensor can see a breath only with steady contact
const glowFeels = () => !!(link.connected && link.state && link.state.contact && link.state.signal === "ok");

const glowRnd = seeded(7331);
const GLOW_STARS = Array.from({ length: 110 }, () => ({ x: glowRnd(), y: glowRnd() * 0.55, r: 0.5 + glowRnd(), ph: glowRnd() * 6.28, sp: 0.3 + glowRnd() * 0.8 }));
const GLOW_SHORE_LIGHTS = Array.from({ length: 20 }, (_, i) => ({ xf: 0.48 + 0.5 * (i + glowRnd() * 0.8) / 20, yk: 0.15 + glowRnd() * 0.6, ph: glowRnd() * 6.28 }));
const GLOW_JELLY_COLS = [[255, 150, 210], [150, 220, 255], [190, 165, 255], [140, 255, 220]];
const GLOW_JELLIES = Array.from({ length: 6 }, (_, i) => ({ xf: 0.08 + i * 0.07 + glowRnd() * 0.04, yf: 0.8 + glowRnd() * 0.12, r: 0.022 + glowRnd() * 0.016, ph: glowRnd() * 6.28, col: GLOW_JELLY_COLS[i % 4] }));
const GLOW_BLOOM = Array.from({ length: 40 }, () => ({ xf: 0.03 + glowRnd() * 0.55, yf: 0.76 + glowRnd() * 0.22, ph: glowRnd() * 6.28, sp: 0.4 + glowRnd() }));
const GLOW_LEAVES = Array.from({ length: 14 }, () => ({ dx: (glowRnd() - 0.5) * 0.8, dy: (glowRnd() - 0.5) * 0.5, ph: glowRnd() * 6.28 }));

function glowGeo() {
  const s = Math.min(W, H), hz = H * 0.62, cliffTop = H * 0.5, towerH = Math.min(H * 0.2, s * 0.36);
  const lhX = W * 0.13, topY = cliffTop - towerH;
  return { s, hz, cliffTop, towerH, lhX, topY, lampY: topY - s * 0.031, lanX: W * 0.5, lanY: H * 0.44, lanSize: s * 0.1 };
}
const glowShoreH = (xf) => 0.016 + 0.01 * Math.sin(xf * 19) + 0.006 * Math.sin(xf * 47 + 1.3);  // hill height, in H
const glowShoreEnv = (xf) => clamp((xf - 0.44) / 0.07, 0, 1);

// ---- the revealed things (each in two passes where they sit on the horizon: object, then reflection)

function glowDrawShore(g, a, raw, time) {
  const N = GLOW_SHORE_LIGHTS.length, px = Math.max(1.5, g.s / 400);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.save(); ctx.translate(W * 0.73, g.hz); ctx.scale(1, 0.22); glowBlob(0, 0, W * 0.32, [255, 170, 110], 0.22 * a); ctx.restore();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = glowRgba([13, 18, 44], a);
  ctx.beginPath(); ctx.moveTo(W * 0.44, g.hz + 2);
  for (let xf = 0.44; xf <= 1.03; xf += 0.015) ctx.lineTo(xf * W, g.hz - H * glowShoreH(xf) * glowShoreEnv(xf));
  ctx.lineTo(W * 1.03, g.hz + 2); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < N; i++) {
    const L = GLOW_SHORE_LIGHTS[i], on = clamp((raw * 1.7 - i / N) * 4, 0, 1) * a;  // windows light up left to right
    if (on <= 0.01) continue;
    const x = L.xf * W, y = g.hz - H * glowShoreH(L.xf) * glowShoreEnv(L.xf) * L.yk, f = 0.85 + 0.15 * Math.sin(time * 0.5 + L.ph);
    ctx.fillStyle = glowRgba([255, 214, 130], on * f); ctx.fillRect(x - px / 2, y - px / 2, px, px);
    glowBlob(x, y, g.s * 0.014, [255, 190, 110], 0.5 * on * f);
  }
  ctx.restore();
}
function glowDrawShoreRefl(g, a, raw, time) {
  const N = GLOW_SHORE_LIGHTS.length;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < N; i += 2) {
    const L = GLOW_SHORE_LIGHTS[i], on = clamp((raw * 1.7 - i / N) * 4, 0, 1) * a;
    if (on <= 0.01) continue;
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = glowRgba([255, 200, 120], on * 0.3 * (1 - j / 3));
      ctx.fillRect(L.xf * W - 1 + Math.sin(time * 1.4 + i + j) * 1.5, g.hz + 3 + j * 5, 2, 3);
    }
  }
  ctx.restore();
}

function glowShipPos(g, time) {
  const s = g.s * 0.085;
  return { s, x: W * 0.4 + Math.sin(time * 0.04) * W * 0.015, y: g.hz + s * 0.04 + Math.sin(time * 0.8) * s * 0.02 };
}
function glowShipWindows(p) {
  const { x, y, s } = p, w = [];
  for (let j = 0; j < 3; j++) w.push([x - s * 0.36 + j * s * 0.18, y - s * 0.29]);
  for (let j = 0; j < 4; j++) w.push([x - s * 0.6 + j * s * 0.4, y - s * 0.1]);
  return w;
}
function glowDrawShip(g, a, time) {
  const p = glowShipPos(g, time), { x, y, s } = p;
  ctx.save();
  ctx.fillStyle = glowRgba([12, 16, 36], a);
  ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.2); ctx.lineTo(x + s * 1.05, y - s * 0.24);
  ctx.lineTo(x + s * 0.8, y + s * 0.06); ctx.lineTo(x - s * 0.8, y + s * 0.06); ctx.closePath(); ctx.fill();
  ctx.fillRect(x - s * 0.45, y - s * 0.36, s * 0.62, s * 0.17);
  ctx.strokeStyle = glowRgba([40, 46, 84], a); ctx.lineWidth = Math.max(1.5, s * 0.03);
  ctx.beginPath(); ctx.moveTo(x - s * 0.2, y - s * 0.36); ctx.lineTo(x - s * 0.2, y - s * 1.2);
  ctx.moveTo(x + s * 0.45, y - s * 0.24); ctx.lineTo(x + s * 0.45, y - s * 0.95); ctx.stroke();
  ctx.fillStyle = glowRgba([190, 200, 235], 0.3 * a);
  ctx.beginPath(); ctx.moveTo(x - s * 0.17, y - s * 1.15); ctx.lineTo(x - s * 0.17, y - s * 0.45); ctx.lineTo(x + s * 0.36, y - s * 0.5); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + s * 0.48, y - s * 0.9); ctx.lineTo(x + s * 0.48, y - s * 0.32); ctx.lineTo(x + s * 0.85, y - s * 0.34); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  glowShipWindows(p).forEach(([wx, wy], j) => {
    const f = a * (0.85 + 0.15 * Math.sin(time * 0.6 + j));
    ctx.fillStyle = glowRgba([255, 214, 130], f); ctx.fillRect(wx - s * 0.035, wy - s * 0.03, s * 0.07, s * 0.06);
    glowBlob(wx, wy, s * 0.16, [255, 190, 110], 0.4 * f);
  });
  glowBlob(x - s * 0.2, y - s * 1.24, s * 0.14, [255, 220, 150], 0.7 * a * (0.8 + 0.2 * Math.sin(time * 0.9)));
  ctx.restore();
}
function glowDrawShipRefl(g, a, time) {
  const p = glowShipPos(g, time);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  glowShipWindows(p).forEach(([wx], j) => {
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = glowRgba([255, 200, 120], a * 0.32 * (1 - k / 4));
      ctx.fillRect(wx - 1.5 + Math.sin(time * 1.6 + j + k) * 2, g.hz + 4 + k * 5, 3, 3);
    }
  });
  ctx.restore();
}

function glowDrawIsland(g, a, time) {
  const s = g.s * 0.11, x = W * 0.87, y = g.hz, cx = x + s * 0.02, cy = y - s * 0.78;
  ctx.save();
  ctx.fillStyle = glowRgba([10, 16, 38], a);
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.06, s * 0.95, s * 0.26, 0, 0, 6.29); ctx.fill();
  ctx.strokeStyle = glowRgba([46, 38, 66], a); ctx.lineWidth = Math.max(2, s * 0.07); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x - s * 0.05, y - s * 0.15); ctx.quadraticCurveTo(x + s * 0.12, y - s * 0.42, cx, cy + s * 0.12); ctx.stroke();
  ctx.globalCompositeOperation = "lighter";
  const crown = [[0, 0, 0.45], [-0.3, 0.1, 0.32], [0.3, 0.08, 0.32], [-0.13, -0.22, 0.3], [0.17, -0.2, 0.3]];
  crown.forEach(([dx, dy, r], j) => glowBlob(cx + dx * s, cy + dy * s, r * s * 1.6, [140, 255, 210], a * (0.4 + 0.12 * Math.sin(time * 0.6 + j))));
  for (const L of GLOW_LEAVES) {
    ctx.fillStyle = glowRgba([210, 255, 235], a * (0.55 + 0.35 * Math.sin(time * 0.8 + L.ph)));
    ctx.beginPath(); ctx.arc(cx + L.dx * s, cy + L.dy * s, Math.max(1.2, s * 0.03), 0, 6.29); ctx.fill();
  }
  for (let j = 0; j < 6; j++) {
    const fx_ = cx + Math.cos(time * 0.3 * (1 + j * 0.12) + j * 2.1) * s * 0.9, fy = cy + Math.sin(time * 0.45 + j * 1.3) * s * 0.5;
    glowBlob(fx_, fy, s * 0.09, [230, 255, 160], a * (0.5 + 0.5 * Math.sin(time * 1.2 + j * 1.7)));
  }
  ctx.restore();
}
function glowDrawIslandRefl(g, a) {
  const s = g.s * 0.11;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  ctx.translate(W * 0.87, g.hz + s * 0.4); ctx.scale(1, 0.35); glowBlob(0, 0, s * 1.1, [140, 255, 210], 0.22 * a);
  ctx.restore();
}

function glowDrawJellies(g, a, time) {
  const s = g.s;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#8ff7ff";
  for (const d of GLOW_BLOOM) {
    ctx.globalAlpha = a * 0.7 * (0.5 + 0.5 * Math.sin(time * d.sp + d.ph));
    ctx.fillRect(d.xf * W, d.yf * H, 2, 2);
  }
  ctx.globalAlpha = 1;
  for (const J of GLOW_JELLIES) {
    const x = J.xf * W + Math.sin(time * 0.13 + J.ph) * s * 0.03, y = J.yf * H + Math.sin(time * 0.35 + J.ph) * H * 0.012;
    const r = J.r * s, p = 0.5 + 0.5 * Math.sin(time * 1.0 + J.ph);
    glowBlob(x, y, r * 2.8, J.col, 0.35 * a);
    ctx.fillStyle = glowRgba(J.col, 0.5 * a);
    ctx.beginPath(); ctx.ellipse(x, y, r * (1 + 0.1 * p), r * (0.75 - 0.12 * p), 0, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = glowRgba(J.col, 0.38 * a); ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let t = 0; t < 4; t++) {
      const tx = x + (t - 1.5) * r * 0.42;
      ctx.moveTo(tx, y);
      ctx.quadraticCurveTo(tx + Math.sin(time * 0.9 + t + J.ph) * r * 0.5, y + r * 0.9, tx + Math.sin(time * 0.7 + t) * r * 0.3, y + r * (1.6 + 0.3 * p));
    }
    ctx.stroke();
  }
  ctx.restore();
}

function glowDrawWhale(g, a, time) {
  const s = g.s * 0.16, x = W * 0.74, y0 = H * 0.735;
  const rise = 0.5 - 0.5 * Math.cos(((time % 16) / 16) * 6.283);  // surfaces and settles every 16 s
  const by = y0 + s * 0.24 - rise * s * 0.16;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.save(); ctx.translate(x, y0); ctx.scale(1, 0.3); glowBlob(0, 0, s * 1.3, [120, 170, 255], 0.2 * a); ctx.restore();
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const k = (time * 0.12 + i / 3) % 1, rr = s * (0.8 + k * 0.9);
    ctx.strokeStyle = glowRgba([180, 210, 255], 0.3 * a * (1 - k));
    ctx.beginPath(); ctx.ellipse(x, y0, rr, rr * 0.16, 0, 0, 6.29); ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.save(); ctx.beginPath(); ctx.rect(x - s * 2, y0 - s * 1.2, s * 4, s * 1.2); ctx.clip();
  ctx.fillStyle = glowRgba([11, 18, 48], a); ctx.strokeStyle = glowRgba([175, 208, 255], 0.6 * a); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(x, by, s * 0.75, s * 0.26, 0, 0, 6.29); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s * 0.18, by - s * 0.22); ctx.quadraticCurveTo(x + s * 0.32, by - s * 0.42, x + s * 0.42, by - s * 0.2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  const sp = clamp((rise - 0.7) / 0.3, 0, 1);  // a gentle spout at the top of each rise
  if (sp > 0) {
    ctx.globalCompositeOperation = "lighter";
    const hx = x - s * 0.3, hy = by - s * 0.25;
    for (let i = 0; i < 14; i++) {
      const p = (time * 0.7 + i / 14) % 1, side = i % 2 ? 1 : -1;
      glowBlob(hx + side * (i / 14) * s * 0.35 * p, hy - s * 0.85 * p * (2 - p) + s * 0.2 * p * p, s * 0.06, [200, 225, 255], a * sp * (1 - p) * 0.8);
    }
  }
  ctx.restore();
}

// ---- the lighthouse on its rock, and its beam

function glowDrawLighthouse(g, I, ign, prime) {
  const { s, hz, cliffTop: ct, lhX: bx, towerH, topY } = g;
  ctx.save();
  const cg = ctx.createLinearGradient(0, ct, 0, hz + H * 0.08);
  cg.addColorStop(0, "#151b3c"); cg.addColorStop(1, "#070a1c");
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.moveTo(-5, hz + H * 0.075); ctx.lineTo(-5, ct - s * 0.01);
  ctx.quadraticCurveTo(W * 0.06, ct - s * 0.025, W * 0.19, ct + s * 0.01);
  ctx.lineTo(W * 0.24, ct + (hz - ct) * 0.5); ctx.lineTo(W * 0.3, hz + H * 0.03); ctx.lineTo(W * 0.33, hz + H * 0.06);
  ctx.quadraticCurveTo(W * 0.15, hz + H * 0.085, -5, hz + H * 0.075); ctx.closePath(); ctx.fill();
  if (I > 0.02) {  // the lamp lights the rock's edge
    ctx.strokeStyle = glowRgba([255, 220, 170], 0.25 * I); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-5, ct - s * 0.01); ctx.quadraticCurveTo(W * 0.06, ct - s * 0.025, W * 0.19, ct + s * 0.01);
    ctx.lineTo(W * 0.24, ct + (hz - ct) * 0.5); ctx.stroke();
  }
  const wb = s * 0.075, wt = s * 0.05, lit = clamp(I, 0, 1);
  const light = mix("#2c3358", "#e8e0d0", 0.12 + 0.55 * lit), dark = mix("#20243f", "#9a4a4a", 0.1 + 0.5 * lit);
  for (let j = 0; j < 5; j++) {
    const y0 = ct - towerH * j / 5, y1 = ct - towerH * (j + 1) / 5;
    const w0 = lerp(wb, wt, j / 5) / 2, w1 = lerp(wb, wt, (j + 1) / 5) / 2;
    ctx.fillStyle = j % 2 ? dark : light;
    ctx.beginPath(); ctx.moveTo(bx - w0, y0 + 1); ctx.lineTo(bx + w0, y0 + 1); ctx.lineTo(bx + w1, y1); ctx.lineTo(bx - w1, y1); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "#11152c";
  ctx.fillRect(bx - wt * 0.8, topY - s * 0.012, wt * 1.6, s * 0.012);
  ctx.fillStyle = mix("#1b2242", "#fff1c8", clamp(I + ign * 0.5 + prime * 0.5, 0, 1));
  ctx.fillRect(bx - wt * 0.38, topY - s * 0.05, wt * 0.76, s * 0.038);
  ctx.fillStyle = "#11152c";
  ctx.beginPath(); ctx.moveTo(bx - wt * 0.52, topY - s * 0.05); ctx.lineTo(bx + wt * 0.52, topY - s * 0.05); ctx.lineTo(bx, topY - s * 0.082); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// spot > 0: the aimed beam of the play phase, whose round pool of light is exactly where it catches things
function glowDrawBeam(g, px, py, I, ign, prime, col, spot = 0) {
  const lx = g.lhX, ly = g.lampY;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  if (I > 0.01) {
    const dx = px - lx, dy = py - ly, len = Math.max(1, Math.hypot(dx, dy)), nx = -dy / len, ny = dx / len;
    const spread = spot ? spot : g.s * 0.07 + len * 0.1, w0 = g.s * 0.012;
    const gr = ctx.createLinearGradient(lx, ly, px, py);
    gr.addColorStop(0, glowRgba(col, 0.42 * I)); gr.addColorStop(1, glowRgba(col, (spot ? 0.12 : 0.06) * I));
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.moveTo(lx + nx * w0, ly + ny * w0); ctx.lineTo(px + nx * spread, py + ny * spread);
    ctx.lineTo(px - nx * spread, py - ny * spread); ctx.lineTo(lx - nx * w0, ly - ny * w0); ctx.closePath(); ctx.fill();
    if (spot) glowBlob(px, py, spot * 1.7, col, 0.5 * I);
    else { ctx.save(); ctx.translate(px, py); ctx.scale(1, 0.3); glowBlob(0, 0, spread * 1.5, col, 0.4 * I); ctx.restore(); }
  }
  const ga = clamp(0.5 * I + 0.7 * ign + 0.4 * prime, 0, 1);
  glowBlob(lx, ly, g.s * (0.07 + 0.12 * I + 0.25 * ign + 0.04 * prime), col, ga);
  ctx.restore();
}

// ---- the beam game: things adrift in the dark, guided home by holding the light on them

// val: points before the chain multiplier; lock: seconds of steady light to rescue one
const GLOW_KINDS = {
  boat: { val: 1, lock: 0.6, fx: "#ffd9a0" }, duck: { val: 1, lock: 0.5, fx: "#ffe58a" },
  fly: { val: 2, lock: 0.5, fx: "#e6ff9a" }, whale: { val: 3, lock: 0.7, fx: "#bcd6ff" },
  star: { val: 4, lock: 0.4, fx: "#fffbe6" }, fish: { val: 6, lock: 0.45, fx: "#ffd34d" },
};
const GLOW_MILESTONES = [[40, "The sea is busy tonight…"], [120, "Every boat is finding its way home."],
  [250, "The whole coast can see your light."], [450, "A true keeper of the light."], [700, "Sailors will tell stories about tonight."]];
const GLOW_CHAIN_LINES = { 3: "A chain of light!", 6: "Times six. The light is flowing." };
const GLOW_CHARGE_FULL = 12;

function glowPos(t) {
  const a = t.age;
  t.x = t.x0 + t.vx * a + t.ax * Math.sin(t.wx * a + t.ph);
  t.y = t.y0 + t.vy * a + t.ay * Math.sin(t.wy * a + t.ph * 1.7) - (t.jump ? t.jump * Math.sin(Math.PI * clamp(a / t.life, 0, 1)) : 0);
}

function glowDrawTarget(t, g, time) {
  const a = t.alpha * t.v;
  if (a <= 0.01) return;
  const { x, y, r } = t, li = t.saved ? 1 : Math.max(t.inB ? 0.6 : 0, t.lock);
  if (t.kind === "boat") {
    glowBlob(x, y - r * 0.3, r * 1.7, [120, 150, 230], a * 0.16);
    ctx.fillStyle = glowRgba([18, 24, 56], a);
    ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.18); ctx.lineTo(x + r, y - r * 0.18); ctx.lineTo(x + r * 0.68, y + r * 0.16);
    ctx.lineTo(x - r * 0.72, y + r * 0.16); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = glowRgba([70, 80, 120], a); ctx.lineWidth = Math.max(1.2, r * 0.05);
    ctx.beginPath(); ctx.moveTo(x + r * 0.05, y - r * 0.18); ctx.lineTo(x + r * 0.05, y - r * 1.1); ctx.stroke();
    ctx.fillStyle = glowRgba(glowLerpRGB([70, 80, 125], [255, 236, 200], glowQ(li)), a * 0.8);
    ctx.beginPath(); ctx.moveTo(x + r * 0.12, y - r * 1.05); ctx.lineTo(x + r * 0.12, y - r * 0.3); ctx.lineTo(x + r * 0.72, y - r * 0.32); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    glowBlob(x - r * 0.5, y - r * 0.38, r * (0.35 + 0.55 * li), [255, 190, 110], a * (0.35 + 0.6 * li));
    ctx.restore();
  } else if (t.kind === "duck") {
    const dir = t.vx < 0 ? -1 : 1, col = glowLerpRGB([72, 78, 112], [255, 226, 130], glowQ(li));
    glowBlob(x, y, r * 2.3, [255, 226, 150], a * (0.16 + 0.4 * li));
    ctx.fillStyle = glowRgba(col, a);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.62, 0, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.arc(x + dir * r * 0.72, y - r * 0.6, r * 0.42, 0, 6.29); ctx.fill();
    ctx.fillStyle = glowRgba([255, 150, 70], a * (0.4 + 0.6 * li)); ctx.fillRect(x + dir * r * 1.05 - r * 0.15, y - r * 0.62, r * 0.3, r * 0.16);
  } else if (t.kind === "fly") {
    const p = 0.5 + 0.5 * Math.sin(time * 3 + t.ph * 5);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    glowBlob(x, y, r * 3, [210, 255, 140], a * (0.3 + 0.4 * p + 0.3 * li));
    ctx.restore();
    ctx.fillStyle = glowRgba([245, 255, 205], a); ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  } else if (t.kind === "whale") {
    const e = Math.sin(Math.PI * clamp(t.age / t.life, 0, 1)), h = r * 0.34 * e + 1;
    ctx.strokeStyle = glowRgba([175, 208, 255], a * (0.25 + 0.3 * li)); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(x, y, r * (1.2 + 0.3 * e), r * 0.2, 0, 0, 6.29); ctx.stroke();
    ctx.fillStyle = glowRgba([12, 20, 52], a); ctx.strokeStyle = glowRgba([175, 208, 255], a * (0.5 + 0.5 * li)); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y, r, h, 0, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (e > 0.55) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++) {
        const p = (time * 0.9 + i / 6) % 1;
        glowBlob(x - r * 0.3 + (i % 2 ? 1 : -1) * p * r * 0.25, y - h - r * 0.7 * p * (2 - p), r * 0.08, [200, 225, 255], a * (e - 0.5) * 2 * (1 - p));
      }
      ctx.restore();
    }
  } else if (t.kind === "star") {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = glowRgba([255, 250, 230], a * 0.6); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - t.vx * 0.3, y - t.vy * 0.3); ctx.lineTo(x, y); ctx.stroke();
    glowBlob(x, y, r * 2.4, [255, 250, 220], a);
    ctx.restore();
  } else if (t.kind === "fish") {
    const dy = -t.jump * Math.PI / t.life * Math.cos(Math.PI * clamp(t.age / t.life, 0, 1));
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, t.vx) + (t.vx < 0 ? Math.PI : 0)); if (t.vx < 0) ctx.scale(-1, 1);
    ctx.fillStyle = glowRgba([255, 205, 80], a);
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.45, 0, 0, 6.29); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r * 1.5, -r * 0.5); ctx.lineTo(-r * 1.5, r * 0.5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = "lighter"; glowBlob(x, y, r * 2.6, [255, 200, 80], a * (0.45 + 0.4 * li)); ctx.restore();
  }
}

// ---- the activity

const Glow = {
  allowComfort: false, act: "glow",
  assistLine: "Let's slow down together. Just breathe with the light.",
  enter(meta) {
    this.meta = meta; this.n = 0; this.total = 6; this.score = 0; this.ended = null;
    this.phase = "intro"; this.pt = 0; this.flare = 0; this.got = false; this.cueAt = null; this.tries = 0; this.feltFor = 0;
    this.kwList = KIND_BUILTIN.slice().sort(() => Math.random() - 0.5); this.kwI = 0; this.kw = null;
    this.exDur = 6; this.half = false; this.restMode = null;
    this.rev = [0, 0, 0, 0, 0]; this.revTarget = [0, 0, 0, 0, 0]; this.revOn = [false, false, false, false, false];
    this.revealIdx = null; this.revealDur = 0; this.beamX = W * 0.3; this.beamY = H * 0.7; this.beamI = 0; this.beamFrom = null;
    this.ignite = 0; this.ringA = 0; this.mist = []; this.mistAcc = 0;
    // the beam game
    this.tg = []; this.fog = []; this.floaters = []; this.charge = 0; this.chargeMax = GLOW_CHARGE_FULL;
    this.heat = 0; this.idle = 0; this.since = 0; this.caught = 0; this.bt = 0; this.spawnT = 0; this.diff = 0; this.promptClear = 0;
    this.mi = 0; this.bestSaid = false; this.chainSaid = {}; this.voiceAt = -1e9; this.pillKey = "";
    this.best0 = (save.best && save.best.glow) || 0;
    setUI(`${topBar(`<span class="pill">✨ Glow <b id="gsc">0</b></span><span class="pill" id="gch">chain ×1</span>` +
      `<span class="pill" id="gbe">best ${this.best0}</span><button class="btn" id="finish" style="min-height:44px;padding:0 18px">Finish</button>`)}<div class="spacer"></div>
      <div class="prompt fade-in" id="gp"></div><div class="row" id="gkw"></div><div class="spacer" style="flex:.35"></div>`);
    wireGear();
    this.off = (m) => {
      if (m.type === "scr" && m.cued && this.cueAt != null && !this.got) { this.got = true; this.flare = 1; sfx.chime(4, 0.07); }
    };
    link.on(this.off);
    wireFinish(this);
    this.say("Light the lighthouse", "When the lantern asks, take one big, quick breath in. It charges the lighthouse, then you aim its beam to guide things home.");
    speech.warm([...Object.values(GLOW_SAY), ...GLOW_RETRY.map((L) => L[2]), GLOW_FEEL, ...Object.values(GLOW_VOICE),
      ...this.kwList.slice(0, this.total - 1), ...KIND_PRAISE, GLOW_KW_AGAIN]);
  },
  exit() { const i = link.handlers.indexOf(this.off); if (i >= 0) link.handlers.splice(i, 1); this.cueAt = null; this.kw = null; ear.release(); },
  say(h, p) { const el = $("#gp"); if (el) el.innerHTML = h ? `<h2>${h}</h2><p>${p}</p>` : ""; },
  to(phase, h, p) { this.phase = phase; this.pt = 0; if (h) this.say(h, p); },
  speak(text, force) {  // the voice bubble, without lines tripping over each other
    if (!force && clock() - this.voiceAt < 3) return false;
    voice.say(text, 3.5); this.voiceAt = clock(); return true;
  },
  mult() { return 1 + Math.min(5, Math.floor(this.heat)); },
  spotR() { return glowGeo().s * 0.07 * (1 + 0.12 * assist.level); },

  update(dt) {
    this.stepWorld(dt);
    this.stepTargets(dt);
    if (this.ended) return;
    this.pt += dt * timeScale();
    const P = this.phase, lv = assist.level;
    if (P === "intro" && this.pt > 6) this.toReady();
    else if (P === "ready" && this.pt > (this.tries ? 2 : 3)) this.startBreath();
    else if (P === "in" && this.pt > 1.6) {
      this.exDur = 6 + 2 * lv; this.half = false; this.outSaid = false;
      this.to("out", "…and let it all out, slowly", lv > 0.3 ? "Slower still. Let the mist drift out over the water." : "Long and gentle, like fogging up a window.");
    } else if (P === "out") {
      if (!this.outSaid && (!speech.speaking || this.pt > 1.5)) { this.outSaid = true; this.speak(GLOW_SAY.out, true); }  // after the breath-in line
      if (!this.half && this.pt > this.exDur * 0.5) { this.half = true; this.say("Keep going…", "All the way out. Your breath carries the light to the lighthouse."); }
      if (this.pt > this.exDur + 1) {
        if (this.got) this.scoreBreath();
        else this.to("listen", "Breathe normally", "The lighthouse is listening for your breath…");
      }
    } else if (P === "listen") {  // the skin answers 1-13 s after a big breath; until then, wait
      if (this.got) this.scoreBreath();
      else if (clock() - this.cueAt > GLOW_CUE_S + 0.5) this.retry();
    } else if (P === "again" && this.pt > 4.5) this.toReady();
    else if (P === "feel") {  // no skin contact: wait for the hand, however long it takes, then ask again
      this.feltFor = glowFeels() ? this.feltFor + dt : 0;
      if (this.feltFor > 2) this.toReady();
    } else if (P === "kind") {
      const kw = this.kw;
      if (kw && kw.state === "listen" && !kw.again && clock() - kw.since > 9 && !ear.talking && !ear.busy) this.kwAgain();
    } else if (P === "reveal") {
      if (this.revealIdx != null && !this.revOn[this.revealIdx] && this.pt > 2) this.revOn[this.revealIdx] = true;
      if (this.pt > this.revealDur) this.toBeam();
    } else if (P === "beam") this.beamStep(dt);
    else if (P === "rest") {
      if (this.pt > 3 + 6 * lv) this.toReady();  // stress lengthens the rest between breaths
      else this.restText();
    }
    if (!this.ended) this.pills();
  },
  toReady() {
    this.to("ready", "Get ready…", `Breath ${this.n + 1} of ${this.total}. ` +
      (this.tries ? "Here comes the light again." : this.n === 0 ? "The lighthouse is still dark. Let's wake it up." : "Charge the light again."));
  },
  startBreath() {
    if (!glowFeels()) {
      this.feltFor = 0;
      this.to("feel", "Rest your fingers in the straps", "The lantern needs to feel your hand to see your breath. Snug, with the metal against your skin.");
      this.speak(GLOW_FEEL, true);
      return;
    }
    this.got = false; this.cueAt = clock();
    link.send({ cmd: "expect_response", seconds: GLOW_CUE_S });
    sfx.swell(1.6);
    this.to("in", this.tries ? "Big breath in!" : "Breathe in, big and quick!", "Fill the lantern with light.");
    this.speak(this.tries ? GLOW_SAY.again : GLOW_SAY.in, true);
  },
  retry() {  // the skin didn't answer: ask again, gently, never moving on without the breath
    this.tries++; this.cueAt = null;
    const L = GLOW_RETRY[(this.tries - 1) % GLOW_RETRY.length];
    const still = link.state && link.state.signal !== "ok" ? " Rest the hand with the finger straps and keep it still." : "";
    this.to("again", L[0], L[1] + still);
    this.speak(L[2], true);
    link.mark(`lantern glow breath ${this.n + 1} not seen try ${this.tries}`);
  },
  restText() {
    const mode = assist.on ? "assist" : "plain";
    if (mode === this.restMode) return;
    this.restMode = mode;
    if (mode === "assist") this.say("Breathe with the circle", "Slowly in as it grows, slowly out as it shrinks. No rush at all.");
    else this.say("The light is resting", ((GLOW_REVEALS[this.n - 1] || {}).rest || "Just watch the light on the water.") + ` ${this.caught} guided home so far.`);
  },
  scoreBreath() {  // only ever for a breath the skin answered
    const i = this.n, g = glowGeo();
    link.mark(`lantern glow breath ${i + 1} seen tries=${this.tries + 1}`);
    this.n++; this.cueAt = null; this.tries = 0;
    this.score += 3;
    this.chargeMax = this.charge = GLOW_CHARGE_FULL;
    const R = GLOW_REVEALS[i];
    this.revealIdx = R ? i : null; this.revealDur = R ? 3.6 : 1.4;
    if (R) this.revTarget[i] = 1;
    this.beamFrom = [this.beamX, this.beamY]; this.ignite = 1;
    sfx.sparkle(); fx.burst(g.lhX, g.lampY, { color: "#fff1c8", n: 28, speed: 80, life: 1.8, size: 2.2 });
    this.to("reveal", "The lighthouse heard you", (R ? R.got + " " : "") + "A full charge of light.");
    this.speak(GLOW_SAY.heard, true);
  },

  // ---- beam phase
  toBeam() {
    const k = this.n - 1, cf = challengeFactor();
    this.to("beam"); this.bt = 0; this.idle = 0; this.since = 0;
    if (GLOW_VOICE[k]) this.speak(GLOW_VOICE[k], true);
    this.diff = clamp(k / 5, 0, 1);
    this.spawnGap = this.diff === 0 ? 2.4 : 1.7 - 0.9 * this.diff;
    this.maxT = Math.round(3 + 7 * this.diff * cf);
    this.spawnT = 0.8;
    if (k === 0) this.spawn("boat", true);
    this.fog = [];
    const nf = this.diff >= 0.8 ? 3 : this.diff >= 0.6 ? 2 : this.diff >= 0.4 ? 1 : 0, g = glowGeo();
    for (let i = 0; i < nf - (cf < 0.7 ? 1 : 0); i++) {
      const rx = g.s * rand(0.17, 0.25);
      this.fog.push({ cx: W * rand(0.38, 0.88), cy: rand(g.hz + H * 0.08, H * 0.86), rx, ry: rx * 0.45, vx: W * rand(-0.012, 0.012), a: 0, ph: rand(0, 6.28) });
    }
    if (k === 0) { this.say("Guide them home", "Point the light at a boat and hold it there until its ring fills."); this.promptClear = 5; }
    else { this.say(k >= 3 ? "Busy waters" : "Aim the light", k === 2 ? "Fog is rolling in. Sweep the light through it." :
      k >= 3 ? "Quick ones are worth more. Keep the chain going." : "Catch them one after another to build a chain."); this.promptClear = 2.6; }
  },
  spawnSome() {
    const d = this.diff, w = { boat: 3 - 1.5 * d, duck: d >= 0.2 ? 1.6 : 0, fly: d >= 0.4 ? 1.6 : 0,
      whale: d >= 0.4 && !this.tg.some((t) => t.kind === "whale") ? 0.7 : 0, star: d >= 0.6 ? 1 : 0, fish: d >= 0.4 ? 0.2 + 0.4 * d : 0 };
    let tot = 0; for (const k in w) tot += w[k];
    let r = Math.random() * tot;
    for (const k in w) { r -= w[k]; if (r <= 0) { this.spawn(k); return; } }
    this.spawn("boat");
  },
  spawn(kind, first) {
    const g = glowGeo(), s = g.s, d = this.diff, sp = 1 + 1.2 * d;
    const t = { kind, x0: 0, y0: 0, vx: 0, vy: 0, ax: 0, ay: 0, wx: 0, wy: 0, ph: rand(0, 6.28), jump: 0, life: 6, age: 0,
      r: s * 0.03, x: 0, y: 0, lock: 0, inB: false, saved: 0, leave: 0, alpha: 0, v: 1, rise: 0 };
    const seaY = (lo = 0.06) => rand(g.hz + H * lo, H * 0.92);
    if (kind === "boat") {
      t.r = s * (0.075 - 0.03 * d); t.x0 = first ? W * 0.68 : W * 1.06; t.y0 = first ? H * 0.86 : seaY(0.07);  // the first one sits below the prompt text
      t.vx = -W * 0.05 * sp; t.ay = H * 0.035 * d; t.wy = rand(0.5, 0.9) * sp; t.life = (t.x0 - W * 0.22) / -t.vx;
    } else if (kind === "duck") {
      const dir = Math.random() < 0.5 ? -1 : 1, n = d >= 0.6 ? 4 : 3, r = s * 0.032, vx = dir * W * 0.07 * sp;
      const x0 = dir < 0 ? W * 1.04 : W * 0.24, y0 = seaY(dir < 0 ? 0.06 : 0.14), life = (dir < 0 ? x0 - W * 0.2 : W * 1.04 - x0) / Math.abs(vx);
      const ay = H * 0.03 * (0.5 + d), wy = 1.3 * sp, ph = t.ph;
      for (let i = 0; i < n; i++) {
        const lag = i * r * 2.6 / Math.abs(vx);
        this.tg.push({ ...t, r, x0, y0, vx, ay, wy, ph, age: -lag, life: life + lag });
      }
      return;
    } else if (kind === "fly") {
      t.r = s * 0.024; t.x0 = W * rand(0.32, 0.92); t.y0 = rand(H * 0.22, g.hz - H * 0.05); t.vx = W * rand(-0.02, 0.02);
      t.ax = W * 0.07 * (0.6 + d); t.ay = H * 0.05 * (0.6 + d); t.wx = rand(0.6, 0.9) * sp; t.wy = rand(0.9, 1.4) * sp; t.life = 7;
    } else if (kind === "whale") {
      t.r = s * 0.075; t.x0 = W * rand(0.4, 0.86); t.y0 = seaY(0.1); t.vx = W * rand(-0.012, 0.012); t.life = 4.2 - d;
    } else if (kind === "star") {
      t.r = s * 0.026; t.x0 = W * rand(0.5, 1); t.y0 = H * rand(0.17, 0.32); t.vx = -W * rand(0.18, 0.26) * sp; t.vy = H * rand(0.06, 0.14); t.life = 1.9;
    } else if (kind === "fish") {
      t.r = s * 0.028; t.x0 = W * rand(0.38, 0.86); t.y0 = seaY(0.12); t.vx = W * 0.06 * (Math.random() < 0.5 ? -1 : 1); t.jump = H * 0.1; t.life = 1.9;
    }
    this.tg.push(t);
  },
  beamStep(dt) {
    const lv = assist.level, cf = challengeFactor(), g = glowGeo();
    this.bt += dt;
    if (this.promptClear && this.bt > this.promptClear) { this.promptClear = 0; this.say(""); }
    if (input.has) {  // the beam follows the pointer, smoothed (the sleeve cursor is already smoothed upstream)
      const k = 1 - Math.exp(-dt / (input.source === "sleeve" ? 0.1 : 0.045));
      this.beamX += (clamp(input.x, 0, W) - this.beamX) * k; this.beamY += (clamp(input.y, 0, H) - this.beamY) * k;
    }
    this.charge -= dt * (1 - 0.3 * lv);  // the light lasts longer while the lantern is helping
    this.spawnT -= dt * cf;
    if (this.spawnT <= 0) {
      if (this.tg.filter((t) => !t.saved && !t.leave).length < this.maxT) this.spawnSome();
      this.spawnT = this.spawnGap * rand(0.75, 1.25);
    }
    const R = this.spotR(), lockK = 1 - 0.35 * lv;
    let any = false;
    for (const t of this.tg) {
      if (t.saved || t.leave || t.alpha < 0.3) { t.inB = false; continue; }
      t.inB = Math.hypot(t.x - this.beamX, t.y - this.beamY) < R * 0.85 + t.r * 0.6;
      const lt = GLOW_KINDS[t.kind].lock * lockK;
      if (t.inB) { any = true; t.lock += dt / lt; if (t.lock >= 1) this.rescue(t); }
      else t.lock = Math.max(0, t.lock - dt / lt * 0.8);
    }
    // the chain: three quick catches per step up to x6. It cools when catches slow down, faster when the
    // light rests on empty water; the helping hand gives it more time.
    this.since += dt;
    if (any) this.idle = 0; else this.idle += dt;
    const cool = this.idle > 0.6 + 0.4 * lv ? 1.2 : this.since > 2 + 0.8 * lv ? 0.8 : 0;
    if (cool) this.heat = Math.max(0, this.heat - dt * cool * (1 - 0.3 * lv));
    if (this.charge <= 0) this.endBeam(g);
  },
  rescue(t) {
    const K = GLOW_KINDS[t.kind], m = this.mult(), pts = Math.max(1, Math.round(K.val * m * (1 - 0.45 * assist.level)));  // help = easier, not richer
    this.score += pts; this.caught++; t.saved = 1e-3; t.lock = 1; t.inB = false;
    this.heat = Math.min(5.99, this.heat + 1 / 3); this.idle = 0; this.since = 0;
    sfx.chime(2 + Math.min(7, Math.floor(this.heat * 1.4)), 0.09);
    if (K.val >= 4) sfx.sparkle();
    fx.burst(t.x, t.y, { color: K.fx, n: 8 + 3 * m, speed: 50 + 12 * m, life: 1.1, size: 2 });
    if (this.floaters.length > 10) this.floaters.shift();
    this.floaters.push({ x: t.x, y: t.y - t.r * 1.2, txt: m > 1 && assist.level < 0.05 ? `+${K.val}×${m}` : `+${pts}`, age: 0, big: K.val >= 4 });
    const nm = this.mult();
    if (nm > m && GLOW_CHAIN_LINES[nm] && !this.chainSaid[nm]) { this.chainSaid[nm] = true; this.speak(GLOW_CHAIN_LINES[nm]); }
  },
  endBeam() {
    this.charge = 0;
    for (const t of this.tg) if (!t.saved) { t.leave = t.leave || 1e-3; t.lock = 0; t.inB = false; }
    if (this.n >= this.total) { this.finish(); return; }
    this.kindWord();
  },

  // ---- kind words between breaths: the lantern says an affirmation and the player says it back, as in the
  // Kind words scene (same listening, lenient match and star). Then the quiet rest, then the next breath.
  kindWord() {
    const aff = this.kwList[this.kwI++ % this.kwList.length];
    this.kw = { aff, state: "lead", since: clock(), again: false };
    this.to("kind");
    this.kwShow("Say it with me", "");
    speech.say(aff, () => setTimeout(() => this.kwListen(), 300));  // only listen once it has finished talking
  },
  kwShow(h, p) {
    const el = $("#gp");
    if (el) el.innerHTML = `<h2>${esc(h)}</h2><div class="kw-aff">“${esc(this.kw.aff.replace(/[.]$/, ""))}”</div><p id="gkw-p">${p}</p>`;
  },
  kwButtons(on) {
    const el = $("#gkw");
    if (!el) return;
    el.innerHTML = on ? `<button class="btn primary" id="gkw-said">I said it</button><button class="linkbtn" id="gkw-skip">Skip this one</button>` : "";
    if (on) { $("#gkw-said").onclick = () => this.kwGot("tapped"); $("#gkw-skip").onclick = () => this.kwDone(true); }
  },
  kwListen() {
    const kw = this.kw;
    if (scene !== this || this.phase !== "kind" || !kw || (kw.state !== "lead" && kw.state !== "listen")) return;
    if (kw.state === "lead") kw.since = clock();
    kw.state = "listen";
    link.send({ cmd: "expect_response", seconds: 12 });  // speaking aloud raises skin conductance too: not stress
    const hearing = ear.start((alts) => {
      if (this.kw !== kw || kw.state !== "listen") return;
      if (Math.max(...alts.map((a) => kindMatch(a, kw.aff))) >= KIND_MATCH) this.kwGot("said");
    }, () => {  // listening stopped by itself: carry on, or switch to tapping if the mic was refused
      if (scene !== this || this.kw !== kw || kw.state !== "listen") return;
      if (ear.available()) setTimeout(() => this.kwListen(), 250); else this.kwTap();
    });
    if (!hearing) return this.kwTap();
    const p = $("#gkw-p");
    if (p) p.innerHTML = `<span class="mic"></span>Listening… say it out loud`;
  },
  kwTap() {
    const p = $("#gkw-p");
    if (p) p.textContent = "Say it out loud, or quietly to yourself, then tap “I said it”.";
    this.kwButtons(true);
  },
  kwAgain() {  // gently, once; then a tap and a skip are offered too
    const kw = this.kw;
    kw.again = true; kw.state = "lead"; ear.stop();
    speech.say(GLOW_KW_AGAIN, () => setTimeout(() => this.kwListen(), 300));
    this.kwButtons(true);
  },
  kwGot(how) {
    const kw = this.kw;
    if (!kw || (kw.state !== "listen" && kw.state !== "lead")) return;
    kw.state = "praise"; ear.stop(); this.kwButtons(false);
    save.kind = (save.kind || 0) + 1; persist(); kindStars.bornAt = clock();
    const [sx, sy] = kindStarPos(Math.min(59, save.kind - 1));
    sfx.sparkle(); fx.burst(sx, sy, { color: "#ffe08a", n: 30, speed: 90, life: 1.6 }); this.flare = 1;
    link.mark(`lantern affirm ${how} ${kw.aff}`.slice(0, 80));
    const praise = KIND_PRAISE[(this.kwI - 1) % KIND_PRAISE.length];
    this.say(praise, "A new star is shining for you.");
    speech.say(praise, () => setTimeout(() => this.kwDone(), 900));
  },
  kwDone(skipped) {
    const kw = this.kw;
    if (!kw || scene !== this || this.phase !== "kind" || (skipped && kw.state === "praise")) return;
    if (skipped) { link.mark("lantern affirm skip"); speech.stop(); }
    ear.stop(); this.kwButtons(false); this.kw = null;
    this.restMode = null; this.to("rest");
    this.restText();
  },
  stepTargets(dt) {
    const cf = challengeFactor(), g = glowGeo(), beam = this.phase === "beam" && !this.ended, R = this.spotR();
    let dead = false;
    for (const t of this.tg) {
      if (t.saved) {
        t.saved += dt;
        if (t.kind === "boat") t.age += dt * 1.8; else t.rise += dt * g.s * 0.08;  // a guided boat hurries home
      } else if (t.leave) t.leave += dt;
      else t.age += dt * cf;  // stress slows the whole sea, live
      glowPos(t);
      if (t.saved && t.kind !== "boat") t.y -= t.rise;
      t.alpha = t.saved ? clamp(1 - t.saved / 1.4, 0, 1)
        : clamp(t.age / 0.4, 0, 1) * clamp((t.life - t.age) / 0.5, 0, 1) * (t.leave ? clamp(1 - t.leave / 0.8, 0, 1) : 1);
      let fogged = false;
      for (const f of this.fog) {
        const dx = (t.x - f.cx) / f.rx, dy = (t.y - f.cy) / f.ry;
        if (f.a > 0.3 && dx * dx + dy * dy < 1) { fogged = true; break; }
      }
      const vt = !fogged || t.saved || Math.hypot(t.x - this.beamX, t.y - this.beamY) < R * 1.6 ? 1 : 0.08;
      t.v += (vt - t.v) * (1 - Math.exp(-dt / 0.15));
      if (t.alpha <= 0 && (t.saved || t.leave || t.age > t.life)) dead = true;
    }
    if (dead) this.tg = this.tg.filter((t) => !(t.alpha <= 0 && (t.saved || t.leave || t.age > t.life)));
    for (const f of this.fog) { f.cx += f.vx * dt * cf; f.a += ((beam ? 1 : 0) - f.a) * (1 - Math.exp(-dt / 1.2)); }
    if (!beam && this.fog.length && this.fog.every((f) => f.a < 0.01)) this.fog = [];
    for (const fl of this.floaters) fl.age += dt;
    if (this.floaters.length && this.floaters[0].age > 1.2) this.floaters = this.floaters.filter((fl) => fl.age <= 1.2);
  },
  pills() {
    const sc = Math.round(this.score), m = this.mult(), best = Math.max(this.best0, sc);
    if (!this.bestSaid && this.best0 > 0 && sc > this.best0) { this.bestSaid = true; this.speak("New best!", true); sfx.sparkle(); }
    while (this.mi < GLOW_MILESTONES.length && sc >= GLOW_MILESTONES[this.mi][0]) {
      if (!this.speak(GLOW_MILESTONES[this.mi][1])) break;
      this.mi++;
    }
    const key = `${sc}|${m}|${best}`;
    if (key === this.pillKey) return;
    this.pillKey = key;
    const a = $("#gsc"), b = $("#gch"), c = $("#gbe");
    if (a) a.textContent = String(sc);
    if (b) b.textContent = `chain ×${m}`;
    if (c) c.textContent = `${this.bestSaid ? "★ " : ""}best ${best}`;
  },

  hasProgress() { return this.n > 0 || this.score > 0; },
  finishEarly() { this.finish(); },
  finish() {
    if (this.ended) return;
    this.ended = true; this.cueAt = null;
    endRound("glow", Math.round(this.score), this.meta, this.n >= this.total ? "The whole sea is glowing." : "The lighthouse is shining for you.",
      `${this.n} breaths seen · ${this.caught} rescued`);
  },

  stepWorld(dt) {
    const P = this.phase, g = glowGeo(), lv = assist.level;
    this.flare = Math.max(0, this.flare - dt * 0.25);
    this.ignite = Math.max(0, this.ignite - dt * 0.4);
    // beam: a scripted sweep to the new find, aimed by the player while charged, otherwise a slow wander
    let tI;
    if (P === "reveal" && this.beamFrom) {
      const R = this.revealIdx != null ? GLOW_REVEALS[this.revealIdx] : null, k = glowEase(this.pt / 3.2);
      if (R) { this.beamX = lerp(this.beamFrom[0], R.x * W, k); this.beamY = lerp(this.beamFrom[1], R.y * H, k); }
      tI = this.chargeMax >= GLOW_CHARGE_FULL ? 1 : 0.7;
    } else if (P === "beam" && !this.ended) {
      tI = 0.5 + 0.5 * clamp(this.charge / this.chargeMax, 0, 1);
    } else {
      const u = clock() * 0.035 * 6.283, kk = 1 - Math.exp(-dt / 2.5);
      const tx = this.n > 0 ? W * (0.62 + 0.3 * Math.sin(u)) : W * 0.3, ty = H * (0.7 + 0.08 * Math.sin(u * 1.7 + 1));
      this.beamX += (tx - this.beamX) * kk; this.beamY += (ty - this.beamY) * kk;
      tI = this.n > 0 ? 0.22 + 0.04 * this.n : 0;
    }
    this.beamI += (tI - this.beamI) * (1 - Math.exp(-dt / (P === "beam" ? 0.25 : 0.7)));
    for (let i = 0; i < 5; i++) if (this.revOn[i]) this.rev[i] = Math.min(this.revTarget[i], this.rev[i] + dt / 2.5);
    // the pacing ring fades in during rest when the lantern is helping
    const ringT = (P === "rest" || P === "intro") && !this.ended ? lv : 0;
    this.ringA += (ringT - this.ringA) * (1 - Math.exp(-dt / 0.8));
    // mist: the breath out, rolling from the lantern over the water
    if (P === "out" && this.pt < this.exDur && !this.ended) {
      const k = this.pt / this.exDur;
      this.mistAcc += dt * 6 * (1 - 0.5 * k);
      while (this.mistAcc >= 1 && this.mist.length < 40) {
        this.mistAcc -= 1;
        this.mist.push({ x: g.lanX + rand(-0.3, 0.3) * g.lanSize, y: g.lanY + g.lanSize * 0.6, vx: rand(-1, 1) * g.s * 0.2,
          ty: g.hz + rand(0.005, 0.1) * H, r0: g.lanSize * rand(0.4, 0.7), age: 0, life: rand(6, 9) });
      }
      if (this.mistAcc > 1) this.mistAcc = 0;
    }
    for (const m of this.mist) {
      m.age += dt; m.x += m.vx * dt; m.vx *= 1 - 0.12 * dt;
      m.y += (m.ty - m.y) * (1 - Math.exp(-dt / 1.2));
    }
    if (this.mist.length && this.mist[0].age > this.mist[0].life) this.mist = this.mist.filter((m) => m.age < m.life);
  },

  draw(time) {
    const g = glowGeo(), P = this.phase, lv = assist.level, calm = world.calm, bright = 0.75 + 0.35 * calm;
    const A = (i) => clamp(this.rev[i] * bright, 0, 1);
    drawSky(time);
    // calm brings out extra stars
    const ns = Math.round(GLOW_STARS.length * clamp((calm - 0.2) / 0.8, 0, 1));
    ctx.fillStyle = "#fff";
    for (let i = 0; i < ns; i++) {
      const st = GLOW_STARS[i];
      ctx.globalAlpha = 0.6 * (0.5 + 0.5 * Math.sin(time * st.sp + st.ph));
      ctx.fillRect(st.x * W, st.y * H, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    if (this.rev[4] > 0.001) glowDrawShore(g, A(4), this.rev[4], time);
    if (this.rev[1] > 0.001) glowDrawShip(g, A(1), time);
    if (this.rev[2] > 0.001) glowDrawIsland(g, A(2), time);
    drawSea(time);
    if (this.rev[4] > 0.001) glowDrawShoreRefl(g, A(4), this.rev[4], time);
    if (this.rev[1] > 0.001) glowDrawShipRefl(g, A(1), time);
    if (this.rev[2] > 0.001) glowDrawIslandRefl(g, A(2));
    if (this.rev[3] > 0.001) glowDrawJellies(g, A(3), time);
    if (this.rev[0] > 0.001) glowDrawWhale(g, A(0), time);

    // fog banks, then the things adrift (a fogged one only shows when the light finds it)
    for (const f of this.fog) {
      if (f.a < 0.01) continue;
      for (let j = 0; j < 5; j++) {
        glowBlob(f.cx + (j - 2) * f.rx * 0.38, f.cy + Math.sin(j * 1.7 + time * 0.3 + f.ph) * f.ry * 0.25, f.rx * 0.6, GLOW_MIST, 0.26 * f.a);
      }
    }
    for (const t of this.tg) glowDrawTarget(t, g, time);

    const prime = (P === "out" && this.pt > this.exDur) || P === "listen" ? 0.6 + 0.3 * Math.sin(clock() * 1.8) : 0;
    glowDrawLighthouse(g, this.beamI, this.ignite, prime);

    // the breath out as mist over the water (warmer when the lantern is helping)
    if (this.mist.length) {
      const mc = glowLerpRGB(GLOW_MIST, GLOW_MIST_WARM, glowQ(lv));
      for (const m of this.mist) {
        const a = Math.min(1, m.age / 0.8) * Math.max(0, 1 - m.age / m.life);
        glowBlob(m.x, m.y, m.r0 + m.age * g.s * 0.035, mc, a * 0.2);
      }
    }
    const beamCol = glowLerpRGB(GLOW_BEAM, GLOW_BEAM_WARM, glowQ(lv)), aimed = P === "beam" && !this.ended;
    const R = this.spotR();
    glowDrawBeam(g, this.beamX, this.beamY, this.beamI, this.ignite, prime, beamCol, aimed ? R : 0);

    drawBoat(g.lanX, g.hz + H * 0.045, g.s * 0.11, time);

    // the lantern: swells on the breath in, settles on the breath out
    const k = clamp(this.pt / 1.6, 0, 1), fc = glowHex(flameColor());
    let glow = 0.7;
    if (P === "in") glow = 0.7 + 0.5 * k;
    else if (P === "out") glow = 1.2 - 0.5 * clamp(this.pt / this.exDur, 0, 1);
    glow += this.flare * 0.9;
    const lx = g.lanX, ly = g.lanY + Math.sin(time * 1.1) * 3, size = g.lanSize * (P === "in" ? 1 + 0.12 * k : 1);
    if (lv > 0.01) { ctx.save(); ctx.globalCompositeOperation = "lighter"; glowBlob(lx, ly, g.lanSize * 5, [255, 160, 80], 0.28 * lv); ctx.restore(); }
    drawLantern(lx, ly, size, glow, time);
    if (P === "kind" && ear.on) {  // soft rings: the lantern is listening
      ctx.save(); ctx.strokeStyle = flameColor(); ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const ph = (time * 0.6 + k / 3) % 1;
        ctx.globalAlpha = 0.35 * (1 - ph);
        ctx.beginPath(); ctx.arc(lx, ly, g.lanSize * (1.2 + 3 * ph), 0, 6.29); ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save(); ctx.globalCompositeOperation = "lighter";
    if (P === "ready" || P === "in") {  // motes of light gather, then rush in with the breath
      const ka = P === "ready" ? clamp(this.pt / 3, 0, 1) * 0.6 : 1, kr = P === "in" ? glowEase(this.pt / 1.4) : 0;
      for (let i = 0; i < 14; i++) {
        const an = i / 14 * 6.283 + time * 0.2, Rr = g.lanSize * (3.2 - 2.7 * kr) * (1 + 0.06 * Math.sin(time + i));
        glowBlob(lx + Math.cos(an) * Rr, ly + Math.sin(an) * Rr * 0.8, g.lanSize * 0.12, fc, ka * (1 - 0.6 * kr));
      }
    }
    if (P === "out" && this.pt < this.exDur + 0.5) {  // a mote of light carried slowly to the lighthouse
      const e = glowEase(this.pt / this.exDur), cx = (lx + g.lhX) / 2, cy = Math.min(ly, g.lampY) - H * 0.12;
      const at = (t) => [(1 - t) * (1 - t) * lx + 2 * (1 - t) * t * cx + t * t * g.lhX, (1 - t) * (1 - t) * ly + 2 * (1 - t) * t * cy + t * t * g.lampY];
      const fade = 1 - clamp((this.pt - this.exDur) / 0.5, 0, 1);
      for (let j = 7; j >= 0; j--) {
        const t = e - j * 0.025;
        if (t <= 0) continue;
        const [mx, my] = at(t);
        glowBlob(mx, my, g.lanSize * (0.28 - j * 0.025), fc, fade * (j ? 0.5 * (1 - j / 8) : 0.95));
      }
    }
    ctx.restore();

    if (aimed) {
      // where the light catches: a faint ring, the lock-on rings, and the charge left around the lamp
      ctx.save();
      ctx.strokeStyle = glowRgba(beamCol, 0.3 * this.beamI); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(this.beamX, this.beamY, R, 0, 6.29); ctx.stroke();
      ctx.lineWidth = 3; ctx.lineCap = "round";
      for (const t of this.tg) {
        if (t.saved || t.lock < 0.02 || t.alpha * t.v < 0.2) continue;
        const rr = Math.max(t.r * 1.3, g.s * 0.03);
        ctx.strokeStyle = glowRgba(GLOW_RING, 0.25 * t.alpha);
        ctx.beginPath(); ctx.arc(t.x, t.y, rr, 0, 6.29); ctx.stroke();
        ctx.strokeStyle = glowRgba([255, 236, 190], 0.95 * t.alpha);
        ctx.beginPath(); ctx.arc(t.x, t.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.min(1, t.lock) * 6.283); ctx.stroke();
      }
      const cr = g.s * 0.055, fr = clamp(this.charge / this.chargeMax, 0, 1), low = this.charge < 2.5 ? 0.5 + 0.5 * Math.sin(clock() * 8) : 1;
      ctx.lineWidth = Math.max(3, g.s * 0.008);
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.beginPath(); ctx.arc(g.lhX, g.lampY, cr, 0, 6.29); ctx.stroke();
      ctx.strokeStyle = glowRgba(beamCol, 0.85 * low);
      ctx.beginPath(); ctx.arc(g.lhX, g.lampY, cr, -Math.PI / 2, -Math.PI / 2 + fr * 6.283); ctx.stroke();
      ctx.restore();
    }
    if (this.floaters.length) {
      ctx.save(); ctx.textAlign = "center";
      const fs = Math.round(clamp(g.s * 0.034, 14, 24));
      for (const fl of this.floaters) {
        ctx.globalAlpha = clamp(1 - fl.age / 1.2, 0, 1);
        ctx.font = `700 ${fl.big ? Math.round(fs * 1.3) : fs}px ui-rounded, system-ui, sans-serif`;
        ctx.fillStyle = fl.big ? "#ffe08a" : "#fff3d6";
        ctx.fillText(fl.txt, fl.x, fl.y - fl.age * g.s * 0.06);
      }
      ctx.restore();
    }

    // breathing circle: about 6 breaths a minute (4 s in, 6 s out), only when the lantern is helping
    if (this.ringA > 0.02) {
      const c = clock() % 10, b = c < 4 ? glowEase(c / 4) : 1 - glowEase((c - 4) / 6), Rr = g.lanSize * (1.6 + 1.2 * b);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = glowRgba(GLOW_RING, 0.13 * this.ringA); ctx.lineWidth = g.lanSize * 0.35;
      ctx.beginPath(); ctx.arc(lx, ly, Rr, 0, 6.29); ctx.stroke();
      ctx.strokeStyle = glowRgba(GLOW_RING, 0.6 * this.ringA); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(lx, ly, Rr, 0, 6.29); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.8 * this.ringA; ctx.fillStyle = "#ffe6c8"; ctx.textAlign = "center";
      ctx.font = `${Math.round(clamp(g.s * 0.04, 15, 22))}px ui-rounded, system-ui, sans-serif`;
      ctx.fillText(c < 4 ? "breathe in…" : "…and slowly out", lx, Math.max(ly - g.lanSize * 2.8 - 18, 96));
      ctx.restore();
    }

    if (P === "rest" || P === "reveal" || P === "kind") {  // embers drifting up between breaths
      ctx.fillStyle = flameColor();
      for (let i = 0; i < 12; i++) {
        const a = (time * 0.15 + i / 12) % 1;
        ctx.globalAlpha = (1 - a) * 0.6;
        ctx.beginPath(); ctx.arc(lx + Math.sin(i * 7 + time * 0.5) * 60 * a, ly - g.lanSize * 0.4 - a * H * 0.3, 2.5, 0, 6.29); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // a warm wash over everything when the lantern is helping
    if (lv > 0.01) { ctx.fillStyle = `rgba(255,140,60,${(0.09 * lv).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  },
};
