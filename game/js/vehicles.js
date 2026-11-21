// Solmar City — cars.
// Everything about the vehicles lives here: the extruded wide-body shells
// with clearcoat paint and glasshouses, the five-spoke wheels, the police
// light bars, the taxi and truck variants, and the arcade driving model
// (top speed 34 units/s, body lean, flames, smoke and skid marks). The car
// group faces +Z; the shell subgroup is the part that leans, dives and lifts
// while the wheels stay planted.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, addHeat, dist2, clamp } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';
import { glowTexture, plateTexture } from './textures.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_SPEED = 34; // units/s, shown as 122 km/h
const KMH = 3.6;
const FAST_KMH = 85; // flames / smoke / skids only above this speed
const FAST_MS = FAST_KMH / KMH;

const STREET_PAINTS = [
  0xc0392b, 0x2c3e50, 0xecf0f1, 0x1a1a1a, 0x7f8c8d,
  0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xd35400,
];

const SEDAN_LEN = 4.4;
const SEDAN_WID = 2.0;
const TRUCK_LEN = 5.4;
const TRUCK_WID = 2.2;

let plateSeq = 1000;
const carRegistry = [];

// ---------------------------------------------------------------------------
// Small canvas helpers (own versions, for the flame / checker / taxi art)
// ---------------------------------------------------------------------------

function hexA(hex, alpha) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

let flameTex = null;
function flameTexture() {
  if (flameTex) return flameTex;
  const [c, ctx] = makeCanvas(64, 128);
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(40,120,255,0.95)');
  g.addColorStop(0.35, 'rgba(120,180,255,0.75)');
  g.addColorStop(0.65, 'rgba(255,160,60,0.65)');
  g.addColorStop(1, 'rgba(255,220,120,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.quadraticCurveTo(58, 60, 44, 128);
  ctx.lineTo(20, 128);
  ctx.quadraticCurveTo(6, 60, 32, 0);
  ctx.fill();
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

let checkerTex = null;
function checkerTexture() {
  if (checkerTex) return checkerTex;
  const [c, ctx] = makeCanvas(128, 32);
  const n = 8;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#111111' : '#f8f8f8';
    ctx.fillRect(i * 16, 0, 16, 32);
  }
  checkerTex = new THREE.CanvasTexture(c);
  checkerTex.colorSpace = THREE.SRGBColorSpace;
  checkerTex.wrapS = THREE.RepeatWrapping;
  checkerTex.wrapT = THREE.RepeatWrapping;
  return checkerTex;
}

let taxiTex = null;
function taxiSignTexture() {
  if (taxiTex) return taxiTex;
  const [c, ctx] = makeCanvas(128, 48);
  ctx.fillStyle = '#f2c200';
  ctx.fillRect(0, 0, 128, 48);
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TAXI', 64, 25);
  taxiTex = new THREE.CanvasTexture(c);
  taxiTex.colorSpace = THREE.SRGBColorSpace;
  return taxiTex;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function paintMaterial(hex) {
  return new THREE.MeshPhysicalMaterial({
    color: hex,
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
}

function glassMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x0a0f14,
    metalness: 0.9,
    roughness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  });
}

function trimMaterial(hex, rough) {
  return new THREE.MeshStandardMaterial({ color: hex, metalness: 0.3, roughness: rough === undefined ? 0.6 : rough });
}

// ---------------------------------------------------------------------------
// Extrusion helpers — the side profile is drawn in XY (length on X, front
// at +X), extruded across the width, then turned so the length lies on Z
// with the nose at +Z.
// ---------------------------------------------------------------------------

function profileShape(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

function extrudeShell(shape, width, material) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - 0.1,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 3,
    steps: 1,
  });
  geo.translate(0, 0, -(width - 0.1) / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.y = -Math.PI / 2;
  mesh.castShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Wheels — a steering mount, a spinner (the thing updateDriving turns),
// and the tyre / rim / five spokes inside it.
// ---------------------------------------------------------------------------

function buildWheel(radius) {
  const mount = new THREE.Group(); // yawed for steering on the front axle
  const spinner = new THREE.Group(); // spun by updateDriving (rotation.x)
  mount.add(spinner);

  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.22, 20),
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0.05 }),
  );
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  spinner.add(tyre);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, 0.24, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.85 }),
  );
  rim.rotation.z = Math.PI / 2;
  spinner.add(rim);

  // five deep-dish spokes, one thin box each, fanned around the hub
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.4, metalness: 0.7 });
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, radius * 0.55, 0.26), spokeMat);
    const a = (i / 5) * Math.PI * 2;
    spoke.position.set(0, Math.cos(a) * radius * 0.28, Math.sin(a) * radius * 0.28);
    spoke.rotation.x = -a;
    spinner.add(spoke);
  }
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, 0.26, 10),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 }),
  );
  hub.rotation.z = Math.PI / 2;
  spinner.add(hub);

  return { mount, spinner };
}

