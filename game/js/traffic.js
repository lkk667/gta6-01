// Solmar City — traffic cars + pedestrians.
//
// The street has to feel alive, not scripted. So every pedestrian has
// a purpose: most walk the sidewalks (never the road) along a lane
// beside a road, some cross at the crosswalks, some wait at the kerb,
// some stand in pairs talking, some sit on a bench, some stand on
// their phone, a few jog and a few stroll. They switch between these
// states on their own. The city also reacts: gunfire or a stolen car
// makes nearby pedestrians run with their arms up, and anyone who sees
// it reports it — a "!" pops above them and the wanted level climbs.
// A car coming at a pedestrian makes them sidestep. Traffic cars stop
// at red lights, ease off at yellow, brake for people in the road, and
// honk when a pedestrian or another car blocks them (never at a red
// light). 28 cars loop the road grid; 40 pedestrians live on the
// sidewalks. Every figure is built from smooth forms — a tapered torso,
// capsule limbs, rounded shoes — so the crowd reads as people, not
// toys, even up close.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, dist2, clamp } from './state.js';
import { makeCar } from './vehicles.js';
import { attachBlob, resolveCollisions, trafficLightState } from './city.js';

const TOPS = [0xe84a4a, 0x4a8ae8, 0x4ad87a, 0xe8d84a, 0xd87ab8, 0x7ad8d8, 0xf2f2f2, 0x8a5a3a, 0xe87a2a, 0x9a6ad8, 0x3a8a6a, 0xd8d8d8];
const COMPLEXIONS = [0xe8b88a, 0xc88a5a, 0x8a5a34, 0xf2c8a0];
const BOTTOMS = [0x2c2f36, 0x3a4a6a, 0x6a3a3a, 0x4a5a3a, 0x8a7a5a];

// Walking speeds by gait. A jogger is visibly faster than a stroller.
const GAITS = { stroll: 1.2, walk: 2.2, jog: 3.8, cross: 2.6, flee: 4.6 };

// How far off a road's centre the sidewalk lane sits (road half-width
// 5 plus the kerb, so feet stay on pavement, not asphalt).
const KERB_OFF = 6.5;

// ------------------------------------------------------------ "!" badge

// One shared texture for every witness / honk badge: a red disc with a
// white exclamation mark. Sprites share it, so 68 badges cost one canvas.
let badgeTex = null;
function badgeTexture() {
  if (badgeTex) return badgeTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const pen = canvas.getContext('2d');
  pen.beginPath();
  pen.arc(32, 32, 28, 0, Math.PI * 2);
  pen.fillStyle = '#e82a2a';
  pen.fill();
  pen.lineWidth = 4;
  pen.strokeStyle = '#ffffff';
  pen.stroke();
  pen.fillStyle = '#ffffff';
  pen.font = 'bold 40px Arial, sans-serif';
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  pen.fillText('!', 32, 34);
  badgeTex = new THREE.CanvasTexture(canvas);
  return badgeTex;
}

// A badge sprite floating above a head (or a car roof). Hidden until
// something needs to flag it. Raycast is disabled on it, so a shot
// aimed past a "!" never counts as hitting the person under it.
function makeBadge(y, size) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: badgeTexture(), transparent: true, depthWrite: false,
  }));
  sprite.scale.set(size, size, 1);
  sprite.position.y = y;
  sprite.visible = false;
  sprite.raycast = () => {};
  return sprite;
}

// ------------------------------------------------------------ pedestrians

