// Solmar City — on-foot character and third-person camera.
// Over-shoulder framing: the camera and its look target are both shifted
// sideways so the character sits left of centre and the crosshair clears
// the head, aiming past the right shoulder into open view.

import * as THREE from '../vendor/three.module.min.js';
import { S, clamp } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';

const PACE_WALK = 6;
const PACE_RUN = 10;

// 4-point star texture for the muzzle flash: 8 vertices alternating
// outer/inner radius, hot white core, warm glow edge.
function starTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx2d = cv.getContext('2d');
  ctx2d.translate(64, 64);
  ctx2d.fillStyle = '#fff2b8';
  ctx2d.shadowColor = '#ff9a2a';
  ctx2d.shadowBlur = 16;
  ctx2d.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? 60 : 12;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx2d.moveTo(x, y);
    else ctx2d.lineTo(x, y);
  }
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.beginPath();
  ctx2d.arc(0, 0, 12, 0, Math.PI * 2);
  ctx2d.fillStyle = '#ffffff';
  ctx2d.fill();
  return new THREE.CanvasTexture(cv);
}

export function buildPlayer() {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const shirtMat = new THREE.MeshLambertMaterial({ color: 0x2a7ab8 });
  const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirtMat);
  chest.position.y = 1.12;
  chest.castShadow = true;
  group.add(chest);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat);
  face.position.y = 1.72;
  face.castShadow = true;
  group.add(face);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.1, 12), new THREE.MeshLambertMaterial({ color: 0xe84a4a }));
  cap.position.y = 1.92;
  group.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.28), new THREE.MeshLambertMaterial({ color: 0xe84a4a }));
  brim.position.set(0, 1.88, 0.3);
  group.add(brim);

  // Limbs pivot at the hip/shoulder (geometry translated so rotation.x
  // swings from the joint, not from the middle of the limb).
  const legGeo = new THREE.BoxGeometry(0.22, 0.78, 0.24);
  legGeo.translate(0, -0.39, 0);
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.set(-0.17, 0.78, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.17;
  group.add(rightLeg);
  const armGeo = new THREE.BoxGeometry(0.18, 0.66, 0.2);
  armGeo.translate(0, -0.33, 0);
  const leftArm = new THREE.Mesh(armGeo, shirtMat);
  leftArm.position.set(-0.42, 1.45, 0);
  group.add(leftArm);
  const rightArm = leftArm.clone();
  rightArm.position.x = 0.42;
  group.add(rightArm);
  // Shoes ride on the legs so they swing with the walk.
  const footGeo = new THREE.BoxGeometry(0.22, 0.1, 0.34);
  const footL = new THREE.Mesh(footGeo, shoeMat);
  footL.position.set(0, -0.73, 0.05);
  leftLeg.add(footL);
  const footR = new THREE.Mesh(footGeo, shoeMat);
  footR.position.set(0, -0.73, 0.05);
  rightLeg.add(footR);

  // Pistol in the right hand, held forward. The muzzle flash is a child of
  // this gun mesh, so flash and gun can never drift apart on screen.
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
  const pistol = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.46), gunMat);
  barrel.position.z = 0.18;
  pistol.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.12), gunMat);
  grip.position.set(0, -0.14, -0.02);
  pistol.add(grip);
  pistol.position.set(0.42, 1.05, 0.3);
  group.add(pistol);

  // Muzzle flash: a 4-point star (two crossed double-sided planes) bound
  // to the gun barrel tip — never a yellow ball, never a ground puddle.
  // The light is small and short-range on purpose: it lights the gun, not
  // the whole street.
  const star = starTexture();
  const flashMat = new THREE.MeshBasicMaterial({ map: star, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const planeA = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), flashMat);
  planeA.position.z = 0.72;
  pistol.add(planeA);
  const planeB = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), flashMat);
  planeB.position.z = 0.72;
  planeB.rotation.z = Math.PI / 4;
  pistol.add(planeB);
  const flashLight = new THREE.PointLight(0xffc832, 0, 5);
  flashLight.position.z = 0.7;
  pistol.add(flashLight);

  group.position.set(0, 0, -8);
  S.scene.add(group);
  attachBlob(group, 1.6, 0.03);

  S.player = {
    group, torso: chest, head: face, legL: leftLeg, legR: rightLeg, armL: leftArm, armR: rightArm, gun: pistol, flashMat, flashLight,
    pos: group.position, // THREE.Vector3, x/z are the ground position
    heading: 0,
    speed: 0,
    walkPhase: 0,
    weapon: 'pistol', // 'pistol' | 'fists'
    punchTimer: 0,
    flashTimer: 0,
  };
  return S.player;
}