// Dark arch recess behind each wheel so the wheel reads as sitting in a cutout.
function archDisc(radius) {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius + 0.07, 20),
    new THREE.MeshBasicMaterial({ color: 0x08080a, side: THREE.DoubleSide }),
  );
  return disc;
}

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

// Lower body + cabin, parameterised by kind. The lower body is one extruded
// slab up to the beltline; the cabin is a narrower dark glasshouse with a
// body-colour roof panel and pillars over it.
function buildBodywork(model, paintHex, width, length) {
  const shell = new THREE.Group();
  const paint = paintMaterial(paintHex);
  const glass = glassMaterial();
  const half = length / 2;

  const low = model === 'sports' ? 0.26 : 0.32;
  const belt = model === 'sports' ? 0.82 : 0.9;
  const roofY = model === 'sports' ? 1.22 : 1.31;

  // lower body: bumper, hood, beltline, trunk
  const lowerPts = [
    [-half, low], [-half, 0.68], [-half + 0.28, 0.8], [-half + 0.85, belt],
    [half - 0.85, belt], [half - 0.28, 0.8], [half, 0.68], [half, low],
  ];
  shell.add(extrudeShell(profileShape(lowerPts), width, paint));

  // glasshouse: windshield, side glass, rear window in one dark band
  const cabHalf = half - 0.95;
  const glassPts = [
    [-cabHalf - 0.1, belt - 0.04], [-cabHalf - 0.05, belt + 0.22],
    [-cabHalf + 0.55, roofY - 0.03], [cabHalf - 0.6, roofY],
    [cabHalf + 0.05, belt + 0.2], [cabHalf + 0.1, belt - 0.04],
  ];
  shell.add(extrudeShell(profileShape(glassPts), width - 0.24, glass));

  // roof panel in body colour over the glasshouse
  const roofPts = [
    [-cabHalf + 0.5, roofY - 0.05], [-cabHalf + 0.62, roofY + 0.01],
    [cabHalf - 0.62, roofY + 0.02], [cabHalf - 0.5, roofY - 0.04],
  ];
  shell.add(extrudeShell(profileShape(roofPts), width - 0.3, paint));

  // A / B / C pillars, thin body-colour strips over the glasshouse flanks
  const pillarMat = paint;
  const pillarGeo = new THREE.BoxGeometry(0.07, 0.5, 0.05);
  for (const s of [-1, 1]) {
    for (const [px, pz, tilt] of [
      [cabHalf + 0.02, belt + 0.14, -0.5],
      [0, belt + 0.24, 0],
      [-cabHalf - 0.02, belt + 0.14, 0.5],
    ]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(s * (width / 2 - 0.1), pz, px);
      p.rotation.x = tilt;
      shell.add(p);
    }
  }

  // bumpers and side skirts, kept slim so the wheels stay fully visible
  const dark = trimMaterial(0x1a1a1a, 0.7);
  for (const z of [half - 0.06, -half + 0.06]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(width - 0.1, 0.14, 0.12), dark);
    bumper.position.set(0, 0.3, z);
    shell.add(bumper);
  }
  for (const s of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, length * 0.55), dark);
    skirt.position.set(s * (width / 2 - 0.03), 0.3, 0);
    shell.add(skirt);
  }

  return { shell, belt, roofY };
}

