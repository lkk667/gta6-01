// Solmar City — vehicles: building cars and driving them.
// A car is a small group of boxes (body, cabin, wheels, lights) with arcade
// physics: accelerate, brake, reverse, steering that bites harder at low
// speed, and a slide when the handbrake is pulled. Any car can be stolen:
// walking up to one and pressing E puts the player behind its wheel and
// raises the wanted level, which is the genre's whole point.

import * as THREE from 'three';
import { state, addWanted, setToast, clamp, angleLerp } from './state.js';
import { resolveBuildingCollision, clampToCity } from './city.js';
import { playCrash, playHorn } from './audio.js';

const CAR_COLORS = [
  0xd94f3d, 0x2e6fb0, 0xe8c84a, 0x3fae6a, 0xeeeeee,
  0x222226, 0x8a5fb0, 0xe08a3c, 0x4ab0c8, 0xb03a5a,
];

export function makeCarMesh(colorHex, isPolice) {
  const car = new THREE.Group();
  const bodyColor = isPolice ? 0xf2f2ee : colorHex;
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1c2733 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), darkMat);
  cabin.position.set(0, 1.1, -0.2);
  cabin.castShadow = true;
  car.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const wheelPositions = [
    [-0.95, 0.38, 1.45], [0.95, 0.38, 1.45],
    [-0.95, 0.38, -1.45], [0.95, 0.38, -1.45],
  ];
  const wheels = [];
  for (const [wx, wy, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, wy, wz);
    car.add(wheel);
    wheels.push(wheel);
  }

  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const side of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), lightMat);
    head.position.set(side, 0.62, 2.21);
    car.add(head);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a22 });
  for (const side of [-0.6, 0.6]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), tailMat);
    tail.position.set(side, 0.62, -2.21);
    car.add(tail);
  }

  if (isPolice) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.02, 0.2, 4.42),
      new THREE.MeshLambertMaterial({ color: 0x1c2733 }),
    );
    stripe.position.y = 0.72;
    car.add(stripe);
    const barBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.16, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x222226 }),
    );
    barBase.position.set(0, 1.45, -0.2);
    car.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.42), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(-0.28, 1.5, -0.2);
    car.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.42), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    blue.position.set(0.28, 1.5, -0.2);
    car.add(blue);
    car.userData.lightRed = red;
    car.userData.lightBlue = blue;
  }

  car.userData.wheels = wheels;
  return car;
}

// A car record: mesh + arcade state. `kind` is 'parked' | 'traffic' | 'police' | 'player'.
export function createCar(scene, x, z, heading, colorHex, kind, isPolice) {
  const mesh = makeCarMesh(colorHex, isPolice);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  scene.add(mesh);
  return {
    mesh,
    kind,
    isPolice: !!isPolice,
    x, z, heading,
    speed: 0, // units per second, forward is +heading
    steer: 0,
    health: 100,
    smokeTimer: 0,
    driver: kind === 'traffic' || kind === 'police', // has an NPC driver
    owned: kind === 'player',
    honkTimer: 0,
    spin: 0, // wheel spin accumulator
  };
}

export function randomCarColor(random) {
  return CAR_COLORS[Math.floor(random() * CAR_COLORS.length)];
}

// --- Player driving -------------------------------------------------------

export function updatePlayerDriving(car, dt, input, colliders) {
  const forward = input.forward;
  const back = input.back;
  const left = input.left;
  const right = input.right;
  const handbrake = input.handbrake;

  const maxSpeed = 34;
  const maxReverse = 12;
  const accel = 16;
  const brake = 30;

  if (forward) car.speed += accel * dt;
  if (back) {
    if (car.speed > 0.5) car.speed -= brake * dt;
    else car.speed -= accel * 0.55 * dt;
  }
  if (!forward && !back) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 8 * dt);
  }
  if (handbrake) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 22 * dt);
  }
  car.speed = clamp(car.speed, -maxReverse, maxSpeed);

  const steerTarget = (left ? 1 : 0) - (right ? 1 : 0);
  const steerSpeed = clamp(Math.abs(car.speed) / 10, 0.25, 1);
  car.steer = angleLerp(car.steer, steerTarget * 0.55, Math.min(1, dt * 8));
  const turnRate = car.steer * steerSpeed * (handbrake ? 1.5 : 1);
  car.heading += turnRate * dt * (car.speed >= 0 ? 1 : -1) * 1.9;

  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const clamped = clampToCity(nx, nz);
  const resolved = resolveBuildingCollision(colliders, clamped.x, clamped.z, 1.6);
  const hitWall = resolved.x !== clamped.x || resolved.z !== clamped.z ||
    clamped.x !== nx || clamped.z !== nz;
  if (hitWall && Math.abs(car.speed) > 6) {
    playCrash();
    car.speed *= 0.35;
    state.camera.shake = Math.min(0.6, Math.abs(car.speed) * 0.02 + 0.2);
  } else if (hitWall) {
    car.speed *= 0.6;
  }
  car.x = resolved.x;
  car.z = resolved.z;

  applyCarTransform(car, dt);
  return Math.abs(car.speed) / maxSpeed;
}

export function applyCarTransform(car, dt) {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  // Body roll and pitch sell the speed.
  car.mesh.rotation.z = -car.steer * 0.06;
  car.mesh.rotation.x = clamp(-car.speed * 0.0012, -0.03, 0.03);
  car.spin += car.speed * dt * 2.2;
  for (const wheel of car.mesh.userData.wheels) {
    wheel.rotation.x = car.spin;
  }
}

// --- Entering, exiting and stealing ---------------------------------------

export function nearestCarTo(cars, x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of cars) {
    const dx = car.x - x;
    const dz = car.z - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

export function enterCar(car) {
  const wasTraffic = car.kind === 'traffic';
  const wasParked = car.kind === 'parked';
  car.kind = 'player';
  car.driver = false;
  state.player.inCar = car;
  state.player.onFoot = false;
  state.player.x = car.x;
  state.player.z = car.z;
  state.player.heading = car.heading;
  if (wasTraffic || wasParked) {
    state.carsStolen += 1;
    addWanted(34);
    setToast(wasTraffic ? 'Car jacked! The driver called the cops.' : 'Car stolen! Somebody saw that.', 3);
    playHorn();
  } else {
    setToast('Back behind the wheel.', 2);
  }
}

export function exitCar(cars) {
  const car = state.player.inCar;
  if (!car) return;
  car.kind = 'parked';
  car.driver = false;
  car.speed = 0;
  // Step out to the driver's side.
  const sideX = car.x + Math.cos(car.heading) * 1.8;
  const sideZ = car.z - Math.sin(car.heading) * 1.8;
  state.player.x = sideX;
  state.player.z = sideZ;
  state.player.heading = car.heading;
  state.player.onFoot = true;
  state.player.inCar = null;
  state.player.speed = 0;
}

export function flashPoliceLights(car, time) {
  const red = car.mesh.userData.lightRed;
  const blue = car.mesh.userData.lightBlue;
  if (!red || !blue) return;
  const phase = Math.floor(time * 6) % 2 === 0;
  red.material.color.setHex(phase ? 0xff2222 : 0x550000);
  blue.material.color.setHex(phase ? 0x111166 : 0x2244ff);
}
