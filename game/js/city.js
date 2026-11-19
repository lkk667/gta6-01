// Solmar City — the city (v4 polish).
// 9x9 road grid in a 380x380 m coastal city: pastel towers, parks, beach and
// ocean, landmarks, palms, streetlights, clouds, building collision, and the
// ground/contact-shadow helpers every other system uses.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, mulberry32, clamp } from './state.js';

const rng = mulberry32(20261119);
const ROAD_W = 10;
const BLOCK = WORLD.roadGap - ROAD_W; // 30 m of buildable block between roads

// ---------------------------------------------------------------- textures

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

function skyDome() {
  // Dusk gradient sky: deep violet overhead, orange-pink band, warm horizon.
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#1e1440');
  grad.addColorStop(0.35, '#6a2a55');
  grad.addColorStop(0.58, '#e85a3a');
  grad.addColorStop(0.74, '#ff9a55');
  grad.addColorStop(0.86, '#ffc27a');
  grad.addColorStop(1, '#ffd9a0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  // Low sun glow on the western horizon.
  const sun = g.createRadialGradient(260, 430, 4, 260, 430, 130);
  sun.addColorStop(0, 'rgba(255,240,200,0.95)');
  sun.addColorStop(0.35, 'rgba(255,190,110,0.55)');
  sun.addColorStop(1, 'rgba(255,150,80,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 1024, 512);
  const t = new THREE.CanvasTexture(c);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(700, 24, 14),
    new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false })
  );
  dome.renderOrder = -10;
  S.scene.add(dome);
}

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

function roadTex() {
  // One 40 m tile: warm dusk asphalt with speckle, a centre dash and edge lines.
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#38343a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(255,220,180,0.06)' : 'rgba(0,0,0,0.16)';
      g.fillRect(rng() * w, rng() * h, 2, 2);
    }
    g.fillStyle = '#d8c890';
    g.fillRect(w / 2 - 2, 24, 4, 88); // centre dash
    g.fillStyle = 'rgba(200,200,190,0.5)';
    g.fillRect(4, 0, 3, h);
    g.fillRect(w - 7, 0, 3, h);
  }, 1, 10);
}

function windowTex(base, lit) {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const cols = 6, rows = 12;
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Dusk: nearly half the windows are lit, warm gold or orange.
        const roll = rng();
        const on = roll < 0.42;
        g.fillStyle = on ? (roll < 0.3 ? lit : '#ff9a5a') : 'rgba(24,30,48,0.9)';
        g.fillRect(c * cw + 4, r * ch + 5, cw - 8, ch - 10);
      }
    }
  });
}

function signTex(lines, fg, glow) {
  // lines: [{text, size, color, y}] drawn on a dark plate.
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
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size * 0.8),
    new THREE.MeshBasicMaterial({ map: getBlobTex(), transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y || 0.03;
  m.renderOrder = 1;
  S.scene.add(m);
  blobShadows.push({ mesh: m, follow });
  return m;
}

export function placeBlob(x, z, size, y) {
  const m = attachBlob(null, size, y);
  m.position.x = x;
  m.position.z = z;
  return m;
}

export function updateBlobShadows() {
  for (const b of blobShadows) {
    if (b.follow) {
      b.mesh.position.x = b.follow.position.x;
      b.mesh.position.z = b.follow.position.z;
    }
  }
}

// ---------------------------------------------------------------- collision

export function resolveCollisions(pos, r) {
  for (const c of S.colliders) {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + r;
    if (d < min && d > 0.0001) {
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
    }
  }
  pos.x = clamp(pos.x, -WORLD.half + 2, WORLD.half - 2);
  pos.z = clamp(pos.z, -WORLD.half + 2, WORLD.half - 2);
}

// ---------------------------------------------------------------- builders

const PASTELS = ['#e8b4b8', '#b8d8e8', '#e8d8a8', '#b8e8c8', '#d8c8e8', '#f0c8a0', '#a8c8e0', '#e0a8a8'];

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  S.scene.add(m);
  return m;
}

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function buildGround() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, WORLD.size),
    new THREE.MeshLambertMaterial({ map: speckle('#8a7a58', ['#7a6a48', '#9a8a68', '#6a5a40'], 900, 3) })
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

  // Roads: long strips with dash texture, plus curbs.
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex() });
  for (const r of WORLD.roads) {
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, WORLD.size), roadMat);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(r, 0.015, 0);
    ns.receiveShadow = true;
    S.scene.add(ns);
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, ROAD_W), roadMat.clone());
    ew.material.map = roadTex();
    ew.material.map.repeat.set(10, 1);
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

  // Crosswalks at every intersection: white stripes across each road.
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xe8e6da });
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      for (let i = -2; i <= 2; i++) {
        const s1 = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3.4), stripeMat);
        s1.rotation.x = -Math.PI / 2;
        s1.position.set(rx + i * 2, 0.03, rz + ROAD_W / 2 + 2.2);
        S.scene.add(s1);
        const s2 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), stripeMat);
        s2.rotation.x = -Math.PI / 2;
        s2.position.set(rx + ROAD_W / 2 + 2.2, 0.03, rz + i * 2);
        S.scene.add(s2);
      }
    }
  }

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

