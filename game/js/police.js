// Solmar City — the police: wanted heat becomes stars, cruisers spawn
// and chase the player, ramming their car, and on foot a cruiser that
// corners the player makes the bust. Heat cools off when the player
// lies low.

import * as THREE from 'three';
import { S, WORLD, ROAD_LINES, clamp, addShake } from './state.js';
import { makeCar, placeCar } from './vehicles.js';
import { player } from './player.js';

let sceneRef = null;
let spawnTimer = 0;

/** How many cruisers the current star level calls for. */
export function wantedCruiserCount() {
  return Math.min(S.stars, 5);
}

export function buildPolice(scene) {
  sceneRef = scene;
  S.cruisers = [];
}

function spawnCruiser() {
  const car = makeCar(0x111111, true);
  car.driver = 'police';
  // Appear on a road a little way from the player.
  const px = S.car ? S.car.group.position.x : player.pos.x;
  const pz = S.car ? S.car.group.position.z : player.pos.z;
  const line = ROAD_LINES[Math.floor(Math.random() * ROAD_LINES.length)];
  const along = clamp((Math.random() < 0.5 ? px : pz) + (Math.random() < 0.5 ? -50 : 50), -170, 170);
  const horizontal = Math.random() < 0.5;
  if (horizontal) {
    placeCar(sceneRef, car, along, line, Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
  } else {
    placeCar(sceneRef, car, line, along, Math.random() < 0.5 ? 0 : Math.PI);
  }
  car.speed = 0;
  car.flashPhase = Math.random() * 10;
  S.cruisers.push(car);
  return car;
}

export function ensureCruisers(instant = false) {
  const want = wantedCruiserCount();
  while (S.cruisers.length < want) {
    spawnCruiser();
    if (!instant) break;
  }
}

function removeCruiser(car) {
  sceneRef.remove(car.group);
  const i = S.cruisers.indexOf(car);
  if (i >= 0) S.cruisers.splice(i, 1);
}

function chaseCruiser(car, dt) {
  const target = S.car ? S.car.group.position : player.pos;
  const p = car.group.position;
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const dist = Math.hypot(dx, dz) || 1;

  // Steer toward the player, faster with more stars.
  const wantHeading = Math.atan2(dx, dz);
  let diff = wantHeading - car.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.heading += clamp(diff, -2.6 * dt, 2.6 * dt);

  const top = 26 + S.stars * 1.5;
  const accel = dist > 30 ? 16 : 10;
  if (!S.car && dist < 5.5) {
    // On foot, the cruiser pulls up alongside the player and stops —
    // that is what makes the bust.
    car.speed = Math.max(0, car.speed - 34 * dt);
  } else {
    car.speed = Math.min(top, car.speed + accel * dt);
    // Ease off when right on top of the player so the ram reads.
    if (dist < 6) car.speed = Math.min(car.speed, 12);
  }

  const f = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  p.x += f.x * car.speed * dt;
  p.z += f.z * car.speed * dt;
  p.x = clamp(p.x, -WORLD.half, WORLD.half);
  p.z = clamp(p.z, -WORLD.half, WORLD.half);
  car.group.rotation.y = car.heading;

  // Ram the player's car: shove it and slow the cruiser.
  if (S.car && dist < 4.4) {
    const push = 9 * dt;
    S.car.group.position.x += f.x * push;
    S.car.group.position.z += f.z * push;
    S.car.speed *= 1 - 0.5 * dt;
    car.speed *= 0.6;
    if (Math.abs(S.car.speed) > 8) {
      addShake(0.12, 0.2);
      S.hooks.onCrash?.(Math.abs(S.car.speed));
    }
  }

  // Flashing light bar: red and blue take turns.
  car.flashPhase += dt * 6;
  const redOn = Math.sin(car.flashPhase) > 0;
  if (car.lightL) car.lightL.material.color.setHex(redOn ? 0xff2222 : 0x551111);
  if (car.lightR) car.lightR.material.color.setHex(redOn ? 0x111155 : 0x2244ff);
}

export function updatePolice(dt) {
  // Heat cools off once the player has lain low for a while.
  if (S.wantedHeat > 0 && S.time - S.lastHeatGain > 6) {
    S.wantedHeat = Math.max(0, S.wantedHeat - 2 * dt);
    S.stars = S.wantedHeat <= 0 ? 0 : S.stars;
    if (S.wantedHeat <= 0) S.stars = 0;
  }

  const want = wantedCruiserCount();
  spawnTimer -= dt;
  if (S.cruisers.length < want && spawnTimer <= 0) {
    spawnCruiser();
    spawnTimer = 1.2;
  }
  while (S.cruisers.length > want) {
    removeCruiser(S.cruisers[S.cruisers.length - 1]);
  }

  for (const car of S.cruisers) chaseCruiser(car, dt);

  // BUSTED: on foot, a cruiser sits on the player while they dawdle.
  if (S.onFoot && S.stars > 0) {
    let close = false;
    for (const car of S.cruisers) {
      const d = Math.hypot(
        car.group.position.x - player.pos.x,
        car.group.position.z - player.pos.z,
      );
      if (d < 4.5) close = true;
    }
    if (close && player.speed < 2) {
      S.bustedTimer += dt;
      if (S.bustedTimer > 2.5) S.hooks.onBusted?.();
    } else {
      S.bustedTimer = Math.max(0, S.bustedTimer - dt * 2);
    }
  } else {
    S.bustedTimer = 0;
  }
}

/** Clear the wanted level (after a bust, or when a mission demands it). */
export function clearWanted() {
  S.wantedHeat = 0;
  S.stars = 0;
  S.bustedTimer = 0;
  while (S.cruisers.length > 0) removeCruiser(S.cruisers[0]);
}
