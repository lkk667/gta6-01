// Solmar City — cars: factory, arcade driving, enter/exit/steal (v3 rewrite).
// Police cruisers are black-and-white with a big light bar and flashing
// glow halos, so they read as police at distance instead of black traffic.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, addHeat, clamp, dist2 } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';

const CAR_COLORS = [0xd8b83a, 0x3a7ad8, 0xd84a4a, 0x4ad87a, 0xe8e8e8, 0x222226, 0xd87ab8, 0x7ad8d8];

function glowSprite(color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, color);
  grad.addColorStop(0.5, color.replace('1)', '0.45)'));
  grad.addColorStop(1, color.replace('1)', '0)'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(3.6, 3.6, 1);
  return sp;
}

export function makeCar(color, police) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: police ? 0xf2f2f2 : color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.3), bodyMat);
  body.position.y = 0.62;
  group.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 2.2),
    new THREE.MeshLambertMaterial({ color: police ? 0x1c1e22 : 0x223344 })
  );
  cabin.position.set(0, 1.18, -0.25);
  group.add(cabin);

  if (police) {
    // Black hood + trunk bands on a white body: classic black-and-white.
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.1, 1.0), new THREE.MeshLambertMaterial({ color: 0x14161a }));
    hood.position.set(0, 0.94, 1.62);
    group.add(hood);
    // Trunk stays white: from behind, a white body + red taillights + the
    // light bar must read as a police car, not a black traffic car.
    // Wide white door band is the body itself; add a black roof panel.
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.08, 2.0), new THREE.MeshLambertMaterial({ color: 0x14161a }));
    roof.position.set(0, 1.48, -0.25);
    group.add(roof);
    // BIG light bar: wide red/blue blocks with glow halos.
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.5), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    barBase.position.set(0, 1.56, -0.25);
    group.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    red.position.set(-0.42, 1.72, -0.25);
    group.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.42), new THREE.MeshBasicMaterial({ color: 0x2a6aff }));
    blue.position.set(0.42, 1.72, -0.25);
    group.add(blue);
    const redGlow = glowSprite('rgba(255,42,42,1)');
    redGlow.position.set(-0.42, 1.75, -0.25);
    group.add(redGlow);
    const blueGlow = glowSprite('rgba(42,106,255,1)');
    blueGlow.position.set(0.42, 1.75, -0.25);
    group.add(blueGlow);
    group.userData.redGlow = redGlow;
    group.userData.blueGlow = blueGlow;
    group.userData.redLens = red;
    group.userData.blueLens = blue;
  }

  // Wheels with pale rims so they read against dark asphalt.
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xb8bcc2 });
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 10), wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.36, wz);
    group.add(w);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.28, 8), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, 0.36, wz);
    group.add(rim);
    wheels.push(w);
  }
  // Headlights + glowing taillights.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b8 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), headMat);
    h.position.set(s * 0.62, 0.66, 2.16);
    group.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.08), new THREE.MeshBasicMaterial({ color: 0xff3a3a }));
    t.position.set(s * 0.62, 0.66, -2.16);
    group.add(t);
  }
  group.userData.wheels = wheels;
  group.userData.police = !!police;
  return group;
}

export function spawnParkedCar(x, z, heading, color) {
  const mesh = makeCar(color === undefined ? CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] : color, false);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  S.scene.add(mesh);
  attachBlob(mesh, 4.6, 0.03);
  const car = { mesh, heading, speed: 0, steer: 0, police: false, parked: true, driver: null };
  S.cars.push(car);
  return car;
}

