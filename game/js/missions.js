// Solmar City — missions and the story.
// Mara Vega, a courier who owes the wrong people money, works off her debt
// one job at a time across Solmar City. Five missions, each a short chain of
// stages with a gold marker, a HUD objective and a cash reward; finishing
// the fifth ends the story and opens free roam. The engine is generic — a
// stage is a target to reach, a condition to meet, or a set of drops to
// collect — so new jobs slot in without touching the rest of the game.

import * as THREE from 'three';
import { state, addCash, addWanted, setToast, distance2D } from './state.js';
import { PLACES } from './city.js';
import { playMissionComplete, playCash } from './audio.js';

const MISSIONS = [
  {
    id: 'first-job',
    title: 'Mission 1 — First Job',
    intro: 'Mara owes the Ferraro crew $4,000. Rico has a parcel at Cafe Luna. Pick it up.',
    reward: 300,
    stages: [
      { type: 'goto', text: 'Pick up the parcel at Cafe Luna', target: PLACES.cafeLuna, radius: 6 },
      { type: 'goto', text: 'Deliver the parcel to Marina Plaza', target: PLACES.plaza, radius: 7 },
    ],
  },
  {
    id: 'hot-wheels',
    title: 'Mission 2 — Hot Wheels',
    intro: 'Rico needs wheels, fast. Steal any car on the street — and mind the cops.',
    reward: 500,
    stages: [
      { type: 'stealCar', text: 'Steal a car (walk up to one, press E)' },
      { type: 'goto', text: 'Drive the stolen car to the Hideout', target: PLACES.hideout, radius: 9, needCar: true },
    ],
  },
  {
    id: 'cool-down',
    title: 'Mission 3 — Cool Down',
    intro: 'The heat is on. Shake the Solmar PD and get your wanted level back to zero.',
    reward: 400,
    stages: [
      { type: 'loseCops', text: 'Lose the cops — wanted level must hit zero' },
    ],
  },
  {
    id: 'five-drops',
    title: 'Mission 4 — Five Drops',
    intro: 'Five packages stashed around the city. Collect them all before the crew loses patience.',
    reward: 800,
    stages: [
      { type: 'collect', text: 'Collect the stashed packages', count: 5 },
    ],
  },
  {
    id: 'harbor-score',
    title: 'Mission 5 — The Harbor Score',
    intro: 'One last job: the Ferraro cash crate at Solmar Harbor. Grab it, then vanish to the Hideout.',
    reward: 1500,
    stages: [
      { type: 'goto', text: 'Reach the cash crate at Solmar Harbor', target: PLACES.harbor, radius: 8 },
      { type: 'goto', text: 'Escape to the Hideout — the cops are coming', target: PLACES.hideout, radius: 9 },
    ],
  },
];

const DROP_SPOTS = [
  { x: -155, z: 31, name: 'Alley drop' },
  { x: 93, z: 93, name: 'Market drop' },
  { x: -31, z: -155, name: 'Tower drop' },
  { x: 155, z: -31, name: 'East drop' },
  { x: 31, z: 155, name: 'Beach drop' },
];

export function createMissionManager(scene) {
  const marker = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 30, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
  );
  beam.position.y = 15;
  marker.add(beam);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.25, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd24a }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.4;
  marker.add(ring);
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: 0xffe98a }),
  );
  diamond.position.y = 6;
  marker.add(diamond);
  marker.visible = false;
  scene.add(marker);

  return {
    scene,
    marker,
    beam,
    diamond,
    mission: null,
    stageIndex: 0,
    drops: [],
    dropMeshes: [],
    stageTimer: 0,
    loseCopsTimer: 0,
    onMissionComplete: null, // (mission) callback set by main.js
    onStoryComplete: null,
  };
}

export function missionCount() {
  return MISSIONS.length;
}

export function currentMissionTitle() {
  if (state.freeRoam) return 'Free Roam — Solmar is yours';
  const m = MISSIONS[state.missionIndex];
  return m ? m.title : 'Free Roam';
}

export function startMission(manager, index) {
  const mission = MISSIONS[index];
  if (!mission) return false;
  manager.mission = mission;
  manager.stageIndex = 0;
  manager.stageTimer = 0;
  manager.loseCopsTimer = 0;
  clearDrops(manager);
  state.objective = mission.stages[0].text;
  state.missionTimer = 0;
  setToast(`${mission.title}: ${mission.intro}`, 5);
  if (mission.id === 'cool-down' && state.wantedHeat < 40) {
    addWanted(45);
    setToast('A patrol spotted you — run!', 3);
  }
  if (mission.id === 'harbor-score') {
    addWanted(20);
  }
  enterStage(manager);
  return true;
}

function enterStage(manager) {
  const stage = manager.mission.stages[manager.stageIndex];
  if (!stage) return;
  state.objective = stage.text;
  state.missionTimer = stage.timeLimit || 0;
  manager.stageTimer = stage.timeLimit || 0;
  if (stage.type === 'goto') {
    state.missionTarget = { x: stage.target.x, z: stage.target.z };
    manager.marker.visible = true;
    manager.marker.position.set(stage.target.x, 0, stage.target.z);
  } else if (stage.type === 'collect') {
    spawnDrops(manager, stage.count);
    state.missionTarget = manager.drops.length ? { x: manager.drops[0].x, z: manager.drops[0].z } : null;
    manager.marker.visible = false;
  } else {
    state.missionTarget = null;
    manager.marker.visible = false;
  }
}

