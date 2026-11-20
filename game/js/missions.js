// Solmar City — the story campaign.
// Five jobs, then free roam. First comes Sunrise Delivery: fetch a
// package from the Hideout and carry it to Marina Park ($300). Then
// Borrowed Wheels: steal a car and bring it to the Hideout garage
// ($400). Then Cool Down: shake the cops until the wanted level is zero
// ($500). Then Five Drops: pick up five drops scattered over the city
// ($600). Last, Harbor Run: reach the harbor pier ($800). A gold beacon
// marks the current target, and a gold chevron floats above the player
// pointing at it (hidden while driving). A job pays exactly once — a
// finishing flag plus a done stage keep the payout from firing every
// frame — and the next job starts a second and a half later.

import * as THREE from '../vendor/three.module.min.js';
import { S, LANDMARKS, toast, clearToasts, dist2 } from './state.js';
import { nearestCar } from './vehicles.js';

const QUESTS = [
  { name: 'Sunrise Delivery', reward: 300 },
  { name: 'Borrowed Wheels', reward: 400 },
  { name: 'Cool Down', reward: 500 },
  { name: 'Five Drops', reward: 600 },
  { name: 'Harbor Run', reward: 800 },
];

// Where the five drops for job 4 sit, spread across the city.
const DROP_POINTS = [
  { x: 0, z: 0 },
  { x: 80, z: 80 },
  { x: -80, z: -120 },
  { x: 120, z: 40 },
  { x: -40, z: 160 },
];

let payingOut = false;
let beaconTarget = null;
let guideArrow = null;
let drops = [];
let takenCount = 0;
let jobTimer = 0;

function ensureBeacon() {
  if (S.beacon) return;
  const group = new THREE.Group();
  // A tall see-through gold column, so the target reads from across town.
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd94a,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  column.position.y = 30;
  group.add(column);
  // A pulsing ring on the ground marking the exact spot.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3.0, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffd94a,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  group.userData.ring = ring;
  S.scene.add(group);
  S.beacon = group;
  // The nav arrow: a gold chevron floating above the player, pointing at
  // the target. Hidden while driving (from the low chase camera it loomed
  // like a paper plane) and hidden when there is no target. Scaled to
  // about half size so it reads as a quest marker, not a billboard.
  guideArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.4, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd94a })
  );
  guideArrow.rotation.x = Math.PI / 2; // point forward, not up
  guideArrow.scale.set(0.55, 0.55, 0.55);
  guideArrow.visible = false;
  S.scene.add(guideArrow);
} // end of ensureBeacon()

function placeBeacon(x, z) {
  ensureBeacon();
  beaconTarget = { x, z };
  S.beacon.position.set(x, 0, z);
  S.beacon.visible = true;
} // end of placeBeacon()

function hideBeacon() {
  beaconTarget = null;
  if (S.beacon) S.beacon.visible = false;
  if (guideArrow) guideArrow.visible = false;
} // end of hideBeacon()

function clearDrops() {
  for (let i = 0; i < drops.length; i++) S.scene.remove(drops[i].mesh);
  drops = [];
  takenCount = 0;
} // end of clearDrops()

function spawnDrops() {
  clearDrops();
  for (const spot of DROP_POINTS) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.22, 8, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd94a })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(spot.x, 1.0, spot.z);
    S.scene.add(mesh);
    drops.push({ mesh, x: spot.x, z: spot.z, taken: false });
  }
}

function setupJob(idx) {
  // Each job's opening objective and where its beacon (if any) goes.
  const jobSetups = [
    {
      text: 'Pick up the package at the Hideout',
      setup: () => placeBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z),
    },
    {
      text: 'Steal a car first',
      setup: () => hideBeacon(),
    },
    {
      text: 'Lose the cops — get your wanted level to zero',
      setup: () => hideBeacon(),
    },
    {
      text: 'Collect the drops (0/5)',
      setup: () => { spawnDrops(); hideBeacon(); },
    },
    {
      text: 'Reach the harbor',
      setup: () => placeBeacon(LANDMARKS.harbor.x, LANDMARKS.harbor.z),
    },
  ];
  const job = jobSetups[idx];
  S.objectiveText = job.text;
  S.objectiveDist = null;
  job.setup();
} // end of setupJob()

export function startMission(idx) {
  ensureBeacon();
  clearDrops();
  S.missionIndex = idx;
  S.missionStage = 0;
  jobTimer = 0;
  clearToasts();
  const m = QUESTS[idx];
  toast('Mission ' + (idx + 1) + ' — ' + m.name, 'Reward $' + m.reward);
  setupJob(idx);
} // end of startMission()

function finishMission() {
  if (payingOut) return;
  payingOut = true;
  const idx = S.missionIndex;
  const quest = QUESTS[idx];
  S.cash += quest.reward;
  S.missionsCompleted += 1;
  // Mark the job done so the tick cannot pay it again while the next job
  // is queued.
  S.missionStage = 99;
  clearToasts();
  S.debug.longRewardToast = true;
  toast('Mission complete +$' + quest.reward, quest.name + ' — $' + quest.reward + ' earned');
  if (S.audio) S.audio.jingle();
  setTimeout(() => {
    payingOut = false;
    // During a staged screenshot the next job must NOT start: it would
    // clear the reward toast and rewrite the objective mid-shot. The
    // functional test runs unstaged, so it still gets the auto-start.
    if (S.debug.staged === 'mission') return;
    if (idx + 1 < QUESTS.length) {
      startMission(idx + 1);
    } else {
      S.freeRoam = true;
      S.objectiveText = 'Free roam — all missions complete';
      S.objectiveDist = null;
      hideBeacon();
      const replay = document.getElementById('btn-replay');
      if (replay) replay.style.display = 'inline-block';
    }
  }, 1500);
} // end of finishMission()

