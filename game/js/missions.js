// Solmar City — the five story missions.
// Toasts are cleared the instant a mission completes or starts, and the
// reward banner goes out first with the next mission's title ~1.5 s later,
// so banners never stack four deep. The gold beacon is brighter now, and
// mission 2 shows no garage distance until the car is actually stolen.

import * as THREE from '../vendor/three.module.min.js';
import { S, LANDMARKS, toast, clearToasts, addHeat, dist2 } from './state.js';
import { nearestCar, enterCar } from './vehicles.js';
import { spawnCruiser } from './police.js';

const PAYOUTS = [300, 500, 400, 600, 1200];

function buildBeacon() {
  const group = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.6, 42, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  );
  column.position.y = 21;
  group.add(column);
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3.0, 42, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  shell.position.y = 21;
  group.add(shell);
  const circle = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.15;
  group.add(circle);
  const jewel = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xffd94a })
  );
  jewel.position.y = 6;
  group.add(jewel);
  group.visible = false;
  S.scene.add(group);
  S.beacon = { group, ring: circle, pillar: column, gem: jewel, target: { x: 0, z: 0 }, pulse: 0 };
  // 3D navigation arrow: a gold chevron that floats above the player and
  // points at the mission target, so the way is visible without the minimap.
  const arrow = new THREE.Group();
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.7, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd94a })
  );
  tip.rotation.x = Math.PI / 2;
  tip.scale.set(1, 1, 0.35);
  arrow.add(tip);
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.9),
    new THREE.MeshBasicMaterial({ color: 0xffd94a })
  );
  shaft.position.z = -0.9;
  arrow.add(shaft);
  // Small and low, hugging the player like a quest marker — the first
  // version (scale 1, y 3.4) read as a paper plane floating in the sky.
  arrow.scale.set(0.55, 0.55, 0.55);
  arrow.visible = false;
  S.scene.add(arrow);
  S.navArrow = arrow;
  return S.beacon;
}

function placeBeacon(x, z) {
  if (!S.beacon) buildBeacon();
  S.beacon.group.position.set(x, 0, z);
  S.beacon.group.visible = true;
  S.beacon.target = { x, z };
}

function hideBeacons() {
  if (S.beacon) S.beacon.group.visible = false;
  if (S.navArrow) S.navArrow.visible = false;
}

export function updateBeacon(dt) {
  if (!S.beacon || !S.beacon.group.visible) {
    if (S.navArrow) S.navArrow.visible = false;
    return;
  }
  S.beacon.pulse += dt;
  const s = 1 + Math.sin(S.beacon.pulse * 3) * 0.12;
  S.beacon.ring.scale.set(s, s, 1);
  S.beacon.gem.rotation.y += dt * 2;
  S.beacon.gem.position.y = 6 + Math.sin(S.beacon.pulse * 2) * 0.5;
  // Nav arrow hovers just above the player, pointing at the beacon target.
  // On foot only: from the low chase camera it looms over the car and
  // reads as a paper plane in the cover shot.
  const player = S.player;
  const arrow = S.navArrow;
  if (!player || !arrow) return;
  arrow.visible = !!S.onFoot;
  if (!arrow.visible) return;
  const bob = 2.5 + Math.sin(S.beacon.pulse * 2.5) * 0.15;
  arrow.position.set(player.pos.x, bob, player.pos.z);
  arrow.rotation.y = Math.atan2(S.beacon.target.x - player.pos.x, S.beacon.target.z - player.pos.z);
}

