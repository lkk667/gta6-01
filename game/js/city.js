// Solmar City — the city itself.
// A 9x9 road grid in a 380x380 m coastal city at dusk: pastel towers,
// a park, a beach and an ocean, the landmarks, palms, streetlights and
// clouds, plus the collision circles and the ground/contact-shadow
// helpers the other systems build on. All textures are procedural
// (see textures.js for the surface library); nothing is fetched.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, mulberry32, clamp } from './state.js';
import { asphaltMaps, sidewalkMap, facadeMaps } from './textures.js';

const rng = mulberry32(20261119);
const ROAD_W = 10;
const BLOCK = WORLD.roadGap - ROAD_W; // 30 m of buildable block between roads

// ---------------------------------------------------------------- textures

// Paint a canvas and wrap it as a repeating texture.
function canvasTex(w, h, draw, repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX || 1, repeatY || 1);
  t.anisotropy = 4;
  return t;
}

// Dusk sky: a big inverted sphere painted with a vertical gradient — deep
// violet overhead fading through magenta and orange to a warm horizon —
// plus a low sun glow on the western side. The dome ignores fog.
function skyDome() {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  const ctx = cv.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  const stops = [
    [0, '#1e1440'],
    [0.35, '#6a2a55'],
    [0.58, '#e85a3a'],
    [0.74, '#ff9a55'],
    [0.86, '#ffc27a'],
    [1, '#ffd9a0'],
  ];
  for (const [pos, col] of stops) sky.addColorStop(pos, col);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 512);
  const glow = ctx.createRadialGradient(260, 430, 4, 260, 430, 130);
  glow.addColorStop(0, 'rgba(255,240,200,0.95)');
  glow.addColorStop(0.35, 'rgba(255,190,110,0.55)');
  glow.addColorStop(1, 'rgba(255,150,80,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 512);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(700, 24, 14),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.BackSide, fog: false })
  );
  dome.renderOrder = -10;
  S.scene.add(dome);
}

// A speckled flat colour: base + a scatter of tinted dots.
function speckle(base, dots, count, size) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      g.fillStyle = dots[Math.floor(rng() * dots.length)];
      g.globalAlpha = 0.25 + rng() * 0.45;
      const s = 1 + rng() * size;
      g.fillRect(rng() * w, rng() * h, s, s);
    }
    g.globalAlpha = 1;
  }, 12, 12);
}

function plazaTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b7a98d';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,78,60,0.55)';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i * h) / 4); g.lineTo(w, (i * h) / 4); g.stroke();
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(60,50,35,0.12)';
      g.fillRect(rng() * w, rng() * h, 2 + rng() * 3, 2 + rng() * 3);
    }
  }, 10, 10);
}

// Neon sign plate: lines of glowing text on a dark plate, drawn twice so
// the neon reads brighter. `lines` is [{text, size, color, y}].
function signTex(lines, fg, glow) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#14101c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const ln of lines) {
      g.font = `bold ${ln.size}px Arial, sans-serif`;
      g.shadowColor = glow;
      g.shadowBlur = 26;
      g.fillStyle = ln.color;
      g.fillText(ln.text, w / 2, ln.y);
      g.fillText(ln.text, w / 2, ln.y); // second pass = stronger neon
    }
    g.shadowBlur = 0;
  });
}

function crescentTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffd94a';
    g.shadowColor = '#ffbf00';
    g.shadowBlur = 18;
    g.beginPath();
    g.arc(64, 64, 46, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(84, 52, 40, 0, Math.PI * 2);
    g.fill();
  });
}

// ---------------------------------------------------------------- shadows

let blobTex = null;
function getBlobTex() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.20)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export const blobShadows = []; // { mesh, follow: Object3D|null, y }

