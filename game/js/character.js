// Phase 2 polish: torso overlaps the waistband and shoulders get ball joints so no light leaks through the joints; the legs read as one continuous figure.
// Solmar City — people: realistic-proportion pedestrians.
//
// Forty pedestrians share one set of lathe-turned body-part geometries
// (tapered torso, muscled thighs and calves, two-part arms), so the
// crowd costs no more than a handful of unique meshes. Each figure is
// built to about seven and a half heads tall, with a soft canvas face,
// a beach outfit (or a harbour vest, or a police uniform), and real
// two-segment joints: thigh and shin, upper arm and forearm, plus a
// neck that lets the head turn on its own. The walk cycle in traffic.js
// drives the pivots this file exposes.
//
// The return shape matches what traffic.js expects:
//   group, leftLeg, rightLeg, leftArm, rightArm, head, phone, mark
// plus the extra joints the walk cycle bends:
//   shinL, shinR, foreL, foreR, chest (for breathing).

import * as THREE from "../vendor/three.module.min.js";

// ---------------------------------------------------------------- palettes

const SKIN_TONES = [0xe8b98a, 0xd9a06e, 0xc98a5a, 0xf2c9a0, 0xb87a4e, 0x8a5a38];
const SHIRT_DYES = [
  0xe85a5a, 0x3a7ad8, 0x4ad87a, 0xe8c832, 0xd87ab8, 0x7ad8d8,
  0xf2f2f2, 0x2c2f36, 0xe87a2a, 0x8a4ad8, 0x2a9a8a, 0xc22a4a,
];
const SHORTS_DYES = [0x3a5a8a, 0xe8e8e8, 0x2c2f36, 0xd8a03a, 0x4a7a5a, 0x8a4a2a];
const TROUSER_DYES = [0x2c3a5a, 0x3a3d42, 0x5a4a3a, 0x2c2f36, 0x4a5a6a];
const NAVY = 0x1c2a4a;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---------------------------------------------------------------- shared geometry

// One set of turned body parts, built once and reused by all 40 figures.
// Each profile is a list of [radius, height] points revolved around Y.
let SHARED = null;

function lathe(profile, segments) {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(points, segments || 14);
}

function buildShared() {
  if (SHARED) return SHARED;
  SHARED = {
    // Torso: hips up through a tapered waist, a broad chest, shoulders
    // sloping in to the neck. Scaled flat in Z for an elliptical chest.
    torso: lathe([
      [0.001, 0.0], [0.155, 0.0], [0.165, 0.08], [0.148, 0.22],
      [0.152, 0.3], [0.195, 0.44], [0.205, 0.5], [0.185, 0.56],
      [0.12, 0.6], [0.07, 0.62], [0.001, 0.62],
    ], 16),
    // Pelvis block under the torso, flattened front to back.
    pelvis: lathe([
      [0.001, 0.0], [0.145, 0.0], [0.165, 0.08], [0.155, 0.16],
      [0.1, 0.2], [0.001, 0.2],
    ], 14),
    // Thigh: hip down to knee, a gentle muscle bulge mid-way.
    thigh: lathe([
      [0.001, 0.0], [0.088, 0.0], [0.092, -0.1], [0.082, -0.18],
      [0.068, -0.3], [0.058, -0.37], [0.001, -0.37],
    ], 12),
    // Shin: knee down to ankle, calf bulge, narrow ankle.
    shin: lathe([
      [0.001, 0.0], [0.058, 0.0], [0.062, -0.06], [0.075, -0.16],
      [0.06, -0.26], [0.045, -0.34], [0.001, -0.34],
    ], 12),
    // Upper arm: shoulder to elbow.
    upperArm: lathe([
      [0.001, 0.0], [0.06, 0.0], [0.062, -0.12], [0.052, -0.24],
      [0.048, -0.28], [0.001, -0.28],
    ], 10),
    // Forearm: elbow to wrist, slimmer.
    foreArm: lathe([
      [0.001, 0.0], [0.048, 0.0], [0.05, -0.1], [0.042, -0.2],
      [0.036, -0.25], [0.001, -0.25],
    ], 10),
    // Head: a sphere, slightly taller than wide.
    head: new THREE.SphereGeometry(0.12, 14, 12),
    // Shoe: a flattened, stretched sphere, toe forward.
    shoe: new THREE.SphereGeometry(0.07, 10, 8),
  };
  return SHARED;
}

