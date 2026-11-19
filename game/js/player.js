// Solmar City — on-foot character and third-person camera (v4 polish).
// Over-shoulder framing: the camera and its look target are both shifted
// sideways so the character sits left of centre and the crosshair clears
// the head, aiming past the right shoulder into open view.

import * as THREE from '../vendor/three.module.min.js';
import { S, clamp } from './state.js';
import { resolveCollisions, attachBlob } from './city.js';

const WALK_SPEED = 6;
const RUN_SPEED = 10;

export function buildPlayer() {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2a7ab8 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const shoes = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
  torso.position.y = 1.12;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
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
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.17, 0.78, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.17;
  group.add(legR);
  const armGeo = new THREE.BoxGeometry(0.18, 0.66, 0.2);
  armGeo.translate(0, -0.33, 0);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.42, 1.45, 0);
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.42;
  group.add(armR);
  // Shoes ride on the legs so they swing with the walk.
  const footGeo = new THREE.BoxGeometry(0.22, 0.1, 0.34);
  const footL = new THREE.Mesh(footGeo, shoes);
  footL.position.set(0, -0.73, 0.05);
  legL.add(footL);
  const footR = new THREE.Mesh(footGeo, shoes);
  footR.position.set(0, -0.73, 0.05);
  legR.add(footR);

  // Pistol in the right hand, held forward. The muzzle flash is a child of
  // this gun mesh, so flash and gun can never drift apart on screen.
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
  const gun = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.46), gunMat);
  barrel.position.z = 0.18;
  gun.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.12), gunMat);
  grip.position.set(0, -0.14, -0.02);
  gun.add(grip);
  gun.position.set(0.42, 1.05, 0.3);
  group.add(gun);

  // Muzzle flash: a 4-point star (two crossed double-sided planes) bound
  // to the gun barrel tip — never a yellow ball, never a ground puddle.
  // The light is small and short-range on purpose: it lights the gun, not
  // the whole street.
  const starTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.translate(64, 64);
    g.fillStyle = '#fff2b8';
    g.shadowColor = '#ff9a2a';
    g.shadowBlur = 16;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? 60 : 12;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(0, 0, 12, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    return new THREE.CanvasTexture(c);
  })();
  const flashMat = new THREE.MeshBasicMaterial({ map: starTex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const flashA = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), flashMat);
  flashA.position.z = 0.72;
  gun.add(flashA);
  const flashB = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), flashMat);
  flashB.position.z = 0.72;
  flashB.rotation.z = Math.PI / 4;
  gun.add(flashB);
  const flashLight = new THREE.PointLight(0xffc832, 0, 5);
  flashLight.position.z = 0.7;
  gun.add(flashLight);

  group.position.set(0, 0, -8);
  S.scene.add(group);
  attachBlob(group, 1.6, 0.03);

  S.player = {
    group, torso, head, legL, legR, armL, armR, gun, flashMat, flashLight,
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

function moveKeys() {
  const k = S.keys;
  return {
    fwd: (k.KeyW || k.ArrowUp) ? 1 : 0,
    back: (k.KeyS || k.ArrowDown) ? 1 : 0,
    left: (k.KeyA || k.ArrowLeft) ? 1 : 0,
    right: (k.KeyD || k.ArrowRight) ? 1 : 0,
    run: !!k.ShiftLeft || !!k.ShiftRight,
  };
}

export function updatePlayer(dt) {
  const p = S.player;
  if (!p) return;
  const mv = moveKeys();
  const camFwdX = -Math.sin(S.camYaw);
  const camFwdZ = -Math.cos(S.camYaw);
  const camRightX = Math.cos(S.camYaw);
  const camRightZ = -Math.sin(S.camYaw);
  let ix = camFwdX * (mv.fwd - mv.back) + camRightX * (mv.right - mv.left);
  let iz = camFwdZ * (mv.fwd - mv.back) + camRightZ * (mv.right - mv.left);
  const len = Math.hypot(ix, iz);
  const target = mv.run ? RUN_SPEED : WALK_SPEED;
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
  const swing = Math.min(1, p.speed / RUN_SPEED) * 0.65;
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
  p.gun.rotation.x = Math.sin(ph * 2) * 0.03 * Math.min(1, p.speed / WALK_SPEED);

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
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const shoulder = 1.15; // lateral over-shoulder offset
  const tx = p.pos.x + rightX * shoulder;
  const tz = p.pos.z + rightZ * shoulder;
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
