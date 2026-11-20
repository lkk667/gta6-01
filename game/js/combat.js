// Solmar City — combat.
// A pistol with a magazine and a reserve, a punch, a reload, and health /
// ammo / cash pickups. A shot is a hitscan ray from the camera through
// the crosshair: a pedestrian in the way falls and drops cash, a car
// throws sparks, the ground kicks up dust. A starburst flash and a tracer
// line sell the shot, and the camera shakes for a beat. Firing a gun — or
// punching someone — in the open is a crime people see: nearby
// pedestrians run and report it, which is how the wanted level climbs.

import * as THREE from '../vendor/three.module.min.js';
import { S, addHeat, clamp, dist2 } from './state.js';
import { aimDirection, muzzleWorldPos } from './player.js';
import { scarePeds, reportCrime } from './traffic.js';

const SHOT_RANGE = 120;
const PUNCH_REACH = 1.9;
const PICKUP_RANGE = 1.7;
const MAX_PARTICLES = 24;

// A small pool of reusable impact particles (boxes), so a shot never
// allocates new meshes in the middle of a frame.
const particlePool = [];

let caster = null;
let shotLine = null;
let lineLife = 0;
let shakeLeft = 0;
let pickups = [];
let scratchDir = null;
let scratchFrom = null;
let scratchAim = null;
let scratchTip = null;

function boxMesh(w, h, d, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color })
  );
} // end of boxMesh()

function addToScene(mesh) {
  S.scene.add(mesh);
} // end of addToScene()

function freeParticle() {
  for (let i = 0; i < particlePool.length; i++) {
    if (!particlePool[i].active) return particlePool[i];
  }
}

function newParticle() {
  const mesh = boxMesh(0.14, 0.14, 0.14, 0xffffff);
  mesh.visible = false;
  addToScene(mesh);
  const p = { mesh, active: false, life: 0, vx: 0, vy: 0, vz: 0 };
  particlePool.push(p);
  return p;
} // end of newParticle()