export function attachBlob(follow, size, y) {
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size * 0.8),
    new THREE.MeshBasicMaterial({ map: getBlobTex(), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = y || 0.03;
  shadow.renderOrder = 1;
  S.scene.add(shadow);
  blobShadows.push({ mesh: shadow, follow });
  return shadow;
}

export function placeBlob(x, z, size, y) {
  const shadow = attachBlob(null, size, y);
  shadow.position.x = x;
  shadow.position.z = z;
  return shadow;
}

export function updateBlobShadows() {
  for (const entry of blobShadows) {
    if (entry.follow) {
      entry.mesh.position.x = entry.follow.position.x;
      entry.mesh.position.z = entry.follow.position.z;
    }
  }
}

// ---------------------------------------------------------------- collision

export function resolveCollisions(pos, r) {
  for (const c of S.colliders) {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const d = Math.hypot(dx, dz);
    const minDist = c.r + r;
    if (d < minDist && d > 0.0001) {
      pos.x = c.x + (dx / d) * minDist;
      pos.z = c.z + (dz / d) * minDist;
    }
  }
  pos.x = clamp(pos.x, -WORLD.half + 2, WORLD.half - 2);
  pos.z = clamp(pos.z, -WORLD.half + 2, WORLD.half - 2);
}

// ---------------------------------------------------------------- builders

const PASTELS = ['#e8b4b8', '#b8d8e8', '#e8d8a8', '#b8e8c8', '#d8c8e8', '#f0c8a0', '#a8c8e0', '#e0a8a8'];

function box(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  S.scene.add(mesh);
  return mesh;
}

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function buildGround() {
  // Paver tiles under everything, so the ground between the roads reads
  // as pavement instead of one flat brown plane.
  const pavers = sidewalkMap();
  pavers.repeat.set(48, 48);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, WORLD.size),
    new THREE.MeshStandardMaterial({ map: pavers, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  S.scene.add(ground);

  // Plaza around the centre intersection.
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshLambertMaterial({ map: plazaTex() })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.02, 0);
  plaza.receiveShadow = true;
  S.scene.add(plaza);

  // Roads: asphalt with a roughness map so the dusk sun catches the wear
  // bands. The tile repeats ten times down each road, laying the centre
  // dash and edge lines along the whole street.
  const tar = asphaltMaps();
  tar.map.repeat.set(1, 10);
  tar.roughnessMap.repeat.set(1, 10);
  const roadMat = new THREE.MeshStandardMaterial({
    map: tar.map, roughnessMap: tar.roughnessMap, roughness: 0.92, metalness: 0.05,
  });
  for (const r of WORLD.roads) {
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, WORLD.size), roadMat);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(r, 0.015, 0);
    ns.receiveShadow = true;
    S.scene.add(ns);
    // East-west roads need the tile turned: clone the maps and repeat
    // across instead of along.
    const ewMat = roadMat.clone();
    ewMat.map = tar.map.clone();
    ewMat.map.repeat.set(10, 1);
    ewMat.map.needsUpdate = true;
    ewMat.roughnessMap = tar.roughnessMap.clone();
    ewMat.roughnessMap.repeat.set(10, 1);
    ewMat.roughnessMap.needsUpdate = true;
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, ROAD_W), ewMat);
    ew.rotation.x = -Math.PI / 2;
    ew.rotation.z = Math.PI / 2;
    ew.position.set(0, 0.015, r);
    ew.receiveShadow = true;
    S.scene.add(ew);
    // Curbs: pale strips along both edges of the north-south road.
    for (const s of [-1, 1]) {
      const curb = box(0.5, 0.18, WORLD.size, lambert(0xcfc8b0), r + s * (ROAD_W / 2 + 0.25), 0.09, 0);
      curb.castShadow = false;
    }
  }

  // Crosswalks at every intersection: five white stripes across each
  // road, on both approaches.
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xe8e6da });
  const stripe = (w, d, x, z) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stripeMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.03, z);
    S.scene.add(s);
  };
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      for (let i = -2; i <= 2; i++) {
        stripe(1.1, 3.4, rx + i * 2, rz + ROAD_W / 2 + 2.2);
        stripe(3.4, 1.1, rx + ROAD_W / 2 + 2.2, rz + i * 2);
      }
    }
  }

  // Stop lines: one white bar across each lane just before every
  // crossing, so intersections read as real junctions from the driver's
  // seat. Batched into a single instanced mesh — 324 bars, one draw call.
  const stopSpots = [];
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      stopSpots.push([rx, rz + ROAD_W / 2 + 5.4, 3.6, 0.5]);
      stopSpots.push([rx, rz - ROAD_W / 2 - 5.4, 3.6, 0.5]);
      stopSpots.push([rx + ROAD_W / 2 + 5.4, rz, 0.5, 3.6]);
      stopSpots.push([rx - ROAD_W / 2 - 5.4, rz, 0.5, 3.6]);
    }
  }
  const stopGeo = new THREE.PlaneGeometry(1, 1);
  stopGeo.rotateX(-Math.PI / 2);
  const stopMesh = new THREE.InstancedMesh(stopGeo, stripeMat, stopSpots.length);
  const dummy = new THREE.Object3D();
  stopSpots.forEach(([x, z, w, d], i) => {
    dummy.position.set(x, 0.03, z);
    dummy.scale.set(w, 1, d);
    dummy.updateMatrix();
    stopMesh.setMatrixAt(i, dummy.matrix);
  });
  stopMesh.instanceMatrix.needsUpdate = true;
  S.scene.add(stopMesh);

  // Beach + ocean at the south edge (deep dusk blue water, warm sand).
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, 34),
    new THREE.MeshLambertMaterial({ map: speckle('#e8c890', ['#d8b878', '#f2d4a0', '#c8a868'], 700, 3) })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, WORLD.half - 17);
  sand.receiveShadow = true;
  S.scene.add(sand);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 300),
    new THREE.MeshLambertMaterial({ color: 0x2a4a7a })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.4, WORLD.half + 150);
  S.scene.add(ocean);
}