// Shared shop-sign textures (one canvas each, reused by every storefront).
const SHOP_NAMES = ['TACOS', 'PIZZA', 'BARBER', 'LAUNDRY', 'BAKERY', 'PHONES', 'DONUTS', 'FLOWERS'];
let shopSignTexs = null;
function shopSignTex(name) {
  if (!shopSignTexs) {
    shopSignTexs = SHOP_NAMES.map((n) => canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = '#1c1410';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd27a';
      g.font = 'bold 34px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#ff9a3a';
      g.shadowBlur = 12;
      g.fillText(n, w / 2, h / 2 + 1);
      g.shadowBlur = 0;
    }));
  }
  return shopSignTexs[SHOP_NAMES.indexOf(name) % SHOP_NAMES.length];
}

function buildTower(x, z, w, d, h, color) {
  const tex = windowTex(color, '#ffe9a8');
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const m = box(w, h, d, mat, x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  // Varied roofline: a setback upper floor on some towers.
  if (rng() < 0.35) {
    const up = box(w * 0.55, 3 + rng() * 4, d * 0.55, lambert(color), x, h + 1.5 + rng() * 2, z);
    up.castShadow = true;
  } else {
    // Rooftop cap so towers read as buildings, not plain boxes.
    const cap = box(w * 0.7, 1.2, d * 0.7, lambert(0x5a5a62), x, h + 0.6, z);
    cap.castShadow = true;
  }
  // Rooftop props: water tank, antenna, AC unit.
  const roll = rng();
  if (roll < 0.35) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 8), lambert(0x7a5a3a));
    tank.position.set(x + w * 0.2, h + 1.2, z - d * 0.15);
    tank.castShadow = true;
    S.scene.add(tank);
    const legs = box(0.3, 1, 0.3, lambert(0x4a3a2a), x + w * 0.2, h + 0.5, z - d * 0.15);
    void legs;
  } else if (roll < 0.6) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 7, 5), lambert(0x2c2f36));
    ant.position.set(x - w * 0.2, h + 3.5, z + d * 0.2);
    S.scene.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4a4a }));
    tip.position.set(x - w * 0.2, h + 7, z + d * 0.2);
    S.scene.add(tip);
  } else if (roll < 0.85) {
    const ac = box(2.2, 1, 1.6, lambert(0x9aa0a8), x + w * 0.15, h + 0.5, z + d * 0.1);
    ac.castShadow = true;
  }
  // Ground-floor storefront on the south face, central blocks only: a lit
  // shop window, a striped awning and a small glowing name sign, so the
  // street level is shops instead of blank walls.
  if (Math.abs(x) <= 100 && Math.abs(z) <= 100 && rng() < 0.55) {
    const fz = z + d / 2;
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3), new THREE.MeshLambertMaterial({ color: 0x2c241c }));
    frame.position.set(x, 1.7, fz + 0.05);
    S.scene.add(frame);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 2.5), new THREE.MeshBasicMaterial({ color: 0xffc27a }));
    win.position.set(x, 1.7, fz + 0.1);
    S.scene.add(win);
    const mull = box(0.12, 2.5, 0.06, lambert(0x2c241c), x, 1.7, fz + 0.14);
    void mull;
    const awnTex = canvasTex(128, 32, (g, aw, ah) => {
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? '#f2e8d8' : '#3a7ad8';
        g.fillRect((i * aw) / 6, 0, aw / 6, ah);
      }
    });
    const awn = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.6), new THREE.MeshLambertMaterial({ map: awnTex }));
    awn.position.set(x, 3.6, fz + 0.9);
    awn.rotation.x = -0.4;
    S.scene.add(awn);
    const name = SHOP_NAMES[Math.floor(rng() * SHOP_NAMES.length)];
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.3),
      new THREE.MeshBasicMaterial({ map: shopSignTex(name) })
    );
    sign.position.set(x, 4.9, fz + 0.12);
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
  const lean = (rng() - 0.5) * 0.16;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.34, 5.5, 6),
    lambert(0x8a6a42)
  );
  trunk.position.set(x, 2.75, z);
  trunk.rotation.z = lean;
  trunk.castShadow = true;
  S.scene.add(trunk);
  const topX = x - Math.sin(lean) * 5.5;
  const topZ = z;
  const greens = [0x3f9a3a, 0x55b04a];
  const frondGeo = new THREE.BoxGeometry(0.34, 0.05, 3.2);
  frondGeo.translate(0, 0, 1.6); // pivot at the crown, tip out
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.3;
    const frond = new THREE.Mesh(frondGeo, new THREE.MeshLambertMaterial({ color: greens[i % 2] }));
    frond.position.set(topX, 5.6, topZ);
    frond.rotation.y = -a;
    frond.rotation.x = 0.75 + rng() * 0.3; // droop downward, short reach
    frond.castShadow = true;
    S.scene.add(frond);
  }
  const nutMat = lambert(0x6a4a22);
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), nutMat);
    nut.position.set(topX + (rng() - 0.5) * 0.7, 5.35, topZ + (rng() - 0.5) * 0.7);
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
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex('rgba(255,210,122,1)'), transparent: true, depthWrite: false, opacity: 0.85,
  }));
  glow.scale.set(3.2, 3.2, 1);
  glow.position.set(x + 1.6, 5.85, z);
  S.scene.add(glow);
}