function spawnParticles(x, y, z, color, count) {
  for (let i = 0; i < count; i++) {
    let p = freeParticle();
    if (!p) {
      if (particlePool.length >= MAX_PARTICLES) return;
      p = newParticle();
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
  for (let i = 0; i < particlePool.length; i++) {
    const p = particlePool[i];
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
  const mesh = boxMesh(0.5, 0.08, 0.3, 0x4ad87a);
  mesh.position.set(x, 0.3, z);
  addToScene(mesh);
  pickups.push({ mesh, kind: 'cash', amount, x, z, respawn: 0 });
} // end of dropCash()

function applyPickup(item) {
  switch (item.kind) {
    case 'health':
      S.health = Math.min(100, S.health + 25);
      break;
    case 'ammo':
      S.reserve += 24;
      break;
    case 'cash':
      S.cash += item.amount || 50;
      break;
  }
  if (S.audio) S.audio.pickup();
  item.mesh.visible = false;
  item.respawn = 25;
}

function collectPickups(dt) {
  if (!S.player) return;
  const px = S.player.pos.x;
  const pz = S.player.pos.z;
  for (let i = 0; i < pickups.length; i++) {
    const item = pickups[i];
    if (!item.mesh.visible) {
      item.respawn -= dt;
      if (item.respawn <= 0) item.mesh.visible = true;
      continue;
    }
    // Bob gently so pickups read as collectibles, not street litter.
    item.mesh.position.y = 0.6 + Math.sin(S.time * 3 + item.x) * 0.12;
    item.mesh.rotation.y += dt * 1.5;
    if (!S.onFoot) continue;
    const d = dist2(px, pz, item.x, item.z);
    if (d > PICKUP_RANGE) continue;
    applyPickup(item);
  }
}

function addPickupSpot(spot) {
  const mesh = boxMesh(0.55, 0.55, 0.55, spot.color);
  mesh.position.set(spot.x, 0.6, spot.z);
  addToScene(mesh);
  pickups.push({ mesh, kind: spot.kind, amount: 0, x: spot.x, z: spot.z, respawn: 0 });
} // end of addPickupSpot()

// True while the player is in the game world on foot, able to use the
// pistol or fists. Used by shoot, punch and reload.
function canUseWeapon() {
  return S.mode === 'playing' && S.onFoot;
} // end of canUseWeapon()

export function buildCombat() {
  caster = new THREE.Raycaster();
  caster.far = SHOT_RANGE;
  scratchDir = new THREE.Vector3();
  scratchFrom = new THREE.Vector3();
  scratchAim = new THREE.Vector3();
  scratchTip = new THREE.Vector3();
  // Tracer: one line, re-aimed on every shot, hidden between shots.
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  shotLine = new THREE.Line(
    lineGeo,
    new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 })
  );
  shotLine.visible = false;
  shotLine.frustumCulled = false;
  S.scene.add(shotLine);
  // Static pickups: health crosses, ammo boxes and cash, spread across
  // the city. Walk over one to take it; it comes back after 25 seconds.
  const spots = [
    { kind: 'health', x: -100, z: 100, color: 0x2aff5a },
    { kind: 'health', x: 60, z: -100, color: 0x2aff5a },
    { kind: 'ammo', x: 20, z: 60, color: 0xe8c84a },
    { kind: 'ammo', x: -80, z: -80, color: 0xe8c84a },
    { kind: 'cash', x: 100, z: 20, color: 0x4ad87a },
    { kind: 'cash', x: -20, z: 140, color: 0x4ad87a },
  ];
  for (const s of spots) addPickupSpot(s);
} // end of buildCombat()

function gatherTargets() {
  const targets = [];
  const pedGroups = new Set();
  const carGroups = new Set();
  const addGroup = (list, set) => {
    for (const entry of list) {
      targets.push(entry.mesh);
      set.add(entry.mesh);
    }
  };
  addGroup(S.peds, pedGroups);
  addGroup(S.cars, carGroups);
  addGroup(S.trafficCars, carGroups);
  addGroup(S.cruisers, carGroups);
  return { targets, pedGroups, carGroups };
} // end of gatherTargets()

export function shoot() {
  if (!canUseWeapon()) return;
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
  shakeLeft = 0.12;
  if (S.audio) S.audio.gunshot();
  // A gunshot in the open is witnessed: anyone close runs and reports it.
  reportCrime(S.player.pos.x, S.player.pos.z, 25);

  // Raycast from the camera through the crosshair. The camera must be set
  // on the raycaster: car groups hold glow sprites (headlight halos,
  // police light bars), and Three.js refuses to raycast a sprite without
  // one — it logs an error and, in this build, throws reading matrixWorld.
  scratchFrom.copy(S.camera.position);
  scratchAim.copy(aimDirection(scratchDir));
  caster.camera = S.camera;
  caster.set(scratchFrom, scratchAim);
  const { targets, pedGroups, carGroups } = gatherTargets();
  const hits = caster.intersectObjects(targets, true);

  let impactPoint = null;
  if (hits.length > 0) {
    const hit = hits[0];
    impactPoint = hit.point;
    const victim = findOwner(hit.object, pedGroups);
    const victimCar = findOwner(hit.object, carGroups);
    if (victim) {
      // A pedestrian goes down: red burst, nearby peds flee, cash drops.
      spawnParticles(hit.point.x, hit.point.y, hit.point.z, 0xe84a4a, 8);
      scarePeds(hit.point.x, hit.point.z, 14);
      const idx = S.peds.findIndex((p) => p.mesh === victim);
      if (idx >= 0) {
        const fallen = S.peds[idx];
        S.scene.remove(fallen.mesh);
        S.peds.splice(idx, 1);
        dropCash(fallen.mesh.position.x, fallen.mesh.position.z, 25);
      }
    } else if (victimCar) {
      // Cars shrug off pistol fire: gold sparks, no damage model.
      spawnParticles(hit.point.x, hit.point.y, hit.point.z, 0xffd94a, 6);
      addHeat(1);
    } else {
      spawnParticles(hit.point.x, hit.point.y, hit.point.z, 0x9a9a9a, 4);
    }
  } else {
    // No solid hit: the round ends at the ground plane or at max range.
    impactPoint = scratchFrom.clone().addScaledVector(scratchAim, SHOT_RANGE);
    if (scratchAim.y < -0.02) {
      const t = -scratchFrom.y / scratchAim.y;
      if (t > 0 && t < SHOT_RANGE) {
        impactPoint = scratchFrom.clone().addScaledVector(scratchAim, t);
        spawnParticles(impactPoint.x, 0.15, impactPoint.z, 0x9a9a9a, 4);
      }
    }
  }
  // Tracer from the muzzle to the impact point.
  muzzleWorldPos(scratchTip);
  const pos = shotLine.geometry.attributes.position;
  pos.setXYZ(0, scratchTip.x, scratchTip.y, scratchTip.z);
  pos.setXYZ(1, impactPoint.x, impactPoint.y, impactPoint.z);
  pos.needsUpdate = true;
  shotLine.visible = true;
  lineLife = 0.06;
}

export function punch() {
  if (!canUseWeapon() || !S.player) return;
  if (S.player.punchTimer > 0) return;
  S.player.punchTimer = 0.45;
  if (S.audio) S.audio.punch();
  // Find a pedestrian in front, within arm's reach.
  const heroX = S.player.pos.x;
  const heroZ = S.player.pos.z;
  const fx = Math.sin(S.player.heading);
  const fz = Math.cos(S.player.heading);
  for (let i = S.peds.length - 1; i >= 0; i--) {
    const ped = S.peds[i];
    const dx = ped.mesh.position.x - heroX;
    const dz = ped.mesh.position.z - heroZ;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > PUNCH_REACH) continue;
    if (d > 0.01 && (dx * fx + dz * fz) / d < 0.5) continue; // behind us
    spawnParticles(ped.mesh.position.x, 1.2, ped.mesh.position.z, 0xe84a4a, 6);
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
  if (!canUseWeapon()) return;
  if (S.magazine >= S.magSize || S.reserve <= 0) return;
  const need = S.magSize - S.magazine;
  const take = Math.min(need, S.reserve);
  S.magazine += take;
  S.reserve -= take;
  if (S.audio) S.audio.blip(440, 0.1, 'sine', 0.3);
} // end of reload()

export function updateCombat(dt) {
  // Muzzle flash decay. During a staged shot the harness asks the flash
  // to be held open (holdFlash), so the starburst stays lit for the
  // camera instead of fading in a single frame.
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
  if (lineLife > 0) {
    lineLife -= dt;
    if (lineLife <= 0) shotLine.visible = false;
  }
  // Camera shake: applied after updateCamera, so the next frame's
  // updateCamera resets it — the shake lasts exactly one frame per tick.
  if (shakeLeft > 0 && S.camera) {
    shakeLeft -= dt;
    const mag = 0.06 * Math.max(0, shakeLeft / 0.12);
    S.camera.position.x += (Math.random() - 0.5) * mag;
    S.camera.position.y += (Math.random() - 0.5) * mag;
  }
  stepParticles(dt);
  collectPickups(dt);
}
