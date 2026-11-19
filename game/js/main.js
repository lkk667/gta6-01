// Solmar City — bootstrap, game loop, menus, staging (v3 rewrite).

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, toast } from './state.js';
import { buildCity, updateBlobShadows } from './city.js';
import { buildPlayer, updatePlayer, updateCamera } from './player.js';
import { spawnParkedCar, nearestCar, enterCar, exitCar, updateDriving } from './vehicles.js';
import { buildTraffic, updateTraffic, updatePeds } from './traffic.js';
import { updatePolice, spawnCruiser, makeOfficer, triggerBusted } from './police.js';
import { startMission, updateMissions, updateBeacon, debugCompleteMission1 } from './missions.js';
import { buildCombat, shoot, punch, reload, updateCombat } from './combat.js';
import { buildHud, updateHud } from './hud.js';
import { buildAudio } from './audio.js';
import { saveGame, loadSave, applySave } from './save.js';
import { buildInput } from './input.js';

let lastSave = 0;
let ePrev = false;
let fPrev = false;
let rPrev = false;

function buildLights() {
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8a7a5a, 0.95);
  S.scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  sun.position.set(120, 180, 60);
  S.scene.add(sun);
  // No shadow maps: contact is shown with blob shadows (city.js), which
  // render identically on every machine including headless SwiftShader.
}

function buildParkedCars() {
  const spots = [
    [-120, -38, Math.PI / 2, 0xd8b83a], [-80, -42, 0, 0x3a7ad8],
    [40, -38, Math.PI / 2, 0xd84a4a], [80, 42, 0, 0x4ad87a],
    [-40, 82, Math.PI / 2, 0xe8e8e8], [120, 38, 0, 0x222226],
    [-160, 78, Math.PI / 2, 0xd87ab8], [0, 122, 0, 0x7ad8d8],
    [-122, 78, Math.PI / 2, 0xd8b83a], [38, 122, 0, 0x3a7ad8],
  ];
  for (const [x, z, h, c] of spots) spawnParkedCar(x, z, h, c);
}

function wireMenu() {
  const menu = document.getElementById('menu');
  const newBtn = document.getElementById('btn-new');
  const contBtn = document.getElementById('btn-continue');
  const save = loadSave();
  if (save) {
    contBtn.style.display = 'inline-block';
    contBtn.textContent = `Continue — $${save.cash} · ${save.missionsCompleted} mission${save.missionsCompleted === 1 ? '' : 's'} done`;
  }
  newBtn.addEventListener('click', () => startGame(false));
  contBtn.addEventListener('click', () => startGame(true));
  document.getElementById('btn-busted').addEventListener('click', () => {
    document.getElementById('busted').style.display = 'none';
    S.mode = 'playing';
    startMission(S.missionIndex);
  });
  document.getElementById('btn-replay').addEventListener('click', () => {
    document.getElementById('menu').style.display = 'none';
    S.freeRoam = false;
    S.missionsCompleted = 0;
    startMission(0);
    S.mode = 'playing';
  });
}

export function startGame(continueSave) {
  document.getElementById('menu').style.display = 'none';
  if (continueSave) {
    const save = loadSave();
    if (save) applySave(save);
  } else {
    S.cash = 0;
    S.heat = 0;
    S.missionsCompleted = 0;
    S.missionIndex = 0;
    S.freeRoam = false;
  }
  S.mode = 'playing';
  S.health = 100;
  if (S.audio) S.audio.unlock();
  startMission(S.missionIndex);
}