function buildTruckBody(paintHex) {
  const shell = new THREE.Group();
  const paint = paintMaterial(paintHex);
  const glass = glassMaterial();
  const half = TRUCK_LEN / 2;

  // tall cab at the front: upright windshield, flat nose
  const cabPts = [
    [half - 1.9, 0.32], [half - 1.9, 1.5], [half - 1.75, 2.0],
    [half - 0.9, 2.05], [half - 0.55, 1.5], [half - 0.5, 0.9],
    [half, 0.82], [half, 0.32],
  ];
  shell.add(extrudeShell(profileShape(cabPts), TRUCK_WID - 0.1, paint));
  // cab glass band
  const cabGlassPts = [
    [half - 1.82, 1.35], [half - 1.7, 1.92], [half - 0.98, 1.96],
    [half - 0.72, 1.4], [half - 0.75, 1.32],
  ];
  shell.add(extrudeShell(profileShape(cabGlassPts), TRUCK_WID - 0.34, glass));
  // grille + bumper
  const dark = trimMaterial(0x1a1a1a, 0.7);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(TRUCK_WID - 0.3, 0.3, 0.08), dark);
  grille.position.set(0, 0.62, half - 0.02);
  shell.add(grille);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(TRUCK_WID - 0.1, 0.16, 0.14), dark);
  bumper.position.set(0, 0.3, half - 0.04);
  shell.add(bumper);

  // ribbed cargo box behind the cab
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(TRUCK_WID - 0.15, 1.9, 3.1),
    new THREE.MeshStandardMaterial({ color: 0xd8d4c8, metalness: 0.25, roughness: 0.55 }),
  );
  box.position.set(0, 1.27, -half + 1.65);
  box.castShadow = true;
  shell.add(box);
  const ribMat = trimMaterial(0x9a968a, 0.6);
  for (let i = 0; i < 6; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.08), ribMat);
    rib.position.set(0, 1.27, -half + 0.35 + i * 0.55);
    shell.add(rib);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.08), ribMat);
      rib.position.set(s * (TRUCK_WID / 2 - 0.06), 1.27, -half + 0.35 + i * 0.55);
      shell.add(rib);
    }
  }
  return shell;
}

// ---------------------------------------------------------------------------
// Lights, plates, exhaust
// ---------------------------------------------------------------------------

function addHeadlights(shell, half, width) {
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 1.6,
    roughness: 0.2, metalness: 0.4,
  });
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.06), lampMat);
    lamp.position.set(s * (width / 2 - 0.42), 0.66, half - 0.03);
    shell.add(lamp);
    // faint warm cone on the road ahead
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 2.6, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8, transparent: true, opacity: 0.07,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    cone.rotation.x = Math.PI / 2 + 0.12;
    cone.position.set(s * (width / 2 - 0.42), 0.5, half + 1.2);
    shell.add(cone);
  }
}

// Full-width scarlet LED bar across the tail, plus glow sprites at its ends.
function addTailBar(shell, half, width) {
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x7a0d0d, emissive: 0xff2020, emissiveIntensity: 1.0,
    roughness: 0.3, metalness: 0.3,
  });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.09, 0.06), tailMat);
  bar.position.set(0, 0.72, -half + 0.03);
  shell.add(bar);
  const tailGlows = [];
  for (const s of [-1, 1]) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff2a2a, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    spr.scale.set(0.85, 0.4, 1);
    spr.position.set(s * (width / 2 - 0.25), 0.72, -half - 0.02);
    shell.add(spr);
    tailGlows.push(spr);
  }
  return { tailMat, tailGlows };
}

function addPlates(shell, half, width) {
  const code = 'SLM-' + (plateSeq++);
  const tex = plateTexture(code);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const geo = new THREE.PlaneGeometry(0.44, 0.11);
  const front = new THREE.Mesh(geo, mat);
  front.position.set(0, 0.42, half + 0.02);
  shell.add(front);
  const rear = new THREE.Mesh(geo, mat);
  rear.position.set(0, 0.42, -half - 0.02);
  rear.rotation.y = Math.PI;
  shell.add(rear);
}

// Twin dark exhaust tips with thin blue-orange gradient flames behind them.
function addExhaust(shell, half, width) {
  const tipMat = trimMaterial(0x0c0c0c, 0.5);
  const flames = [];
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10), tipMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(s * 0.32, 0.3, -half - 0.04);
    shell.add(tip);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.42, 8),
      new THREE.MeshBasicMaterial({
        map: flameTexture(), transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(s * 0.32, 0.3, -half - 0.3);
    flame.visible = false;
    shell.add(flame);
    flames.push(flame);
  }
  return flames;
}

