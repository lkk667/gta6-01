// Solmar City — pedestrians.
// Every person in the city is assembled here: lathe-turned body parts with
// real proportions (7.5 heads), two-segment limbs, an independent neck, and a
// painted canvas face. Geometries and materials are cached and shared across
// all forty pedestrians, so the whole crowd costs almost nothing to build.

import * as THREE from '../vendor/three.module.min.js';

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

const SKIN_TONES = [0xe8b98a, 0xd9a06e, 0xc98a5a, 0xf2c9a0, 0xb87a4e, 0x8a5a38];
const SHORTS = [0x3a5a8a, 0xe8e8e8, 0x2c2f36, 0xd8a03a, 0x4a7a5a, 0x8a4a2a];
const TROUSERS = [0x2c3a5a, 0x3a3d42, 0x5a4a3a, 0x2c2f36, 0x4a5a6a];
const SHIRTS = [0x3a5a8a, 0xe8e8e8, 0xd8a03a, 0x4a7a5a, 0x8a4a2a, 0x5a3a6a, 0x2c8a8a, 0xc05a5a];
const HAIR = [0x1c1410, 0x3a2a1a, 0x6a4a28, 0x8a8a8a, 0xd8b878];
const NAVY = 0x1c2a4a;
const VEST_ORANGE = 0xe86a1a;

// ---------------------------------------------------------------------------
// Shared caches: one lathe per body part, one material per colour
// ---------------------------------------------------------------------------

const geoCache = new Map();
const matCache = new Map();

function pickFrom(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

// A tiny deterministic generator so a crowd built twice looks the same.
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

let pedCounter = 0;

function materialFor(hex, rough) {
  const key = hex + '|' + rough;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0.02 });
    matCache.set(key, m);
  }
  return m;
}

