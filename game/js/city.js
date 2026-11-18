// Solmar City — the city itself.
// Builds the whole sun-soaked coastal city from boxes and cylinders: a road
// grid, pastel apartment blocks and towers with lit windows, palm-lined
// sidewalks, a beach and a flat ocean to the south, and the named places the
// missions use (Marina Plaza, Cafe Luna, the Hideout, the Harbor). Every
// building also registers an axis-aligned collision box, and this module
// exports the road helpers the traffic, police and missions drive on.

import * as THREE from 'three';
import { STREETS, WORLD, mulberry32, clamp } from './state.js';

// Named places the story and the missions point at.
export const PLACES = {
  plaza: { x: -31, z: 31, name: 'Marina Plaza' },
  cafeLuna: { x: -93, z: -93, name: 'Cafe Luna' },
  hideout: { x: -155, z: -155, name: 'The Hideout' },
  harbor: { x: 155, z: 190, name: 'Solmar Harbor' },
  tower: { x: 31, z: -93, name: 'Solmar Tower' },
  beach: { x: 62, z: 214, name: 'Palma Beach' },
  hospital: { x: -155, z: 93, name: 'St. Palma Hospital' },
  market: { x: 93, z: -155, name: 'Mercado Sol' },
};

const BUILDING_COLORS = [
  0xf2e3c6, 0xe8b4a0, 0xa8c8c0, 0xf6d9a0, 0xd9a441,
  0xcf8f7a, 0x9fc3d8, 0xe8e0d0, 0xc96f4a, 0x7fb069,
];
const ROOF_COLORS = [0x8a6f55, 0x6b7c8c, 0xa8574a, 0x5d7a6a];

// One canvas texture reused for every facade: warm walls with lit windows.
function makeWindowTexture(baseColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = baseColor;
  g.fillRect(0, 0, 128, 256);
  const lit = ['#ffe9a8', '#ffd27a', '#bfe8ff', '#fff3c4'];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 10 + col * 23;
      const y = 14 + row * 24;
      const isLit = Math.random() < 0.45;
      g.fillStyle = isLit ? lit[(row + col) % lit.length] : '#2e3a44';
      g.fillRect(x, y, 14, 16);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const facadeTextures = new Map();
function facadeMaterial(colorHex, width, height) {
  if (!facadeTextures.has(colorHex)) {
    const css = '#' + colorHex.toString(16).padStart(6, '0');
    facadeTextures.set(colorHex, makeWindowTexture(css));
  }
  // Clone the shared canvas texture and tile it so windows stay small no
  // matter how tall the building is (a clone shares the canvas image).
  const texture = facadeTextures.get(colorHex).clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(1, Math.round((width || 20) / 11)), Math.max(1, Math.round((height || 20) / 11)));
  texture.needsUpdate = true;
  return new THREE.MeshLambertMaterial({ map: texture });
}

