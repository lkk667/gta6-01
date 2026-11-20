// Solmar City — the city itself.
// A 9x9 road grid in a 380x380 m coastal city at dusk: pastel towers,
// a park, a beach and an ocean, the landmarks, palms, streetlights and
// clouds, plus the collision circles and the ground/contact-shadow
// helpers the other systems build on. All textures are procedural (see
// textures.js for the surface library); nothing is fetched.
// The towers break the uniform grid: facades carry windows of different
// sizes with balconies and air-conditioner boxes, each tower sits on a
// darker ground-floor plinth, rooflines step back at different heights,
// and the curbs stand out as a real edge between road and pavement.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, mulberry32, clamp } from './state.js';
import { asphaltMaps, sidewalkMap, facadeMaps } from './textures.js';

const dice = mulberry32(20261119);
const ROAD_W = 10;
const BLOCK = WORLD.roadGap - ROAD_W; // 30 m of buildable block between roads

// ------------------------------------------------------------ paint helpers

// Paint a canvas and wrap it as a repeating texture.
function paintCanvas(w, h, draw, repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX || 1, repeatY || 1);
  t.anisotropy = 8;
  return t;
}

// Dusk sky: a big inverted sphere painted with a vertical gradient — deep
// violet overhead fading through magenta and orange to a warm horizon —
// plus a low sun glow on the western side. The dome ignores fog.
function buildSky() {
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

// A speckled flat colour: base + a scatter of soft tinted dots. Each
// dot is a radial fade — full colour at the centre, transparent at the
// edge — so the surface reads as material instead of a mosaic.
function grainTex(base, dots, count, size) {
  return paintCanvas(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < count; i++) {
      const col = dots[Math.floor(dice() * dots.length)];
      const a = 0.25 + dice() * 0.45;
      const s = 1 + dice() * size;
      const x = dice() * w;
      const y = dice() * h;
      // Hex colour -> rgba with the dot's alpha, so the fade runs from the
      // dot colour to transparent instead of to transparent black.
      const r = parseInt(col.slice(1, 3), 16);
      const gg = parseInt(col.slice(3, 5), 16);
      const b = parseInt(col.slice(5, 7), 16);
      const grad = g.createRadialGradient(x, y, 0.5, x, y, s);
      grad.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + b + ',' + a.toFixed(2) + ')');
      grad.addColorStop(1, 'rgba(' + r + ',' + gg + ',' + b + ',0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }, 12, 12);
}

function plazaSurface() {
  return paintCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#b7a98d';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,78,60,0.55)';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i * h) / 4); g.lineTo(w, (i * h) / 4); g.stroke();
    }
    // A warm base with soft drift: a few radial tints across the slab and
    // a scatter of soft round flecks, never hard square noise. The slab's
    // radial warmth also helps the cafe seating read as a lit zone at dusk.
    for (let i = 0; i < 6; i++) {
      const x = dice() * w;
      const y = dice() * h;
      const r = 60 + dice() * 80;
      const warm = g.createRadialGradient(x, y, 0, x, y, r);
      warm.addColorStop(0, dice() > 0.5 ? 'rgba(200,150,90,0.10)' : 'rgba(255,220,160,0.08)');
      warm.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = warm;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 240; i++) {
      g.fillStyle = dice() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(60,50,35,0.12)';
      const x = dice() * w;
      const y = dice() * h;
      const r = 1 + dice() * 3;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }, 10, 10);
}

// Neon sign plate: lines of glowing text on a dark plate, drawn twice so
// the neon reads brighter. `lines` is [{text, size, color, y}].
function neonSign(lines, fg, glow) {
  return paintCanvas(512, 256, (g, w, h) => {
    g.fillStyle = '#14101c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const ln of lines) {
      g.font = 'bold ' + ln.size + 'px Arial, sans-serif';
      g.shadowColor = glow;
      g.shadowBlur = 26;
      g.fillStyle = ln.color;
      g.fillText(ln.text, w / 2, ln.y);
      g.fillText(ln.text, w / 2, ln.y); // second pass = stronger neon
    }
    g.shadowBlur = 0;
  });
}

