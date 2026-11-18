// Solmar City — the on-foot player: a simple character with a walk/run
// cycle, and the third-person mouse-orbit camera that follows them
// (or the car they are driving).

import * as THREE from 'three';
import { S, WORLD, clamp, angleLerp } from './state.js';
import { collideCircle } from './city.js';
import { input } from './input.js';

export const player = {
  pos: new THREE.Vector3(0, 0, 24),
  heading: Math.PI, // facing north (-z) at spawn
  speed: 0,
  moving: false,
  walkPhase: 0,
  camYaw: 0, // behind the player at spawn (heading PI faces -z)
  camPitch: 0.32,
  camDist: 7.5,
  group: null,
  legL: null,
  legR: null,
  armL: null,
  armR: null,
  gun: null,
};

function makeCharacter() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2fa8a0 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c3e55 });
  const hair = new THREE.MeshLambertMaterial({ color: 0x2a2018 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
  torso.position.y = 1.12;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skin);
  head.position.y = 1.72;
  g.add(head);
  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairTop.position.y = 1.76;
  g.add(hairTop);

  const legGeo = new THREE.BoxGeometry(0.24, 0.72, 0.26);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.geometry = legGeo.clone();
  legL.geometry.translate(0, -0.36, 0);
  legL.position.set(-0.16, 0.74, 0);
  g.add(legL);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.geometry = legGeo.clone();
  legR.geometry.translate(0, -0.36, 0);
  legR.position.set(0.16, 0.74, 0);
  g.add(legR);

  const armGeo = new THREE.BoxGeometry(0.18, 0.62, 0.2);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.geometry = armGeo.clone();
  armL.geometry.translate(0, -0.31, 0);
  armL.position.set(-0.42, 1.42, 0);
  g.add(armL);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.geometry = armGeo.clone();
  armR.geometry.translate(0, -0.31, 0);
  armR.position.set(0.42, 1.42, 0);
  g.add(armR);

  // Pistol held in the right hand, visible while on foot.
  const gun = new THREE.Group();
  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.09, 0.42),
    new THREE.MeshLambertMaterial({ color: 0x1c1c22 }),
  );
  barrel.position.set(0, 0, 0.18);
  gun.add(barrel);
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.2, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x1c1c22 }),
  );
  grip.position.set(0, -0.1, -0.02);
  gun.add(grip);
  gun.position.set(0.42, 1.12, 0.28);
  g.add(gun);

  player.legL = legL;
  player.legR = legR;
  player.armL = armL;
  player.armR = armR;
  player.gun = gun;
  player.group = g;
  return g;
}

export function buildPlayer(scene) {
  const g = makeCharacter();
  g.position.copy(player.pos);
  scene.add(g);
  S.player = player;
  return player;
}

/** Move the player on foot. Returns nothing; updates pos, heading, speed. */
export function updatePlayer(dt) {
  // Camera orbit from the mouse.
  player.camYaw -= input.lookDX * 0.0032;
  player.camPitch = clamp(player.camPitch + input.lookDY * 0.0026, -0.15, 1.1);

  let fx = 0;
  let fz = 0;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) fz -= 1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) fz += 1;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) fx -= 1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) fx += 1;

  const running = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  const targetSpeed = fx === 0 && fz === 0 ? 0 : running ? WORLD.runSpeed : WORLD.walkSpeed;
  player.speed = targetSpeed;
  player.moving = targetSpeed > 0;

  if (player.moving) {
    // Move relative to the camera yaw: W walks away from the camera,
    // D strafes to the camera's right.
    const moveF = -fz;
    const moveR = fx;
    const sin = Math.sin(player.camYaw);
    const cos = Math.cos(player.camYaw);
    let mx = moveF * -sin + moveR * cos;
    let mz = moveF * -cos + moveR * -sin;
    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;
    player.pos.x += mx * targetSpeed * dt;
    player.pos.z += mz * targetSpeed * dt;
    player.pos.x = clamp(player.pos.x, -WORLD.half, WORLD.half);
    player.pos.z = clamp(player.pos.z, -WORLD.half, WORLD.half + 8);
    collideCircle(player.pos, 0.55);
    player.heading = angleLerp(player.heading, Math.atan2(mx, mz), Math.min(1, dt * 12));
    player.walkPhase += dt * targetSpeed * 1.6;
  }

  // Walk-cycle swing.
  const swing = player.moving ? Math.sin(player.walkPhase) * 0.55 : 0;
  player.legL.rotation.x = swing;
  player.legR.rotation.x = -swing;
  player.armL.rotation.x = -swing * 0.7;
  // Right arm stays forward holding the pistol.
  player.armR.rotation.x = -0.9;
  player.gun.visible = S.weapon === 'pistol';

  player.group.position.copy(player.pos);
  player.group.rotation.y = player.heading;
  // Small bob while walking.
  player.group.position.y = player.moving ? Math.abs(Math.sin(player.walkPhase)) * 0.06 : 0;
}

/**
 * Position the third-person camera. On foot it orbits the player; in a
 * car it sits behind the car and follows its heading.
 */
export function updateCamera(camera, dt) {
  const target = S.car ? S.car.group.position : player.pos;
  const targetHead = target.y + (S.car ? 1.6 : 1.5);

  if (S.car) {
    // Chase cam: ease the yaw toward the car's heading.
    player.camYaw = angleLerp(player.camYaw, S.car.heading + Math.PI, Math.min(1, dt * 2.2));
  }

  const dist = S.car ? 9.5 : player.camDist;
  const height = S.car ? 3.2 : 2.6;
  const cx = target.x + Math.sin(player.camYaw) * dist * Math.cos(player.camPitch);
  const cz = target.z + Math.cos(player.camYaw) * dist * Math.cos(player.camPitch);
  const cy = targetHead + height * Math.sin(player.camPitch) + (S.car ? 1.2 : 0.6);

  // Camera shake on top of the orbit.
  let sx = 0;
  let sy = 0;
  if (S.shake.t > 0) {
    const m = S.shake.mag * (S.shake.t / 0.25);
    sx = (Math.random() - 0.5) * m;
    sy = (Math.random() - 0.5) * m;
  }
  camera.position.set(cx + sx, cy + sy, cz);
  camera.lookAt(target.x + sx * 0.5, targetHead + sy * 0.5, target.z);
}

/** Teleport the player (used by staging and the debug hooks). */
export function teleportPlayer(x, z, heading = null) {
  player.pos.set(x, 0, z);
  if (heading !== null) {
    player.heading = heading;
    player.camYaw = heading + Math.PI;
  }
  player.group.position.copy(player.pos);
}