// Shared shop-sign textures: one small dark plate with a glowing name each,
// drawn once per name and reused by every storefront in the city.
const SHOP_NAMES = ['TACOS', 'PIZZA', 'BARBER', 'LAUNDRY', 'BAKERY', 'PHONES', 'DONUTS', 'FLOWERS'];
const shopSignCache = new Map();
function shopSignTex(name) {
  let tex = shopSignCache.get(name);
  if (tex) return tex;
  tex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#1c1410';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd27a';
    g.font = 'bold 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff9a3a';
    g.shadowBlur = 12;
    g.fillText(name, w / 2, h / 2 + 1);
    g.shadowBlur = 0;
  });
  shopSignCache.set(name, tex);
  return tex;
}

function buildTower(x, z, w, d, h, color) {
  // Facade style varies by block so neighbouring towers don't match:
  // warm stone, glass curtain wall, deco or concrete, each with its own
  // lit-window emissive map so the windows glow at dusk.
  const style = Math.abs(Math.floor(x * 0.7 + z * 1.3)) % 4;
  const face = facadeMaps(style);
  const mat = new THREE.MeshStandardMaterial({
    map: face.map, emissive: 0xffffff, emissiveMap: face.emissiveMap,
    emissiveIntensity: 1.15, roughness: face.roughness, metalness: face.metalness,
  });
  const m = box(w, h, d, mat, x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  // Varied roofline: a setback upper floor on about a third of towers.
  if (rng() < 0.35) {
    const upper = box(w * 0.55, 3 + rng() * 4, d * 0.55, lambert(color), x, h + 1.5 + rng() * 2, z);
    upper.castShadow = true;
  } else {
    // Rooftop cap so towers read as buildings, not plain boxes.
    const cap = box(w * 0.7, 1.2, d * 0.7, lambert(0x5a5a62), x, h + 0.6, z);
    cap.castShadow = true;
  }
  // Rooftop props: water tank, antenna with a red tip, or AC unit.
  const prop = rng();
  if (prop < 0.35) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 8), lambert(0x7a5a3a));
    tank.position.set(x + w * 0.2, h + 1.2, z - d * 0.15);
    tank.castShadow = true;
    S.scene.add(tank);
    box(0.3, 1, 0.3, lambert(0x4a3a2a), x + w * 0.2, h + 0.5, z - d * 0.15);
  } else if (prop < 0.6) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 7, 5), lambert(0x2c2f36));
    mast.position.set(x - w * 0.2, h + 3.5, z + d * 0.2);
    S.scene.add(mast);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4a4a }));
    tip.position.set(x - w * 0.2, h + 7, z + d * 0.2);
    S.scene.add(tip);
  } else if (prop < 0.85) {
    const ac = box(2.2, 1, 1.6, lambert(0x9aa0a8), x + w * 0.15, h + 0.5, z + d * 0.1);
    ac.castShadow = true;
  }
  // Ground-floor storefront on the south face, central blocks only: a lit
  // shop window, a striped awning and a small glowing name sign, so the
  // street level is shops instead of blank walls.
  if (Math.abs(x) <= 100 && Math.abs(z) <= 100 && rng() < 0.55) {
    const faceZ = z + d / 2;
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3), new THREE.MeshLambertMaterial({ color: 0x2c241c }));
    frame.position.set(x, 1.7, faceZ + 0.05);
    S.scene.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 2.5), new THREE.MeshBasicMaterial({ color: 0xffc27a }));
    glass.position.set(x, 1.7, faceZ + 0.1);
    S.scene.add(glass);
    box(0.12, 2.5, 0.06, lambert(0x2c241c), x, 1.7, faceZ + 0.14);
    const awnTex = canvasTex(128, 32, (g, aw, ah) => {
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? '#f2e8d8' : '#3a7ad8';
        g.fillRect((i * aw) / 6, 0, aw / 6, ah);
      }
    });
    const awn = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.6), new THREE.MeshLambertMaterial({ map: awnTex }));
    awn.position.set(x, 3.6, faceZ + 0.9);
    awn.rotation.x = -0.4;
    S.scene.add(awn);
    const shop = SHOP_NAMES[Math.floor(rng() * SHOP_NAMES.length)];
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.3),
      new THREE.MeshBasicMaterial({ map: shopSignTex(shop) })
    );
    sign.position.set(x, 4.9, faceZ + 0.12);
    S.scene.add(sign);
  }
  S.colliders.push({ x, z, r: Math.max(w, d) * 0.72 });
  placeBlob(x, z, Math.max(w, d) * 1.5, 0.025);
  return m;
}