// Police light bar: lenses, glow sprites and the red/blue ground patches
// that police.js pulses. Returned through userData.
function addLightBar(shell, roofY, width) {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.07, 0.24),
    trimMaterial(0x141414, 0.4),
  );
  base.position.set(0, roofY + 0.05, 0.1);
  shell.add(base);
  const redLens = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.09, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x7a0d0d, emissive: 0xff2020, emissiveIntensity: 2.2 }),
  );
  redLens.position.set(-0.16, roofY + 0.1, 0.1);
  shell.add(redLens);
  const blueLens = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.09, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x0d1a7a, emissive: 0x2244ff, emissiveIntensity: 2.2 }),
  );
  blueLens.position.set(0.16, roofY + 0.1, 0.1);
  shell.add(blueLens);

  function glowSprite(hex, x) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: hex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    spr.scale.set(0.9, 0.9, 1);
    spr.position.set(x, roofY + 0.12, 0.1);
    shell.add(spr);
    return spr;
  }
  function groundPatch(hex, x) {
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 2.4),
      new THREE.MeshBasicMaterial({
        color: hex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, 0.03, 0.1);
    shell.add(patch);
    return patch;
  }
  return {
    redLens, blueLens,
    redGlow: glowSprite(0xff2020, -0.16),
    blueGlow: glowSprite(0x2244ff, 0.16),
    redGround: groundPatch(0xff2020, -1.35),
    blueGround: groundPatch(0x2244ff, 1.35),
  };
}

// ---------------------------------------------------------------------------
// makeCar
// ---------------------------------------------------------------------------

export function makeCar(color, police, kind) {
  const model = police ? 'police' : (kind || 'sedan');
  const paint = police ? 0xe8e8e8 : (color === undefined || color === null
    ? STREET_PAINTS[Math.floor(Math.random() * STREET_PAINTS.length)]
    : color);
  const isTruck = model === 'truck';
  const width = isTruck ? TRUCK_WID : SEDAN_WID;
  const length = isTruck ? TRUCK_LEN : SEDAN_LEN;
  const half = length / 2;

  const car = new THREE.Group();
  const shell = new THREE.Group();
  car.add(shell);

  let roofY = 1.31;
  if (isTruck) {
    shell.add(buildTruckBody(paint));
    roofY = 2.05;
  } else {
    const built = buildBodywork(model, paint, width, length);
    shell.add(built.shell);
    roofY = built.roofY;
  }

  // wheels + arch recesses, on the car group so the shell can lean over them
  const wheelR = isTruck ? 0.42 : 0.34;
  const axleF = isTruck ? 1.7 : 1.35;
  const axleR = isTruck ? -1.7 : -1.35;
  const wheels = [];
  const steerMounts = [];
  for (const [wx, wz, front] of [
    [-0.98, axleF, true], [0.98, axleF, true],
    [-0.98, axleR, false], [0.98, axleR, false],
  ]) {
    const { mount, spinner } = buildWheel(wheelR);
    mount.position.set(wx, wheelR, wz);
    car.add(mount);
    const disc = archDisc(wheelR);
    disc.position.set(wx + (wx < 0 ? -0.05 : 0.05), wheelR, wz);
    disc.rotation.y = wx < 0 ? -Math.PI / 2 : Math.PI / 2;
    car.add(disc);
    wheels.push(spinner);
    if (front) steerMounts.push(mount);
  }

  addHeadlights(shell, half, width);
  const { tailMat, tailGlows } = addTailBar(shell, half, width);
  addPlates(shell, half, width);
  const flames = addExhaust(shell, half, width);

  // kind extras
  if (model === 'taxi') {
    // checker band along both flanks + a lit TAXI sign on the roof
    const bandMat = new THREE.MeshBasicMaterial({ map: checkerTexture() });
    for (const s of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(length * 0.5, 0.14), bandMat);
      band.position.set(s * (width / 2 + 0.01), 0.62, 0);
      band.rotation.y = s < 0 ? -Math.PI / 2 : Math.PI / 2;
      shell.add(band);
    }
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.14, 0.22),
      new THREE.MeshStandardMaterial({
        map: taxiSignTexture(), emissive: 0xffffff, emissiveMap: taxiSignTexture(),
        emissiveIntensity: 0.7, roughness: 0.4,
      }),
    );
    sign.position.set(0, roofY + 0.08, 0.1);
    shell.add(sign);
  }
  if (model === 'police') {
    // black hood and roof panels over the white body + door stripes
    const black = trimMaterial(0x111111, 0.5);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(width - 0.5, 0.02, 0.9), black);
    hood.position.set(0, 0.92, half - 0.75);
    shell.add(hood);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width - 0.6, 0.02, 1.1), black);
    roof.position.set(0, roofY + 0.02, 0);
    shell.add(roof);
    for (const s of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 1.5), black);
      stripe.position.set(s * (width / 2 + 0.01), 0.6, 0.1);
      shell.add(stripe);
    }
  }

  const userData = {
    wheels,
    body: shell,
    kind: model,
    police: !!police,
    tailMat,
    tailGlows,
    flames,
    steerMounts,
    steer: 0,
  };
  if (police) {
    Object.assign(userData, addLightBar(shell, roofY, width));
  }
  car.userData = userData;

  // The car group carries the wrapper fields other systems read directly:
  // .mesh (the group itself, for the minimap and mission distances),
  // .speed and .heading (read by traffic and police), .stolen (so a car is
  // only reported stolen the first time), .driver (cleared on BUSTED).
  car.mesh = car;
  car.stolen = false;
  car.speed = 0;
  car.heading = 0;
  car.driver = null;

  attachBlob(car, 2.4, 0.03);
  S.scene.add(car);
  carRegistry.push(car);
  return car;
}

