// Solmar City — combat: pistol, punch, pickups (v4 polish, re-implemented).
// The muzzle flash lives on the gun mesh itself (player.js), so the flash
// can never sit apart from the barrel the way a camera-relative flash did.

import * as THREE from '../vendor/three.module.min.js';
import { S, addHeat, dist2, clamp } from './state.js';
import { aimDirection, muzzleWorldPos } from './player.js';
import { scarePeds } from './traffic.js';

let tracer = null;
let tracerTimer = 0;
let shakeTimer = 0;
let smokeHoldTimer = 0;
const particles = [];
const smokePuffs = [];
let smokeTex = null;

function getSmokeTex() {
  if (smokeTex) return smokeTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  const stops = [[0, 'rgba(200,200,200,0.55)'], [0.6, 'rgba(180,180,180,0.25)'], [1, 'rgba(180,180,180,0)']];
  for (const [pos, col] of stops) grad.addColorStop(pos, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}

function spawnSmoke(pos) {
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.SpriteMaterial({ map: getSmokeTex(), transparent: true, depthWrite: false, opacity: 0.6 });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(pos);
    sp.position.x += (Math.random() - 0.5) * 0.3;
    sp.position.y += (Math.random() - 0.5) * 0.2;
    sp.scale.set(0.7, 0.7, 1);
    S.scene.add(sp);
    smokePuffs.push({ sprite: sp, life: 0.7, max: 0.7, vy: 0.9 + Math.random() * 0.5 });
  }
}

export function buildCombat() {
  // One reusable tracer line, hidden until a shot is fired.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }));
  S.scene.add(tracer);
  spawnPickups();
}

function spawnPickups() {
  const spots = [
    { kind: 'health', x: 20, z: -20 }, { kind: 'ammo', x: -20, z: 20 },
    { kind: 'cash', x: 60, z: -60 }, { kind: 'health', x: -100, z: 40 },
    { kind: 'ammo', x: 100, z: 80 }, { kind: 'cash', x: -60, z: -100 },
  ];
  for (const s of spots) {
    const color = s.kind === 'health' ? 0x4ad87a : s.kind === 'ammo' ? 0xe8d84a : 0x7ad8ff;
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(s.x, 1, s.z);
    S.scene.add(mesh);
    S.pickups.push({ kind: s.kind, mesh, taken: false, spin: 0 });
  }
}

function burstParticles(pos, color, count) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ color })
    );
    m.position.copy(pos);
    S.scene.add(m);
    particles.push({
      mesh: m,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 4,
      vz: (Math.random() - 0.5) * 6,
      life: 0.5,
    });
  }
}

export function shoot() {
  const p = S.player;
  if (!p || S.mode !== 'playing' || !S.onFoot) return false;
  if (p.weapon !== 'pistol') return false;
  if (S.magazine <= 0) {
    if (S.audio) S.audio.click();
    return false;
  }
  S.magazine--;
  p.flashTimer = 0.09;
  if (S.debug.holdFlash) {
    p.flashMat.opacity = 0.95;
    p.flashLight.intensity = 10;
  }
  shakeTimer = 0.12;
  addHeat(6);
  const from = muzzleWorldPos(new THREE.Vector3());
  // A little grey smoke at the muzzle that drifts up and fades — the flash
  // is a star at the barrel, the smoke is the only thing that lingers.
  spawnSmoke(from);
  const dir = aimDirection();
  // Raycast against cars, cruisers, peds and buildings.
  const ray = new THREE.Raycaster(from, dir);
  ray.far = 120;
  ray.camera = S.camera; // sprites (police light-bar glows) need a camera to raycast
  const targets = [];
  for (const c of [...S.cars, ...S.trafficCars]) targets.push(c.mesh);
  for (const c of S.cruisers) targets.push(c.mesh);
  for (const ped of S.peds) targets.push(ped.mesh);
  const hits = ray.intersectObjects(targets, true);
  let end = from.clone().add(dir.clone().multiplyScalar(90));
  if (hits.length > 0) {
    const hit = hits[0];
    end = hit.point.clone();
    // Walk up to the car/ped root to decide the impact effect.
    let root = hit.object;
    while (root.parent && root.parent !== S.scene) root = root.parent;
    const isPed = S.peds.some((pd) => pd.mesh === root);
    const isCruiser = S.cruisers.some((cr) => cr.mesh === root);
    burstParticles(end, isPed ? 0xd84a4a : isCruiser ? 0xffd94a : 0x9a9a9a, 8);
    if (isPed) {
      const ped = S.peds.find((pd) => pd.mesh === root);
      ped.fleeTimer = 3;
      ped.stumble = 0.5;
      addHeat(4);
    }
  }
  // Tracer from the muzzle to the hit point.
  const pos = tracer.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, end.x, end.y, end.z);
  pos.needsUpdate = true;
  tracer.material.opacity = 0.9;
  tracerTimer = 0.08;
  scarePeds(p.pos.x, p.pos.z, 26);
  if (S.audio) S.audio.gunshot();
  return true;
}