function handleInteract(dt) {
  const e = !!S.keys.KeyE;
  if (e && !ePrev) {
    if (S.onFoot) {
      const car = nearestCar(S.player.pos.x, S.player.pos.z, 3.5);
      if (car) enterCar(car);
    } else {
      exitCar();
    }
  }
  ePrev = e;
  const f = !!S.keys.KeyF;
  if (f && !fPrev) punch();
  fPrev = f;
  const r = !!S.keys.KeyR;
  if (r && !rPrev) reload();
  rPrev = r;
  if (S.keys.Digit1) S.player.weapon = 'pistol';
  if (S.keys.Digit2) S.player.weapon = 'fists';
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, S.clock.getDelta());
  if (S.mode === 'playing') {
    S.time += dt;
    handleInteract(dt);
    if (S.onFoot) {
      updatePlayer(dt);
      updateCamera(dt);
    } else {
      updateDriving(dt);
    }
    updateTraffic(dt);
    updatePeds(dt);
    updatePolice(dt);
    updateMissions(dt);
    updateCombat(dt);
    updateBeacon(dt);
    for (const c of S.clouds || []) {
      c.position.x += dt * 1.2;
      if (c.position.x > 220) c.position.x = -220;
    }
    updateBlobShadows();
    updateHud();
    if (S.time - lastSave > 10) {
      lastSave = S.time;
      saveGame();
    }
  } else if (S.mode === 'busted') {
    updateHud();
  }
}

// ---------------------------------------------------------------- staging

function autostartGame() {
  startGame(false);
}

export function stageChase() {
  autostartGame();
  S.debug.staged = 'chase';
  // Stolen bright yellow car, mid-road, already moving.
  const car = spawnParkedCar(0, 40, 0, 0xd8b83a);
  const p = S.player;
  p.pos.x = 0;
  p.pos.z = 40;
  enterCar(car);
  car.speed = 26; // ~94 km/h, cruisers can still pace it
  // Clear the chase route (road x=0, z 40..180) of traffic and parked cars
  // so the staged car is not stuck behind a 10 u/s traffic car mid-shot.
  let cleared = 0;
  for (const t of S.trafficCars) {
    if (Math.abs(t.mesh.position.x) < 14 && t.mesh.position.z > 20 && t.mesh.position.z < 180) {
      t.mesh.position.x = 120;
      t.mesh.position.z = -140 + cleared * 40;
      t.heading = 0;
      cleared++;
    }
  }
  for (const other of S.cars) {
    if (other === car) continue;
    if (Math.abs(other.mesh.position.x) < 14 && other.mesh.position.z > 20 && other.mesh.position.z < 180) {
      other.mesh.position.x = 120;
      other.mesh.position.z = -100 + cleared * 30;
      cleared++;
    }
  }
  S.heat = 65; // 4 stars
  S.objectiveText = 'Bring the car to the Hideout garage';
  // Three cruisers pacing the car in formation: ahead on both sides and one
  // flanking level with the car. Every slot stays ahead of the chase camera
  // (9.5 m behind the car), so all three read in the frame at once.
  S.debug.pacing = true;
  const spots = [
    [-6.5, 48, 26, { side: -6.5, fwd: 8 }],
    [6.5, 48, 26, { side: 6.5, fwd: 8 }],
    [7, 39, 26, { side: 7, fwd: -1 }],
  ];
  for (const [x, z, sp, pace] of spots) {
    const c = spawnCruiser(x, z);
    c.mesh.position.set(x, 0, z);
    c.heading = 0;
    c.speed = sp;
    c.pace = pace;
  }
  S.camYaw = 0;
}

export function stageCity() {
  autostartGame();
  S.debug.staged = 'city';
  const p = S.player;
  p.pos.x = 0;
  p.pos.z = 0;
  p.group.position.set(0, 0, 0);
  p.heading = Math.PI; // facing north (-z), away from the camera, at the cruiser
  S.camYaw = 0; // camera south of the player, looking north: cruiser ahead in view
  S.camPitch = 0.3;
  S.heat = 42; // 3 stars
  S.objectiveText = 'Lose the cops — get your wanted level to zero';
  // A cruiser ahead with an officer standing beside it.
  const cruiser = spawnCruiser(0, -16);
  cruiser.mesh.position.set(0, 0, -16);
  cruiser.heading = 0;
  cruiser.speed = 0;
  makeOfficer(2.6, -13.5, Math.PI * 0.85);
  // One shot, flash held open for the camera.
  fireAndHold();
}