// ---------------------------------------------------------------------------
// Parked cars, lookup, enter / exit
// ---------------------------------------------------------------------------

export function spawnParkedCar(x, z, heading, color, kind) {
  const car = makeCar(color, false, kind);
  car.position.set(x, 0, z);
  car.rotation.y = heading;
  car.heading = heading;
  car.speed = 0;
  return car;
}

export function nearestCar(x, z, maxDist) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const car of carRegistry) {
    if (car === S.currentCar) continue;
    if (car.userData.police) continue;
    const d = dist2(car.position.x, car.position.z, x, z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

export function enterCar(ride) {
  if (!ride || S.currentCar === ride) return;
  if (S.currentCar) exitCar();
  S.currentCar = ride;
  S.onFoot = false;
  ride.stolen = true;
  ride.driver = S.player;
  ride.heading = ride.rotation.y;
  ride.speed = 0;
  ride.userData.steer = 0;
  S.player.pos.x = ride.position.x;
  S.player.pos.z = ride.position.z;
  S.player.pos.y = 0;
  S.player.inCar = true;
  addHeat(34); // stealing a car puts the player straight on 2 stars
}

export function exitCar() {
  const car = S.currentCar;
  if (!car) return;
  car.speed = 0;
  car.driver = null;
  // step out on the car's left flank
  const leftX = Math.cos(car.heading);
  const leftZ = -Math.sin(car.heading);
  S.player.pos.x = car.position.x + leftX * 1.7;
  S.player.pos.z = car.position.z + leftZ * 1.7;
  S.player.pos.y = 0;
  S.player.inCar = false;
  S.currentCar = null;
  S.onFoot = true;
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

function keyDown(name) {
  const keys = S.keys;
  if (!keys) return false;
  if (typeof keys.has === 'function') return keys.has(name);
  return !!keys[name];
}

function ensureSmokeSkids(car) {
  const u = car.userData;
  if (!u.smoke) {
    u.smoke = [];
    for (const s of [-1, 1]) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false,
      }));
      spr.scale.set(0.9, 0.9, 1);
      spr.position.set(s * 0.98, 0.35, -1.35);
      car.add(spr);
      u.smoke.push(spr);
    }
  }
  if (!u.skids) {
    u.skids = [];
    u.skidIndex = 0;
    u.skidTimer = 0;
    for (let i = 0; i < 30; i++) {
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(0.24, 0.9),
        new THREE.MeshBasicMaterial({
          color: 0x0a0a0a, transparent: true, opacity: 0, depthWrite: false,
        }),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.02;
      mark.visible = false;
      mark.userData.life = 0;
      S.scene.add(mark);
      u.skids.push(mark);
    }
  }
}

