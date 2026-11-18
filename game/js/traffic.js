// Solmar City — traffic cars and pedestrians.
// Traffic drives the street grid: each car follows one street, turns at
// intersections at random, and slows for the car ahead. Pedestrians stroll
// the sidewalks, cross at corners, and scatter when a gun goes off or a car
// bears down on them. Both systems are cheap on purpose — dozens of movers
// with no pathfinding, just the grid.

import * as THREE from 'three';
import { STREETS, state, mulberry32, clamp, distance2D, addWanted, setToast } from './state.js';
import { createCar, randomCarColor, applyCarTransform } from './vehicles.js';
import { isOnRoad } from './city.js';
import { playCrash } from './audio.js';

const PEDESTRIAN_COLORS = [0xe8e0d0, 0xd94f3d, 0x2e6fb0, 0x3fae6a, 0xe8c84a, 0x8a5fb0, 0xeeeeee];

export function makePedestrianMesh(colorHex) {
  const ped = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: colorHex });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc98a5a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x333a44 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.34), shirt);
  torso.position.y = 1.05;
  torso.castShadow = true;
  ped.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), skin);
  head.position.y = 1.62;
  ped.add(head);
  const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);
  const leftLeg = new THREE.Mesh(legGeo, pants);
  leftLeg.position.set(-0.15, 0.35, 0);
  ped.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, pants);
  rightLeg.position.set(0.15, 0.35, 0);
  ped.add(rightLeg);
  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.16);
  const leftArm = new THREE.Mesh(armGeo, shirt);
  leftArm.position.set(-0.4, 1.05, 0);
  ped.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, shirt);
  rightArm.position.set(0.4, 1.05, 0);
  ped.add(rightArm);
  ped.userData = { leftLeg, rightLeg, leftArm, rightArm };
  return ped;
}

function randomStreetPoint(random) {
  const street = STREETS[Math.floor(random() * STREETS.length)];
  const along = (random() - 0.5) * 360;
  if (random() < 0.5) return { x: street, z: along };
  return { x: along, z: street };
}