function readMoveKeys() {
  const k = S.keys;
  return {
    forward: (k.KeyW || k.ArrowUp) ? 1 : 0,
    back: (k.KeyS || k.ArrowDown) ? 1 : 0,
    left: (k.KeyA || k.ArrowLeft) ? 1 : 0,
    right: (k.KeyD || k.ArrowRight) ? 1 : 0,
    sprint: !!k.ShiftLeft || !!k.ShiftRight,
  };
}

export function updatePlayer(dt) {
  const p = S.player;
  if (!p) return;
  const keys = readMoveKeys();
  const fwdX = -Math.sin(S.camYaw);
  const fwdZ = -Math.cos(S.camYaw);
  const rightX = Math.cos(S.camYaw);
  const rightZ = -Math.sin(S.camYaw);
  let ix = fwdX * (keys.forward - keys.back) + rightX * (keys.right - keys.left);
  let iz = fwdZ * (keys.forward - keys.back) + rightZ * (keys.right - keys.left);
  const len = Math.hypot(ix, iz);
  const target = keys.sprint ? PACE_RUN : PACE_WALK;
  if (len > 0.01) {
    ix /= len;
    iz /= len;
    p.speed += (target - p.speed) * Math.min(1, dt * 8);
    p.heading = Math.atan2(ix, iz);
    p.pos.x += ix * p.speed * dt;
    p.pos.z += iz * p.speed * dt;
    p.walkPhase += dt * p.speed * 1.6;
  } else {
    p.speed += (0 - p.speed) * Math.min(1, dt * 10);
  }
  resolveCollisions(p.pos, 0.55);
  p.group.position.set(p.pos.x, 0, p.pos.z);
  p.group.rotation.y = p.heading;

  // Walk/run cycle.
  const swing = Math.min(1, p.speed / PACE_RUN) * 0.65;
  const ph = p.walkPhase;
  p.legL.rotation.x = Math.sin(ph) * swing;
  p.legR.rotation.x = -Math.sin(ph) * swing;
  p.armL.rotation.x = -Math.sin(ph) * swing * 0.8;
  p.armR.rotation.x = Math.sin(ph) * swing * 0.8;
  if (p.punchTimer > 0) {
    p.punchTimer -= dt;
    p.armR.rotation.x = -1.4 * Math.max(0, p.punchTimer / 0.28);
  }
  // Gun stays level while walking.
  p.gun.rotation.x = Math.sin(ph * 2) * 0.03 * Math.min(1, p.speed / PACE_WALK);

  // Muzzle flash decay (or held open by the staging debug hook).
  if (!S.debug.holdFlash) {
    if (p.flashTimer > 0) {
      p.flashTimer -= dt;
      const on = p.flashTimer > 0;
      p.flashMat.opacity = on ? 0.95 : 0;
      p.flashLight.intensity = on ? 10 : 0;
    } else {
      p.flashMat.opacity = 0;
      p.flashLight.intensity = 0;
    }
  }
  S.speedKmh = p.speed * 3.6;
}

// Over-shoulder camera: shift camera and look target sideways (+right) so
// the character renders left of centre and the centre crosshair aims past
// the right shoulder instead of at the back of the head.
export function updateCamera(dt) {
  const p = S.player;
  if (!p || !S.camera) return;
  const yaw = S.camYaw;
  const pitch = clamp(S.camPitch, -0.15, 0.85);
  const dist = S.camDist;
  const bx = Math.sin(yaw) * Math.cos(pitch);
  const bz = Math.cos(yaw) * Math.cos(pitch);
  const up = Math.sin(pitch);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const shoulder = 1.15; // lateral over-shoulder offset
  const tx = p.pos.x + rx * shoulder;
  const tz = p.pos.z + rz * shoulder;
  const ty = 1.55;
  const cx = tx + bx * dist;
  const cz = tz + bz * dist;
  const cy = ty + up * dist;
  const cam = S.camera;
  cam.position.x += (cx - cam.position.x) * Math.min(1, dt * 10);
  cam.position.y += (cy - cam.position.y) * Math.min(1, dt * 10);
  cam.position.z += (cz - cam.position.z) * Math.min(1, dt * 10);
  cam.lookAt(tx, ty, tz);
}

export function aimDirection() {
  // Where the centre crosshair points: from the camera through its look
  // target, i.e. past the player's right shoulder.
  const cam = S.camera;
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  return dir;
}

export function muzzleWorldPos(out) {
  // World position of the gun barrel tip (flash is a child of the gun).
  const p = S.player;
  const tip = new THREE.Vector3(0, 0, 0.75);
  p.gun.localToWorld(tip);
  out.copy(tip);
  return out;
}
