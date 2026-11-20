// Solmar City — procedural canvas textures: asphalt, sidewalks,
// facades, glow, wheels, plates. Everything is drawn in code, so the
// game makes zero network requests for art.
// The look is soft, not pixelated: every surface uses smooth gradients
// and lightly blurred noise instead of hard square speckles, and the
// canvases are 1024x1024 so the detail holds up close. A window at
// dusk is a sky gradient — orange at the bottom fading to deep blue —
// with the lit ones glowing warm, so the facades catch the sunset
// instead of looking flat. Filters are Linear + LinearMipmapLinear
// with anisotropy 8, so the textures stay smooth at glancing angles.

import * as THREE from '../vendor/three.module.min.js';

const SIZE = 1024;

// A tiny seeded generator (LCG) so the noise is stable per run: the
// same seed paints the same surfaces every time, so a screenshot taken
// today matches one taken tomorrow.
let seedState = 987654321;
function dice() {
  seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0;
  return seedState / 4294967296;
}

// A canvas with a 2d context, ready to paint on.
function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')];
}

// Hex colour -> rgba() string with the given alpha, so a gradient can
// fade from the colour to transparent instead of to transparent black.
function hexWithAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// A soft round blotch: a radial gradient that is the colour at full
// strength in the centre and fades to nothing at the edge. This is the
// replacement for the old hard 2x2/3x3 fillRect speckles everywhere.
function softSpot(pen, x, y, radius, colour, alpha) {
  const grad = pen.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, hexWithAlpha(colour, alpha));
  grad.addColorStop(1, hexWithAlpha(colour, 0));
  pen.fillStyle = grad;
  pen.beginPath();
  pen.arc(x, y, radius, 0, Math.PI * 2);
  pen.fill();
}

// Wrap a painted canvas as a texture: linear filtering both ways and
// anisotropy 8, so it stays smooth at a glancing angle.
function wrapTex(canvas, repeatX, repeatY) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX || 1, repeatY || 1);
  return tex;
}

