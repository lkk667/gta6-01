// Solmar City — the city itself: road grid, pastel towers, parks, car
// parks, beach and ocean, landmarks (Solmar Tower, Cafe Luna, Hideout,
// Harbor, hospital), palms, streetlights and clouds, plus collision.

import * as THREE from 'three';
import { S, WORLD, ROAD_LINES, LANDMARKS, mulberry32, clamp } from './state.js';

const rng = mulberry32(20261118);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const PASTELS = [
  0xf2b8c6, 0xf6d9a0, 0xa8d8c8, 0x9fc3e8, 0xd9b8e6,
  0xf5c9a8, 0xb8d9a0, 0xe8a8b0, 0xc8d8f0, 0xf0e0b8,
];

/** A canvas texture with a grid of windows on a pastel facade. */
function facadeTexture(base, floors, cols) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#' + base.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 128, 256);
  // subtle vertical shading strips
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, 0, 10, 256);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(118, 0, 10, 256);
  const ww = 128 / cols;
  const wh = 256 / floors;
  for (let f = 0; f < floors; f++) {
    for (let col = 0; col < cols; col++) {
      const lit = rng() < 0.3;
      g.fillStyle = lit ? '#ffd98a' : '#2c3e55';
      g.fillRect(col * ww + 4, f * wh + 6, ww - 8, wh - 12);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(col * ww + 4, f * wh + 6, ww - 8, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A canvas texture with centred text lines, transparent background. */
function signTexture(lines, w = 512, h = 256) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const line of lines) {
    g.font = line.font;
    g.fillStyle = line.color;
    if (line.glow) {
      g.shadowColor = line.glow;
      g.shadowBlur = 22;
    } else {
      g.shadowBlur = 0;
    }
    g.fillText(line.text, w / 2, line.y);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A flat sign plane with a text texture, sized in world units. */
function makeSign(lines, w, h) {
  const tex = signTexture(lines);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return mesh;
}

function addCollider(x, z, hw, hd) {
  S.colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
}

/** Push a circle (x/z position, radius) out of every building AABB. */
export function collideCircle(pos, radius) {
  for (const b of S.colliders) {
    const cx = clamp(pos.x, b.minX, b.maxX);
    const cz = clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
      } else {
        // centre inside the box: push out along the smallest overlap
        const ox = Math.min(pos.x - b.minX + radius, b.maxX - pos.x + radius);
        const oz = Math.min(pos.z - b.minZ + radius, b.maxZ - pos.z + radius);
        if (ox < oz) pos.x = pos.x - b.minX < b.maxX - pos.x ? b.minX - radius : b.maxX + radius;
        else pos.z = pos.z - b.minZ < b.maxZ - pos.z ? b.minZ - radius : b.maxZ + radius;
      }
    }
  }
}

export function isOnRoad(x, z) {
  for (const l of ROAD_LINES) {
    if (Math.abs(x - l) < WORLD.roadHalf + 1) return true;
    if (Math.abs(z - l) < WORLD.roadHalf + 1) return true;
  }
  return false;
}

/** A simple palm: tilted trunk and a crown of flat fronds. */
function makePalm(scale = 1) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 5.4, 6), trunkMat);
  trunk.position.y = 2.7;
  trunk.rotation.z = 0.08;
  g.add(trunk);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f9e5f, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.4, 4), leafMat);
    const a = (i / 6) * Math.PI * 2;
    frond.position.set(Math.cos(a) * 1.1, 5.6, Math.sin(a) * 1.1);
    frond.rotation.z = Math.cos(a) * 1.15;
    frond.rotation.x = -Math.sin(a) * 1.15;
    frond.scale.set(1, 1, 0.28);
    g.add(frond);
  }
  g.scale.setScalar(scale);
  return g;
}

function makeStreetlight() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6.4, 6), mat);
  pole.position.y = 3.2;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.1), mat);
  arm.position.set(0.9, 6.3, 0);
  g.add(arm);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.16, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0 }),
  );
  lamp.position.set(1.7, 6.25, 0);
  g.add(lamp);
  return g;
}

