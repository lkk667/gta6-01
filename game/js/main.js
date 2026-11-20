// Solmar City — bootstrap, game loop, menus, staging.
// Wires every system together, runs the frame loop, and stages the four
// screenshot scenes the entry is judged on. The staging helpers put the
// player, the cars and the cops in exact poses; the harness drives them
// through ?autostart=1&staging=...

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, toast, clearToasts } from './state.js';
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
  const skyLight = new THREE.HemisphereLight(0xffb08a, 0x5a4038, 0.75);
  S.scene.add(skyLight);
  const sun = new THREE.DirectionalLight(0xffb060, 2.1);
  sun.position.set(-180, 62, 55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowCam = sun.shadow.camera;
  shadowCam.left = -210; shadowCam.right = 210; shadowCam.top = 210; shadowCam.bottom = -210;
  shadowCam.near = 10; shadowCam.far = 520;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  S.scene.add(sun);
  S.scene.add(sun.target);
  S.sun = sun;
  // Sunset environment map: a tiny gradient sky baked through PMREM, so
  // clearcoat paint, glass and chrome pick up the orange-gold horizon
  // and the violet zenith instead of reflecting nothing. Built once at
  // boot — zero cost per frame. Kept dim so it lifts materials without
  // washing out the dusk lighting.
  const pmrem = new THREE.PMREMGenerator(S.renderer);
  const envWorld = new THREE.Scene();
  const envCv = document.createElement('canvas');
  envCv.width = 256;
  envCv.height = 128;
  const envCtx = envCv.getContext('2d');
  const skyGrad = envCtx.createLinearGradient(0, 0, 0, 128);
  skyGrad.addColorStop(0.0, '#1f2b54');
  skyGrad.addColorStop(0.42, '#7d4e6d');
  skyGrad.addColorStop(0.62, '#f28c5a');
  skyGrad.addColorStop(0.7, '#ffd494');
  skyGrad.addColorStop(1.0, '#2a262c');
  envCtx.fillStyle = skyGrad;
  envCtx.fillRect(0, 0, 256, 128);
  const envTexture = new THREE.CanvasTexture(envCv);
  envTexture.colorSpace = THREE.SRGBColorSpace;
  envWorld.add(new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.MeshBasicMaterial({ map: envTexture, side: THREE.BackSide })
  ));
  S.scene.environment = pmrem.fromScene(envWorld, 0.04).texture;
  S.scene.environmentIntensity = 0.55;
  pmrem.dispose();
  envTexture.dispose();
}

function buildParkedCars() {
  const bays = [
    [-120, -38, Math.PI / 2, 0xd8b83a], [-80, -42, 0, 0x3a7ad8],
    [40, -38, Math.PI / 2, 0xd84a4a], [80, 42, 0, 0x4ad87a],
    [-40, 82, Math.PI / 2, 0xe8e8e8], [120, 38, 0, 0x222226],
    [-160, 78, Math.PI / 2, 0xd87ab8], [0, 122, 0, 0x7ad8d8],
    [-122, 78, Math.PI / 2, 0xd8b83a], [38, 122, 0, 0x3a7ad8],
  ];
  for (const [px, pz, hd, col] of bays) spawnParkedCar(px, pz, hd, col);
  // A taxi by the plaza and a delivery truck by the harbor, for variety.
  spawnParkedCar(8, -38, Math.PI / 2, 0xe8c832, 'taxi');
  spawnParkedCar(-8, 122, 0, 0xb8bcc2, 'truck');
}