export function asphaltMaps() {
  const [canvas, pen] = makeCanvas(SIZE, SIZE);
  const [roughCanvas, rough] = makeCanvas(SIZE, SIZE);
  // The base is a vertical gradient, darker at the edges, so the road
  // reads as one surface with a worn centre instead of a flat slab.
  const base = pen.createLinearGradient(0, 0, 0, SIZE);
  base.addColorStop(0, '#23262b');
  base.addColorStop(0.5, '#2e3238');
  base.addColorStop(1, '#23262b');
  pen.fillStyle = base;
  pen.fillRect(0, 0, SIZE, SIZE);
  const roughBase = rough.createLinearGradient(0, 0, 0, SIZE);
  roughBase.addColorStop(0, '#8a8a8a');
  roughBase.addColorStop(0.5, '#a8a8a8');
  roughBase.addColorStop(1, '#8a8a8a');
  rough.fillStyle = roughBase;
  rough.fillRect(0, 0, SIZE, SIZE);
  // Wear: soft light and dark blotches scattered across the surface,
  // never hard square noise.
  for (let i = 0; i < 90; i += 1) {
    const x = dice() * SIZE;
    const y = dice() * SIZE;
    const r = 20 + dice() * 70;
    softSpot(pen, x, y, r, dice() < 0.5 ? '#3a3e45' : '#1a1c20', 0.35);
    softSpot(rough, x, y, r, dice() < 0.5 ? '#c8c8c8' : '#707070', 0.5);
  }
  // Polished tyre bands where the wheels run: two soft horizontal
  // streaks, slightly lighter and smoother (lower roughness) than the
  // rest, so the dusk sun catches them.
  for (const bandY of [SIZE * 0.28, SIZE * 0.72]) {
    const band = pen.createLinearGradient(0, bandY - 60, 0, bandY + 60);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.5, 'rgba(120,130,145,0.22)');
    band.addColorStop(1, 'rgba(0,0,0,0)');
    pen.fillStyle = band;
    pen.fillRect(0, bandY - 60, SIZE, 120);
    const roughBand = rough.createLinearGradient(0, bandY - 60, 0, bandY + 60);
    roughBand.addColorStop(0, 'rgba(0,0,0,0)');
    roughBand.addColorStop(0.5, 'rgba(40,40,40,0.5)');
    roughBand.addColorStop(1, 'rgba(0,0,0,0)');
    rough.fillStyle = roughBand;
    rough.fillRect(0, bandY - 60, SIZE, 120);
  }
  // Repair patches: dark rectangles with soft feathered edges, not
  // hard-edged boxes, plus a few hairline cracks.
  for (let i = 0; i < 5; i += 1) {
    const px = dice() * SIZE * 0.8;
    const py = dice() * SIZE * 0.8;
    const pw = 120 + dice() * 160;
    const ph = 80 + dice() * 120;
    pen.filter = 'blur(2px)';
    pen.fillStyle = 'rgba(14,15,18,0.55)';
    pen.fillRect(px, py, pw, ph);
    pen.filter = 'none';
    rough.fillStyle = 'rgba(60,60,60,0.6)';
    rough.fillRect(px, py, pw, ph);
  }
  for (let i = 0; i < 12; i += 1) {
    pen.strokeStyle = 'rgba(10,10,12,0.5)';
    pen.lineWidth = 2;
    pen.beginPath();
    let cx = dice() * SIZE;
    let cy = dice() * SIZE;
    pen.moveTo(cx, cy);
    for (let j = 0; j < 4; j += 1) {
      cx += (dice() - 0.5) * 120;
      cy += (dice() - 0.5) * 60;
      pen.lineTo(cx, cy);
    }
    pen.stroke();
  }
  // Lane markings: a dashed centre line and two solid edge lines. The
  // dashes are worn (alpha 0.75) and the edges are feathered, so they
  // look painted and weathered rather than pasted on.
  const midY = SIZE / 2;
  pen.filter = 'blur(1.5px)';
  pen.fillStyle = 'rgba(230,225,190,0.75)';
  for (let x = 0; x < SIZE; x += 128) {
    pen.fillRect(x, midY - 5, 64, 10);
  }
  pen.fillStyle = 'rgba(230,225,190,0.55)';
  pen.fillRect(0, 30, SIZE, 6);
  pen.fillRect(0, SIZE - 36, SIZE, 6);
  pen.filter = 'none';
  return { map: wrapTex(canvas), roughnessMap: wrapTex(roughCanvas) };
}

export function sidewalkMap() {
  const [canvas, pen] = makeCanvas(SIZE, SIZE);
  // A warm base with a gentle vertical gradient, so the pavement reads
  // as one surface instead of a flat slab.
  const base = pen.createLinearGradient(0, 0, 0, SIZE);
  base.addColorStop(0, '#a89a7f');
  base.addColorStop(1, '#96886f');
  pen.fillStyle = base;
  pen.fillRect(0, 0, SIZE, SIZE);
  // Each tile drifts a little in tone, and a few soft stains sit on the
  // surface — all radial fades, never hard square speckles.
  for (let ty = 0; ty < 4; ty += 1) {
    for (let tx = 0; tx < 4; tx += 1) {
      const drift = dice() * 0.08 - 0.04;
      const tone = drift > 0 ? 'rgba(255,255,255,' + drift.toFixed(2) + ')' : 'rgba(0,0,0,' + (-drift).toFixed(2) + ')';
      pen.fillStyle = tone;
      pen.fillRect(tx * 256, ty * 256, 256, 256);
    }
  }
  for (let i = 0; i < 24; i += 1) {
    softSpot(pen, dice() * SIZE, dice() * SIZE, 30 + dice() * 80, dice() < 0.5 ? '#7a6a50' : '#c8b898', 0.3);
  }
  // A few hairline cracks, then the tile joints.
  for (let i = 0; i < 8; i += 1) {
    pen.strokeStyle = 'rgba(60,50,35,0.4)';
    pen.lineWidth = 1.5;
    pen.beginPath();
    let cx = dice() * SIZE;
    let cy = dice() * SIZE;
    pen.moveTo(cx, cy);
    for (let j = 0; j < 3; j += 1) {
      cx += (dice() - 0.5) * 100;
      cy += (dice() - 0.5) * 100;
      pen.lineTo(cx, cy);
    }
    pen.stroke();
  }
  pen.strokeStyle = 'rgba(70,60,45,0.6)';
  pen.lineWidth = 4;
  for (let i = 0; i <= 4; i += 1) {
    pen.beginPath();
    pen.moveTo(i * 256, 0);
    pen.lineTo(i * 256, SIZE);
    pen.stroke();
    pen.beginPath();
    pen.moveTo(0, i * 256);
    pen.lineTo(SIZE, i * 256);
    pen.stroke();
  }
  return wrapTex(canvas);
}

