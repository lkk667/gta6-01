// Solmar City — the story: five missions, a gold beacon marking the
// target, cash rewards, and free roam with replay once the finale is done.

import * as THREE from 'three';
import { S, LANDMARKS, addCash, toast, fmtCash, dist2d, clamp, setHeat } from './state.js';
import { player } from './player.js';
import { clearWanted } from './police.js';

export const MISSIONS = [
  {
    name: 'Sunrise Delivery',
    briefing: 'A client left a package at the Hideout. Carry it to Marina Park.',
    reward: 300,
    target: () => ({ x: LANDMARKS.parkA.x, z: LANDMARKS.parkA.z }),
    objective: 'Deliver the package to Marina Park',
  },
  {
    name: 'Borrowed Wheels',
    briefing: 'The crew needs a fast car. Steal one and bring it to the Hideout garage.',
    reward: 500,
    target: () => ({ x: LANDMARKS.hideout.x, z: LANDMARKS.hideout.z - 12 }),
    objective: 'Steal a car and bring it to the Hideout',
  },
  {
    name: 'Cool Down',
    briefing: 'The heat is on. Shake the cops and stay clean until the wanted level drops.',
    reward: 400,
    target: () => ({ x: LANDMARKS.hideout.x, z: LANDMARKS.hideout.z }),
    objective: 'Lose the cops — get your wanted level to zero',
  },
  {
    name: 'Five Drops',
    briefing: 'Five stashes are hidden around the city. Pick them all up.',
    reward: 600,
    target: () => ({ x: 0, z: 0 }),
    objective: 'Collect the drops',
  },
  {
    name: 'Harbor Run',
    briefing: 'Pick up the cargo at the Harbor, then get it to the Hideout. No stops.',
    reward: 1000,
    target: () => ({ x: LANDMARKS.harbor.x, z: LANDMARKS.harbor.z }),
    objective: 'Pick up the cargo at Solmar Harbor',
  },
];

const DROP_SPOTS = [
  { x: -140, z: -140 },
  { x: 100, z: 60 },
  { x: -20, z: -140 },
  { x: 140, z: -60 },
  { x: 20, z: 140 },
];

let sceneRef = null;
let beacon = null;
let beaconRing = null;
let dropMeshes = [];

function makeBeacon() {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 42, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc832,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.position.y = 21;
  group.add(beam);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.18, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc832 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  group.add(ring);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9),
    new THREE.MeshBasicMaterial({ color: 0xffd95e }),
  );
  gem.position.y = 4;
  group.add(gem);
  group.visible = false;
  sceneRef.add(group);
  beacon = group;
  beaconRing = ring;
  return group;
}

function makeDropMesh() {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.8),
    new THREE.MeshBasicMaterial({ color: 0x7affc8 }),
  );
  mesh.visible = false;
  sceneRef.add(mesh);
  return mesh;
}

export function buildMissions(scene) {
  sceneRef = scene;
  makeBeacon();
  for (let i = 0; i < 5; i++) dropMeshes.push(makeDropMesh());
}

/** Where the player is right now, on foot or in a car. */
function playerXZ() {
  if (S.car) return { x: S.car.group.position.x, z: S.car.group.position.z };
  return { x: player.pos.x, z: player.pos.z };
}

function moveBeacon(x, z) {
  beacon.position.set(x, 0, z);
  beacon.visible = true;
}

function hideBeacon() {
  beacon.visible = false;
}

function showDrops() {
  S.drops = DROP_SPOTS.map((spot, i) => ({ ...spot, taken: false }));
  S.drops.forEach((drop, i) => {
    dropMeshes[i].position.set(drop.x, 1.2, drop.z);
    dropMeshes[i].visible = true;
  });
}

function hideDrops() {
  for (const m of dropMeshes) m.visible = false;
  S.drops = [];
}

export function startMission(index) {
  if (index < 0 || index >= MISSIONS.length) return false;
  const def = MISSIONS[index];
  S.missionIndex = index;
  S.missionStage = 0;
  S.mission = { def, collected: 0 };
  S.objective = def.objective;
  toast(`Mission ${index + 1}: ${def.name}`, 5, true);
  toast(def.briefing, 6);
  hideDrops();

  if (index === 2) {
    // Lose the cops starts hot.
    setHeat(45);
  }
  if (index === 3) {
    showDrops();
    hideBeacon();
  } else {
    const t = def.target();
    moveBeacon(t.x, t.z);
  }
  S.hooks.onMissionStart?.(index);
  return true;
}

