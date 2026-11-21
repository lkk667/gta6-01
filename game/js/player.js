// Solmar City — the player rig.
// Builds the on-foot hero (body, cap, pistol, muzzle flash), walks him
// with WASD, and chases him with the over-shoulder camera. The rig is
// the only thing in the game that owns the player's visible body: when
// the hero climbs into a car the whole group is hidden, so the driver
// never pokes through a roof, and it comes back the moment he steps out.

import * as THREE from "../vendor/three.module.min.js";
import { S, clamp } from "./state.js";

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function lambert(hex) {
  return new THREE.MeshLambertMaterial({ color: hex });
}

function standard(hex, rough, metal) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: rough === undefined ? 0.6 : rough,
    metalness: metal === undefined ? 0.05 : metal,
  });
}

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

// A soft radial glow (white-hot core fading to transparent orange) drawn
// once on a canvas and reused for the muzzle flash and the smoke puffs.
function glowCanvasTexture(inner, mid, outer) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, mid);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

export function buildPlayer() {
  const shirt = lambert(0x2a6a8a, 0.9); // teal-blue shirt
  const skin = lambert(0xe8b98a, 0.7);
  const pants = lambert(0x23262e, 0.9);
  const shoe = lambert(0x141414, 0.8);
  const capRed = lambert(0xc22e2e, 0.8);

  const group = new THREE.Group();
  group.name = "player";

  // --- torso: a slightly tapered chest block, shirt-coloured ---
  const chest = new THREE.Group();
  chest.position.set(0, 0.78, 0);
  const torso = box(0.38, 0.56, 0.22, shirt);
  torso.position.y = 0.28;
  chest.add(torso);
  // a darker belt line where the shirt meets the trousers
  const belt = box(0.39, 0.05, 0.23, lambert(0x1a1d22, 0.9));
  belt.position.y = 0.02;
  chest.add(belt);
  group.add(chest);

  // --- head: skin sphere + red cap, so the hero reads at a distance ---
  const head = new THREE.Group();
  head.position.set(0, 1.42, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skin);
  skull.position.y = 0.08;
  skull.castShadow = true;
  head.add(skull);
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), capRed);
  capTop.position.y = 0.13;
  head.add(capTop);
  const brim = box(0.16, 0.02, 0.1, capRed);
  brim.position.set(0, 0.14, 0.12);
  head.add(brim);
  group.add(head);

  // --- legs: hip pivots, thigh + shin + shoe each side ---
  function makeLeg(sideX) {
    const hip = new THREE.Group();
    hip.position.set(sideX, 0.8, 0);
    const thigh = box(0.15, 0.4, 0.17, pants);
    thigh.position.y = -0.2;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.4, 0);
    const shin = box(0.13, 0.38, 0.15, pants);
    shin.position.y = -0.19;
    knee.add(shin);
    const foot = box(0.14, 0.07, 0.26, shoe);
    foot.position.set(0, -0.38, 0.05);
    knee.add(foot);
    hip.add(knee);
    group.add(hip);
    return { hip, knee };
  }
  const legL = makeLeg(-0.1);
  const legR = makeLeg(0.1);

  // --- arms: shoulder pivots on the chest, elbows halfway down.
  // The shoulders sit OUTSIDE the torso (torso half-width 0.19) and the
  // arms tilt slightly outward, so they never sink into the chest. ---
  function makeArm(sideX) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sideX, 1.22, 0);
    // outward tilt: left arm leans left, right arm leans right
    shoulder.rotation.z = sideX < 0 ? -0.12 : 0.12;
    const upper = box(0.11, 0.3, 0.12, shirt);
    upper.position.y = -0.15;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.3, 0);
    elbow.rotation.x = -0.2; // elbows rest slightly bent
    const fore = box(0.1, 0.28, 0.11, skin);
    fore.position.y = -0.14;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
    hand.position.y = -0.3;
    elbow.add(hand);
    shoulder.add(elbow);
    group.add(shoulder);
    return { shoulder, elbow, hand };
  }
  const armL = makeArm(-0.24);
  const armR = makeArm(0.24);

  // --- pistol: a dark handgun in the right hand. The muzzle flash is a
  // child of the gun, so flash and barrel can never drift apart. ---
  const gun = new THREE.Group();
  gun.position.set(0, -0.3, 0.06);
  const gunBody = box(0.05, 0.09, 0.2, standard(0x15181d, 0.35, 0.7));
  gunBody.position.set(0, 0, 0.05);
  gun.add(gunBody);
  const barrel = box(0.035, 0.035, 0.12, standard(0x0c0e11, 0.3, 0.8));
  barrel.position.set(0, 0.02, 0.2);
  gun.add(barrel);
  armR.elbow.add(gun);

  // Muzzle flash: one small warm radial glow, no bigger than the gun
  // itself, additive so it reads as light rather than a paper cutout.
  // Two crossed planes give it volume from any angle.
  const flashTex = glowCanvasTexture(
    "rgba(255,251,230,0.98)",
    "rgba(255,170,51,0.7)",
    "rgba(255,69,0,0)",
  );
  const flashMat = new THREE.MeshBasicMaterial({
    map: flashTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const flashA = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.34), flashMat);
  flashA.position.set(0, 0.02, 0.3);
  gun.add(flashA);
  const flashB = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.34), flashMat);
  flashB.position.set(0, 0.02, 0.3);
  flashB.rotation.z = Math.PI / 2;
  gun.add(flashB);
  const flashLight = new THREE.PointLight(0xffc832, 0, 5);
  flashLight.position.set(0, 0.02, 0.3);
  gun.add(flashLight);

  // Two faint smoke puffs that rise and fade after each shot.
  const smokeTex = glowCanvasTexture(
    "rgba(220,220,220,0.5)",
    "rgba(180,180,180,0.25)",
    "rgba(160,160,160,0)",
  );
  const smokes = [];
  for (let i = 0; i < 2; i++) {
    const sm = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTex, transparent: true, opacity: 0, depthWrite: false,
    }));
    sm.position.set(i === 0 ? -0.04 : 0.04, 0.05, 0.32);
    sm.scale.set(0.16, 0.16, 1);
    sm.visible = false;
    gun.add(sm);
    smokes.push(sm);
  }

  const player = {
    group, torso, head,
    legL: legL.hip, legR: legR.hip,
    shinL: legL.knee, shinR: legR.knee,
    armL: armL.shoulder, armR: armR.shoulder,
    foreL: armL.elbow, foreR: armR.elbow,
    gun, flashMat, flashLight, smokes,
    pos: { x: 0, y: 0, z: 0 },
    heading: 0,
    speed: 0,
    walkPhase: 0,
    weapon: "pistol",
    punchTimer: 0,
    flashTimer: 0,
    smokeTimer: 0,
    lastShotAt: -99,
    inCar: false,
  };
  S.player = player;
  S.scene.add(group);
  return player;
}

