// Solmar City — the wanted level, police cruisers, BUSTED.
//
// Cruisers run faster than the player now (32 + 1.5 per star, against
// the player's 34), so a chase stays a chase; their light bars flash
// red and blue with glow halos. The officer on the street is built
// from smooth forms like everyone else — a tapered uniform, a neck, a
// head small beside the shoulders — with the badge, belt, holster,
// radio, patch and name tag that mark the uniform.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, starsFromHeat, addHeat, dist2, clamp } from './state.js';
import { makeCar } from './vehicles.js';
import { resolveCollisions, attachBlob } from './city.js';

let spawnClock = 0;

// One place for the light-bar flash state: the lenses, the glow halos,
// and the red/blue pools on the road under the cruiser.
function setLightBar(unit, redOn) {
  if (!unit.redLens) return;
  unit.redLens.material.color.set(redOn ? 0xff2a2a : 0x5a1414);
  unit.blueLens.material.color.set(redOn ? 0x142a5a : 0x2a6aff);
  unit.redGlow.material.opacity = redOn ? 0.95 : 0.12;
  unit.blueGlow.material.opacity = redOn ? 0.12 : 0.95;
  if (unit.redGround) {
    unit.redGround.material.opacity = redOn ? 0.55 : 0.08;
    unit.blueGround.material.opacity = redOn ? 0.08 : 0.55;
  }
}

export function wantedStars() {
  return starsFromHeat(S.heat);
}

export function spawnCruiser(nearX, nearZ) {
  const car = makeCar(0, true);
  // Spawn about 50 m away, on a road when possible.
  const angle = Math.random() * Math.PI * 2;
  let sx = nearX + Math.sin(angle) * 50;
  let sz = nearZ + Math.cos(angle) * 50;
  sx = clamp(sx, -170, 170);
  sz = clamp(sz, -170, 170);
  car.position.set(sx, 0, sz);
  const face = Math.atan2(nearX - sx, nearZ - sz);
  car.rotation.y = face;
  S.scene.add(car);
  attachBlob(car, 4.8, 0.03);
  const unit = { mesh: car, heading: face, speed: 12, targetSpeed: 20, flashPhase: Math.random() * 6 };
  S.cruisers.push(unit);
  return unit;
}

function retireCruiser(unit) {
  S.scene.remove(unit.mesh);
  const i = S.cruisers.indexOf(unit);
  if (i >= 0) S.cruisers.splice(i, 1);
}