function completeMission() {
  const def = S.mission.def;
  const index = S.missionIndex;
  addCash(def.reward);
  S.missionsCompleted = Math.max(S.missionsCompleted, index + 1);
  toast(`Mission complete  +${fmtCash(def.reward)}`, S.debug.longRewardToast ? 60 : 6, true);
  S.hooks.onMissionComplete?.(index, def.reward);
  hideBeacon();
  hideDrops();
  S.mission = null;
  S.missionIndex = -1;
  S.missionStage = 0;
  if (index + 1 < MISSIONS.length) {
    // The next mission starts on its own.
    startMission(index + 1);
  } else {
    S.objective = 'Free roam — Solmar City is yours. Replay missions from the menu.';
    toast('Story complete! Free roam — replay any mission from the menu.', 8, true);
    clearWanted();
  }
}

export function updateMissions(dt) {
  // Beacon shimmer.
  if (beacon && beacon.visible) {
    beaconRing.rotation.z += dt * 1.5;
    const s = 1 + Math.sin(S.time * 3) * 0.08;
    beaconRing.scale.set(s, s, 1);
    const gem = beacon.children[2];
    if (gem) {
      gem.rotation.y += dt * 2;
      gem.position.y = 4 + Math.sin(S.time * 2) * 0.4;
    }
  }
  for (const m of dropMeshes) {
    if (m.visible) {
      m.rotation.y += dt * 2;
      m.position.y = 1.2 + Math.sin(S.time * 2 + m.position.x) * 0.25;
    }
  }
  if (!S.mission) return;

  const def = S.mission.def;
  const index = S.missionIndex;
  const p = playerXZ();

  if (index === 0) {
    const t = def.target();
    const d = dist2d(p.x, p.z, t.x, t.z);
    S.objectiveDist = d;
    if (d < 5) completeMission();
  } else if (index === 1) {
    const t = def.target();
    const d = dist2d(p.x, p.z, t.x, t.z);
    S.objectiveDist = d;
    if (S.car && S.stolenCar && d < 7) completeMission();
    else if (S.car) S.objective = 'Bring the stolen car to the Hideout';
    else S.objective = 'Steal a car first (walk up to one and press E)';
  } else if (index === 2) {
    S.objectiveDist = 0;
    S.objective = 'Lose the cops — wanted level: ' + S.stars + ' stars';
    if (S.wantedHeat <= 0) completeMission();
  } else if (index === 3) {
    let remaining = 0;
    S.drops.forEach((drop, i) => {
      if (drop.taken) return;
      remaining++;
      const d = dist2d(p.x, p.z, drop.x, drop.z);
      if (d < 3.5) {
        drop.taken = true;
        dropMeshes[i].visible = false;
        S.mission.collected++;
        addCash(50);
        toast(`Drop collected (${S.mission.collected}/5)  +$50`, 3);
        S.hooks.onPickup?.();
      }
    });
    S.objective = `Collect the drops (${S.mission.collected}/5)`;
    S.objectiveDist = 0;
    if (remaining === 0) completeMission();
  } else if (index === 4) {
    const harbor = { x: LANDMARKS.harbor.x, z: LANDMARKS.harbor.z };
    const hideout = { x: LANDMARKS.hideout.x, z: LANDMARKS.hideout.z - 12 };
    if (S.missionStage === 0) {
      const d = dist2d(p.x, p.z, harbor.x, harbor.z);
      S.objectiveDist = d;
      if (d < 7) {
        S.missionStage = 1;
        S.objective = 'Cargo secured — escape to the Hideout!';
        moveBeacon(hideout.x, hideout.z);
        toast('Cargo secured — get to the Hideout!', 5, true);
      }
    } else {
      const d = dist2d(p.x, p.z, hideout.x, hideout.z);
      S.objectiveDist = d;
      if (d < 7) completeMission();
    }
  }
}

/** The current objective line for the HUD, with distance when it applies. */
export function objectiveText() {
  if (S.mission && S.objectiveDist > 0) {
    return `${S.objective} — ${Math.round(S.objectiveDist)}m`;
  }
  return S.objective;
}
