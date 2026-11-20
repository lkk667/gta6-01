// Solmar City — combat.
// Pistol with magazine + reserve ammo, punch, reload, and health / ammo /
// cash pickups. Shooting is a hitscan ray from the camera through the
// crosshair: pedestrians fall and drop cash, cars spark, the ground kicks
// up debris. A starburst flash and a tracer line sell the shot, and a
// short camera shake follows it. Shooting raises wanted heat.

import * as THREE from '../vendor/three.module.min.js';
import { S, addHeat, clamp, dist2 } from './state.js';
import { aimDirection, muzzleWorldPos } from './player.js';
import { scarePeds } from './traffic.js';

const RAY_RANGE = 120;
const PUNCH_RANGE = 1.9;
const PICKUP_RADIUS = 1.7;

let raycaster = null;
let tracer = null;
let tracerTimer = 0;
let shakeT = 0;
let pickups = [];
let tmpVec = null;
let tmpOrigin = null;
let tmpDir = null;
let tmpMuzzle = null;

// A small pool of reusable impact particles (boxes) so a shot never
// allocates new meshes mid-frame.
const PARTICLES = [];
function spawnBurst(x, y, z, color, count) {
  for (let i = 0; i < count; i++) {
    let p = PARTICLES.find((q) => !q.active);
    if (!p) {
      if (PARTICLES.length >= 24) return;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.14, 0.14),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      mesh.visible = false;
      S.scene.add(mesh);
      p = { mesh, active: false, life: 0, vx: 0, vy: 0, vz: 0 };
      PARTICLES.push(p);
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

function updateParticles(dt) {
  for (const p of PARTICLES) {
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

// Walk up from a raycast hit to the ped / car group that owns the mesh.
function ownerOf(obj, groups) {
  let o = obj;
  while (o) {
    if (groups.has(o)) return o;
    o = o.parent;
  }
  return null;
}

function dropCashPickup(x, z, amount) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.08, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x4ad87a })
  );
  mesh.position.set(x, 0.3, z);
  S.scene.add(mesh);
  pickups.push({ mesh, kind: 'cash', amount, x, z, respawn: 0 });
}

