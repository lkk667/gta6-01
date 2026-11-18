// Solmar City — bootstrap, game loop, menus and staging.
// Wires every system together: builds the renderer and the city, spawns the
// traffic, the pedestrians and the parked cars, runs the frame loop, and owns
// the start / pause / busted / wasted screens and the save. A `?staging=`
// URL parameter (chase, city, mission, foot) starts the game straight into a
// scene for screenshots, and window.__solmar exposes the same staging calls
// for automated play-testing.

import * as THREE from 'three';
import { state, wantedStars, addWanted, setToast, clamp, distance2D } from './state.js';
import { buildCity, PLACES, clampToCity } from './city.js';
import { makePlayerMesh, updatePlayerOnFoot, updateCamera, applyCameraOrbit } from './player.js';
import {
  createCar, randomCarColor, updatePlayerDriving, applyCarTransform,
  nearestCarTo, enterCar, exitCar,
} from './vehicles.js';
import {
  spawnTraffic, spawnPedestrians, updateTraffic, updatePedestrians, nearestPedestrian,
} from './traffic.js';
import { createPoliceManager, updatePolice, clearAllPolice, forceSpawnPolice } from './police.js';
import { createCombat, firePistol, reloadPistol, tryPunch, updateCombat, spawnPickups, updatePickups } from './combat.js';
import {
  createMissionManager, startMission, updateMissions, currentMissionTitle, resetMissions,
} from './missions.js';
import { initHud, updateHud } from './hud.js';
import { initInput, keys, consumeMouseDelta, consumeClick, isDown, isRightDown, lockPointer, unlockPointer } from './input.js';
import {
  initAudio, updateAudio, playClick, playPickup, playBusted, playMissionComplete, toggleMute,
} from './audio.js';
import { saveGame, loadSaveData, applySaveData, hasSave, clearSave } from './save.js';
import { mulberry32 } from './state.js';

// --- Renderer, scene, lights ----------------------------------------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec9e8);
scene.fog = new THREE.Fog(0x9fc8e8, 320, 750);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, 12, 30);

const sun = new THREE.DirectionalLight(0xffe0b3, 2.2);
sun.position.set(140, 200, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -260;
sun.shadow.camera.right = 260;
sun.shadow.camera.top = 260;
sun.shadow.camera.bottom = -260;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.9));

// --- World -----------------------------------------------------------------
const city = buildCity(scene);
const colliders = city.colliders;

const playerMesh = makePlayerMesh();
scene.add(playerMesh);

const random = mulberry32(99);
const parkedCars = [];
const PARKED_SPOTS = [
  { x: -70, z: -58, h: 0 }, { x: -58, z: -70, h: Math.PI / 2 },
  { x: 70, z: 58, h: Math.PI }, { x: 58, z: 70, h: -Math.PI / 2 },
  { x: -132, z: 58, h: 0 }, { x: 132, z: -58, h: Math.PI },
  { x: -8, z: -58, h: Math.PI / 2 }, { x: 8, z: 128, h: 0 },
  { x: -194, z: -124, h: Math.PI }, { x: 194, z: 124, h: -Math.PI / 2 },
  { x: -70, z: 132, h: 0 }, { x: 70, z: -132, h: Math.PI },
];
for (const spot of PARKED_SPOTS) {
  const car = createCar(scene, spot.x, spot.z, spot.h, randomCarColor(random), 'parked', false);
  parkedCars.push(car);
}

const trafficCars = spawnTraffic(scene, 14);
const pedestrians = spawnPedestrians(scene, 26);
const allCars = [...parkedCars, ...trafficCars];

const policeManager = createPoliceManager(scene, colliders);
const combat = createCombat(scene, camera);
const missionManager = createMissionManager(scene);