// Materials are cached by colour so the crowd shares them.
const MAT_CACHE = new Map();
function cloth(color, rough) {
  const key = color + ":" + (rough || 0.85);
  if (!MAT_CACHE.has(key)) {
    MAT_CACHE.set(key, new THREE.MeshStandardMaterial({
      color, roughness: rough || 0.85, metalness: 0.02,
    }));
  }
  return MAT_CACHE.get(key);
}

// ---------------------------------------------------------------- faces

// A soft 256x256 vector face on a transparent canvas: gradient skin
// shading, gentle eyes and brows, a soft nose shadow, lips, a little
// blush. Sunglasses wearers get reflective dark lenses instead of
// eyes. Drawn once per figure; the texture filters smoothly, so there
// is no pixelation at screenshot distance.
function faceTexture(withGlasses, skinTone) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const pen = canvas.getContext("2d");
  // Soft skin shading: lighter in the middle, darker toward the edges.
  const glow = pen.createRadialGradient(128, 128, 20, 128, 128, 150);
  glow.addColorStop(0, "rgba(255, 235, 210, 0.55)");
  glow.addColorStop(1, "rgba(120, 70, 40, 0.28)");
  pen.fillStyle = glow;
  pen.fillRect(0, 0, 256, 256);
  // Blush on the cheeks.
  for (const cx of [78, 178]) {
    const blush = pen.createRadialGradient(cx, 158, 2, cx, 158, 26);
    blush.addColorStop(0, "rgba(235, 110, 110, 0.35)");
    blush.addColorStop(1, "rgba(235, 110, 110, 0)");
    pen.fillStyle = blush;
    pen.beginPath();
    pen.arc(cx, 158, 26, 0, Math.PI * 2);
    pen.fill();
  }
  if (withGlasses) {
    // Reflective sunglasses: dark lenses, a bright diagonal streak.
    for (const cx of [88, 168]) {
      pen.save();
      pen.translate(cx, 108);
      pen.fillStyle = "#101418";
      pen.beginPath();
      pen.roundRect(-34, -20, 68, 42, 14);
      pen.fill();
      pen.fillStyle = "rgba(255, 255, 255, 0.55)";
      pen.beginPath();
      pen.moveTo(-22, 16);
      pen.lineTo(4, -18);
      pen.lineTo(16, -18);
      pen.lineTo(-10, 16);
      pen.closePath();
      pen.fill();
      pen.restore();
    }
    pen.strokeStyle = "#101418";
    pen.lineWidth = 6;
    pen.beginPath();
    pen.moveTo(122, 106);
    pen.lineTo(134, 106);
    pen.stroke();
  } else {
    // Brows: soft arcs.
    pen.strokeStyle = "rgba(60, 35, 20, 0.85)";
    pen.lineWidth = 7;
    pen.lineCap = "round";
    for (const cx of [88, 168]) {
      pen.beginPath();
      pen.arc(cx, 82, 24, Math.PI * 1.15, Math.PI * 1.85);
      pen.stroke();
    }
    // Eyes: dark almond shapes with a catchlight.
    for (const cx of [88, 168]) {
      pen.fillStyle = "#2a2018";
      pen.beginPath();
      pen.ellipse(cx, 108, 13, 8, 0, 0, Math.PI * 2);
      pen.fill();
      pen.fillStyle = "rgba(255, 255, 255, 0.9)";
      pen.beginPath();
      pen.arc(cx + 4, 105, 3, 0, Math.PI * 2);
      pen.fill();
    }
  }
  // Nose: a soft vertical shadow, no hard lines.
  const nose = pen.createLinearGradient(0, 118, 0, 160);
  nose.addColorStop(0, "rgba(120, 70, 40, 0)");
  nose.addColorStop(0.6, "rgba(120, 70, 40, 0.25)");
  nose.addColorStop(1, "rgba(120, 70, 40, 0)");
  pen.fillStyle = nose;
  pen.fillRect(120, 118, 16, 42);
  // Lips: a soft rose ellipse.
  pen.fillStyle = "rgba(190, 90, 90, 0.8)";
  pen.beginPath();
  pen.ellipse(128, 186, 22, 9, 0, 0, Math.PI * 2);
  pen.fill();
  pen.fillStyle = "rgba(220, 140, 130, 0.7)";
  pen.beginPath();
  pen.ellipse(128, 183, 18, 5, 0, 0, Math.PI * 2);
  pen.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

