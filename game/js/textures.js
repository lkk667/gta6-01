// Solmar City — procedural canvas textures.
// Everything here is drawn at runtime on 2D canvases, so the game needs no
// image downloads: asphalt and pavements, building facades with lit windows,
// the soft glow sprites, wheel faces and number plates. All generators are
// seeded, so the same seed always paints the same texture.

import * as THREE from '../vendor/three.module.min.js';

// ---------------------------------------------------------------------------
// Small helpers (own names, own structure)
// ---------------------------------------------------------------------------

// A tiny deterministic generator: mulberry32. Textures built from it look
// the same on every load, which keeps screenshots comparable between runs.
function seededRand(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

// Make a blank canvas and hand back both the element and its 2D context.
function blankCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Turn a 0xRRGGBB number into an rgba() string.
function hexA(hex, alpha) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Paint one soft round blotch: a radial gradient that is strongest in the
// middle and fades to nothing at the rim.
function blotch(ctx, x, y, radius, colour, peakAlpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, hexA(colour, peakAlpha));
  g.addColorStop(0.55, hexA(colour, peakAlpha * 0.55));
  g.addColorStop(1, hexA(colour, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// Give a CanvasTexture repeating wrap and a decent anisotropy, then return it.
function prepare(tex, srgb) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function canvasTexture(canvas, srgb) {
  return prepare(new THREE.CanvasTexture(canvas), srgb);
}

// ---------------------------------------------------------------------------
// Asphalt — colour map + matching roughness map
// ---------------------------------------------------------------------------

// Wet patches must sit in exactly the same spots on both maps, so the
// puddle centres are rolled once and shared by the two painters.
function rollPuddles(rng, count, w, h) {
  const spots = [];
  for (let i = 0; i < count; i++) {
    spots.push({
      x: 60 + rng() * (w - 120),
      y: 60 + rng() * (h - 120),
      r: 90 + rng() * 130,
      wet: 0.06 + rng() * 0.08,
    });
  }
  return spots;
}

export function asphaltMaps() {
  const W = 1024;
  const H = 1024;
  const rng = seededRand(20261121);
  const puddles = rollPuddles(rng, 6, W, H);

  // --- colour map: near-black asphalt, speckled, with soft wet blotches ---
  const [colour, cc] = blankCanvas(W, H);
  cc.fillStyle = '#232327';
  cc.fillRect(0, 0, W, H);
  // faint large-scale mottling so the road is not one flat tone
  for (let i = 0; i < 260; i++) {
    blotch(cc, rng() * W, rng() * H, 30 + rng() * 90, 0x3a3a40, 0.10 + rng() * 0.10);
  }
  // fine grit
  for (let i = 0; i < 9000; i++) {
    const v = 28 + Math.floor(rng() * 46);
    cc.fillStyle = `rgba(${v},${v},${v + 6},${0.25 + rng() * 0.4})`;
    cc.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }
  // worn tyre lanes running along the length of the tile
  for (const laneX of [W * 0.28, W * 0.72]) {
    const g = cc.createLinearGradient(laneX - 70, 0, laneX + 70, 0);
    g.addColorStop(0, 'rgba(10,10,12,0)');
    g.addColorStop(0.5, 'rgba(10,10,12,0.28)');
    g.addColorStop(1, 'rgba(10,10,12,0)');
    cc.fillStyle = g;
    cc.fillRect(laneX - 70, 0, 140, H);
  }
  // wet puddles: few, broad and soft, a touch lighter than the dry road
  // so the sky sheen reads — never small hard-edged pale ovals in a row
  for (const p of puddles) {
    blotch(cc, p.x, p.y, p.r, 0x4a5a6e, 0.32);
    blotch(cc, p.x - p.r * 0.25, p.y - p.r * 0.3, p.r * 0.55, 0x6a7a90, 0.10);
  }

  // --- roughness map: dry asphalt rough (0.88), puddles slick (0.06-0.14) ---
  const [rough, rc] = blankCanvas(W, H);
  const dry = Math.round(0.88 * 255);
  rc.fillStyle = `rgb(${dry},${dry},${dry})`;
  rc.fillRect(0, 0, W, H);
  for (let i = 0; i < 5000; i++) {
    const v = dry - 12 + Math.floor(rng() * 24);
    rc.fillStyle = `rgba(${v},${v},${v},0.5)`;
    rc.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }
  for (const p of puddles) {
    const wet = Math.round(p.wet * 255);
    const g = rc.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, `rgb(${wet},${wet},${wet})`);
    g.addColorStop(0.7, `rgb(${Math.round(wet + (dry - wet) * 0.35)},${Math.round(wet + (dry - wet) * 0.35)},${Math.round(wet + (dry - wet) * 0.35)})`);
    g.addColorStop(1, `rgb(${dry},${dry},${dry})`);
    rc.fillStyle = g;
    rc.beginPath();
    rc.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    rc.fill();
  }

  return {
    map: canvasTexture(colour, true),
    roughnessMap: canvasTexture(rough, false),
  };
}

// ---------------------------------------------------------------------------
// Pavement
// ---------------------------------------------------------------------------

export function sidewalkMap() {
  const W = 1024;
  const H = 1024;
  const rng = seededRand(977);
  const [c, ctx] = blankCanvas(W, H);

  // warm stone, gently lighter toward the top edge
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#9a8a76');
  base.addColorStop(0.5, '#8a7a66');
  base.addColorStop(1, '#7a6a58');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // faint large patches of wear
  for (let i = 0; i < 90; i++) {
    blotch(ctx, rng() * W, rng() * H, 40 + rng() * 110, 0x6a5a48, 0.08 + rng() * 0.08);
  }
  // tile joints: a regular grid of darker seams
  ctx.strokeStyle = 'rgba(52,44,36,0.55)';
  ctx.lineWidth = 3;
  const step = 128;
  for (let x = 0; x <= W; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  // light seams offset half a tile, for a staggered slab look
  ctx.strokeStyle = 'rgba(52,44,36,0.28)';
  ctx.lineWidth = 2;
  for (let y = step / 2; y <= H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }
  // speckle
  for (let i = 0; i < 6000; i++) {
    const v = 110 + Math.floor(rng() * 60);
    ctx.fillStyle = `rgba(${v},${Math.round(v * 0.9)},${Math.round(v * 0.78)},${0.2 + rng() * 0.3})`;
    ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }

  return canvasTexture(c, true);
}

// ---------------------------------------------------------------------------
// Building facades — dense small windows, lit-window emissive twin
// ---------------------------------------------------------------------------

const FACADE_STYLES = [
  { name: 'cream', base: 0xe8dcc0, trim: 0xc8b890, glass: false },
  { name: 'coral', base: 0xe8a080, trim: 0xc87858, glass: false },
  { name: 'mint', base: 0xa8d8c0, trim: 0x88b8a0, glass: false },
  { name: 'glass', base: 0x2a3a4a, trim: 0x5a7a9a, glass: true },
  { name: 'brick', base: 0x8a4a38, trim: 0x6a3828, glass: false },
];

// One window slot, shared by the colour map and the emissive map so the lit
// windows line up exactly with the glass on the facade.
function rollWindows(rng, cols, rows, cellW, cellH) {
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({
        x: c * cellW + cellW * 0.22,
        y: r * cellH + cellH * 0.2,
        w: cellW * 0.56,
        h: cellH * 0.6,
        lit: rng() < 0.48,
        warm: 0.75 + rng() * 0.25,
        blinds: rng() < 0.4,
      });
    }
  }
  return slots;
}

function paintWindowGlass(ctx, s, style) {
  // dark frame
  ctx.fillStyle = 'rgba(30,26,22,0.9)';
  ctx.fillRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6);
  if (style.glass) {
    // curtain-wall pane: cool reflective glass
    const g = ctx.createLinearGradient(s.x, s.y, s.x + s.w, s.y + s.h);
    g.addColorStop(0, '#5a7a95');
    g.addColorStop(0.5, '#3a5a72');
    g.addColorStop(1, '#6a8aa5');
    ctx.fillStyle = g;
    ctx.fillRect(s.x, s.y, s.w, s.h);
  } else {
    ctx.fillStyle = '#232c38';
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }
  // muntin cross
  ctx.fillStyle = 'rgba(30,26,22,0.85)';
  ctx.fillRect(s.x + s.w / 2 - 1, s.y, 2, s.h);
  ctx.fillRect(s.x, s.y + s.h / 2 - 1, s.w, 2);
}