function buildBlocks() {
  // One tower per block cell, skipping park / landmark / beach cells.
  const skip = new Set();
  const skipCell = (cx, cz) => skip.add(`${cx},${cz}`);
  skipCell(40, 40); // Marina Park
  skipCell(-60, -60); // Cafe Luna block
  skipCell(-140, 140); // Hideout block
  skipCell(100, -100); // Solmar Tower block
  skipCell(140, -60); // hospital block
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      const cx = rx + 20, cz = rz + 20;
      if (cz >= 150) continue; // beach strip
      if (skip.has(`${cx},${cz}`)) continue;
      const w = 16 + rng() * 10;
      const d = 16 + rng() * 10;
      const h = 12 + rng() * 34;
      const color = PASTELS[Math.floor(rng() * PASTELS.length)];
      buildTower(cx, cz, w, d, h, color);
      // A few blocks get a second, lower neighbour tower.
      if (rng() < 0.3) {
        buildTower(cx + (rng() > 0.5 ? 8 : -8), cz + (rng() > 0.5 ? 7 : -7), 10, 10, 8 + rng() * 10, PASTELS[Math.floor(rng() * PASTELS.length)]);
      }
    }
  }
}

function buildPark() {
  const cx = 40, cz = 40;
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshLambertMaterial({ map: speckle('#5da24a', ['#4c8a3c', '#6fb45c', '#3f7a32'], 500, 3) })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(cx, 0.03, cz);
  S.scene.add(grass);
  // Path cross through the park.
  const pathMat = lambert(0xcbb890);
  box(30, 0.06, 3, pathMat, cx, 0.04, cz);
  box(3, 0.06, 30, pathMat, cx, 0.04, cz);
  for (let i = 0; i < 6; i++) makePalm(cx - 11 + rng() * 22, cz - 11 + rng() * 22);
  for (let i = 0; i < 4; i++) {
    const bx = cx - 10 + i * 7;
    box(3, 0.5, 1, lambert(0x8a6a42), bx, 0.25, cz - 8);
    box(3, 0.5, 1, lambert(0x8a6a42), bx, 0.25, cz + 8);
  }
}

function makePalm(x, z) {
  // Trunk leans a little; fronds are long drooping tapered blades in two
  // greens (not cones), with a coconut cluster at the crown.
  const tilt = (rng() - 0.5) * 0.16;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.34, 5.5, 6),
    lambert(0x8a6a42)
  );
  trunk.position.set(x, 2.75, z);
  trunk.rotation.z = tilt;
  trunk.castShadow = true;
  S.scene.add(trunk);
  const crownX = x - Math.sin(tilt) * 5.5;
  const leafGreens = [0x3f9a3a, 0x55b04a];
  const bladeGeo = new THREE.BoxGeometry(0.34, 0.05, 3.2);
  bladeGeo.translate(0, 0, 1.6); // pivot at the crown, tip out
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + rng() * 0.3;
    const blade = new THREE.Mesh(bladeGeo, new THREE.MeshLambertMaterial({ color: leafGreens[i % 2] }));
    blade.position.set(crownX, 5.6, z);
    blade.rotation.y = -ang;
    blade.rotation.x = 0.75 + rng() * 0.3; // droop downward, short reach
    blade.castShadow = true;
    S.scene.add(blade);
  }
  const nutSkin = lambert(0x6a4a22);
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), nutSkin);
    nut.position.set(crownX + (rng() - 0.5) * 0.7, 5.35, z + (rng() - 0.5) * 0.7);
    S.scene.add(nut);
  }
  placeBlob(x, z, 3.4, 0.025);
}