// Facade styles, each with a wall colour, a trim colour and a window
// layout. Windows are the dusk sky in miniature: a vertical gradient
// from warm orange at the bottom to deep blue at the top, so they
// reflect the sunset. Lit windows glow warm, and that glow is baked
// into the emissive map too, so they shine at dusk.
const STYLES = [
  { wall: '#8a6a4a', trim: '#6a4a30', cols: 4, rows: 5 },
  { wall: '#a08a6a', trim: '#7a6248', cols: 5, rows: 6 },
  { wall: '#7a5a6a', trim: '#5a3a4a', cols: 4, rows: 6 },
  { wall: '#6a7a8a', trim: '#4a5a6a', cols: 5, rows: 5 },
  { wall: '#9a4a3a', trim: '#7a3226', cols: 4, rows: 5 },
];

export function facadeMaps(styleIdx) {
  const style = STYLES[styleIdx % STYLES.length];
  const [canvas, pen] = makeCanvas(SIZE, SIZE);
  const [emitCanvas, emit] = makeCanvas(SIZE, SIZE);
  // The wall: a vertical wash, lighter at the top where the sunset
  // catches it, with soft tonal drift instead of hard square speckles.
  const wash = pen.createLinearGradient(0, 0, 0, SIZE);
  wash.addColorStop(0, style.wall);
  wash.addColorStop(1, style.trim);
  pen.fillStyle = wash;
  pen.fillRect(0, 0, SIZE, SIZE);
  emit.fillStyle = '#000000';
  emit.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 40; i += 1) {
    softSpot(pen, dice() * SIZE, dice() * SIZE, 40 + dice() * 90, dice() < 0.5 ? style.trim : style.wall, 0.3);
  }
  // Windows in a grid. Unlit ones are the dusk sky gradient; lit ones
  // are a warm radial glow, and the glow is drawn into the emissive
  // map as well so they shine.
  const margin = 90;
  const winW = (SIZE - margin * 2 - (style.cols - 1) * 40) / style.cols;
  const winH = (SIZE - margin * 2 - (style.rows - 1) * 36) / style.rows;
  for (let r = 0; r < style.rows; r += 1) {
    for (let c = 0; c < style.cols; c += 1) {
      const x = margin + c * (winW + 40);
      const y = margin + r * (winH + 36);
      // The sky reflected in the glass: orange at the bottom, deep
      // blue at the top.
      const sky = pen.createLinearGradient(0, y + winH, 0, y);
      sky.addColorStop(0, '#ff9a3a');
      sky.addColorStop(0.5, '#c86a8a');
      sky.addColorStop(1, '#2a3a6a');
      pen.fillStyle = sky;
      pen.fillRect(x, y, winW, winH);
      // A frame around each window.
      pen.strokeStyle = style.trim;
      pen.lineWidth = 6;
      pen.strokeRect(x, y, winW, winH);
      // About 42% of the windows are lit: a warm radial glow in both
      // the colour map and the emissive map.
      if (dice() < 0.42) {
        const glow = pen.createRadialGradient(x + winW / 2, y + winH / 2, 4, x + winW / 2, y + winH / 2, winW * 0.7);
        glow.addColorStop(0, 'rgba(255,214,130,0.95)');
        glow.addColorStop(1, 'rgba(255,180,80,0.25)');
        pen.fillStyle = glow;
        pen.fillRect(x, y, winW, winH);
        const emitGlow = emit.createRadialGradient(x + winW / 2, y + winH / 2, 4, x + winW / 2, y + winH / 2, winW * 0.7);
        emitGlow.addColorStop(0, 'rgba(255,200,110,0.9)');
        emitGlow.addColorStop(1, 'rgba(255,170,70,0.2)');
        emit.fillStyle = emitGlow;
        emit.fillRect(x, y, winW, winH);
      }
    }
  }
  // A darker plinth at the base, and a few balconies and air-con boxes
  // for depth: small rectangles with a soft shadow beneath them.
  pen.fillStyle = 'rgba(0,0,0,0.25)';
  pen.fillRect(0, SIZE - 60, SIZE, 60);
  for (let i = 0; i < 6; i += 1) {
    const bx = margin + dice() * (SIZE - margin * 2 - 90);
    const by = margin + dice() * (SIZE - margin * 2 - 60);
    pen.fillStyle = 'rgba(0,0,0,0.3)';
    pen.fillRect(bx + 4, by + 8, 90, 8);
    pen.fillStyle = style.trim;
    pen.fillRect(bx, by, 90, 10);
  }
  for (let i = 0; i < 5; i += 1) {
    const ax = margin + dice() * (SIZE - margin * 2 - 60);
    const ay = margin + dice() * (SIZE - margin * 2 - 40);
    pen.fillStyle = '#c8c8c8';
    pen.fillRect(ax, ay, 60, 40);
    pen.fillStyle = 'rgba(0,0,0,0.2)';
    pen.fillRect(ax, ay + 40, 60, 4);
  }
  const map = wrapTex(canvas);
  const emissiveMap = wrapTex(emitCanvas);
  return { map, emissiveMap };
}