// Debug path used by the harness and the mission screenshot: put the
// player at the delivery point and pay mission 1 out.
export function debugCompleteMission1() {
  S.missionIndex = 0;
  S.missionStage = 1;
  if (S.player) {
    S.player.pos.x = LANDMARKS.marinaPark.x;
    S.player.pos.z = LANDMARKS.marinaPark.z;
    S.player.group.position.set(LANDMARKS.marinaPark.x, 0, LANDMARKS.marinaPark.z);
  }
  finishMission();
}

function tickMission0(dt) {
  const px = S.player.pos.x;
  const pz = S.player.pos.z;
  const hx = LANDMARKS.hideout.x;
  const hz = LANDMARKS.hideout.z;
  const mx = LANDMARKS.marinaPark.x;
  const mz = LANDMARKS.marinaPark.z;
  if (S.missionStage === 1) {
    // Stage 1: deliver to Marina Park.
    S.objectiveDist = dist2(px, pz, mx, mz);
    if (dist2(px, pz, mx, mz) < 4) {
      finishMission();
    }
    return;
  }
  // Stage 0: fetch the package at the Hideout.
  S.objectiveDist = dist2(px, pz, hx, hz);
  if (dist2(px, pz, hx, hz) < 4) {
    S.missionStage += 1;
    toast('Package collected', 'Deliver it to Marina Park');
    S.objectiveText = 'Deliver the package to Marina Park';
    placeBeacon(mx, mz);
  }
}

function tickMission1(dt) {
  if (S.missionStage === 1) {
    // Stage 1: drive the stolen car into the Hideout garage.
    S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
    if (dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z) < 9) {
      finishMission();
    }
    return;
  }
  // Stage 0: steal a car. Show the distance to the nearest one.
  const car = nearestCar(S.player.pos.x, S.player.pos.z, 500);
  if (car) {
    S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, car.mesh.position.x, car.mesh.position.z);
  } else {
    S.objectiveDist = null;
  }
  if (!S.onFoot) {
    S.missionStage += 1;
    S.objectiveText = 'Bring the car to the Hideout garage';
    placeBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
  }
}

function tickMission2(dt) {
  // Lose the cops: the job only counts once it has been running a moment,
  // so a player who starts it already clean does not finish it on the
  // first frame.
  jobTimer += dt;
  if (jobTimer > 1 && S.heat <= 0) finishMission();
} // end of tickMission2()

function tickMission3(dt) {
  // Collect the five drops.
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    if (d.taken) continue;
    // Spin the rings so they catch the eye.
    d.mesh.rotation.z += dt * 1.5;
    d.mesh.position.y = 1.0 + Math.sin(S.time * 2 + d.x) * 0.25;
    if (dist2(S.player.pos.x, S.player.pos.z, d.x, d.z) < 2.5) {
      d.taken = true;
      d.mesh.visible = false;
      takenCount += 1;
      S.objectiveText = 'Collect the drops (' + takenCount + '/5)';
      if (S.audio) S.audio.pickup();
      if (takenCount >= 5) finishMission();
    }
  }
}

function tickMission4(dt) {
  const hx = LANDMARKS.harbor.x;
  const hz = LANDMARKS.harbor.z;
  S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, hx, hz);
  if (dist2(S.player.pos.x, S.player.pos.z, hx, hz) < 10) {
    finishMission();
  }
} // end of tickMission4()

const TICKERS = [tickMission0, tickMission1, tickMission2, tickMission3, tickMission4];

export function updateMissions(dt) {
  if (S.mode !== 'playing') return;
  if (S.missionStage === 99) return; // done, waiting for the next mission
  if (!S.player) return;
  TICKERS[S.missionIndex](dt);
} // end of updateMissions()

export function updateBeacon(dt) {
  if (!S.beacon || !guideArrow) return;
  // Pulse the ground ring.
  const ring = S.beacon.userData.ring;
  if (ring) {
    const pulse = 0.55 + Math.sin(S.time * 3) * 0.25;
    ring.material.opacity = pulse;
    const s = 1 + Math.sin(S.time * 3) * 0.12;
    ring.scale.set(s, s, 1);
  }
  // The nav arrow floats above the player and points at the target. It is
  // hidden while driving and when there is no target.
  if (!beaconTarget || !S.onFoot || !S.player || S.mode !== 'playing') {
    guideArrow.visible = false;
    return;
  }
  guideArrow.visible = true;
  guideArrow.position.set(S.player.pos.x, 2.5, S.player.pos.z);
  const dx = beaconTarget.x - S.player.pos.x;
  const dz = beaconTarget.z - S.player.pos.z;
  guideArrow.rotation.y = Math.atan2(dx, dz);
  // Bob gently so it reads as a floating marker.
  guideArrow.position.y = 2.5 + Math.sin(S.time * 2.5) * 0.15;
}
