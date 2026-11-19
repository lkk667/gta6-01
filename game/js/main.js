// Solmar City — bootstrap, game loop, menus, staging (v4 polish).

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, toast } from './state.js';
import { buildCity, updateBlobShadows, updateTrafficLights } from './city.js';
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
  // Dusk golden hour: warm low sun from the west, pink-orange sky light,
  // long real shadows. Blob shadows (city.js) stay as contact anchors.
  const hemi = new THREE.HemisphereLight(0xffb08a, 0x5a4038, 0.75);
  S.scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb060, 2.1);
  sun.position.set(-180, 62, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -210;
  sun.shadow.camera.right = 210;
  sun.shadow.camera.top = 210;
  sun.shadow.camera.bottom = -210;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 520;
  sun.shadow.bias = -0.0006;
  S.scene.add(sun);
  S.scene.add(sun.target);
  S.sun = sun;
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
  // A taxi by the plaza and a delivery truck by the harbor, for variety.
  spawnParkedCar(8, -38, Math.PI / 2, 0xe8c832, 'taxi');
  spawnParkedCar(-8, 122, 0, 0xb8bcc2, 'truck');
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
    updateTrafficLights();
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
  // Three cruisers pacing the car in formation: two ahead-flanking and one
  // level on the left, all clearly ahead of the chase camera so none of
  // them stacks on top of the player's car in the frame.
  S.debug.pacing = true;
  const spots = [
    [-7.5, 50, 26, { side: -7.5, fwd: 10 }],
    [7.5, 50, 26, { side: 7.5, fwd: 10 }],
    [-7.5, 38, 26, { side: -7.5, fwd: 0 }],
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
  S.camDist = 8.5; // closer to the ground: the shootout fills the frame
  S.heat = 55; // 3 stars, holds through the heat decay of the wait
  S.debug.noSpawn = true; // no extra cruisers spawning onto the camera
  S.debug.freezePolice = true; // the staged cruiser holds its pose instead
  // of driving onto the player and tripping the BUSTED timer mid-shot
  S.debug.freezeTraffic = true; // traffic holds still so no car drives
  // through the frame and parks on the camera during the 6 s wait
  S.objectiveText = 'Lose the cops — get your wanted level to zero';
  // A cruiser ahead with an officer standing beside it.
  const cruiser = spawnCruiser(0, -16);
  cruiser.mesh.position.set(0, 0, -16);
  cruiser.heading = 0;
  cruiser.speed = 0;
  makeOfficer(2.6, -13.5, Math.PI * 0.85);
  // Keep the frame clear of stray traffic right by the player.
  for (const t of S.trafficCars) {
    if (Math.abs(t.mesh.position.x) < 12 && Math.abs(t.mesh.position.z) < 12) {
      t.mesh.position.x = 120;
      t.mesh.position.z = -120;
    }
  }
  // Street life in frame: two pedestrians crossing ahead, one fleeing the shot.
  stagePeds([[3.5, -8, 0.4], [-4, -6, -0.5], [-1.5, -22, 2.8]]);
  // One shot, flash held open for the camera.
  fireAndHold();
}

// Move the first few pedestrians to fixed spots (x, z, heading) so a staged
// shot has street life in frame instead of an empty street.
function stagePeds(spots) {
  spots.forEach(([x, z, h], i) => {
    const ped = S.peds[i];
    if (!ped) return;
    ped.mesh.position.set(x, 0, z);
    ped.heading = h;
    ped.fleeTimer = 0;
    ped.retarget = 5;
  });
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
  // Face Solmar Tower down a clear sightline: stand on road z=-80 looking
  // east. The tower's south face is 20 m north of that road, and no nearer
  // tower stands in the same column (looking north from road x=80, the
  // (100,-60) tower sits directly in front of it and hides it).
  p.pos.x = -40;
  p.pos.z = -80;
  p.group.position.set(-40, 0, -80);
  p.heading = Math.PI / 2; // facing east, down road z=-80 toward the tower
  S.camYaw = -Math.PI / 2;
  S.camPitch = -0.15; // camera low, looking up: the 130 m tower fills the frame
  S.camDist = 8.5;
  stagePeds([[-20, -82, 1.2], [-10, -78, -1.0]]);
  debugCompleteMission1();
  // debugCompleteMission1 teleports the player to the park; put them back
  // on the road with the tower in view.
  p.pos.x = -40;
  p.pos.z = -80;
  p.group.position.set(-40, 0, -80);
  p.heading = Math.PI / 2;
  // The completion banner stands alone; the objective line reports the
  // payout instead of the stale "pick up" instruction at 0 m.
  S.objectiveText = 'Mission 1 complete — $300 earned';
  S.objectiveDist = null;
}

export function stageFoot() {
  autostartGame();
  S.debug.staged = 'foot';
  const p = S.player;
  // On road z=-40, facing Cafe Luna. Framing math: the rooftop sign tops
  // out at y≈17, so the camera must sit low and look UP — camPitch is
  // negative here (pitch raises the camera and looks down, which hides the
  // sign; v4's first attempt used +0.24 and lost the sign completely).
  // camDist 14 + pitch -0.1 puts the sign top just inside the frame.
  p.pos.x = -60;
  p.pos.z = -40;
  p.group.position.set(-60, 0, -40);
  p.heading = Math.PI; // facing north, walking toward Cafe Luna
  S.camYaw = 0; // camera south of the player, looking north at the sign
  S.camPitch = -0.1;
  S.camDist = 14;
  S.objectiveText = 'Pick up the package at the Hideout';
  // Cafe street life: a couple at the outdoor tables, one on the sidewalk.
  stagePeds([[-54, -47, -2.2], [-66, -47, 2.2], [-57, -43, 0.6], [-64, -52, 0.2]]);
  // A taxi waiting at the kerb in the left foreground, for depth.
  spawnParkedCar(-72, -38, Math.PI / 2, 0xe8c832, 'taxi');
}

export function fireAndHold() {
  shoot();
  S.debug.holdFlash = true;
  if (S.player) {
    S.player.flashMat.opacity = 0.95;
    S.player.flashLight.intensity = 10;
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
  S.renderer.shadowMap.enabled = true;
  S.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  S.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  S.renderer.toneMappingExposure = 1.12;
  S.scene = new THREE.Scene();
  // Dusk sky + haze. The sky dome (city.js) paints the gradient; the fog
  // colour matches the horizon so distant towers melt into the sunset.
  S.scene.background = new THREE.Color(0xe8906a);
  S.scene.fog = new THREE.Fog(0xdd8a66, 150, 480);
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
