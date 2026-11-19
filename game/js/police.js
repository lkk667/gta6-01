// Solmar City — wanted level, police cruisers, BUSTED (v4 polish).
// Cruisers are faster than the player now (32 + 1.5/star vs the player's 34),
// so a chase stays a chase; their light bars flash red/blue with glow halos.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, starsFromHeat, addHeat, dist2, clamp } from './state.js';
import { makeCar } from './vehicles.js';
import { resolveCollisions, attachBlob } from './city.js';

let spawnTimer = 0;

export function wantedStars() {
  return starsFromHeat(S.heat);
}

export function spawnCruiser(nearX, nearZ) {
  const mesh = makeCar(0, true);
  // Spawn ~50 m away, on a road if possible.
  const angle = Math.random() * Math.PI * 2;
  let x = nearX + Math.sin(angle) * 50;
  let z = nearZ + Math.cos(angle) * 50;
  x = clamp(x, -170, 170);
  z = clamp(z, -170, 170);
  mesh.position.set(x, 0, z);
  const heading = Math.atan2(nearX - x, nearZ - z);
  mesh.rotation.y = heading;
  S.scene.add(mesh);
  attachBlob(mesh, 4.8, 0.03);
  const cruiser = { mesh, heading, speed: 12, targetSpeed: 20, flashPhase: Math.random() * 6 };
  S.cruisers.push(cruiser);
  return cruiser;
}

function removeCruiser(cruiser) {
  S.scene.remove(cruiser.mesh);
  const i = S.cruisers.indexOf(cruiser);
  if (i >= 0) S.cruisers.splice(i, 1);
}

