// Solmar City — combat: the pistol (magazine and reserve ammo, reload),
// the punch, and health/ammo/cash pickups scattered around the city.
// Firing shows a muzzle flash, a tracer and impact particles, and kicks
// the camera a little.

import * as THREE from 'three';
import { S, WORLD, clamp, addHeat, addShake, addCash, toast } from './state.js';
import { player } from './player.js';
import { scarePeds, knockPedDown } from './traffic.js';

let sceneRef = null;
let flash = null;
let flashLight = null;
let tracer = null;
let tracerMat = null;
let particles = [];
let shootCooldown = 0;
let punchCooldown = 0;
let flashUntil = 0;
let tracerUntil = 0;

const PICKUP_SPOTS = [
  { kind: 'health', x: -20, z: 20 },
  { kind: 'ammo', x: 60, z: -20 },
  { kind: 'cash', x: -60, z: 100 },
  { kind: 'health', x: 120, z: 20 },
  { kind: 'ammo', x: -100, z: -20 },
  { kind: 'cash', x: 20, z: -100 },
  { kind: 'health', x: 140, z: 100 },
  { kind: 'ammo', x: -140, z: 60 },
];

function pickupMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'health') {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.3),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    g.add(box);
    const crossMat = new THREE.MeshBasicMaterial({ color: 0x2ecc40 });
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.34), crossMat);
    g.add(v);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.34), crossMat);
    g.add(h);
  } else if (kind === 'ammo') {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.55, 0.6),
      new THREE.MeshLambertMaterial({ color: 0x8a6d2b }),
    );
    g.add(box);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.12, 0.6),
      new THREE.MeshLambertMaterial({ color: 0x5a4a1a }),
    );
    lid.position.y = 0.32;
    g.add(lid);
  } else {
    // cash: a little stack of bills
    const stack = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.25, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2ecc40 }),
    );
    g.add(stack);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.1, 0.2),
      new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }),
    );
    g.add(band);
  }
  return g;
}

export function buildCombat(scene) {
  sceneRef = scene;
  // Muzzle flash: a small starburst mesh plus a short-lived point light.
  flash = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.9, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95 }),
  );
  core.rotation.x = Math.PI / 2;
  flash.add(core);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc832, transparent: true, opacity: 0.85 }),
  );
  flash.add(halo);
  flash.visible = false;
  scene.add(flash);
  flashLight = new THREE.PointLight(0xffc832, 0, 12);
  scene.add(flashLight);

  // Tracer: a bright line from the muzzle to the hit point.
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  tracerMat = new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95 });
  tracer = new THREE.Line(tracerGeo, tracerMat);
  tracer.visible = false;
  tracer.frustumCulled = false;
  scene.add(tracer);

  // Particle pool: small boxes reused for blood, sparks and debris.
  const pGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.visible = false;
    scene.add(m);
    particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0 });
  }

  // Pickups.
  S.pickups = PICKUP_SPOTS.map((spot) => {
    const mesh = pickupMesh(spot.kind);
    mesh.position.set(spot.x, 0.8, spot.z);
    scene.add(mesh);
    return { ...spot, mesh, taken: false, respawnAt: 0 };
  });
}

function spawnParticles(point, color, count, speed) {
  let made = 0;
  for (const p of particles) {
    if (made >= count) break;
    if (p.life > 0) continue;
    p.life = 0.45 + Math.random() * 0.25;
    p.mesh.visible = true;
    p.mesh.material.color.setHex(color);
    p.mesh.position.copy(point);
    p.vel.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.8 + 1, (Math.random() - 0.5) * speed);
    made++;
  }
}

/** Where the pistol's muzzle is in the world right now: ahead of the
 * player along the camera's view, offset to the gun hand's side so the
 * flash reads from behind the player. */
export function muzzlePosition() {
  const f = { x: -Math.sin(player.camYaw), z: -Math.cos(player.camYaw) };
  const r = { x: Math.cos(player.camYaw), z: -Math.sin(player.camYaw) };
  return new THREE.Vector3(
    player.pos.x + f.x * 0.7 + r.x * 0.38,
    1.42,
    player.pos.z + f.z * 0.7 + r.z * 0.38,
  );
}

