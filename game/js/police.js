// Solmar City — the wanted level and the Solmar police.
// Wanted heat (0–100) becomes 0–5 stars. While any star is showing, police
// cruisers spawn at the edge of the player's view and chase: they ram a
// driven car, and they hold a player on foot until the BUSTED screen. Heat
// cools when the player stays out of sight and commits no new crimes, so
// losing the cops is a real mechanic, and one mission is built on it.

import * as THREE from 'three';
import { STREETS, state, wantedStars, addWanted, setToast, clamp, distance2D, angleLerp } from './state.js';
import { createCar, applyCarTransform, flashPoliceLights } from './vehicles.js';
import { resolveBuildingCollision } from './city.js';
import { playBusted, playCrash } from './audio.js';

const MAX_POLICE = 4;

export function createPoliceManager(scene, colliders) {
  return {
    scene,
    colliders,
    cars: [],
    spawnTimer: 0,
    quietTimer: 0, // seconds since any cruiser saw the player
    onBusted: null, // callback set by main.js
  };
}

function spawnPoliceCar(manager, playerX, playerZ) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 70 + Math.random() * 40;
  let x = clamp(playerX + Math.sin(angle) * dist, -210, 210);
  let z = clamp(playerZ + Math.cos(angle) * dist, -210, 200);
  // Snap the spawn onto the nearest street so cruisers arrive on the road.
  const nearStreetX = STREETS.reduce((a, s) => (Math.abs(s - x) < Math.abs(a - x) ? s : a), STREETS[0]);
  const nearStreetZ = STREETS.reduce((a, s) => (Math.abs(s - z) < Math.abs(a - z) ? s : a), STREETS[0]);
  if (Math.abs(x - nearStreetX) < Math.abs(z - nearStreetZ)) x = nearStreetX;
  else z = nearStreetZ;
  const heading = Math.atan2(playerX - x, playerZ - z);
  const car = createCar(manager.scene, x, z, heading, 0xf2f2ee, 'police', true);
  car.speed = 12;
  car.cruiseSpeed = 20;
  manager.cars.push(car);
  return car;
}

function removePoliceCar(manager, car) {
  manager.scene.remove(car.mesh);
  const index = manager.cars.indexOf(car);
  if (index >= 0) manager.cars.splice(index, 1);
}

export function updatePolice(manager, dt, trafficCars) {
  const stars = wantedStars();
  const p = state.player;
  const playerCar = p.inCar;

  // Desired cruisers on the road: one per star, up to four.
  const wanted = Math.min(stars, MAX_POLICE);
  manager.spawnTimer -= dt;
  if (manager.cars.length < wanted && manager.spawnTimer <= 0) {
    spawnPoliceCar(manager, p.x, p.z);
    manager.spawnTimer = 2.5;
  }
  if (stars === 0) {
    // Wanted cleared: cruisers peel off and despawn once far away.
    for (const car of [...manager.cars]) {
      const d = distance2D(car.x, car.z, p.x, p.z);
      if (d > 90) removePoliceCar(manager, car);
    }
  }

  // Heat cools only while no cruiser is close and the player is behaving.
  let nearestPolice = Infinity;
  for (const car of manager.cars) {
    nearestPolice = Math.min(nearestPolice, distance2D(car.x, car.z, p.x, p.z));
  }
  if (stars > 0 && nearestPolice > 45) {
    manager.quietTimer += dt;
    if (manager.quietTimer > 4) {
      addWanted(-6 * dt);
      if (wantedStars() === 0) setToast('You lost the cops. Heat is off.', 3);
    }
  } else {
    manager.quietTimer = 0;
  }

  for (const car of [...manager.cars]) {
    flashPoliceLights(car, state.time);
    const dist = distance2D(car.x, car.z, p.x, p.z);
    const targetSpeed = dist > 120 ? 30 : dist > 25 ? 26 : 20;
    car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 1.5);

    // Steer toward the player, with a little wobble so chases look alive.
    const desiredHeading = Math.atan2(p.x - car.x, p.z - car.z) + Math.sin(state.time * 1.3 + car.x) * 0.08;
    car.heading = angleLerp(car.heading, desiredHeading, Math.min(1, dt * 2.2));

    const nx = car.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.z + Math.cos(car.heading) * car.speed * dt;
    const resolved = resolveBuildingCollision(manager.colliders, nx, nz, 1.6);
    const hitWall = resolved.x !== nx || resolved.z !== nz;
    if (hitWall) car.speed *= 0.5;
    car.x = resolved.x;
    car.z = resolved.z;
    applyCarTransform(car, dt);

    // Ramming the player's car: shove it and shake the camera.
    if (playerCar && dist < 3.4) {
      const push = 9 * dt;
      playerCar.x += Math.sin(car.heading) * push;
      playerCar.z += Math.cos(car.heading) * push;
      playerCar.speed *= 0.985;
      if (Math.random() < dt * 2) playCrash();
      state.camera.shake = Math.max(state.camera.shake, 0.25);
      if (Math.abs(playerCar.speed) < 2) {
        // Cornered in the car: the bust clock runs.
        p.bustedTimer += dt;
      }
    }

    // On foot and caught: a cruiser beside a slow player busts them.
    if (!playerCar && dist < 4.5) {
      const playerSpeed = p.speed || 0;
      if (playerSpeed < 4) {
        p.bustedTimer += dt * 1.4;
      } else {
        p.bustedTimer = Math.max(0, p.bustedTimer - dt);
      }
    }

    // Despawn a cruiser that fell far behind a fast getaway.
    if (stars > 0 && dist > 160 && manager.cars.length > wanted) {
      removePoliceCar(manager, car);
    }
  }

  // Busted: the run pauses, cash is fined, the player wakes at the hospital.
  if (p.bustedTimer > 1.6 && state.mode === 'playing') {
    p.bustedTimer = 0;
    const fine = Math.min(state.cash, 200);
    state.cash -= fine;
    state.wantedHeat = 0;
    for (const car of [...manager.cars]) removePoliceCar(manager, car);
    playBusted();
    if (manager.onBusted) manager.onBusted(fine);
  }
}

// Spawn cruisers immediately (used by screenshot staging so the chase is
// already on screen instead of arriving seconds later).
export function forceSpawnPolice(manager, count) {
  const spawned = [];
  for (let i = 0; i < count; i++) {
    spawned.push(spawnPoliceCar(manager, state.player.x, state.player.z));
  }
  return spawned;
}

export function clearAllPolice(manager) {
  for (const car of [...manager.cars]) removePoliceCar(manager, car);
  manager.spawnTimer = 0;
  manager.quietTimer = 0;
}

export function policeCount(manager) {
  return manager.cars.length;
}