function makeUmbrella(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6),
    new THREE.MeshLambertMaterial({ color: 0xd8d2c0 }),
  );
  pole.position.y = 1.3;
  g.add(pole);
  const top = new THREE.Mesh(
    new THREE.ConeGeometry(1.7, 0.7, 8),
    new THREE.MeshLambertMaterial({ color }),
  );
  top.position.y = 2.7;
  g.add(top);
  return g;
}

export const clouds = [];

export function buildCity(scene) {
  // Ground: city slab, then sand, then ocean.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(460, 460),
    new THREE.MeshLambertMaterial({ color: 0x9aa08e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -20);
  scene.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(460, 34),
    new THREE.MeshLambertMaterial({ color: 0xeed9a4 }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.05, 183);
  scene.add(sand);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 420),
    new THREE.MeshLambertMaterial({ color: 0x1e7fae }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.02, 400);
  scene.add(ocean);

  // Roads: dark strips along every road line, both axes.
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  for (const l of ROAD_LINES) {
    const h = new THREE.Mesh(new THREE.PlaneGeometry(400, WORLD.roadHalf * 2), roadMat);
    h.rotation.x = -Math.PI / 2;
    h.position.set(0, 0.08, l);
    scene.add(h);
    const v = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.roadHalf * 2, 400), roadMat);
    v.rotation.x = -Math.PI / 2;
    v.position.set(l, 0.08, 0);
    scene.add(v);
    // centre dashes
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8 });
    for (let d = -180; d < 180; d += 16) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.35), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(d, 0.1, l);
      scene.add(dash);
      const dash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3), dashMat);
      dash2.rotation.x = -Math.PI / 2;
      dash2.position.set(l, 0.1, d);
      scene.add(dash2);
    }
  }

  // Blocks: one pastel tower per ordinary block.
  const special = new Set();
  const key = (x, z) => `${x},${z}`;
  for (const lm of Object.values(LANDMARKS)) special.add(key(lm.x, lm.z));
  const blockCentres = [];
  for (let bx = -180; bx <= 180; bx += 40) {
    for (let bz = -180; bz <= 180; bz += 40) {
      if (bz >= 160) continue; // beach strip
      blockCentres.push([bx, bz]);
    }
  }
  for (const [bx, bz] of blockCentres) {
    if (special.has(key(bx, bz))) continue;
    const h = 10 + rng() * 32;
    const w = 16 + rng() * 10;
    const d = 16 + rng() * 10;
    const color = pick(PASTELS);
    const floors = Math.max(3, Math.round(h / 4));
    const tex = facadeTexture(color, floors, 5);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    tower.position.set(bx, h / 2, bz);
    scene.add(tower);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6),
      new THREE.MeshLambertMaterial({ color: 0x5a5f66 }),
    );
    roof.position.set(bx, h + 0.25, bz);
    scene.add(roof);
    addCollider(bx, bz, w / 2 + 0.4, d / 2 + 0.4);
    // rooftop box on some towers
    if (rng() < 0.4) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(3, 2, 3),
        new THREE.MeshLambertMaterial({ color: 0x777d84 }),
      );
      box.position.set(bx + w / 4, h + 1.4, bz);
      scene.add(box);
    }
  }

  // Solmar Tower: the tallest building, glass blue, with a rooftop sign.
  {
    const { x, z } = LANDMARKS.solmarTower;
    const h = 68;
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(26, h, 26),
      new THREE.MeshLambertMaterial({ map: facadeTexture(0x7fb4d8, 16, 6) }),
    );
    tower.position.set(x, h / 2, z);
    scene.add(tower);
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(20, 4, 20),
      new THREE.MeshLambertMaterial({ color: 0x2e5f8a }),
    );
    crown.position.set(x, h + 2, z);
    scene.add(crown);
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.5, 12, 6),
      new THREE.MeshLambertMaterial({ color: 0x888888 }),
    );
    antenna.position.set(x, h + 10, z);
    scene.add(antenna);
    const sign = makeSign(
      [{ text: 'SOLMAR TOWER', font: 'bold 64px Arial', color: '#bfe6ff', y: 128, glow: '#66aaff' }],
      22, 11,
    );
    sign.position.set(x, h + 8, z + 13.2);
    scene.add(sign);
    addCollider(x, z, 13.6, 13.6);
  }

  // Cafe Luna: neon storefront on the south face, facing the road at z = 40.
  {
    const { x, z } = LANDMARKS.cafeLuna;
    const h = 11;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(24, h, 16),
      new THREE.MeshLambertMaterial({ map: facadeTexture(0xf2b8c6, 3, 5) }),
    );
    base.position.set(x, h / 2, z);
    scene.add(base);
    addCollider(x, z, 12.4, 8.4);
    // Awning over the front, striped pink and cream.
    const awnCanvas = document.createElement('canvas');
    awnCanvas.width = 256;
    awnCanvas.height = 64;
    const ag = awnCanvas.getContext('2d');
    for (let i = 0; i < 8; i++) {
      ag.fillStyle = i % 2 === 0 ? '#ff5e8a' : '#fff3e0';
      ag.fillRect(i * 32, 0, 32, 64);
    }
    const awnTex = new THREE.CanvasTexture(awnCanvas);
    awnTex.colorSpace = THREE.SRGBColorSpace;
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 5),
      new THREE.MeshLambertMaterial({ map: awnTex }),
    );
    awning.position.set(x, 5.2, z + 9.5);
    awning.rotation.x = 0.35;
    scene.add(awning);
    // Neon trim along the awning's front edge.
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xff4fd8 }),
    );
    trim.position.set(x, 4.35, z + 11.9);
    scene.add(trim);
    // Glowing doorway under the awning.
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    door.position.set(x, 2.5, z + 8.15);
    scene.add(door);
    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(4.2, 5.6, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x4a2c2a }),
    );
    doorFrame.position.set(x, 2.8, z + 8.05);
    scene.add(doorFrame);
    // door glass sits in front of the frame back
    door.position.z = z + 8.22;
    const glow = new THREE.PointLight(0xffb36b, 30, 26);
    glow.position.set(x, 3.4, z + 11);
    scene.add(glow);
    // Rooftop double-sided sign: CAFE LUNA / ESPRESSO · LOUNGE.
    const signLines = [
      { text: 'CAFE LUNA', font: 'bold 92px Arial', color: '#ff9ff0', y: 96, glow: '#ff4fd8' },
      { text: 'ESPRESSO · LOUNGE', font: 'bold 34px Arial', color: '#ffe9a8', y: 186, glow: '#ffcf5e' },
    ];
    const signMat = new THREE.MeshBasicMaterial({
      map: signTexture(signLines),
      transparent: true,
      side: THREE.DoubleSide,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), signMat);
    sign.position.set(x, h + 4.6, z + 0.08);
    scene.add(sign);
    const signBack = sign.clone();
    signBack.rotation.y = Math.PI;
    signBack.position.z = z - 0.08;
    scene.add(signBack);
    const postA = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 4.4, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x333333 }),
    );
    postA.position.set(x - 6, h + 2.2, z);
    scene.add(postA);
    const postB = postA.clone();
    postB.position.x = x + 6;
    scene.add(postB);
    // Crescent-moon emblem on top of the sign.
    const moon = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.5, 10, 24, Math.PI * 1.35),
      new THREE.MeshBasicMaterial({ color: 0xffe27a }),
    );
    moon.position.set(x, h + 9.6, z);
    moon.rotation.z = 0.6;
    scene.add(moon);
    const moonGlow = new THREE.PointLight(0xffd76b, 18, 20);
    moonGlow.position.set(x, h + 10, z + 2);
    scene.add(moonGlow);
  }

  // The Hideout: low garage block with its own sign and amber light bar.
  {
    const { x, z } = LANDMARKS.hideout;
    const h = 7;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(20, h, 14),
      new THREE.MeshLambertMaterial({ color: 0x6b5a4a }),
    );
    base.position.set(x, h / 2, z);
    scene.add(base);
    addCollider(x, z, 10.4, 7.4);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(6, 4.6, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x2e2a26 }),
    );
    door.position.set(x, 2.3, z - 7.1);
    scene.add(door);
    const sign = makeSign(
      [
        { text: 'THE HIDEOUT', font: 'bold 72px Arial', color: '#ffb347', y: 100, glow: '#ff8c1a' },
        { text: 'CUSTOMS & GARAGE', font: 'bold 30px Arial', color: '#ffe9c9', y: 180 },
      ],
      13, 6.5,
    );
    sign.position.set(x, h + 1.6, z - 7.4);
    sign.rotation.y = Math.PI;
    scene.add(sign);
    // Amber light bar above the door.
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.35, 0.35),
      new THREE.MeshBasicMaterial({ color: 0xffa62b }),
    );
    bar.position.set(x, 5.4, z - 7.3);
    scene.add(bar);
    const amber = new THREE.PointLight(0xffa62b, 14, 16);
    amber.position.set(x, 5.2, z - 9.5);
    scene.add(amber);
  }

  // Harbor: docks, crates, moored boats and a crane by the water.
  {
    const { x, z } = LANDMARKS.harbor;
    const dockMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
    for (let i = -1; i <= 1; i++) {
      const dock = new THREE.Mesh(new THREE.BoxGeometry(4, 0.8, 26), dockMat);
      dock.position.set(x + i * 10, 0.4, z + 12);
      scene.add(dock);
    }
    const crateMat = new THREE.MeshLambertMaterial({ color: 0xb0703a });
    const crateMat2 = new THREE.MeshLambertMaterial({ color: 0x4a7a5a });
    for (let i = 0; i < 8; i++) {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 2.4, 2.4),
        i % 2 === 0 ? crateMat : crateMat2,
      );
      crate.position.set(x - 14 + (i % 4) * 5, 1.2 + (i >= 4 ? 2.4 : 0), z - 6 + Math.floor(i / 4) * 5);
      scene.add(crate);
      addCollider(crate.position.x, crate.position.z, 1.3, 1.3);
    }
    // Two moored boats.
    for (let i = 0; i < 2; i++) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(
        new THREE.BoxGeometry(4, 1.6, 12),
        new THREE.MeshLambertMaterial({ color: i === 0 ? 0xe8e8e8 : 0x3a6ea8 }),
      );
      hull.position.y = 0.4;
      boat.add(hull);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(3, 1.6, 4),
        new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }),
      );
      cabin.position.set(0, 1.9, -1);
      boat.add(cabin);
      boat.position.set(x - 8 + i * 16, 0, z + 26);
      scene.add(boat);
    }
    // Crane.
    const craneMat = new THREE.MeshLambertMaterial({ color: 0xd8a020 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, 22, 1.6), craneMat);
    mast.position.set(x + 18, 11, z - 4);
    scene.add(mast);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(20, 1.2, 1.2), craneMat);
    jib.position.set(x + 10, 20.5, z - 4);
    scene.add(jib);
    addCollider(x + 18, z - 4, 1.2, 1.2);
    const sign = makeSign(
      [{ text: 'SOLMAR HARBOR', font: 'bold 64px Arial', color: '#bfe6ff', y: 128, glow: '#66aaff' }],
      18, 9,
    );
    sign.position.set(x, 9, z - 8);
    scene.add(sign);
  }

  // Hospital: white block with a red-cross sign.
  {
    const { x, z } = LANDMARKS.hospital;
    const h = 16;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(24, h, 18),
      new THREE.MeshLambertMaterial({ map: facadeTexture(0xf0f0ee, 4, 5) }),
    );
    base.position.set(x, h / 2, z);
    scene.add(base);
    addCollider(x, z, 12.4, 9.4);
    const crossCanvas = document.createElement('canvas');
    crossCanvas.width = 128;
    crossCanvas.height = 128;
    const cg = crossCanvas.getContext('2d');
    cg.fillStyle = '#ffffff';
    cg.fillRect(0, 0, 128, 128);
    cg.fillStyle = '#d92038';
    cg.fillRect(52, 14, 24, 100);
    cg.fillRect(14, 52, 100, 24);
    const crossTex = new THREE.CanvasTexture(crossCanvas);
    const cross = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ map: crossTex }),
    );
    cross.position.set(x, 12, z + 9.2);
    scene.add(cross);
    const sign = makeSign(
      [{ text: 'HOSPITAL', font: 'bold 56px Arial', color: '#d92038', y: 128 }],
      12, 6,
    );
    sign.position.set(x, 6.5, z + 9.2);
    scene.add(sign);
  }

  // Parks: grass, paths, benches, trees.
  for (const park of [LANDMARKS.parkA, LANDMARKS.parkB]) {
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshLambertMaterial({ color: 0x5da24a }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(park.x, 0.12, park.z);
    scene.add(grass);
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 4),
      new THREE.MeshLambertMaterial({ color: 0xd8cba8 }),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(park.x, 0.14, park.z);
    scene.add(path);
    for (let i = 0; i < 4; i++) {
      const bench = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.5, 0.8),
        new THREE.MeshLambertMaterial({ color: 0x7a5230 }),
      );
      bench.position.set(park.x - 10 + i * 6.5, 0.5, park.z - 6);
      scene.add(bench);
    }
    for (let i = 0; i < 5; i++) {
      const palm = makePalm(0.9 + rng() * 0.3);
      palm.position.set(park.x - 12 + rng() * 24, 0, park.z - 12 + rng() * 24);
      scene.add(palm);
    }
  }

  // Car parks: flat lots with painted bays.
  for (const lot of [LANDMARKS.carParkA, LANDMARKS.carParkB]) {
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshLambertMaterial({ color: 0x55595f }),
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(lot.x, 0.12, lot.z);
    scene.add(slab);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
    for (let i = -2; i <= 2; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 8), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(lot.x + i * 5, 0.15, lot.z - 6);
      scene.add(line);
    }
  }

  // Palms along the beach and the main roads.
  for (let x = -170; x <= 170; x += 34) {
    const palm = makePalm(0.9 + rng() * 0.4);
    palm.position.set(x, 0, 172);
    scene.add(palm);
  }
  for (const l of [-120, -40, 40, 120]) {
    for (let d = -160; d <= 160; d += 80) {
      const palm = makePalm(0.85 + rng() * 0.3);
      palm.position.set(l + 8, 0, d);
      scene.add(palm);
    }
  }

  // Streetlights along the roads.
  for (const l of ROAD_LINES) {
    for (let d = -160; d <= 160; d += 80) {
      const light = makeStreetlight();
      light.position.set(l + 7.5, 0, d);
      scene.add(light);
      const light2 = makeStreetlight();
      light2.position.set(d + 7.5, 0, l - 7.5);
      light2.rotation.y = Math.PI / 2;
      scene.add(light2);
    }
  }

  // Beach umbrellas.
  const umbrellaColors = [0xff5e5e, 0x3fa8ff, 0xffd23e, 0x7ae07a, 0xff8ad8];
  for (let i = 0; i < 5; i++) {
    const um = makeUmbrella(umbrellaColors[i % umbrellaColors.length]);
    um.position.set(-140 + i * 70, 0, 178 + (i % 2) * 6);
    scene.add(um);
  }

  // Clouds: soft white blobs drifting high above the city.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(5 + rng() * 4, 8, 6), cloudMat);
      puff.position.set(j * 7 - 7, rng() * 1.5, rng() * 3);
      puff.scale.y = 0.45;
      cloud.add(puff);
    }
    cloud.position.set(-180 + rng() * 360, 70 + rng() * 25, -180 + rng() * 360);
    cloud.userData.speed = 0.6 + rng() * 0.8;
    clouds.push(cloud);
    scene.add(cloud);
  }
}