// Build one pedestrian: a tapered figure with a neck, a head small next
// to the shoulders, two slim capsule legs with a gap, capsule arms at
// the sides, and rounded shoes that swing with the walk. A few carry a
// bag on their back; every figure gets a phone in the right hand
// (hidden unless they are using it) and a "!" badge above the head
// (hidden unless they witness a crime).
function makeWalker() {
  const root = new THREE.Group();
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const shirt = new THREE.MeshLambertMaterial({ color: pick(TOPS) });
  const skin = new THREE.MeshLambertMaterial({ color: pick(COMPLEXIONS) });
  const trousers = new THREE.MeshLambertMaterial({ color: pick(BOTTOMS) });
  const shoes = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
  // The tapered torso: one smooth cylinder, chest wider than the waist,
  // squashed front-to-back into an ellipse, plus a flattened sphere
  // across the top to round the shoulders off.
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.16, 0.55, 12), shirt);
  chest.position.y = 1.12;
  chest.scale.set(1.15, 1, 0.75);
  chest.castShadow = true;
  root.add(chest);
  const shoulderBar = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), shirt);
  shoulderBar.position.y = 1.38;
  shoulderBar.scale.set(1.1, 0.5, 0.7);
  root.add(shoulderBar);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8), skin);
  neck.position.y = 1.46;
  root.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), skin);
  head.position.y = 1.6;
  head.castShadow = true;
  root.add(head);
  // A cap, hair, or a bare head, so the crowd is not one haircut.
  const style = Math.random();
  if (style < 0.35) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.08, 10), new THREE.MeshLambertMaterial({ color: pick(TOPS) }));
    hat.position.y = 1.76;
    root.add(hat);
  } else if (style < 0.65) {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2c2018 }));
    hair.position.y = 1.62;
    root.add(hair);
  }
  // Two slim legs with a gap, pivoting at the hip. Capsules, shifted
  // down so their tops sit at the mesh origin (the hip joint).
  const legShape = new THREE.CapsuleGeometry(0.08, 0.52, 6, 10);
  legShape.translate(0, -0.31, 0);
  const shinL = new THREE.Mesh(legShape, trousers);
  shinL.position.set(-0.11, 0.68, 0);
  root.add(shinL);
  const shinR = shinL.clone();
  shinR.position.x = 0.11;
  root.add(shinR);
  // Arms hang at the sides, pivoting at the shoulder, capsules again.
  const armShape = new THREE.CapsuleGeometry(0.062, 0.46, 6, 10);
  armShape.translate(0, -0.27, 0);
  const foreL = new THREE.Mesh(armShape, shirt);
  foreL.position.set(-0.3, 1.32, 0);
  root.add(foreL);
  const foreR = foreL.clone();
  foreR.position.x = 0.3;
  root.add(foreR);
  // Shoes ride on the legs so they swing with the walk: a capsule laid
  // flat, rounded at the toe and the heel.
  const shoeShape = new THREE.CapsuleGeometry(0.07, 0.12, 4, 8);
  shoeShape.rotateX(Math.PI / 2);
  const shoeL = new THREE.Mesh(shoeShape, shoes);
  shoeL.position.set(0, -0.64, 0.03);
  shinL.add(shoeL);
  const shoeR = new THREE.Mesh(shoeShape, shoes);
  shoeR.position.set(0, -0.64, 0.03);
  shinR.add(shoeR);
  // A bag on the back for about a quarter of the crowd.
  if (Math.random() < 0.25) {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.12), new THREE.MeshLambertMaterial({ color: pick([0x6a4a2a, 0x2c2f36, 0x8a2a2a]) }));
    bag.position.set(0, 1.15, -0.2);
    root.add(bag);
  }
  // A phone in the right hand, held low until the owner uses it.
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.03), new THREE.MeshBasicMaterial({ color: 0x14161a }));
  phone.position.set(0, -0.58, 0.1);
  phone.visible = false;
  foreR.add(phone);
  // The witness badge, floating above the head.
  const badge = makeBadge(2.4, 0.9);
  root.add(badge);
  // Not every pedestrian is the same height.
  const scale = 0.9 + Math.random() * 0.2;
  root.scale.set(scale, scale, scale);
  return { group: root, leftLeg: shinL, rightLeg: shinR, leftArm: foreL, rightArm: foreR, head, phone, mark: badge };
}