function moonTex() {
  return paintCanvas(128, 128, (g, w, h) => {
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

// ------------------------------------------------------------ shadows

let blobTex = null;
function blobTexture() {
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
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false })
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

// ------------------------------------------------------------ collision

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

// ------------------------------------------------------------ builders

const PASTELS = ['#e8b4b8', '#b8d8e8', '#e8d8a8', '#b8e8c8', '#d8c8e8', '#f0c8a0', '#a8c8e0', '#e0a8a8'];

function addBox(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  S.scene.add(mesh);
  return mesh;
}

function flat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function layStreets() {
  // A tiled pavement under the whole city, so the ground between the
  // roads reads as paving, not one flat brown slab.
  const tiles = sidewalkMap();
  tiles.repeat.set(48, 48);
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, WORLD.size),
    new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.9 })
  );
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = true;
  S.scene.add(base);

  // The central plaza, around the middle intersection.
  const square = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshLambertMaterial({ map: plazaSurface() })
  );
  square.rotation.x = -Math.PI / 2;
  square.position.set(0, 0.02, 0);
  square.receiveShadow = true;
  S.scene.add(square);

  // Roads: asphalt with a roughness map so the dusk sun catches the worn
  // bands. The tile repeats ten times down each road, laying the centre
  // dash and edge lines along the whole street.
  const asphalt = asphaltMaps();
  asphalt.map.repeat.set(1, 10);
  asphalt.roughnessMap.repeat.set(1, 10);
  const streetMat = new THREE.MeshStandardMaterial({
    map: asphalt.map, roughnessMap: asphalt.roughnessMap, roughness: 0.92, metalness: 0.05,
  });
  for (const road of WORLD.roads) {
    const nsStrip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, WORLD.size), streetMat);
    nsStrip.rotation.x = -Math.PI / 2;
    nsStrip.position.set(road, 0.015, 0);
    nsStrip.receiveShadow = true;
    S.scene.add(nsStrip);
    // For east-west roads the tile turns: clone the maps and repeat
    // across instead of along.
    const ewStreetMat = streetMat.clone();
    ewStreetMat.map = asphalt.map.clone();
    ewStreetMat.map.repeat.set(10, 1);
    ewStreetMat.map.needsUpdate = true;
    ewStreetMat.roughnessMap = asphalt.roughnessMap.clone();
    ewStreetMat.roughnessMap.repeat.set(10, 1);
    ewStreetMat.roughnessMap.needsUpdate = true;
    const ewStrip = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, ROAD_W), ewStreetMat);
    ewStrip.rotation.x = -Math.PI / 2;
    ewStrip.rotation.z = Math.PI / 2;
    ewStrip.position.set(0, 0.015, road);
    ewStrip.receiveShadow = true;
    S.scene.add(ewStrip);
    // Kerbs: pale raised strips on both edges of each road, tall enough
    // to read as a real edge between asphalt and pavement, north-south
    // and east-west alike.
    for (const side of [-1, 1]) {
      const curbN = addBox(0.55, 0.24, WORLD.size, flat(0xd8d0b8), road + side * (ROAD_W / 2 + 0.28), 0.12, 0);
      curbN.castShadow = false;
      const curbE = addBox(WORLD.size, 0.24, 0.55, flat(0xd8d0b8), 0, 0.12, road + side * (ROAD_W / 2 + 0.28));
      curbE.castShadow = false;
    }
  }

  // Zebra crossings at every junction: five white stripes across each
  // road, on both approaches.
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xe8e6da });
  const paintStripe = (sw, sd, sx, sz) => {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd), crossMat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(sx, 0.03, sz);
    S.scene.add(mark);
  };
  for (const roadX of WORLD.roads) {
    for (const roadZ of WORLD.roads) {
      for (let k = -2; k <= 2; k++) {
        paintStripe(1.1, 3.4, roadX + k * 2, roadZ + ROAD_W / 2 + 2.2);
        paintStripe(3.4, 1.1, roadX + ROAD_W / 2 + 2.2, roadZ + k * 2);
      }
    }
  }

  // Stop bars: one white bar across each lane just before every crossing,
  // so junctions read as real ones from the driver's seat. Batched into
  // a single instanced mesh — 324 bars, one draw call.
  const stopList = [];
  for (const roadX of WORLD.roads) {
    for (const roadZ of WORLD.roads) {
      stopList.push([roadX, roadZ + ROAD_W / 2 + 5.4, 3.6, 0.5]);
      stopList.push([roadX, roadZ - ROAD_W / 2 - 5.4, 3.6, 0.5]);
      stopList.push([roadX + ROAD_W / 2 + 5.4, roadZ, 0.5, 3.6]);
      stopList.push([roadX - ROAD_W / 2 - 5.4, roadZ, 0.5, 3.6]);
    }
  }
  const stopShape = new THREE.PlaneGeometry(1, 1);
  stopShape.rotateX(-Math.PI / 2);
  const stopBatch = new THREE.InstancedMesh(stopShape, crossMat, stopList.length);
  const placer = new THREE.Object3D();
  stopList.forEach(([bx, bz, bw, bd], idx) => {
    placer.position.set(bx, 0.03, bz);
    placer.scale.set(bw, 1, bd);
    placer.updateMatrix();
    stopBatch.setMatrixAt(idx, placer.matrix);
  });
  stopBatch.instanceMatrix.needsUpdate = true;
  S.scene.add(stopBatch);

  // The beach and the sea at the south edge: warm sand, deep dusk-blue water.
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size, 34),
    new THREE.MeshLambertMaterial({ map: grainTex('#e8c890', ['#d8b878', '#f2d4a0', '#c8a868'], 700, 3) })
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(0, 0.02, WORLD.half - 17);
  beach.receiveShadow = true;
  S.scene.add(beach);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 300),
    new THREE.MeshLambertMaterial({ color: 0x2a4a7a })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.4, WORLD.half + 150);
  S.scene.add(sea);
}

