// Solmar City — the on-foot character and the third-person camera.
//
// The figure is assembled from smooth forms, not boxes. A torso that
// tapers from a broad chest to a slim waist, a neck, a head that is
// small beside the shoulders, two slim capsule legs with a real gap
// between them, capsule arms hanging at the sides, and rounded shoes
// that swing with the walk. Nothing on the body has a hard edge, so
// the figure reads as a person even in close-up instead of a toy.
// The camera frames over the right shoulder, so the crosshair clears
// the head and aims into open view instead of at the back of the skull.

import * as THREE from '../vendor/three.module.min.js';
import { S, clamp } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';

const STROLL = 6;
const SPRINT = 10;

// A four-point star for the muzzle flash: eight points alternating
// outer and inner radius, a hot white core, a warm glowing edge.
function makeFlashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const pen = canvas.getContext('2d');
  pen.translate(64, 64);
  pen.fillStyle = '#fff2b8';
  pen.shadowColor = '#ff9a2a';
  pen.shadowBlur = 16;
  pen.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const radius = i % 2 === 0 ? 60 : 12;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (i === 0) pen.moveTo(px, py);
    else pen.lineTo(px, py);
  }
  pen.closePath();
  pen.fill();
  pen.beginPath();
  pen.arc(0, 0, 12, 0, Math.PI * 2);
  pen.fillStyle = '#ffffff';
  pen.fill();
  return new THREE.CanvasTexture(canvas);
}