// ---------------------------------------------------------------------------
// Movement + animation (on foot only)
// ---------------------------------------------------------------------------

const WALK_SPEED = 4.2;
const RUN_SPEED = 7.6;
const WORLD_EDGE = 186;

export function updatePlayer(dt) {
  const p = S.player;
  if (!p) return;
  // Driving hides the whole body: the driver never sticks out of a roof.
  // The frame loop only calls this while on foot, so this is a safety net;
  // enterCar/exitCar in vehicles.js do the same toggle at the transition.
  p.group.visible = S.onFoot;
  if (!S.onFoot) return;

  // --- read input, move relative to the camera ---
  const keys = S.keys || {};
  const yaw = S.camYaw;
  let fx = -Math.sin(yaw);
  let fz = -Math.cos(yaw);
  let rx = Math.cos(yaw);
  let rz = -Math.sin(yaw);
  let mx = 0;
  let mz = 0;
  if (keys.KeyW) { mx += fx; mz += fz; }
  if (keys.KeyS) { mx -= fx; mz -= fz; }
  if (keys.KeyD) { mx += rx; mz += rz; }
  if (keys.KeyA) { mx -= rx; mz -= rz; }
  const moving = mx !== 0 || mz !== 0;
  const wantSpeed = moving ? (keys.ShiftLeft || keys.ShiftRight ? RUN_SPEED : WALK_SPEED) : 0;
  // smooth acceleration so starts and stops read as weight, not teleporting
  p.speed += (wantSpeed - p.speed) * Math.min(1, dt * 10);
  if (moving) {
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    p.pos.x += mx * p.speed * dt;
    p.pos.z += mz * p.speed * dt;
    // face the direction of travel, easing around instead of snapping
    const targetHeading = Math.atan2(mx, mz);
    let diff = targetHeading - p.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.heading += diff * Math.min(1, dt * 12);
  }
  p.pos.x = clamp(p.pos.x, -WORLD_EDGE, WORLD_EDGE);
  p.pos.z = clamp(p.pos.z, -WORLD_EDGE, WORLD_EDGE);
  resolveCollisions(p.pos, 0.5);

  // --- walk cycle: legs and arms swing in opposition ---
  if (p.speed > 0.3) {
    p.walkPhase += p.speed * dt * 1.7;
    const swing = Math.sin(p.walkPhase) * 0.55;
    p.legL.rotation.x = swing;
    p.legR.rotation.x = -swing;
    p.armL.rotation.x = -swing * 0.7;
    // the gun arm stays steadier so the pistol does not flail
    p.armR.rotation.x = swing * 0.25;
  } else {
    p.legL.rotation.x *= 0.85;
    p.legR.rotation.x *= 0.85;
    p.armL.rotation.x *= 0.85;
    p.armR.rotation.x *= 0.85;
  }

  // --- punch: the right arm jabs forward while the timer runs ---
  if (p.punchTimer > 0) {
    p.punchTimer -= dt;
    p.armR.rotation.x = -1.3;
  }

  // --- the pistol's draw state lives in combat.js (it owns gun.visible
  // and the 2.5 s auto-holster); here only the smoke is animated ---
  // --- smoke puffs rise, swell and fade after each shot ---
  if (p.smokeTimer > 0) {
    p.smokeTimer -= dt;
    const age = 1 - Math.max(0, p.smokeTimer) / 0.35;
    for (let i = 0; i < p.smokes.length; i++) {
      const sm = p.smokes[i];
      sm.visible = true;
      sm.position.y = 0.05 + age * 0.45;
      const size = 0.16 + age * 0.4;
      sm.scale.set(size, size, 1);
      sm.material.opacity = 0.28 * (1 - age);
    }
  } else {
    for (const sm of p.smokes) sm.visible = false;
  }

  // --- push the visible rig to the logical position ---
  p.group.position.set(p.pos.x, 0, p.pos.z);
  p.group.rotation.y = p.heading;
}