// Turn a list of [radius, height] pairs into a lathe, cached by part name.
function latheFor(name, profile) {
  let g = geoCache.get(name);
  if (!g) {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    g = new THREE.LatheGeometry(pts, 14);
    geoCache.set(name, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Lathe profiles — [radius, height], heights run downward for hanging limbs
// ---------------------------------------------------------------------------

const PROFILES = {
  torso: [
    [0.001, 0], [0.15, 0], [0.168, 0.05], [0.155, 0.16], [0.165, 0.28],
    [0.185, 0.4], [0.19, 0.46], [0.16, 0.52], [0.1, 0.56], [0.001, 0.57],
  ],
  thigh: [
    [0.001, 0], [0.088, 0], [0.09, -0.06], [0.075, -0.2], [0.062, -0.32],
    [0.055, -0.38], [0.001, -0.38],
  ],
  calf: [
    [0.001, 0], [0.058, 0], [0.055, -0.06], [0.045, -0.18], [0.036, -0.3],
    [0.04, -0.34], [0.001, -0.36],
  ],
  upperArm: [
    [0.001, 0], [0.055, 0], [0.052, -0.05], [0.044, -0.16], [0.038, -0.26],
    [0.001, -0.28],
  ],
  forearm: [
    [0.001, 0], [0.04, 0], [0.037, -0.05], [0.031, -0.16], [0.027, -0.24],
    [0.001, -0.26],
  ],
  neck: [
    [0.001, 0], [0.048, 0], [0.045, 0.04], [0.038, 0.08], [0.001, 0.09],
  ],
  shoe: [
    [0.001, 0], [0.05, 0], [0.055, 0.02], [0.05, 0.05], [0.03, 0.07],
    [0.001, 0.07],
  ],
  capTop: [
    [0.001, 0], [0.115, 0], [0.118, 0.02], [0.09, 0.05], [0.001, 0.055],
  ],
};

// ---------------------------------------------------------------------------
// Faces — a 256x256 canvas wrapped on the head sphere
// ---------------------------------------------------------------------------

function faceTexture(skinHex, hairHex, shades) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  // skin: a soft vertical gradient, lighter toward the brow
  const skin = ctx.createLinearGradient(0, 0, 0, 256);
  skin.addColorStop(0, '#f6d3ae');
  skin.addColorStop(0.5, '#e8b98a');
  skin.addColorStop(1, '#c98a5a');
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 256, 256);
  // tint the gradient toward this pedestrian's skin tone
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#' + skinHex.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalAlpha = 1;

  // hair cap across the top of the sphere (canvas y = 0 is the crown)
  ctx.fillStyle = '#' + hairHex.toString(16).padStart(6, '0');
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(256, 0);
  ctx.lineTo(256, 52);
  ctx.quadraticCurveTo(128, 92, 0, 52);
  ctx.closePath();
  ctx.fill();

  // The face sits on the +Z side of the sphere, which is canvas x = 64
  // (u = 0.25) and around the equator (canvas y = 128).
  const cx = 64;
  const eyeY = 118;
  const eyeDX = 17;
  if (shades) {
    // sunglasses: two dark lenses and a bridge
    ctx.fillStyle = 'rgba(12,12,16,0.96)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(cx + s * eyeDX - 13, eyeY - 9, 26, 17, 7);
      ctx.fill();
    }
    ctx.fillRect(cx - 5, eyeY - 3, 10, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.roundRect(cx - eyeDX - 10, eyeY - 7, 8, 5, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx + eyeDX - 10, eyeY - 7, 8, 5, 2);
    ctx.fill();
  } else {
    // eyebrows
    ctx.strokeStyle = 'rgba(40,24,14,0.85)';
    ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * eyeDX - 10, eyeY - 14);
      ctx.quadraticCurveTo(cx + s * eyeDX, eyeY - 18, cx + s * eyeDX + 10, eyeY - 13);
      ctx.stroke();
    }
    // eyes: white, dark iris, tiny glint
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#f8f4ee';
      ctx.beginPath();
      ctx.ellipse(cx + s * eyeDX, eyeY, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a1c12';
      ctx.beginPath();
      ctx.arc(cx + s * eyeDX, eyeY, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + s * eyeDX + 1.2, eyeY - 1.2, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // nose: a soft shadow line
  ctx.strokeStyle = 'rgba(120,70,40,0.4)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + 8);
  ctx.lineTo(cx - 1.5, eyeY + 22);
  ctx.stroke();
  // mouth
  ctx.strokeStyle = 'rgba(120,50,40,0.75)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - 9, eyeY + 38);
  ctx.quadraticCurveTo(cx, eyeY + 43, cx + 9, eyeY + 38);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return tex;
}

function badgeTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  // gold star on a dark disc
  ctx.fillStyle = '#1c2a4a';
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 20 : 8;
    const x = 32 + Math.cos(a) * r;
    const y = 32 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let cachedBadge = null;
let cachedExclaim = null;

// The witness "!" every pedestrian carries: a red exclamation that floats
// above the head. traffic.js flips its visibility while the ped is a
// witness to a crime, so it must exist on every pedestrian, police or not.
function exclaimTexture() {
  if (cachedExclaim) return cachedExclaim;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#ff2a2a';
  ctx.font = 'bold 52px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 6;
  ctx.strokeText('!', 32, 33);
  ctx.fillText('!', 32, 33);
  cachedExclaim = new THREE.CanvasTexture(c);
  cachedExclaim.colorSpace = THREE.SRGBColorSpace;
  return cachedExclaim;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function assemblePedestrian(role) {
  const rng = seededRand((pedCounter++ * 7919 + 13) | 0);
  const picked = role === undefined
    ? (rng() < 0.55 ? 'beach' : 'casual')
    : role;

  const skin = pickFrom(rng, SKIN_TONES);
  const hair = pickFrom(rng, HAIR);
  const shirt = pickFrom(rng, SHIRTS);
  const shorts = pickFrom(rng, SHORTS);
  const trousers = pickFrom(rng, TROUSERS);
  const shades = rng() < 0.4;

  const skinMat = materialFor(skin, 0.6);
  const shirtMat = materialFor(picked === 'worker' ? VEST_ORANGE : picked === 'police' ? NAVY : shirt, 0.85);
  const legMat = materialFor(
    picked === 'police' ? NAVY : picked === 'worker' ? 0x2c2f36 : picked === 'beach' ? shorts : trousers,
    0.85,
  );
  const calfMat = picked === 'beach' ? skinMat : legMat;
  const armMat = picked === 'beach' ? shirtMat : shirtMat;
  const foreMat = picked === 'beach' ? skinMat : shirtMat;
  const shoeMat = materialFor(picked === 'beach' ? 0x6a4a28 : 0x1c1c1c, 0.7);

  const group = new THREE.Group();

  // --- legs: hip pivots at the pelvis, knee pivots halfway down ---
  function buildLeg(sideX) {
    const hip = new THREE.Group();
    hip.position.set(sideX, 0.8, 0);
    const thigh = new THREE.Mesh(latheFor('thigh', PROFILES.thigh), legMat);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.38, 0);
    const calf = new THREE.Mesh(latheFor('calf', PROFILES.calf), calfMat);
    knee.add(calf);
    if (picked !== 'beach') {
      const shoe = new THREE.Mesh(latheFor('shoe', PROFILES.shoe), shoeMat);
      shoe.scale.set(0.95, 1, 1.7);
      shoe.position.set(0, -0.37, 0.035);
      knee.add(shoe);
    }
    hip.add(knee);
    group.add(hip);
    return { hip, knee };
  }
  const leftLegBuilt = buildLeg(-0.095);
  const rightLegBuilt = buildLeg(0.095);

  // --- torso: the chest group, its base overlapping the pelvis by 0.06 ---
  const chest = new THREE.Group();
  chest.position.set(0, 0.74, 0);
  const torso = new THREE.Mesh(latheFor('torso', PROFILES.torso), shirtMat);
  chest.add(torso);
  // shoulder transition spheres: no light-leak gap where the arms meet
  const shoulderGeo = new THREE.SphereGeometry(0.062, 12, 10);
  for (const s of [-1, 1]) {
    const ball = new THREE.Mesh(shoulderGeo, shirtMat);
    ball.position.set(s * 0.185, 0.5, 0);
    chest.add(ball);
  }
  // harbour worker: two reflective bands around the vest
  if (picked === 'worker') {
    const bandMat = materialFor(0xd8d8d8, 0.4);
    for (const y of [0.18, 0.34]) {
      const band = new THREE.Mesh(latheFor('vestBand', [[0.001, 0], [0.172, 0], [0.172, 0.035], [0.001, 0.035]]), bandMat);
      band.position.y = y;
      chest.add(band);
    }
  }
  // neck: its own short lathe, the head turns above it
  const neck = new THREE.Mesh(latheFor('neck', PROFILES.neck), skinMat);
  neck.position.set(0, 0.55, 0);
  chest.add(neck);
  group.add(chest);

  // --- arms: shoulder pivots on the chest, elbows halfway down ---
  function buildArm(sideX) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sideX, 0.5, 0);
    // arms hang naturally outwards, about 8 degrees from the body
    shoulder.rotation.z = sideX < 0 ? 0.14 : -0.14;
    const upper = new THREE.Mesh(latheFor('upperArm', PROFILES.upperArm), armMat);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.28, 0);
    // elbows rest slightly bent, about 15 degrees forward
    elbow.rotation.x = -0.26;
    const fore = new THREE.Mesh(latheFor('forearm', PROFILES.forearm), foreMat);
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), skinMat);
    hand.position.set(0, -0.27, 0);
    elbow.add(hand);
    shoulder.add(elbow);
    chest.add(shoulder);
    return { shoulder, elbow };
  }
  const leftArmBuilt = buildArm(-0.21);
  const rightArmBuilt = buildArm(0.21);

  // --- head: its own group above the neck, so it can look around ---
  const head = new THREE.Group();
  head.position.set(0, 1.36, 0);
  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 24, 18),
    new THREE.MeshStandardMaterial({
      map: faceTexture(skin, hair, shades),
      roughness: 0.55,
      metalness: 0.02,
    }),
  );
  skull.position.set(0, 0.09, 0);
  head.add(skull);
  if (picked === 'police') {
    // brimmed cap: a flat lathe crown plus a short brim jutting forward
    const crown = new THREE.Mesh(latheFor('capTop', PROFILES.capTop), materialFor(NAVY, 0.8));
    crown.position.set(0, 0.16, 0);
    head.add(crown);
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.115, 0.012, 20, 1, false, -0.6, 1.2),
      materialFor(0x101418, 0.5),
    );
    brim.position.set(0, 0.155, 0.05);
    head.add(brim);
  }
  group.add(head);

  // --- phone: tucked in the right hand, hidden until the ped uses it ---
  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.075, 0.012),
    materialFor(0x111111, 0.4),
  );
  phone.position.set(0, -0.27, 0.035);
  phone.visible = false;
  rightArmBuilt.elbow.add(phone);

  // --- witness mark: every pedestrian carries one, hidden until the ped
  // witnesses a crime (traffic.js toggles its visibility each frame) ---
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: exclaimTexture(), transparent: true, depthWrite: false,
  }));
  mark.scale.set(0.24, 0.24, 1);
  mark.position.set(0, 1.92, 0);
  mark.visible = false;
  group.add(mark);

  // --- badge: police only, a gold star pinned to the left chest ---
  if (picked === 'police') {
    if (!cachedBadge) cachedBadge = badgeTexture();
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: cachedBadge, transparent: true }));
    badge.scale.set(0.09, 0.09, 1);
    badge.position.set(0.09, 0.38, 0.16);
    chest.add(badge);
  }

  return {
    group,
    leftLeg: leftLegBuilt.hip,
    rightLeg: rightLegBuilt.hip,
    shinL: leftLegBuilt.knee,
    shinR: rightLegBuilt.knee,
    leftArm: leftArmBuilt.shoulder,
    rightArm: rightArmBuilt.shoulder,
    foreL: leftArmBuilt.elbow,
    foreR: rightArmBuilt.elbow,
    head,
    chest,
    phone,
    mark,
  };
}
