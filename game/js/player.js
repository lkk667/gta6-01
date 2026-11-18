// Solmar City — the player on foot.
// A simple built-from-boxes character (teal shirt, dark jeans, cap) with a
// walk/run cycle, a punch swing and a pistol aim pose. Movement is relative
// to the camera orbit so WASD always feels like the screen direction, and
// the third-person camera follows behind with mouse orbit and smoothing.

import * as THREE from 'three';
import { state, clamp, angleLerp } from './state.js';
import { resolveBuildingCollision, clampToCity } from './city.js';

export function makePlayerMesh() {
  const player = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2e8f86 });
  const jeans = new THREE.MeshLambertMaterial({ color: 0x2b3a55 });
  const capMat = new THREE.MeshLambertMaterial({ color: 0xe8c84a });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.4), shirt);
  torso.position.y = 1.15;
  torso.castShadow = true;
  player.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), skin);
  head.position.y = 1.85;
  head.castShadow = true;
  player.add(head);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 12), capMat);
  cap.position.y = 2.05;
  player.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.3), capMat);
  brim.position.set(0, 2.0, 0.32);
  player.add(brim);

  const armGeo = new THREE.BoxGeometry(0.2, 0.75, 0.2);
  const leftArm = new THREE.Mesh(armGeo, shirt);
  leftArm.position.set(-0.48, 1.2, 0);
  leftArm.castShadow = true;
  player.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, shirt);
  rightArm.position.set(0.48, 1.2, 0);
  rightArm.castShadow = true;
  player.add(rightArm);

  const legGeo = new THREE.BoxGeometry(0.26, 0.8, 0.26);
  const leftLeg = new THREE.Mesh(legGeo, jeans);
  leftLeg.position.set(-0.18, 0.4, 0);
  leftLeg.castShadow = true;
  player.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, jeans);
  rightLeg.position.set(0.18, 0.4, 0);
  rightLeg.castShadow = true;
  player.add(rightLeg);

  // The pistol, hidden until the player draws it.
  const pistol = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.42), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  pistol.add(gunBody);
  pistol.position.set(0.48, 1.05, 0.25);
  pistol.visible = false;
  player.add(pistol);

  player.userData = { leftArm, rightArm, leftLeg, rightLeg, pistol, torso };
  return player;
}

export function updatePlayerOnFoot(mesh, dt, input, colliders) {
  const p = state.player;
  const running = input.run;
  const speed = running ? 10 : 5.6;

  // Movement relative to the camera yaw: W walks away from the camera.
  const yaw = state.camera.yaw;
  let mx = 0;
  let mz = 0;
  if (input.forward) { mx -= Math.sin(yaw); mz -= Math.cos(yaw); }
  if (input.back) { mx += Math.sin(yaw); mz += Math.cos(yaw); }
  if (input.left) { mx -= Math.cos(yaw); mz += Math.sin(yaw); }
  if (input.right) { mx += Math.cos(yaw); mz -= Math.sin(yaw); }
  const len = Math.sqrt(mx * mx + mz * mz);
  p.moving = len > 0;
  p.running = running && p.moving;

  if (p.moving) {
    mx /= len;
    mz /= len;
    const nx = p.x + mx * speed * dt;
    const nz = p.z + mz * speed * dt;
    const clamped = clampToCity(nx, nz);
    const resolved = resolveBuildingCollision(colliders, clamped.x, clamped.z, 0.6);
    p.x = resolved.x;
    p.z = resolved.z;
    p.speed = speed;
    const targetHeading = Math.atan2(mx, mz);
    p.heading = angleLerp(p.heading, targetHeading, Math.min(1, dt * 12));
  } else {
    p.speed = 0;
  }

  // Walk cycle: arms and legs swing opposite, faster when running.
  const cycle = state.time * (running ? 11 : 7);
  const swing = p.moving ? Math.sin(cycle) * (running ? 0.75 : 0.5) : 0;
  const u = mesh.userData;
  u.leftArm.rotation.x = swing;
  u.rightArm.rotation.x = -swing;
  u.leftLeg.rotation.x = -swing;
  u.rightLeg.rotation.x = swing;
  // Punch overrides the right arm; pistol-aim holds it forward.
  if (p.punching > 0) {
    u.rightArm.rotation.x = -1.6 * (p.punching / 0.35);
  } else if (input.aim) {
    u.rightArm.rotation.x = -1.35;
    u.pistol.visible = true;
  } else {
    u.pistol.visible = false;
  }
  // Little bounce while running.
  mesh.position.y = p.moving && running ? Math.abs(Math.sin(cycle)) * 0.08 : 0;

  mesh.position.set(p.x, mesh.position.y, p.z);
  mesh.rotation.y = p.heading;
}

// --- Third-person camera --------------------------------------------------

export function updateCamera(camera, dt, lookTarget) {
  const cam = state.camera;
  const target = lookTarget;
  const distance = cam.distance;
  const pitch = clamp(cam.pitch, -0.1, 1.1);
  const cx = target.x + Math.sin(cam.yaw) * Math.cos(pitch) * distance;
  const cz = target.z + Math.cos(cam.yaw) * Math.cos(pitch) * distance;
  const cy = target.y + Math.sin(pitch) * distance + 1.2;

  const desired = new THREE.Vector3(cx, cy, cz);
  const smoothing = Math.min(1, dt * 8);
  camera.position.lerp(desired, smoothing);
  if (cam.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * cam.shake;
    camera.position.y += (Math.random() - 0.5) * cam.shake;
    cam.shake = Math.max(0, cam.shake - dt * 1.4);
  }
  camera.lookAt(target.x, target.y + 1.4, target.z);
}

export function applyCameraOrbit(dx, dy) {
  state.camera.yaw -= dx * 0.0032;
  state.camera.pitch = clamp(state.camera.pitch + dy * 0.0022, -0.1, 1.1);
}
