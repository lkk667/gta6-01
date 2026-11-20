// Solmar City — the wanted level, police cruisers, BUSTED.
// Cruisers run faster than the player now (32 + 1.5 per star, against the
// player's 34), so a chase stays a chase; their light bars flash red and
// blue with glow halos. The officer on the street is shaped to read as a
// person — a tapered uniform, a neck, a head small beside the shoulders —
// with the badge, belt, holster, radio, patch and name tag that mark the
// uniform.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, starsFromHeat, addHeat, dist2, clamp } from './state.js';
import { makeCar } from './vehicles.js';
import { resolveCollisions, attachBlob } from './city.js';

let spawnTimer = 0;

// One place for the light-bar flash state: the lenses, the glow halos,
// and the red/blue pools on the road under the cruiser.
function flashBar(data, isRed) {
  if (!data.redLens) return;
  data.redLens.material.color.set(isRed ? 0xff2a2a : 0x5a1414);
  data.blueLens.material.color.set(isRed ? 0x142a5a : 0x2a6aff);
  data.redGlow.material.opacity = isRed ? 0.95 : 0.12;
  data.blueGlow.material.opacity = isRed ? 0.12 : 0.95;
  if (data.redGround) {
    data.redGround.material.opacity = isRed ? 0.55 : 0.08;
    data.blueGround.material.opacity = isRed ? 0.08 : 0.55;
  }
}

export function wantedStars() {
  return starsFromHeat(S.heat);
}

export function spawnCruiser(nearX, nearZ) {
  const mesh = makeCar(0, true);
  // Spawn about 50 m away, on a road when possible.
  const a = Math.random() * Math.PI * 2;
  let sx = nearX + Math.sin(a) * 50;
  let sz = nearZ + Math.cos(a) * 50;
  sx = clamp(sx, -170, 170);
  sz = clamp(sz, -170, 170);
  mesh.position.set(sx, 0, sz);
  const face = Math.atan2(nearX - sx, nearZ - sz);
  mesh.rotation.y = face;
  S.scene.add(mesh);
  attachBlob(mesh, 4.8, 0.03);
  const cruiser = { mesh, heading: face, speed: 12, targetSpeed: 20, flashPhase: Math.random() * 6 };
  S.cruisers.push(cruiser);
  return cruiser;
}

function removeCruiser(cruiser) {
  S.scene.remove(cruiser.mesh);
  const i = S.cruisers.indexOf(cruiser);
  if (i >= 0) S.cruisers.splice(i, 1);
}

export function updatePolice(dt) {
  const wanted = wantedStars();
  // Heat cools off when the player lies low.
  if (wanted > 0) {
    const moving = S.onFoot ? (S.player && S.player.speed > 1) : !!S.currentCar;
    addHeat(-dt * (moving ? 0.9 : 1.8));
  }
  spawnTimer -= dt;
  const count = wanted === 0 ? 0 : Math.min(wanted + 1, 5);
  if (wanted > 0 && S.cruisers.length < count && spawnTimer <= 0 && !S.debug.pacing && !S.debug.noSpawn) {
    spawnTimer = 1.2;
    spawnCruiser(S.player.pos.x, S.player.pos.z);
  }
  if (wanted === 0 && S.cruisers.length > 0 && Math.random() < dt * 0.3) {
    removeCruiser(S.cruisers[0]);
  }

  const playerX = S.player.pos.x;
  const playerZ = S.player.pos.z;
  const cruiserTop = WORLD.cruiserBaseSpeed + wanted * WORLD.cruiserPerStar;
  for (const c of [...S.cruisers]) {
    const mx = c.mesh.position.x;
    const mz = c.mesh.position.z;
    const d = dist2(mx, mz, playerX, playerZ);
    let steer;
    let goal = cruiserTop;
    if (S.debug.freezePolice) {
      // Staged shot: the cruiser holds its pose (lights still flash below).
      c.mesh.rotation.y = c.heading;
      c.flashPhase += dt * 7;
      flashBar(c.mesh.userData, Math.sin(c.flashPhase) > 0);
      continue;
    }
    if (S.debug.pacing && c.pace && S.currentCar) {
      // Formation pacing (staged chase shot): hold a fixed slot beside the
      // player's car and match its speed instead of converging and ramming.
      const car = S.currentCar;
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const rx = Math.cos(car.heading);
      const rz = -Math.sin(car.heading);
      const tx = car.mesh.position.x + fx * c.pace.fwd + rx * c.pace.side;
      const tz = car.mesh.position.z + fz * c.pace.fwd + rz * c.pace.side;
      steer = Math.atan2(tx - mx, tz - mz);
      // Signed along-track error: positive when behind the slot, negative
      // when ahead of it, so the cruiser speeds up to close a gap and eases
      // off instead of overshooting past the slot.
      const err = (tx - mx) * fx + (tz - mz) * fz;
      goal = Math.max(8, Math.min(42, car.speed + err * 0.8));
    } else {
      // Steer toward the player, with a little weave so cruisers flank.
      steer = Math.atan2(playerX - mx, playerZ - mz) + Math.sin(S.time * 0.7 + c.flashPhase) * 0.25;
      // Slow down right beside an on-foot player so the bust can happen.
      if (S.onFoot && d < 7) goal = 0;
      else if (d < 5) goal = Math.min(goal, 6);
    }
    let turn = steer - c.heading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    c.heading += clamp(turn, -1.6 * dt, 1.6 * dt);
    c.speed += (goal - c.speed) * Math.min(1, dt * 1.6);
    c.mesh.position.x += Math.sin(c.heading) * c.speed * dt;
    c.mesh.position.z += Math.cos(c.heading) * c.speed * dt;
    resolveCollisions(c.mesh.position, 1.9);
    c.mesh.rotation.y = c.heading;
    for (const w of c.mesh.userData.wheels) w.rotation.x += c.speed * dt * 2.4;
    // Ram the player's car on contact (heat only once per 2 s per cruiser).
    // Never while pacing in formation for the staged shot.
    if (S.currentCar && !(S.debug.pacing && c.pace)) {
      const ramDist = dist2(mx, mz, S.currentCar.mesh.position.x, S.currentCar.mesh.position.z);
      if (ramDist < 4.2) {
        S.currentCar.speed *= 0.86;
        if (S.audio) S.audio.crash();
        if (!c.lastRam || S.time - c.lastRam > 2) {
          c.lastRam = S.time;
          addHeat(1.5);
        }
      }
    }
    // Flashing light bar: alternate red / blue, glow sprites pulse with it,
    // and the red/blue ground reflections under the cruiser pulse too.
    c.flashPhase += dt * 7;
    flashBar(c.mesh.userData, Math.sin(c.flashPhase) > 0);
    if (S.audio && d < 60) S.audio.siren(d);
  }

  // BUSTED: cornered on foot at high stars.
  if (S.onFoot && wanted >= 3 && S.mode === 'playing') {
    let cornered = false;
    for (const c of S.cruisers) {
      if (dist2(c.mesh.position.x, c.mesh.position.z, playerX, playerZ) < 6 && c.speed < 2) cornered = true;
    }
    if (cornered) {
      S.bustTimer += dt;
      if (S.bustTimer > 2.5) triggerBusted();
    } else {
      S.bustTimer = Math.max(0, S.bustTimer - dt * 2);
    }
  } else {
    S.bustTimer = 0;
  }
}