export function buildCity(scene) {
  const random = mulberry32(20261118);
  const colliders = []; // { minX, maxX, minZ, maxZ }
  const group = new THREE.Group();
  group.name = 'SolmarCity';
  scene.add(group);

  // --- Ground: warm grass-concrete base for the whole island.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.halfSize * 2 + 260, WORLD.halfSize * 2 + 260),
    new THREE.MeshLambertMaterial({ color: 0x9db98a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, 40);
  ground.receiveShadow = true;
  group.add(ground);

  // --- Sand strip and the ocean to the south.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.halfSize * 2 + 260, 22),
    new THREE.MeshLambertMaterial({ color: 0xeed9a4 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, WORLD.beachZ + 8);
  sand.receiveShadow = true;
  group.add(sand);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.halfSize * 2 + 400, 260),
    new THREE.MeshLambertMaterial({ color: 0x2a7fa8, transparent: true, opacity: 0.96 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.0, WORLD.oceanZ + 140);
  ocean.name = 'Ocean';
  group.add(ocean);

  // --- Roads: asphalt strips along every street, with pale sidewalks.
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
  const walkMat = new THREE.MeshLambertMaterial({ color: 0xb9b3a4 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e4d2 });
  const roadWidth = 13;
  const span = WORLD.halfSize * 2 + 20;
  for (const s of STREETS) {
    for (const horizontal of [true, false]) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(span, roadWidth), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(horizontal ? 0 : s, 0.01, horizontal ? s : 0);
      if (!horizontal) road.rotation.z = Math.PI / 2;
      road.receiveShadow = true;
      group.add(road);

      const walk = new THREE.Mesh(new THREE.PlaneGeometry(span, 3), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(horizontal ? 0 : s + 8, 0.015, horizontal ? s + 8 : 0);
      if (!horizontal) walk.rotation.z = Math.PI / 2;
      group.add(walk);
      const walk2 = walk.clone();
      walk2.position.set(horizontal ? 0 : s - 8, 0.015, horizontal ? s - 8 : 0);
      group.add(walk2);

      // Dashed centre line.
      for (let t = -WORLD.halfSize; t < WORLD.halfSize; t += 12) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.5), lineMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(horizontal ? t : s, 0.02, horizontal ? s : t);
        if (!horizontal) dash.rotation.z = Math.PI / 2;
        group.add(dash);
      }
    }
  }

  // --- Buildings: one to three boxes per block, plus parks and car parks.
  const blockCenters = [];
  for (let i = 0; i < STREETS.length - 1; i++) {
    for (let j = 0; j < STREETS.length - 1; j++) {
      const cx = (STREETS[i] + STREETS[i + 1]) / 2;
      const cz = (STREETS[j] + STREETS[j + 1]) / 2;
      blockCenters.push({ cx, cz, i, j });
    }
  }
  const blockSize = STREETS[1] - STREETS[0] - 18; // ~44
  for (const block of blockCenters) {
    const roll = random();
    // The plaza block stays open, the harbour block stays open.
    const isPlaza = Math.abs(block.cx) < 40 && Math.abs(block.cz - 24) < 40;
    const isHarbor = block.cx > 120 && block.cz > 150;
    if (isPlaza || isHarbor) {
      makePark(group, block.cx, block.cz, random);
      continue;
    }
    if (roll < 0.14) {
      makePark(group, block.cx, block.cz, random);
      continue;
    }
    if (roll < 0.24) {
      makeCarPark(group, block.cx, block.cz, random);
      continue;
    }
    const towers = 1 + Math.floor(random() * 3);
    for (let t = 0; t < towers; t++) {
      const w = 12 + random() * 16;
      const d = 12 + random() * 16;
      const h = 9 + random() * random() * 42;
      const ox = (random() - 0.5) * (blockSize - w);
      const oz = (random() - 0.5) * (blockSize - d);
      const x = block.cx + ox;
      const z = block.cz + oz;
      const color = BUILDING_COLORS[Math.floor(random() * BUILDING_COLORS.length)];
      const building = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facadeMaterial(color, w, h));
      building.position.set(x, h / 2, z);
      building.castShadow = true;
      building.receiveShadow = true;
      group.add(building);
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1, 1, d + 1),
        new THREE.MeshLambertMaterial({ color: ROOF_COLORS[Math.floor(random() * ROOF_COLORS.length)] }),
      );
      roof.position.set(x, h + 0.5, z);
      group.add(roof);
      // Rooftop box (AC unit / stairwell) for silhouette variety.
      if (random() < 0.6) {
        const unit = new THREE.Mesh(
          new THREE.BoxGeometry(4, 2.5, 4),
          new THREE.MeshLambertMaterial({ color: 0x8a8f96 }),
        );
        unit.position.set(x + (random() - 0.5) * (w - 6), h + 2, z + (random() - 0.5) * (d - 6));
        unit.castShadow = true;
        group.add(unit);
      }
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    }
  }

  // --- Solmar Tower: the tall landmark at the city centre-north.
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(26, 78, 26),
    facadeMaterial(0x9fc3d8, 26, 78),
  );
  tower.position.set(PLACES.tower.x, 39, PLACES.tower.z);
  tower.castShadow = true;
  group.add(tower);
  colliders.push({
    minX: PLACES.tower.x - 13, maxX: PLACES.tower.x + 13,
    minZ: PLACES.tower.z - 13, maxZ: PLACES.tower.z + 13,
  });
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5a4e }),
  );
  beacon.position.set(PLACES.tower.x, 79.5, PLACES.tower.z);
  group.add(beacon);

  // --- Named place markers: a cafe awning, a hideout garage, a harbour pier.
  makeCafe(group, colliders);
  makeHideout(group, colliders);
  makeHarbor(group, colliders);
  makeHospital(group, colliders);

  // --- Palms along the beach and the plaza.
  for (let x = -210; x <= 210; x += 18) {
    makePalm(group, x + (random() - 0.5) * 6, WORLD.beachZ + 2 + random() * 10, random);
  }
  for (let x = -36; x <= 36; x += 18) {
    makePalm(group, x, 52, random);
    makePalm(group, x, -4, random);
  }

  // --- Street lights on every other intersection.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2f3337 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const sx of STREETS) {
    for (const sz of STREETS) {
      if ((sx + sz) % 124 !== 0) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 7, 6), poleMat);
      pole.position.set(sx + 8, 3.5, sz + 8);
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), lampMat);
      lamp.position.set(sx + 8, 7.1, sz + 8);
      group.add(lamp);
    }
  }

  // --- Drifting clouds for a sun-soaked sky.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(6 + random() * 6, 8, 6), cloudMat);
      puff.scale.y = 0.45;
      puff.position.set(k * 7 - 7, random() * 2, (random() - 0.5) * 6);
      cloud.add(puff);
    }
    cloud.position.set((random() - 0.5) * 600, 70 + random() * 30, (random() - 0.5) * 500);
    group.add(cloud);
    clouds.push(cloud);
  }

  return { group, colliders, clouds };
}

