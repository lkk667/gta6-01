// Solmar City — street life: traffic cars plus pedestrians with purpose.
//
// Every pedestrian walks with a purpose: most keep to the pavements,
// a few cross on the stripes, some wait at the kerb, some chat in
// pairs, some sit, some stare at a phone, a few jog and a few amble.
// The street answers back: a gunshot or a stolen car sends the nearest
// people running with arms raised, and the witnesses raise a red "!"
// and push the wanted level up. A car bearing down makes people step
// aside. Traffic stops for red lights, eases through yellow, brakes
// for people in the road, and honks when blocked — never for a red
// light. Twenty-eight cars circle the grid; forty pedestrians live on
// the pavements, built from smooth shapes so the crowd reads as
// people, not toys.
import * as THREE from "../vendor/three.module.min.js"; // 3D engine
import { S, WORLD, dist2, clamp } from "./state.js"; // shared world
import { makeCar } from "./vehicles.js"; // car factory
import { assemblePedestrian } from "./character.js"; // realistic people
import { attachBlob, resolveCollisions, trafficLightState } from "./city.js"; // city helpers

// Metres per second for each way of moving. A jogger is plainly
// quicker than someone out for a stroll.
const PACE_TABLE = { stroll: 1.2, walk: 2.2, jog: 3.8, cross: 2.6, flee: 4.6 };

// How far a pavement lane sits from a road's centre line: the road
// half-width (5) plus the kerb, so feet stay on paving, not tarmac.
const CURB_GAP = 6.5;

// ------------------------------------------- the red "!" badge

// One shared canvas for every witness and honk badge: a red disc with
// a white exclamation mark. Sprites share it, so dozens of badges
// cost a single texture.
let sharedBadgeTex = null;
function witnessBadgeTexture() {
  if (sharedBadgeTex) { return sharedBadgeTex; }
  const side = 64;
  const middle = side / 2;
  const discR = 28;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const pen = canvas.getContext("2d");
  pen.beginPath();
  pen.arc(middle, middle, discR, 0, 2 * Math.PI);
  pen.fillStyle = "#e82a2a";
  pen.fill();
  pen.lineWidth = middle / 8;
  pen.strokeStyle = "#ffffff";
  pen.stroke();
  pen.fillStyle = "#ffffff";
  pen.font = "bold 40px Arial, sans-serif";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  pen.fillText("!", middle, 34);
  sharedBadgeTex = new THREE.CanvasTexture(canvas);
  return sharedBadgeTex;
}

// A badge sprite floating above a head (or a car roof). Hidden until
// something needs to flag it. Its raycast is switched off, so a shot
// aimed past a "!" never counts as hitting the person under it.
function spawnBadge(height, size) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: witnessBadgeTexture(), transparent: true, depthWrite: false,
  }));
  sprite.scale.set(size, size, 1);
  sprite.position.y = height;
  sprite.visible = false;
  sprite.raycast = () => { };
  return sprite;
}
// ------------------------------------------- pedestrians

// Pedestrians are built in character.js (assemblePedestrian):
// lathe-turned realistic figures with two-segment joints.


