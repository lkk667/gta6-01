// Solmar City — traffic cars + pedestrians.
// The street has to feel alive, not scripted. So every pedestrian has a
// purpose: most walk the sidewalks (never the road) along a lane beside a
// road, some cross at the crosswalks, some wait at the kerb, some stand in
// pairs talking, some sit on a bench, some stand on their phone, a few jog
// and a few stroll. They switch between these states on their own.
// The city also reacts: gunfire or a stolen car makes nearby pedestrians
// run with their arms up, and anyone who sees it reports it — a "!" pops
// above them and the wanted level climbs. A car coming at a pedestrian
// makes them sidestep. Traffic cars stop at red lights, ease off at
// yellow, brake for people in the road, and honk when a pedestrian or
// another car blocks them (never at a red light).
// 28 cars loop the road grid; 40 pedestrians live on the sidewalks.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, dist2, clamp } from './state.js';
import { makeCar } from './vehicles.js';
import { attachBlob, resolveCollisions, trafficLightState } from './city.js';

const SHIRTS = [0xe84a4a, 0x4a8ae8, 0x4ad87a, 0xe8d84a, 0xd87ab8, 0x7ad8d8, 0xf2f2f2, 0x8a5a3a, 0xe87a2a, 0x9a6ad8, 0x3a8a6a, 0xd8d8d8];
const SKINS = [0xe8b88a, 0xc88a5a, 0x8a5a34, 0xf2c8a0];
const TROUSERS = [0x2c2f36, 0x3a4a6a, 0x6a3a3a, 0x4a5a3a, 0x8a7a5a];

// Walking speeds by pace. A jogger is visibly faster than a stroller.
const PACE = { stroll: 1.2, walk: 2.2, jog: 3.8, cross: 2.6, flee: 4.6 };

// How far off a road's centre the sidewalk lane sits (road half-width 5
// plus the kerb, so feet stay on pavement, not asphalt).
const LANE_OFF = 6.5;

// ------------------------------------------------------------ "!" marker

// One shared texture for every witness / honk marker: a red disc with a
// white exclamation mark. Sprites share it, so 68 markers cost one canvas.
let markTex = null;
function markTexture() {
  if (markTex) return markTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fillStyle = '#e82a2a';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 40px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('!', 32, 34);
  markTex = new THREE.CanvasTexture(c);
  return markTex;
}

// A marker sprite floating above a head (or a car roof). Hidden until
// something needs to flag it. Raycast is disabled on it, so a shot aimed
// past a "!" never counts as hitting the person under it.
function makeMark(y, size) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: markTexture(), transparent: true, depthWrite: false,
  }));
  sp.scale.set(size, size, 1);
  sp.position.y = y;
  sp.visible = false;
  sp.raycast = () => {};
  return sp;
}

// ------------------------------------------------------------ pedestrians

