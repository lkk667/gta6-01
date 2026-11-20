// Solmar City — story missions.
// Five missions, then free roam: (1) Sunrise Delivery — pick up a package
// at the Hideout and deliver it to Marina Park, $300; (2) Borrowed Wheels
// — steal a car and bring it to the Hideout garage, $400; (3) Cool Down —
// lose the cops until wanted is zero, $500; (4) Five Drops — collect five
// drops scattered across the city, $600; (5) Harbor Run — reach the harbor
// pier, $800. A gold beacon marks the current target and a gold chevron
// floats above the player pointing at it (hidden while driving).
// Completion pays once (a `completing` guard plus a done stage stop the
// payout re-firing every frame) and the next mission starts 1.5 s later.

import * as THREE from '../vendor/three.module.min.js';
import { S, LANDMARKS, toast, clearToasts, dist2 } from './state.js';
import { nearestCar } from './vehicles.js';

const MISSIONS = [
  { name: 'Sunrise Delivery', reward: 300 },
  { name: 'Borrowed Wheels', reward: 400 },
  { name: 'Cool Down', reward: 500 },
  { name: 'Five Drops', reward: 600 },
  { name: 'Harbor Run', reward: 800 },
];

// The five drop spots for mission 4, spread across the city.
const DROP_SPOTS = [
  { x: 0, z: 0 },
  { x: 80, z: 80 },
  { x: -80, z: -120 },
  { x: 120, z: 40 },
  { x: -40, z: 160 },
];

let completing = false;
let beaconTarget = null;
let arrow = null;
let drops = [];
let dropsCollected = 0;
let missionTimer = 0;

function makeBeacon() {
  if (S.beacon) return;
  const group = new THREE.Group();
  // A tall translucent gold column so the target reads from across the city.
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
  );
  column.position.y = 30;
  group.add(column);
  // A pulsing ring on the ground marking the exact spot.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3.0, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
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
  arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.4, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd94a })
  );
  arrow.rotation.x = Math.PI / 2; // point forward, not up
  arrow.scale.set(0.55, 0.55, 0.55);
  arrow.visible = false;
  S.scene.add(arrow);
}

function setBeacon(x, z) {
  makeBeacon();
  beaconTarget = { x, z };
  S.beacon.position.set(x, 0, z);
  S.beacon.visible = true;
}

function hideBeacon() {
  beaconTarget = null;
  if (S.beacon) S.beacon.visible = false;
  if (arrow) arrow.visible = false;
}

function clearDrops() {
  for (const d of drops) S.scene.remove(d.mesh);
  drops = [];
  dropsCollected = 0;
}