// One shared radial glow texture (lamps, headlights, light bars): a
// soft white-hot centre fading to transparent. Callers tint it with
// the sprite material's colour instead of baking a colour in.
let sharedGlow = null;
export function glowTexture() {
  if (sharedGlow) return sharedGlow;
  const [canvas, pen] = makeCanvas(128, 128);
  const grad = pen.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  pen.fillStyle = grad;
  pen.fillRect(0, 0, 128, 128);
  sharedGlow = new THREE.CanvasTexture(canvas);
  return sharedGlow;
}

// A wheel: a dark tyre with a lighter rim and five spokes, drawn once
// and shared by every car.
export function wheelTexture() {
  const [canvas, pen] = makeCanvas(128, 128);
  pen.fillStyle = '#14161a';
  pen.beginPath();
  pen.arc(64, 64, 62, 0, Math.PI * 2);
  pen.fill();
  pen.fillStyle = '#3a3d42';
  pen.beginPath();
  pen.arc(64, 64, 40, 0, Math.PI * 2);
  pen.fill();
  pen.fillStyle = '#c8ccd2';
  pen.beginPath();
  pen.arc(64, 64, 28, 0, Math.PI * 2);
  pen.fill();
  // Five spokes.
  pen.fillStyle = '#8a8e94';
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    pen.save();
    pen.translate(64, 64);
    pen.rotate(a);
    pen.fillRect(-4, -26, 8, 26);
    pen.restore();
  }
  pen.fillStyle = '#2c2f36';
  pen.beginPath();
  pen.arc(64, 64, 8, 0, Math.PI * 2);
  pen.fill();
  return new THREE.CanvasTexture(canvas);
}

// A licence plate: white, with dark text. The code is passed in, so
// each car gets its own plate.
export function plateTexture(code) {
  const [canvas, pen] = makeCanvas(256, 64);
  pen.fillStyle = '#f2f2f2';
  pen.fillRect(0, 0, 256, 64);
  pen.strokeStyle = '#2c2f36';
  pen.lineWidth = 4;
  pen.strokeRect(2, 2, 252, 60);
  pen.fillStyle = '#1c1e22';
  pen.font = 'bold 36px Arial, sans-serif';
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  pen.fillText(code, 128, 34);
  return new THREE.CanvasTexture(canvas);
}
