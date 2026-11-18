// Solmar City — cars: the factory that builds them, arcade driving,
// and getting in and out (including stealing one, which the police notice).

import * as THREE from 'three';
import { S, WORLD, clamp, addHeat, toast } from './state.js';
import { collideCircle } from './city.js';
import { input, keyPressed } from './input.js';
import { player } from './player.js';

export const CAR_COLORS = [
  0xe8c832, 0xd83a2e, 0x2e7ad8, 0x2ed8a0, 0xe8e8e8,
  0x222226, 0xd86a2e, 0x8a4fd8, 0x7a8a9a, 0x3aa84f,
];

/** Build a car mesh. `police` adds the black-and-white paint and light bar. */
export function makeCar(color, police = false) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: police ? 0x1c1e22 : color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
  body.position.y = 0.62;
  g.add(body);

  if (police) {
    const doors = new THREE.Mesh(
      new THREE.BoxGeometry(2.04, 0.4, 1.9),
      new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }),
    );
    doors.position.set(0, 0.66, 0.1);
    g.add(doors);
  }

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 2.2),
    new THREE.MeshLambertMaterial({ color: 0x1a2530 }),
  );
  cabin.position.set(0, 1.2, -0.2);
  g.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, 0.36, wz);
    g.add(wheel);
    wheels.push(wheel);
  }

  // Headlights and taillights.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  for (const hx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), headMat);
    head.position.set(hx, 0.66, 2.22);
    g.add(head);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xd81e1e });
  for (const hx of [-0.6, 0.6]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), tailMat);
    tail.position.set(hx, 0.66, -2.22);
    g.add(tail);
  }

  let lightBar = null;
  let lightL = null;
  let lightR = null;
  if (police) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.16, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    bar.position.set(0, 1.56, -0.2);
    g.add(bar);
    lightL = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.2, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }),
    );
    lightL.position.set(-0.28, 1.58, -0.2);
    g.add(lightL);
    lightR = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.2, 0.42),
      new THREE.MeshBasicMaterial({ color: 0x2244ff }),
    );
    lightR.position.set(0.28, 1.58, -0.2);
    g.add(lightR);
    lightBar = bar;
  }

  return {
    group: g,
    wheels,
    lightBar,
    lightL,
    lightR,
    heading: 0,
    speed: 0,
    steer: 0,
    police,
    owned: false, // the player's own car (not stolen)
    stolen: false,
    driver: null, // 'player' | 'traffic' | 'police' | null (parked)
    brakeLight: false,
  };
}

/** Drop a car into the scene at a road position. */
export function placeCar(scene, car, x, z, heading) {
  car.heading = heading;
  car.group.position.set(x, 0, z);
  car.group.rotation.y = heading;
  scene.add(car.group);
  return car;
}

function forwardOf(car) {
  return { x: Math.sin(car.heading), z: Math.cos(car.heading) };
}

/** Arcade driving: throttle, brake/reverse, steering that bites with speed. */
export function updateDriving(car, dt) {
  const fwd = input.keys.has('KeyW') || input.keys.has('ArrowUp') || S.debug.autoDrive;
  const back = input.keys.has('KeyS') || input.keys.has('ArrowDown');
  const left = input.keys.has('KeyA') || input.keys.has('ArrowLeft');
  const right = input.keys.has('KeyD') || input.keys.has('ArrowRight');
  const handbrake = input.keys.has('Space');

  if (fwd) car.speed += 15 * dt;
  if (back) car.speed -= car.speed > 0.5 ? 22 * dt : 10 * dt;
  if (!fwd && !back) car.speed -= Math.sign(car.speed) * 6 * dt;
  if (handbrake) car.speed -= Math.sign(car.speed) * 26 * dt;
  if (Math.abs(car.speed) < 0.15 && !fwd && !back) car.speed = 0;
  car.speed = clamp(car.speed, -10, WORLD.topSpeed);

  const steerTarget = (left ? 1 : 0) - (right ? 1 : 0);
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 8);
  const grip = clamp(Math.abs(car.speed) / 10, 0, 1);
  car.heading += car.steer * 1.9 * grip * Math.sign(car.speed) * dt;

  const f = forwardOf(car);
  const nx = car.group.position.x + f.x * car.speed * dt;
  const nz = car.group.position.z + f.z * car.speed * dt;
  car.group.position.x = clamp(nx, -WORLD.half, WORLD.half);
  car.group.position.z = clamp(nz, -WORLD.half, WORLD.half + 8);

  // Buildings stop the car, with a thump.
  const before = { x: car.group.position.x, z: car.group.position.z };
  collideCircle(car.group.position, 2.0);
  const hitWall =
    Math.abs(car.group.position.x - before.x) > 0.001 ||
    Math.abs(car.group.position.z - before.z) > 0.001;
  if (hitWall && Math.abs(car.speed) > 6) {
    S.hooks.onCrash?.(Math.abs(car.speed));
    car.speed *= 0.35;
  } else if (hitWall) {
    car.speed *= 0.6;
  }

  car.group.rotation.y = car.heading;
  const spin = car.speed * dt * 2.8;
  for (const w of car.wheels) w.rotation.x += spin;
  S.speedKmh = Math.abs(car.speed) * 3.6;
}

/** The nearest car the player could get into, within 3.5 units. */
export function nearestCar(cars) {
  let best = null;
  let bestD = 3.5;
  for (const car of cars) {
    const d = Math.hypot(
      car.group.position.x - player.pos.x,
      car.group.position.z - player.pos.z,
    );
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

export function enterCar(car) {
  if (!car) return false;
  S.car = car;
  car.driver = 'player';
  player.group.visible = false;
  S.onFoot = false;
  if (!car.owned && !car.stolen) {
    car.stolen = true;
    S.stolenCar = true;
    // Stealing a car puts the player straight on 2 stars.
    if (S.wantedHeat < 20) addHeat(20 - S.wantedHeat);
    toast('Car stolen — the police are on their way', 4);
    S.hooks.onSteal?.();
  }
  S.hooks.onEnterCar?.(car);
  return true;
}

export function exitCar() {
  const car = S.car;
  if (!car) return false;
  car.driver = null;
  car.speed = 0;
  S.car = null;
  S.onFoot = true;
  const f = forwardOf(car);
  player.pos.set(
    car.group.position.x - f.x * 2.6,
    0,
    car.group.position.z - f.z * 2.6,
  );
  player.heading = car.heading;
  player.group.position.copy(player.pos);
  player.group.visible = true;
  S.speedKmh = 0;
  S.hooks.onExitCar?.(car);
  return true;
}

/** E to get in or out; handled here so staging can call it directly. */
export function updateCarEntry(cars) {
  if (!keyPressed('KeyE')) return;
  if (S.car) {
    exitCar();
  } else {
    const car = nearestCar(cars);
    if (car) enterCar(car);
  }
}
