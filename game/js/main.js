// Solmar City — bootstrap, game loop, menus and staging.
// The game is built from the modules in js/ and driven from here.

import * as THREE from 'three';
import { S, VERSION, WORLD, LANDMARKS, addHeat, toast, fmtCash } from './state.js';
import { buildCity, clouds } from './city.js';
import { buildPlayer, updatePlayer, updateCamera, player, teleportPlayer } from './player.js';
import { makeCar, placeCar, updateDriving, updateCarEntry, enterCar, exitCar, nearestCar } from './vehicles.js';
import { buildTraffic, updateTraffic } from './traffic.js';
import { buildPolice, updatePolice, ensureCruisers, clearWanted } from './police.js';
import { buildMissions, startMission, updateMissions, MISSIONS } from './missions.js';
import { buildCombat, updateCombat, shoot, punch, reload } from './combat.js';
import { buildHud, updateHud } from './hud.js';
import { initAudio, updateAudio, audio, setMuted } from './audio.js';
import { saveGame, loadSave, hasSave, applySave } from './save.js';
import { initInput, input, keyPressed, endFrameInput } from './input.js';

let renderer;
let scene;
let camera;
let clock;
let parkedCars = [];
let autosaveTimer = 0;
let started = false;

const params = new URLSearchParams(window.location.search);
const staging = params.get('staging');
const autostart = params.get('autostart') === '1' || staging !== null;

function buildLights() {
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8a7a5a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
  sun.position.set(120, 180, 60);
  scene.add(sun);
  scene.fog = new THREE.Fog(0x9fc8e8, 260, 520);
}

function buildSky() {
  scene.background = new THREE.Color(0x87bfe8);
  // The sun: a bright disc high in the sky.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(14, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false }),
  );
  sunDisc.position.set(180, 210, -260);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
}

function buildParkedCars() {
  parkedCars = [];
  const spots = [
    { x: 92, z: -104, heading: 0, color: 0xe8c832 },
    { x: 108, z: -96, heading: Math.PI, color: 0x2e7ad8 },
    { x: -68, z: -146, heading: Math.PI / 2, color: 0xd83a2e },
    { x: -52, z: -134, heading: -Math.PI / 2, color: 0x2ed8a0 },
    { x: 8, z: 40, heading: Math.PI / 2, color: 0xe8e8e8 },
    { x: -8, z: -40, heading: -Math.PI / 2, color: 0x8a4fd8 },
  ];
  for (const spot of spots) {
    const car = makeCar(spot.color);
    car.driver = null;
    placeCar(scene, car, spot.x, spot.z, spot.heading);
    parkedCars.push(car);
  }
}

function resetRun() {
  if (S.car) exitCar();
  clearWanted();
  S.cash = 0;
  S.health = S.maxHealth;
  S.magazine = S.magSize;
  S.reserve = 60;
  S.missionsCompleted = 0;
  S.missionIndex = -1;
  S.mission = null;
  S.objective = 'Welcome to Solmar City';
  S.busted = false;
  S.bustedTimer = 0;
  S.stolenCar = false;
  teleportPlayer(0, 24, Math.PI);
  S.speedKmh = 0;
}

function startGame(fresh) {
  initAudio();
  if (fresh) resetRun();
  document.getElementById('menu').style.display = 'none';
  document.getElementById('busted').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  S.mode = 'playing';
  started = true;
  if (!S.mission && S.missionIndex < 0 && S.missionsCompleted === 0) {
    startMission(0);
  }
  toast('Welcome to Solmar City — follow the gold beacon', 5);
}

function doBusted(reason) {
  if (S.mode !== 'playing') return;
  S.mode = 'busted';
  S.busted = true;
  audio.busted();
  if (S.car) exitCar();
  const fine = Math.min(S.cash, Math.max(50, Math.round(S.cash * 0.1)));
  S.cash -= fine;
  clearWanted();
  S.health = S.maxHealth;
  S.magazine = S.magSize;
  S.reserve = Math.max(S.reserve, 24);
  teleportPlayer(LANDMARKS.hospital.x, LANDMARKS.hospital.z + 16, Math.PI);
  const title = reason === 'wasted' ? 'WASTED' : 'BUSTED';
  document.getElementById('busted-title').textContent = title;
  document.getElementById('busted-text').textContent =
    reason === 'wasted'
      ? 'You got knocked out. The medics patched you up at Solmar General.'
      : `The Solmar PD caught you. Fine paid: ${fmtCash(fine)}.`;
  document.getElementById('busted').style.display = 'flex';
  document.getElementById('hud').style.display = 'none';
  saveGame();
}

