// Solmar City — bootstrap, game loop, menus, staging.
// Wires every system together, runs the frame loop, and stages the four
// screenshot scenes the entry is judged on. The staging helpers put the
// player, the cars and the cops in exact poses; the harness drives them
// through ?autostart=1&staging=...
// A low sun glow hangs over the south-western horizon so the dusk sky has
// a light source, not just a gradient.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, toast, clearToasts } from './state.js';
import { buildCity, updateBlobShadows, updateTrafficLights } from './city.js';
import { buildPlayer, updatePlayer, updateCamera } from './player.js';
import { spawnParkedCar, nearestCar, enterCar, exitCar, updateDriving } from './vehicles.js';
import { buildTraffic, updateTraffic, updatePeds, reportCrime } from './traffic.js';
import { updatePolice, spawnCruiser, makeOfficer, triggerBusted } from './police.js';
import { startMission, updateMissions, updateBeacon, debugCompleteMission1 } from './missions.js';
import { buildCombat, shoot, punch, reload, updateCombat } from './combat.js';
import { buildHud, updateHud } from './hud.js';
import { buildAudio } from './audio.js';
import { saveGame, loadSave, applySave } from './save.js';
import { buildInput } from './input.js';
import { glowTexture } from './textures.js';

let lastAutosave = 0;
let eWas = false;
let fWas = false;
let rWas = false;

function setupLights() {
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
  // clearcoat paint, glass and chrome pick up the orange-gold horizon and
  // the violet zenith instead of reflecting nothing. Built once at boot —
  // zero cost per frame. Kept dim so it lifts materials without washing
  // out the dusk lighting.
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
  // The low sun itself: one large soft warm glow sprite hanging over the
  // south-western horizon, additive, so the dusk sky has a visible light
  // source. It sits just west of the road's southern axis, low, so the
  // chase camera looking south down road x=0 sees it over the harbor
  // instead of hidden behind the towers. Fog is off for it — a sun does
  // not dim with distance the way a building does. Big and bright enough
  // to read against the sky dome's own baked glow.
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffa050, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunGlow.scale.set(220, 220, 1);
  sunGlow.position.set(-40, 35, 440);
  sunGlow.renderOrder = -5;
  S.scene.add(sunGlow);
}