// Snap a free (x, z) onto the nearest sidewalk lane: the closest road,
// the nearer side of it, walking either way along it.
function closestSidewalk(x, z) {
  let closest = null;
  let closestD = Infinity;
  for (const roadLine of WORLD.roads) {
    for (const orientation of ["ns", "ew"]) {
      for (const flank of [1, -1]) {
        const laneX = orientation === "ns" ? roadLine + flank * CURB_GAP : x;
        const laneZ = orientation === "ew" ? roadLine + flank * CURB_GAP : z;
        const gap = orientation === "ns" ? Math.abs(x - laneX) : Math.abs(z - laneZ);
        if (gap < closestD) {
          closestD = gap;
          closest = { axis: orientation, road: roadLine, side: flank, dir: Math.random() > 0.5 ? 1 : -1 };
        }
      }
    }
  }
  return closest;
}
export function buildTraffic()
{
  // Traffic cars: 28, spread round-robin over the roads so every street
  // carries 3-4 moving cars. Mixed models: mostly sedans, some taxis, a
  // few trucks. Each one gets a honk badge above its roof.
  const roadLines = [...WORLD.roads];
  for (let i = 0; i < 28; i += 1) {
    const runsEastWest = Math.random() > 0.5;
    const roadLine = roadLines[i % roadLines.length];
    const kindRoll = Math.random();
    const model = kindRoll < 0.2 ? "taxi" : kindRoll < 0.35 ? "truck" : "sedan";
    const carMesh = makeCar(undefined, false, model);
    const x = runsEastWest ? -160 + Math.random() * 320 : roadLine + (Math.random() > 0.5 ? 2.4 : -2.4);
    const z = runsEastWest ? roadLine + (Math.random() > 0.5 ? 2.4 : -2.4) : -160 + Math.random() * 320;
    carMesh.position.set(x, 0, z);
    const heading = runsEastWest ? (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2) : (Math.random() > 0.5 ? 0 : Math.PI);
    carMesh.rotation.y = heading;
    const honkBadge = spawnBadge(2.6, 1.0);
    carMesh.add(honkBadge);
    S.scene.add(carMesh);
    attachBlob(carMesh, 4.6, 0.03);
    S.trafficCars.push({
      mesh: carMesh, heading, mark: honkBadge,
      speed: 7 + Math.random() * 4,
      alongX: runsEastWest,
      road: roadLine,
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
  const roster = [...Array(22).fill("walk"), ...Array(6).fill("talk"), ...Array(4).fill("wait"),
    ...Array(4).fill("phone"), ...Array(2).fill("sit"), ...Array(2).fill("cross")];
  for (let i = 0; i < 40; i += 1) {
    // A few harbour workers and two police officers among the beach crowd.
    const roleDraw = Math.random();
    const role = roleDraw < 0.08 ? "worker" : roleDraw < 0.13 ? "police" : undefined;
    const figure = assemblePedestrian(role);
    const mode = roster[i];
    const x = -140 + Math.random() * 280;
    const z = -140 + Math.random() * 280;
    figure.group.position.set(x, 0, z);
    S.scene.add(figure.group);
    attachBlob(figure.group, 1.4, 0.03);
    // The gait: strollers amble, joggers hurry; talkers and sitters stand.
    const gaitDraw = Math.random();
    const gaitName = gaitDraw < 0.2 ? "stroll" : gaitDraw < 0.8 ? "walk" : "jog";
    const walkerRec = {
      mesh: figure.group,
      legL: figure.leftLeg,
      legR: figure.rightLeg,
      shinL: figure.shinL,
      shinR: figure.shinR,
      armL: figure.leftArm,
      armR: figure.rightArm,
      foreL: figure.foreL,
      foreR: figure.foreR,
      head: figure.head,
      chest: figure.chest,
      phone: figure.phone,
      mark: figure.mark,
      heading: Math.random() * Math.PI * 2,
      speed: PACE_TABLE[gaitName],
      pace: gaitName,
      walkPhase: Math.random() * 6,
      fleeTimer: 0,
      stumble: 0,
      retarget: 0,
      mode,
      stateT: 5 + Math.random() * 20,
      lane: closestSidewalk(x, z),
      partner: null,
      witness: 0,
      reportAt: 0,
      decideAt: 0,
      talkPhase: Math.random() * 6,
    };
    // Talkers arrive in pairs, standing side by side on a sidewalk.
    if (mode === "talk" && i % 2 === 1) {
      const other = S.peds[i - 1];
      walkerRec.partner = other;
      other.partner = walkerRec;
      const track = other.lane;
      walkerRec.lane = track;
      // Stand beside the partner, across the walking direction.
      const offX = track.axis === "ns" ? 1.2 : 0;
      const offZ = track.axis === "ew" ? 1.2 : 0;
      walkerRec.mesh.position.set(other.mesh.position.x + offX, 0, other.mesh.position.z + offZ);
      walkerRec.heading = Math.atan2(other.mesh.position.x - walkerRec.mesh.position.x, other.mesh.position.z - walkerRec.mesh.position.z);
      other.heading = Math.atan2(walkerRec.mesh.position.x - other.mesh.position.x, walkerRec.mesh.position.z - other.mesh.position.z);
    }
    // Sitters take a bench when one is free.
    if (mode === "sit" && S.benches.length > 0) {
      const bench = S.benches[i % S.benches.length];
      walkerRec.mesh.position.set(bench.x, 0, bench.z);
      walkerRec.heading = Math.random() * Math.PI * 2;
    }
    // Crossers start mid-crossing at an intersection.
    if (mode === "cross") {
      const rx = WORLD.roads[Math.floor(Math.random() * WORLD.roads.length)];
      const rz = WORLD.roads[Math.floor(Math.random() * WORLD.roads.length)];
      const ns = Math.random() > 0.5;
      walkerRec.mesh.position.set(ns ? rx : rx + 7.2, 0, ns ? rz + 7.2 : rz);
      walkerRec.heading = ns ? 0 : Math.PI / 2;
      walkerRec.crossFrom = 1;
      walkerRec.crossAxis = ns ? "ns" : "ew";
      walkerRec.crossRoad = ns ? rx : rz;
    }
    S.peds.push(walkerRec);
  }
}

// Pedestrians within earshot run from a gunshot or a punch.
export function scarePeds(x, z, radius)
{
  for (const ped of S.peds) {
    if (dist2(x, z, ped.mesh.position.x, ped.mesh.position.z) < radius) {
      ped.mode = "flee";
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
export function reportCrime(x, z, radius)
{
  let witnessCount = 0;
  for (const ped of S.peds) {
    if (dist2(x, z, ped.mesh.position.x, ped.mesh.position.z) > radius) { continue; }
    if (S.time < ped.reportAt) { continue; } // this one already reported recently
    ped.reportAt = S.time + 5;
    ped.witness = 3;
    ped.mode = "flee";
    ped.stateT = 2.5 + Math.random();
    ped.fleeTimer = ped.stateT;
    const dx = ped.mesh.position.x - x;
    const dz = ped.mesh.position.z - z;
    ped.heading = Math.atan2(dx, dz);
    witnessCount += 1;
  }
  if (witnessCount > 0) {
    const heat = Math.min(4 * witnessCount, 12);
    S.heat = Math.max(0, Math.min(100, S.heat + heat));
  }
  return witnessCount;
}

// All cars that can hit a pedestrian: traffic, cruisers, the player's car.
function incomingCar(ped) {
  const px = ped.mesh.position.x;
  const pz = ped.mesh.position.z;
  const threats = [];
  for (const streetCar of S.trafficCars) { threats.push({ x: streetCar.mesh.position.x, z: streetCar.mesh.position.z, speed: streetCar.speed, heading: streetCar.heading }); }
  for (const unit of S.cruisers) { threats.push({ x: unit.mesh.position.x, z: unit.mesh.position.z, speed: unit.speed || 10, heading: unit.heading }); }
  if (S.currentCar) { threats.push({ x: S.currentCar.mesh.position.x, z: S.currentCar.mesh.position.z, speed: S.currentCar.speed, heading: S.currentCar.heading }); }
  for (const threat of threats) {
    const dx = px - threat.x;
    const dz = pz - threat.z;
    const d = Math.hypot(dx, dz);
    if (d < 9 && Math.abs(threat.speed) > 2) {
      // Is the car heading toward the pedestrian?
      const fx = Math.sin(threat.heading) * Math.sign(threat.speed);
      const fz = Math.cos(threat.heading) * Math.sign(threat.speed);
      const closing = -(dx * fx + dz * fz) / (d || 1); // above 0 means closing
      if (closing > 0.35) { return { t: threat, d, dx, dz }; }
    }
  }
  return null;
}

// One traffic car, one frame: pick a speed, obey lights and people,
// honk when stuck, roll forward, turn at intersections, stay in town.
function stepStreetCar(streetCar, dt) {
  // Work out the speed the car wants, and why it might not get it.
  let goalSpeed = streetCar.cruise;
  let blockReason = null;
  const fwdX = Math.sin(streetCar.heading);
  const fwdZ = Math.cos(streetCar.heading);
  // Brake for a pedestrian directly ahead in the road.
  const personAhead = S.peds.some((ped) => {
    const dx = ped.mesh.position.x - streetCar.mesh.position.x;
    const dz = ped.mesh.position.z - streetCar.mesh.position.z;
    const ahead = dx * fwdX + dz * fwdZ;
    const side = Math.abs(dx * fwdZ - dz * fwdX);
    return ahead > 0 && ahead < 9 && side < 2.2;
  });
  if (personAhead) {
    goalSpeed = 0;
    blockReason = "ped";
  }
  // Obey traffic lights: stop at red, ease off at yellow. A red light
  // is never a reason to honk, so it gets its own flag.
  if (blockReason === null && S.trafficLights) {
    const signalAxis = Math.abs(fwdX) > 0.7 ? "ew" : "ns";
    const nearSignal = S.trafficLights.find((signal) => {
      const dx = signal.x - streetCar.mesh.position.x;
      const dz = signal.z - streetCar.mesh.position.z;
      const ahead = dx * fwdX + dz * fwdZ;
      const side = Math.abs(dx * fwdZ - dz * fwdX);
      return ahead > 0 && ahead < 14 && side < 9;
    });
    if (nearSignal) {
      const lightState = trafficLightState(signalAxis);
      if (lightState === "red") {
        goalSpeed = 0;
        blockReason = "light";
      } else if (lightState === "yellow") {
        goalSpeed = Math.min(goalSpeed, 3);
      }
    }
  }
  // Ease off near the player's car too.
  if (blockReason === null && S.currentCar) {
    const gap = dist2(streetCar.mesh.position.x, streetCar.mesh.position.z, S.currentCar.mesh.position.x, S.currentCar.mesh.position.z);
    if (gap < 7) {
      goalSpeed = Math.min(goalSpeed, 2);
      blockReason = "car";
    }
  }
  // Honk when blocked by a person or a car for a while, not at a
  // light. A short horn plus the "!" above the roof; a few seconds
  // between honks.
  if (goalSpeed === 0 && (blockReason === "ped" || blockReason === "car")) {
    streetCar.blockedT += dt;
    if (streetCar.blockedT > 1.5 && S.time >= streetCar.honkAt) {
      streetCar.honkAt = S.time + 4;
      streetCar.markT = 1.2;
      if (S.audio) { S.audio.horn(); }
    }
  } else {
    streetCar.blockedT = 0;
  }
  if (streetCar.markT > 0) {
    streetCar.markT -= dt;
    streetCar.mark.visible = streetCar.markT > 0;
  } else {
    streetCar.mark.visible = false;
  }
  streetCar.speed += (goalSpeed - streetCar.speed) * Math.min(1, dt * 2);
  streetCar.mesh.position.x += Math.sin(streetCar.heading) * streetCar.speed * dt;
  streetCar.mesh.position.z += Math.cos(streetCar.heading) * streetCar.speed * dt;
  // Turn at intersections, keep inside the city.
  const px = streetCar.mesh.position.x;
  const pz = streetCar.mesh.position.z;
  const onRoadX = WORLD.roads.some((r) => Math.abs(pz - r) < 1.2);
  const onRoadZ = WORLD.roads.some((r) => Math.abs(px - r) < 1.2);
  if ((onRoadX || onRoadZ) && Math.random() < dt * 0.25) {
    const turn = (Math.random() - 0.5) * Math.PI;
    streetCar.heading += turn;
    streetCar.alongX = Math.abs(Math.sin(streetCar.heading)) > 0.7;
  }
  if (px > 175 || px < -175 || pz > 175 || pz < -175) {
    streetCar.heading += Math.PI;
    streetCar.mesh.position.x = clamp(px, -170, 170);
    streetCar.mesh.position.z = clamp(pz, -170, 170);
  }
  streetCar.mesh.rotation.y = streetCar.heading;
  for (const wheel of streetCar.mesh.userData.wheels) { wheel.rotation.x += streetCar.speed * dt * 2.4; }
}

export function updateTraffic(dt)
{
  if (S.debug.freezeTraffic) { return; } // a staged shot: cars hold their poses
  for (const streetCar of S.trafficCars) { stepStreetCar(streetCar, dt); }
}

// ------------------------------------------- pedestrians

// Put a walking pedestrian back on a sidewalk lane after they finish a
// crossing, a talk, or a flee: the nearest lane to where they stand.
function returnToSidewalk(ped) {
  ped.lane = closestSidewalk(ped.mesh.position.x, ped.mesh.position.z);
  ped.mode = ped.pace; // stroll / walk / jog again
  ped.stateT = 5 + Math.random() * 15;
}

export function updatePeds(dt)
{
  for (const ped of S.peds) { stepPedestrian(ped, dt); }
}

// One pedestrian, one frame: pose, state machine, walk cycle.
function stepPedestrian(ped, dt) {
  // Knocked down: lie flat briefly, then get up.
  if (ped.stumble > 0) {
    ped.stumble -= dt;
    ped.mesh.rotation.x = -0.5 * Math.max(0, ped.stumble / 0.5);
    ped.mesh.position.y = 0;
    return;
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
  const danger = incomingCar(ped);
  if (danger && danger.d < 8 && ped.mode !== "flee" && ped.mode !== "sit") {
    const sideX = Math.cos(danger.t.heading);
    const sideZ = -Math.sin(danger.t.heading);
    const toWalker = (ped.mesh.position.x - danger.t.x) * sideX + (ped.mesh.position.z - danger.t.z) * sideZ;
    const dir = toWalker >= 0 ? 1 : -1;
    ped.heading = Math.atan2(sideX * dir, sideZ * dir);
    ped.mode = "flee";
    ped.stateT = Math.max(ped.stateT, 0.8);
    ped.fleeTimer = Math.max(ped.fleeTimer, 0.8);
  }
  // The state timer: when a state runs out, pick the next one.
  if (ped.stateT > 0) { ped.stateT -= dt; }
  let stride = ped.speed;
  const spot = ped.mesh.position;
  if (ped.mode === "flee") {
    stride = PACE_TABLE.flee;
    if (ped.stateT <= 0) { returnToSidewalk(ped); }
  } else if (ped.mode === "cross") {
    stride = PACE_TABLE.cross;
    // Walk straight across on the crosswalk stripes, from one sidewalk
    // to the other; the along-road coordinate stays fixed, not diagonal.
    const from = ped.crossFrom || 1;
    const axis = ped.crossAxis || "ns";
    const road = ped.crossRoad || 0;
    if (axis === "ns") {
      const goal = road - from * CURB_GAP;
      const step = Math.sign(goal - spot.x) * stride * dt;
      spot.x += step;
      if (Math.abs(spot.x - goal) < 0.3) {
        ped.lane = { axis: "ns", road, side: -from, dir: Math.random() > 0.5 ? 1 : -1 };
        ped.mode = ped.pace;
        ped.stateT = 5 + Math.random() * 15;
      }
    } else {
      const goal = road - from * CURB_GAP;
      const step = Math.sign(goal - spot.z) * stride * dt;
      spot.z += step;
      if (Math.abs(spot.z - goal) < 0.3) {
        ped.lane = { axis: "ew", road, side: -from, dir: Math.random() > 0.5 ? 1 : -1 };
        ped.mode = ped.pace;
        ped.stateT = 5 + Math.random() * 15;
      }
    }
    ped.heading = axis === "ns" ? (from > 0 ? -Math.PI / 2 : Math.PI / 2) : (from > 0 ? Math.PI : 0);
  } else if (ped.mode === "wait") {
    stride = 0;
    if (ped.stateT <= 0) {
      // Done waiting: cross the road, or walk on.
      if (Math.random() < 0.7 && ped.lane) {
        ped.mode = "cross";
        ped.crossFrom = ped.lane.side;
        ped.crossAxis = ped.lane.axis;
        ped.crossRoad = ped.lane.road;
        ped.stateT = 30;
      } else {
        returnToSidewalk(ped);
      }
    }
  } else if (ped.mode === "talk") {
    stride = 0;
    // Face the partner and gesture with the hands while talking.
    if (ped.partner) {
      ped.heading = Math.atan2(
        ped.partner.mesh.position.x - spot.x,
        ped.partner.mesh.position.z - spot.z
      );
    }
    if (ped.stateT <= 0) {
      const other = ped.partner;
      ped.partner = null;
      if (other) { other.partner = null; }
      returnToSidewalk(ped);
      if (other && other.mode === "talk") { returnToSidewalk(other); }
    }
  } else if (ped.mode === "sit") {
    stride = 0;
    if (ped.stateT <= 0) {
      spot.y = 0;
      returnToSidewalk(ped);
    }
  } else if (ped.mode === "phone") {
    stride = 0;
    if (ped.stateT <= 0) { returnToSidewalk(ped); }
  } else {
    // Stroll / walk / jog along the sidewalk lane.
    stride = ped.speed;
    const lane = ped.lane;
    if (!lane) {
      ped.lane = closestSidewalk(spot.x, spot.z);
    } else if (lane.axis === "ns") {
      spot.x = lane.road + lane.side * CURB_GAP;
      spot.z += lane.dir * stride * dt;
      // Near an intersection: maybe turn, maybe cross, maybe keep going.
      const byCrossing = WORLD.roads.some((r) => Math.abs(spot.z - r) < 3);
      if (byCrossing && S.time >= ped.decideAt) {
        ped.decideAt = S.time + 1.5;
        const choice = Math.random();
        if (choice < 0.18) {
          ped.mode = "cross";
          ped.crossFrom = lane.side;
          ped.crossAxis = "ns";
          ped.crossRoad = lane.road;
          ped.stateT = 30;
        } else if (choice < 0.3) {
          const crossRoad = WORLD.roads.reduce((a, b) => (Math.abs(b - spot.z) < Math.abs(a - spot.z) ? b : a));
          ped.lane = { axis: "ew", road: crossRoad, side: Math.random() > 0.5 ? 1 : -1, dir: Math.random() > 0.5 ? 1 : -1 };
          spot.z = crossRoad + ped.lane.side * CURB_GAP;
        } else if (choice < 0.4) {
          ped.mode = "wait";
          ped.stateT = 2 + Math.random() * 3;
          ped.heading = Math.atan2(lane.road - spot.x, 0);
        }
      }
      if (spot.z > 172 || spot.z < -172) { lane.dir *= -1; }
      ped.heading = lane.dir > 0 ? 0 : Math.PI;
    } else {
      spot.z = lane.road + lane.side * CURB_GAP;
      spot.x += lane.dir * stride * dt;
      const byCrossing = WORLD.roads.some((r) => Math.abs(spot.x - r) < 3);
      if (byCrossing && S.time >= ped.decideAt) {
        ped.decideAt = S.time + 1.5;
        const choice = Math.random();
        if (choice < 0.18) {
          ped.mode = "cross";
          ped.crossFrom = lane.side;
          ped.crossAxis = "ew";
          ped.crossRoad = lane.road;
          ped.stateT = 30;
        } else if (choice < 0.3) {
          const crossRoad = WORLD.roads.reduce((a, b) => (Math.abs(b - spot.x) < Math.abs(a - spot.x) ? b : a));
          ped.lane = { axis: "ns", road: crossRoad, side: Math.random() > 0.5 ? 1 : -1, dir: Math.random() > 0.5 ? 1 : -1 };
          spot.x = crossRoad + ped.lane.side * CURB_GAP;
        } else if (choice < 0.4) {
          ped.mode = "wait";
          ped.stateT = 2 + Math.random() * 3;
          ped.heading = lane.side > 0 ? Math.PI : 0;
        }
      }
      if (spot.x > 172 || spot.x < -172) { lane.dir *= -1; }
      ped.heading = lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }
  // Move (except for the standing states, which set stride 0 above).
  if (ped.mode === "flee") {
    spot.x += Math.sin(ped.heading) * stride * dt;
    spot.z += Math.cos(ped.heading) * stride * dt;
    resolveCollisions(spot, 0.4);
  } else if (ped.mode !== "cross" && ped.mode !== "wait" && ped.mode !== "talk" && ped.mode !== "sit" && ped.mode !== "phone") {
    // Walking modes already moved along their lane above; just keep
    // them out of buildings.
    resolveCollisions(spot, 0.4);
  }
  ped.mesh.rotation.y = ped.heading;
  // The walk cycle, or the pose for the current state. Two-segment
  // joints: the knee bends when its leg swings forward, the elbow
  // stays softly bent while walking, and standing figures breathe.
  ped.walkPhase += dt * stride * 2.2;
  const sway = Math.min(1, stride / 4) * 0.5;
  const breath = 1 + 0.02 * Math.sin(S.time * 1.6 + ped.talkPhase);
  if (ped.mode === "flee") {
    // Arms up, wobbling, while running.
    const wobble = Math.sin(S.time * 9 + ped.talkPhase) * 0.25;
    ped.armL.rotation.x = -2.3 + wobble;
    ped.armR.rotation.x = -2.3 - wobble;
    ped.foreL.rotation.x = -0.6;
    ped.foreR.rotation.x = -0.6;
    ped.legL.rotation.x = Math.sin(ped.walkPhase) * 0.7;
    ped.legR.rotation.x = -Math.sin(ped.walkPhase) * 0.7;
    ped.shinL.rotation.x = Math.max(0, -Math.sin(ped.walkPhase)) * 1.0;
    ped.shinR.rotation.x = Math.max(0, Math.sin(ped.walkPhase)) * 1.0;
  } else if (ped.mode === "talk") {
    // Hands gesture while talking; legs still; slow breathing.
    const wave = Math.sin(S.time * 3 + ped.talkPhase) * 0.35;
    ped.armL.rotation.x = -0.6 + wave;
    ped.armR.rotation.x = -0.6 - wave;
    ped.foreL.rotation.x = -0.7;
    ped.foreR.rotation.x = -0.7;
    ped.legL.rotation.x = 0;
    ped.legR.rotation.x = 0;
    ped.shinL.rotation.x = 0;
    ped.shinR.rotation.x = 0;
    ped.head.rotation.y = 0.15 * Math.sin(S.time * 0.7 + ped.talkPhase);
    ped.chest.scale.y = breath;
  } else if (ped.mode === "sit") {
    // Seated: hips down on the bench, thighs forward, shins down.
    spot.y = 0.45;
    ped.legL.rotation.x = -1.5;
    ped.legR.rotation.x = -1.5;
    ped.shinL.rotation.x = 1.5;
    ped.shinR.rotation.x = 1.5;
    ped.armL.rotation.x = 0.1;
    ped.armR.rotation.x = 0.1;
    ped.foreL.rotation.x = -0.3;
    ped.foreR.rotation.x = -0.3;
  } else if (ped.mode === "phone") {
    // The phone up in the right hand, head tipped down at the screen.
    ped.phone.visible = true;
    ped.armR.rotation.x = -1.1;
    ped.foreR.rotation.x = -0.6;
    ped.armL.rotation.x = 0;
    ped.foreL.rotation.x = -0.2;
    ped.head.rotation.x = 0.3;
    ped.head.rotation.y = 0;
    ped.legL.rotation.x = 0;
    ped.legR.rotation.x = 0;
    ped.shinL.rotation.x = 0;
    ped.shinR.rotation.x = 0;
    ped.chest.scale.y = breath;
  } else if (ped.mode === "wait") {
    ped.phone.visible = false;
    ped.head.rotation.x = 0;
    // Standing still: breathe, and glance around now and then.
    ped.head.rotation.y = 0.5 * Math.sin(S.time * 0.45 + ped.talkPhase * 2);
    ped.legL.rotation.x = 0;
    ped.legR.rotation.x = 0;
    ped.shinL.rotation.x = 0;
    ped.shinR.rotation.x = 0;
    ped.armL.rotation.x = 0;
    ped.armR.rotation.x = 0;
    ped.foreL.rotation.x = -0.15;
    ped.foreR.rotation.x = -0.15;
    ped.chest.scale.y = breath;
  } else {
    ped.phone.visible = false;
    ped.head.rotation.x = 0;
    ped.head.rotation.y = 0;
    ped.legL.rotation.x = Math.sin(ped.walkPhase) * sway;
    ped.legR.rotation.x = -Math.sin(ped.walkPhase) * sway;
    ped.shinL.rotation.x = Math.max(0, -Math.sin(ped.walkPhase)) * 0.9;
    ped.shinR.rotation.x = Math.max(0, Math.sin(ped.walkPhase)) * 0.9;
    ped.armL.rotation.x = -Math.sin(ped.walkPhase) * sway * 0.9;
    ped.armR.rotation.x = Math.sin(ped.walkPhase) * sway * 0.9;
    ped.foreL.rotation.x = -0.3 - 0.15 * Math.abs(Math.sin(ped.walkPhase));
    ped.foreR.rotation.x = -0.3 - 0.15 * Math.abs(Math.sin(ped.walkPhase));
    ped.chest.scale.y = 1;
  }
}
