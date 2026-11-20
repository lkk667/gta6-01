// Solmar City — cars: factory, arcade driving, enter / exit / steal.
// The bodywork is shaped to read as a car, not a box: the hood slopes
// down toward the nose and the trunk slopes down toward the tail, side
// mirrors stand out from the front doors, thin door seams break the
// flanks, and the side glass sits inside a dark frame instead of floating
// on the cabin. Clearcoat paint catches the dusk sun, the glass is dark,
// the alloy wheels spin as one piece, and police cruisers read as police
// from across the street. Driving, collision and steal behaviour are
// unchanged — only the bodywork is new.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, addHeat, clamp, dist2 } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';
import { glowTexture, wheelTexture, plateTexture } from './textures.js';

const PAINTS = [0xd8b83a, 0x3a7ad8, 0xd84a4a, 0x4ad87a, 0xe8e8e8, 0x222226, 0xd87ab8, 0x7ad8d8];

// ------------------------------------------------------------ shared bits

// One material per paint colour, shared by every car, so forty cars on the
// road cost almost nothing extra. The paint is a clearcoat physical
// material: the dusk sky reflects in it now that the scene has an
// environment map.
const paintCache = new Map();
function paintFor(hex) {
  let m = paintCache.get(hex);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({
      color: hex, metalness: 0.55, roughness: 0.24,
      clearcoat: 0.85, clearcoatRoughness: 0.16,
    });
    paintCache.set(hex, m);
  }
  return m;
}

const MATS = {
  glass: new THREE.MeshStandardMaterial({ color: 0x111722, metalness: 0.9, roughness: 0.08 }),
  glassEdge: new THREE.MeshBasicMaterial({ color: 0x3a5a78 }),
  windowFrame: new THREE.MeshBasicMaterial({ color: 0x0e1218 }),
  darkTrim: new THREE.MeshStandardMaterial({ color: 0x22252b, metalness: 0.3, roughness: 0.65 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd9e0e8, metalness: 0.9, roughness: 0.18 }),
  headlamp: new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xffe4a8, emissiveIntensity: 2.2 }),
  tailLamp: new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1e1e, emissiveIntensity: 2.0 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.85 }),
  beam: new THREE.MeshBasicMaterial({
    color: 0xffe6b3, transparent: true, opacity: 0.13,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }),
};

let hubMaterial = null;
function hubFor() {
  if (!hubMaterial) {
    hubMaterial = new THREE.MeshStandardMaterial({ map: wheelTexture(), metalness: 0.6, roughness: 0.35 });
  }
  return hubMaterial;
}

function plateNumber() {
  return 'SLM-' + (100 + Math.floor(Math.random() * 900));
}

// A glow sprite from the shared radial texture, tinted by its material.
function makeGlow(color, size) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, depthWrite: false,
  }));
  sp.scale.set(size, size, 1);
  return sp;
}

// A warm pool of light on the asphalt under a police light bar. One cached
// canvas per colour, drawn on a ground-hugging plane.
const poolCache = new Map();
function lightPool(rgba) {
  let tex = poolCache.get(rgba);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, rgba);
    grad.addColorStop(0.5, rgba.replace('1)', '0.4)'));
    grad.addColorStop(1, rgba.replace('1)', '0)'));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
    poolCache.set(rgba, tex);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 4.6),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  m.renderOrder = 1;
  return m;
}

let taxiTexture = null;
function taxiSignTexture() {
  if (taxiTexture) return taxiTexture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#1c1e22';
  g.font = 'bold 30px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI', 64, 25);
  taxiTexture = new THREE.CanvasTexture(c);
  return taxiTexture;
}

// ------------------------------------------------------------ factory