function spawnDrops() {
  clearDrops();
  for (const spot of DROP_SPOTS) {
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

export function startMission(idx) {
  makeBeacon();
  clearDrops();
  S.missionIndex = idx;
  S.missionStage = 0;
  missionTimer = 0;
  clearToasts();
  const m = MISSIONS[idx];
  toast('Mission ' + (idx + 1) + ' — ' + m.name, 'Reward $' + m.reward);
  if (idx === 0) {
    S.objectiveText = 'Pick up the package at the Hideout';
    S.objectiveDist = null;
    setBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
  } else if (idx === 1) {
    S.objectiveText = 'Steal a car first';
    S.objectiveDist = null;
    hideBeacon();
  } else if (idx === 2) {
    S.objectiveText = 'Lose the cops — get your wanted level to zero';
    S.objectiveDist = null;
    hideBeacon();
  } else if (idx === 3) {
    S.objectiveText = 'Collect the drops (0/5)';
    S.objectiveDist = null;
    spawnDrops();
    hideBeacon();
  } else if (idx === 4) {
    S.objectiveText = 'Reach the harbor';
    S.objectiveDist = null;
    setBeacon(LANDMARKS.harbor.x, LANDMARKS.harbor.z);
  }
}

function completeMission() {
  if (completing) return;
  completing = true;
  const idx = S.missionIndex;
  const m = MISSIONS[idx];
  S.cash += m.reward;
  S.missionsCompleted += 1;
  // Mark the mission done so the tick cannot pay it again while the next
  // mission is queued.
  S.missionStage = 99;
  clearToasts();
  S.debug.longRewardToast = true;
  toast('Mission complete +$' + m.reward, m.name + ' — $' + m.reward + ' earned');
  if (S.audio) S.audio.jingle();
  setTimeout(() => {
    completing = false;
    // During a staged screenshot the next mission must NOT start: it would
    // clear the reward toast and rewrite the objective mid-shot. The
    // functional test runs unstaged, so it still gets the auto-start.
    if (S.debug.staged === 'mission') return;
    if (idx + 1 < MISSIONS.length) {
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
}

// Debug path used by the harness and the mission screenshot: put the player
// at the delivery point and pay mission 1 out.
export function debugCompleteMission1() {
  S.missionIndex = 0;
  S.missionStage = 1;
  if (S.player) {
    S.player.pos.x = LANDMARKS.marinaPark.x;
    S.player.pos.z = LANDMARKS.marinaPark.z;
    S.player.group.position.set(LANDMARKS.marinaPark.x, 0, LANDMARKS.marinaPark.z);
  }
  completeMission();
}

function updateMission0(dt) {
  const px = S.player.pos.x;
  const pz = S.player.pos.z;
  if (S.missionStage === 0) {
    // Stage 0: fetch the package at the Hideout.
    S.objectiveDist = dist2(px, pz, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
    if (dist2(px, pz, LANDMARKS.hideout.x, LANDMARKS.hideout.z) < 4) {
      S.missionStage = 1;
      toast('Package collected', 'Deliver it to Marina Park');
      S.objectiveText = 'Deliver the package to Marina Park';
      setBeacon(LANDMARKS.marinaPark.x, LANDMARKS.marinaPark.z);
    }
  } else if (S.missionStage === 1) {
    // Stage 1: deliver to Marina Park.
    S.objectiveDist = dist2(px, pz, LANDMARKS.marinaPark.x, LANDMARKS.marinaPark.z);
    if (dist2(px, pz, LANDMARKS.marinaPark.x, LANDMARKS.marinaPark.z) < 4) {
      completeMission();
    }
  }
}

function updateMission1(dt) {
  if (S.missionStage === 0) {
    // Stage 0: steal a car. Show the distance to the nearest one.
    const car = nearestCar(S.player.pos.x, S.player.pos.z, 500);
    if (car) {
      S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, car.mesh.position.x, car.mesh.position.z);
    } else {
      S.objectiveDist = null;
    }
    if (!S.onFoot) {
      S.missionStage = 1;
      S.objectiveText = 'Bring the car to the Hideout garage';
      setBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
    }
  } else if (S.missionStage === 1) {
    // Stage 1: drive the stolen car into the Hideout garage.
    S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
    if (dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z) < 9) {
      completeMission();
    }
  }
}

function updateMission2(dt) {
  // Lose the cops: the mission only counts once it has been running a
  // moment, so a player who starts it already clean does not finish it
  // on the first frame.
  missionTimer += dt;
  if (missionTimer > 1 && S.heat <= 0) completeMission();
}

function updateMission3(dt) {
  // Collect the five drops.
  for (const d of drops) {
    if (d.taken) continue;
    // Spin the rings so they catch the eye.
    d.mesh.rotation.z += dt * 1.5;
    d.mesh.position.y = 1.0 + Math.sin(S.time * 2 + d.x) * 0.25;
    if (dist2(S.player.pos.x, S.player.pos.z, d.x, d.z) < 2.5) {
      d.taken = true;
      d.mesh.visible = false;
      dropsCollected += 1;
      S.objectiveText = 'Collect the drops (' + dropsCollected + '/5)';
      if (S.audio) S.audio.pickup();
      if (dropsCollected >= 5) completeMission();
    }
  }
}

function updateMission4(dt) {
  S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.harbor.x, LANDMARKS.harbor.z);
  if (dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.harbor.x, LANDMARKS.harbor.z) < 10) {
    completeMission();
  }
}

export function updateMissions(dt) {
  if (S.mode !== 'playing') return;
  if (S.missionStage === 99) return; // done, waiting for the next mission
  if (!S.player) return;
  if (S.missionIndex === 0) updateMission0(dt);
  else if (S.missionIndex === 1) updateMission1(dt);
  else if (S.missionIndex === 2) updateMission2(dt);
  else if (S.missionIndex === 3) updateMission3(dt);
  else if (S.missionIndex === 4) updateMission4(dt);
}

export function updateBeacon(dt) {
  if (!S.beacon || !arrow) return;
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
    arrow.visible = false;
    return;
  }
  arrow.visible = true;
  arrow.position.set(S.player.pos.x, 2.5, S.player.pos.z);
  const dx = beaconTarget.x - S.player.pos.x;
  const dz = beaconTarget.z - S.player.pos.z;
  arrow.rotation.y = Math.atan2(dx, dz);
  // Bob gently so it reads as a floating marker.
  arrow.position.y = 2.5 + Math.sin(S.time * 2.5) * 0.15;
}
