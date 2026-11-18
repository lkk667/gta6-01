// Solmar City — traffic: 14 cars cruising the road grid and 26
// pedestrians on the sidewalks, who run when they hear gunfire.

import * as THREE from 'three';
import { S, WORLD, ROAD_LINES, mulberry32, clamp } from './state.js';
import { makeCar, placeCar, CAR_COLORS } from './vehicles.js';
import { collideCircle } from './city.js';

const rng = mulberry32(77031);

let sceneRef = null;

function randomRoadPos() {
  const line = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)];
  const along = -170 + rng() * 340;
  return { line, along };
}

/** Spawn the traffic fleet and the pedestrians. */
export function buildTraffic(scene) {
  sceneRef = scene;
  S.trafficCars = [];
  S.peds = [];

  for (let i = 0; i < 14; i++) {
    const car = makeCar(CAR_COLORS[i % CAR_COLORS.length]);
    car.driver = 'traffic';
    const { line, along } = randomRoadPos();
    const horizontal = rng() < 0.5;
    const dir = rng() < 0.5 ? 1 : -1;
    const lane = 3;
    if (horizontal) {
      placeCar(scene, car, along, line + dir * lane, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      car.axis = 'x';
    } else {
      placeCar(scene, car, line + dir * lane, along, dir > 0 ? 0 : Math.PI);
      car.axis = 'z';
    }
    car.dir = dir;
    car.cruise = 8 + rng() * 6;
    car.speed = car.cruise;
    S.trafficCars.push(car);
  }

  // Pedestrians: a small low-poly walker.
  const shirtColors = [0xd84f6a, 0x4f8ad8, 0x6ad84f, 0xe8b83a, 0x9a6ad8, 0xeeeeee];
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  for (let i = 0; i < 26; i++) {
    const g = new THREE.Group();
    const shirt = new THREE.MeshLambertMaterial({ color: shirtColors[i % shirtColors.length] });
    const pants = new THREE.MeshLambertMaterial({ color: 0x33404f });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.3), shirt);
    torso.position.y = 1.05;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), skinMat);
    head.position.y = 1.6;
    g.add(head);
    const legGeo = new THREE.BoxGeometry(0.2, 0.66, 0.22);
    legGeo.translate(0, -0.33, 0);
    const legL = new THREE.Mesh(legGeo, pants);
    legL.position.set(-0.14, 0.68, 0);
    g.add(legL);
    const legR = new THREE.Mesh(legGeo, pants);
    legR.position.set(0.14, 0.68, 0);
    g.add(legR);
    const x = -170 + rng() * 340;
    const z = -170 + rng() * 340;
    g.position.set(x, 0, z);
    scene.add(g);
    S.peds.push({
      group: g,
      legL,
      legR,
      pos: g.position,
      heading: rng() * Math.PI * 2,
      speed: 1.2 + rng() * 1.0,
      walkPhase: rng() * 6,
      target: null,
      fleeUntil: 0,
      fleeFrom: null,
      down: false,
      downUntil: 0,
    });
  }
}

/** A gunshot went off at (x, z): nearby pedestrians run away from it. */
export function scarePeds(x, z, radius = 40) {
  for (const ped of S.peds) {
    if (ped.down) continue;
    const d = Math.hypot(ped.pos.x - x, ped.pos.z - z);
    if (d < radius) {
      ped.fleeUntil = S.time + 3 + rng() * 2;
      ped.fleeFrom = { x, z };
      ped.speed = 7 + rng() * 2;
    }
  }
}

function pickPedTarget(ped) {
  // Wander to a nearby sidewalk point.
  const x = clamp(ped.pos.x + (rng() - 0.5) * 60, -WORLD.half, WORLD.half);
  const z = clamp(ped.pos.z + (rng() - 0.5) * 60, -WORLD.half, WORLD.half);
  ped.target = { x, z };
}

