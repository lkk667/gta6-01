// Solmar City — combat.
// A pistol with a magazine and a reserve, a punch, a reload, and health /
// ammo / cash pickups. A shot is a hitscan ray from the camera through the
// crosshair: a pedestrian in the way falls and drops cash, a car throws
// sparks, the ground kicks up dust. A starburst flash and a tracer line
// sell the shot, and the camera shakes for a beat. Firing a gun — or
// punching someone — in the open is a crime people see: nearby pedestrians
// run and report it, which is how the wanted level climbs.

import * as THREE from '../vendor/three.module.min.js';
import { S, addHeat, clamp, dist2 } from './state.js';
import { aimDirection, muzzleWorldPos } from './player.js';
import { scarePeds, reportCrime } from './traffic.js';

const SHOT_RANGE = 120;
const PUNCH_REACH = 1.9;
const PICKUP_RANGE = 1.7;

let ray = null;
let tracer = null;
let tracerLife = 0;
let shakeTime = 0;
let pickupList = [];
let tmpA = null;
let tmpFrom = null;
let tmpAim = null;
let tmpTip = null;

// A small pool of reusable impact particles (boxes) so a shot never
// allocates new meshes in the middle of a frame.
const particlePool = [];
function burstParticles(x, y, z, color, count) {
  for (let i = 0; i < count; i++) {
    let p = particlePool.find((q) => !q.active);
    if (!p) {
      if (particlePool.length >= 24) return;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.14, 0.14),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      mesh.visible = false;
      S.scene.add(mesh);
      p = { mesh, active: false, life: 0, vx: 0, vy: 0, vz: 0 };
      particlePool.push(p);
    }
    p.mesh.material.color.setHex(color);
    p.mesh.position.set(x, y, z);
    p.mesh.visible = true;
    p.vx = (Math.random() - 0.5) * 6;
    p.vy = Math.random() * 4 + 1;
    p.vz = (Math.random() - 0.5) * 6;
    p.life = 0.45 + Math.random() * 0.2;
    p.active = true;
  }
}

function stepParticles(dt) {
  for (const p of particlePool) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      p.mesh.visible = false;
      continue;
    }
    p.vy -= 12 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    if (p.mesh.position.y < 0.05) p.mesh.position.y = 0.05;
  }
}

// Walk up from a raycast hit to the pedestrian or car group that owns it.
function findOwner(obj, groups) {
  let o = obj;
  while (o) {
    if (groups.has(o)) return o;
    o = o.parent;
  }
  return null;
}

function dropCash(x, z, amount) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.08, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x4ad87a })
  );
  mesh.position.set(x, 0.3, z);
  S.scene.add(mesh);
  pickupList.push({ mesh, kind: 'cash', amount, x, z, respawn: 0 });
}

export function buildCombat() {
  ray = new THREE.Raycaster();
  ray.far = SHOT_RANGE;
  tmpA = new THREE.Vector3();
  tmpFrom = new THREE.Vector3();
  tmpAim = new THREE.Vector3();
  tmpTip = new THREE.Vector3();
  // Tracer: a single line, re-aimed on every shot, hidden between shots.
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
  tracer.visible = false;
  tracer.frustumCulled = false;
  S.scene.add(tracer);
  // Static pickups: health crosses, ammo boxes and cash, spread across the
  // city. Walk over one to take it; it comes back after 25 seconds.
  const pickupSpots = [
    { kind: 'health', x: -100, z: 100, color: 0x2aff5a },
    { kind: 'health', x: 60, z: -100, color: 0x2aff5a },
    { kind: 'ammo', x: 20, z: 60, color: 0xe8c84a },
    { kind: 'ammo', x: -80, z: -80, color: 0xe8c84a },
    { kind: 'cash', x: 100, z: 20, color: 0x4ad87a },
    { kind: 'cash', x: -20, z: 140, color: 0x4ad87a },
  ];
  for (const s of pickupSpots) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.55, 0.55),
      new THREE.MeshBasicMaterial({ color: s.color })
    );
    mesh.position.set(s.x, 0.6, s.z);
    S.scene.add(mesh);
    pickupList.push({ mesh, kind: s.kind, amount: 0, x: s.x, z: s.z, respawn: 0 });
  }
}