/** Fire one pistol round. Consumes a magazine round and adds a little heat. */
export function shoot() {
  if (S.mode !== 'playing' || !S.onFoot) return false;
  if (shootCooldown > 0 || S.magazine <= 0) {
    if (S.magazine <= 0) S.hooks.onEmptyClick?.();
    return false;
  }
  shootCooldown = 0.22;
  S.magazine -= 1;
  addHeat(2);
  S.hooks.onShoot?.();

  const muzzle = muzzlePosition();
  const dir = new THREE.Vector3(
    -Math.sin(player.camYaw),
    -Math.tan(player.camPitch) * 0.6,
    -Math.cos(player.camYaw),
  ).normalize();

  // Find the nearest hit: a pedestrian, a car, or the ground.
  let hitPoint = null;
  let hitKind = 'ground';
  let bestT = 120;
  const ray = new THREE.Raycaster(muzzle, dir, 0.1, 120);
  for (const ped of S.peds) {
    if (ped.down) continue;
    const centre = new THREE.Vector3(ped.pos.x, 1.1, ped.pos.z);
    const to = new THREE.Vector3().subVectors(centre, muzzle);
    const t = to.dot(dir);
    if (t < 0.5 || t > bestT) continue;
    const closest = new THREE.Vector3().copy(muzzle).addScaledVector(dir, t);
    if (closest.distanceTo(centre) < 0.9) {
      bestT = t;
      hitPoint = closest;
      hitKind = 'ped';
      hitPoint.ped = ped;
    }
  }
  for (const car of [...S.trafficCars, ...S.cruisers]) {
    const c = car.group.position;
    const to = new THREE.Vector3(c.x - muzzle.x, 0, c.z - muzzle.z);
    const t = to.dot(dir);
    if (t < 0.5 || t > bestT) continue;
    const closest = new THREE.Vector3().copy(muzzle).addScaledVector(dir, t);
    const dx = closest.x - c.x;
    const dz = closest.z - c.z;
    // rough car box: 2.4 wide, 4.6 long, rotated by heading
    const localX = dx * Math.cos(car.heading) - dz * Math.sin(car.heading);
    const localZ = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
    if (Math.abs(localX) < 1.4 && Math.abs(localZ) < 2.5 && closest.y < 1.9) {
      bestT = t;
      hitPoint = closest;
      hitKind = 'car';
    }
  }
  if (!hitPoint) {
    // Ground plane.
    if (dir.y < -0.02) {
      const t = -muzzle.y / dir.y;
      if (t > 0.5 && t < bestT) {
        hitPoint = new THREE.Vector3().copy(muzzle).addScaledVector(dir, t);
        hitKind = 'ground';
      }
    }
  }
  if (!hitPoint) {
    hitPoint = new THREE.Vector3().copy(muzzle).addScaledVector(dir, 60);
    hitKind = 'air';
  }

  // Muzzle flash + light at the muzzle.
  flash.position.copy(muzzle);
  flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  flash.visible = true;
  flashLight.position.copy(muzzle);
  flashLight.intensity = 42;
  flashUntil = S.time + 0.07;
  if (S.debug.holdFlashUntil > S.time) {
    flashUntil = S.debug.holdFlashUntil;
    tracerUntil = S.debug.holdFlashUntil;
  }

  // Tracer from the muzzle to the hit point.
  const pos = tracer.geometry.attributes.position;
  pos.setXYZ(0, muzzle.x, muzzle.y, muzzle.z);
  pos.setXYZ(1, hitPoint.x, hitPoint.y, hitPoint.z);
  pos.needsUpdate = true;
  tracer.visible = true;
  if (tracerUntil <= S.time) tracerUntil = S.time + 0.12;

  // Impact particles by target: blood for people, gold sparks for cars,
  // grey debris for the ground.
  if (hitKind === 'ped') {
    spawnParticles(hitPoint, 0xc81e1e, 14, 4);
    if (hitPoint.ped) {
      knockPedDown(hitPoint.ped, 5);
      addHeat(3);
    }
  } else if (hitKind === 'car') {
    spawnParticles(hitPoint, 0xffc832, 10, 5);
  } else if (hitKind === 'ground') {
    spawnParticles(hitPoint, 0x9a9a9a, 8, 3.5);
  }

  // A little camera kick.
  addShake(0.09, 0.18);
  scarePeds(player.pos.x, player.pos.z, 45);
  return true;
}

/** A short-range punch: knocks a pedestrian down. */
export function punch() {
  if (S.mode !== 'playing' || !S.onFoot) return false;
  if (punchCooldown > 0) return false;
  punchCooldown = 0.45;
  S.hooks.onPunch?.();
  const f = { x: Math.sin(player.heading), z: Math.cos(player.heading) };
  for (const ped of S.peds) {
    if (ped.down) continue;
    const dx = ped.pos.x - player.pos.x;
    const dz = ped.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    const facing = (dx * f.x + dz * f.z) / (d || 1);
    if (d < 2.3 && facing > 0.4) {
      knockPedDown(ped, 4);
      addHeat(3);
      scarePeds(player.pos.x, player.pos.z, 30);
      return true;
    }
  }
  return false;
}

export function reload() {
  if (S.magazine >= S.magSize || S.reserve <= 0) return false;
  const need = S.magSize - S.magazine;
  const take = Math.min(need, S.reserve);
  S.magazine += take;
  S.reserve -= take;
  S.hooks.onReload?.();
  return true;
}

function updatePickups(dt) {
  const px = S.car ? S.car.group.position.x : player.pos.x;
  const pz = S.car ? S.car.group.position.z : player.pos.z;
  for (const pk of S.pickups) {
    if (pk.taken) {
      if (S.time > pk.respawnAt) {
        pk.taken = false;
        pk.mesh.visible = true;
      }
      continue;
    }
    pk.mesh.rotation.y += dt * 1.6;
    pk.mesh.position.y = 0.8 + Math.sin(S.time * 2 + pk.x) * 0.15;
    const d = Math.hypot(pk.mesh.position.x - px, pk.mesh.position.z - pz);
    if (d < 2.2) {
      pk.taken = true;
      pk.mesh.visible = false;
      pk.respawnAt = S.time + 60;
      if (pk.kind === 'health') {
        S.health = clamp(S.health + 40, 0, S.maxHealth);
        toast('Health +40', 3);
      } else if (pk.kind === 'ammo') {
        S.reserve += 24;
        toast('Ammo +24', 3);
      } else {
        addCash(50);
        toast('Cash +$50', 3);
      }
      S.hooks.onPickup?.();
    }
  }
}

export function updateCombat(dt) {
  shootCooldown = Math.max(0, shootCooldown - dt);
  punchCooldown = Math.max(0, punchCooldown - dt);
  if (S.time > flashUntil) {
    flash.visible = false;
    flashLight.intensity = 0;
  }
  if (S.time > tracerUntil) {
    tracer.visible = false;
  }
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      continue;
    }
    p.vel.y -= 9 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.05) {
      p.mesh.position.y = 0.05;
      p.vel.set(0, 0, 0);
    }
  }
  updatePickups(dt);
}
