// Solmar City — procedural surface library.
// Every wall, road and pavement in the city is painted from canvas
// textures made here at boot. No image files and no network: the same
// fixed seeds paint the same surfaces on every run, so a screenshot taken
// today matches one taken tomorrow. The variation lives in the paint —
// worn lane paint, stained and cracked pavers, facades whose windows are
// not all the same size, a few balconies and air-conditioner boxes — so
// the streets stop reading as one flat repeating tile.

import * as THREE from '../vendor/three.module.min.js';

// Deterministic generator (a small LCG) so the noise is stable per run.
function rand(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(canvas, opts) {
  const o = opts || {};
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(o.rx === undefined ? 1 : o.rx, o.ry === undefined ? 1 : o.ry);
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = o.aniso === undefined ? 8 : o.aniso;
  return t;
}

const memo = {};

// ------------------------------------------------------------ road surface

// Warm dusk asphalt. The base is speckled, the two wheel tracks are
// polished a little glossier by traffic, hairline cracks wander across
// the tile, and a couple of darker repair patches break the expanse.
// The centre dash is worn: faded, and broken where tyres have scrubbed
// the paint away. A paired roughness canvas carries the same wear.
export function asphaltMaps() {
  if (memo.asphalt) return memo.asphalt;
  const rnd = rand(9101);
  const [c, g] = newCanvas(512, 512);
  const [rc, rg] = newCanvas(512, 512);
  g.fillStyle = '#2e3138';
  g.fillRect(0, 0, 512, 512);
  rg.fillStyle = '#c9c9c9';
  rg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 15000; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const v = 36 + Math.floor(rnd() * 26);
    g.fillStyle = 'rgb(' + v + ',' + (v + 1) + ',' + (v + 5) + ')';
    g.fillRect(x, y, 2, 2);
    const rv = 150 + Math.floor(rnd() * 90);
    rg.fillStyle = 'rgb(' + rv + ',' + rv + ',' + rv + ')';
    rg.fillRect(x, y, 2, 2);
  }
  // Polished bands where the tyres run.
  g.fillStyle = 'rgba(18,20,24,0.25)';
  g.fillRect(112, 0, 46, 512);
  g.fillRect(354, 0, 46, 512);
  rg.fillStyle = 'rgba(105,105,105,0.4)';
  rg.fillRect(112, 0, 46, 512);
  rg.fillRect(354, 0, 46, 512);
  // A couple of darker repair patches, edges feathered by hand.
  for (let k = 0; k < 3; k++) {
    const px = rnd() * 420;
    const py = rnd() * 420;
    const pw = 60 + rnd() * 50;
    const ph = 40 + rnd() * 60;
    g.fillStyle = 'rgba(20,22,26,0.55)';
    g.fillRect(px, py, pw, ph);
    g.fillStyle = 'rgba(20,22,26,0.25)';
    g.fillRect(px - 4, py - 4, pw + 8, ph + 8);
    rg.fillStyle = 'rgba(90,90,90,0.5)';
    rg.fillRect(px, py, pw, ph);
  }
  // Hairline cracks wandering down the tile.
  g.strokeStyle = 'rgba(12,12,16,0.5)';
  g.lineWidth = 1.2;
  for (let k = 0; k < 7; k++) {
    let x = rnd() * 512;
    let y = rnd() * 512;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rnd() - 0.5) * 42;
      y += rnd() * 36;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Centre dash, worn: fainter than fresh paint, and scrubbed away in
  // two places where the wheels cross it.
  g.fillStyle = 'rgba(216,200,144,0.62)';
  g.fillRect(248, 64, 16, 176);
  g.fillStyle = '#2e3138';
  g.fillRect(248, 108, 16, 22);
  g.fillRect(248, 186, 16, 14);
  // Edge lines, also faded.
  g.fillStyle = 'rgba(200,200,190,0.4)';
  g.fillRect(10, 0, 12, 512);
  g.fillRect(490, 0, 12, 512);
  memo.asphalt = {
    map: toTex(c),
    roughnessMap: toTex(rc, { srgb: false }),
  };
  return memo.asphalt;
}

// ------------------------------------------------------------ pavement

