// Solmar City — on-foot character and third-person camera.
// The figure is built to read as a person, not a box: a tapered torso
// (wider chest, narrower waist), a neck, a head that is small next to the
// shoulders, two slim legs with a real gap between them, arms hanging at
// the sides, and shoes that swing with the walk. The camera still frames
// over the right shoulder, so the crosshair clears the head and aims into
// open view instead of at the back of the skull.

import * as THREE from '../vendor/three.module.min.js';
import { S, clamp } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';

const WALK_PACE = 6;
const RUN_PACE = 10;

// 4-point star for the muzzle flash: 8 vertices alternating outer and
// inner radius, a hot white core, a warm glow edge.
function flashStarTex() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.translate(64, 64);
  ctx.fillStyle = '#fff2b8';
  ctx.shadowColor = '#ff9a2a';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? 60 : 12;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return new THREE.CanvasTexture(cv);
}

export function buildPlayer() {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2a7ab8 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const shoe = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const capRed = new THREE.MeshLambertMaterial({ color: 0xe84a4a });

  // Tapered torso: a chest that is wider than the waist, with a shoulder
  // bar across the top so the figure has shoulders instead of a slab.
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.3), shirt);
  chest.position.y = 1.24;
  chest.castShadow = true;
  group.add(chest);
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.3, 0.26), shirt);
  waist.position.y = 0.88;
  waist.castShadow = true;
  group.add(waist);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.32), shirt);
  shoulders.position.y = 1.44;
  shoulders.castShadow = true;
  group.add(shoulders);
  // Neck between torso and head, so the head does not sit on the chest.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 8), skin);
  neck.position.y = 1.52;
  group.add(neck);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
  face.position.y = 1.68;
  face.castShadow = true;
  group.add(face);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.23, 0.09, 12), capRed);
  cap.position.y = 1.86;
  group.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.24), capRed);
  brim.position.set(0, 1.82, 0.26);
  group.add(brim);

  // Two slim legs with a visible gap, pivoting at the hip so the walk
  // swing reads from the joint instead of the middle of the limb.
  const legShape = new THREE.BoxGeometry(0.17, 0.78, 0.2);
  legShape.translate(0, -0.39, 0);
  const leftLeg = new THREE.Mesh(legShape, pants);
  leftLeg.position.set(-0.13, 0.78, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.13;
  group.add(rightLeg);
  // Arms hang at the sides, pivoting at the shoulder.
  const armShape = new THREE.BoxGeometry(0.15, 0.64, 0.17);
  armShape.translate(0, -0.32, 0);
  const leftArm = new THREE.Mesh(armShape, shirt);
  leftArm.position.set(-0.34, 1.42, 0);
  group.add(leftArm);
  const rightArm = leftArm.clone();
  rightArm.position.x = 0.34;
  group.add(rightArm);
  // Shoes ride on the legs so they swing with the walk, toes forward.
  const shoeShape = new THREE.BoxGeometry(0.17, 0.09, 0.3);
  const shoeL = new THREE.Mesh(shoeShape, shoe);
  shoeL.position.set(0, -0.74, 0.04);
  leftLeg.add(shoeL);
  const shoeR = new THREE.Mesh(shoeShape, shoe);
  shoeR.position.set(0, -0.74, 0.04);
  rightLeg.add(shoeR);

  // Pistol in the right hand, held forward. The muzzle flash is a child
  // of this gun mesh, so flash and gun can never drift apart on screen.
  const gunDark = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
  const pistol = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.46), gunDark);
  barrel.position.z = 0.18;
  pistol.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.12), gunDark);
  grip.position.set(0, -0.14, -0.02);
  pistol.add(grip);
  pistol.position.set(0.34, 1.02, 0.28);
  group.add(pistol);

  // Muzzle flash: a 4-point star (two crossed double-sided planes) bound
  // to the gun barrel tip — never a yellow ball, never a ground puddle.
  // The light is small and short-range on purpose: it lights the gun, not
  // the whole street.
  const star = flashStarTex();
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

function moveInput() {
  const k = S.keys;
  return {
    fwd: (k.KeyW || k.ArrowUp) ? 1 : 0,
    back: (k.KeyS || k.ArrowDown) ? 1 : 0,
    left: (k.KeyA || k.ArrowLeft) ? 1 : 0,
    right: (k.KeyD || k.ArrowRight) ? 1 : 0,
    sprint: !!k.ShiftLeft || !!k.ShiftRight,
  };
}

export function updatePlayer(dt) {
  const p = S.player;
  if (!p) return;
  const keys = moveInput();
  const fwdX = -Math.sin(S.camYaw);
  const fwdZ = -Math.cos(S.camYaw);
  const rightX = Math.cos(S.camYaw);
  const rightZ = -Math.sin(S.camYaw);
  let ix = fwdX * (keys.fwd - keys.back) + rightX * (keys.right - keys.left);
  let iz = fwdZ * (keys.fwd - keys.back) + rightZ * (keys.right - keys.left);
  const len = Math.hypot(ix, iz);
  const target = keys.sprint ? RUN_PACE : WALK_PACE;
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
  const swing = Math.min(1, p.speed / RUN_PACE) * 0.65;
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
  p.gun.rotation.x = Math.sin(ph * 2) * 0.03 * Math.min(1, p.speed / WALK_PACE);

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
  const backX = Math.sin(yaw) * Math.cos(pitch);
  const backZ = Math.cos(yaw) * Math.cos(pitch);
  const up = Math.sin(pitch);
  const sideX = Math.cos(yaw);
  const sideZ = -Math.sin(yaw);
  const shoulder = 1.15; // lateral over-shoulder offset
  const tx = p.pos.x + sideX * shoulder;
  const tz = p.pos.z + sideZ * shoulder;
  const ty = 1.55;
  const cx = tx + backX * dist;
  const cz = tz + backZ * dist;
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
