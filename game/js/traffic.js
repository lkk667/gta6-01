// Solmar City — traffic cars and pedestrians (v3 rewrite).
// 14 cars loop the road grid; 26 pedestrians walk the sidewalks, flee
// gunfire, and — new in v3 — dodge cars coming at them instead of standing
// in the road while a car passes through them.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, dist2, clamp } from './state.js';
import { makeCar } from './vehicles.js';
import { attachBlob, resolveCollisions } from './city.js';

const PED_SHIRTS = [0xe84a4a, 0x4a8ae8, 0x4ad87a, 0xe8d84a, 0xd87ab8, 0x7ad8d8, 0xf2f2f2, 0x8a5a3a];

function buildPedestrian() {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: PED_SHIRTS[Math.floor(Math.random() * PED_SHIRTS.length)] });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.3), shirt);
  torso.position.y = 1.05;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), skin);
  head.position.y = 1.6;
  g.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.68, 0.2), pants);
  legL.position.set(-0.14, 0.34, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legR);
  return { group: g, legL, legR };
}

export function buildTraffic() {
  // Traffic cars: pick a road, drive along it, turn at random intersections.
  for (let i = 0; i < 14; i++) {
    const alongX = Math.random() > 0.5;
    const road = WORLD.roads[Math.floor(Math.random() * WORLD.roads.length)];
    const mesh = makeCar(undefined, false);
    const x = alongX ? -160 + Math.random() * 320 : road + (Math.random() > 0.5 ? 2.4 : -2.4);
    const z = alongX ? road + (Math.random() > 0.5 ? 2.4 : -2.4) : -160 + Math.random() * 320;
    mesh.position.set(x, 0, z);
    const heading = alongX ? (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2) : (Math.random() > 0.5 ? 0 : Math.PI);
    mesh.rotation.y = heading;
    S.scene.add(mesh);
    attachBlob(mesh, 4.6, 0.03);
    S.trafficCars.push({
      mesh, heading,
      speed: 7 + Math.random() * 4,
      alongX,
      road,
      cruise: 7 + Math.random() * 4,
    });
  }
  // Pedestrians: sidewalk wanderers near the centre and the park.
  for (let i = 0; i < 26; i++) {
    const built = buildPedestrian();
    const x = -140 + Math.random() * 280;
    const z = -140 + Math.random() * 280;
    built.group.position.set(x, 0, z);
    S.scene.add(built.group);
    attachBlob(built.group, 1.4, 0.03);
    S.peds.push({
      mesh: built.group,
      legL: built.legL,
      legR: built.legR,
      heading: Math.random() * Math.PI * 2,
      speed: 1.1 + Math.random() * 0.9,
      walkPhase: Math.random() * 6,
      fleeTimer: 0,
      stumble: 0,
      retarget: 0,
    });
  }
}

// Pedestrians within earshot run from a gunshot.
export function scarePeds(x, z, radius) {
  for (const ped of S.peds) {
    if (dist2(x, z, ped.mesh.position.x, ped.mesh.position.z) < radius) {
      ped.fleeTimer = 2.5 + Math.random();
      const dx = ped.mesh.position.x - x;
      const dz = ped.mesh.position.z - z;
      ped.heading = Math.atan2(dx, dz);
    }
  }
}

// All cars that can hit a pedestrian: traffic, cruisers, the player's car.
function nearbyCarThreat(ped) {
  const px = ped.mesh.position.x;
  const pz = ped.mesh.position.z;
  const threats = [];
  for (const c of S.trafficCars) threats.push({ x: c.mesh.position.x, z: c.mesh.position.z, speed: c.speed, heading: c.heading });
  for (const c of S.cruisers) threats.push({ x: c.mesh.position.x, z: c.mesh.position.z, speed: c.speed || 10, heading: c.heading });
  if (S.currentCar) threats.push({ x: S.currentCar.mesh.position.x, z: S.currentCar.mesh.position.z, speed: S.currentCar.speed, heading: S.currentCar.heading });
  for (const t of threats) {
    const dx = px - t.x;
    const dz = pz - t.z;
    const d = Math.hypot(dx, dz);
    if (d < 9 && Math.abs(t.speed) > 2) {
      // Is the car heading toward the pedestrian?
      const fx = Math.sin(t.heading) * Math.sign(t.speed);
      const fz = Math.cos(t.heading) * Math.sign(t.speed);
      const closing = -(dx * fx + dz * fz) / (d || 1); // >0 means closing
      if (closing > 0.35) return { t, d, dx, dz };
    }
  }
  return null;
}