function makeStreetlight(x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 6), lambert(0x2c2f36));
  pole.position.set(x, 3, z);
  pole.castShadow = true;
  S.scene.add(pole);
  const arm = box(1.6, 0.1, 0.1, lambert(0x2c2f36), x + 0.8, 5.9, z);
  void arm;
  // At dusk the lamps are on: warm bulb + a soft glow sprite.
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd27a })
  );
  lamp.position.set(x + 1.6, 5.85, z);
  S.scene.add(lamp);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0xffd27a, transparent: true, depthWrite: false, opacity: 0.85,
  }));
  halo.scale.set(3.2, 3.2, 1);
  halo.position.set(x + 1.6, 5.85, z);
  S.scene.add(halo);
}

// One shared radial glow texture (lamps, headlights, light bars): a soft
// white-hot centre fading to transparent. Callers tint it with the
// sprite material's color instead of baking a colour into the texture.
let sharedGlow = null;
function glowTex() {
  if (sharedGlow) return sharedGlow;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sharedGlow = new THREE.CanvasTexture(c);
  return sharedGlow;
}

function buildStreetlights() {
  for (const r of WORLD.roads) {
    for (let v = -160; v <= 160; v += 80) {
      makeStreetlight(r + 5.6, v);
      // Offset along the road too: a lamp at (v, r-5.6) with v on a road
      // would stand in the middle of the crossing north-south road.
      makeStreetlight(v + 5.6, r - 5.6);
    }
  }
}

function buildClouds() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffc8a8, transparent: true, opacity: 0.7 });
  S.clouds = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(4 + rng() * 5, 8, 6), mat);
      s.position.set(j * 5 - 7 + rng() * 2, rng() * 1.5, rng() * 3);
      s.scale.y = 0.45;
      g.add(s);
    }
    g.position.set(-180 + rng() * 360, 55 + rng() * 25, -180 + rng() * 360);
    S.scene.add(g);
    S.clouds.push(g);
  }
}

// ---------------------------------------------------------------- landmarks

function buildCafeLuna() {
  const cx = -60, cz = -60;
  const base = box(24, 9, 18, lambert(0xf2d8c8), cx, 4.5, cz);
  void base;
  S.colliders.push({ x: cx, z: cz, r: 15 });
  placeBlob(cx, cz, 30, 0.025);
  // Striped awning over the storefront (faces +z, toward road z=-40).
  const awnTex = canvasTex(256, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f2f2f2' : '#e85a7a';
      g.fillRect((i * w) / 8, 0, w / 8, h);
    }
  });
  const awn = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.2), new THREE.MeshLambertMaterial({ map: awnTex }));
  awn.position.set(cx, 5.4, cz + 9.4);
  awn.rotation.x = -0.35;
  S.scene.add(awn);
  // Pink neon trim along the awning front edge.
  box(22, 0.22, 0.22, new THREE.MeshBasicMaterial({ color: 0xff5a9a }), cx, 4.4, cz + 10.6);
  // Glowing doorway.
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 5),
    new THREE.MeshBasicMaterial({ color: 0xffd27a })
  );
  door.position.set(cx, 2.5, cz + 9.15);
  S.scene.add(door);
  // Rooftop sign: ONE single-sided plane. (v2 had a DoubleSide plane plus a
  // 180-degree clone behind it, and the mirrored back text bled through.)
  const tex = signTex([
    { text: 'CAFE LUNA', size: 92, color: '#ff7ab0', y: 96 },
    { text: 'ESPRESSO · LOUNGE', size: 40, color: '#ffd94a', y: 196 },
  ], '#ff7ab0', '#ff4d8d');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 7.5),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide })
  );
  sign.position.set(cx, 13.2, cz + 9.2);
  S.scene.add(sign);
  // Gold crescent moon above the sign, single-sided, facing the street.
  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshBasicMaterial({ map: crescentTex(), transparent: true, side: THREE.FrontSide })
  );
  moon.position.set(cx, 17.8, cz + 9.2);
  S.scene.add(moon);
}

function buildHideout() {
  const cx = -140, cz = 140;
  box(22, 8, 16, lambert(0x7a6a58), cx, 4, cz);
  S.colliders.push({ x: cx, z: cz, r: 14 });
  placeBlob(cx, cz, 28, 0.025);
  // Garage door faces the road at x=-120.
  const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.5), new THREE.MeshLambertMaterial({ color: 0x3c4148 }));
  door.rotation.y = Math.PI / 2;
  door.position.set(cx + 11.1, 2.75, cz);
  S.scene.add(door);
  const tex = signTex([
    { text: 'THE HIDEOUT', size: 84, color: '#ffb84a', y: 96 },
    { text: 'CUSTOMS & GARAGE', size: 38, color: '#f2f2f2', y: 196 },
  ], '#ffb84a', '#ff9a00');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 6.5),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide })
  );
  sign.rotation.y = Math.PI / 2;
  sign.position.set(cx + 11.2, 11.5, cz);
  S.scene.add(sign);
  box(12, 0.3, 0.3, new THREE.MeshBasicMaterial({ color: 0xffb84a }), cx + 11.2, 7.6, cz);
}