const MISSIONS = [
  {
    title: 'Mission 1: Sunrise Delivery',
    brief: 'A client left a package at the Hideout. Carry it to Marina Park.',
    start() {
      S.objectiveText = 'Pick up the package at the Hideout';
      placeBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
      S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
      S.missionStage = 0;
    },
    tick() {
      const here = S.player.pos;
      const hideout = LANDMARKS.hideout;
      const park = LANDMARKS.marinaPark;
      if (S.missionStage === 0) {
        S.objectiveDist = dist2(here.x, here.z, hideout.x, hideout.z);
        if (S.objectiveDist >= 6) return;
        S.missionStage = 1;
        S.objectiveText = 'Deliver the package to Marina Park';
        placeBeacon(park.x, park.z);
        toast('Package collected', 'Take it to Marina Park', 4);
        return;
      }
      S.objectiveDist = dist2(here.x, here.z, park.x, park.z);
      if (S.objectiveDist < 6) completeMission();
    },
  },
  {
    title: 'Mission 2: Borrowed Wheels',
    brief: 'The crew needs a fast car. Steal one and bring it to the Hideout garage.',
    start() {
      S.objectiveText = 'Steal a car first (walk up to one and press E)';
      S.objectiveDist = null; // no garage distance before the steal
      placeBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
      S.missionStage = 0;
    },
    tick() {
      const here = S.player.pos;
      const hideout = LANDMARKS.hideout;
      if (S.missionStage === 0) {
        // Before the steal, show the distance to the nearest car instead.
        const car = nearestCar(here.x, here.z, 400);
        S.objectiveDist = car ? dist2(here.x, here.z, car.mesh.position.x, car.mesh.position.z) : null;
        if (S.onFoot || !S.currentCar) return;
        S.missionStage = 1;
        S.objectiveText = 'Bring the car to the Hideout garage';
        toast('Car stolen', 'Lose the heat, then bring it in', 4);
        return;
      }
      S.objectiveDist = dist2(here.x, here.z, hideout.x, hideout.z);
      if (S.objectiveDist < 8) completeMission();
    },
  },
  {
    title: 'Mission 3: Cool Down',
    brief: 'The heat is on. Lose the cops, then get back to the Hideout.',
    start() {
      S.objectiveText = 'Lose the cops — get your wanted level to zero';
      S.objectiveDist = null;
      placeBeacon(LANDMARKS.hideout.x, LANDMARKS.hideout.z);
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
      if (S.missionStage !== 1) return;
      S.objectiveDist = dist2(S.player.pos.x, S.player.pos.z, LANDMARKS.hideout.x, LANDMARKS.hideout.z);
      if (S.objectiveDist < 8) completeMission();
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
      dropMarkers();
      placeBeacon(S.dropSpots[0].x, S.dropSpots[0].z);
      S.missionStage = 0;
    },
    tick() {
      const here = S.player.pos;
      let remaining = 0;
      let target = null;
      for (const d of S.dropSpots) {
        if (d.taken) continue;
        remaining++;
        if (!target) target = d;
        if (dist2(here.x, here.z, d.x, d.z) >= 5) continue;
        d.taken = true;
        S.cash += 100;
        if (d.marker) d.marker.visible = false;
        toast('Drop collected', '+$100', 3);
      }
      S.dropsLeft = remaining;
      S.objectiveText = `Collect the cash drops (${5 - remaining}/5)`;
      if (!target) {
        S.objectiveDist = null;
        completeMission();
        return;
      }
      S.objectiveDist = dist2(here.x, here.z, target.x, target.z);
      placeBeacon(target.x, target.z);
    },
  },
  {
    title: 'Mission 5: Harbor Run',
    brief: 'Final job: drive the package to Solmar Harbor and slip away.',
    start() {
      S.objectiveText = 'Drive to Solmar Harbor';
      placeBeacon(LANDMARKS.harbor.x, LANDMARKS.harbor.z);
      S.missionStage = 0;
    },
    tick() {
      const here = S.player.pos;
      const harbor = LANDMARKS.harbor;
      S.objectiveDist = dist2(here.x, here.z, harbor.x, harbor.z);
      if (S.objectiveDist < 10) completeMission();
    },
  },
];

function dropMarkers() {
  for (const d of S.dropSpots) {
    const marker = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), new THREE.MeshLambertMaterial({ color: 0x2a7a3a }));
    bag.position.y = 0.3;
    marker.add(bag);
    const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0x4ad87a }));
    jewel.position.y = 1.6;
    marker.add(jewel);
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
  const reward = PAYOUTS[S.missionIndex] || 300;
  S.cash += reward;
  S.missionsCompleted++;
  hideBeacons();
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
      return;
    }
    clearToasts();
    toast('All missions complete!', 'Free roam — replay any mission from the menu', 8);
    S.objectiveText = 'Free roam — all missions complete';
    S.objectiveDist = null;
    S.missionIndex = 0;
    S.freeRoam = true;
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