export function updateTraffic(dt) {
  for (const c of S.trafficCars) {
    // Brake for a pedestrian directly ahead in the road.
    let target = c.cruise;
    for (const ped of S.peds) {
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      const dx = ped.mesh.position.x - c.mesh.position.x;
      const dz = ped.mesh.position.z - c.mesh.position.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 9 && side < 2.2) target = 0;
    }
    // Ease off near the player's car too.
    if (S.currentCar) {
      const d = dist2(c.mesh.position.x, c.mesh.position.z, S.currentCar.mesh.position.x, S.currentCar.mesh.position.z);
      if (d < 7) target = Math.min(target, 2);
    }
    c.speed += (target - c.speed) * Math.min(1, dt * 2);
    c.mesh.position.x += Math.sin(c.heading) * c.speed * dt;
    c.mesh.position.z += Math.cos(c.heading) * c.speed * dt;
    // Turn at intersections, keep inside the city.
    const px = c.mesh.position.x;
    const pz = c.mesh.position.z;
    const onRoadX = WORLD.roads.some((r) => Math.abs(pz - r) < 1.2);
    const onRoadZ = WORLD.roads.some((r) => Math.abs(px - r) < 1.2);
    if ((onRoadX || onRoadZ) && Math.random() < dt * 0.25) {
      const turn = (Math.random() - 0.5) * Math.PI;
      c.heading += turn;
      c.alongX = Math.abs(Math.sin(c.heading)) > 0.7;
    }
    if (px > 175 || px < -175 || pz > 175 || pz < -175) {
      c.heading += Math.PI;
      c.mesh.position.x = clamp(px, -170, 170);
      c.mesh.position.z = clamp(pz, -170, 170);
    }
    c.mesh.rotation.y = c.heading;
    for (const w of c.mesh.userData.wheels) w.rotation.x += c.speed * dt * 2.4;
  }
}

export function updatePeds(dt) {
  for (const ped of S.peds) {
    if (ped.stumble > 0) {
      ped.stumble -= dt;
      ped.mesh.rotation.x = -0.5 * Math.max(0, ped.stumble / 0.5);
      ped.mesh.position.y = 0;
      continue;
    }
    ped.mesh.rotation.x = 0;
    let speed = ped.speed;
    if (ped.fleeTimer > 0) {
      ped.fleeTimer -= dt;
      speed = 4.2;
    }
    // Dodge an approaching car: sidestep perpendicular to its path.
    const threat = nearbyCarThreat(ped);
    if (threat && threat.d < 8) {
      const sideX = Math.cos(threat.t.heading);
      const sideZ = -Math.sin(threat.t.heading);
      const toPed = (ped.mesh.position.x - threat.t.x) * sideX + (ped.mesh.position.z - threat.t.z) * sideZ;
      const dir = toPed >= 0 ? 1 : -1;
      ped.heading = Math.atan2(sideX * dir, sideZ * dir);
      speed = 4.6;
      ped.fleeTimer = Math.max(ped.fleeTimer, 0.8);
    }
    ped.retarget -= dt;
    if (ped.retarget <= 0 && ped.fleeTimer <= 0) {
      ped.retarget = 3 + Math.random() * 5;
      ped.heading += (Math.random() - 0.5) * 1.6;
    }
    ped.mesh.position.x += Math.sin(ped.heading) * speed * dt;
    ped.mesh.position.z += Math.cos(ped.heading) * speed * dt;
    resolveCollisions(ped.mesh.position, 0.4);
    ped.mesh.rotation.y = ped.heading;
    ped.walkPhase += dt * speed * 2.2;
    const swing = Math.min(1, speed / 4) * 0.5;
    ped.legL.rotation.x = Math.sin(ped.walkPhase) * swing;
    ped.legR.rotation.x = -Math.sin(ped.walkPhase) * swing;
  }
}