// Snap a free (x, z) onto the nearest sidewalk lane: the closest road,
// the nearer side of it, walking either way along it.
function nearestTrack(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const road of WORLD.roads) {
    for (const axis of ['ns', 'ew']) {
      for (const side of [1, -1]) {
        const lx = axis === 'ns' ? road + side * KERB_OFF : x;
        const lz = axis === 'ew' ? road + side * KERB_OFF : z;
        const d = axis === 'ns' ? Math.abs(x - lx) : Math.abs(z - lz);
        if (d < bestD) {
          bestD = d;
          best = { axis, road, side, dir: Math.random() > 0.5 ? 1 : -1 };
        }
      }
    }
  }
  return best;
}

export function buildTraffic() {
  // Traffic cars: 28, spread round-robin over the roads so every street
  // carries 3-4 moving cars. Mixed models: mostly sedans, some taxis, a
  // few trucks. Each one gets a honk badge above its roof.
  const roads = [...WORLD.roads];
  for (let i = 0; i < 28; i += 1) {
    const alongX = Math.random() > 0.5;
    const road = roads[i % roads.length];
    const roll = Math.random();
    const kind = roll < 0.2 ? 'taxi' : roll < 0.35 ? 'truck' : 'sedan';
    const mesh = makeCar(undefined, false, kind);
    const x = alongX ? -160 + Math.random() * 320 : road + (Math.random() > 0.5 ? 2.4 : -2.4);
    const z = alongX ? road + (Math.random() > 0.5 ? 2.4 : -2.4) : -160 + Math.random() * 320;
    mesh.position.set(x, 0, z);
    const heading = alongX ? (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2) : (Math.random() > 0.5 ? 0 : Math.PI);
    mesh.rotation.y = heading;
    const badge = makeBadge(2.6, 1.0);
    mesh.add(badge);
    S.scene.add(mesh);
    attachBlob(mesh, 4.6, 0.03);
    S.trafficCars.push({
      mesh, heading, mark: badge,
      speed: 7 + Math.random() * 4,
      alongX,
      road,
      cruise: 7 + Math.random() * 4,
      blockedT: 0,
      blockWhy: null,
      honkAt: 0,
      markT: 0,
    });
  }
  // Pedestrians: 40, each with a purpose. 22 sidewalk walkers (a mix of
  // strollers, walkers and joggers), 6 talkers in 3 pairs, 4 waiting at
  // kerbs, 4 on their phones, 2 sitting on benches, 2 crossing at a
  // crosswalk.
  const plan = [
    ...Array(22).fill('walk'),
    ...Array(6).fill('talk'),
    ...Array(4).fill('wait'),
    ...Array(4).fill('phone'),
    ...Array(2).fill('sit'),
    ...Array(2).fill('cross'),
  ];
  for (let i = 0; i < 40; i += 1) {
    const built = makeWalker();
    const mode = plan[i];
    const x = -140 + Math.random() * 280;
    const z = -140 + Math.random() * 280;
    built.group.position.set(x, 0, z);
    S.scene.add(built.group);
    attachBlob(built.group, 1.4, 0.03);
    // The gait: strollers amble, joggers hurry; talkers and sitters stand.
    const gaitRoll = Math.random();
    const gait = gaitRoll < 0.2 ? 'stroll' : gaitRoll < 0.8 ? 'walk' : 'jog';
    const walker = {
      mesh: built.group,
      legL: built.leftLeg,
      legR: built.rightLeg,
      armL: built.leftArm,
      armR: built.rightArm,
      head: built.head,
      phone: built.phone,
      mark: built.mark,
      heading: Math.random() * Math.PI * 2,
      speed: GAITS[gait],
      pace: gait,
      walkPhase: Math.random() * 6,
      fleeTimer: 0,
      stumble: 0,
      retarget: 0,
      mode,
      stateT: 5 + Math.random() * 20,
      lane: nearestTrack(x, z),
      partner: null,
      witness: 0,
      reportAt: 0,
      decideAt: 0,
      talkPhase: Math.random() * 6,
    };
    // Talkers arrive in pairs, standing side by side on a sidewalk.
    if (mode === 'talk' && i % 2 === 1) {
      const other = S.peds[i - 1];
      walker.partner = other;
      other.partner = walker;
      const track = other.lane;
      walker.lane = track;
      // Stand beside the partner, across the walking direction.
      const offX = track.axis === 'ns' ? 1.2 : 0;
      const offZ = track.axis === 'ew' ? 1.2 : 0;
      walker.mesh.position.set(other.mesh.position.x + offX, 0, other.mesh.position.z + offZ);
      walker.heading = Math.atan2(other.mesh.position.x - walker.mesh.position.x, other.mesh.position.z - walker.mesh.position.z);
      other.heading = Math.atan2(walker.mesh.position.x - other.mesh.position.x, walker.mesh.position.z - other.mesh.position.z);
    }
    // Sitters take a bench when one is free.
    if (mode === 'sit' && S.benches.length > 0) {
      const bench = S.benches[i % S.benches.length];
      walker.mesh.position.set(bench.x, 0, bench.z);
      walker.heading = Math.random() * Math.PI * 2;
    }
    // Crossers start mid-crossing at an intersection.
    if (mode === 'cross') {
      const rx = WORLD.roads[Math.floor(Math.random() * WORLD.roads.length)];
      const rz = WORLD.roads[Math.floor(Math.random() * WORLD.roads.length)];
      const ns = Math.random() > 0.5;
      walker.mesh.position.set(ns ? rx : rx + 7.2, 0, ns ? rz + 7.2 : rz);
      walker.heading = ns ? 0 : Math.PI / 2;
      walker.crossFrom = 1;
      walker.crossAxis = ns ? 'ns' : 'ew';
      walker.crossRoad = ns ? rx : rz;
    }
    S.peds.push(walker);
  }
}