function spawnDrops(manager, count) {
  clearDrops(manager);
  const spots = DROP_SPOTS.slice(0, count);
  for (const spot of spots) {
    const mesh = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.8, 1.1),
      new THREE.MeshLambertMaterial({ color: 0xffd24a }),
    );
    box.position.y = 0.8;
    box.castShadow = true;
    mesh.add(box);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    glow.position.y = 0.8;
    mesh.add(glow);
    mesh.position.set(spot.x, 0, spot.z);
    manager.scene.add(mesh);
    manager.dropMeshes.push(mesh);
    manager.drops.push({ x: spot.x, z: spot.z, mesh, taken: false });
  }
}

function clearDrops(manager) {
  for (const mesh of manager.dropMeshes) manager.scene.remove(mesh);
  manager.dropMeshes = [];
  manager.drops = [];
}

function completeStage(manager) {
  manager.stageIndex += 1;
  playCash();
  if (manager.stageIndex >= manager.mission.stages.length) {
    completeMission(manager);
  } else {
    const next = manager.mission.stages[manager.stageIndex];
    setToast(`Stage clear — ${next.text}`, 3);
    enterStage(manager);
  }
}

function completeMission(manager) {
  const mission = manager.mission;
  addCash(mission.reward);
  state.missionsCompleted += 1;
  state.missionIndex += 1;
  manager.marker.visible = false;
  state.missionTarget = null;
  clearDrops(manager);
  playMissionComplete();
  setToast(`${mission.title} complete! +$${mission.reward}`, 4);
  if (manager.onMissionComplete) manager.onMissionComplete(mission);

  if (state.missionIndex >= MISSIONS.length) {
    state.freeRoam = true;
    state.objective = 'Free Roam — Solmar City is yours. Replay missions from the pause menu.';
    if (manager.onStoryComplete) manager.onStoryComplete();
  } else {
    // The next job starts where the player stands: brief pause, then go.
    const next = MISSIONS[state.missionIndex];
    setTimeout(() => {
      if (state.mode === 'playing') startMission(manager, state.missionIndex);
    }, 4500);
    state.objective = `Next: ${next.title} — starting shortly…`;
  }
  manager.mission = null;
}

export function updateMissions(manager, dt) {
  // Marker animation.
  if (manager.marker.visible) {
    manager.diamond.rotation.y += dt * 2;
    manager.diamond.position.y = 6 + Math.sin(state.time * 2.5) * 0.8;
    manager.beam.material.opacity = 0.18 + Math.sin(state.time * 3) * 0.07;
  }
  for (const drop of manager.drops) {
    if (!drop.taken) drop.mesh.rotation.y += dt * 2;
  }
  if (!manager.mission || state.mode !== 'playing') return;

  const stage = manager.mission.stages[manager.stageIndex];
  if (!stage) return;
  const p = state.player;

  if (stage.type === 'goto') {
    const d = distance2D(p.x, p.z, stage.target.x, stage.target.z);
    state.objectiveDistance = d;
    const blocked = stage.needCar && !p.inCar;
    if (d < stage.radius && !blocked) {
      completeStage(manager);
    } else if (d < stage.radius && blocked) {
      state.objective = `${stage.text} (you need to be in a car)`;
    } else {
      state.objective = stage.text;
    }
  } else if (stage.type === 'stealCar') {
    if (p.inCar) completeStage(manager);
  } else if (stage.type === 'loseCops') {
    if (state.wantedHeat <= 0) {
      manager.loseCopsTimer += dt;
      if (manager.loseCopsTimer > 1.5) completeStage(manager);
    } else {
      manager.loseCopsTimer = 0;
    }
    state.objective = `Lose the cops — wanted level must hit zero (heat ${Math.round(state.wantedHeat)})`;
  } else if (stage.type === 'collect') {
    let remaining = 0;
    let nearest = null;
    let nearestD = Infinity;
    for (const drop of manager.drops) {
      if (drop.taken) continue;
      remaining += 1;
      const d = distance2D(p.x, p.z, drop.x, drop.z);
      if (d < nearestD) {
        nearestD = d;
        nearest = drop;
      }
      if (d < 2.5) {
        drop.taken = true;
        drop.mesh.visible = false;
        addCash(100);
        playCash();
        setToast(`Package collected (${manager.drops.filter((x) => x.taken).length}/${manager.drops.length}) +$100`, 2);
      }
    }
    state.missionTarget = nearest ? { x: nearest.x, z: nearest.z } : null;
    state.objective = `Collect the stashed packages (${manager.drops.filter((x) => x.taken).length}/${manager.drops.length})`;
    if (remaining === 0) completeStage(manager);
  }

  // Timed stages (none are timed in the shipped set, but the hook is here).
  if (manager.stageTimer > 0) {
    manager.stageTimer -= dt;
    state.missionTimer = Math.max(0, manager.stageTimer);
    if (manager.stageTimer <= 0) {
      setToast('Too slow — the stage reset.', 3);
      enterStage(manager);
    }
  }
}

export function resetMissions(manager) {
  state.missionIndex = 0;
  state.missionsCompleted = 0;
  state.freeRoam = false;
  manager.mission = null;
  clearDrops(manager);
  manager.marker.visible = false;
  startMission(manager, 0);
}
