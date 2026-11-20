// Solmar City — procedural texture library (ES module).
// Every surface in the city is painted by these canvas textures at boot:
// asphalt with a roughness map, sidewalk pavers, four building facades
// with lit-window emissive maps, a shared radial glow, neon sign plates,
// wheel hubs and licence plates. No image files, no network requests —
// the same fixed seed paints the same textures on every run, so the
// screenshots are stable between runs.

import * as THREE from '../vendor/three.module.min.js';

// Tiny seeded generator (LCG) so texture noise is identical every boot.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function blankCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(canvas, { srgb = true, rx = 1, ry = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

const cache = {};

// ---------------------------------------------------------------- asphalt

// Warm dusk asphalt: speckled base, two polished wheel-wear bands where
// tyres have smoothed the surface, and a few hairline cracks. The paired
// roughness canvas makes the wear bands slightly glossier than the rest.
export function asphaltMaps() {
  if (cache.asphalt) return cache.asphalt;
  const rnd = seeded(9101);
  const [c, g] = blankCanvas(512, 512);
  const [rc, rg] = blankCanvas(512, 512);
  g.fillStyle = '#2e3138';
  g.fillRect(0, 0, 512, 512);
  rg.fillStyle = '#c9c9c9';
  rg.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 15000; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const v = 36 + Math.floor(rnd() * 26);
    g.fillStyle = `rgb(${v},${v + 1},${v + 5})`;
    g.fillRect(x, y, 2, 2);
    const rv = 150 + Math.floor(rnd() * 90);
    rg.fillStyle = `rgb(${rv},${rv},${rv})`;
    rg.fillRect(x, y, 2, 2);
  }
  // Polished bands under the wheel tracks.
  g.fillStyle = 'rgba(18,20,24,0.25)';
  g.fillRect(112, 0, 46, 512);
  g.fillRect(354, 0, 46, 512);
  rg.fillStyle = 'rgba(105,105,105,0.4)';
  rg.fillRect(112, 0, 46, 512);
  rg.fillRect(354, 0, 46, 512);
  // Hairline cracks wandering down the tile.
  g.strokeStyle = 'rgba(12,12,16,0.5)';
  g.lineWidth = 1.2;
  for (let k = 0; k < 6; k++) {
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
  // Centre dash + edge lines, painted once per tile so the road's repeat
  // lays them down the whole street.
  g.fillStyle = '#d8c890';
  g.fillRect(248, 64, 16, 176); // centre dash
  g.fillStyle = 'rgba(200,200,190,0.5)';
  g.fillRect(10, 0, 12, 512);
  g.fillRect(490, 0, 12, 512);
  cache.asphalt = {
    map: finish(c),
    roughnessMap: finish(rc, { srgb: false }),
  };
  return cache.asphalt;
}

// ---------------------------------------------------------------- sidewalk

// Warm paver tiles with jittered tone, dark joints and a little grit, so
// the ground between the roads stops reading as one flat brown plane.
export function sidewalkMap() {
  if (cache.sidewalk) return cache.sidewalk;
  const rnd = seeded(9102);
  const [c, g] = blankCanvas(512, 512);
  g.fillStyle = '#8b8378';
  g.fillRect(0, 0, 512, 512);
  const tile = 64;
  for (let y = 0; y < 512; y += tile) {
    for (let x = 0; x < 512; x += tile) {
      const d = Math.floor((rnd() - 0.5) * 20);
      g.fillStyle = `rgb(${142 + d},${134 + d},${122 + d})`;
      g.fillRect(x + 2, y + 2, tile - 4, tile - 4);
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
  cache.sidewalk = finish(c);
  return cache.sidewalk;
}

// ---------------------------------------------------------------- facades

const FACADE_STYLES = [
  { wall: '#c7b8a1', trim: '#9e8f7a', glass: '#263445', cols: 6, rows: 10, rough: 0.8, metal: 0.05 },
  { wall: '#4a5a6a', trim: '#2f3c4a', glass: '#1d2d3e', cols: 8, rows: 12, rough: 0.3, metal: 0.45 },
  { wall: '#d6a98e', trim: '#b58468', glass: '#2a3340', cols: 6, rows: 8, rough: 0.75, metal: 0.08 },
  { wall: '#7e7975', trim: '#595552', glass: '#222a33', cols: 5, rows: 8, rough: 0.85, metal: 0.05 },
];

// One facade style: a window grid over a grainy wall, plus a matching
// emissive canvas where only the lit windows glow. About two in five
// windows are lit, warm gold or cool white, like the old hand-rolled
// window texture — now with a real emissive map so the light blooms.
export function facadeMaps(styleIdx) {
  const key = 'facade' + (styleIdx % FACADE_STYLES.length);
  if (cache[key]) return cache[key];
  const st = FACADE_STYLES[styleIdx % FACADE_STYLES.length];
  const rnd = seeded(9200 + styleIdx);
  const [c, g] = blankCanvas(512, 512);
  const [ec, eg] = blankCanvas(512, 512);
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
      const wx = col * cw + cw * 0.18;
      const wy = r * rh + rh * 0.2;
      const ww = cw * 0.64;
      const wh = rh * 0.62;
      g.fillStyle = st.trim;
      g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
      g.fillStyle = st.glass;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(wx, wy + wh * 0.48, ww, 2);
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
  cache[key] = {
    map: finish(c),
    emissiveMap: finish(ec),
    roughness: st.rough,
    metalness: st.metal,
  };
  return cache[key];
}

// ---------------------------------------------------------------- glow

// One shared radial glow: a white-hot centre fading to transparent.
// Callers tint it through the sprite material's colour instead of baking
// a colour into the texture, so lamps, headlights and light bars all reuse
// the same canvas. Callers that need hard edges set ClampToEdge themselves.
export function glowTexture() {
  if (cache.glow) return cache.glow;
  const [c, g] = blankCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,240,210,0.65)');
  grad.addColorStop(0.6, 'rgba(255,190,120,0.18)');
  grad.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  cache.glow = finish(c);
  cache.glow.wrapS = THREE.ClampToEdgeWrapping;
  cache.glow.wrapT = THREE.ClampToEdgeWrapping;
  return cache.glow;
}

// ---------------------------------------------------------------- signs

// Neon sign plate: an opaque dark backing (so no mirrored text can bleed
// through from behind) with a coloured frame and glowing centred text.
export function signTexture(text, { bg = '#151822', fg = '#fff4e0', border = '#ff5e99' } = {}) {
  const [c, g] = blankCanvas(512, 128);
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
  const t = finish(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------- wheels

// Alloy wheel face: dark tyre ring, bright five-spoke hub, centre cap.
// Painted on the hub disc of each wheel so the wheels read as wheels
// instead of black cylinders.
export function wheelTexture() {
  if (cache.wheel) return cache.wheel;
  const [c, g] = blankCanvas(128, 128);
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
  cache.wheel = finish(c);
  return cache.wheel;
}

// ---------------------------------------------------------------- plates

// Licence plate: pale plate, dark blue top strip, dark code text.
export function plateTexture(code) {
  const [c, g] = blankCanvas(128, 48);
  g.fillStyle = '#f4f0e2';
  g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#1b4f8a';
  g.fillRect(0, 0, 128, 12);
  g.fillStyle = '#1a1d24';
  g.font = 'bold 24px monospace';
  g.textAlign = 'center';
  g.fillText(code, 64, 38);
  return finish(c);
}