// Shared shop-sign textures: one small dark plate with a glowing name each,
// drawn once per name and reused by every storefront in the city.
const SHOP_NAMES = ['TACOS', 'PIZZA', 'BARBER', 'LAUNDRY', 'BAKERY', 'PHONES', 'DONUTS', 'FLOWERS'];
const shopSignCache = new Map();
function shopSignTex(name) {
  let tex = shopSignCache.get(name);
  if (tex) return tex;
  tex = paintCanvas(256, 64, (g, w, h) => {
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

function erectTower(bx, bz, bw, bd, bh, paint) {
  // Each block gets its own facade style so neighbours don't match:
  // warm stone, glass curtain wall, deco, concrete or brick, each with
  // a lit-window emissive map of its own so the windows glow at dusk.
  // The facade texture carries windows of different sizes, a few
  // balconies and air-conditioner boxes, so no two faces are identical.
  const kind = Math.abs(Math.floor(bx * 0.7 + bz * 1.3)) % 5;
  const skin = facadeMaps(kind);
  const wallMat = new THREE.MeshStandardMaterial({
    map: skin.map, emissive: 0xffffff, emissiveMap: skin.emissiveMap,
    emissiveIntensity: 1.15, roughness: skin.roughness, metalness: skin.metalness,
  });
  const tower = addBox(bw, bh, bd, wallMat, bx, bh / 2, bz);
  tower.castShadow = true;
  tower.receiveShadow = true;
  // A stone plinth at the ground floor, a little wider than the tower,
  // so the building meets the pavement instead of floating on it.
  const base = addBox(bw + 0.6, 1.1, bd + 0.6, flat(0x4a4440), bx, 0.55, bz);
  base.castShadow = false;
  base.receiveShadow = true;
  // A varied roofline: a setback upper floor on about a third of towers,
  // sometimes shifted off-centre so the skyline steps instead of lining
  // up flat.
  if (dice() < 0.35) {
    const shiftX = (dice() - 0.5) * bw * 0.3;
    const shiftZ = (dice() - 0.5) * bd * 0.3;
    const topFloor = addBox(bw * 0.55, 3 + dice() * 4, bd * 0.55, flat(paint), bx + shiftX, bh + 1.5 + dice() * 2, bz + shiftZ);
    topFloor.castShadow = true;
  } else {
    // A rooftop cap, so towers read as buildings and not plain boxes.
    const roofCap = addBox(bw * 0.7, 1.2, bd * 0.7, flat(0x5a5a62), bx, bh + 0.6, bz);
    roofCap.castShadow = true;
  }
  // A rooftop prop: a water tank, an antenna with a red tip, or an AC unit.
  const pick = dice();
  if (pick < 0.35) {
    const cistern = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 8), flat(0x7a5a3a));
    cistern.position.set(bx + bw * 0.2, bh + 1.2, bz - bd * 0.15);
    cistern.castShadow = true;
    S.scene.add(cistern);
    addBox(0.3, 1, 0.3, flat(0x4a3a2a), bx + bw * 0.2, bh + 0.5, bz - bd * 0.15);
  } else if (pick < 0.6) {
    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 7, 5), flat(0x2c2f36));
    aerial.position.set(bx - bw * 0.2, bh + 3.5, bz + bd * 0.2);
    S.scene.add(aerial);
    const tipLight = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff4a4a }));
    tipLight.position.set(bx - bw * 0.2, bh + 7, bz + bd * 0.2);
    S.scene.add(tipLight);
  } else if (pick < 0.85) {
    const cooler = addBox(2.2, 1, 1.6, flat(0x9aa0a8), bx + bw * 0.15, bh + 0.5, bz + bd * 0.1);
    cooler.castShadow = true;
  }
  // A storefront on the ground floor, south face, central blocks only:
  // a lit shop window, a striped awning and a small glowing name sign,
  // so the street level is shops instead of blank walls.
  if (Math.abs(bx) <= 100 && Math.abs(bz) <= 100 && dice() < 0.55) {
    const frontZ = bz + bd / 2;
    const shopFrame = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3), new THREE.MeshLambertMaterial({ color: 0x2c241c }));
    shopFrame.position.set(bx, 1.7, frontZ + 0.05);
    S.scene.add(shopFrame);
    const shopGlass = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 2.5), new THREE.MeshBasicMaterial({ color: 0xffc27a }));
    shopGlass.position.set(bx, 1.7, frontZ + 0.1);
    S.scene.add(shopGlass);
    addBox(0.12, 2.5, 0.06, flat(0x2c241c), bx, 1.7, frontZ + 0.14);
    const awnCanvas = paintCanvas(128, 32, (ctx, cw, ch) => {
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = k % 2 ? '#f2e8d8' : '#3a7ad8';
        ctx.fillRect((k * cw) / 6, 0, cw / 6, ch);
      }
    });
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.6), new THREE.MeshLambertMaterial({ map: awnCanvas }));
    canopy.position.set(bx, 3.6, frontZ + 0.9);
    canopy.rotation.x = -0.4;
    S.scene.add(canopy);
    const shopName = SHOP_NAMES[Math.floor(dice() * SHOP_NAMES.length)];
    const shopSign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.3),
      new THREE.MeshBasicMaterial({ map: shopSignTex(shopName) })
    );
    shopSign.position.set(bx, 4.9, frontZ + 0.12);
    S.scene.add(shopSign);
  }
  S.colliders.push({ x: bx, z: bz, r: Math.max(bw, bd) * 0.72 });
  placeBlob(bx, bz, Math.max(bw, bd) * 1.5, 0.025);
  return tower;
}