// Staging ---------------------------------------------------------------
function stageChase() {
  startGame(true);
  // A stolen yellow car, already at top speed on the northbound road.
  const car = makeCar(0xe8c832);
  car.driver = 'player';
  placeCar(scene, car, 0, 60, Math.PI);
  car.speed = WORLD.topSpeed;
  enterCar(car);
  S.debug.autoDrive = true;
  addHeat(45);
  ensureCruisers(true);
  // Put cruisers right in the frame, pacing the car.
  const pace = [
    [-5, 48],
    [5, 48],
    [0, 36],
  ];
  pace.forEach(([cx, cz], i) => {
    const c = S.cruisers[i];
    if (!c) return;
    c.group.position.set(cx, 0, cz);
    c.heading = Math.PI;
    c.speed = 32;
  });
  S.debug.staged = 'chase';
}

function stageCity() {
  startGame(true);
  teleportPlayer(0, 44, Math.PI);
  S.weapon = 'pistol';
  addHeat(40);
  ensureCruisers(true);
  if (S.cruisers[0]) {
    S.cruisers[0].group.position.set(-9, 0, 54);
    S.cruisers[0].heading = 0;
    S.cruisers[0].speed = 4;
  }
  if (S.cruisers[1]) {
    S.cruisers[1].group.position.set(11, 0, 30);
    S.cruisers[1].heading = Math.PI;
    S.cruisers[1].speed = 4;
  }
  S.debug.staged = 'city';
}

function stageMission() {
  startGame(true);
  startMission(0);
  teleportPlayer(LANDMARKS.parkA.x, LANDMARKS.parkA.z + 8, Math.PI);
  S.debug.staged = 'mission';
}

function stageFoot() {
  startGame(true);
  // On foot south of Cafe Luna, facing its neon storefront, with the
  // road and its traffic between the player and the cafe.
  teleportPlayer(LANDMARKS.cafeLuna.x, LANDMARKS.cafeLuna.z + 36, Math.PI);
  // Level the camera so the rooftop sign and moon emblem are in frame.
  player.camPitch = 0.05;
  // Bring traffic and pedestrians into the frame for a busy street.
  const cars = S.trafficCars;
  if (cars[0]) {
    cars[0].group.position.set(38, 0, 40);
    cars[0].heading = Math.PI / 2;
    cars[0].axis = 'x';
  }
  if (cars[1]) {
    cars[1].group.position.set(84, 0, 40);
    cars[1].heading = -Math.PI / 2;
    cars[1].axis = 'x';
  }
  if (cars[2]) {
    cars[2].group.position.set(60, 0, 0);
    cars[2].heading = 0;
    cars[2].axis = 'z';
  }
  const peds = S.peds;
  const pedSpots = [[48, 46], [72, 46], [56, 34], [66, 30]];
  pedSpots.forEach((spot, i) => {
    if (peds[i]) {
      peds[i].pos.set(spot[0], 0, spot[1]);
      peds[i].target = null;
    }
  });
  S.debug.staged = 'foot';
}

function applyStaging() {
  if (!staging) return;
  if (staging === 'chase') stageChase();
  else if (staging === 'city') stageCity();
  else if (staging === 'mission') stageMission();
  else if (staging === 'foot') stageFoot();
}

// Public hooks for tests and screenshots ------------------------------------
function status() {
  return {
    version: S.version,
    mode: S.mode,
    cash: S.cash,
    health: Math.round(S.health),
    stars: S.stars,
    heat: Math.round(S.wantedHeat),
    magazine: S.magazine,
    reserve: S.reserve,
    missionsCompleted: S.missionsCompleted,
    missionIndex: S.missionIndex,
    missionName: S.mission ? S.mission.def.name : null,
    objective: S.objective,
    speedKmh: Math.round(S.speedKmh),
    onFoot: S.onFoot,
    cruisers: S.cruisers.length,
    traffic: S.trafficCars.length,
    peds: S.peds.length,
    x: Math.round((S.car ? S.car.group.position.x : player.pos.x) * 10) / 10,
    z: Math.round((S.car ? S.car.group.position.z : player.pos.z) * 10) / 10,
    busted: S.busted,
    time: Math.round(S.time * 10) / 10,
  };
}

window.__solmar = {
  state: S,
  version: VERSION,
  start: (fresh = true) => startGame(fresh),
  status,
  teleport: (x, z, heading) => {
    if (S.car) exitCar();
    teleportPlayer(x, z, heading === undefined ? null : heading);
  },
  setWanted: (heat) => {
    S.wantedHeat = Math.max(0, Math.min(100, heat));
    S.stars = S.wantedHeat <= 0 ? 0 : S.wantedHeat < 20 ? 1 : S.wantedHeat < 40 ? 2 : S.wantedHeat < 60 ? 3 : S.wantedHeat < 80 ? 4 : 5;
    if (heat > 0) S.lastHeatGain = S.time;
  },
  startMission: (i) => startMission(i),
  enterNearestCar: () => {
    const car = nearestCar(parkedCars);
    return car ? enterCar(car) : false;
  },
  exitCar: () => exitCar(),
  save: () => saveGame(),
  /** Fire the pistol and keep the flash and tracer on screen for the shot. */
  fireAndHold: (seconds = 10) => {
    S.debug.holdFlashUntil = S.time + seconds;
    return shoot();
  },
  /** Stage a mission-1 completion with a long-lived reward toast. */
  stageReward: () => {
    if (S.missionIndex !== 0) startMission(0);
    S.debug.longRewardToast = true;
    teleportPlayer(LANDMARKS.parkA.x, LANDMARKS.parkA.z + 4.5, Math.PI);
  },
};