function buildSolmarTower() {
  const cx = 100, cz = -100;
  // The city's landmark: 130 m, far taller than the 12–46 m neighbours, so
  // it reads above the tower row from the street (at 95 m the (20,-100)
  // tower hid it completely from road z=-80).
  // Glass curtain wall for the landmark tower: clone the facade maps so
  // the 130 m face can repeat the window grid three times up its height
  // without changing the repeat on every other glass tower.
  const face = facadeMaps(1);
  const faceMap = face.map.clone();
  faceMap.repeat.set(1, 3);
  faceMap.needsUpdate = true;
  const faceGlow = face.emissiveMap.clone();
  faceGlow.repeat.set(1, 3);
  faceGlow.needsUpdate = true;
  const towerMat = new THREE.MeshStandardMaterial({
    map: faceMap, emissive: 0xffffff, emissiveMap: faceGlow,
    emissiveIntensity: 1.2, roughness: face.roughness, metalness: face.metalness,
  });
  const m = box(26, 130, 26, towerMat, cx, 65, cz);
  m.castShadow = true;
  m.receiveShadow = true;
  void m;
  S.colliders.push({ x: cx, z: cz, r: 19 });
  placeBlob(cx, cz, 36, 0.025);
  // Spire + red aircraft beacon on the crown, so the top reads as a
  // landmark even where the sign is out of frame.
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.8, 16, 6), lambert(0x2c2f36));
  spire.position.set(cx, 138, cz);
  S.scene.add(spire);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  beacon.position.set(cx, 146.5, cz);
  S.scene.add(beacon);
  const signTex2 = signTex([
    { text: 'SOLMAR TOWER', size: 68, color: '#9ad8ff', y: 128 },
  ], '#9ad8ff', '#4da8ff');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 9),
    new THREE.MeshBasicMaterial({ map: signTex2, side: THREE.FrontSide })
  );
  sign.position.set(cx, 100, cz + 13.2);
  S.scene.add(sign);
}

function buildHospital() {
  const cx = 140, cz = -60;
  box(24, 14, 18, lambert(0xf2f2f2), cx, 7, cz);
  S.colliders.push({ x: cx, z: cz, r: 15 });
  placeBlob(cx, cz, 30, 0.025);
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: 0xe84a4a }));
  cross.position.set(cx, 15.5, cz + 9.2);
  S.scene.add(cross);
  const tex = signTex([
    { text: 'SOLMAR GENERAL', size: 64, color: '#7ad8ff', y: 128 },
  ], '#7ad8ff', '#4da8ff');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 8),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide })
  );
  sign.position.set(cx, 12, cz + 9.2);
  S.scene.add(sign);
}

function buildHarbor() {
  const hx = 0, hz = 168;
  // Pier planks out over the sand into the water.
  const pier = box(14, 0.4, 26, lambert(0x8a6a42), hx, 0.5, hz + 12);
  void pier;
  for (let i = 0; i < 5; i++) {
    box(2.4, 2.4, 2.4, lambert(0xa8803a), hx - 5 + rng() * 10, 1.6, hz - 6 + rng() * 8);
  }
  const tex = signTex([
    { text: 'SOLMAR HARBOR', size: 52, color: '#7ad8ff', y: 128 },
  ], '#7ad8ff', '#4da8ff');
  // Narrow (12 m) so it fits the gap between the towers flanking road x=0
  // instead of being clipped by them — the v3 cover read "OLMAR HARBO".
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 6),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide })
  );
  sign.position.set(hx, 11, hz - 4);
  sign.rotation.y = Math.PI;
  S.scene.add(sign);
  // Moored boats: simple hulls bobbing past the pier.
  for (let i = 0; i < 3; i++) {
    const hull = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 6), lambert(0xe8e8e8));
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = (rng() - 0.5) * 0.4;
    hull.position.set(hx - 16 + i * 16, 0.4, hz + 26 + rng() * 6);
    S.scene.add(hull);
  }
}