export function spawnTraffic(scene, count) {
  const random = mulberry32(777);
  const cars = [];
  for (let i = 0; i < count; i++) {
    const spot = randomStreetPoint(random);
    const horizontal = Math.abs(spot.z - Math.round(spot.z)) < 1 && Math.abs(spot.x) < 200;
    // Drive along the street the point sits on.
    const onVerticalStreet = STREETS.some((s) => Math.abs(spot.x - s) < 1);
    const heading = onVerticalStreet
      ? (random() < 0.5 ? 0 : Math.PI)
      : (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const car = createCar(scene, spot.x, spot.z, heading, randomCarColor(random), 'traffic', false);
    car.speed = 7 + random() * 5;
    car.cruiseSpeed = car.speed;
    car.laneOffset = (random() < 0.5 ? -2.2 : 2.2);
    cars.push(car);
  }
  return cars;
}

export function spawnPedestrians(scene, count) {
  const random = mulberry32(4242);
  const peds = [];
  for (let i = 0; i < count; i++) {
    const street = STREETS[Math.floor(random() * STREETS.length)];
    const along = (random() - 0.5) * 360;
    const side = random() < 0.5 ? 8.5 : -8.5;
    const x = random() < 0.5 ? street + side : along;
    const z = random() < 0.5 ? along : street + side;
    const mesh = makePedestrianMesh(PEDESTRIAN_COLORS[Math.floor(random() * PEDESTRIAN_COLORS.length)]);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    peds.push({
      mesh,
      x, z,
      heading: random() * Math.PI * 2,
      speed: 1.2 + random() * 1.1,
      walkPhase: random() * 10,
      state: 'walk', // 'walk' | 'flee' | 'down'
      stateTimer: 0,
      targetX: x,
      targetZ: z,
      scared: false,
    });
  }
  return peds;
}

function pickPedTarget(ped, random) {
  // Wander to a nearby sidewalk point.
  const street = STREETS[Math.floor(random() * STREETS.length)];
  const along = clamp(ped.x + (random() - 0.5) * 120, -210, 210);
  if (random() < 0.5) {
    ped.targetX = street + (random() < 0.5 ? 8.5 : -8.5);
    ped.targetZ = along;
  } else {
    ped.targetX = along;
    ped.targetZ = street + (random() < 0.5 ? 8.5 : -8.5);
  }
}

export function updateTraffic(cars, dt, colliders, playerCar) {
  for (const car of cars) {
    if (car.kind !== 'traffic') continue;
    // Slow down for the car ahead on the same street.
    let targetSpeed = car.cruiseSpeed;
    for (const other of cars) {
      if (other === car || other.kind === 'player') continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
      const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
      if (ahead > 0 && ahead < 10 && side < 3) targetSpeed = 0;
    }
    // The player's car ahead also makes traffic brake.
    if (playerCar) {
      const dx = playerCar.x - car.x;
      const dz = playerCar.z - car.z;
      const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
      const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
      if (ahead > 0 && ahead < 9 && side < 3) targetSpeed = 0;
    }
    car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 2);

    const nx = car.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.z + Math.cos(car.heading) * car.speed * dt;
    car.x = nx;
    car.z = nz;

    // At an intersection, sometimes turn onto the crossing street.
    const nearX = STREETS.some((s) => Math.abs(car.x - s) < 2.5);
    const nearZ = STREETS.some((s) => Math.abs(car.z - s) < 2.5);
    if (nearX && nearZ && Math.random() < dt * 0.25) {
      const turn = (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
      car.heading += turn;
      // Snap onto the street centre after the turn.
      car.x = STREETS.reduce((a, s) => (Math.abs(s - car.x) < Math.abs(a - car.x) ? s : a), STREETS[0]);
      car.z = STREETS.reduce((a, s) => (Math.abs(s - car.z) < Math.abs(a - car.z) ? s : a), STREETS[0]);
    }
    // Wrap around the city edge instead of driving into the sea.
    if (car.x > 220) car.x = -220;
    if (car.x < -220) car.x = 220;
    if (car.z > 205) car.z = -220;
    if (car.z < -220) car.z = 205;

    applyCarTransform(car, dt);
  }
}

export function updatePedestrians(peds, dt, playerPos, playerCar, gunshotAt) {
  const random = Math.random;
  for (const ped of peds) {
    if (ped.state === 'down') {
      ped.stateTimer -= dt;
      if (ped.stateTimer <= 0) {
        ped.state = 'walk';
        ped.mesh.visible = true;
        ped.mesh.rotation.x = 0;
        pickPedTarget(ped, random);
      }
      continue;
    }
    // Flee from gunfire or a speeding car.
    const playerDist = distance2D(ped.x, ped.z, playerPos.x, playerPos.z);
    let fleeing = ped.state === 'flee';
    if (gunshotAt && distance2D(ped.x, ped.z, gunshotAt.x, gunshotAt.z) < 30) fleeing = true;
    if (playerDist < 4 && playerCar && Math.abs(playerCar.speed) > 8) fleeing = true;
    if (fleeing && ped.state !== 'flee') {
      ped.state = 'flee';
      ped.stateTimer = 2.5;
      const away = Math.atan2(ped.x - playerPos.x, ped.z - playerPos.z);
      ped.targetX = ped.x + Math.sin(away) * 40;
      ped.targetZ = ped.z + Math.cos(away) * 40;
    }
    if (ped.state === 'flee') {
      ped.stateTimer -= dt;
      if (ped.stateTimer <= 0) {
        ped.state = 'walk';
        pickPedTarget(ped, random);
      }
    }

    const dx = ped.targetX - ped.x;
    const dz = ped.targetZ - ped.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 2) {
      if (ped.state === 'walk') pickPedTarget(ped, random);
      continue;
    }
    const speed = ped.state === 'flee' ? 5.5 : ped.speed;
    const step = (speed * dt) / dist;
    ped.x += dx * step;
    ped.z += dz * step;
    ped.heading = Math.atan2(dx, dz);
    ped.walkPhase += dt * (ped.state === 'flee' ? 12 : 7);
    const swing = Math.sin(ped.walkPhase) * 0.5;
    const u = ped.mesh.userData;
    u.leftLeg.rotation.x = swing;
    u.rightLeg.rotation.x = -swing;
    u.leftArm.rotation.x = -swing;
    u.rightArm.rotation.x = swing;
    ped.mesh.position.set(ped.x, 0, ped.z);
    ped.mesh.rotation.y = ped.heading;

    // Run over by the player's car: down, wanted up, and the player knows it.
    if (playerCar && Math.abs(playerCar.speed) > 3) {
      const carDist = distance2D(ped.x, ped.z, playerCar.x, playerCar.z);
      if (carDist < 1.8) {
        knockPedDown(ped);
        state.pedestriansHit += 1;
        addWanted(30);
        setToast('Pedestrian down! Witnesses called the cops.', 3);
        playCrash();
      }
    }
  }
}

export function knockPedDown(ped) {
  ped.state = 'down';
  ped.stateTimer = 6;
  ped.mesh.rotation.x = -Math.PI / 2;
  ped.mesh.position.y = 0.35;
}

export function scarePedestrians(peds, at) {
  for (const ped of peds) {
    if (distance2D(ped.x, ped.z, at.x, at.z) < 35 && ped.state !== 'down') {
      ped.state = 'flee';
      ped.stateTimer = 3;
      const away = Math.atan2(ped.x - at.x, ped.z - at.z);
      ped.targetX = ped.x + Math.sin(away) * 45;
      ped.targetZ = ped.z + Math.cos(away) * 45;
    }
  }
}

export function nearestPedestrian(peds, x, z, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const d = distance2D(ped.x, ped.z, x, z);
    if (d < bestD) {
      bestD = d;
      best = ped;
    }
  }
  return best;
}