export function punch() {
  const p = S.player;
  if (!p || S.mode !== 'playing' || !S.onFoot) return;
  p.punchTimer = 0.28;
  if (S.audio) S.audio.punch();
  // Shove the nearest pedestrian.
  let best = null;
  let bestD = 2.2;
  for (const ped of S.peds) {
    const d = dist2(p.pos.x, p.pos.z, ped.mesh.position.x, ped.mesh.position.z);
    if (d < bestD) {
      bestD = d;
      best = ped;
    }
  }
  if (best) {
    best.fleeTimer = 2;
    best.stumble = 0.5;
    addHeat(3);
  }
}

export function reload() {
  if (S.magazine >= S.magSize || S.reserve <= 0) return;
  const need = S.magSize - S.magazine;
  const take = Math.min(need, S.reserve);
  S.magazine += take;
  S.reserve -= take;
  if (S.audio) S.audio.reload();
}

export function updateCombat(dt) {
  if (tracerTimer > 0) {
    tracerTimer -= dt;
    if (tracerTimer <= 0) tracer.material.opacity = 0;
  }
  if (shakeTimer > 0) {
    shakeTimer -= dt;
    const s = 0.06;
    S.camera.position.x += (Math.random() - 0.5) * s;
    S.camera.position.y += (Math.random() - 0.5) * s;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.life -= dt;
    if (pt.life <= 0) {
      S.scene.remove(pt.mesh);
      particles.splice(i, 1);
      continue;
    }
    pt.mesh.position.x += pt.vx * dt;
    pt.mesh.position.y += pt.vy * dt;
    pt.mesh.position.z += pt.vz * dt;
    pt.vy -= 9 * dt;
  }
  // Smoke puffs rise, grow and fade out.
  for (let i = smokePuffs.length - 1; i >= 0; i--) {
    const sm = smokePuffs[i];
    sm.life -= dt;
    if (sm.life <= 0) {
      S.scene.remove(sm.sprite);
      smokePuffs.splice(i, 1);
      continue;
    }
    sm.sprite.position.y += sm.vy * dt;
    const grow = 1 + (1 - sm.life / sm.max) * 1.6;
    sm.sprite.scale.set(0.7 * grow, 0.7 * grow, 1);
    sm.sprite.material.opacity = 0.6 * (sm.life / sm.max);
  }
  // Staged shot: while the flash is held open, keep a wisp of smoke
  // curling off the muzzle so the shot reads as a fresh gunshot.
  if (S.debug.holdFlash && S.player) {
    smokeHoldTimer -= dt;
    if (smokeHoldTimer <= 0) {
      smokeHoldTimer = 0.35;
      spawnSmoke(muzzleWorldPos(new THREE.Vector3()));
    }
  }
  // Pickups: spin, bob, collect on touch.
  const p = S.player;
  for (const pk of S.pickups) {
    if (pk.taken) continue;
    pk.spin += dt * 2;
    pk.mesh.rotation.y = pk.spin;
    pk.mesh.position.y = 1 + Math.sin(pk.spin * 1.4) * 0.15;
    if (p && dist2(p.pos.x, p.pos.z, pk.mesh.position.x, pk.mesh.position.z) < 1.6) {
      pk.taken = true;
      pk.mesh.visible = false;
      if (pk.kind === 'health') {
        S.health = clamp(S.health + 40, 0, S.maxHealth);
        if (S.audio) S.audio.pickup();
      } else if (pk.kind === 'ammo') {
        S.reserve += 24;
        if (S.audio) S.audio.pickup();
      } else {
        S.cash += 50;
        if (S.audio) S.audio.pickup();
      }
    }
  }
}