function layTowers() {
  // One tower in each block cell, except the park, landmark and beach cells.
  const omit = new Set();
  const omitCell = (ox, oz) => omit.add(ox + ',' + oz);
  omitCell(40, 40); // Marina Park
  omitCell(-60, -60); // Cafe Luna block
  omitCell(-140, 140); // Hideout block
  omitCell(100, -100); // Solmar Tower block
  omitCell(140, -60); // hospital block
  for (const roadX of WORLD.roads) {
    for (const roadZ of WORLD.roads) {
      const cellX = roadX + 20, cellZ = roadZ + 20;
      if (cellZ >= 150) continue; // beach strip
      if (omit.has(cellX + ',' + cellZ)) continue;
      const bw = 16 + dice() * 10;
      const bd = 16 + dice() * 10;
      let bh = 12 + dice() * 34;
      // Hold the tower row just north of road z=-80 low (22 m max) so the
      // 130 m Solmar Tower still reads above it from the mission staging
      // on that road — a tall tower in this row would hide the landmark.
      if (cellZ === -100 && cellX >= -20 && cellX <= 100) bh = Math.min(bh, 22);
      const paint = PASTELS[Math.floor(dice() * PASTELS.length)];
      erectTower(cellX, cellZ, bw, bd, bh, paint);
      // A few blocks get a second, lower neighbour.
      if (dice() < 0.3) {
        erectTower(cellX + (dice() > 0.5 ? 8 : -8), cellZ + (dice() > 0.5 ? 7 : -7), 10, 10, 8 + dice() * 10, PASTELS[Math.floor(dice() * PASTELS.length)]);
      }
    }
  }
}

function layPark() {
  const cx = 40, cz = 40;
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshLambertMaterial({ map: grainTex('#5da24a', ['#4c8a3c', '#6fb45c', '#3f7a32'], 500, 3) })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(cx, 0.03, cz);
  S.scene.add(grass);
  // Path cross through the park.
  const pathMat = flat(0xcbb890);
  addBox(30, 0.06, 3, pathMat, cx, 0.04, cz);
  addBox(3, 0.06, 30, pathMat, cx, 0.04, cz);
  for (let i = 0; i < 6; i++) plantPalm(cx - 11 + dice() * 22, cz - 11 + dice() * 22);
  for (let i = 0; i < 4; i++) {
    const bx = cx - 10 + i * 7;
    addBox(3, 0.5, 1, flat(0x8a6a42), bx, 0.25, cz - 8);
    addBox(3, 0.5, 1, flat(0x8a6a42), bx, 0.25, cz + 8);
    // Park benches are seats too: record them so a pedestrian can sit.
    S.benches.push({ x: bx, z: cz - 8 });
    S.benches.push({ x: bx, z: cz + 8 });
  }
}