// One shared radial glow texture (lamps, headlights, light bars).
let _glowTex = null;
function glowTex(rgba) {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, rgba);
  grad.addColorStop(0.5, rgba.replace('1)', '0.45)'));
  grad.addColorStop(1, rgba.replace('1)', '0)'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
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
  const tex = windowTex('#c8d8e8', '#ffe9a8');
  tex.repeat.set(1, 3);
  const m = box(26, 130, 26, new THREE.MeshLambertMaterial({ map: tex }), cx, 65, cz);
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
  if (axis === 'ns') return t < 7 ? 'green' : t < 8 ? 'yellow' : 'red';
  return t < 8 ? 'red' : t < 15 ? 'green' : 'yellow';
}

export function updateTrafficLights() {
  if (!S.trafficLights) return;
  for (const L of S.trafficLights) {
    const st = trafficLightState('ns');
    L.red.material.color.setHex(st === 'red' ? 0xff2a2a : 0x331111);
    L.yellow.material.color.setHex(st === 'yellow' ? 0xffd24a : 0x332a10);
    L.green.material.color.setHex(st === 'green' ? 0x2aff5a : 0x14301c);
  }
}

function buildTrafficLights() {
  S.trafficLights = [];
  // One signal per other 80 m intersection (checkerboard) to keep the count sane.
  let n = 0;
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      if (rx % 80 !== 0 || rz % 80 !== 0) continue;
      if (((rx + rz) / 80) % 2 !== 0) continue;
      n++;
      const x = rx + 6.2, z = rz + 6.2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), lambert(0x2c2f36));
      pole.position.set(x, 2.7, z);
      S.scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.55), lambert(0x1c1e22));
      head.position.set(x, 5.6, z);
      S.scene.add(head);
      const mkLens = (color, y, dz) => {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.19, 8, 6),
          new THREE.MeshBasicMaterial({ color })
        );
        m.position.set(x, y, z + dz);
        S.scene.add(m);
        return m;
      };
      // Lenses on both faces so drivers on the NS road see the signal.
      const red = mkLens(0x331111, 6.05, 0.29);
      mkLens(0x331111, 6.05, -0.29).material = red.material;
      const yellow = mkLens(0x332a10, 5.6, 0.29);
      mkLens(0x332a10, 5.6, -0.29).material = yellow.material;
      const green = mkLens(0x14301c, 5.15, 0.29);
      mkLens(0x14301c, 5.15, -0.29).material = green.material;
      S.trafficLights.push({ x, z, red, yellow, green });
    }
  }
}