export function nearestCar(x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const c of S.cars) {
    if (c.driver) continue;
    const d = dist2(x, z, c.mesh.position.x, c.mesh.position.z);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function enterCar(car) {
  const p = S.player;
  car.driver = 'player';
  car.parked = false;
  S.onFoot = false;
  S.currentCar = car;
  p.group.visible = false;
  p.speed = 0;
  if (car.stolen !== true) {
    car.stolen = true;
    addHeat(34); // stealing a car puts you straight on 2 stars
    if (S.audio) S.audio.sirenBurst();
  }
}

export function exitCar() {
  const car = S.currentCar;
  if (!car) return;
  const p = S.player;
  car.driver = null;
  car.speed = 0;
  S.currentCar = null;
  S.onFoot = true;
  p.group.visible = true;
  const a = car.heading + Math.PI / 2;
  p.pos.x = car.mesh.position.x + Math.sin(a) * 2.2;
  p.pos.z = car.mesh.position.z + Math.cos(a) * 2.2;
  p.group.position.set(p.pos.x, 0, p.pos.z);
  p.heading = car.heading;
}

export function updateDriving(dt) {
  const car = S.currentCar;
  if (!car) return;
  const k = S.keys;
  const fwd = (k.KeyW || k.ArrowUp) ? 1 : 0;
  const back = (k.KeyS || k.ArrowDown) ? 1 : 0;
  const left = (k.KeyA || k.ArrowLeft) ? 1 : 0;
  const right = (k.KeyD || k.ArrowRight) ? 1 : 0;
  const brake = !!k.Space;
  const accel = (fwd - back) * (brake ? 0.3 : 1);
  car.speed += accel * 16 * dt;
  if (!fwd && !back) car.speed *= Math.max(0, 1 - dt * 1.4);
  if (brake) car.speed *= Math.max(0, 1 - dt * 3.2);
  car.speed = clamp(car.speed, -10, WORLD.playerTopSpeed);
  const steerTarget = (left - right) * 0.55 * Math.min(1, Math.abs(car.speed) / 8);
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 6);
  car.heading += car.steer * dt * (car.speed >= 0 ? 1 : -1) * Math.sign(car.speed || 1);
  const nx = car.mesh.position.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.mesh.position.z + Math.cos(car.heading) * car.speed * dt;
  const pos = { x: nx, z: nz };
  resolveCollisions(pos, 1.9);
  // Slow for other cars ahead (formation-pacing cruisers never block).
  for (const other of [...S.cars, ...S.trafficCars, ...S.cruisers]) {
    if (other === car || other.mesh === car.mesh) continue;
    if (other.pace) continue; // a pacing cruiser holds formation, not a block
    const ox = other.mesh ? other.mesh.position.x : other.position.x;
    const oz = other.mesh ? other.mesh.position.z : other.position.z;
    const d = dist2(pos.x, pos.z, ox, oz);
    if (d < 4.5) {
      const push = (4.5 - d) * 0.5;
      const dx = pos.x - ox, dz = pos.z - oz;
      const l = Math.hypot(dx, dz) || 1;
      pos.x += (dx / l) * push;
      pos.z += (dz / l) * push;
      car.speed *= 0.92;
    }
  }
  // Pedestrians get shoved aside by the car (they dodge first — see traffic.js).
  for (const ped of S.peds) {
    const d = dist2(pos.x, pos.z, ped.mesh.position.x, ped.mesh.position.z);
    if (d < 2.4) {
      const dx = ped.mesh.position.x - pos.x;
      const dz = ped.mesh.position.z - pos.z;
      const l = Math.hypot(dx, dz) || 1;
      ped.mesh.position.x += (dx / l) * 1.2;
      ped.mesh.position.z += (dz / l) * 1.2;
      ped.fleeTimer = Math.max(ped.fleeTimer, 1.2);
      ped.stumble = 0.5;
      car.speed *= 0.94;
    }
  }
  car.mesh.position.x = pos.x;
  car.mesh.position.z = pos.z;
  car.mesh.rotation.y = car.heading;
  // Wheel spin.
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.4;
  // Player rides along: keep the on-foot body at the car for the camera.
  const p = S.player;
  p.pos.x = pos.x;
  p.pos.z = pos.z;
  p.heading = car.heading;
  S.speedKmh = Math.abs(car.speed) * 3.6;
  if (S.audio) S.audio.engine(Math.abs(car.speed) / WORLD.playerTopSpeed, !!car);
  if (Math.abs(car.speed) > 4) addHeat(0); // no-op guard: driving alone adds no heat
  updateChaseCamera(dt, car);
}

function updateChaseCamera(dt, car) {
  const cam = S.camera;
  const back = 9.5;
  const up = 3.6;
  const tx = car.mesh.position.x - Math.sin(car.heading) * back;
  const tz = car.mesh.position.z - Math.cos(car.heading) * back;
  const ty = up;
  // Strong follow (dt*25): effectively instant in slow headless frames, so
  // the camera never lags a whole street behind a 122 km/h car, and still
  // smooth at 60 fps on a real machine.
  const k = Math.min(1, dt * 25);
  cam.position.x += (tx - cam.position.x) * k;
  cam.position.y += (ty - cam.position.y) * k;
  cam.position.z += (tz - cam.position.z) * k;
  cam.lookAt(car.mesh.position.x, 1.4, car.mesh.position.z);
}