export function updateDriving(dt) {
  const car = S.currentCar;
  if (!car) return;
  const u = car.userData;
  ensureSmokeSkids(car);

  const throttle = keyDown('KeyW') || keyDown('ArrowUp');
  const braking = keyDown('KeyS') || keyDown('ArrowDown');
  const turnLeft = keyDown('KeyA') || keyDown('ArrowLeft');
  const turnRight = keyDown('KeyD') || keyDown('ArrowRight');
  const handbrake = keyDown('Space');

  // --- speed (kept on the car itself: traffic and police read it) ---
  if (throttle) {
    car.speed += 14 * dt;
  } else if (braking) {
    if (car.speed > 0.5) car.speed -= 22 * dt;
    else car.speed -= 8 * dt;
  } else {
    car.speed -= Math.sign(car.speed) * 4 * dt;
    if (Math.abs(car.speed) < 0.2) car.speed = 0;
  }
  if (handbrake) {
    car.speed -= Math.sign(car.speed) * 30 * dt;
    if (Math.abs(car.speed) < 0.3) car.speed = 0;
  }
  car.speed = clamp(car.speed, -8, TOP_SPEED);

  // --- steering: sharper at low speed, milder at the top end ---
  const maxSteer = 0.55 / (1 + Math.abs(car.speed) * 0.045) * (handbrake ? 1.6 : 1);
  const steerTarget = ((turnLeft ? 1 : 0) - (turnRight ? 1 : 0)) * maxSteer;
  u.steer += (steerTarget - u.steer) * Math.min(1, dt * 9);
  car.heading += u.steer * car.speed * dt * 0.055;

  // --- move ---
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  car.position.x += fx * car.speed * dt;
  car.position.z += fz * car.speed * dt;
  car.rotation.y = car.heading;
  resolveCollisions(car.position, 1.3);
  if (WORLD && typeof WORLD.half === 'number') {
    const edge = WORLD.half - 3;
    car.position.x = clamp(car.position.x, -edge, edge);
    car.position.z = clamp(car.position.z, -edge, edge);
  }

  // --- wheels: spin + front steer ---
  for (const wheel of u.wheels) {
    wheel.rotation.x += car.speed * dt * 2.4;
  }
  for (const mount of u.steerMounts) {
    mount.rotation.y = u.steer * 0.5;
  }

  // --- body lean (visual only): roll out of the turn, dip on braking,
  // lift on launch ---
  const speedFrac = clamp(Math.abs(car.speed) / TOP_SPEED, 0, 1);
  const targetRoll = u.steer * speedFrac * 0.08;
  const targetPitch = braking ? 0.035 : (throttle && car.speed < 12 ? -0.02 : 0);
  const shell = u.body;
  shell.rotation.z += (targetRoll - shell.rotation.z) * Math.min(1, dt * 8);
  shell.rotation.x += (targetPitch - shell.rotation.x) * Math.min(1, dt * 8);

  // --- brake light: twice as bright under braking ---
  const isBraking = braking || handbrake;
  u.tailMat.emissiveIntensity = isBraking ? 2.2 : 1.0;
  for (const glow of u.tailGlows) {
    glow.material.opacity = isBraking ? 0.95 : 0.5;
  }

  // --- flames, smoke, skids above 85 km/h ---
  const fast = Math.abs(car.speed) > FAST_MS;
  const flaming = fast && (throttle || handbrake);
  for (const flame of u.flames) {
    flame.visible = flaming;
    if (flaming) {
      const flick = 0.8 + Math.random() * 0.45;
      flame.scale.set(flick, flick * (0.9 + Math.random() * 0.3), flick);
    }
  }
  const smoking = fast || handbrake;
  for (const puff of u.smoke) {
    puff.material.opacity += ((smoking ? 0.14 : 0) - puff.material.opacity) * Math.min(1, dt * 6);
    if (smoking) {
      const s = 0.8 + Math.random() * 0.5;
      puff.scale.set(s, s, 1);
    }
  }
  // skid marks while handbraking or drifting hard at speed
  const drifting = handbrake || (fast && Math.abs(u.steer) > 0.25);
  u.skidTimer -= dt;
  if (drifting && Math.abs(car.speed) > 3 && u.skidTimer <= 0) {
    u.skidTimer = 0.06;
    for (const s of [-1, 1]) {
      const mark = u.skids[u.skidIndex % u.skids.length];
      u.skidIndex++;
      const wx = car.position.x + Math.cos(car.heading) * s * 0.98 - fx * 1.35;
      const wz = car.position.z - Math.sin(car.heading) * s * 0.98 - fz * 1.35;
      mark.position.set(wx, 0.02, wz);
      mark.rotation.z = -car.heading;
      mark.visible = true;
      mark.userData.life = 5;
      mark.material.opacity = 0.5;
    }
  }
  for (const mark of u.skids) {
    if (mark.userData.life > 0) {
      mark.userData.life -= dt;
      mark.material.opacity = Math.max(0, mark.userData.life / 5) * 0.5;
      if (mark.userData.life <= 0) mark.visible = false;
    }
  }

  // --- keep the player (camera, minimap, missions) glued to the car ---
  S.player.pos.x = car.position.x;
  S.player.pos.z = car.position.z;
  S.player.pos.y = 0;
  S.player.heading = car.heading;
  S.speedKmh = car.speed * KMH;
}