function parkStarterCars() {
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

function hookMenu() {
  const menuEl = document.getElementById('menu');
  const startBtn = document.getElementById('btn-new');
  const resumeBtn = document.getElementById('btn-continue');
  const saved = loadSave();
  if (saved) {
    resumeBtn.style.display = 'inline-block';
    resumeBtn.textContent = 'Continue — $' + saved.cash + ' · ' + saved.missionsCompleted + ' mission' + (saved.missionsCompleted === 1 ? '' : 's') + ' done';
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
function pollInteract(dt) {
  const eDown = !!S.keys.KeyE;
  if (eDown && !eWas) {
    if (S.onFoot) {
      const car = nearestCar(S.player.pos.x, S.player.pos.z, 3.5);
      if (car) {
        // Stealing a car in the open is witnessed: anyone close sees it.
        const wasStolen = car.stolen === true;
        enterCar(car);
        if (!wasStolen) reportCrime(car.mesh.position.x, car.mesh.position.z, 30);
      }
    } else {
      exitCar();
    }
  }
  eWas = eDown;
  const fDown = !!S.keys.KeyF;
  if (fDown && !fWas) punch();
  fWas = fDown;
  const rDown = !!S.keys.KeyR;
  if (rDown && !rWas) reload();
  rWas = rDown;
  if (S.keys.Digit1) S.player.weapon = 'pistol';
  if (S.keys.Digit2) S.player.weapon = 'fists';
}

function tick() {
  requestAnimationFrame(tick);
  const step = Math.min(0.05, S.clock.getDelta());
  if (S.mode === 'playing') {
    S.time += step;
    pollInteract(step);
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
    if (S.time - lastAutosave > 10) {
      lastAutosave = S.time;
      saveGame();
    }
  } else if (S.mode === 'busted') {
    updateHud();
  }
}

// ------------------------------------------------------------ staging

function autoBegin() {
  startGame(false);
}

export function stageChase() {
  autoBegin();
  S.debug.staged = 'chase';
  // The stolen car starts well up road x=0, close to the harbor, so the
  // SOLMAR HARBOR sign is big and readable in the cover instead of a
  // distant speck. It starts at z=100 (not 90): at 90 the car sat right
  // on the intersection's stop line and crosswalk, and the white marking
  // filled the bottom-centre of the frame as a big blank trapezoid. From
  // z=100 the car has run to about z=114 by the shutter, leaving the
  // sign (z=164) about 50 m ahead — still big and readable. Staged at
  // top speed already.
  const getaway = spawnParkedCar(0, 100, 0, 0xd8b83a);
  const player = S.player;
  player.pos.x = 0;
  player.pos.z = 100;
  enterCar(getaway);
  getaway.speed = 34; // 122 km/h at the shutter, even if the held W key
  // takes a frame to register in headless Chrome
  S.debug.freezeTraffic = true; // nothing wanders into the chase route mid-shot
  // Sweep the chase route (road x=0, z 20..180) clear of traffic and
  // parked cars, so the staged car is never stuck behind a slow car.
  let shifted = 0;
  for (const t of S.trafficCars) {
    if (Math.abs(t.mesh.position.x) < 14 && t.mesh.position.z > 20 && t.mesh.position.z < 180) {
      t.mesh.position.x = 120;
      t.mesh.position.z = -140 + shifted * 40;
      t.heading = 0;
      shifted++;
    }
  }
  for (const other of S.cars) {
    if (other === getaway) continue;
    if (Math.abs(other.mesh.position.x) < 14 && other.mesh.position.z > 20 && other.mesh.position.z < 180) {
      other.mesh.position.x = 120;
      other.mesh.position.z = -100 + shifted * 30;
      shifted++;
    }
  }
  // Pedestrians wander onto the chase route as well — one was standing
  // right beside the getaway car in the cover, about to be run over.
  // Shove any ped on road x=0 (z 20..180) well clear: to the east
  // sidewalk AND far up the road (z=170), so it reads as a small figure
  // in the distance instead of a giant looming at the lens. Merely
  // pushing it sideways (x=12) left it level with the camera, huge at
  // the frame's edge.
  for (const ped of S.peds) {
    const pp = ped.mesh.position;
    if (Math.abs(pp.x) < 8 && pp.z > 20 && pp.z < 180) {
      pp.x = 20;
      pp.z = 170;
    }
  }
  S.heat = 65; // 4 stars
  S.objectiveText = 'Bring the car to the Hideout garage';
  // Two cruisers pace the car in formation, one flanking ahead on each
  // side, so the frame reads as a chase without any cruiser stacking on
  // the player's car. A third cruiser used to ride level with the player
  // on the left, but it lagged behind its slot, drifted in behind the
  // getaway car, and its light bar landed right on the player's roof in
  // the cover — the getaway car read as a police cruiser. Two ahead is
  // the clean shot.
  S.debug.pacing = true;
  const escort = [
    [-7.5, 110, 34, { side: -7.5, fwd: 10 }],
    [7.5, 110, 34, { side: 7.5, fwd: 10 }],
  ];
  for (const [cx, cz, speed, slot] of escort) {
    const cruiser = spawnCruiser(cx, cz);
    cruiser.mesh.position.set(cx, 0, cz);
    cruiser.heading = 0;
    cruiser.speed = speed;
    cruiser.pace = slot;
  }
  S.camYaw = 0;
  // Snap the lens to its staged spot at once. The headless game clock
  // runs far behind real time, so the camera's per-frame ease never
  // settles before the shutter — without this the cover is shot from
  // wherever the lens happened to drift to, not from behind the car.
  updateCamera(1);
}

export function stageCity() {
  autoBegin();
  S.debug.staged = 'city';
  const player = S.player;
  player.pos.x = 0;
  player.pos.z = 0;
  player.group.position.set(0, 0, 0);
  player.heading = Math.PI; // facing north (-z), away from the camera, at the cruiser
  S.camYaw = 0; // camera south of the player, looking north: cruiser ahead in view
  // Camera close and nearly level (was 0.3 pitch / 8.5 dist): less empty
  // pavement in the lower frame, the shootout fills more of the shot.
  S.camPitch = 0.12;
  S.camDist = 7.0;
  S.heat = 55; // 3 stars, holds through the heat decay of the wait
  S.debug.noSpawn = true; // no extra cruisers spawning onto the camera
  S.debug.freezePolice = true; // the staged cruiser holds its pose instead
  // of driving onto the player and tripping the BUSTED timer mid-shot
  S.debug.freezeTraffic = true; // traffic holds still so no car drives
  // through the frame and parks on the camera during the 6 s wait
  S.objectiveText = 'Lose the cops — get your wanted level to zero';
  // A cruiser ahead with an officer standing beside it, close enough to
  // read in the frame.
  const cop = spawnCruiser(0, -13);
  cop.mesh.position.set(0, 0, -13);
  cop.heading = 0;
  cop.speed = 0;
  makeOfficer(3.2, -11, Math.PI * 0.85);
  // Keep the frame clear of stray traffic right by the player.
  for (const t of S.trafficCars) {
    if (Math.abs(t.mesh.position.x) >= 12 || Math.abs(t.mesh.position.z) >= 12) continue;
    t.mesh.position.set(120, 0, -120);
  }
  // The headless game clock runs far behind real time (about 0.1 s of
  // game time per 8 s of real time), so the traffic-light cycle is still
  // on its opening phase at the shutter — north-south green, not red.
  // Pin the clock into the red phase (the 16 s cycle runs red from
  // t=8 to t=16) so the stopped car below is genuinely waiting at a red
  // light instead of sitting under a green one.
  S.time = 10;
  // A car stopped at the red light, so the frame shows the traffic
  // system working instead of an empty street: take one of the cars
  // that was just cleared out of the frame and park it at the
  // northbound stop line of this intersection, facing north, speed
  // zero. Its tail lamps glow (they are emissive), so it reads as a
  // car waiting at the light with its brake lights on. The north-south
  // light is red at the 8 s shutter (the 16 s cycle runs red from
  // t=8 to t=16, and the clock starts near zero at boot).
  for (const t of S.trafficCars) {
    if (Math.abs(t.mesh.position.x) < 30 && Math.abs(t.mesh.position.z) < 30) continue;
    t.mesh.position.set(-2.4, 0, -10.4);
    t.mesh.rotation.y = 0;
    t.heading = 0;
    t.speed = 0;
    t.cruise = 0;
    t.alongX = false;
    t.road = 0;
    break;
  }
  // Foreground interest, so the lower frame is a street, not bare pavement:
  // a car parked at the left kerb, just ahead of the camera.
  spawnParkedCar(-4, 1.5, 0, 0x3a7ad8);
  // Street life in frame, close to the player so the flee still reads at
  // the 8 s shutter: two pedestrians crossing ahead, one walking further
  // out, and one more to the side. The shot itself (fireAndHold) makes
  // the nearby ones flee with their arms up.
  placeWalkers([[3, -5, 0.4, 'cross'], [-3.5, -4.5, -0.5, 'cross'], [-1, -16, 2.8, 'walk'], [6, -2, -2.0, 'walk']]);
  // One shot, flash held open for the camera.
  fireAndHold();
  // Snap the lens to its staged spot at once (see stageChase): the
  // headless clock lags, so the per-frame ease never settles in time.
  updateCamera(1);
}

// Move the first few pedestrians to fixed spots (x, z, heading, mode) so a
// staged shot has street life in frame instead of an empty street. A
// fifth element links a talking pair: the index of the partner placement.
// Staged walkers hold their pose for 30 s, so they are still in frame at
// the 8 s shutter instead of wandering off.
function placeWalkers(placements) {
  for (let i = 0; i < placements.length; i++) {
    const walker = S.peds[i];
    if (!walker) continue;
    const [px, pz, hd, mode] = placements[i];
    walker.mesh.position.set(px, 0, pz);
    walker.heading = hd;
    walker.fleeTimer = 0;
    walker.retarget = 5;
    walker.partner = null;
    if (mode) {
      walker.mode = mode;
      walker.stateT = 30;
      walker.phone.visible = false;
      walker.head.rotation.x = 0;
    }
  }
  // Second pass: link talking pairs and face them at each other.
  for (let i = 0; i < placements.length; i++) {
    const partnerIdx = placements[i][4];
    if (partnerIdx === undefined || partnerIdx === null || partnerIdx < 0) continue;
    const walker = S.peds[i];
    const other = S.peds[partnerIdx];
    if (!walker || !other) continue;
    walker.partner = other;
    other.partner = walker;
    walker.mode = 'talk';
    other.mode = 'talk';
    walker.stateT = 30;
    other.stateT = 30;
    walker.heading = Math.atan2(other.mesh.position.x - walker.mesh.position.x, other.mesh.position.z - walker.mesh.position.z);
    other.heading = Math.atan2(walker.mesh.position.x - other.mesh.position.x, walker.mesh.position.z - other.mesh.position.z);
  }
}

export function stageMission() {
  autoBegin();
  S.debug.staged = 'mission';
  S.debug.longRewardToast = true;
  S.debug.holdReward = true; // keep the reward banner alone for the shot
  S.debug.freezeTraffic = true; // hold traffic still so no truck wanders
  // into the frame and parks on the camera during the 8 s wait
  const player = S.player;
  // Face Solmar Tower down a clear sightline: stand on road z=-80 looking
  // east. The tower's south face is 20 m north of that road, and no nearer
  // tower stands in the same column (looking north from road x=80, the
  // (100,-60) tower sits directly in front of it and hides it).
  // Stand at x=-20, not -40: twenty metres closer to the tower, so the
  // west-face sign reads bigger in the frame instead of a distant speck.
  // The 22 m tower row north of this road still clears the sightline —
  // the line of sight to the sign at y=68 passes well above it.
  player.pos.x = -20;
  player.pos.z = -80;
  player.group.position.set(-20, 0, -80);
  player.heading = Math.PI / 2; // facing east, down road z=-80 toward the tower
  S.camYaw = -Math.PI / 2;
  // Framing fix: the camera used to sit almost on the ground looking up
  // (pitch clamped to -0.15), so the near pavement filled the bottom half
  // of the frame. Raised to 0.22 at 10 m, the camera looks nearly level:
  // the tower fills the upper frame and the near pavement drops out.
  // That level look could not see the tower sign at all — the lens
  // always points at the player's chest (y=1.55), so a sign 80 m up
  // sits above the frame. Tilt the lens up (pitch -0.15, the clamp
  // minimum) so the tower and its sign come into the upper frame: the
  // sign's top edge sits at about 38.2 degrees up from the player, and
  // at -0.12 the frame top only reached 37.8 degrees, cropping the
  // sign's top by a hair; at -0.15 the frame top reaches about 39.5
  // degrees, clearing it. The street still fills the lower half.
  // The camera sits closer (7 m, not 10 m) so it rides higher off the
  // ground: at 10 m the up-tilt put the lens almost on the pavement
  // and the near road washed out white at the glancing angle; at 7 m
  // the lens is half a metre up and the foreground reads as street.
  S.camPitch = -0.15;
  S.camDist = 7;
  // Street life: a talking pair further down the road for depth, a waiter
  // at the kerb in the lower-left foreground, one more walker on the
  // north sidewalk close to the camera, and one waiting at the south
  // kerb in the lower-right foreground, so the lower frame has people
  // in it instead of bare pavement. Last of all, a crosser standing on
  // the crosswalk at the intersection (0,-80): the headless clock runs
  // so slowly that a walker placed further back never reaches the
  // stripes by the shutter, so it is staged on the crossing itself,
  // mid-stride across the east-west road.
  placeWalkers([[0, -82, 1.2, 'talk', 1], [1.5, -82, -1.2, 'talk', 0], [-21.4, -83.5, 0.6, 'wait'], [-26, -73.5, -1.6, 'wait'], [-24, -71, 0.5, 'wait'], [0, -80, 0, 'cross']]);
  // The crosser needs its crossing spelled out: across the east-west road
  // z=-80, from the north sidewalk to the south one. placeWalkers only
  // sets the mode; without these the defaults would send it across the
  // wrong road.
  const crosser = S.peds[5];
  if (crosser) {
    crosser.crossFrom = 1;
    crosser.crossAxis = 'ew';
    crosser.crossRoad = -80;
  }
  debugCompleteMission1();
  // debugCompleteMission1 teleports the player to the park; put them back
  // on the road with the tower in view.
  player.pos.x = -20;
  player.pos.z = -80;
  player.group.position.set(-20, 0, -80);
  player.heading = Math.PI / 2;
  // A car parked in the lower-right foreground, close enough to the
  // camera (about 7 m now) that it reads as a car in the street and
  // fills the lower frame instead of leaving it bare: its roof stays
  // below the frame centre and its plate is fully in frame, not cut
  // off at the right edge. It sits far enough down the road (east)
  // that the low, upward-tilted lens looks over its roof at the tower
  // instead of into its side.
  spawnParkedCar(-21, -75.5, Math.PI / 2, 0xd84a4a);
  // A second car in the lower-left foreground, just ahead of the lens
  // on the road itself, so the bottom of the frame has cars on both
  // sides instead of one car and a wide empty stretch of tarmac. It
  // sits low enough (roof ~1.5 m) that it never hides the tower.
  spawnParkedCar(-21, -84.5, Math.PI / 2, 0x3a7ad8);
  // The completion banner stands alone. The objective line is left
  // blank on purpose: its pill sits across the very top of the frame,
  // exactly where the tower sign now lands, and would hide the sign's
  // letters. The banner below it still says Mission complete +$300.
  S.objectiveText = '';
  S.objectiveDist = null;
  // Snap the lens to its staged spot at once (see stageChase): the
  // headless clock lags, so the per-frame ease never settles in time.
  updateCamera(1);
}

export function stageFoot() {
  autoBegin();
  S.debug.staged = 'foot';
  // The mission-start toast sits over the CAFE LUNA sign in headless runs
  // (game time lags real time there, so the 6 s toast is still up at the
  // 8 s shutter). Clear it for the shot; the objective line is cleared
  // too — it sat across the sign itself.
  clearToasts();
  const player = S.player;
  // On road z=-40, facing Cafe Luna. Framing: the rooftop sign tops out
  // at y≈17, so the camera must sit low and look UP — but the old pitch
  // (-0.1) put the camera almost on the ground and the near pavement
  // filled the bottom 40% of the frame. Pitch -0.06 at 12 m keeps the
  // whole CAFE LUNA sign in frame while the parked cars and the
  // foreground walker still fill the lower frame, and it lifts the
  // frame bottom enough that the shadowed near pavement is a thin
  // strip instead of a dark void.
  player.pos.x = -60;
  player.pos.z = -40;
  player.group.position.set(-60, 0, -40);
  player.heading = Math.PI; // facing north, walking toward Cafe Luna
  S.camYaw = 0; // camera south of the player, looking north at the sign
  S.camPitch = -0.06;
  S.camDist = 12;
  S.objectiveText = '';
  S.objectiveDist = null;
  // Cafe street life, each doing something different: a talking pair at
  // the outdoor tables, one on the phone by the cafe, one sitting on a
  // chair, and one waiting at the kerb close to the camera so the lower
  // frame has a person in it instead of bare pavement.
  placeWalkers([[-54, -47, -2.2, 'talk', 1], [-57, -47, 2.2, 'talk', 0], [-66, -47, 0.8, 'phone'], [-61.3, -49.5, 0, 'sit'], [-60, -33.5, 0.3, 'wait']]);
  // A taxi waiting at the kerb in the left foreground, for depth, and a
  // car parked just ahead of the camera on the right, to balance the
  // lower frame. Both sit close to the camera's line of sight.
  spawnParkedCar(-72, -38, Math.PI / 2, 0xe8c832, 'taxi');
  spawnParkedCar(-57.4, -36, Math.PI / 2, 0x4ad87a);
  // The bottom of the frame used to be a dark empty band of pavement:
  // the camera sits low looking up at the sign, so the near ground
  // fills the lower quarter with nothing on it. Fill it with street
  // furniture right in front of the lens — a bench on the right and a
  // planter on the left, both about three metres ahead of the camera,
  // low enough to stay out of the sign and the cafe but tall enough to
  // break the empty expanse into shapes. The camera itself stays put
  // (the sign is only just inside the top of the frame as it is).
  const benchSeat = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.5, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x8a6a42 })
  );
  benchSeat.position.set(-55, 0.25, -31);
  benchSeat.castShadow = true;
  S.scene.add(benchSeat);
  const planterPot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.65, 0.8, 8),
    new THREE.MeshLambertMaterial({ color: 0x5a6a4a })
  );
  planterPot.position.set(-62, 0.4, -31);
  planterPot.castShadow = true;
  S.scene.add(planterPot);
  const planterBush = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x3f8a3a })
  );
  planterBush.position.set(-62, 1.0, -31);
  planterBush.castShadow = true;
  S.scene.add(planterBush);
  // Snap the lens to its staged spot at once (see stageChase): the
  // headless clock lags, so the per-frame ease never settles in time.
  // Without this the shot is taken from wherever the lens drifted to —
  // in the last run it was pressed against a building wall and the
  // cafe sign was out of frame entirely.
  updateCamera(1);
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

function boot() {
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
  setupLights();
  buildCity();
  buildPlayer();
  buildTraffic();
  buildCombat();
  buildAudio();
  buildHud();
  buildInput();
  parkStarterCars();
  hookMenu();
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
    reportCrime,
  };

  // Staging entry: ?autostart=1&staging=chase|city|mission|foot
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
    const scene = params.get('staging');
    if (scene === 'chase') stageChase();
    else if (scene === 'city') stageCity();
    else if (scene === 'mission') stageMission();
    else if (scene === 'foot') stageFoot();
    else autoBegin();
  }
  tick();
}

boot();