export function buildPlayer() {
  const root = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const top = new THREE.MeshLambertMaterial({ color: 0x2a7ab8 });
  const bottom = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const foot = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const cap = new THREE.MeshLambertMaterial({ color: 0xe84a4a });

  // The torso is one smooth tapered cylinder — chest wider than waist —
  // squashed front-to-back into an ellipse, like a real torso instead of
  // a slab. A flattened sphere across the top rounds the shoulders off.
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.62, 14), top);
  chest.position.y = 1.16;
  chest.scale.set(1.2, 1, 0.75);
  chest.castShadow = true;
  root.add(chest);
  const shoulderBar = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), top);
  shoulderBar.position.y = 1.44;
  shoulderBar.scale.set(1.15, 0.5, 0.7);
  shoulderBar.castShadow = true;
  root.add(shoulderBar);
  // A neck between torso and head, so the head does not sit on the chest.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 8), skin);
  neck.position.y = 1.52;
  root.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  root.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.23, 0.09, 12), cap);
  hat.position.y = 1.86;
  root.add(hat);
  const hatBrim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 0.24), cap);
  hatBrim.position.set(0, 1.82, 0.26);
  root.add(hatBrim);

  // A hip block bridging torso and legs, so no light shows through
  // the waist: it overlaps the chest bottom and both thigh tops.
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), bottom);
  hips.position.y = 0.82;
  hips.scale.set(1.15, 0.6, 0.8);
  root.add(hips);

  // Two-segment legs: a thigh pivoting at the hip, a shin pivoting at
  // the knee, a shoe riding on the shin. The hip groups are what the
  // walk cycle swings; the knee groups bend as the leg swings forward,
  // so the legs read as legs instead of two vertical sticks.
  function buildLeg(sideX) {
    const hip = new THREE.Group();
    hip.position.set(sideX, 0.78, 0);
    root.add(hip);
    const thighShape = new THREE.CapsuleGeometry(0.09, 0.28, 6, 12);
    thighShape.translate(0, -0.19, 0);
    const thigh = new THREE.Mesh(thighShape, bottom);
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.37;
    hip.add(knee);
    const shinShape = new THREE.CapsuleGeometry(0.08, 0.3, 6, 12);
    shinShape.translate(0, -0.19, 0);
    const shin = new THREE.Mesh(shinShape, bottom);
    shin.castShadow = true;
    knee.add(shin);
    const shoeShape = new THREE.CapsuleGeometry(0.075, 0.14, 4, 10);
    shoeShape.rotateX(Math.PI / 2);
    const shoe = new THREE.Mesh(shoeShape, foot);
    shoe.position.set(0, -0.37, 0.04);
    knee.add(shoe);
    return { hip, knee };
  }
  const legL = buildLeg(0.13);
  const legR = buildLeg(-0.13);

  // Two-segment arms: an upper arm pivoting at the shoulder, a forearm
  // pivoting at the elbow. The shoulder groups hang 8 degrees out from
  // the body and carry a ball at the joint, so no light gap shows at
  // the armpit; the elbows stay softly bent. The shoulder groups are
  // what the walk cycle swings; the elbow groups carry the bend.
  function buildArm(sideX) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sideX, 1.42, 0);
    shoulder.rotation.z = sideX < 0 ? -0.14 : 0.14;
    root.add(shoulder);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), top);
    shoulder.add(ball);
    const upperShape = new THREE.CapsuleGeometry(0.07, 0.24, 6, 12);
    upperShape.translate(0, -0.15, 0);
    const upper = new THREE.Mesh(upperShape, top);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    const foreShape = new THREE.CapsuleGeometry(0.06, 0.22, 6, 12);
    foreShape.translate(0, -0.14, 0);
    const fore = new THREE.Mesh(foreShape, top);
    elbow.add(fore);
    return { shoulder, elbow };
  }
  const armL = buildArm(0.34);
  const armR = buildArm(-0.34);

  // A pistol in the right hand. The muzzle flash is a child of this
  // gun mesh, so flash and gun can never drift apart. The pistol is a
  // child of the right forearm: its barrel runs down the forearm, so
  // the gun points where the arm points — level and forward when the
  // player aims, down at the side when the arm hangs.
  const iron = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
  const pistol = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.46), iron);
  barrel.position.set(0, 0.05, 0.2);
  pistol.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.12), iron);
  grip.position.set(0, -0.05, -0.02);
  pistol.add(grip);
  pistol.rotation.x = Math.PI / 2;
  pistol.position.set(0, -0.28, 0.03);
  armR.elbow.add(pistol);

  // The flash is a four-point star (two crossed double-sided planes)
  // bound to the barrel tip — never a yellow ball, never a ground
  // puddle. Its light is small and short-range on purpose: it lights
  // the gun, not the whole street.
  const star = makeFlashTexture();
  const flashMat = new THREE.MeshBasicMaterial({ map: star, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const flashA = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), flashMat);
  flashA.position.set(0, 0.05, 0.72);
  pistol.add(flashA);
  const flashB = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), flashMat);
  flashB.position.set(0, 0.05, 0.72);
  flashB.rotation.z = Math.PI / 4;
  pistol.add(flashB);
  const flashLight = new THREE.PointLight(0xffc832, 0, 5);
  flashLight.position.set(0, 0.05, 0.7);
  pistol.add(flashLight);

  root.position.set(0, 0, -8);
  S.scene.add(root);
  attachBlob(root, 1.6, 0.03);

  S.player = {
    group: root, torso: chest, head,
    legL: legL.hip, legR: legR.hip, shinL: legL.knee, shinR: legR.knee,
    armL: armL.shoulder, armR: armR.shoulder, elbowL: armL.elbow, elbowR: armR.elbow,
    gun: pistol, flashMat, flashLight,
    pos: root.position, // THREE.Vector3; x/z are the ground position
    heading: 0,
    speed: 0,
    walkPhase: 0,
    weapon: 'pistol', // 'pistol' | 'fists'
    punchTimer: 0,
    flashTimer: 0,
  };
  return S.player;
}

function readKeys() {
  const k = S.keys;
  return {
    fwd: (k.KeyW || k.ArrowUp) ? 1 : 0,
    back: (k.KeyS || k.ArrowDown) ? 1 : 0,
    left: (k.KeyA || k.ArrowLeft) ? 1 : 0,
    right: (k.KeyD || k.ArrowRight) ? 1 : 0,
    sprint: Boolean(k.ShiftLeft || k.ShiftRight),
  };
}