export function shoot() {
  if (S.mode !== 'playing' || !S.onFoot) return;
  if (!S.player || S.player.weapon !== 'pistol') return;
  if (S.magazine <= 0) {
    if (S.audio) S.audio.blip(180, 0.06, 'square', 0.25);
    return;
  }
  S.magazine -= 1;
  addHeat(2);
  // Muzzle flash: starburst plus light, held open briefly by updateCombat.
  S.player.flashMat.opacity = 0.95;
  S.player.flashLight.intensity = 10;
  S.player.flashTimer = 0.06;
  shakeTime = 0.12;
  if (S.audio) S.audio.gunshot();
  // A gunshot in the open is witnessed: anyone close runs and reports it.
  reportCrime(S.player.pos.x, S.player.pos.z, 25);

  // Raycast from the camera through the crosshair. The camera must be set
  // on the raycaster: car groups hold glow sprites (headlight halos,
  // police light bars), and Three.js refuses to raycast a sprite without
  // one — it logs an error and, in this build, throws reading matrixWorld.
  tmpFrom.copy(S.camera.position);
  tmpAim.copy(aimDirection(tmpA));
  ray.camera = S.camera;
  ray.set(tmpFrom, tmpAim);
  const targets = [];
  const pedGroups = new Set();
  const carGroups = new Set();
  for (const p of S.peds) { targets.push(p.mesh); pedGroups.add(p.mesh); }
  for (const c of S.cars) { targets.push(c.mesh); carGroups.add(c.mesh); }
  for (const t of S.trafficCars) { targets.push(t.mesh); carGroups.add(t.mesh); }
  for (const c of S.cruisers) { targets.push(c.mesh); carGroups.add(c.mesh); }
  const hits = ray.intersectObjects(targets, true);

  let impactPoint = null;
  if (hits.length > 0) {
    const hit = hits[0];
    impactPoint = hit.point;
    const pedOwner = findOwner(hit.object, pedGroups);
    const carOwner = findOwner(hit.object, carGroups);
    if (pedOwner) {
      // A pedestrian goes down: red burst, nearby peds flee, cash drops.
      burstParticles(hit.point.x, hit.point.y, hit.point.z, 0xe84a4a, 8);
      scarePeds(hit.point.x, hit.point.z, 14);
      const idx = S.peds.findIndex((p) => p.mesh === pedOwner);
      if (idx >= 0) {
        const fallen = S.peds[idx];
        S.scene.remove(fallen.mesh);
        S.peds.splice(idx, 1);
        dropCash(fallen.mesh.position.x, fallen.mesh.position.z, 25);
      }
    } else if (carOwner) {
      // Cars shrug off pistol fire: gold sparks, no damage model.
      burstParticles(hit.point.x, hit.point.y, hit.point.z, 0xffd94a, 6);
      addHeat(1);
    } else {
      burstParticles(hit.point.x, hit.point.y, hit.point.z, 0x9a9a9a, 4);
    }
  } else {
    // No solid hit: the round ends at the ground plane or at max range.
    impactPoint = tmpFrom.clone().addScaledVector(tmpAim, SHOT_RANGE);
    if (tmpAim.y < -0.02) {
      const t = -tmpFrom.y / tmpAim.y;
      if (t > 0 && t < SHOT_RANGE) {
        impactPoint = tmpFrom.clone().addScaledVector(tmpAim, t);
        burstParticles(impactPoint.x, 0.15, impactPoint.z, 0x9a9a9a, 4);
      }
    }
  }
  // Tracer from the muzzle to the impact point.
  muzzleWorldPos(tmpTip);
  const pos = tracer.geometry.attributes.position;
  pos.setXYZ(0, tmpTip.x, tmpTip.y, tmpTip.z);
  pos.setXYZ(1, impactPoint.x, impactPoint.y, impactPoint.z);
  pos.needsUpdate = true;
  tracer.visible = true;
  tracerLife = 0.06;
}