// Pedestrians within earshot run from a gunshot or a punch.
export function scarePeds(x, z, radius) {
  for (const walker of S.peds) {
    if (dist2(x, z, walker.mesh.position.x, walker.mesh.position.z) < radius) {
      walker.mode = 'flee';
      walker.stateT = 2.5 + Math.random();
      walker.fleeTimer = walker.stateT;
      const dx = walker.mesh.position.x - x;
      const dz = walker.mesh.position.z - z;
      walker.heading = Math.atan2(dx, dz);
    }
  }
}

// A crime in the open: everyone close enough sees it, runs, and reports
// it. The "!" pops above each witness for a few seconds, and the wanted
// level climbs — at most about a star per incident, so one shot in a
// crowd does not jump straight to five stars.
export function reportCrime(x, z, radius) {
  let seen = 0;
  for (const walker of S.peds) {
    if (dist2(x, z, walker.mesh.position.x, walker.mesh.position.z) > radius) continue;
    if (S.time < walker.reportAt) continue; // this one already reported recently
    walker.reportAt = S.time + 5;
    walker.witness = 3;
    walker.mode = 'flee';
    walker.stateT = 2.5 + Math.random();
    walker.fleeTimer = walker.stateT;
    const dx = walker.mesh.position.x - x;
    const dz = walker.mesh.position.z - z;
    walker.heading = Math.atan2(dx, dz);
    seen += 1;
  }
  if (seen > 0) {
    const heat = Math.min(4 * seen, 12);
    S.heat = Math.max(0, Math.min(100, S.heat + heat));
  }
  return seen;
}