function paintWindowLit(ctx, s, style) {
  if (!s.lit) return;
  // warm interior: brighter at the top (ceiling light), darker at the
  // bottom (furniture shadow), blind slats, and a 45-degree sky streak.
  const g = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
  const top = style.glass ? '#cfe8ff' : '#ffd98a';
  const mid = style.glass ? '#8ab8d8' : '#ffB85e';
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, style.glass ? '#2a4a62' : '#7a4a22');
  ctx.fillStyle = g;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  // furniture shadow along the bottom
  ctx.fillStyle = 'rgba(40,20,8,0.5)';
  ctx.fillRect(s.x, s.y + s.h * 0.72, s.w, s.h * 0.28);
  // blind slats
  if (s.blinds) {
    ctx.fillStyle = 'rgba(40,28,14,0.45)';
    for (let y = s.y + 4; y < s.y + s.h - 4; y += 7) {
      ctx.fillRect(s.x, y, s.w, 2);
    }
  }
  // diagonal sky-reflection streak
  ctx.save();
  ctx.beginPath();
  ctx.rect(s.x, s.y, s.w, s.h);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.fillRect(-s.w, -3, s.w * 2, 6);
  ctx.restore();
}

export function facadeMaps(styleIdx) {
  const style = FACADE_STYLES[((styleIdx % FACADE_STYLES.length) + FACADE_STYLES.length) % FACADE_STYLES.length];
  const W = 1024;
  const H = 1024;
  const rng = seededRand(4100 + styleIdx * 131);

  const [colour, cc] = blankCanvas(W, H);
  const [glow, gc] = blankCanvas(W, H);

  // base wall
  cc.fillStyle = hexA(style.base, 1);
  cc.fillRect(0, 0, W, H);
  // subtle vertical weathering streaks
  for (let i = 0; i < 40; i++) {
    blotch(cc, rng() * W, rng() * H, 30 + rng() * 80, 0x000000, 0.05 + rng() * 0.05);
  }
  // cornice bands: a proud trim near the top and a plinth at the bottom
  cc.fillStyle = hexA(style.trim, 1);
  cc.fillRect(0, 0, W, 26);
  cc.fillRect(0, 30, W, 8);
  cc.fillRect(0, H - 22, W, 22);
  cc.fillStyle = 'rgba(255,255,255,0.18)';
  cc.fillRect(0, 26, W, 3);
  // neon tube: a thin glowing line under the cornice on pastel styles
  if (!style.glass) {
    const tube = pick(rng, ['#ff5a8a', '#37e0ff', '#ffd23a']);
    cc.fillStyle = tube;
    cc.fillRect(0, 44, W, 5);
    cc.fillStyle = 'rgba(255,255,255,0.5)';
    cc.fillRect(0, 44, W, 2);
  }

  // windows: dense and small. The caller repeats the texture 2.2x, so the
  // grid here is already tight and the repeat makes it tighter still.
  const cols = style.glass ? 8 : 12;
  const rows = style.glass ? 10 : 12;
  const cellW = W / cols;
  const cellH = H / rows;
  const slots = rollWindows(rng, cols, rows, cellW, cellH);

  // ground floor: warm lit shop glass and pale pillars, never a black band
  const groundTop = H - cellH;
  gc.fillStyle = '#000000';
  gc.fillRect(0, 0, W, H);
  for (const s of slots) {
    if (s.y + s.h > groundTop) {
      // shopfront: brighter, warmer, fully lit
      s.lit = true;
      paintWindowGlass(cc, s, style);
      paintWindowLit(gc, s, style);
    } else {
      paintWindowGlass(cc, s, style);
      paintWindowLit(gc, s, style);
    }
  }
  // pale pillars between the shopfronts
  cc.fillStyle = 'rgba(235,228,214,0.9)';
  for (let c = 0; c <= cols; c++) {
    cc.fillRect(c * cellW - 5, groundTop, 10, cellH);
  }

  return {
    map: canvasTexture(colour, true),
    emissiveMap: canvasTexture(glow, true),
    roughness: style.glass ? 0.12 : 0.85,
    metalness: style.glass ? 0.45 : 0.05,
  };
}