const PICKUP_SPOTS = [
  { kind: 'health', x: -155, z: 85 }, { kind: 'health', x: 93, z: 31 },
  { kind: 'health', x: 31, z: -93 }, { kind: 'ammo', x: -93, z: 31 },
  { kind: 'ammo', x: 155, z: 93 }, { kind: 'ammo', x: -31, z: 155 },
  { kind: 'cash', x: -62, z: -124 }, { kind: 'cash', x: 124, z: 62 },
  { kind: 'cash', x: 62, z: -186 }, { kind: 'cash', x: -186, z: -62 },
];
const pickups = spawnPickups(scene, PICKUP_SPOTS);

// --- Menus ------------------------------------------------------------------
const screens = {
  start: document.getElementById('screen-start'),
  pause: document.getElementById('screen-pause'),
  busted: document.getElementById('screen-busted'),
  wasted: document.getElementById('screen-wasted'),
  done: document.getElementById('screen-done'),
};
const hud = document.getElementById('hud');

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    if (screens[key]) screens[key].classList.toggle('visible', key === name);
  }
  if (hud) hud.style.display = name === null ? 'block' : 'none';
}

function startNewGame() {
  initAudio();
  playClick();
  clearSave();
  state.cash = 0;
  state.health = 100;
  state.ammo = 48;
  state.magazine = 12;
  state.missionsCompleted = 0;
  state.missionIndex = 0;
  state.freeRoam = false;
  state.carsStolen = 0;
  state.wantedHeat = 0;
  state.player.x = PLACES.plaza.x;
  state.player.z = PLACES.plaza.z;
  state.player.heading = Math.PI;
  state.player.onFoot = true;
  state.player.inCar = null;
  state.camera.yaw = Math.PI;
  state.camera.pitch = 0.32;
  clearAllPolice(policeManager);
  state.mode = 'playing';
  showScreen(null);
  lockPointer();
  startMission(missionManager, 0);
  saveGame();
}

function continueGame() {
  initAudio();
  playClick();
  const data = loadSaveData();
  if (data) applySaveData(data);
  clearAllPolice(policeManager);
  state.mode = 'playing';
  showScreen(null);
  lockPointer();
  startMission(missionManager, state.missionIndex);
  setToast('Welcome back to Solmar City.', 3);
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  showScreen('pause');
  unlockPointer();
  saveGame();
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  initAudio();
  playClick();
  state.mode = 'playing';
  showScreen(null);
  lockPointer();
}

function respawnAfterBusted() {
  playClick();
  state.health = 100;
  state.player.x = PLACES.hospital.x;
  state.player.z = PLACES.hospital.z + 14;
  state.player.heading = 0;
  state.player.onFoot = true;
  state.player.inCar = null;
  state.player.bustedTimer = 0;
  state.mode = 'playing';
  showScreen(null);
  lockPointer();
  saveGame();
}

function respawnAfterWasted() {
  playClick();
  const lost = Math.min(state.cash, 100);
  state.cash -= lost;
  state.health = 100;
  state.wantedHeat = 0;
  clearAllPolice(policeManager);
  state.player.x = PLACES.hospital.x;
  state.player.z = PLACES.hospital.z + 14;
  state.player.heading = 0;
  state.player.onFoot = true;
  state.player.inCar = null;
  state.mode = 'playing';
  showScreen(null);
  lockPointer();
  setToast(`You woke up at St. Palma Hospital. -$${lost} in bills.`, 4);
  saveGame();
}

policeManager.onBusted = (fine) => {
  state.mode = 'busted';
  document.getElementById('busted-fine').textContent = `The Solmar PD impounded your ride and fined you $${fine}.`;
  showScreen('busted');
  unlockPointer();
  saveGame();
};

missionManager.onStoryComplete = () => {
  state.mode = 'done';
  showScreen('done');
  unlockPointer();
  saveGame();
};

