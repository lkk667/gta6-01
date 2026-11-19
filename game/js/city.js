// Solmar City — the city (v3 rewrite).
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
  // One 40 m tile: asphalt with speckle, a centre dash and edge lines.
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#3a3f46';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) {
      g.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.16)';
      g.fillRect(rng() * w, rng() * h, 2, 2);
    }
    g.fillStyle = '#c8c4a8';
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
        const on = rng() < 0.28;
        g.fillStyle = on ? lit : 'rgba(30,42,60,0.85)';
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
    new THREE.MeshLambertMaterial({ map: speckle('#8f9a7a', ['#7d8a68', '#a3ad8b', '#6d7a58'], 900, 3) })
  );
  ground.rotation.x = -Math.PI / 2;
  S.scene.add(ground);

  // Plaza around the centre intersection.
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshLambertMaterial({ map: plazaTex() })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.02, 0);
  S.scene.add(plaza);

  // Roads: long strips with dash texture, plus curbs.
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex() });
  for (const r of WORLD.roads) {
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, WORLD.size), roadMat);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(r, 0.015, 0);
    S.scene.add(ns);
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, ROAD_W), roadMat.clone());
    ew.material.map = roadTex();
    ew.material.map.repeat.set(10, 1);
    ew.rotation.x = -Math.PI / 2;
    ew.rotation.z = Math.PI / 2;
    ew.position.set(0, 0.015, r);
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

  // Beach + ocean at the south edge.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, 34),
    new THREE.MeshLambertMaterial({ map: speckle('#e8d8a0', ['#d8c890', '#f2e4b0', '#c8b878'], 700, 3) })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, WORLD.half - 17);
  S.scene.add(sand);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 300),
    new THREE.MeshLambertMaterial({ color: 0x2a7ab8 })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.4, WORLD.half + 150);
  S.scene.add(ocean);
}

function buildTower(x, z, w, d, h, color) {
  const tex = windowTex(color, '#ffe9a8');
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const m = box(w, h, d, mat, x, h / 2, z);
  // Rooftop cap so towers read as buildings, not plain boxes.
  box(w * 0.7, 1.2, d * 0.7, lambert(0x5a5a62), x, h + 0.6, z);
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
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.34, 5.5, 6),
    lambert(0x8a6a42)
  );
  trunk.position.set(x, 2.75, z);
  trunk.rotation.z = (rng() - 0.5) * 0.16;
  S.scene.add(trunk);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f9a3a });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.4, 4), leafMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(x + Math.cos(a) * 1.1, 5.6, z + Math.sin(a) * 1.1);
    leaf.rotation.z = Math.cos(a) * 1.1;
    leaf.rotation.x = -Math.sin(a) * 1.1;
    S.scene.add(leaf);
  }
  placeBlob(x, z, 3.4, 0.025);
}

function makeStreetlight(x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 6), lambert(0x2c2f36));
  pole.position.set(x, 3, z);
  S.scene.add(pole);
  const arm = box(1.6, 0.1, 0.1, lambert(0x2c2f36), x + 0.8, 5.9, z);
  void arm;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 })
  );
  lamp.position.set(x + 1.6, 5.85, z);
  S.scene.add(lamp);
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
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
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
  moon.position.set(cx, 18.6, cz + 9.2);
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
  const tex = windowTex('#c8d8e8', '#ffe9a8');
  const m = box(26, 95, 26, new THREE.MeshLambertMaterial({ map: tex }), cx, 47.5, cz);
  void m;
  S.colliders.push({ x: cx, z: cz, r: 19 });
  placeBlob(cx, cz, 36, 0.025);
  const signTex2 = signTex([
    { text: 'SOLMAR TOWER', size: 80, color: '#9ad8ff', y: 128 },
  ], '#9ad8ff', '#4da8ff');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 9),
    new THREE.MeshBasicMaterial({ map: signTex2, side: THREE.FrontSide })
  );
  sign.position.set(cx, 90, cz + 13.2);
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
    { text: 'SOLMAR HARBOR', size: 72, color: '#7ad8ff', y: 128 },
  ], '#7ad8ff', '#4da8ff');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 8),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide })
  );
  sign.position.set(hx, 9, hz - 4);
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

export function buildCity() {
  buildGround();
  buildBlocks();
  buildPark();
  buildCafeLuna();
  buildHideout();
  buildSolmarTower();
  buildHospital();
  buildHarbor();
  buildStreetlights();
  buildClouds();
  // Extra palms along the beach and plaza.
  for (let i = 0; i < 8; i++) makePalm(-160 + i * 44, 178);
  makePalm(-14, 14);
  makePalm(14, -14);
  makePalm(-14, -14);
  makePalm(14, 14);
}