export function punch() {
  if (S.mode !== 'playing' || !S.onFoot || !S.player) return;
  if (S.player.punchTimer > 0) return;
  S.player.punchTimer = 0.45;
  if (S.audio) S.audio.punch();
  // Find a pedestrian in front, within arm's reach.
  const px = S.player.pos.x;
  const pz = S.player.pos.z;
  const fx = Math.sin(S.player.heading);
  const fz = Math.cos(S.player.heading);
  for (let i = S.peds.length - 1; i >= 0; i--) {
    const ped = S.peds[i];
    const dx = ped.mesh.position.x - px;
    const dz = ped.mesh.position.z - pz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > PUNCH_REACH) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < 0.5) continue; // behind us
    burstParticles(ped.mesh.position.x, 1.2, ped.mesh.position.z, 0xe84a4a, 6);
    scarePeds(ped.mesh.position.x, ped.mesh.position.z, 12);
    // A punch in the open is witnessed too, at close range.
    reportCrime(ped.mesh.position.x, ped.mesh.position.z, 12);
    S.scene.remove(ped.mesh);
    S.peds.splice(i, 1);
    dropCash(ped.mesh.position.x, ped.mesh.position.z, 25);
    addHeat(2);
    break; // one punch, one pedestrian
  }
}

export function reload() {
  if (S.mode !== 'playing' || !S.onFoot) return;
  if (S.magazine >= S.magSize || S.reserve <= 0) return;
  const need = S.magSize - S.magazine;
  const take = Math.min(need, S.reserve);
  S.magazine += take;
  S.reserve -= take;
  if (S.audio) S.audio.blip(440, 0.1, 'sine', 0.3);
}

function updatePickups(dt) {
  if (!S.player) return;
  const px = S.player.pos.x;
  const pz = S.player.pos.z;
  for (const item of pickupList) {
    if (!item.mesh.visible) {
      item.respawn -= dt;
      if (item.respawn <= 0) item.mesh.visible = true;
      continue;
    }
    // Bob gently so pickups read as collectibles, not street litter.
    item.mesh.position.y = 0.6 + Math.sin(S.time * 3 + item.x) * 0.12;
    item.mesh.rotation.y += dt * 1.5;
    if (!S.onFoot) continue;
    const d2 = dist2(px, pz, item.x, item.z);
    if (d2 > PICKUP_RANGE) continue;
    if (item.kind === 'health') {
      S.health = Math.min(100, S.health + 25);
    } else if (item.kind === 'ammo') {
      S.reserve += 24;
    } else if (item.kind === 'cash') {
      S.cash += item.amount || 50;
    }
    if (S.audio) S.audio.pickup();
    item.mesh.visible = false;
    item.respawn = 25;
  }
}

export function updateCombat(dt) {
  // Muzzle flash decay. During a staged shot the harness asks the flash to
  // be held open (holdFlash), so the starburst stays lit for the camera
  // instead of fading in a single frame.
  if (S.player) {
    if (S.player.flashTimer > 0 && !S.debug.holdFlash) {
      S.player.flashTimer -= dt;
      if (S.player.flashTimer <= 0) {
        S.player.flashMat.opacity = 0;
        S.player.flashLight.intensity = 0;
      }
    }
    // The gun is only in hand on foot with the pistol selected.
    if (S.player.gun) {
      S.player.gun.visible = S.onFoot && S.player.weapon === 'pistol';
    }
  }
  // Tracer fade.
  if (tracerLife > 0) {
    tracerLife -= dt;
    if (tracerLife <= 0) tracer.visible = false;
  }
  // Camera shake: applied after updateCamera, so the next frame's
  // updateCamera resets it — the shake lasts exactly one frame per tick.
  if (shakeTime > 0 && S.camera) {
    shakeTime -= dt;
    const mag = 0.06 * Math.max(0, shakeTime / 0.12);
    S.camera.position.x += (Math.random() - 0.5) * mag;
    S.camera.position.y += (Math.random() - 0.5) * mag;
  }
  stepParticles(dt);
  updatePickups(dt);
}