function buildStreetProps() {
  const binMat = lambert(0x2a5a3a);
  const hydMat = lambert(0xc22a2a);
  // Bins + hydrants near intersections.
  for (let i = 0; i < 16; i++) {
    const rx = WORLD.roads[i % WORLD.roads.length];
    const rz = WORLD.roads[(i * 2) % WORLD.roads.length];
    const bx = rx + 6.5, bz = rz - 6.5;
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.4, 0.95, 8), binMat);
    bin.position.set(bx, 0.48, bz);
    bin.castShadow = true;
    S.scene.add(bin);
    const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.7, 8), hydMat);
    hyd.position.set(bx + 1.6, 0.35, bz);
    hyd.castShadow = true;
    S.scene.add(hyd);
    const hydTop = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), hydMat);
    hydTop.position.set(bx + 1.6, 0.75, bz);
    S.scene.add(hydTop);
  }
  // STOP signs at a few intersections (one shared texture).
  const stopTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c22a2a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = 'bold 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('STOP', w / 2, h / 2);
  });
  for (const [sx, sz] of [[-40, -46], [40, -46], [-40, 34], [40, 34], [-120, -46], [120, 34]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), lambert(0x8a8a8a));
    pole.position.set(sx, 1.3, sz);
    S.scene.add(pole);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: stopTex }));
    sign.position.set(sx, 2.9, sz);
    sign.rotation.y = Math.PI / 4;
    S.scene.add(sign);
  }
  // Newsstands on the plaza corners.
  const magTex = canvasTex(128, 64, (g, w, h) => {
    const cols = ['#e84a4a', '#4a8ae8', '#e8d84a', '#4ad87a', '#d87ab8'];
    for (let i = 0; i < 5; i++) {
      g.fillStyle = cols[i];
      g.fillRect((i * w) / 5 + 3, 6, w / 5 - 6, h - 12);
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
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.78, 6), lambert(0x2c2f36));
    leg.position.set(tx, 0.39, -49.5);
    S.scene.add(leg);
    for (const s of [-1, 1]) {
      box(0.5, 0.5, 0.5, lambert(0x7a4a3a), tx + s * 1.3, 0.25, -49.5);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), lambert(0x2c2f36));
    pole.position.set(tx, 1.3, -49.5);
    S.scene.add(pole);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0xe85a7a }));
    umb.position.set(tx, 2.9, -49.5);
    umb.castShadow = true;
    S.scene.add(umb);
  }
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
  buildClouds();
  // Extra palms along the beach and plaza.
  for (let i = 0; i < 8; i++) makePalm(-160 + i * 44, 178);
  makePalm(-14, 14);
  makePalm(14, -14);
  makePalm(-14, -14);
  makePalm(14, 14);
}