export function makeCar(color, police, kind) {
  const group = new THREE.Group();
  const model = police ? 'police' : (kind || 'sedan');
  // No paint colour given means "pick a random one" (traffic cars).
  const paintHex = color === undefined
    ? PAINTS[Math.floor(Math.random() * PAINTS.length)]
    : color;
  const truck = model === 'truck';
  const taxi = model === 'taxi';
  // Proportions per model: a sedan is 4.3 m, a truck 5.4 m with a tall cab
  // and a cargo box, a police car a two-tone sedan, a taxi a sedan with a
  // roof sign.
  const len = truck ? 5.4 : 4.3;
  const paint = paintFor(police ? 0xf2f2f2 : taxi ? 0xe8c832 : paintHex);

  // Small local builders: a box placed in the group, and a flat pane.
  const addBox = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  const addPane = (w, h, mat, x, y, z, ry) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.position.set(x, y, z);
    if (ry) p.rotation.y = ry;
    group.add(p);
    return p;
  };

  // Lower body and cabin. The police cabin is WHITE with dark glass: from
  // behind, a white cabin plus a black roof plus a light bar reads as a
  // police car, while a black cabin made the whole cruiser read as a black
  // traffic car.
  const body = addBox(truck ? 2.0 : 1.9, truck ? 0.7 : 0.62, len, paint, 0, truck ? 0.68 : 0.62, 0);
  body.castShadow = true;
  let cabinZ;
  if (truck) {
    cabinZ = 1.55;
    const cab = addBox(1.9, 0.85, 1.5, paintFor(0x2a4a6a), 0, 1.5, cabinZ);
    cab.castShadow = true;
    const cargo = addBox(1.95, 1.25, 2.7, paintFor(0xb8bcc2), 0, 1.55, -1.1);
    cargo.castShadow = true;
    // Cargo ribs down the box.
    for (const rz of [-2.1, -1.1, -0.1]) {
      addBox(1.97, 1.27, 0.08, paintFor(0x8a8e94), 0, 1.55, rz);
    }
  } else {
    cabinZ = -0.25;
    const cabMat = police
      ? paintFor(0xf2f2f2)
      : new THREE.MeshPhysicalMaterial({ color: 0x223344, metalness: 0.4, roughness: 0.3, clearcoat: 0.6 });
    const cab = addBox(1.7, 0.55, 2.2, cabMat, 0, 1.18, cabinZ);
    cab.castShadow = true;
  }

  // Sloped hood and trunk (sedans only): the nose and the tail fall away
  // from the cabin instead of running flat, so the silhouette is a car,
  // not a brick. A positive x-rotation drops the +z (front) end; a
  // negative one drops the -z (rear) end.
  if (!truck) {
    const hood = addBox(1.7, 0.08, 1.1, paint, 0, 0.96, 1.55);
    hood.rotation.x = 0.2;
    const trunk = addBox(1.7, 0.08, 0.9, paint, 0, 0.96, -1.65);
    trunk.rotation.x = -0.18;
    // Side mirrors on short stalks at the front doors.
    for (const s of [-1, 1]) {
      addBox(0.14, 0.04, 0.04, MATS.darkTrim, s * 0.98, 1.08, 0.85);
      addBox(0.06, 0.14, 0.2, MATS.darkTrim, s * 1.04, 1.1, 0.85);
    }
    // Door seams: thin dark verticals where the front and rear doors meet
    // the body, so the flank reads as doors instead of one slab.
    for (const s of [-1, 1]) {
      addBox(0.02, 0.42, 0.03, MATS.darkTrim, s * 0.96, 0.72, 0.55);
      addBox(0.02, 0.42, 0.03, MATS.darkTrim, s * 0.96, 0.72, -0.75);
    }
  }

  // Glasswork: a sloped windshield, side glass set inside a dark frame,
  // and a rear window, so the cabin stops reading as a solid box. Panes
  // sit a hair proud of the cabin to avoid z-fighting.
  const winZ = cabinZ + (truck ? 0.78 : 1.12);
  const winW = truck ? 1.7 : 1.5;
  const winY = truck ? 1.55 : 1.22;
  const shield = addPane(winW, truck ? 0.6 : 0.5, MATS.glass, 0, winY, winZ);
  shield.rotation.x = -0.28;
  const shieldEdge = addPane(winW, 0.05, MATS.glassEdge, 0, truck ? 1.88 : 1.46, winZ + 0.08);
  shieldEdge.rotation.x = -0.28;
  for (const s of [-1, 1]) {
    // Dark frame first, slightly larger; the glass sits inside it.
    addPane(truck ? 1.26 : 1.98, 0.52, MATS.windowFrame, s * (truck ? 0.96 : 0.855), truck ? 1.55 : 1.2, cabinZ, s * Math.PI / 2);
    addPane(truck ? 1.2 : 1.9, 0.42, MATS.glass, s * (truck ? 0.96 : 0.86), truck ? 1.55 : 1.2, cabinZ, s * Math.PI / 2);
  }
  addPane(winW, 0.45, MATS.glass, 0, truck ? 1.55 : 1.2, cabinZ - (truck ? 0.78 : 1.12), Math.PI);

  if (police) {
    // Black hood and roof on the white body, black door stripes, and a wide
    // light bar with glow halos and red/blue pools on the road.
    addBox(1.92, 0.1, 1.0, paintFor(0x14161a), 0, 0.94, 1.62);
    addBox(1.72, 0.08, 2.0, paintFor(0x14161a), 0, 1.48, -0.25);
    for (const s of [-1, 1]) {
      addBox(0.04, 0.3, 2.1, paintFor(0x14161a), s * 0.96, 0.72, -0.2);
    }
    addBox(1.7, 0.16, 0.5, paintFor(0x222222), 0, 1.56, -0.25);
    const redLens = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.24, 0.46),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a })
    );
    redLens.position.set(-0.44, 1.74, -0.25);
    group.add(redLens);
    const blueLens = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.24, 0.46),
      new THREE.MeshBasicMaterial({ color: 0x2a6aff })
    );
    blueLens.position.set(0.44, 1.74, -0.25);
    group.add(blueLens);
    const redHalo = makeGlow(0xff2a2a, 3.6);
    redHalo.position.set(-0.44, 1.78, -0.25);
    group.add(redHalo);
    const blueHalo = makeGlow(0x2a6aff, 3.6);
    blueHalo.position.set(0.44, 1.78, -0.25);
    group.add(blueHalo);
    const redPool = lightPool('rgba(255,42,42,1)');
    redPool.position.set(-0.44, 0.04, -0.25);
    group.add(redPool);
    const bluePool = lightPool('rgba(42,106,255,1)');
    bluePool.position.set(0.44, 0.04, -0.25);
    group.add(bluePool);
    group.userData.redGlow = redHalo;
    group.userData.blueGlow = blueHalo;
    group.userData.redLens = redLens;
    group.userData.blueLens = blueLens;
    group.userData.redGround = redPool;
    group.userData.blueGround = bluePool;
  }

  if (taxi) {
    // Checker band along the doors and a lit TAXI roof sign.
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        addBox(0.03, 0.22, 0.3,
          paintFor(i % 2 ? 0x1c1e22 : 0xf2f2f2),
          s * 0.96, 0.78, -1.2 + i * 0.48);
      }
    }
    const roofSign = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.3, 0.4),
      new THREE.MeshBasicMaterial({ map: taxiSignTexture() })
    );
    roofSign.position.set(0, 1.62, -0.25);
    group.add(roofSign);
  }

  // Wheels: one mesh per corner — tyre side, alloy hub faces — inside a
  // group that spins as a whole, so the hub turns with the tyre.
  const radius = truck ? 0.44 : 0.36;
  const tyreGeo = new THREE.CylinderGeometry(radius, radius, 0.26, 14);
  const wheelGroups = [];
  const frontAxle = len / 2 - 0.8;
  const rearAxle = -(len / 2 - 0.8);
  for (const [sx, sz] of [[-0.95, frontAxle], [0.95, frontAxle], [-0.95, rearAxle], [0.95, rearAxle]]) {
    const hub = new THREE.Group();
    const tire = new THREE.Mesh(tyreGeo, [MATS.tyre, hubFor(), hubFor()]);
    hub.add(tire);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(sx, radius, sz);
    group.add(hub);
    wheelGroups.push(hub);
  }

  // Bumpers and licence plates, front and rear.
  for (const end of [1, -1]) {
    const bz = end * (len / 2 + 0.02);
    addBox(1.95, 0.18, 0.22, MATS.darkTrim, 0, 0.42, bz);
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.19),
      new THREE.MeshBasicMaterial({ map: plateTexture(plateNumber()) })
    );
    tag.position.set(0, 0.52, end * (len / 2 + 0.15));
    if (end < 0) tag.rotation.y = Math.PI;
    group.add(tag);
  }

  // Headlights with glow halos and a soft beam cone, plus glowing
  // taillights with their own halo. The cone is narrow at the lamp and
  // widens ahead of the car, so it reads as a beam at dusk.
  const coneGeo = new THREE.ConeGeometry(1.1, 6.5, 10, 1, true);
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), MATS.headlamp);
    head.position.set(side * 0.62, 0.66, len / 2 + 0.01);
    group.add(head);
    const glow = makeGlow(0xfff2b8, 1.5);
    glow.position.set(side * 0.62, 0.66, len / 2 + 0.25);
    group.add(glow);
    const ray = new THREE.Mesh(coneGeo, MATS.beam);
    ray.rotation.x = -Math.PI / 2;
    ray.position.set(side * 0.62, 0.52, len / 2 + 3.2);
    group.add(ray);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.08), MATS.tailLamp);
    rear.position.set(side * 0.62, 0.66, -len / 2 - 0.01);
    group.add(rear);
    const rearGlow = makeGlow(0xff3a3a, 1.1);
    rearGlow.position.set(side * 0.62, 0.66, -len / 2 - 0.25);
    group.add(rearGlow);
  }
  group.userData.wheels = wheelGroups;
  group.userData.police = !!police;
  group.userData.kind = model;
  return group;
}

