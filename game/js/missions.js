// Solmar City — the five story missions (v3 rewrite).
// Toasts are cleared the instant a mission completes or starts, and the
// reward banner goes out first with the next mission's title ~1.5 s later,
// so banners never stack four deep. The gold beacon is brighter now, and
// mission 2 shows no garage distance until the car is actually stolen.

import * as THREE from '../vendor/three.module.min.js';
import { S, LANDMARKS, toast, clearToasts, addHeat, dist2 } from './state.js';
import { nearestCar, enterCar } from './vehicles.js';
import { spawnCruiser } from './police.js';

const REWARDS = [300, 500, 400, 600, 1200];

function buildBeacon() {
  const group = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.6, 42, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  );
  pillar.position.y = 21;
  group.add(pillar);
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3.0, 42, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  outer.position.y = 21;
  group.add(outer);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(ring);
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xffd94a })
  );
  gem.position.y = 6;
  group.add(gem);
  group.visible = false;
  S.scene.add(group);
  S.beacon = { group, ring, pillar, gem, target: { x: 0, z: 0 }, pulse: 0 };
  return S.beacon;
}

function moveBeacon(x, z) {
  if (!S.beacon) buildBeacon();
  S.beacon.group.position.set(x, 0, z);
  S.beacon.group.visible = true;
  S.beacon.target = { x, z };
}

function hideBeacon() {
  if (S.beacon) S.beacon.group.visible = false;
}

export function updateBeacon(dt) {
  if (!S.beacon || !S.beacon.group.visible) return;
  S.beacon.pulse += dt;
  const s = 1 + Math.sin(S.beacon.pulse * 3) * 0.12;
  S.beacon.ring.scale.set(s, s, 1);
  S.beacon.gem.rotation.y += dt * 2;
  S.beacon.gem.position.y = 6 + Math.sin(S.beacon.pulse * 2) * 0.5;
}

const MISSIONS = [
  {
    title: 'Mission 1: Sunrise Delivery',
    brief: 'A client left a package at the Hideout. Carry it to Marina Park.',
    start() {
      S.objectiveText = 'Pick up the package at the Hideout';
      moveBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
      S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
      S.missionStage = 0;
    },
    tick() {
      const p = S.player.pos;
      if (S.missionStage === 0) {
        S.objectiveDist = dist2(p.x, p.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
        if (S.objectiveDist < 6) {
          S.missionStage = 1;
          S.objectiveText = 'Deliver the package to Marina Park';
          moveBeacon(LANDMARKS.marinaPark.x, LANDMARKS.marinaPark.z);
          toast('Package collected', 'Take it to Marina Park', 4);
        }
      } else {
        S.objectiveDist = dist2(p.x, p.z, LANDMARKS.marinaPark.x, LANDMARKS.marinaPark.z);
        if (S.objectiveDist < 6) completeMission();
      }
    },
  },
  {
    title: 'Mission 2: Borrowed Wheels',
    brief: 'The crew needs a fast car. Steal one and bring it to the Hideout garage.',
    start() {
      S.objectiveText = 'Steal a car first (walk up to one and press E)';
      S.objectiveDist = null; // no garage distance before the steal
      moveBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
      S.missionStage = 0;
    },
    tick() {
      const p = S.player.pos;
      if (S.missionStage === 0) {
        // Before the steal, show the distance to the nearest car instead.
        const car = nearestCar(p.x, p.z, 400);
        S.objectiveDist = car ? dist2(p.x, p.z, car.mesh.position.x, car.mesh.position.z) : null;
        if (!S.onFoot && S.currentCar) {
          S.missionStage = 1;
          S.objectiveText = 'Bring the car to the Hideout garage';
          toast('Car stolen', 'Lose the heat, then bring it in', 4);
        }
      } else {
        S.objectiveDist = dist2(p.x, p.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
        if (S.objectiveDist < 8) completeMission();
      }
    },
  },
  {
    title: 'Mission 3: Cool Down',
    brief: 'The heat is on. Lose the cops, then get back to the Hideout.',
    start() {
      S.objectiveText = 'Lose the cops — get your wanted level to zero';
      S.objectiveDist = null;
      moveBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
      S.missionStage = 0;
      addHeat(55);
      spawnCruiser(S.player.pos.x + 40, S.player.pos.z);
    },
    tick() {
      if (S.missionStage === 0 && S.heat <= 0) {
        S.missionStage = 1;
        S.objectiveText = 'Heat is off — return to the Hideout';
        toast('Heat is off', 'Head back to the Hideout', 4);
      }
      if (S.missionStage === 1) {
        S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
        if (S.objectiveDist < 8) completeMission();
      }
    },
  },
  {
    title: 'Mission 4: Five Drops',
    brief: 'Five cash drops are stashed around the city. Collect them all.',
    start() {
      S.objectiveText = 'Collect the cash drops (0/5)';
      S.dropsLeft = 5;
      S.dropSpots = [
        { x: -120, z: -120 }, { x: 120, z: 120 }, { x: -40, z: 120 },
        { x: 120, z: -120 }, { x: 0, z: -160 },
      ].map((s) => ({ ...s, taken: false }));
      spawnDrops();
      moveBeacon(S.dropSpots[0].x, S.dropSpots[0].z);
      S.missionStage = 0;
    },
    tick() {
      const p = S.player.pos;
      let left = 0;
      let next = null;
      for (const d of S.dropSpots) {
        if (d.taken) continue;
        left++;
        if (!next) next = d;
        if (dist2(p.x, p.z, d.x, d.z) < 5) {
          d.taken = true;
          S.cash += 100;
          if (d.marker) d.marker.visible = false;
          toast('Drop collected', '+$100', 3);
        }
      }
      S.dropsLeft = left;
      S.objectiveText = `Collect the cash drops (${5 - left}/5)`;
      if (next) {
        S.objectiveDist = dist2(p.x, p.z, next.x, next.z);
        moveBeacon(next.x, next.z);
      } else {
        S.objectiveDist = null;
        completeMission();
      }
    },
  },
  {
    title: 'Mission 5: Harbor Run',
    brief: 'Final job: drive the package to Solmar Harbor and slip away.',
    start() {
      S.objectiveText = 'Drive to Solmar Harbor';
      moveBeacon(LANDMARKS.harbor.x, LANDMARKS.harbor.z);
      S.missionStage = 0;
    },
    tick() {
      const p = S.player.pos;
      S.objectiveDist = dist2(p.x, p.z, LANDMARKS.harbor.x, LANDMARKS.harbor.z);
      if (S.objectiveDist < 10) completeMission();
    },
  },
];

function spawnDrops() {
  for (const d of S.dropSpots) {
    const marker = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), new THREE.MeshLambertMaterial({ color: 0x2a7a3a }));
    bag.position.y = 0.3;
    marker.add(bag);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0x4ad87a }));
    gem.position.y = 1.6;
    marker.add(gem);
    marker.position.set(d.x, 0, d.z);
    S.scene.add(marker);
    d.marker = marker;
  }
}