// Traffic-light cycle (16 s): NS green 0–7, yellow 7–8, red 8–16;
// EW is the opposite. One source of truth for the heads and the cars.
export function trafficLightState(axis) {
  const t = ((S.time % 16) + 16) % 16;
  // North-south: green for the first 7 s, yellow for 1 s, red after that.
  // East-west runs the opposite phase.
  const ns = t < 7 ? 'green' : t < 8 ? 'yellow' : 'red';
  if (axis === 'ns') return ns;
  if (t < 8) return 'red';
  return t < 15 ? 'green' : 'yellow';
}

export function updateTrafficLights() {
  if (!S.trafficLights) return;
  const st = trafficLightState('ns');
  const lit = { red: 0xff2a2a, yellow: 0xffd24a, green: 0x2aff5a };
  const dim = { red: 0x331111, yellow: 0x332a10, green: 0x14301c };
  for (const L of S.trafficLights) {
    L.red.material.color.setHex(st === 'red' ? lit.red : dim.red);
    L.yellow.material.color.setHex(st === 'yellow' ? lit.yellow : dim.yellow);
    L.green.material.color.setHex(st === 'green' ? lit.green : dim.green);
  }
}

function buildTrafficLights() {
  S.trafficLights = [];
  // One signal per other 80 m intersection (checkerboard) to keep the count sane.
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      if (rx % 80 !== 0 || rz % 80 !== 0) continue;
      if (((rx + rz) / 80) % 2 !== 0) continue;
      const x = rx + 6.2, z = rz + 6.2;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), lambert(0x2c2f36));
      mast.position.set(x, 2.7, z);
      S.scene.add(mast);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.55), lambert(0x1c1e22));
      housing.position.set(x, 5.6, z);
      S.scene.add(housing);
      // One lens on each face; the back lens shares the front lens's
      // material so both faces always show the same colour.
      const makeLens = (offHex, y) => {
        const mat = new THREE.MeshBasicMaterial({ color: offHex });
        const front = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), mat);
        front.position.set(x, y, z + 0.29);
        S.scene.add(front);
        const back = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), mat);
        back.position.set(x, y, z - 0.29);
        S.scene.add(back);
        return { material: mat };
      };
      const stop = makeLens(0x331111, 6.05);
      const caution = makeLens(0x332a10, 5.6);
      const go = makeLens(0x14301c, 5.15);
      S.trafficLights.push({ x, z, red: stop, yellow: caution, green: go });
    }
  }
}

function buildStreetProps() {
  const binMat = lambert(0x2a5a3a);
  const hydMat = lambert(0xc22a2a);
  const binGeo = new THREE.CylinderGeometry(0.45, 0.4, 0.95, 8);
  const hydGeo = new THREE.CylinderGeometry(0.26, 0.3, 0.7, 8);
  const hydTopGeo = new THREE.SphereGeometry(0.26, 8, 6);
  // Bins + hydrants near intersections.
  for (let i = 0; i < 16; i++) {
    const rx = WORLD.roads[i % WORLD.roads.length];
    const rz = WORLD.roads[(i * 2) % WORLD.roads.length];
    const bx = rx + 6.5, bz = rz - 6.5;
    const bin = new THREE.Mesh(binGeo, binMat);
    bin.position.set(bx, 0.48, bz);
    bin.castShadow = true;
    S.scene.add(bin);
    const hydrant = new THREE.Mesh(hydGeo, hydMat);
    hydrant.position.set(bx + 1.6, 0.35, bz);
    hydrant.castShadow = true;
    S.scene.add(hydrant);
    const hydCap = new THREE.Mesh(hydTopGeo, hydMat);
    hydCap.position.set(bx + 1.6, 0.75, bz);
    S.scene.add(hydCap);
  }
  // STOP signs at a few intersections (one shared texture).
  const stopTex = canvasTex(128, 128, (ctx2d, w, h) => {
    ctx2d.fillStyle = '#c22a2a';
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.fillStyle = '#ffffff';
    ctx2d.font = 'bold 34px Arial, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('STOP', w / 2, h / 2);
  });
  for (const [sx, sz] of [[-40, -46], [40, -46], [-40, 34], [40, 34], [-120, -46], [120, 34]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), lambert(0x8a8a8a));
    post.position.set(sx, 1.3, sz);
    S.scene.add(post);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: stopTex }));
    board.position.set(sx, 2.9, sz);
    board.rotation.y = Math.PI / 4;
    S.scene.add(board);
  }
  // Newsstands on the plaza corners.
  const magTex = canvasTex(128, 64, (ctx2d, w, h) => {
    const cols = ['#e84a4a', '#4a8ae8', '#e8d84a', '#4ad87a', '#d87ab8'];
    for (let i = 0; i < 5; i++) {
      ctx2d.fillStyle = cols[i];
      ctx2d.fillRect((i * w) / 5 + 3, 6, w / 5 - 6, h - 12);
    }
  });
  for (const [nx, nz] of [[13, 13], [-13, -13]]) {
    box(3.2, 2.6, 2.2, lambert(0x3a6a8a), nx, 1.3, nz);
    box(3.6, 0.25, 2.6, lambert(0xe84a4a), nx, 2.75, nz);
    const mags = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), new THREE.MeshBasicMaterial({ map: magTex }));
    mags.position.set(nx, 1.6, nz + 1.15);
    S.scene.add(mags);
  }
  // Cafe Luna outdoor tables: table + chairs + striped umbrella.
  for (const tx of [-70, -60, -50]) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.08, 12), lambert(0xf2e8d8));
    top.position.set(tx, 0.78, -49.5);
    top.castShadow = true;
    S.scene.add(top);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.78, 6), lambert(0x2c2f36));
    stem.position.set(tx, 0.39, -49.5);
    S.scene.add(stem);
    for (const s of [-1, 1]) {
      box(0.5, 0.5, 0.5, lambert(0x7a4a3a), tx + s * 1.3, 0.25, -49.5);
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), lambert(0x2c2f36));
    post.position.set(tx, 1.3, -49.5);
    S.scene.add(post);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0xe85a7a }));
    shade.position.set(tx, 2.9, -49.5);
    shade.castShadow = true;
    S.scene.add(shade);
  }
}