// All cars that can hit a pedestrian: traffic, cruisers, the player's car.
function carThreat(walker) {
  const px = walker.mesh.position.x;
  const pz = walker.mesh.position.z;
  const threats = [];
  for (const auto of S.trafficCars) threats.push({ x: auto.mesh.position.x, z: auto.mesh.position.z, speed: auto.speed, heading: auto.heading });
  for (const unit of S.cruisers) threats.push({ x: unit.mesh.position.x, z: unit.mesh.position.z, speed: unit.speed || 10, heading: unit.heading });
  if (S.currentCar) threats.push({ x: S.currentCar.mesh.position.x, z: S.currentCar.mesh.position.z, speed: S.currentCar.speed, heading: S.currentCar.heading });
  for (const threat of threats) {
    const dx = px - threat.x;
    const dz = pz - threat.z;
    const d = Math.hypot(dx, dz);
    if (d < 9 && Math.abs(threat.speed) > 2) {
      // Is the car heading toward the pedestrian?
      const fx = Math.sin(threat.heading) * Math.sign(threat.speed);
      const fz = Math.cos(threat.heading) * Math.sign(threat.speed);
      const closing = -(dx * fx + dz * fz) / (d || 1); // above 0 means closing
      if (closing > 0.35) return { t: threat, d, dx, dz };
    }
  }
  return null;
}

export function updateTraffic(dt) {
  if (S.debug.freezeTraffic) return; // a staged shot: cars hold their poses
  for (const auto of S.trafficCars) {
    // Work out the speed the car wants, and why it might not get it.
    let target = auto.cruise;
    let why = null;
    const fx = Math.sin(auto.heading);
    const fz = Math.cos(auto.heading);
    // Brake for a pedestrian directly ahead in the road.
    for (const walker of S.peds) {
      const dx = walker.mesh.position.x - auto.mesh.position.x;
      const dz = walker.mesh.position.z - auto.mesh.position.z;
      const ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (ahead > 0 && ahead < 9 && side < 2.2) {
        target = 0;
        why = 'ped';
        break;
      }
    }
    // Obey traffic lights: stop at red, ease off at yellow. A red light
    // is never a reason to honk, so it gets its own flag.
    if (why === null && S.trafficLights) {
      const axis = Math.abs(fx) > 0.7 ? 'ew' : 'ns';
      for (const lamp of S.trafficLights) {
        const dx = lamp.x - auto.mesh.position.x;
        const dz = lamp.z - auto.mesh.position.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 14 && side < 9) {
          const state = trafficLightState(axis);
          if (state === 'red') {
            target = 0;
            why = 'light';
          } else if (state === 'yellow') {
            target = Math.min(target, 3);
          }
          break;
        }
      }
    }
    // Ease off near the player's car too.
    if (why === null && S.currentCar) {
      const d = dist2(auto.mesh.position.x, auto.mesh.position.z, S.currentCar.mesh.position.x, S.currentCar.mesh.position.z);
      if (d < 7) {
        target = Math.min(target, 2);
        why = 'car';
      }
    }
    // Honk when blocked by a person or a car for a while, not at a
    // light. A short horn plus the "!" above the roof; a few seconds
    // between honks.
    if (target === 0 && (why === 'ped' || why === 'car')) {
      auto.blockedT += dt;
      if (auto.blockedT > 1.5 && S.time >= auto.honkAt) {
        auto.honkAt = S.time + 4;
        auto.markT = 1.2;
        if (S.audio) S.audio.horn();
      }
    } else {
      auto.blockedT = 0;
    }
    if (auto.markT > 0) {
      auto.markT -= dt;
      auto.mark.visible = auto.markT > 0;
    } else {
      auto.mark.visible = false;
    }
    auto.speed += (target - auto.speed) * Math.min(1, dt * 2);
    auto.mesh.position.x += Math.sin(auto.heading) * auto.speed * dt;
    auto.mesh.position.z += Math.cos(auto.heading) * auto.speed * dt;
    // Turn at intersections, keep inside the city.
    const px = auto.mesh.position.x;
    const pz = auto.mesh.position.z;
    const onRoadX = WORLD.roads.some((r) => Math.abs(pz - r) < 1.2);
    const onRoadZ = WORLD.roads.some((r) => Math.abs(px - r) < 1.2);
    if ((onRoadX || onRoadZ) && Math.random() < dt * 0.25) {
      const turn = (Math.random() - 0.5) * Math.PI;
      auto.heading += turn;
      auto.alongX = Math.abs(Math.sin(auto.heading)) > 0.7;
    }
    if (px > 175 || px < -175 || pz > 175 || pz < -175) {
      auto.heading += Math.PI;
      auto.mesh.position.x = clamp(px, -170, 170);
      auto.mesh.position.z = clamp(pz, -170, 170);
    }
    auto.mesh.rotation.y = auto.heading;
    for (const w of auto.mesh.userData.wheels) w.rotation.x += auto.speed * dt * 2.4;
  }
}