function updatePed(ped, dt) {
  if (ped.down) {
    if (S.time > ped.downUntil) {
      ped.down = false;
      ped.group.rotation.x = 0;
      ped.group.position.y = 0;
    }
    return;
  }
  let tx;
  let tz;
  let speed = ped.speed;
  if (S.time < ped.fleeUntil && ped.fleeFrom) {
    // Run directly away from the shot.
    const dx = ped.pos.x - ped.fleeFrom.x;
    const dz = ped.pos.z - ped.fleeFrom.z;
    const d = Math.hypot(dx, dz) || 1;
    tx = ped.pos.x + (dx / d) * 20;
    tz = ped.pos.z + (dz / d) * 20;
    speed = 8;
  } else {
    if (!ped.target) pickPedTarget(ped);
    tx = ped.target.x;
    tz = ped.target.z;
    speed = 1.6;
  }
  const dx = tx - ped.pos.x;
  const dz = tz - ped.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1.2) {
    ped.target = null;
    return;
  }
  const want = Math.atan2(dx, dz);
  let diff = want - ped.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  ped.heading += clamp(diff, -2.4 * dt, 2.4 * dt);
  ped.pos.x += Math.sin(ped.heading) * speed * dt;
  ped.pos.z += Math.cos(ped.heading) * speed * dt;
  ped.pos.x = clamp(ped.pos.x, -WORLD.half, WORLD.half);
  ped.pos.z = clamp(ped.pos.z, -WORLD.half, WORLD.half);
  collideCircle(ped.pos, 0.4);
  ped.walkPhase += dt * speed * 2.4;
  const swing = Math.sin(ped.walkPhase) * 0.5;
  ped.legL.rotation.x = swing;
  ped.legR.rotation.x = -swing;
  ped.group.rotation.y = ped.heading;
}

function updateTrafficCar(car, dt) {
  // Keep to the road: drive along its axis, turn at intersections.
  const p = car.group.position;
  const f = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  p.x += f.x * car.speed * dt;
  p.z += f.z * car.speed * dt;

  // Slow for the car ahead.
  for (const other of S.trafficCars) {
    if (other === car) continue;
    const dx = other.group.position.x - p.x;
    const dz = other.group.position.z - p.z;
    const ahead = dx * f.x + dz * f.z;
    const side = Math.abs(dx * f.z - dz * f.x);
    if (ahead > 0 && ahead < 9 && side < 2.5) {
      car.speed = Math.max(0, car.speed - 14 * dt);
    }
  }
  // And for the player's car.
  if (S.car) {
    const dx = S.car.group.position.x - p.x;
    const dz = S.car.group.position.z - p.z;
    const ahead = dx * f.x + dz * f.z;
    const side = Math.abs(dx * f.z - dz * f.x);
    if (ahead > 0 && ahead < 9 && side < 2.5) car.speed = Math.max(0, car.speed - 14 * dt);
  }
  if (car.speed < car.cruise) car.speed = Math.min(car.cruise, car.speed + 5 * dt);

  // At an intersection, sometimes turn onto the cross street.
  const nearX = ROAD_LINES.some((l) => Math.abs(p.x - l) < 1.2);
  const nearZ = ROAD_LINES.some((l) => Math.abs(p.z - l) < 1.2);
  if (nearX && nearZ && rng() < dt * 0.35) {
    const horizontal = car.axis === 'x';
    const newDir = rng() < 0.5 ? 1 : -1;
    if (horizontal) {
      car.axis = 'z';
      car.heading = newDir > 0 ? 0 : Math.PI;
      // snap onto the cross road's lane
      const line = ROAD_LINES.reduce((a, b) => (Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a));
      p.x = line + newDir * 3;
    } else {
      car.axis = 'x';
      car.heading = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      const line = ROAD_LINES.reduce((a, b) => (Math.abs(b - p.z) < Math.abs(a - p.z) ? b : a));
      p.z = line + newDir * 3;
    }
    car.dir = newDir;
  }

  // Turn around at the city edge.
  if (p.x > WORLD.half || p.x < -WORLD.half || p.z > WORLD.half || p.z < -WORLD.half) {
    car.heading += Math.PI;
    car.axis = car.axis === 'x' ? 'z' : 'x';
    p.x = clamp(p.x, -WORLD.half, WORLD.half);
    p.z = clamp(p.z, -WORLD.half, WORLD.half);
  }
  car.group.rotation.y = car.heading;
}

export function updateTraffic(dt) {
  for (const car of S.trafficCars) updateTrafficCar(car, dt);
  for (const ped of S.peds) updatePed(ped, dt);
}

/** Knock a pedestrian down (punch or shot). They get up after a while. */
export function knockPedDown(ped, seconds = 4) {
  ped.down = true;
  ped.downUntil = S.time + seconds;
  ped.group.rotation.x = -Math.PI / 2;
  ped.group.position.y = 0.3;
}