function buildSkyline() {
  // Distant towers ringing the city so the horizon is a skyline, not an
  // empty fog wall. Deep violet-grey silhouettes; the fog melts them into
  // the sunset. They stand outside the playable area and carry no
  // collision, so they cost nothing but the view.
  const silhouette = new THREE.MeshBasicMaterial({ color: 0x2a2438 });
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const h = 45 + ((i * 37) % 85);
    const w = 18 + ((i * 13) % 22);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), silhouette);
    const r = WORLD.half + 80;
    tower.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    S.scene.add(tower);
  }
}

function buildSidewalkProps() {
  // Benches, planters with shrubs, and bollards along the pavement edges,
  // batched into four instanced meshes so the extra street life costs
  // four draw calls instead of a hundred. They sit clear of the driving
  // line, so no collider is needed for them.
  const spots = [];
  for (const r of WORLD.roads) {
    for (let v = -140; v <= 140; v += 40) {
      spots.push([r + 6.4, v]);
      spots.push([v, r - 6.4]);
    }
  }
  const benches = [];
  const planters = [];
  const bollards = [];
  spots.forEach(([x, z], i) => {
    if (i % 6 === 0) benches.push([x, z]);
    else if (i % 6 === 3) planters.push([x, z]);
    else if (i % 2 === 0) bollards.push([x, z]);
  });
  const dummy = new THREE.Object3D();
  const fill = (geo, mat, list, y, shadow) => {
    if (list.length === 0) return;
    const instanced = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, z], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = shadow;
    S.scene.add(instanced);
  };
  fill(
    new THREE.BoxGeometry(2.2, 0.5, 0.7),
    lambert(0x8a6a42), benches, 0.25, true
  );
  fill(
    new THREE.CylinderGeometry(0.55, 0.65, 0.8, 8),
    lambert(0x5a6a4a), planters, 0.4, true
  );
  // Shrub crowns on the planters, same spots, one more instanced mesh.
  fill(
    new THREE.SphereGeometry(0.55, 8, 6),
    lambert(0x3f8a3a), planters, 1.05, true
  );
  fill(
    new THREE.CylinderGeometry(0.14, 0.16, 0.9, 8),
    lambert(0x3a3d42), bollards, 0.45, false
  );
}

export function buildCity() {
  skyDome();
  buildGround();
  buildBlocks();
  buildPark();
  buildCafeLuna();
  buildHideout();
  buildSolmarTower();
  buildHospital();
  buildHarbor();
  buildStreetlights();
  buildTrafficLights();
  buildStreetProps();
  buildSidewalkProps();
  buildSkyline();
  buildClouds();
  // Extra palms along the beach and plaza.
  for (let i = 0; i < 8; i++) makePalm(-160 + i * 44, 178);
  makePalm(-14, 14);
  makePalm(14, -14);
  makePalm(-14, -14);
  makePalm(14, 14);
}