export function triggerBusted() {
  S.mode = 'busted';
  S.bustedAt = S.time;
  S.heat = 0;
  S.bustTimer = 0;
  for (const c of [...S.cruisers]) removeCruiser(c);
  if (S.currentCar) {
    S.currentCar.driver = null;
    S.currentCar = null;
  }
  S.onFoot = true;
  const player = S.player;
  player.group.visible = true;
  // Respawn at Solmar General hospital.
  player.pos.x = 120;
  player.pos.z = -28;
  player.group.position.set(120, 0, -28);
  player.heading = Math.PI;
  player.speed = 0;
  S.health = 100;
  if (S.audio) S.audio.busted();
}

// A standing police officer figure (dark blue, cap) for the street scene.
export function makeOfficer(x, z, heading) {
  const officer = new THREE.Group();
  const uniform = new THREE.MeshLambertMaterial({ color: 0x1c2a4a });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  // Tapered uniform: chest wider than the waist, shoulder bar on top,
  // neck, and a head that is small next to the shoulders.
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.28), uniform);
  chest.position.y = 1.22;
  officer.add(chest);
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.24), uniform);
  waist.position.y = 0.86;
  officer.add(waist);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), uniform);
  shoulders.position.y = 1.42;
  officer.add(shoulders);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 8), skinMat);
  neck.position.y = 1.5;
  officer.add(neck);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skinMat);
  face.position.y = 1.66;
  officer.add(face);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.23, 0.1, 10), uniform);
  cap.position.y = 1.84;
  officer.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.22), uniform);
  brim.position.set(0, 1.8, 0.24);
  officer.add(brim);
  // Two slim legs with a gap, pivoting at the hip.
  const legGeo = new THREE.BoxGeometry(0.17, 0.72, 0.19);
  legGeo.translate(0, -0.36, 0);
  const leftLeg = new THREE.Mesh(legGeo, uniform);
  leftLeg.position.set(-0.12, 0.72, 0);
  officer.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.12;
  officer.add(rightLeg);
  // Arms at the sides, one hand resting on the holster.
  const armGeo = new THREE.BoxGeometry(0.14, 0.6, 0.16);
  armGeo.translate(0, -0.3, 0);
  const leftArm = new THREE.Mesh(armGeo, uniform);
  leftArm.position.set(-0.32, 1.38, 0);
  officer.add(leftArm);
  const rightArm = leftArm.clone();
  rightArm.position.x = 0.32;
  rightArm.rotation.x = -0.5;
  officer.add(rightArm);
  // Badge: small gold square on the chest.
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffd94a }));
  badge.position.set(-0.12, 1.24, 0.15);
  officer.add(badge);
  // Uniform details: duty belt, holster, shoulder radio, light-blue
  // shoulder patch, name tag.
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.3), new THREE.MeshLambertMaterial({ color: 0x14161a }));
  belt.position.y = 0.76;
  officer.add(belt);
  const holster = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.14), new THREE.MeshLambertMaterial({ color: 0x1c1e22 }));
  holster.position.set(0.26, 0.64, 0.1);
  officer.add(holster);
  const radio = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.06), new THREE.MeshLambertMaterial({ color: 0x22242a }));
  radio.position.set(-0.27, 1.3, 0.12);
  officer.add(radio);
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.1), new THREE.MeshBasicMaterial({ color: 0x7ab8e8 }));
  patch.position.set(-0.27, 1.36, 0.05);
  patch.rotation.y = -Math.PI / 2;
  officer.add(patch);
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), new THREE.MeshBasicMaterial({ color: 0xd8d8d8 }));
  tag.position.set(0.1, 1.26, 0.15);
  officer.add(tag);
  officer.position.set(x, 0, z);
  officer.rotation.y = heading;
  S.scene.add(officer);
  attachBlob(officer, 1.5, 0.03);
  return officer;
}