export function updatePlayer(dt) {
  const p = S.player;
  if (!p) return;
  const keys = readKeys();
  const fwdX = -Math.sin(S.camYaw);
  const fwdZ = -Math.cos(S.camYaw);
  const rightX = Math.cos(S.camYaw);
  const rightZ = -Math.sin(S.camYaw);
  let ix = fwdX * (keys.fwd - keys.back) + rightX * (keys.right - keys.left);
  let iz = fwdZ * (keys.fwd - keys.back) + rightZ * (keys.right - keys.left);
  const mag = Math.hypot(ix, iz);
  const cruise = keys.sprint ? SPRINT : STROLL;
  if (mag > 0.01) {
    ix /= mag;
    iz /= mag;
    p.speed += (cruise - p.speed) * Math.min(1, dt * 8);
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

  // The walk cycle: legs and arms swing opposite, scaled by speed.
  // The knee bends as its leg swings forward, like the pedestrians'.
  const swing = Math.min(1, p.speed / SPRINT) * 0.65;
  const ph = p.walkPhase;
  p.legL.rotation.x = Math.sin(ph) * swing;
  p.legR.rotation.x = -Math.sin(ph) * swing;
  p.shinL.rotation.x = Math.max(0, -Math.sin(ph)) * 0.9;
  p.shinR.rotation.x = Math.max(0, Math.sin(ph)) * 0.9;
  p.armL.rotation.x = -Math.sin(ph) * swing * 0.8;
  p.armR.rotation.x = Math.sin(ph) * swing * 0.8;
  // Elbows stay softly bent, about 15 degrees.
  p.elbowL.rotation.x = -0.26;
  p.elbowR.rotation.x = -0.26;
  if (p.punchTimer > 0) {
    p.punchTimer -= dt;
    p.armR.rotation.x = -1.4 * Math.max(0, p.punchTimer / 0.28);
  }
  // Aiming: with a pistol in hand, the right arm levels forward and
  // the gun points where the player faces. Fists punch instead.
  if (p.weapon === 'pistol' && S.onFoot) {
    p.armR.rotation.x = -1.35;
  }

  // The flash decays on its own (or stays lit when the staging debug
  // hook holds it open for a screenshot).
  if (!S.debug.holdFlash) {
    if (p.flashTimer > 0) {
      p.flashTimer -= dt;
      const lit = p.flashTimer > 0;
      p.flashMat.opacity = lit ? 0.95 : 0;
      p.flashLight.intensity = lit ? 10 : 0;
    } else {
      p.flashMat.opacity = 0;
      p.flashLight.intensity = 0;
    }
  }
  S.speedKmh = p.speed * 3.6;
}

// The camera sits over the right shoulder: both the camera and its look
// target shift sideways (+right), so the character renders left of
// centre and the centre crosshair aims past the right shoulder instead
// of at the back of the head. Tight framing: the offset is 0.52 m (not
// the old 1.15 m), and the lens rides 0.35 m lower, so it looks up
// more and the ground fills the bottom third of the frame instead of
// the bottom half. The staged pitches stay as tuned — the lower lens
// already adds the upward tilt the shots were tuned for.
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
  const over = 0.52; // the lateral over-shoulder offset
  const tx = p.pos.x + sideX * over;
  const tz = p.pos.z + sideZ * over;
  const ty = 1.55;
  const cx = tx + backX * dist;
  const cz = tz + backZ * dist;
  const cy = ty + up * dist - 0.35;
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
  // The world position of the gun barrel tip (the flash is a child of
  // the gun, so it sits here too).
  const p = S.player;
  const tip = new THREE.Vector3(0, 0.05, 0.75);
  p.gun.localToWorld(tip);
  out.copy(tip);
  return out;
}