function makePark(group, cx, cz, random) {
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshLambertMaterial({ color: 0x7fae62 }),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(cx, 0.03, cz);
  lawn.receiveShadow = true;
  group.add(lawn);
  for (let i = 0; i < 4; i++) {
    makePalm(group, cx + (random() - 0.5) * 30, cz + (random() - 0.5) * 30, random);
  }
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.6, 1.2),
    new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
  );
  bench.position.set(cx + 12, 0.6, cz + 10);
  group.add(bench);
}

function makeCarPark(group, cx, cz, random) {
  const lot = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshLambertMaterial({ color: 0x6f6f68 }),
  );
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(cx, 0.02, cz);
  group.add(lot);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8d4c2 });
  for (let k = -15; k <= 15; k += 7.5) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 18), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(cx + k, 0.03, cz);
    group.add(line);
  }
}

function makePalm(group, x, z, random) {
  const palm = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.45, 7 + random() * 2, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a6b48 }),
  );
  trunk.position.y = 3.5;
  trunk.rotation.z = (random() - 0.5) * 0.16;
  trunk.castShadow = true;
  palm.add(trunk);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d });
  for (let i = 0; i < 6; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.5, 4), frondMat);
    const angle = (i / 6) * Math.PI * 2;
    frond.position.set(Math.cos(angle) * 1.6, 7.4, Math.sin(angle) * 1.6);
    frond.rotation.z = Math.cos(angle) * 1.1;
    frond.rotation.x = -Math.sin(angle) * 1.1;
    frond.castShadow = true;
    palm.add(frond);
  }
  palm.position.set(x, 0, z);
  group.add(palm);
}

function makeCafe(group, colliders) {
  const { x, z } = PLACES.cafeLuna;
  const cafe = new THREE.Mesh(
    new THREE.BoxGeometry(20, 7, 14),
    facadeMaterial(0xe8b4a0, 20, 7),
  );
  cafe.position.set(x, 3.5, z);
  cafe.castShadow = true;
  group.add(cafe);
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(22, 0.6, 6),
    new THREE.MeshLambertMaterial({ color: 0xd94f3d }),
  );
  awning.position.set(x, 4.6, z + 8);
  group.add(awning);
  colliders.push({ minX: x - 10, maxX: x + 10, minZ: z - 7, maxZ: z + 7 });
}

function makeHideout(group, colliders) {
  const { x, z } = PLACES.hideout;
  const garage = new THREE.Mesh(
    new THREE.BoxGeometry(24, 8, 16),
    new THREE.MeshLambertMaterial({ color: 0x5d6b7a }),
  );
  garage.position.set(x, 4, z);
  garage.castShadow = true;
  group.add(garage);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(14, 6, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x2f3337 }),
  );
  door.position.set(x, 3, z + 8.1);
  group.add(door);
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(10, 1.6, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xffd24a }),
  );
  sign.position.set(x, 8.8, z + 8.2);
  group.add(sign);
  colliders.push({ minX: x - 12, maxX: x + 12, minZ: z - 8, maxZ: z + 8 });
}