document.getElementById('btn-start').addEventListener('click', startNewGame);
const continueBtn = document.getElementById('btn-continue');
if (hasSave()) {
  continueBtn.style.display = 'inline-block';
  continueBtn.addEventListener('click', continueGame);
}
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-restart').addEventListener('click', () => {
  state.mode = 'menu';
  showScreen('start');
  startNewGame();
});
document.getElementById('btn-quit-to-menu').addEventListener('click', () => {
  saveGame();
  state.mode = 'menu';
  showScreen('start');
  unlockPointer();
});
document.getElementById('btn-busted-ok').addEventListener('click', respawnAfterBusted);
document.getElementById('btn-wasted-ok').addEventListener('click', respawnAfterWasted);
document.getElementById('btn-done-roam').addEventListener('click', () => {
  playClick();
  state.mode = 'playing';
  showScreen(null);
  lockPointer();
});
document.getElementById('btn-done-replay').addEventListener('click', () => {
  playClick();
  resetMissions(missionManager);
  state.mode = 'playing';
  showScreen(null);
  lockPointer();
});
document.getElementById('btn-mute').addEventListener('click', (event) => {
  const muted = toggleMute();
  event.target.textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
});

// --- Input wiring ------------------------------------------------------------
let interactPressed = false;
let punchPressed = false;
let lastMouseMove = -10;

initInput(canvas,
  () => {
    if (state.mode === 'playing') pauseGame();
    else if (state.mode === 'paused') resumeGame();
  },
  () => { interactPressed = true; },
);

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyF' && !event.repeat) punchPressed = true;
  if (event.code === 'KeyR' && !event.repeat && state.mode === 'playing') {
    reloadPistol();
    setToast('Reloaded.', 1.2);
  }
  if (event.code === 'KeyM' && !event.repeat) {
    const btn = document.getElementById('btn-mute');
    if (btn) btn.click();
  }
});

// --- Interaction: enter / exit cars ------------------------------------------
function handleInteract() {
  if (state.mode !== 'playing') return;
  if (state.player.inCar) {
    exitCar(allCars);
    return;
  }
  const car = nearestCarTo(allCars, state.player.x, state.player.z, 4.2);
  if (car) enterCar(car);
  else setToast('No car close enough — walk up to one and press E.', 2);
}

// --- Per-frame input snapshot -------------------------------------------------
function readInput() {
  return {
    forward: isDown('KeyW') || isDown('ArrowUp'),
    back: isDown('KeyS') || isDown('ArrowDown'),
    left: isDown('KeyA') || isDown('ArrowLeft'),
    right: isDown('KeyD') || isDown('ArrowRight'),
    run: isDown('ShiftLeft') || isDown('ShiftRight'),
    handbrake: isDown('Space'),
    aim: isRightDown(),
  };
}

// --- Staging (screenshots + play-testing) --------------------------------------
function applyStaging(name) {
  if (name === 'chase') {
    // Player in a stolen car, 5 wanted stars, two cruisers already closing
    // in from behind, mission 2 live. The car sits mid-block on street x=0
    // heading north, so no streetlight pole blocks the chase camera.
    const car = parkedCars[0];
    car.x = 0;
    car.z = 31;
    car.heading = Math.PI;
    car.mesh.position.set(0, 0, 31);
    car.mesh.rotation.y = Math.PI;
    enterCar(car);
    addWanted(55);
    state.missionIndex = 1;
    startMission(missionManager, 1);
    state.camera.yaw = state.player.heading + Math.PI;
    // Two cruisers ahead of the player, bearing down head-on and already
    // in the chase camera's frame.
    const cruisers = forceSpawnPolice(policeManager, 2);
    if (cruisers[0]) {
      cruisers[0].x = 2;
      cruisers[0].z = 6;
      cruisers[0].heading = 0;
    }
    if (cruisers[1]) {
      cruisers[1].x = -4;
      cruisers[1].z = -8;
      cruisers[1].heading = 0;
    }
  } else if (name === 'city') {
    state.player.x = PLACES.plaza.x;
    state.player.z = PLACES.plaza.z;
    state.player.heading = Math.PI * 0.75;
    state.camera.yaw = Math.PI * 0.75;
    startMission(missionManager, 0);
  } else if (name === 'mission') {
    // South of the plaza on street z=62, looking north: the gold delivery
    // beacon stands in the frame ahead of the player.
    state.player.x = -31;
    state.player.z = 62;
    state.player.heading = Math.PI;
    state.camera.yaw = 0;
    startMission(missionManager, 0);
    // Jump straight to the delivery leg so the gold beacon shows.
    missionManager.stageIndex = 1;
    state.objective = 'Deliver the parcel to Marina Plaza';
    state.missionTarget = { x: PLACES.plaza.x, z: PLACES.plaza.z };
    missionManager.marker.visible = true;
    missionManager.marker.position.set(PLACES.plaza.x, 0, PLACES.plaza.z);
  } else if (name === 'foot') {
    state.player.x = 62;
    state.player.z = 200;
    state.player.heading = Math.PI;
    state.camera.yaw = Math.PI;
    startMission(missionManager, 0);
  }
}