// One shared palm-frond texture, drawn once and reused by every palm:
// a long feather leaf, pointed at both ends and widest near the middle,
// filled with a soft green gradient (darker at the base, lighter at the
// tip) and veined — a pale central rib with fine diagonal side veins.
// The canvas is transparent outside the leaf, so alphaTest cuts the
// frond out cleanly and the dusk sky shows through between the leaves.
let palmLeafTex = null;
function leafTexture() {
  if (palmLeafTex) return palmLeafTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, '#2e7a2e');
  grad.addColorStop(0.55, '#3f9a3a');
  grad.addColorStop(1, '#63c04f');
  g.fillStyle = grad;
  // The leaf outline: two quadratic curves meeting at a point at the tip
  // and at the base, widest about 40% up from the base.
  g.beginPath();
  g.moveTo(64, 0);
  g.quadraticCurveTo(118, 90, 78, 236);
  g.quadraticCurveTo(70, 252, 64, 256);
  g.quadraticCurveTo(58, 252, 50, 236);
  g.quadraticCurveTo(10, 90, 64, 0);
  g.closePath();
  g.fill();
  // The central rib: a pale line down the middle, thicker at the base.
  g.strokeStyle = 'rgba(220,245,200,0.75)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(64, 250);
  g.lineTo(64, 8);
  g.stroke();
  // Fine side veins, angling from the rib out to the edge.
  g.strokeStyle = 'rgba(220,245,200,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const y = 30 + i * 15;
    const spread = 34 - i * 1.2;
    g.beginPath();
    g.moveTo(64, y);
    g.lineTo(64 + spread, y + 22);
    g.stroke();
    g.beginPath();
    g.moveTo(64, y);
    g.lineTo(64 - spread, y + 22);
    g.stroke();
  }
  palmLeafTex = new THREE.CanvasTexture(c);
  return palmLeafTex;
}

function plantPalm(x, z) {
  // The trunk leans a little and curves: a tube along a gentle quadratic
  // bend, not a straight cylinder. The crown sits where the old straight
  // trunk's crown sat, so the fronds and coconuts are in the same place.
  const tilt = (dice() - 0.5) * 0.16;
  const leanX = -Math.sin(tilt) * 5.5;
  const trunkCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(x, 0, z),
    new THREE.Vector3(x + leanX * 0.3, 2.8, z),
    new THREE.Vector3(x + leanX, 5.5, z)
  );
  const trunk = new THREE.Mesh(
    new THREE.TubeGeometry(trunkCurve, 10, 0.27, 6, false),
    flat(0x8a6a42)
  );
  trunk.castShadow = true;
  S.scene.add(trunk);
  const crownX = x + leanX;
  // Fronds are feather leaves, not solid blades: a canvas-drawn leaf with
  // a vein gradient on a plane, alphaTest cutting the leaf shape out so
  // the sky shows between the fronds. The plane is laid flat and pivoted
  // at the crown, so each leaf droops outward like a real palm frond.
  const leafGeo = new THREE.PlaneGeometry(0.85, 3.2);
  leafGeo.rotateX(Math.PI / 2); // leaf length now runs along +Z
  leafGeo.translate(0, 0, 1.6); // pivot at the crown, tip out
  const leafMats = [
    new THREE.MeshLambertMaterial({ map: leafTexture(), alphaTest: 0.35, side: THREE.DoubleSide }),
    new THREE.MeshLambertMaterial({ map: leafTexture(), color: 0xd8f0d0, alphaTest: 0.35, side: THREE.DoubleSide }),
  ];
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + dice() * 0.3;
    const leaf = new THREE.Mesh(leafGeo, leafMats[i % 2]);
    leaf.position.set(crownX, 5.6, z);
    leaf.rotation.y = -ang;
    leaf.rotation.x = 0.75 + dice() * 0.3; // droop downward, short reach
    leaf.castShadow = true;
    S.scene.add(leaf);
  }
  const nutSkin = flat(0x6a4a22);
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), nutSkin);
    nut.position.set(crownX + (dice() - 0.5) * 0.7, 5.35, z + (dice() - 0.5) * 0.7);
    S.scene.add(nut);
  }
  placeBlob(x, z, 3.4, 0.025);
}