export function stageMission() {
  autostartGame();
  S.debug.staged = 'mission';
  S.debug.longRewardToast = true;
  S.debug.holdReward = true; // keep the reward banner alone for the shot
  const p = S.player;
  p.pos.x = LANDMARKS.marinaPark.x;
  p.pos.z = LANDMARKS.marinaPark.z + 12;
  p.group.position.set(p.pos.x, 0, p.pos.z);
  p.heading = Math.PI;
  S.camYaw = 0;
  S.camPitch = 0.3;
  debugCompleteMission1();
  // The completion banner stands alone; the objective line reports the
  // payout instead of the stale "pick up" instruction at 0 m.
  S.objectiveText = 'Mission 1 complete — $300 earned';
  S.objectiveDist = null;
}

export function stageFoot() {
  autostartGame();
  S.debug.staged = 'foot';
  const p = S.player;
  // On road z=-40, facing Cafe Luna's storefront 11 m north. (Standing
  // closer, at z=-14, puts the player inside the block tower's collider
  // at (-60,-20) and the collision push shoves them back down the road.)
  p.pos.x = -60;
  p.pos.z = -40;
  p.group.position.set(-60, 0, -40);
  p.heading = Math.PI; // facing north, walking toward Cafe Luna
  S.camYaw = 0; // camera south of the player, looking north at the sign
  S.camPitch = -0.05; // near-level, tilted slightly up so the rooftop sign stays in frame
  S.camDist = 13; // pulled back so the sign + storefront both fit
  S.objectiveText = 'Pick up the package at the Hideout';
}

export function fireAndHold() {
  shoot();
  S.debug.holdFlash = true;
  if (S.player) {
    S.player.flashMat.opacity = 0.95;
    S.player.flashLight.intensity = 26;
  }
}

export function stageReward() {
  S.debug.longRewardToast = true;
  S.debug.holdReward = true;
  debugCompleteMission1();
}

function init() {
  const canvas = document.getElementById('game');
  S.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  S.renderer.setSize(window.innerWidth, window.innerHeight);
  S.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  S.scene = new THREE.Scene();
  S.scene.background = new THREE.Color(0x87bfe8);
  S.scene.fog = new THREE.Fog(0x87bfe8, 220, 520);
  S.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
  S.camera.position.set(0, 6, 12);
  S.clock = new THREE.Clock();
  buildLights();
  buildCity();
  buildPlayer();
  buildTraffic();
  buildCombat();
  buildAudio();
  buildHud();
  buildInput();
  buildParkedCars();
  wireMenu();
  window.addEventListener('resize', () => {
    S.camera.aspect = window.innerWidth / window.innerHeight;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(window.innerWidth, window.innerHeight);
  });
  document.getElementById('game').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (S.mode === 'playing' && S.onFoot && S.player.weapon === 'pistol') shoot();
  });

  // Debug / test hooks (also how the screenshots are staged).
  window.__solmar = {
    S, WORLD, LANDMARKS,
    startGame, stageChase, stageCity, stageMission, stageFoot,
    fireAndHold, stageReward, shoot, punch, reload,
    enterCar, exitCar, nearestCar, spawnCruiser, triggerBusted,
    startMission, debugCompleteMission1, saveGame, loadSave,
  };

  // Staging entry: ?autostart=1&staging=chase|city|mission|foot
  const q = new URLSearchParams(window.location.search);
  if (q.get('autostart') === '1') {
    const which = q.get('staging');
    if (which === 'chase') stageChase();
    else if (which === 'city') stageCity();
    else if (which === 'mission') stageMission();
    else if (which === 'foot') stageFoot();
    else autostartGame();
  }
  loop();
}

init();