window.__solmar = {
  state,
  version: 'solmar-city-1.0',
  start: startNewGame,
  status() {
    return {
      mode: state.mode,
      stars: wantedStars(),
      heat: Math.round(state.wantedHeat),
      cash: state.cash,
      health: Math.round(state.health),
      ammo: state.ammo,
      magazine: state.magazine,
      mission: currentMissionTitle(),
      objective: state.objective,
      missionsCompleted: state.missionsCompleted,
      player: { x: Math.round(state.player.x), z: Math.round(state.player.z), onFoot: state.player.onFoot },
      police: policeManager.cars.length,
      traffic: trafficCars.filter((c) => c.kind === 'traffic').length,
      pedestrians: pedestrians.filter((p) => p.state !== 'down').length,
    };
  },
  teleport(x, z) {
    state.player.x = x;
    state.player.z = z;
    if (state.player.inCar) {
      state.player.inCar.x = x;
      state.player.inCar.z = z;
    }
  },
  setWanted(heat) {
    state.wantedHeat = clamp(heat, 0, 100);
    policeManager.spawnTimer = 0;
  },
  startMission(index) {
    startMission(missionManager, index);
  },
  enterNearestCar() {
    const car = nearestCarTo(allCars, state.player.x, state.player.z, 6);
    if (car) enterCar(car);
    return !!state.player.inCar;
  },
  exitCar() {
    exitCar(allCars);
  },
  save() {
    return saveGame();
  },
};