// ---------------------------------------------------------------------------
// Glow sprite, wheel face, number plate
// ---------------------------------------------------------------------------

let cachedGlow = null;

export function glowTexture() {
  if (cachedGlow) return cachedGlow;
  const [c, ctx] = blankCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  cachedGlow = canvasTexture(c, true);
  return cachedGlow;
}

export function wheelTexture() {
  const [c, ctx] = blankCanvas(128, 128);
  // tyre
  ctx.fillStyle = '#141414';
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2c2c2c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  // rim
  const rim = ctx.createRadialGradient(64, 64, 6, 64, 64, 44);
  rim.addColorStop(0, '#d8d8d8');
  rim.addColorStop(0.7, '#9a9a9a');
  rim.addColorStop(1, '#5a5a5a');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(64, 64, 44, 0, Math.PI * 2);
  ctx.fill();
  // five spokes
  ctx.fillStyle = '#3c3c3c';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate(a);
    ctx.fillRect(-4, -42, 8, 42);
    ctx.restore();
  }
  // hub
  ctx.fillStyle = '#222222';
  ctx.beginPath();
  ctx.arc(64, 64, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#888888';
  ctx.beginPath();
  ctx.arc(64, 64, 4, 0, Math.PI * 2);
  ctx.fill();
  return canvasTexture(c, true);
}

export function plateTexture(code) {
  const [c, ctx] = blankCanvas(256, 64);
  ctx.fillStyle = '#f8f8f2';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#1c2a4a';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, 250, 58);
  ctx.fillStyle = '#1c2a4a';
  ctx.font = 'bold 34px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(code, 128, 34);
  return canvasTexture(c, true);
}