// ------------------------------------------------------------ driving

export function spawnParkedCar(x, z, heading, color, kind) {
  const mesh = makeCar(
    color === undefined ? PAINTS[Math.floor(Math.random() * PAINTS.length)] : color,
    false, kind
  );
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  S.scene.add(mesh);
  attachBlob(mesh, 4.6, 0.03);
  const parkedCar = { mesh, heading, speed: 0, steer: 0, police: false, parked: true, driver: null, kind: mesh.userData.kind };
  S.cars.push(parkedCar);
  return parkedCar;
}

export function nearestCar(x, z, maxDist) {
  let closest = null;
  let bestD = maxDist;
  for (const candidate of S.cars) {
    if (candidate.driver) continue;
    const d = dist2(x, z, candidate.mesh.position.x, candidate.mesh.position.z);
    if (d < bestD) {
      bestD = d;
      closest = candidate;
    }
  }
  return closest;
}

export function enterCar(car) {
  const player = S.player;
  car.driver = 'player';
  car.parked = false;
  S.onFoot = false;
  S.currentCar = car;
  player.group.visible = false;
  player.speed = 0;
  if (car.stolen !== true) {
    car.stolen = true;
    addHeat(34); // stealing a car puts you straight on 2 stars
    if (S.audio) S.audio.sirenBurst();
  }
}