// Paver tiles with a lived-in spread: most tiles are the warm base tone,
// a share are darker from damp and wear, a few carry a stain blotch, and
// one or two in a run are cracked right across. The joints stay dark so
// the grid reads, but no two tiles are quite the same.
export function sidewalkMap() {
  if (memo.sidewalk) return memo.sidewalk;
  const rnd = rand(9102);
  const [c, g] = newCanvas(512, 512);
  g.fillStyle = '#8b8378';
  g.fillRect(0, 0, 512, 512);
  const tile = 64;
  for (let y = 0; y < 512; y += tile) {
    for (let x = 0; x < 512; x += tile) {
      const roll = rnd();
      let d = Math.floor((rnd() - 0.5) * 20);
      if (roll < 0.16) d -= 26; // darker, worn tile
      g.fillStyle = 'rgb(' + (142 + d) + ',' + (134 + d) + ',' + (122 + d) + ')';
      g.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      if (roll >= 0.16 && roll < 0.24) {
        // Stain blotch: a soft dark bloom in the middle of the tile.
        const sx = x + 14 + rnd() * 22;
        const sy = y + 14 + rnd() * 22;
        const sr = 8 + rnd() * 12;
        const grad = g.createRadialGradient(sx, sy, 1, sx, sy, sr);
        grad.addColorStop(0, 'rgba(40,34,28,0.5)');
        grad.addColorStop(1, 'rgba(40,34,28,0)');
        g.fillStyle = grad;
        g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }
      if (roll >= 0.24 && roll < 0.29) {
        // Crack right across the tile, jagged.
        g.strokeStyle = 'rgba(38,32,26,0.65)';
        g.lineWidth = 1.6;
        let cx = x + rnd() * 20;
        let cy = y + 2;
        g.beginPath();
        g.moveTo(cx, cy);
        while (cy < y + tile - 2) {
          cx += (rnd() - 0.5) * 16;
          cy += 8 + rnd() * 10;
          g.lineTo(cx, cy);
        }
        g.stroke();
      }
    }
  }
  g.strokeStyle = 'rgba(52,47,43,0.6)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += tile) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  for (let i = 0; i < 4200; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,250,240,0.06)' : 'rgba(28,24,20,0.09)';
    g.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
  memo.sidewalk = toTex(c);
  return memo.sidewalk;
}

// ------------------------------------------------------------ facades

const FACADE_STYLES = [
  { wall: '#c7b8a1', trim: '#9e8f7a', glass: '#263445', cols: 6, rows: 10, rough: 0.8, metal: 0.05 },
  { wall: '#4a5a6a', trim: '#2f3c4a', glass: '#1d2d3e', cols: 8, rows: 12, rough: 0.3, metal: 0.45 },
  { wall: '#d6a98e', trim: '#b58468', glass: '#2a3340', cols: 6, rows: 8, rough: 0.75, metal: 0.08 },
  { wall: '#7e7975', trim: '#595552', glass: '#222a33', cols: 5, rows: 8, rough: 0.85, metal: 0.05 },
  { wall: '#a85848', trim: '#7a3a30', glass: '#2a3340', cols: 6, rows: 9, rough: 0.8, metal: 0.05 },
];

// One facade style: a window grid over a grainy wall, with a matching
// emissive canvas where only the lit windows glow. The windows are not
// all the same size — a few are wider or taller than their neighbours —
// and a few carry a balcony slab with a railing, or a grey air-conditioner
// box tucked under the sill. About two in five windows are lit, warm gold
// or cool white, so the face glows at dusk instead of reading flat.
export function facadeMaps(styleIdx) {
  const key = 'facade' + (styleIdx % FACADE_STYLES.length);
  if (memo[key]) return memo[key];
  const st = FACADE_STYLES[styleIdx % FACADE_STYLES.length];
  const rnd = rand(9200 + styleIdx);
  const [c, g] = newCanvas(512, 512);
  const [ec, eg] = newCanvas(512, 512);
  g.fillStyle = st.wall;
  g.fillRect(0, 0, 512, 512);
  eg.fillStyle = '#000000';
  eg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3200; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
    g.fillRect(rnd() * 512, rnd() * 512, 3, 3);
  }
  const cw = 512 / st.cols;
  const rh = 512 / st.rows;
  for (let r = 0; r < st.rows; r++) {
    g.fillStyle = st.trim;
    g.fillRect(0, r * rh, 512, 4);
    for (let col = 0; col < st.cols; col++) {
      // Windows vary: most are the grid size, some are wider or taller.
      let ww = cw * 0.64;
      let wh = rh * 0.62;
      const vw = rnd();
      if (vw < 0.12) ww *= 1.35;
      else if (vw < 0.2) wh *= 1.3;
      const wx = col * cw + (cw - ww) / 2;
      const wy = r * rh + (rh - wh) / 2;
      g.fillStyle = st.trim;
      g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
      g.fillStyle = st.glass;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(wx, wy + wh * 0.48, ww, 2);
      // Balcony slab + railing under some upper-floor windows.
      if (r > 0 && rnd() < 0.12) {
        g.fillStyle = 'rgba(210,200,185,0.9)';
        g.fillRect(wx - 4, wy + wh + 2, ww + 8, 5);
        g.strokeStyle = 'rgba(40,36,32,0.8)';
        g.lineWidth = 1.5;
        for (let b = 0; b <= 4; b++) {
          const bx = wx - 4 + ((ww + 8) / 4) * b;
          g.beginPath(); g.moveTo(bx, wy + wh + 7); g.lineTo(bx, wy + wh + 18); g.stroke();
        }
        g.beginPath(); g.moveTo(wx - 4, wy + wh + 18); g.lineTo(wx + ww + 4, wy + wh + 18); g.stroke();
      } else if (rnd() < 0.15) {
        // Air-conditioner box under the sill.
        g.fillStyle = '#9aa0a8';
        g.fillRect(wx + ww * 0.2, wy + wh + 3, ww * 0.5, 10);
        g.fillStyle = 'rgba(40,40,44,0.7)';
        g.fillRect(wx + ww * 0.2, wy + wh + 6, ww * 0.5, 2);
      }
      if (rnd() < 0.42) {
        const warm = rnd() < 0.72;
        const lit = warm ? '#ffcf86' : '#cfe8ff';
        g.fillStyle = lit;
        g.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        eg.fillStyle = warm ? '#ffb85c' : '#a8d4ff';
        eg.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      }
    }
  }
  memo[key] = {
    map: toTex(c),
    emissiveMap: toTex(ec),
    roughness: st.rough,
    metalness: st.metal,
  };
  return memo[key];
}