// Build one pedestrian: a tapered figure with a neck, a head small next
// to the shoulders, two slim legs with a gap, arms at the sides, and shoes
// that swing with the walk. A few carry a bag on their back; every figure
// gets a phone in the right hand (hidden unless they are using it) and a
// "!" marker above the head (hidden unless they witness a crime).
function buildPedestrian() {
  const g = new THREE.Group();
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const shirtMat = new THREE.MeshLambertMaterial({ color: pick(SHIRTS) });
  const skinMat = new THREE.MeshLambertMaterial({ color: pick(SKINS) });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pick(TROUSERS) });
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
  // Chest wider than the waist, a shoulder bar on top.
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.26), shirtMat);
  chest.position.y = 1.18;
  chest.castShadow = true;
  g.add(chest);
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.22), shirtMat);
  waist.position.y = 0.86;
  g.add(waist);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.28), shirtMat);
  shoulders.position.y = 1.38;
  g.add(shoulders);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 8), skinMat);
  neck.position.y = 1.46;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), skinMat);
  head.position.y = 1.6;
  head.castShadow = true;
  g.add(head);
  // A cap, hair, or a bare head, so the crowd is not one haircut.
  const roll = Math.random();
  if (roll < 0.35) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.08, 10), new THREE.MeshLambertMaterial({ color: pick(SHIRTS) }));
    cap.position.y = 1.76;
    g.add(cap);
  } else if (roll < 0.65) {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2c2018 }));
    hair.position.y = 1.62;
    g.add(hair);
  }
  // Two slim legs with a gap, pivoting at the hip.
  const legShape = new THREE.BoxGeometry(0.16, 0.68, 0.18);
  legShape.translate(0, -0.34, 0);
  const leftLeg = new THREE.Mesh(legShape, pantsMat);
  leftLeg.position.set(-0.11, 0.68, 0);
  g.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.11;
  g.add(rightLeg);
  // Arms hang at the sides, pivoting at the shoulder.
  const armShape = new THREE.BoxGeometry(0.13, 0.6, 0.15);
  armShape.translate(0, -0.3, 0);
  const leftArm = new THREE.Mesh(armShape, shirtMat);
  leftArm.position.set(-0.3, 1.32, 0);
  g.add(leftArm);
  const rightArm = leftArm.clone();
  rightArm.position.x = 0.3;
  g.add(rightArm);
  // Shoes ride on the legs so they swing with the walk.
  const shoeShape = new THREE.BoxGeometry(0.16, 0.08, 0.26);
  const shoeL = new THREE.Mesh(shoeShape, shoeMat);
  shoeL.position.set(0, -0.64, 0.03);
  leftLeg.add(shoeL);
  const shoeR = new THREE.Mesh(shoeShape, shoeMat);
  shoeR.position.set(0, -0.64, 0.03);
  rightLeg.add(shoeR);
  // A bag on the back for about a quarter of the crowd.
  if (Math.random() < 0.25) {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.36, 0.12), new THREE.MeshLambertMaterial({ color: pick([0x6a4a2a, 0x2c2f36, 0x8a2a2a]) }));
    bag.position.set(0, 1.15, -0.2);
    g.add(bag);
  }
  // A phone in the right hand, held low until the owner uses it.
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.03), new THREE.MeshBasicMaterial({ color: 0x14161a }));
  phone.position.set(0, -0.58, 0.1);
  phone.visible = false;
  rightArm.add(phone);
  // The witness marker, floating above the head.
  const mark = makeMark(2.4, 0.9);
  g.add(mark);
  // Not every pedestrian is the same height.
  const s = 0.9 + Math.random() * 0.2;
  g.scale.set(s, s, s);
  return { group: g, leftLeg, rightLeg, leftArm, rightArm, head, phone, mark };
}

// Snap a free (x, z) onto the nearest sidewalk lane: the closest road,
// the nearer side of it, walking either way along it.
function laneNear(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const r of WORLD.roads) {
    for (const axis of ['ns', 'ew']) {
      for (const side of [1, -1]) {
        const lx = axis === 'ns' ? r + side * LANE_OFF : x;
        const lz = axis === 'ew' ? r + side * LANE_OFF : z;
        const d = axis === 'ns' ? Math.abs(x - lx) : Math.abs(z - lz);
        if (d < bestD) {
          bestD = d;
          best = { axis, road: r, side, dir: Math.random() > 0.5 ? 1 : -1 };
        }
      }
    }
  }
  return best;
}