function makeHarbor(group, colliders) {
  const { x, z } = PLACES.harbor;
  const pier = new THREE.Mesh(
    new THREE.BoxGeometry(50, 1, 14),
    new THREE.MeshLambertMaterial({ color: 0x8a6f55 }),
  );
  pier.position.set(x, 0.5, z + 12);
  group.add(pier);
  const shed = new THREE.Mesh(
    new THREE.BoxGeometry(16, 9, 12),
    facadeMaterial(0xa8c8c0, 16, 9),
  );
  shed.position.set(x - 12, 4.5, z);
  shed.castShadow = true;
  group.add(shed);
  colliders.push({ minX: x - 20, maxX: x - 4, minZ: z - 6, maxZ: z + 6 });
  // Moored boats: simple hulls on the water.
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
  for (let i = 0; i < 3; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 10), hullMat);
    hull.position.y = 0.4;
    boat.add(hull);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 7, 6),
      new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
    );
    mast.position.y = 4;
    boat.add(mast);
    boat.position.set(x + 8 + i * 12, 0, z + 26);
    group.add(boat);
  }
}

function makeHospital(group, colliders) {
  const { x, z } = PLACES.hospital;
  const hospital = new THREE.Mesh(
    new THREE.BoxGeometry(26, 16, 18),
    facadeMaterial(0xf2f2ee, 26, 16),
  );
  hospital.position.set(x, 8, z);
  hospital.castShadow = true;
  group.add(hospital);
  const cross = new THREE.Mesh(
    new THREE.BoxGeometry(6, 2, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xd94f3d }),
  );
  cross.position.set(x, 15, z + 9.2);
  group.add(cross);
  const cross2 = new THREE.Mesh(
    new THREE.BoxGeometry(2, 6, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xd94f3d }),
  );
  cross2.position.set(x, 15, z + 9.2);
  group.add(cross2);
  colliders.push({ minX: x - 13, maxX: x + 13, minZ: z - 9, maxZ: z + 9 });
}

// --- Road helpers ---------------------------------------------------------

export function isOnRoad(x, z) {
  for (const s of STREETS) {
    if (Math.abs(x - s) < 7 || Math.abs(z - s) < 7) return true;
  }
  return false;
}

export function nearestStreetCoord(value) {
  let best = STREETS[0];
  let bestD = Math.abs(value - best);
  for (const s of STREETS) {
    const d = Math.abs(value - s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function clampToCity(x, z) {
  return {
    x: clamp(x, -WORLD.halfSize, WORLD.halfSize),
    z: clamp(z, -WORLD.halfSize, WORLD.oceanZ - 2),
  };
}

// Point-collision against every building box. Returns true when blocked.
export function hitsBuilding(colliders, x, z, radius) {
  for (const c of colliders) {
    if (x + radius > c.minX && x - radius < c.maxX && z + radius > c.minZ && z - radius < c.maxZ) {
      return true;
    }
  }
  return false;
}

// Push a circle out of any building it overlaps; returns the corrected point.
export function resolveBuildingCollision(colliders, x, z, radius) {
  let px = x;
  let pz = z;
  for (const c of colliders) {
    const cx = clamp(px, c.minX, c.maxX);
    const cz = clamp(pz, c.minZ, c.maxZ);
    const dx = px - cx;
    const dz = pz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        px = cx + (dx / d) * radius;
        pz = cz + (dz / d) * radius;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pushLeft = px - (c.minX - radius);
        const pushRight = c.maxX + radius - px;
        const pushUp = pz - (c.minZ - radius);
        const pushDown = c.maxZ + radius - pz;
        const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
        if (min === pushLeft) px = c.minX - radius;
        else if (min === pushRight) px = c.maxX + radius;
        else if (min === pushUp) pz = c.minZ - radius;
        else pz = c.maxZ + radius;
      }
    }
  }
  return { x: px, z: pz };
}