// ------------------------------------------------------------ pedestrians

// Put a walking pedestrian back on a sidewalk lane after they finish a
// crossing, a talk, or a flee: the nearest lane to where they stand.
function backToLane(walker) {
  walker.lane = nearestTrack(walker.mesh.position.x, walker.mesh.position.z);
  walker.mode = walker.pace; // stroll / walk / jog again
  walker.stateT = 5 + Math.random() * 15;
}

export function updatePeds(dt) {
  for (const walker of S.peds) {
    // Knocked down: lie flat briefly, then get up.
    if (walker.stumble > 0) {
      walker.stumble -= dt;
      walker.mesh.rotation.x = -0.5 * Math.max(0, walker.stumble / 0.5);
      walker.mesh.position.y = 0;
      continue;
    }
    walker.mesh.rotation.x = 0;
    // The witness "!" fades a few seconds after the crime.
    if (walker.witness > 0) {
      walker.witness -= dt;
      walker.mark.visible = walker.witness > 0;
    } else {
      walker.mark.visible = false;
    }
    // A car bearing down on them: sidestep out of its path, arms up.
    const threat = carThreat(walker);
    if (threat && threat.d < 8 && walker.mode !== 'flee' && walker.mode !== 'sit') {
      const sideX = Math.cos(threat.t.heading);
      const sideZ = -Math.sin(threat.t.heading);
      const toWalker = (walker.mesh.position.x - threat.t.x) * sideX + (walker.mesh.position.z - threat.t.z) * sideZ;
      const dir = toWalker >= 0 ? 1 : -1;
      walker.heading = Math.atan2(sideX * dir, sideZ * dir);
      walker.mode = 'flee';
      walker.stateT = Math.max(walker.stateT, 0.8);
      walker.fleeTimer = Math.max(walker.fleeTimer, 0.8);
    }
    // The state timer: when a state runs out, pick the next one.
    if (walker.stateT > 0) walker.stateT -= dt;
    let pace = walker.speed;
    const at = walker.mesh.position;
    if (walker.mode === 'flee') {
      pace = GAITS.flee;
      if (walker.stateT <= 0) backToLane(walker);
    } else if (walker.mode === 'cross') {
      pace = GAITS.cross;
      // Walk straight across the road at the crosswalk line, from one
      // sidewalk to the other. The along-road coordinate stays fixed so
      // the crossing happens on the stripes, not diagonally.
      const from = walker.crossFrom || 1;
      const axis = walker.crossAxis || 'ns';
      const road = walker.crossRoad || 0;
      if (axis === 'ns') {
        const goal = road - from * KERB_OFF;
        const step = Math.sign(goal - at.x) * pace * dt;
        at.x += step;
        if (Math.abs(at.x - goal) < 0.3) {
          walker.lane = { axis: 'ns', road, side: -from, dir: Math.random() > 0.5 ? 1 : -1 };
          walker.mode = walker.pace;
          walker.stateT = 5 + Math.random() * 15;
        }
      } else {
        const goal = road - from * KERB_OFF;
        const step = Math.sign(goal - at.z) * pace * dt;
        at.z += step;
        if (Math.abs(at.z - goal) < 0.3) {
          walker.lane = { axis: 'ew', road, side: -from, dir: Math.random() > 0.5 ? 1 : -1 };
          walker.mode = walker.pace;
          walker.stateT = 5 + Math.random() * 15;
        }
      }
      walker.heading = axis === 'ns' ? (from > 0 ? -Math.PI / 2 : Math.PI / 2) : (from > 0 ? Math.PI : 0);
    } else if (walker.mode === 'wait') {
      pace = 0;
      if (walker.stateT <= 0) {
        // Done waiting: cross the road, or walk on.
        if (Math.random() < 0.7 && walker.lane) {
          walker.mode = 'cross';
          walker.crossFrom = walker.lane.side;
          walker.crossAxis = walker.lane.axis;
          walker.crossRoad = walker.lane.road;
          walker.stateT = 30;
        } else {
          backToLane(walker);
        }
      }
    } else if (walker.mode === 'talk') {
      pace = 0;
      // Face the partner and gesture with the hands while talking.
      if (walker.partner) {
        walker.heading = Math.atan2(
          walker.partner.mesh.position.x - at.x,
          walker.partner.mesh.position.z - at.z
        );
      }
      if (walker.stateT <= 0) {
        const other = walker.partner;
        walker.partner = null;
        if (other) other.partner = null;
        backToLane(walker);
        if (other && other.mode === 'talk') backToLane(other);
      }
    } else if (walker.mode === 'sit') {
      pace = 0;
      if (walker.stateT <= 0) {
        at.y = 0;
        backToLane(walker);
      }
    } else if (walker.mode === 'phone') {
      pace = 0;
      if (walker.stateT <= 0) backToLane(walker);
    } else {
      // Stroll / walk / jog along the sidewalk lane.
      pace = walker.speed;
      const track = walker.lane;
      if (!track) {
        walker.lane = nearestTrack(at.x, at.z);
      } else if (track.axis === 'ns') {
        at.x = track.road + track.side * KERB_OFF;
        at.z += track.dir * pace * dt;
        // Near an intersection: maybe turn, maybe cross, maybe keep going.
        const nearCross = WORLD.roads.some((r) => Math.abs(at.z - r) < 3);
        if (nearCross && S.time >= walker.decideAt) {
          walker.decideAt = S.time + 1.5;
          const roll = Math.random();
          if (roll < 0.18) {
            walker.mode = 'cross';
            walker.crossFrom = track.side;
            walker.crossAxis = 'ns';
            walker.crossRoad = track.road;
            walker.stateT = 30;
          } else if (roll < 0.3) {
            // Turn onto the crossing road's sidewalk.
            const crossRoad = WORLD.roads.reduce((a, b) => (Math.abs(b - at.z) < Math.abs(a - at.z) ? b : a));
            walker.lane = { axis: 'ew', road: crossRoad, side: Math.random() > 0.5 ? 1 : -1, dir: Math.random() > 0.5 ? 1 : -1 };
            at.z = crossRoad + walker.lane.side * KERB_OFF;
          } else if (roll < 0.4) {
            // Stop and wait at the kerb for a while, facing the road.
            walker.mode = 'wait';
            walker.stateT = 2 + Math.random() * 3;
            walker.heading = Math.atan2(track.road - at.x, 0);
          }
        }
        if (at.z > 172 || at.z < -172) track.dir *= -1;
        walker.heading = track.dir > 0 ? 0 : Math.PI;
      } else {
        at.z = track.road + track.side * KERB_OFF;
        at.x += track.dir * pace * dt;
        const nearCross = WORLD.roads.some((r) => Math.abs(at.x - r) < 3);
        if (nearCross && S.time >= walker.decideAt) {
          walker.decideAt = S.time + 1.5;
          const roll = Math.random();
          if (roll < 0.18) {
            walker.mode = 'cross';
            walker.crossFrom = track.side;
            walker.crossAxis = 'ew';
            walker.crossRoad = track.road;
            walker.stateT = 30;
          } else if (roll < 0.3) {
            const crossRoad = WORLD.roads.reduce((a, b) => (Math.abs(b - at.x) < Math.abs(a - at.x) ? b : a));
            walker.lane = { axis: 'ns', road: crossRoad, side: Math.random() > 0.5 ? 1 : -1, dir: Math.random() > 0.5 ? 1 : -1 };
            at.x = crossRoad + walker.lane.side * KERB_OFF;
          } else if (roll < 0.4) {
            walker.mode = 'wait';
            walker.stateT = 2 + Math.random() * 3;
            walker.heading = track.side > 0 ? Math.PI : 0;
          }
        }
        if (at.x > 172 || at.x < -172) track.dir *= -1;
        walker.heading = track.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    // Move (except for the standing states, which set pace 0 above).
    if (walker.mode === 'flee') {
      at.x += Math.sin(walker.heading) * pace * dt;
      at.z += Math.cos(walker.heading) * pace * dt;
      resolveCollisions(at, 0.4);
    } else if (walker.mode !== 'cross' && walker.mode !== 'wait' && walker.mode !== 'talk' && walker.mode !== 'sit' && walker.mode !== 'phone') {
      // Walking modes already moved along their lane above; just keep
      // them out of buildings.
      resolveCollisions(at, 0.4);
    }
    walker.mesh.rotation.y = walker.heading;
    // The walk cycle, or the pose for the current state.
    walker.walkPhase += dt * pace * 2.2;
    const swing = Math.min(1, pace / 4) * 0.5;
    if (walker.mode === 'flee') {
      // Arms up, wobbling, while running.
      const wob = Math.sin(S.time * 9 + walker.talkPhase) * 0.25;
      walker.armL.rotation.x = -2.3 + wob;
      walker.armR.rotation.x = -2.3 - wob;
      walker.legL.rotation.x = Math.sin(walker.walkPhase) * 0.7;
      walker.legR.rotation.x = -Math.sin(walker.walkPhase) * 0.7;
    } else if (walker.mode === 'talk') {
      // Hands gesture while talking; legs still.
      const gesture = Math.sin(S.time * 3 + walker.talkPhase) * 0.35;
      walker.armL.rotation.x = -0.6 + gesture;
      walker.armR.rotation.x = -0.6 - gesture;
      walker.legL.rotation.x = 0;
      walker.legR.rotation.x = 0;
    } else if (walker.mode === 'sit') {
      // Seated: hips down on the bench, thighs forward, arms relaxed.
      at.y = 0.45;
      walker.legL.rotation.x = -1.5;
      walker.legR.rotation.x = -1.5;
      walker.armL.rotation.x = 0.1;
      walker.armR.rotation.x = 0.1;
    } else if (walker.mode === 'phone') {
      // The phone up in the right hand, head tipped down at the screen.
      walker.phone.visible = true;
      walker.armR.rotation.x = -1.1;
      walker.armL.rotation.x = 0;
      walker.head.rotation.x = 0.3;
      walker.legL.rotation.x = 0;
      walker.legR.rotation.x = 0;
    } else if (walker.mode === 'wait') {
      walker.phone.visible = false;
      walker.head.rotation.x = 0;
      walker.legL.rotation.x = 0;
      walker.legR.rotation.x = 0;
      walker.armL.rotation.x = 0;
      walker.armR.rotation.x = 0;
    } else {
      walker.phone.visible = false;
      walker.head.rotation.x = 0;
      walker.legL.rotation.x = Math.sin(walker.walkPhase) * swing;
      walker.legR.rotation.x = -Math.sin(walker.walkPhase) * swing;
      walker.armL.rotation.x = -Math.sin(walker.walkPhase) * swing * 0.9;
      walker.armR.rotation.x = Math.sin(walker.walkPhase) * swing * 0.9;
    }
  }
}