// --- Main loop ------------------------------------------------------------------
const clock = new THREE.Clock();
let saveTimer = 0;
let fireCooldown = 0;
let lastFrameTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;

  // Clouds always drift, even on the menu behind the start screen.
  for (const cloud of city.clouds) {
    cloud.position.x += dt * 1.6;
    if (cloud.position.x > 340) cloud.position.x = -340;
  }

  if (state.mode === 'playing') {
    const input = readInput();
    const mouseDelta = consumeMouseDelta();
    if (mouseDelta.dx !== 0 || mouseDelta.dy !== 0) {
      applyCameraOrbit(mouseDelta.dx, mouseDelta.dy);
      lastMouseMove = state.time;
    }

    if (interactPressed) {
      interactPressed = false;
      handleInteract();
    }
    if (punchPressed) {
      punchPressed = false;
      tryPunch(pedestrians);
    }

    const p = state.player;
    let speed01 = 0;
    if (p.inCar && p.inCar) {
      const car = p.inCar;
      speed01 = updatePlayerDriving(car, dt, input, colliders);
      p.x = car.x;
      p.z = car.z;
      p.heading = car.heading;
      playerMesh.visible = false;
      // Camera follows the car's heading unless the player just orbited.
      if (state.time - lastMouseMove > 1.5) {
        const desiredYaw = car.heading + Math.PI;
        let d = (desiredYaw - state.camera.yaw) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        state.camera.yaw += d * Math.min(1, dt * 1.6);
      }
      state.camera.distance = 12;
    } else {
      updatePlayerOnFoot(playerMesh, dt, input, colliders);
      playerMesh.visible = true;
      state.camera.distance = 9;
      // Shooting: a left click fires the pistol (0.28 s between shots).
      fireCooldown -= dt;
      const clicked = consumeClick();
      if (clicked && fireCooldown <= 0) {
        fireCooldown = 0.28;
        firePistol(combat, pedestrians, trafficCars, policeManager.cars);
      }
    }

    // Traffic and pedestrians keep the city alive.
    updateTraffic(trafficCars, dt, colliders, p.inCar);
    updatePedestrians(pedestrians, dt, { x: p.x, z: p.z }, p.inCar, null);
    updatePolice(policeManager, dt, trafficCars);
    updateMissions(missionManager, dt);
    updateCombat(combat, dt);
    updatePickups(pickups, dt);

    // Cars that hit the player on foot hurt; police cruisers hurt more.
    if (p.onFoot) {
      for (const car of [...trafficCars, ...policeManager.cars]) {
        if (car.kind !== 'traffic' && car.kind !== 'police') continue;
        const d = distance2D(car.x, car.z, p.x, p.z);
        if (d < 1.9 && Math.abs(car.speed) > 2) {
          state.health -= 22 * dt;
          state.camera.shake = Math.max(state.camera.shake, 0.4);
          // Shove the player clear of the bumper.
          const away = Math.atan2(p.x - car.x, p.z - car.z);
          p.x += Math.sin(away) * 3 * dt;
          p.z += Math.cos(away) * 3 * dt;
        }
      }
    }

    // Toast countdown.
    if (state.toastTimer > 0) state.toastTimer -= dt;

    // Camera follows the player (or the car).
    const lookTarget = p.inCar
      ? new THREE.Vector3(p.inCar.x, 1.2, p.inCar.z)
      : new THREE.Vector3(p.x, 1.2, p.z);
    updateCamera(camera, dt, lookTarget);

    // Audio follows the drive and the heat.
    updateAudio(speed01, wantedStars(), dt);

    // Wasted: health hit zero.
    if (state.health <= 0 && state.mode === 'playing') {
      state.health = 0;
      state.mode = 'wasted';
      playBusted();
      showScreen('wasted');
      unlockPointer();
      saveGame();
    }

    // Periodic autosave.
    saveTimer += dt;
    if (saveTimer > 30) {
      saveTimer = 0;
      saveGame();
    }

    // HUD.
    const nearCar = p.onFoot ? nearestCarTo(allCars, p.x, p.z, 4.2) : null;
    updateHud({
      missionTitle: currentMissionTitle(),
      aiming: p.onFoot && (isRightDown() || state.player.shooting > 0),
      hint: p.inCar
        ? 'W/S drive · A/D steer · Space handbrake · E exit car'
        : nearCar
          ? 'E — steal this car'
          : 'WASD move · Shift run · drag mouse to look · click shoot · F punch · R reload',
      trafficCars,
      pedestrians,
      policeCars: policeManager.cars,
    });
  } else {
    // Menu / pause: slow cinematic orbit around the plaza.
    const t = state.time * 0.05;
    camera.position.set(Math.sin(t) * 60, 26, 24 + Math.cos(t) * 60);
    camera.lookAt(0, 4, 24);
    updateAudio(0, 0, dt);
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Boot ----------------------------------------------------------------------
initHud();
showScreen('start');
const params = new URLSearchParams(window.location.search);
const staging = params.get('staging');
if (params.get('autostart') === '1') {
  // Headless / screenshot boot: skip the menu entirely.
  state.mode = 'playing';
  showScreen(null);
  const muteBtn = document.getElementById('btn-mute');
  if (muteBtn) muteBtn.style.display = 'none';
  try { initAudio(); } catch (error) { /* audio is optional headless */ }
  if (staging) applyStaging(staging);
  else startMission(missionManager, 0);
}
animate();