// The witness badge: a bold white "!" on a warm red-orange disc.
function makeBadge() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const pen = canvas.getContext("2d");
  const disc = pen.createRadialGradient(64, 64, 8, 64, 64, 60);
  disc.addColorStop(0, "#ff8a3a");
  disc.addColorStop(1, "#d82a2a");
  pen.fillStyle = disc;
  pen.beginPath();
  pen.arc(64, 64, 58, 0, Math.PI * 2);
  pen.fill();
  pen.strokeStyle = "rgba(255, 255, 255, 0.9)";
  pen.lineWidth = 5;
  pen.beginPath();
  pen.arc(64, 64, 58, 0, Math.PI * 2);
  pen.stroke();
  pen.fillStyle = "#ffffff";
  pen.font = "bold 84px Arial, sans-serif";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  pen.fillText("!", 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(0.55, 0.55, 1);
  sprite.visible = false;
  return sprite;
}

// ---------------------------------------------------------------- the figure

// Build one pedestrian. `role` is "beach" (default), "casual",
// "worker" (harbour hi-vis vest) or "police" (navy uniform + cap).
export function assemblePedestrian(role) {
  const parts = buildShared();
  const kind = role || (Math.random() < 0.55 ? "beach" : "casual");
  const skin = pick(SKIN_TONES);
  const skinMat = cloth(skin, 0.6);
  const shirtColor = kind === "police" ? NAVY : kind === "worker" ? 0xe86a1a : pick(SHIRT_DYES);
  const shirtMat = cloth(shirtColor);
  const bottomColor = kind === "police" ? NAVY : kind === "beach" ? pick(SHORTS_DYES) : pick(TROUSER_DYES);
  const bottomMat = cloth(bottomColor);
  const bareLegs = kind === "beach";
  const figure = new THREE.Group();

  // Pelvis and torso: the chest is kept as its own group so the walk
  // cycle can breathe it in and out for standing figures. The chest
  // sits 0.06 m lower than it used to, so the torso bottom overlaps
  // the pelvis and waistband instead of leaving a light gap at the
  // waist.
  const pelvis = new THREE.Mesh(parts.pelvis, bottomMat);
  pelvis.position.y = 0.8;
  pelvis.scale.set(1.15, 1, 0.8);
  figure.add(pelvis);
  const chest = new THREE.Group();
  chest.position.y = 0.78;
  figure.add(chest);
  const torso = new THREE.Mesh(parts.torso, shirtMat);
  torso.scale.set(1.12, 1, 0.78);
  torso.castShadow = true;
  chest.add(torso);
  if (kind === "worker") {
    // Hi-vis vest: two silver reflective bands around the torso.
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0xd8dde2, roughness: 0.25, metalness: 0.7,
    });
    for (const by of [0.24, 0.42]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.175, 0.045, 14), bandMat);
      band.position.y = by;
      band.scale.set(1.12, 1, 0.78);
      chest.add(band);
    }
  }

  // Neck and head: the head is its own group pivoting at the neck, so
  // it can tip down at a phone or turn to look around.
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.07, 0.12, 8), skinMat
  );
  neck.position.y = 1.46;
  figure.add(neck);
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.52;
  figure.add(headGroup);
  const skull = new THREE.Mesh(parts.head, skinMat);
  skull.position.y = 0.1;
  skull.scale.set(0.92, 1.1, 0.98);
  skull.castShadow = true;
  headGroup.add(skull);
  // The face: a curved canvas band hugging the front of the skull,
  // radius just proud of the skull so it never sinks inside it.
  const glasses = Math.random() < 0.4;
  const faceGeo = new THREE.CylinderGeometry(0.125, 0.125, 0.2, 12, 1, true, -0.6, 1.2);
  const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({
    map: faceTexture(glasses, skin), transparent: true,
  }));
  face.position.y = 0.1;
  headGroup.add(face);
  // Hair, a cap, or a police brimmed cap.
  const hairRoll = Math.random();
  if (kind === "police") {
    const capMat = cloth(NAVY);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.13, 0.07, 12), capMat);
    cap.position.y = 0.21;
    headGroup.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.015, 12), cloth(0x0c0e12));
    brim.position.set(0, 0.185, 0.06);
    brim.scale.set(1, 1, 1.25);
    headGroup.add(brim);
  } else if (hairRoll < 0.35) {
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.125, 0.13, 0.07, 12),
      cloth(pick(SHIRT_DYES))
    );
    cap.position.y = 0.21;
    headGroup.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 12), cloth(0x2c2f36));
    brim.position.set(0, 0.185, 0.08);
    brim.scale.set(1, 1, 1.3);
    headGroup.add(brim);
  } else if (hairRoll < 0.65) {
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.125, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      cloth(0x2c2018, 0.95)
    );
    hair.position.y = 0.11;
    headGroup.add(hair);
  }

  // Legs: thigh pivots at the hip, shin pivots at the knee, shoe rides
  // on the shin so it swings with the walk.
  function buildLeg(sideX) {
    const hip = new THREE.Group();
    hip.position.set(sideX, 0.82, 0);
    figure.add(hip);
    // A ball at the hip joint, so the thigh top never shows a light
    // gap against the pelvis when the leg swings.
    const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), bottomMat);
    hip.add(hipBall);
    const thighMat = bareLegs ? skinMat : bottomMat;
    const thigh = new THREE.Mesh(parts.thigh, thighMat);
    hip.add(thigh);
    if (bareLegs) {
      // Shorts: a short sleeve over the top of the thigh.
      const cuff = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.09, 0.14, 10), bottomMat
      );
      cuff.position.y = -0.06;
      hip.add(cuff);
    }
    const knee = new THREE.Group();
    knee.position.y = -0.37;
    hip.add(knee);
    const shin = new THREE.Mesh(parts.shin, bareLegs ? skinMat : bottomMat);
    knee.add(shin);
    const shoe = new THREE.Mesh(parts.shoe, cloth(0x3a3d42));
    shoe.scale.set(0.9, 0.5, 1.8);
    shoe.position.set(0, -0.35, 0.05);
    knee.add(shoe);
    return { hip, knee };
  }
  const leftLeg = buildLeg(-0.1);
  const rightLeg = buildLeg(0.1);

  // Arms: upper arm pivots at the shoulder, forearm at the elbow.
  function buildArm(sideX) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sideX, 1.4, 0);
    // Arms hang 8 degrees out from the body, not straight down the
    // sides. The walk cycle only writes rotation.x, so this stays.
    shoulder.rotation.z = sideX < 0 ? -0.14 : 0.14;
    figure.add(shoulder);
    // A ball at the shoulder joint, so the upper arm never shows a
    // light gap against the torso when it swings.
    const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), shirtMat);
    shoulder.add(shoulderBall);
    const longSleeve = kind === "police";
    const upper = new THREE.Mesh(parts.upperArm, longSleeve ? shirtMat : skinMat);
    shoulder.add(upper);
    if (!longSleeve) {
      // Short sleeve over the top of the upper arm.
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.068, 0.065, 0.12, 10), shirtMat
      );
      sleeve.position.y = -0.05;
      shoulder.add(sleeve);
    }
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(parts.foreArm, longSleeve ? shirtMat : skinMat);
    elbow.add(fore);
    return { shoulder, elbow };
  }
  const leftArm = buildArm(-0.26);
  const rightArm = buildArm(0.26);

  // A phone in the right hand, held low until the owner uses it.
  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.15, 0.03),
    new THREE.MeshBasicMaterial({ color: 0x14161a })
  );
  phone.position.set(0, -0.27, 0.05);
  phone.visible = false;
  rightArm.elbow.add(phone);

  // The witness badge, floating above the head.
  const badge = makeBadge();
  badge.position.y = 2.0;
  figure.add(badge);

  // Not every pedestrian is the same height.
  const heightScale = 0.92 + Math.random() * 0.16;
  figure.scale.set(heightScale, heightScale, heightScale);
  return {
    group: figure,
    leftLeg: leftLeg.hip, rightLeg: rightLeg.hip,
    shinL: leftLeg.knee, shinR: rightLeg.knee,
    leftArm: leftArm.shoulder, rightArm: rightArm.shoulder,
    foreL: leftArm.elbow, foreR: rightArm.elbow,
    head: headGroup, chest, phone, mark: badge,
  };
}