export function buildTraffic() {
  // Traffic cars: 28, spread round-robin over the roads so every street
  // carries 3-4 moving cars. Mixed models: mostly sedans, some taxis, a
  // few trucks. Each one gets a honk marker above its roof.
  const roads = [...WORLD.roads];
  for (let i = 0; i < 28; i++) {
    const alongX = Math.random() > 0.5;
    const road = roads[i % roads.length];
    const kr = Math.random();
    const kind = kr < 0.2 ? 'taxi' : kr < 0.35 ? 'truck' : 'sedan';
    const mesh = makeCar(undefined, false, kind);
    const x = alongX ? -160 + Math.random() * 320 : road + (Math.random() > 0.5 ? 2.4 : -2.4);
    const z = alongX ? road + (Math.random() > 0.5 ? 2.4 : -2.4) : -160 + Math.random() * 320;
    mesh.position.set(x, 0, z);
    const heading = alongX ? (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2) : (Math.random() > 0.5 ? 0 : Math.PI);
    mesh.rotation.y = heading;
    const mark = makeMark(2.6, 1.0);
    mesh.add(mark);
    S.scene.add(mesh);
    attachBlob(mesh, 4.6, 0.03);
    S.trafficCars.push({
      mesh, heading, mark,
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
  // Pedestrians: 40, each with a purpose.
  // 22 sidewalk walkers (a mix of strollers, walkers and joggers),
  // 6 talkers in 3 pairs, 4 waiting at kerbs, 4 on their phones,
  // 2 sitting on benches, 2 crossing at a crosswalk.
  const plan = [
    ...Array(22).fill('walk'),
    ...Array(6).fill('talk'),
    ...Array(4).fill('wait'),
    ...Array(4).fill('phone'),
    ...Array(2).fill('sit'),
    ...Array(2).fill('cross'),
  ];
  for (let i = 0; i < 40; i++) {
    const built = buildPedestrian();
    const mode = plan[i];
    const x = -140 + Math.random() * 280;
    const z = -140 + Math.random() * 280;
    built.group.position.set(x, 0, z);
    S.scene.add(built.group);
    attachBlob(built.group, 1.4, 0.03);
    // Pace: strollers amble, joggers hurry; talkers and sitters stand.
    const paceRoll = Math.random();
    const pace = paceRoll < 0.2 ? 'stroll' : paceRoll < 0.8 ? 'walk' : 'jog';
    const ped = {
      mesh: built.group,
      legL: built.leftLeg,
      legR: built.rightLeg,
      armL: built.leftArm,
      armR: built.rightArm,
      head: built.head,
      phone: built.phone,
      mark: built.mark,
      heading: Math.random() * Math.PI * 2,
      speed: PACE[pace],
      pace,
      walkPhase: Math.random() * 6,
      fleeTimer: 0,
      stumble: 0,
      retarget: 0,
      mode,
      stateT: 5 + Math.random() * 20,
      lane: laneNear(x, z),
      partner: null,
      witness: 0,
      reportAt: 0,
      decideAt: 0,
      talkPhase: Math.random() * 6,
    };
    // Talkers arrive in pairs, standing side by side on a sidewalk.
    if (mode === 'talk' && i % 2 === 1) {
      const other = S.peds[i - 1];
      ped.partner = other;
      other.partner = ped;
      const lane = other.lane;
      ped.lane = lane;
      // Stand beside the partner, across the walking direction.
      const offX = lane.axis === 'ns' ? 1.2 : 0;
      const offZ = lane.axis === 'ew' ? 1.2 : 0;
      ped.mesh.position.set(other.mesh.position.x + offX, 0, other.mesh.position.z + offZ);
      ped.heading = Math.atan2(other.mesh.position.x - ped.mesh.position.x, other.mesh.position.z - ped.mesh.position.z);
      other.heading = Math.atan2(ped.mesh.position.x - other.mesh.position.x, ped.mesh.position.z - other.mesh.position.z);
    }
    // Sitters take a bench when one is free.
    if (mode === 'sit' && S.benches.length > 0) {
      const bench = S.benches[i % S.benches.length];
      ped.mesh.position.set(bench.x, 0, bench.z);
      ped.heading = Math.random() * Math.PI * 2;
    }
    // Crossers start mid-crossing at an intersection.
    if (mode === 'cross') {
      const rx = WORLD.roads[Math.floor(Math.random() * WORLD.roads.length)];
      const rz = WORLD.roads[Math.floor(Math.random() * WORLD.roads.length)];
      const ns = Math.random() > 0.5;
      ped.mesh.position.set(ns ? rx : rx + 7.2, 0, ns ? rz + 7.2 : rz);
      ped.heading = ns ? 0 : Math.PI / 2;
      ped.crossFrom = 1;
      ped.crossAxis = ns ? 'ns' : 'ew';
      ped.crossRoad = ns ? rx : rz;
    }
    S.peds.push(ped);
  }
}

// Pedestrians within earshot run from a gunshot or a punch.
export function scarePeds(x, z, radius) {
  for (const ped of S.peds) {
    if (dist2(x, z, ped.mesh.position.x, ped.mesh.position.z) < radius) {
      ped.mode = 'flee';
      ped.stateT = 2.5 + Math.random();
      ped.fleeTimer = ped.stateT;
      const dx = ped.mesh.position.x - x;
      const dz = ped.mesh.position.z - z;
      ped.heading = Math.atan2(dx, dz);
    }
  }
}

// A crime in the open: everyone close enough sees it, runs, and reports
// it. The "!" pops above each witness for a few seconds, and the wanted
// level climbs — at most about a star per incident, so one shot in a
// crowd does not jump straight to five stars.
export function reportCrime(x, z, radius) {
  let seen = 0;
  for (const ped of S.peds) {
    if (dist2(x, z, ped.mesh.position.x, ped.mesh.position.z) > radius) continue;
    if (S.time < ped.reportAt) continue; // this one already reported recently
    ped.reportAt = S.time + 5;
    ped.witness = 3;
    ped.mode = 'flee';
    ped.stateT = 2.5 + Math.random();
    ped.fleeTimer = ped.stateT;
    const dx = ped.mesh.position.x - x;
    const dz = ped.mesh.position.z - z;
    ped.heading = Math.atan2(dx, dz);
    seen++;
  }
  if (seen > 0) {
    const heat = Math.min(4 * seen, 12);
    // Import-free heat: state.js exports addHeat, but this module already
    // clamps through S.heat directly to keep the call cheap.
    S.heat = Math.max(0, Math.min(100, S.heat + heat));
  }
  return seen;
}

// All cars that can hit a pedestrian: traffic, cruisers, the player's car.
function carThreat(ped) {
  const px = ped.mesh.position.x;
  const pz = ped.mesh.position.z;
  const threats = [];
  for (const c of S.trafficCars) threats.push({ x: c.mesh.position.x, z: c.mesh.position.z, speed: c.speed, heading: c.heading });
  for (const c of S.cruisers) threats.push({ x: c.mesh.position.x, z: c.mesh.position.z, speed: c.speed || 10, heading: c.heading });
  if (S.currentCar) threats.push({ x: S.currentCar.mesh.position.x, z: S.currentCar.mesh.position.z, speed: S.currentCar.speed, heading: S.currentCar.heading });
  for (const t of threats) {
    const dx = px - t.x;
    const dz = pz - t.z;
    const d = Math.hypot(dx, dz);
    if (d < 9 && Math.abs(t.speed) > 2) {
      // Is the car heading toward the pedestrian?
      const fx = Math.sin(t.heading) * Math.sign(t.speed);
      const fz = Math.cos(t.heading) * Math.sign(t.speed);
      const closing = -(dx * fx + dz * fz) / (d || 1); // >0 means closing
      if (closing > 0.35) return { t, d, dx, dz };
    }
  }
  return null;
}

export function updateTraffic(dt) {
  if (S.debug.freezeTraffic) return; // staged shot: cars hold their poses
  for (const c of S.trafficCars) {
    // Work out the speed the car wants, and why it might not get it.
    let target = c.cruise;
    let why = null;
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    // Brake for a pedestrian directly ahead in the road.
    for (const ped of S.peds) {
      const dx = ped.mesh.position.x - c.mesh.position.x;
      const dz = ped.mesh.position.z - c.mesh.position.z;
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
      for (const L of S.trafficLights) {
        const dx = L.x - c.mesh.position.x;
        const dz = L.z - c.mesh.position.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 14 && side < 9) {
          const st = trafficLightState(axis);
          if (st === 'red') {
            target = 0;
            why = 'light';
          } else if (st === 'yellow') {
            target = Math.min(target, 3);
          }
          break;
        }
      }
    }
    // Ease off near the player's car too.
    if (why === null && S.currentCar) {
      const d = dist2(c.mesh.position.x, c.mesh.position.z, S.currentCar.mesh.position.x, S.currentCar.mesh.position.z);
      if (d < 7) {
        target = Math.min(target, 2);
        why = 'car';
      }
    }
    // Honk when blocked by a person or a car for a while, not at a light.
    // A short horn plus the "!" above the roof; a few seconds between honks.
    if (target === 0 && (why === 'ped' || why === 'car')) {
      c.blockedT += dt;
      if (c.blockedT > 1.5 && S.time >= c.honkAt) {
        c.honkAt = S.time + 4;
        c.markT = 1.2;
        if (S.audio) S.audio.horn();
      }
    } else {
      c.blockedT = 0;
    }
    if (c.markT > 0) {
      c.markT -= dt;
      c.mark.visible = c.markT > 0;
    } else {
      c.mark.visible = false;
    }
    c.speed += (target - c.speed) * Math.min(1, dt * 2);
    c.mesh.position.x += Math.sin(c.heading) * c.speed * dt;
    c.mesh.position.z += Math.cos(c.heading) * c.speed * dt;
    // Turn at intersections, keep inside the city.
    const px = c.mesh.position.x;
    const pz = c.mesh.position.z;
    const onRoadX = WORLD.roads.some((r) => Math.abs(pz - r) < 1.2);
    const onRoadZ = WORLD.roads.some((r) => Math.abs(px - r) < 1.2);
    if ((onRoadX || onRoadZ) && Math.random() < dt * 0.25) {
      const turn = (Math.random() - 0.5) * Math.PI;
      c.heading += turn;
      c.alongX = Math.abs(Math.sin(c.heading)) > 0.7;
    }
    if (px > 175 || px < -175 || pz > 175 || pz < -175) {
      c.heading += Math.PI;
      c.mesh.position.x = clamp(px, -170, 170);
      c.mesh.position.z = clamp(pz, -170, 170);
    }
    c.mesh.rotation.y = c.heading;
    for (const w of c.mesh.userData.wheels) w.rotation.x += c.speed * dt * 2.4;
  }
}

// ------------------------------------------------------------ pedestrians

// Put a walking pedestrian back on a sidewalk lane after they finish a
// crossing, a talk, or a flee: the nearest lane to where they stand.
function backToLane(ped) {
  ped.lane = laneNear(ped.mesh.position.x, ped.mesh.position.z);
  ped.mode = ped.pace; // stroll / walk / jog again
  ped.stateT = 5 + Math.random() * 15;
}

export function updatePeds(dt) {
  for (const ped of S.peds) {
    // Knocked down: lie flat briefly, then get up.
    if (ped.stumble > 0) {
      ped.stumble -= dt;
      ped.mesh.rotation.x = -0.5 * Math.max(0, ped.stumble / 0.5);
      ped.mesh.position.y = 0;
      continue;
    }
    ped.mesh.rotation.x = 0;
    // The witness "!" fades a few seconds after the crime.
    if (ped.witness > 0) {
      ped.witness -= dt;
      ped.mark.visible = ped.witness > 0;
    } else {
      ped.mark.visible = false;
    }
    // A car bearing down on them: sidestep out of its path, arms up.
    const threat = carThreat(ped);
    if (threat && threat.d < 8 && ped.mode !== 'flee' && ped.mode !== 'sit') {
      const sideX = Math.cos(threat.t.heading);
      const sideZ = -Math.sin(threat.t.heading);
      const toPed = (ped.mesh.position.x - threat.t.x) * sideX + (ped.mesh.position.z - threat.t.z) * sideZ;
      const dir = toPed >= 0 ? 1 : -1;
      ped.heading = Math.atan2(sideX * dir, sideZ * dir);
      ped.mode = 'flee';
      ped.stateT = Math.max(ped.stateT, 0.8);
      ped.fleeTimer = Math.max(ped.fleeTimer, 0.8);
    }
    // State timer: when a state runs out, pick the next one.
    if (ped.stateT > 0) ped.stateT -= dt;
    let pace = ped.speed;
    const pos = ped.mesh.position;
    if (ped.mode === 'flee') {
      pace = PACE.flee;
      if (ped.stateT <= 0) backToLane(ped);
    } else if (ped.mode === 'cross') {
      pace = PACE.cross;
      // Walk straight across the road at the crosswalk line, from one
      // sidewalk to the other. The along-road coordinate stays fixed so
      // the crossing happens on the stripes, not diagonally.
      const from = ped.crossFrom || 1;
      const axis = ped.crossAxis || 'ns';
      const road = ped.crossRoad || 0;
      if (axis === 'ns') {
        const goal = road - from * LANE_OFF;
        const step = Math.sign(goal - pos.x) * pace * dt;
        pos.x += step;
        if (Math.abs(pos.x - goal) < 0.3) {
          ped.lane = { axis: 'ns', road, side: -from, dir: Math.random() > 0.5 ? 1 : -1 };
          ped.mode = ped.pace;
          ped.stateT = 5 + Math.random() * 15;
        }
      } else {
        const goal = road - from * LANE_OFF;
        const step = Math.sign(goal - pos.z) * pace * dt;
        pos.z += step;
        if (Math.abs(pos.z - goal) < 0.3) {
          ped.lane = { axis: 'ew', road, side: -from, dir: Math.random() > 0.5 ? 1 : -1 };
          ped.mode = ped.pace;
          ped.stateT = 5 + Math.random() * 15;
        }
      }
      ped.heading = axis === 'ns' ? (from > 0 ? -Math.PI / 2 : Math.PI / 2) : (from > 0 ? Math.PI : 0);
    } else if (ped.mode === 'wait') {
      pace = 0;
      if (ped.stateT <= 0) {
        // Done waiting: cross the road, or walk on.
        if (Math.random() < 0.7 && ped.lane) {
          ped.mode = 'cross';
          ped.crossFrom = ped.lane.side;
          ped.crossAxis = ped.lane.axis;
          ped.crossRoad = ped.lane.road;
          ped.stateT = 30;
        } else {
          backToLane(ped);
        }
      }
    } else if (ped.mode === 'talk') {
      pace = 0;
      // Face the partner and gesture with the hands while talking.
      if (ped.partner) {
        ped.heading = Math.atan2(
          ped.partner.mesh.position.x - pos.x,
          ped.partner.mesh.position.z - pos.z
        );
      }
      if (ped.stateT <= 0) {
        const other = ped.partner;
        ped.partner = null;
        if (other) other.partner = null;
        backToLane(ped);
        if (other && other.mode === 'talk') backToLane(other);
      }
    } else if (ped.mode === 'sit') {
      pace = 0;
      if (ped.stateT <= 0) {
        pos.y = 0;
        backToLane(ped);
      }
    } else if (ped.mode === 'phone') {
      pace = 0;
      if (ped.stateT <= 0) backToLane(ped);
    } else {
      // Stroll / walk / jog along the sidewalk lane.
      pace = ped.speed;
      const lane = ped.lane;
      if (!lane) {
        ped.lane = laneNear(pos.x, pos.z);
      } else if (lane.axis === 'ns') {
        pos.x = lane.road + lane.side * LANE_OFF;
        pos.z += lane.dir * pace * dt;
        // Near an intersection: maybe turn, maybe cross, maybe keep going.
        const nearCross = WORLD.roads.some((r) => Math.abs(pos.z - r) < 3);
        if (nearCross && S.time >= ped.decideAt) {
          ped.decideAt = S.time + 1.5;
          const roll = Math.random();
          if (roll < 0.18) {
            ped.mode = 'cross';
            ped.crossFrom = lane.side;
            ped.crossAxis = 'ns';
            ped.crossRoad = lane.road;
            ped.stateT = 30;
          } else if (roll < 0.3) {
            // Turn onto the crossing road's sidewalk.
            const crossRoad = WORLD.roads.reduce((a, b) => (Math.abs(b - pos.z) < Math.abs(a - pos.z) ? b : a));
            ped.lane = { axis: 'ew', road: crossRoad, side: Math.random() > 0.5 ? 1 : -1, dir: Math.random() > 0.5 ? 1 : -1 };
            pos.z = crossRoad + ped.lane.side * LANE_OFF;
          } else if (roll < 0.4) {
            // Stop and wait at the kerb for a while, facing the road.
            ped.mode = 'wait';
            ped.stateT = 2 + Math.random() * 3;
            ped.heading = Math.atan2(lane.road - pos.x, 0);
          }
        }
        if (pos.z > 172 || pos.z < -172) lane.dir *= -1;
        ped.heading = lane.dir > 0 ? 0 : Math.PI;
      } else {
        pos.z = lane.road + lane.side * LANE_OFF;
        pos.x += lane.dir * pace * dt;
        const nearCross = WORLD.roads.some((r) => Math.abs(pos.x - r) < 3);
        if (nearCross && S.time >= ped.decideAt) {
          ped.decideAt = S.time + 1.5;
          const roll = Math.random();
          if (roll < 0.18) {
            ped.mode = 'cross';
            ped.crossFrom = lane.side;
            ped.crossAxis = 'ew';
            ped.crossRoad = lane.road;
            ped.stateT = 30;
          } else if (roll < 0.3) {
            const crossRoad = WORLD.roads.reduce((a, b) => (Math.abs(b - pos.x) < Math.abs(a - pos.x) ? b : a));
            ped.lane = { axis: 'ns', road: crossRoad, side: Math.random() > 0.5 ? 1 : -1, dir: Math.random() > 0.5 ? 1 : -1 };
            pos.x = crossRoad + ped.lane.side * LANE_OFF;
          } else if (roll < 0.4) {
            ped.mode = 'wait';
            ped.stateT = 2 + Math.random() * 3;
            ped.heading = lane.side > 0 ? Math.PI : 0;
          }
        }
        if (pos.x > 172 || pos.x < -172) lane.dir *= -1;
        ped.heading = lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    // Move (except for the standing states, which set pace 0 above).
    if (ped.mode === 'flee') {
      pos.x += Math.sin(ped.heading) * pace * dt;
      pos.z += Math.cos(ped.heading) * pace * dt;
      resolveCollisions(pos, 0.4);
    } else if (ped.mode !== 'cross' && ped.mode !== 'wait' && ped.mode !== 'talk' && ped.mode !== 'sit' && ped.mode !== 'phone') {
      // Walking modes already moved along their lane above; just keep
      // them out of buildings.
      resolveCollisions(pos, 0.4);
    }
    ped.mesh.rotation.y = ped.heading;
    // Walk cycle, or the pose for the current state.
    ped.walkPhase += dt * pace * 2.2;
    const swing = Math.min(1, pace / 4) * 0.5;
    if (ped.mode === 'flee') {
      // Arms up, wobbling, while running.
      const wob = Math.sin(S.time * 9 + ped.talkPhase) * 0.25;
      ped.armL.rotation.x = -2.3 + wob;
      ped.armR.rotation.x = -2.3 - wob;
      ped.legL.rotation.x = Math.sin(ped.walkPhase) * 0.7;
      ped.legR.rotation.x = -Math.sin(ped.walkPhase) * 0.7;
    } else if (ped.mode === 'talk') {
      // Hands gesture while talking; legs still.
      const g = Math.sin(S.time * 3 + ped.talkPhase) * 0.35;
      ped.armL.rotation.x = -0.6 + g;
      ped.armR.rotation.x = -0.6 - g;
      ped.legL.rotation.x = 0;
      ped.legR.rotation.x = 0;
    } else if (ped.mode === 'sit') {
      // Seated: hips down on the bench, thighs forward, arms relaxed.
      pos.y = 0.45;
      ped.legL.rotation.x = -1.5;
      ped.legR.rotation.x = -1.5;
      ped.armL.rotation.x = 0.1;
      ped.armR.rotation.x = 0.1;
    } else if (ped.mode === 'phone') {
      // Phone up in the right hand, head tipped down at the screen.
      ped.phone.visible = true;
      ped.armR.rotation.x = -1.1;
      ped.armL.rotation.x = 0;
      ped.head.rotation.x = 0.3;
      ped.legL.rotation.x = 0;
      ped.legR.rotation.x = 0;
    } else if (ped.mode === 'wait') {
      ped.phone.visible = false;
      ped.head.rotation.x = 0;
      ped.legL.rotation.x = 0;
      ped.legR.rotation.x = 0;
      ped.armL.rotation.x = 0;
      ped.armR.rotation.x = 0;
    } else {
      ped.phone.visible = false;
      ped.head.rotation.x = 0;
      ped.legL.rotation.x = Math.sin(ped.walkPhase) * swing;
      ped.legR.rotation.x = -Math.sin(ped.walkPhase) * swing;
      ped.armL.rotation.x = -Math.sin(ped.walkPhase) * swing * 0.9;
      ped.armR.rotation.x = Math.sin(ped.walkPhase) * swing * 0.9;
    }
  }
}