export function startMission(index) {
  S.missionIndex = index;
  S.completing = false;
  const def = MISSIONS[index];
  if (!def) return;
  clearToasts();
  def.start();
  toast(def.title, def.brief, 6);
  if (S.audio) S.audio.missionStart();
}

export function completeMission() {
  if (S.completing) return; // one payout per completion, even if the tick re-fires
  S.completing = true;
  const reward = REWARDS[S.missionIndex] || 300;
  S.cash += reward;
  S.missionsCompleted++;
  hideBeacon();
  clearToasts();
  const life = S.debug.longRewardToast ? 60 : 6;
  toast(`Mission complete +$${reward}`, '', life);
  if (S.audio) S.audio.missionJingle();
  const next = S.missionIndex + 1;
  // Sequence: the next mission's title appears after the reward, never stacked.
  setTimeout(() => {
    if (S.mode !== 'playing') return;
    if (S.debug.holdReward) return; // staging holds the lone reward banner
    if (next < MISSIONS.length) {
      startMission(next);
    } else {
      clearToasts();
      toast('All missions complete!', 'Free roam — replay any mission from the menu', 8);
      S.objectiveText = 'Free roam — all missions complete';
      S.objectiveDist = null;
      S.missionIndex = 0;
      S.freeRoam = true;
    }
  }, 1500);
}

export function updateMissions(dt) {
  if (S.mode !== 'playing' || S.freeRoam || S.completing) return;
  const def = MISSIONS[S.missionIndex];
  if (def) def.tick();
}

// Debug hook used by the staging shots: teleport the player to the mission
// target and finish mission 1 right away.
export function debugCompleteMission1() {
  S.missionIndex = 0;
  const p = S.player.pos;
  p.x = LANDMARKS.marinaPark.x;
  p.z = LANDMARKS.marinaPark.z;
  S.player.group.position.set(p.x, 0, p.z);
  S.missionStage = 1;
  completeMission();
}

export { MISSIONS };