function wireMenu() {
  const menuEl = document.getElementById('menu');
  const startBtn = document.getElementById('btn-new');
  const resumeBtn = document.getElementById('btn-continue');
  const saved = loadSave();
  if (saved) {
    resumeBtn.style.display = 'inline-block';
    resumeBtn.textContent = `Continue — $${saved.cash} · ${saved.missionsCompleted} mission${saved.missionsCompleted === 1 ? '' : 's'} done`;
  }
  startBtn.addEventListener('click', () => startGame(false));
  resumeBtn.addEventListener('click', () => startGame(true));
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

export function startGame(resume) {
  document.getElementById('menu').style.display = 'none';
  if (resume) {
    const saved = loadSave();
    if (saved) applySave(saved);
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

// Edge-triggered keys: E enter/exit car, F punch, R reload, 1/2 weapons.
function handleInteract(dt) {
  const eDown = !!S.keys.KeyE;
  if (eDown && !ePrev) {
    if (S.onFoot) {
      const car = nearestCar(S.player.pos.x, S.player.pos.z, 3.5);
      if (car) enterCar(car);
    } else {
      exitCar();
    }
  }
  ePrev = eDown;
  const fDown = !!S.keys.KeyF;
  if (fDown && !fPrev) punch();
  fPrev = fDown;
  const rDown = !!S.keys.KeyR;
  if (rDown && !rPrev) reload();
  rPrev = rDown;
  if (S.keys.Digit1) S.player.weapon = 'pistol';
  if (S.keys.Digit2) S.player.weapon = 'fists';
}

function loop() {
  requestAnimationFrame(loop);
  const step = Math.min(0.05, S.clock.getDelta());
  if (S.mode === 'playing') {
    S.time += step;
    handleInteract(step);
    if (S.onFoot) {
      updatePlayer(step);
      updateCamera(step);
    } else {
      updateDriving(step);
    }
    updateTraffic(step);
    updatePeds(step);
    updatePolice(step);
    updateTrafficLights();
    updateMissions(step);
    updateCombat(step);
    updateBeacon(step);
    for (const c of S.clouds || []) {
      c.position.x += step * 1.2;
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
  const stolen = spawnParkedCar(0, 40, 0, 0xd8b83a);
  const player = S.player;
  player.pos.x = 0;
  player.pos.z = 40;
  enterCar(stolen);
  stolen.speed = 34; // top speed already: 122 km/h at the shutter, even if
  // the held W key takes a frame to register in headless Chrome
  S.debug.freezeTraffic = true; // nothing wanders into the chase route mid-shot
  // Clear the chase route (road x=0, z 40..180) of traffic and parked cars
  // so the staged car is not stuck behind a 10 u/s traffic car mid-shot.
  let moved = 0;
  for (const t of S.trafficCars) {
    if (Math.abs(t.mesh.position.x) < 14 && t.mesh.position.z > 20 && t.mesh.position.z < 180) {
      t.mesh.position.x = 120;
      t.mesh.position.z = -140 + moved * 40;
      t.heading = 0;
      moved++;
    }
  }
  for (const other of S.cars) {
    if (other === stolen) continue;
    if (Math.abs(other.mesh.position.x) < 14 && other.mesh.position.z > 20 && other.mesh.position.z < 180) {
      other.mesh.position.x = 120;
      other.mesh.position.z = -100 + moved * 30;
      moved++;
    }
  }
  S.heat = 65; // 4 stars
  S.objectiveText = 'Bring the car to the Hideout garage';
  // Three cruisers pacing the car in formation: two ahead-flanking and one
  // level on the left, all clearly ahead of the chase camera so none of
  // them stacks on top of the player's car in the frame.
  S.debug.pacing = true;
  const escort = [
    [-7.5, 50, 34, { side: -7.5, fwd: 10 }],
    [7.5, 50, 34, { side: 7.5, fwd: 10 }],
    [-7.5, 38, 34, { side: -7.5, fwd: 0 }],
  ];
  for (const [cx, cz, speed, slot] of escort) {
    const cruiser = spawnCruiser(cx, cz);
    cruiser.mesh.position.set(cx, 0, cz);
    cruiser.heading = 0;
    cruiser.speed = speed;
    cruiser.pace = slot;
  }
  S.camYaw = 0;
}

export function stageCity() {
  autostartGame();
  S.debug.staged = 'city';
  const player = S.player;
  player.pos.x = 0;
  player.pos.z = 0;
  player.group.position.set(0, 0, 0);
  player.heading = Math.PI; // facing north (-z), away from the camera, at the cruiser
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
  const cop = spawnCruiser(0, -16);
  cop.mesh.position.set(0, 0, -16);
  cop.heading = 0;
  cop.speed = 0;
  makeOfficer(2.6, -13.5, Math.PI * 0.85);
  // Keep the frame clear of stray traffic right by the player.
  for (const t of S.trafficCars) {
    if (Math.abs(t.mesh.position.x) >= 12 || Math.abs(t.mesh.position.z) >= 12) continue;
    t.mesh.position.set(120, 0, -120);
  }
  // Street life in frame: two pedestrians crossing ahead, one fleeing the shot.
  stagePeds([[3.5, -8, 0.4], [-4, -6, -0.5], [-1.5, -22, 2.8]]);
  // One shot, flash held open for the camera.
  fireAndHold();
}

// Move the first few pedestrians to fixed spots (x, z, heading) so a staged
// shot has street life in frame instead of an empty street.
function stagePeds(placements) {
  for (let i = 0; i < placements.length; i++) {
    const walker = S.peds[i];
    if (!walker) continue;
    const [px, pz, hd] = placements[i];
    walker.mesh.position.set(px, 0, pz);
    walker.heading = hd;
    walker.fleeTimer = 0;
    walker.retarget = 5;
  }
}

export function stageMission() {
  autostartGame();
  S.debug.staged = 'mission';
  S.debug.longRewardToast = true;
  S.debug.holdReward = true; // keep the reward banner alone for the shot
  const player = S.player;
  // Face Solmar Tower down a clear sightline: stand on road z=-80 looking
  // east. The tower's south face is 20 m north of that road, and no nearer
  // tower stands in the same column (looking north from road x=80, the
  // (100,-60) tower sits directly in front of it and hides it).
  player.pos.x = -40;
  player.pos.z = -80;
  player.group.position.set(-40, 0, -80);
  player.heading = Math.PI / 2; // facing east, down road z=-80 toward the tower
  S.camYaw = -Math.PI / 2;
  S.camPitch = -0.15; // camera low, looking up: the 130 m tower fills the frame
  S.camDist = 8.5;
  stagePeds([[-20, -82, 1.2], [-10, -78, -1.0]]);
  debugCompleteMission1();
  // debugCompleteMission1 teleports the player to the park; put them back
  // on the road with the tower in view.
  player.pos.x = -40;
  player.pos.z = -80;
  player.group.position.set(-40, 0, -80);
  player.heading = Math.PI / 2;
  // The completion banner stands alone; the objective line reports the
  // payout instead of the stale "pick up" instruction at 0 m.
  S.objectiveText = 'Mission 1 complete — $300 earned';
  S.objectiveDist = null;
}

export function stageFoot() {
  autostartGame();
  S.debug.staged = 'foot';
  // The mission-start toast sits over the CAFE LUNA sign in headless runs
  // (game time lags real time there, so the 6 s toast is still up at the
  // 8 s shutter). Clear it for the shot; the objective line stays.
  clearToasts();
  const player = S.player;
  // On road z=-40, facing Cafe Luna. Framing math: the rooftop sign tops
  // out at y≈17, so the camera must sit low and look UP — camPitch is
  // negative here (pitch raises the camera and looks down, which hides the
  // sign; the first attempt used +0.24 and lost the sign completely).
  // camDist 14 + pitch -0.1 puts the sign top just inside the frame.
  player.pos.x = -60;
  player.pos.z = -40;
  player.group.position.set(-60, 0, -40);
  player.heading = Math.PI; // facing north, walking toward Cafe Luna
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
  const cv = document.getElementById('game');
  S.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
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
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
    const scene = params.get('staging');
    if (scene === 'chase') stageChase();
    else if (scene === 'city') stageCity();
    else if (scene === 'mission') stageMission();
    else if (scene === 'foot') stageFoot();
    else autostartGame();
  }
  loop();
}

init();