export function updatePolice(dt) {
  const stars = wantedStars();
  // Heat cools off when the player lies low.
  if (stars > 0) {
    const moving = S.onFoot ? (S.player && S.player.speed > 1) : !!S.currentCar;
    addHeat(-dt * (moving ? 0.9 : 1.8));
  }
  spawnTimer -= dt;
  const want = stars === 0 ? 0 : Math.min(stars + 1, 5);
  if (stars > 0 && S.cruisers.length < want && spawnTimer <= 0 && !S.debug.pacing && !S.debug.noSpawn) {
    spawnTimer = 1.2;
    const px = S.player.pos.x;
    const pz = S.player.pos.z;
    spawnCruiser(px, pz);
  }
  if (stars === 0 && S.cruisers.length > 0 && Math.random() < dt * 0.3) {
    removeCruiser(S.cruisers[0]);
  }

  const px = S.player.pos.x;
  const pz = S.player.pos.z;
  const topSpeed = WORLD.cruiserBaseSpeed + stars * WORLD.cruiserPerStar;
  for (const c of [...S.cruisers]) {
    const mx = c.mesh.position.x;
    const mz = c.mesh.position.z;
    const d = dist2(mx, mz, px, pz);
    let wantHeading;
    let target = topSpeed;
    if (S.debug.freezePolice) {
      // Staged shot: the cruiser holds its pose (lights still flash below).
      c.mesh.rotation.y = c.heading;
      c.flashPhase += dt * 7;
      const redOn = Math.sin(c.flashPhase) > 0;
      const ud0 = c.mesh.userData;
      if (ud0.redLens) {
        ud0.redLens.material.color.setHex(redOn ? 0xff2a2a : 0x5a1414);
        ud0.blueLens.material.color.setHex(redOn ? 0x142a5a : 0x2a6aff);
        ud0.redGlow.material.opacity = redOn ? 0.95 : 0.12;
        ud0.blueGlow.material.opacity = redOn ? 0.12 : 0.95;
        if (ud0.redGround) {
          ud0.redGround.material.opacity = redOn ? 0.55 : 0.08;
          ud0.blueGround.material.opacity = redOn ? 0.08 : 0.55;
        }
      }
      continue;
    }
    if (S.debug.pacing && c.pace && S.currentCar) {
      // Formation pacing (staged chase shot): hold a fixed slot beside the
      // player's car and match its speed instead of converging and ramming.
      const car = S.currentCar;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
      const tx = car.mesh.position.x + fx * c.pace.fwd + rx * c.pace.side;
      const tz = car.mesh.position.z + fz * c.pace.fwd + rz * c.pace.side;
      wantHeading = Math.atan2(tx - mx, tz - mz);
      // Signed along-track error: positive when behind the slot, negative
      // when ahead of it, so the cruiser speeds up to close a gap and eases
      // off instead of overshooting past the slot.
      const err = (tx - mx) * fx + (tz - mz) * fz;
      target = Math.max(8, Math.min(42, car.speed + err * 0.8));
    } else {
      // Steer toward the player, with a little weave so cruisers flank.
      wantHeading = Math.atan2(px - mx, pz - mz) + Math.sin(S.time * 0.7 + c.flashPhase) * 0.25;
      // Slow down right beside an on-foot player so the bust can happen.
      if (S.onFoot && d < 7) target = 0;
      else if (d < 5) target = Math.min(target, 6);
    }
    let dh = wantHeading - c.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    c.heading += clamp(dh, -1.6 * dt, 1.6 * dt);
    c.speed += (target - c.speed) * Math.min(1, dt * 1.6);
    c.mesh.position.x += Math.sin(c.heading) * c.speed * dt;
    c.mesh.position.z += Math.cos(c.heading) * c.speed * dt;
    resolveCollisions(c.mesh.position, 1.9);
    c.mesh.rotation.y = c.heading;
    for (const w of c.mesh.userData.wheels) w.rotation.x += c.speed * dt * 2.4;
    // Ram the player's car on contact (heat only once per 2 s per cruiser).
    // Never while pacing in formation for the staged shot.
    if (S.currentCar && !(S.debug.pacing && c.pace)) {
      const cd = dist2(mx, mz, S.currentCar.mesh.position.x, S.currentCar.mesh.position.z);
      if (cd < 4.2) {
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
    const redOn = Math.sin(c.flashPhase) > 0;
    const ud = c.mesh.userData;
    if (ud.redLens) {
      ud.redLens.material.color.setHex(redOn ? 0xff2a2a : 0x5a1414);
      ud.blueLens.material.color.setHex(redOn ? 0x142a5a : 0x2a6aff);
      ud.redGlow.material.opacity = redOn ? 0.95 : 0.12;
      ud.blueGlow.material.opacity = redOn ? 0.12 : 0.95;
      if (ud.redGround) {
        ud.redGround.material.opacity = redOn ? 0.55 : 0.08;
        ud.blueGround.material.opacity = redOn ? 0.08 : 0.55;
      }
    }
    if (S.audio && d < 60) S.audio.siren(d);
  }

  // BUSTED: cornered on foot at high stars.
  if (S.onFoot && stars >= 3 && S.mode === 'playing') {
    let near = false;
    for (const c of S.cruisers) {
      if (dist2(c.mesh.position.x, c.mesh.position.z, px, pz) < 6 && c.speed < 2) near = true;
    }
    if (near) {
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
  const p = S.player;
  p.group.visible = true;
  // Respawn at Solmar General hospital.
  p.pos.x = 120;
  p.pos.z = -28;
  p.group.position.set(120, 0, -28);
  p.heading = Math.PI;
  p.speed = 0;
  S.health = 100;
  if (S.audio) S.audio.busted();
}

// A standing police officer figure (dark blue, cap) for the street scene.
export function makeOfficer(x, z, heading) {
  const g = new THREE.Group();
  const navy = new THREE.MeshLambertMaterial({ color: 0x1c2a4a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.32), navy);
  torso.position.y = 1.1;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), skin);
  head.position.y = 1.7;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 0.1, 10), navy);
  cap.position.y = 1.9;
  g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.26), navy);
  brim.position.set(0, 1.86, 0.28);
  g.add(brim);
  const legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  legGeo.translate(0, -0.36, 0);
  const legL = new THREE.Mesh(legGeo, navy);
  legL.position.set(-0.15, 0.72, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.15;
  g.add(legR);
  // Arms at the sides, one hand resting on the holster.
  const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.18);
  armGeo.translate(0, -0.3, 0);
  const armL = new THREE.Mesh(armGeo, navy);
  armL.position.set(-0.39, 1.4, 0);
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.39;
  armR.rotation.x = -0.5;
  g.add(armR);
  // Badge: small gold square on the chest.
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffd94a }));
  badge.position.set(-0.14, 1.25, 0.17);
  g.add(badge);
  g.position.set(x, 0, z);
  g.rotation.y = heading;
  S.scene.add(g);
  attachBlob(g, 1.5, 0.03);
  return g;
}