export function buildCombat() {
  raycaster = new THREE.Raycaster();
  raycaster.far = RAY_RANGE;
  tmpVec = new THREE.Vector3();
  tmpOrigin = new THREE.Vector3();
  tmpDir = new THREE.Vector3();
  tmpMuzzle = new THREE.Vector3();
  // Tracer: one line, re-aimed every shot, hidden between shots.
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
  tracer.visible = false;
  tracer.frustumCulled = false;
  S.scene.add(tracer);
  // Static pickups: health crosses, ammo boxes and cash, spread across
  // the city. Walking over one applies it; it comes back after 25 s.
  const spots = [
    { kind: 'health', x: -100, z: 100, color: 0x2aff5a },
    { kind: 'health', x: 60, z: -100, color: 0x2aff5a },
    { kind: 'ammo', x: 20, z: 60, color: 0xe8c84a },
    { kind: 'ammo', x: -80, z: -80, color: 0xe8c84a },
    { kind: 'cash', x: 100, z: 20, color: 0x4ad87a },
    { kind: 'cash', x: -20, z: 140, color: 0x4ad87a },
  ];
  for (const s of spots) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.55, 0.55),
      new THREE.MeshBasicMaterial({ color: s.color })
    );
    mesh.position.set(s.x, 0.6, s.z);
    S.scene.add(mesh);
    pickups.push({ mesh, kind: s.kind, amount: 0, x: s.x, z: s.z, respawn: 0 });
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
  // Muzzle flash: starburst + light, held open briefly by updateCombat.
  S.player.flashMat.opacity = 0.95;
  S.player.flashLight.intensity = 10;
  S.player.flashTimer = 0.06;
  shakeT = 0.12;
  if (S.audio) S.audio.gunshot();

  // Raycast from the camera through the crosshair. The camera must be set
  // on the raycaster: the car groups contain glow sprites (headlight halos,
  // police light bars), and Three.js refuses to raycast a sprite without
  // one — it logs an error and, in this build, throws reading matrixWorld.
  tmpOrigin.copy(S.camera.position);
  tmpDir.copy(aimDirection(tmpVec));
  raycaster.camera = S.camera;
  raycaster.set(tmpOrigin, tmpDir);
  const targets = [];
  const pedGroups = new Set();
  const carGroups = new Set();
  for (const p of S.peds) { targets.push(p.mesh); pedGroups.add(p.mesh); }
  for (const c of S.cars) { targets.push(c.mesh); carGroups.add(c.mesh); }
  for (const t of S.trafficCars) { targets.push(t.mesh); carGroups.add(t.mesh); }
  for (const c of S.cruisers) { targets.push(c.mesh); carGroups.add(c.mesh); }
  const hits = raycaster.intersectObjects(targets, true);

  let endPoint = null;
  if (hits.length > 0) {
    const hit = hits[0];
    endPoint = hit.point;
    const pedGroup = ownerOf(hit.object, pedGroups);
    const carGroup = ownerOf(hit.object, carGroups);
    if (pedGroup) {
      // A pedestrian goes down: red burst, nearby peds flee, cash drops.
      spawnBurst(hit.point.x, hit.point.y, hit.point.z, 0xe84a4a, 8);
      scarePeds(hit.point.x, hit.point.z, 14);
      const idx = S.peds.findIndex((p) => p.mesh === pedGroup);
      if (idx >= 0) {
        const gone = S.peds[idx];
        S.scene.remove(gone.mesh);
        S.peds.splice(idx, 1);
        dropCashPickup(gone.mesh.position.x, gone.mesh.position.z, 25);
      }
    } else if (carGroup) {
      // Cars shrug off pistol fire: gold sparks, no damage model.
      spawnBurst(hit.point.x, hit.point.y, hit.point.z, 0xffd94a, 6);
      addHeat(1);
    } else {
      spawnBurst(hit.point.x, hit.point.y, hit.point.z, 0x9a9a9a, 4);
    }
  } else {
    // No solid hit: the round ends at the ground plane or at max range.
    endPoint = tmpOrigin.clone().addScaledVector(tmpDir, RAY_RANGE);
    if (tmpDir.y < -0.02) {
      const t = -tmpOrigin.y / tmpDir.y;
      if (t > 0 && t < RAY_RANGE) {
        endPoint = tmpOrigin.clone().addScaledVector(tmpDir, t);
        spawnBurst(endPoint.x, 0.15, endPoint.z, 0x9a9a9a, 4);
      }
    }
  }
  // Tracer from the muzzle to the impact point.
  muzzleWorldPos(tmpMuzzle);
  const pos = tracer.geometry.attributes.position;
  pos.setXYZ(0, tmpMuzzle.x, tmpMuzzle.y, tmpMuzzle.z);
  pos.setXYZ(1, endPoint.x, endPoint.y, endPoint.z);
  pos.needsUpdate = true;
  tracer.visible = true;
  tracerTimer = 0.06;
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
    if (d > PUNCH_RANGE) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < 0.5) continue; // behind us
    spawnBurst(ped.mesh.position.x, 1.2, ped.mesh.position.z, 0xe84a4a, 6);
    scarePeds(ped.mesh.position.x, ped.mesh.position.z, 12);
    S.scene.remove(ped.mesh);
    S.peds.splice(i, 1);
    dropCashPickup(ped.mesh.position.x, ped.mesh.position.z, 25);
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
  for (const pk of pickups) {
    if (!pk.mesh.visible) {
      pk.respawn -= dt;
      if (pk.respawn <= 0) pk.mesh.visible = true;
      continue;
    }
    // Bob gently so pickups read as collectibles, not street litter.
    pk.mesh.position.y = 0.6 + Math.sin(S.time * 3 + pk.x) * 0.12;
    pk.mesh.rotation.y += dt * 1.5;
    if (!S.onFoot) continue;
    const d2 = dist2(px, pz, pk.x, pk.z);
    if (d2 > PICKUP_RADIUS) continue;
    if (pk.kind === 'health') {
      S.health = Math.min(100, S.health + 25);
    } else if (pk.kind === 'ammo') {
      S.reserve += 24;
    } else if (pk.kind === 'cash') {
      S.cash += pk.amount || 50;
    }
    if (S.audio) S.audio.pickup();
    pk.mesh.visible = false;
    pk.respawn = 25;
  }
}

export function updateCombat(dt) {
  // Muzzle flash decay. During a staged shot the harness asks the flash
  // to be held open (holdFlash), so the starburst stays lit for the camera
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
  if (tracerTimer > 0) {
    tracerTimer -= dt;
    if (tracerTimer <= 0) tracer.visible = false;
  }
  // Camera shake: applied after updateCamera, so the next frame's
  // updateCamera resets it — the shake lasts exactly one frame per tick.
  if (shakeT > 0 && S.camera) {
    shakeT -= dt;
    const mag = 0.06 * Math.max(0, shakeT / 0.12);
    S.camera.position.x += (Math.random() - 0.5) * mag;
    S.camera.position.y += (Math.random() - 0.5) * mag;
  }
  updateParticles(dt);
  updatePickups(dt);
}