// Boot ----------------------------------------------------------------------
function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('game') });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(0, 8, 40);
  clock = new THREE.Clock();

  buildLights();
  buildSky();
  buildCity(scene);
  buildPlayer(scene);
  buildTraffic(scene);
  buildPolice(scene);
  buildMissions(scene);
  buildCombat(scene);
  buildParkedCars();
  buildHud();
  initInput(renderer.domElement);

  S.hooks.onShoot = () => audio.shoot();
  S.hooks.onEmptyClick = () => audio.emptyClick();
  S.hooks.onPunch = () => audio.punch();
  S.hooks.onReload = () => audio.reload();
  S.hooks.onPickup = () => audio.pickup();
  S.hooks.onCrash = (speed) => {
    audio.crash(Math.min(2, speed / 15));
    addHeat(0);
    if (speed > 18) {
      S.health -= 5;
    }
  };
  S.hooks.onSteal = () => audio.horn();
  S.hooks.onMissionComplete = () => {
    audio.jingle();
    saveGame();
  };
  S.hooks.onBusted = () => doBusted('busted');

  // Menu buttons.
  document.getElementById('btn-start').addEventListener('click', () => startGame(true));
  const btnContinue = document.getElementById('btn-continue');
  if (hasSave()) {
    btnContinue.style.display = 'block';
    btnContinue.addEventListener('click', () => {
      const data = loadSave();
      if (!data) return;
      resetRun();
      applySave(data);
      startGame(false);
      if (data.missionIndex >= 0 && data.missionIndex < MISSIONS.length) {
        startMission(data.missionIndex);
      } else if (data.missionsCompleted >= MISSIONS.length) {
        S.objective = 'Free roam — Solmar City is yours. Replay missions from the menu.';
      } else if (S.missionsCompleted > 0) {
        startMission(S.missionsCompleted);
      }
    });
  }
  document.getElementById('btn-how').addEventListener('click', () => {
    const el = document.getElementById('howto');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btn-busted').addEventListener('click', () => {
    document.getElementById('busted').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    S.mode = 'playing';
    S.busted = false;
  });
  document.getElementById('btn-mute').addEventListener('click', () => {
    setMuted(!S.muted);
    document.getElementById('btn-mute').textContent = S.muted ? 'Unmute (M)' : 'Mute (M)';
  });
  // Mission replay buttons (shown once the story is done).
  const replayRow = document.getElementById('replay');
  MISSIONS.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'menu-btn small';
    b.textContent = `${i + 1}. ${m.name}`;
    b.addEventListener('click', () => {
      resetRun();
      S.missionsCompleted = MISSIONS.length;
      startGame(false);
      startMission(i);
    });
    replayRow.appendChild(b);
  });
  if (hasSave()) {
    const data = loadSave();
    if (data && data.missionsCompleted >= MISSIONS.length) {
      replayRow.style.display = 'flex';
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  if (autostart) {
    applyStaging();
    if (!started) startGame(true);
  }

  renderer.setAnimationLoop(tick);
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  S.time += dt;
  if (S.shake.t > 0) {
    S.shake.t -= dt;
    if (S.shake.t <= 0) S.shake.mag = 0;
  }

  if (S.mode === 'playing') {
    // Keyboard actions.
    if (keyPressed('KeyF')) punch();
    if (keyPressed('KeyR')) reload();
    if (keyPressed('KeyM')) {
      setMuted(!S.muted);
      document.getElementById('btn-mute').textContent = S.muted ? 'Unmute (M)' : 'Mute (M)';
    }
    if (keyPressed('Digit1')) S.weapon = 'pistol';
    if (keyPressed('Digit2')) S.weapon = 'fist';
    if (input.clicked && S.onFoot && S.weapon === 'pistol') shoot();
    if (input.clicked && !S.onFoot) audio.horn();

    if (S.car) {
      updateDriving(S.car, dt);
    } else {
      updatePlayer(dt);
      S.speedKmh = player.speed * 3.6;
    }
    updateCarEntry(parkedCars);
    updateTraffic(dt);
    updatePolice(dt);
    updateMissions(dt);
    updateCombat(dt);

    // Wasted: health hits zero.
    if (S.health <= 0) {
      doBusted('wasted');
    }

    // Autosave every 15 seconds.
    autosaveTimer += dt;
    if (autosaveTimer > 15) {
      autosaveTimer = 0;
      saveGame();
    }
  }

  // Clouds drift even on the menu.
  for (const cloud of clouds) {
    cloud.position.x += cloud.userData.speed * dt;
    if (cloud.position.x > 240) cloud.position.x = -240;
  }

  updateCamera(camera, dt);
  updateHud();
  updateAudio(dt);
  endFrameInput();
  renderer.render(scene, camera);
}

init();