// ---------------------------------------------------------------------------
// Over-shoulder camera (on foot)
// ---------------------------------------------------------------------------

export function updateCamera(dt) {
  const p = S.player;
  if (!p || !S.camera) return;
  const yaw = S.camYaw;
  const pitch = clamp(S.camPitch, -0.15, 0.85);
  const dist = S.camDist;
  // where the lens looks: the player's chest, offset to the right shoulder
  const sideX = Math.cos(yaw);
  const sideZ = -Math.sin(yaw);
  const lookX = p.pos.x + sideX * 0.52;
  const lookZ = p.pos.z + sideZ * 0.52;
  const lookY = 1.55;
  // where the lens sits: behind the player, up by the pitch, with the
  // familiar 0.35 m drop that keeps the hero low in the frame
  const backX = Math.sin(yaw) * Math.cos(pitch);
  const backZ = Math.cos(yaw) * Math.cos(pitch);
  const up = Math.sin(pitch);
  const wantX = lookX + backX * dist;
  const wantY = lookY + up * dist - 0.35;
  const wantZ = lookZ + backZ * dist;
  const cam = S.camera;
  const ease = Math.min(1, dt * 10);
  cam.position.x += (wantX - cam.position.x) * ease;
  cam.position.y += (wantY - cam.position.y) * ease;
  cam.position.z += (wantZ - cam.position.z) * ease;
  cam.lookAt(lookX, lookY, lookZ);
}

// ---------------------------------------------------------------------------
// Aiming helpers for combat.js
// ---------------------------------------------------------------------------

const _dir = new THREE.Vector3();
const _tip = new THREE.Vector3();

export function aimDirection(out) {
  S.camera.getWorldDirection(_dir);
  if (out) {
    out.copy(_dir);
    return out;
  }
  return _dir.clone();
}

export function muzzleWorldPos(out) {
  // The barrel tip in gun space, carried into the world by the gun's
  // own transform chain (arm -> group -> scene).
  const p = S.player;
  _tip.set(0, 0.02, 0.32);
  p.gun.localToWorld(_tip);
  if (out) {
    out.copy(_tip);
    return out;
  }
  return _tip.clone();
}

// The player walks out of buildings instead of through them. The city
// module owns the collider list, so this import is one-way (city never
// imports the player) and cannot cycle.
import { resolveCollisions } from "./city.js";