export function exitCar() {
  const car = S.currentCar;
  if (!car) return;
  const player = S.player;
  car.driver = null;
  car.speed = 0;
  S.currentCar = null;
  S.onFoot = true;
  player.group.visible = true;
  const side = car.heading + Math.PI / 2;
  player.pos.x = car.mesh.position.x + Math.sin(side) * 2.2;
  player.pos.z = car.mesh.position.z + Math.cos(side) * 2.2;
  player.group.position.set(player.pos.x, 0, player.pos.z);
  player.heading = car.heading;
}

export function updateDriving(dt) {
  const driven = S.currentCar;
  if (!driven) return;
  const keys = S.keys;
  const forward = (keys.KeyW || keys.ArrowUp) ? 1 : 0;
  const reverse = (keys.KeyS || keys.ArrowDown) ? 1 : 0;
  const turnL = (keys.KeyA || keys.ArrowLeft) ? 1 : 0;
  const turnR = (keys.KeyD || keys.ArrowRight) ? 1 : 0;
  const handbrake = !!keys.Space;
  const throttle = (forward - reverse) * (handbrake ? 0.3 : 1);
  driven.speed += throttle * 16 * dt;
  if (!forward && !reverse) driven.speed *= Math.max(0, 1 - dt * 1.4);
  if (handbrake) driven.speed *= Math.max(0, 1 - dt * 3.2);
  driven.speed = clamp(driven.speed, -10, WORLD.playerTopSpeed);
  const steerGoal = (turnL - turnR) * 0.55 * Math.min(1, Math.abs(driven.speed) / 8);
  driven.steer += (steerGoal - driven.steer) * Math.min(1, dt * 6);
  driven.heading += driven.steer * dt * (driven.speed >= 0 ? 1 : -1) * Math.sign(driven.speed || 1);
  const nextX = driven.mesh.position.x + Math.sin(driven.heading) * driven.speed * dt;
  const nextZ = driven.mesh.position.z + Math.cos(driven.heading) * driven.speed * dt;
  const at = { x: nextX, z: nextZ };
  resolveCollisions(at, 1.9);
  // Ease off for other cars ahead (formation-pacing cruisers never block).
  for (const other of [...S.cars, ...S.trafficCars, ...S.cruisers]) {
    if (other === driven || other.mesh === driven.mesh) continue;
    if (other.pace) continue; // a pacing cruiser holds formation, not a block
    const ox = other.mesh ? other.mesh.position.x : other.position.x;
    const oz = other.mesh ? other.mesh.position.z : other.position.z;
    const gap = dist2(at.x, at.z, ox, oz);
    if (gap < 4.5) {
      const shove = (4.5 - gap) * 0.5;
      const dx = at.x - ox;
      const dz = at.z - oz;
      const len = Math.hypot(dx, dz) || 1;
      at.x += (dx / len) * shove;
      at.z += (dz / len) * shove;
      driven.speed *= 0.92;
    }
  }
  // Pedestrians get shoved aside by the car (they dodge first — see traffic.js).
  for (const ped of S.peds) {
    const gap = dist2(at.x, at.z, ped.mesh.position.x, ped.mesh.position.z);
    if (gap < 2.4) {
      const dx = ped.mesh.position.x - at.x;
      const dz = ped.mesh.position.z - at.z;
      const len = Math.hypot(dx, dz) || 1;
      ped.mesh.position.x += (dx / len) * 1.2;
      ped.mesh.position.z += (dz / len) * 1.2;
      ped.fleeTimer = Math.max(ped.fleeTimer, 1.2);
      ped.stumble = 0.5;
      driven.speed *= 0.94;
    }
  }
  driven.mesh.position.x = at.x;
  driven.mesh.position.z = at.z;
  driven.mesh.rotation.y = driven.heading;
  // Wheel spin — the whole wheel group turns, hub included.
  for (const wheel of driven.mesh.userData.wheels) wheel.rotation.x += driven.speed * dt * 2.4;
  // Player rides along: keep the on-foot body at the car for the camera.
  const player = S.player;
  player.pos.x = at.x;
  player.pos.z = at.z;
  player.heading = driven.heading;
  S.speedKmh = Math.abs(driven.speed) * 3.6;
  if (S.audio) S.audio.engine(Math.abs(driven.speed) / WORLD.playerTopSpeed, !!driven);
  if (Math.abs(driven.speed) > 4) addHeat(0); // no-op guard: driving alone adds no heat
  updateChaseCamera(dt, driven);
}