export function updatePolice(dt) {
  const wanted = wantedStars();
  // Heat cools off when the player lies low.
  if (wanted > 0) {
    const moving = S.onFoot ? (S.player && S.player.speed > 1) : Boolean(S.currentCar);
    addHeat(-dt * (moving ? 0.9 : 1.8));
  }
  spawnClock -= dt;
  const wantedCount = wanted === 0 ? 0 : Math.min(wanted + 1, 5);
  if (wanted > 0 && S.cruisers.length < wantedCount && spawnClock <= 0 && !S.debug.pacing && !S.debug.noSpawn) {
    spawnClock = 1.2;
    spawnCruiser(S.player.pos.x, S.player.pos.z);
  }
  if (wanted === 0 && S.cruisers.length > 0 && Math.random() < dt * 0.3) {
    retireCruiser(S.cruisers[0]);
  }

  const px = S.player.pos.x;
  const pz = S.player.pos.z;
  const topSpeed = WORLD.cruiserBaseSpeed + wanted * WORLD.cruiserPerStar;
  for (const unit of [...S.cruisers]) {
    const mx = unit.mesh.position.x;
    const mz = unit.mesh.position.z;
    const d = dist2(mx, mz, px, pz);
    let steer;
    let goal = topSpeed;
    if (S.debug.freezePolice) {
      // A staged shot: the cruiser holds its pose (its lights still
      // flash, handled just below).
      unit.mesh.rotation.y = unit.heading;
      unit.flashPhase += dt * 7;
      setLightBar(unit.mesh.userData, Math.sin(unit.flashPhase) > 0);
      continue;
    }
    if (S.debug.pacing && unit.pace && S.currentCar) {
      // Formation pacing for the staged chase shot: hold a fixed slot
      // beside the player's car and match its speed instead of
      // converging and ramming it.
      const car = S.currentCar;
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const rx = Math.cos(car.heading);
      const rz = -Math.sin(car.heading);
      const tx = car.mesh.position.x + fx * unit.pace.fwd + rx * unit.pace.side;
      const tz = car.mesh.position.z + fz * unit.pace.fwd + rz * unit.pace.side;
      steer = Math.atan2(tx - mx, tz - mz);
      // The signed along-track error: positive when behind the slot,
      // negative when ahead of it, so the cruiser speeds up to close a
      // gap and eases off instead of overshooting past the slot.
      const err = (tx - mx) * fx + (tz - mz) * fz;
      goal = Math.max(8, Math.min(42, car.speed + err * 0.8));
    } else {
      // Steer toward the player, with a little weave so cruisers flank.
      steer = Math.atan2(px - mx, pz - mz) + Math.sin(S.time * 0.7 + unit.flashPhase) * 0.25;
      // Slow down right beside an on-foot player so the bust can happen.
      if (S.onFoot && d < 7) goal = 0;
      else if (d < 5) goal = Math.min(goal, 6);
    }
    let turn = steer - unit.heading;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    unit.heading += clamp(turn, -1.6 * dt, 1.6 * dt);
    unit.speed += (goal - unit.speed) * Math.min(1, dt * 1.6);
    unit.mesh.position.x += Math.sin(unit.heading) * unit.speed * dt;
    unit.mesh.position.z += Math.cos(unit.heading) * unit.speed * dt;
    resolveCollisions(unit.mesh.position, 1.9);
    unit.mesh.rotation.y = unit.heading;
    for (const w of unit.mesh.userData.wheels) w.rotation.x += unit.speed * dt * 2.4;
    // Ram the player's car on contact (heat only once per 2 s per
    // cruiser). Never while pacing in formation for the staged shot.
    if (S.currentCar && !(S.debug.pacing && unit.pace)) {
      const ramD = dist2(mx, mz, S.currentCar.mesh.position.x, S.currentCar.mesh.position.z);
      if (ramD < 4.2) {
        S.currentCar.speed *= 0.86;
        if (S.audio) S.audio.crash();
        if (!unit.lastRam || S.time - unit.lastRam > 2) {
          unit.lastRam = S.time;
          addHeat(1.5);
        }
      }
    }
    // The flashing light bar: red and blue alternate, the glow sprites
    // pulse with it, and the red/blue ground reflections under the
    // cruiser pulse too.
    unit.flashPhase += dt * 7;
    setLightBar(unit.mesh.userData, Math.sin(unit.flashPhase) > 0);
    if (S.audio && d < 60) S.audio.siren(d);
  }

  // BUSTED: cornered on foot at high stars.
  if (S.onFoot && wanted >= 3 && S.mode === 'playing') {
    let cornered = false;
    for (const unit of S.cruisers) {
      if (dist2(unit.mesh.position.x, unit.mesh.position.z, px, pz) < 6 && unit.speed < 2) cornered = true;
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
  for (const unit of [...S.cruisers]) retireCruiser(unit);
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
  const navy = new THREE.MeshLambertMaterial({ color: 0x1c2a4a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  // The tapered uniform: one smooth cylinder, chest wider than waist,
  // squashed front-to-back, plus a flattened sphere across the top to
  // round the shoulders off. A neck, and a head that is small next to
  // the shoulders.
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.18, 0.58, 12), navy);
  chest.position.y = 1.14;
  chest.scale.set(1.15, 1, 0.72);
  officer.add(chest);
  const shoulderBar = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), navy);
  shoulderBar.position.y = 1.42;
  shoulderBar.scale.set(1.1, 0.45, 0.68);
  officer.add(shoulderBar);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 8), skin);
  neck.position.y = 1.5;
  officer.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
  head.position.y = 1.66;
  officer.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.23, 0.1, 10), navy);
  hat.position.y = 1.84;
  officer.add(hat);
  const hatBrim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.22), navy);
  hatBrim.position.set(0, 1.8, 0.24);
  officer.add(hatBrim);
  // Two slim legs with a gap, pivoting at the hip: capsules, shifted
  // down so their tops sit at the mesh origin (the hip joint).
  const legShape = new THREE.CapsuleGeometry(0.082, 0.56, 6, 10);
  legShape.translate(0, -0.33, 0);
  const shinL = new THREE.Mesh(legShape, navy);
  shinL.position.set(-0.12, 0.72, 0);
  officer.add(shinL);
  const shinR = shinL.clone();
  shinR.position.x = 0.12;
  officer.add(shinR);
  // Arms at the sides, capsules again, one hand resting on the holster.
  const armShape = new THREE.CapsuleGeometry(0.065, 0.48, 6, 10);
  armShape.translate(0, -0.28, 0);
  const foreL = new THREE.Mesh(armShape, navy);
  foreL.position.set(-0.32, 1.38, 0);
  officer.add(foreL);
  const foreR = foreL.clone();
  foreR.position.x = 0.32;
  foreR.rotation.x = -0.5;
  officer.add(foreR);
  // A badge: a small gold square on the chest.
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffd94a }));
  badge.position.set(-0.12, 1.24, 0.15);
  officer.add(badge);
  // The uniform details: duty belt, holster, shoulder radio, a
  // light-blue shoulder patch, and a name tag.
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