// ------------------------------------------------------------ glow

// One shared radial glow: a white-hot centre fading to transparent.
// Callers tint it through the sprite material's colour instead of baking
// a colour into the texture, so lamps, headlights, light bars and the low
// sun all reuse the same canvas. Callers that need hard edges set
// ClampToEdge themselves.
export function glowTexture() {
  if (memo.glow) return memo.glow;
  const [c, g] = newCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,240,210,0.65)');
  grad.addColorStop(0.6, 'rgba(255,190,120,0.18)');
  grad.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  memo.glow = toTex(c);
  memo.glow.wrapS = THREE.ClampToEdgeWrapping;
  memo.glow.wrapT = THREE.ClampToEdgeWrapping;
  return memo.glow;
}

// ------------------------------------------------------------ signs

// Neon sign plate: an opaque dark backing (so no mirrored text can bleed
// through from behind) with a coloured frame and glowing centred text.
export function signTexture(text, opts) {
  const o = opts || {};
  const bg = o.bg || '#151822';
  const fg = o.fg || '#fff4e0';
  const border = o.border || '#ff5e99';
  const [c, g] = newCanvas(512, 128);
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = border;
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 112);
  g.font = 'bold 56px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = border;
  g.shadowBlur = 14;
  g.fillStyle = fg;
  g.fillText(text, 256, 66);
  const t = toTex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------ wheels

// Alloy wheel face: dark tyre ring, bright five-spoke hub, centre cap.
// Painted on the hub disc of each wheel so the wheels read as wheels
// instead of black cylinders.
export function wheelTexture() {
  if (memo.wheel) return memo.wheel;
  const [c, g] = newCanvas(128, 128);
  g.fillStyle = '#181a1e';
  g.fillRect(0, 0, 128, 128);
  g.beginPath();
  g.arc(64, 64, 44, 0, Math.PI * 2);
  g.fillStyle = '#9aa3ad';
  g.fill();
  g.beginPath();
  g.arc(64, 64, 36, 0, Math.PI * 2);
  g.fillStyle = '#252930';
  g.fill();
  g.strokeStyle = '#cfd6de';
  g.lineWidth = 6;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40);
    g.stroke();
  }
  g.beginPath();
  g.arc(64, 64, 10, 0, Math.PI * 2);
  g.fillStyle = '#d8dee6';
  g.fill();
  memo.wheel = toTex(c);
  return memo.wheel;
}

// ------------------------------------------------------------ plates

// Licence plate: pale plate, dark blue top strip, dark code text.
export function plateTexture(code) {
  const [c, g] = newCanvas(128, 48);
  g.fillStyle = '#f4f0e2';
  g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#1b4f8a';
  g.fillRect(0, 0, 128, 12);
  g.fillStyle = '#1a1d24';
  g.font = 'bold 24px monospace';
  g.textAlign = 'center';
  g.fillText(code, 64, 38);
  return toTex(c);
}