function updateChaseCamera(dt, car) {
  const camera = S.camera;
  // Low chase view, eight metres behind the car and just above roof
  // height: the road rushes past and the dusk light reads in the frame.
  // The camera aims a little above the car's centre (y 2.4, not 1.4) so
  // tall things ahead — the SOLMAR HARBOR sign at the end of the road —
  // sit inside the frame instead of being cut off at the top edge.
  const back = 9.5; // follow distance: far enough that the car reads as a
  // car in a street, not a wall filling the lower frame
  const rideH = 2.6;
  const goalX = car.mesh.position.x - Math.sin(car.heading) * back;
  const goalZ = car.mesh.position.z - Math.cos(car.heading) * back;
  const goalY = rideH;
  // Hard follow (dt*25): effectively instant in slow headless frames, so
  // the camera never lags a whole street behind a 122 km/h car, and it
  // stays smooth at 60 fps on a real machine.
  const follow = Math.min(1, dt * 25);
  camera.position.x += (goalX - camera.position.x) * follow;
  camera.position.y += (goalY - camera.position.y) * follow;
  camera.position.z += (goalZ - camera.position.z) * follow;
  camera.lookAt(car.mesh.position.x, 2.4, car.mesh.position.z);
  // Speed feel: the field of view opens a little as the car accelerates,
  // 55 at rest to 67 at top speed. Eased, so it never jumps.
  const speedRatio = Math.min(1, Math.abs(car.speed) / WORLD.playerTopSpeed);
  const targetFov = 55 + speedRatio * 12;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6);
  camera.updateProjectionMatrix();
}