// A modern curved streetlight: one smooth tube that rises straight and
// then bends over in a single continuous curve, instead of a vertical
// pole plus a horizontal arm at a hard 90 degrees. The bend is a
// quadratic bezier — the control point sits directly above the base, so
// the tube leaves the ground vertically and arrives at the bulb
// horizontally. The warm bulb and its glow halo stay exactly where they
// were, so the light still falls on the same patch of road.
function plantLamp(x, z) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(x, 0, z),
    new THREE.Vector3(x, 5.9, z),
    new THREE.Vector3(x + 1.6, 5.85, z)
  );
  const pole = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 16, 0.1, 8, false),
    flat(0x2c2f36)
  );
  pole.castShadow = true;
  S.scene.add(pole);
  // At dusk the lamps are on: warm bulb + a soft glow sprite.
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd27a })
  );
  lamp.position.set(x + 1.6, 5.85, z);
  S.scene.add(lamp);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sharedGlowTex(), color: 0xffd27a, transparent: true, depthWrite: false, opacity: 0.85,
  }));
  halo.scale.set(3.2, 3.2, 1);
  halo.position.set(x + 1.6, 5.85, z);
  S.scene.add(halo);
}

// One shared radial glow texture (lamps, headlights, light bars): a soft
// white-hot centre fading to transparent. Callers tint it with the
// sprite material's color instead of baking a colour into the texture.
let sharedGlow = null;
function sharedGlowTex() {
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

function layLamps() {
  for (const r of WORLD.roads) {
    for (let v = -160; v <= 160; v += 80) {
      plantLamp(r + 5.6, v);
      // Offset along the road too: a lamp at (v, r-5.6) with v on a road
      // would stand in the middle of the crossing north-south road.
      plantLamp(v + 5.6, r - 5.6);
    }
  }
}

function hangClouds() {
  // Thin dusk haze, not solid objects: unlit pale peach, very faint,
  // squashed flat and hung high, so a low camera looking up sees wispy
  // streaks instead of a brown lump. (The old Lambert puffs shaded brown
  // under the orange sun and read as a UFO in the mission shot.)
  const haze = new THREE.MeshBasicMaterial({ color: 0xf6ddd6, transparent: true, opacity: 0.3 });
  S.clouds = [];
  for (let i = 0; i < 9; i++) {
    const puff = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(7 + dice() * 6, 8, 6), haze);
      blob.position.set(j * 7 - 7 + dice() * 2, dice() * 1, dice() * 2);
      blob.scale.y = 0.18;
      puff.add(blob);
    }
    puff.position.set(-180 + dice() * 360, 110 + dice() * 30, -180 + dice() * 360);
    S.scene.add(puff);
    S.clouds.push(puff);
  }
}

// ------------------------------------------------------------ landmarks

function buildCafe() {
  const cx = -60, cz = -60;
  const base = addBox(24, 9, 18, flat(0xf2d8c8), cx, 4.5, cz);
  void base;
  S.colliders.push({ x: cx, z: cz, r: 15 });
  placeBlob(cx, cz, 30, 0.025);
  // Striped awning over the storefront (faces +z, toward road z=-40).
  const awnTex = paintCanvas(256, 64, (g, w, h) => {
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
  addBox(22, 0.22, 0.22, new THREE.MeshBasicMaterial({ color: 0xff5a9a }), cx, 4.4, cz + 10.6);
  // Glowing doorway.
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 5),
    new THREE.MeshBasicMaterial({ color: 0xffd27a })
  );
  door.position.set(cx, 2.5, cz + 9.15);
  S.scene.add(door);
  // Rooftop sign: ONE single-sided plane. (v2 had a DoubleSide plane plus a
  // 180-degree clone behind it, and the mirrored back text bled through.)
  const tex = neonSign([
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
    new THREE.MeshBasicMaterial({ map: moonTex(), transparent: true, side: THREE.FrontSide })
  );
  moon.position.set(cx, 17.8, cz + 9.2);
  S.scene.add(moon);
}

function buildGarage() {
  const cx = -140, cz = 140;
  addBox(22, 8, 16, flat(0x7a6a58), cx, 4, cz);
  S.colliders.push({ x: cx, z: cz, r: 14 });
  placeBlob(cx, cz, 28, 0.025);
  // Garage door faces the road at x=-120.
  const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.5), new THREE.MeshLambertMaterial({ color: 0x3c4148 }));
  door.rotation.y = Math.PI / 2;
  door.position.set(cx + 11.1, 2.75, cz);
  S.scene.add(door);
  const tex = neonSign([
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
  addBox(12, 0.3, 0.3, new THREE.MeshBasicMaterial({ color: 0xffb84a }), cx + 11.2, 7.6, cz);
}

function buildTowerLandmark() {
  const tx = 100, tz = -100;
  // The city landmark, 130 m tall — far above the 12–46 m neighbours — so
  // it reads above the tower row from the street. At 95 m the (20,-100)
  // tower hid it completely from road z=-80.
  // A glass curtain wall for the landmark: clone the facade maps so the
  // 130 m face can repeat the window grid three times up its height
  // without changing the repeat on every other glass tower.
  const skin = facadeMaps(1);
  const skinMap = skin.map.clone();
  skinMap.repeat.set(1, 3);
  skinMap.needsUpdate = true;
  const skinGlow = skin.emissiveMap.clone();
  skinGlow.repeat.set(1, 3);
  skinGlow.needsUpdate = true;
  const wallMat = new THREE.MeshStandardMaterial({
    map: skinMap, emissive: 0xffffff, emissiveMap: skinGlow,
    emissiveIntensity: 1.2, roughness: skin.roughness, metalness: skin.metalness,
  });
  const tower = addBox(26, 130, 26, wallMat, tx, 65, tz);
  tower.castShadow = true;
  tower.receiveShadow = true;
  void tower;
  S.colliders.push({ x: tx, z: tz, r: 19 });
  placeBlob(tx, tz, 36, 0.025);
  // A spire and a red aircraft beacon on the crown, so the top reads as
  // a landmark even where the sign is out of frame.
  const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.8, 16, 6), flat(0x2c2f36));
  spike.position.set(tx, 138, tz);
  S.scene.add(spike);
  const beaconLight = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  beaconLight.position.set(tx, 146.5, tz);
  S.scene.add(beaconLight);
  const signTex = neonSign([
    { text: 'SOLMAR TOWER', size: 56, color: '#9ad8ff', y: 128 },
  ], '#9ad8ff', '#4da8ff');
  const signSouth = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 9),
    new THREE.MeshBasicMaterial({ map: signTex, side: THREE.FrontSide })
  );
  signSouth.position.set(tx, 100, tz + 13.2);
  S.scene.add(signSouth);
  // A second copy on the west face: the mission staging looks east down
  // road z=-80, so it sees the tower's west face, not the south face.
  // Without it the landmark reads as just another tall dark tower.
  // It is big (28 m wide) and high (y=90) so the letters read at street
  // distance and the sign clears the nearer rooftops that used to hide
  // it — the earlier 24 m sign at y=68 sat behind a tall block and
  // never made it into the mission frame. It sits below the mission
  // banner at the top of the frame instead of hiding behind it.
  const signWestFace = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 14),
    new THREE.MeshBasicMaterial({ map: signTex, side: THREE.FrontSide })
  );
  signWestFace.rotation.y = -Math.PI / 2;
  signWestFace.position.set(tx - 13.2, 80, tz);
  S.scene.add(signWestFace);
}

function buildClinic() {
  const cx = 140, cz = -60;
  addBox(24, 14, 18, flat(0xf2f2f2), cx, 7, cz);
  S.colliders.push({ x: cx, z: cz, r: 15 });
  placeBlob(cx, cz, 30, 0.025);
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: 0xe84a4a }));
  cross.position.set(cx, 15.5, cz + 9.2);
  S.scene.add(cross);
  const tex = neonSign([
    { text: 'SOLMAR GENERAL', size: 64, color: '#7ad8ff', y: 128 },
  ], '#7ad8ff', '#4da8ff');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 8),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide })
  );
  sign.position.set(cx, 12, cz + 9.2);
  S.scene.add(sign);
}

function buildMarina() {
  const px = 0, pz = 168;
  // A plank pier running out over the sand into the water.
  const jetty = addBox(14, 0.4, 26, flat(0x8a6a42), px, 0.5, pz + 12);
  void jetty;
  for (let k = 0; k < 5; k++) {
    addBox(2.4, 2.4, 2.4, flat(0xa8803a), px - 5 + dice() * 10, 1.6, pz - 6 + dice() * 8);
  }
  const signTex = neonSign([
    { text: 'SOLMAR HARBOR', size: 52, color: '#7ad8ff', y: 128 },
  ], '#7ad8ff', '#4da8ff');
  // Narrow (12 m) so it fits the gap between the towers flanking road x=0
  // instead of being clipped by them — the v3 cover read "OLMAR HARBO".
  const harborSign = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 6),
    new THREE.MeshBasicMaterial({ map: signTex, side: THREE.FrontSide })
  );
  harborSign.position.set(px, 11, pz - 4);
  harborSign.rotation.y = Math.PI;
  S.scene.add(harborSign);
  // Boats moored past the pier: simple hulls bobbing on the water.
  for (let k = 0; k < 3; k++) {
    const boat = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 6), flat(0xe8e8e8));
    boat.rotation.z = Math.PI / 2;
    boat.rotation.y = (dice() - 0.5) * 0.4;
    boat.position.set(px - 16 + k * 16, 0.4, pz + 26 + dice() * 6);
    S.scene.add(boat);
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

function buildSignals() {
  S.trafficLights = [];
  // One signal per other 80 m intersection (checkerboard) to keep the count sane.
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      if (rx % 80 !== 0 || rz % 80 !== 0) continue;
      if (((rx + rz) / 80) % 2 !== 0) continue;
      const x = rx + 6.2, z = rz + 6.2;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), flat(0x2c2f36));
      mast.position.set(x, 2.7, z);
      S.scene.add(mast);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.55), flat(0x1c1e22));
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

function layProps() {
  const binMat = flat(0x2a5a3a);
  const hydMat = flat(0xc22a2a);
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
  const stopTex = paintCanvas(128, 128, (ctx2d, w, h) => {
    ctx2d.fillStyle = '#c22a2a';
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.fillStyle = '#ffffff';
    ctx2d.font = 'bold 34px Arial, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('STOP', w / 2, h / 2);
  });
  for (const [sx, sz] of [[-40, -46], [40, -46], [-40, 34], [40, 34], [-120, -46], [120, 34]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), flat(0x8a8a8a));
    post.position.set(sx, 1.3, sz);
    S.scene.add(post);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: stopTex }));
    board.position.set(sx, 2.9, sz);
    board.rotation.y = Math.PI / 4;
    S.scene.add(board);
  }
  // Newsstands on the plaza corners.
  const magTex = paintCanvas(128, 64, (ctx2d, w, h) => {
    const cols = ['#e84a4a', '#4a8ae8', '#e8d84a', '#4ad87a', '#d87ab8'];
    for (let i = 0; i < 5; i++) {
      ctx2d.fillStyle = cols[i];
      ctx2d.fillRect((i * w) / 5 + 3, 6, w / 5 - 6, h - 12);
    }
  });
  for (const [nx, nz] of [[13, 13], [-13, -13]]) {
    addBox(3.2, 2.6, 2.2, flat(0x3a6a8a), nx, 1.3, nz);
    addBox(3.6, 0.25, 2.6, flat(0xe84a4a), nx, 2.75, nz);
    const mags = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), new THREE.MeshBasicMaterial({ map: magTex }));
    mags.position.set(nx, 1.6, nz + 1.15);
    S.scene.add(mags);
  }
  // Cafe Luna outdoor tables: table + chairs + striped umbrella.
  for (const tx of [-70, -60, -50]) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.08, 12), flat(0xf2e8d8));
    top.position.set(tx, 0.78, -49.5);
    top.castShadow = true;
    S.scene.add(top);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.78, 6), flat(0x2c2f36));
    stem.position.set(tx, 0.39, -49.5);
    S.scene.add(stem);
    for (const s of [-1, 1]) {
      addBox(0.5, 0.5, 0.5, flat(0x7a4a3a), tx + s * 1.3, 0.25, -49.5);
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), flat(0x2c2f36));
    post.position.set(tx, 1.3, -49.5);
    S.scene.add(post);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0xe85a7a }));
    shade.position.set(tx, 2.9, -49.5);
    shade.castShadow = true;
    S.scene.add(shade);
  }
}

function laySkyline() {
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

function laySidewalkProps() {
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
  // Sidewalk benches are seats too: record them for sitting pedestrians.
  for (const [bx, bz] of benches) S.benches.push({ x: bx, z: bz });
  fill(
    new THREE.BoxGeometry(2.2, 0.5, 0.7),
    flat(0x8a6a42), benches, 0.25, true
  );
  fill(
    new THREE.CylinderGeometry(0.55, 0.65, 0.8, 8),
    flat(0x5a6a4a), planters, 0.4, true
  );
  // Shrub crowns on the planters, same spots, one more instanced mesh.
  fill(
    new THREE.SphereGeometry(0.55, 8, 6),
    flat(0x3f8a3a), planters, 1.05, true
  );
  fill(
    new THREE.CylinderGeometry(0.14, 0.16, 0.9, 8),
    flat(0x3a3d42), bollards, 0.45, false
  );
}

export function buildCity() {
  buildSky();
  layStreets();
  layTowers();
  layPark();
  buildCafe();
  buildGarage();
  buildTowerLandmark();
  buildClinic();
  buildMarina();
  layLamps();
  buildSignals();
  layProps();
  laySidewalkProps();
  laySkyline();
  hangClouds();
  // Extra palms along the beach and plaza.
  for (let i = 0; i < 8; i++) plantPalm(-160 + i * 44, 178);
  plantPalm(-14, 14);
  plantPalm(14, -14);
  plantPalm(-14, -14);
  plantPalm(14, 14);
}
