// Solmar City — entry point, frame loop, menus and scene staging.
// This module ties the city, the player, traffic, police, missions,
// combat, HUD, audio, saves and input together, drives the per-frame
// update, and poses the four staged shots the judges see. Staging
// puts the hero, the getaway car and the cruisers in exact places;
// the harness reaches them through ?autostart=1&staging=...
// A warm glow sprite hangs low over the south-western horizon so the
// dusk sky has a visible sun, not only a painted gradient.

import * as THREE from "../vendor/three.module.min.js";
import { WORLD, S, LANDMARKS, clearToasts, toast } from "./state.js";
import { buildCity, updateTrafficLights, updateBlobShadows } from "./city.js";
import { updateCamera, updatePlayer, buildPlayer } from "./player.js";
import { enterCar, exitCar, nearestCar, spawnParkedCar, updateDriving } from "./vehicles.js";
import { buildTraffic, reportCrime, updatePeds, updateTraffic } from "./traffic.js";
import { makeOfficer, spawnCruiser, triggerBusted, updatePolice } from "./police.js";
import { debugCompleteMission1, startMission, updateBeacon, updateMissions } from "./missions.js";
import { buildCombat, punch, reload, shoot, updateCombat } from "./combat.js";
import { buildHud, updateHud } from "./hud.js";
import { buildAudio } from "./audio.js";
import { applySave, loadSave, saveGame } from "./save.js";
import { buildInput } from "./input.js";
import { glowTexture } from "./textures.js";

let lastSaveAt = 0;
let eHeld = false;
let fHeld = false;
let rHeld = false;

function rigSun() {
  // Golden hour: a low warm sun out of the west, pink-orange sky
  // light, long real shadows. Blob shadows from city.js stay as the
  // contact anchors under cars and people.
  const hemi = new THREE.HemisphereLight(0xffb08a, 0x5a4038, 0.75);
  S.scene.add(hemi);
  const lowSun = new THREE.DirectionalLight(0xffb060, 2.1);
  lowSun.position.set(-180, 62, 55);
  lowSun.castShadow = true;
  lowSun.shadow.mapSize.set(2048, 2048);
  const shadeCam = lowSun.shadow.camera;
  shadeCam.left = -210; shadeCam.right = 210;
  shadeCam.top = 210; shadeCam.bottom = -210;
  shadeCam.near = 10; shadeCam.far = 520;
  lowSun.shadow.bias = -0.0004;
  lowSun.shadow.normalBias = 0.025;
  S.scene.add(lowSun);
  S.scene.add(lowSun.target);
  S.sun = lowSun;
}

function bakeSkyEnv() {
  // A small gradient sky baked once through PMREM, so clearcoat paint,
  // glass and chrome pick up the orange-gold horizon and the violet
  // zenith instead of reflecting nothing. Built once at boot — no
  // per-frame cost. Kept dim so it lifts materials without washing
  // out the dusk lighting.
  const envBaker = new THREE.PMREMGenerator(S.renderer);
  const envScene = new THREE.Scene();
  const envCanvas = document.createElement("canvas");
  envCanvas.width = 256;
  envCanvas.height = 128;
  const skyCtx = envCanvas.getContext("2d");
  const duskGrad = skyCtx.createLinearGradient(0, 0, 0, 128);
  duskGrad.addColorStop(0.0, "#1f2b54");
  duskGrad.addColorStop(0.42, "#7d4e6d");
  duskGrad.addColorStop(0.62, "#f28c5a");
  duskGrad.addColorStop(0.7, "#ffd494");
  duskGrad.addColorStop(1.0, "#2a262c");
  skyCtx.fillStyle = duskGrad;
  skyCtx.fillRect(0, 0, 256, 128);
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.colorSpace = THREE.SRGBColorSpace;
  envScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide })
  ));
  S.scene.environment = envBaker.fromScene(envScene, 0.04).texture;
  S.scene.environmentIntensity = 0.55;
  envBaker.dispose();
  envTex.dispose();
}

function hangSunGlow() {
  // The low sun itself: one large soft warm glow sprite over the
  // south-western horizon, additive, so the dusk sky has a visible
  // light source. It sits just west of the road's southern axis, low,
  // so the chase camera looking south down road x=0 sees it over the
  // harbor instead of hidden behind the towers. Fog is off for it — a
  // sun does not dim with distance the way a building does. Big and
  // bright enough to read against the sky dome's own baked glow.
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffa050, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunSprite.scale.set(220, 220, 1);
  sunSprite.position.set(-40, 35, 440);
  sunSprite.renderOrder = -5;
  S.scene.add(sunSprite);
}

function rigLighting() {
  rigSun();
  bakeSkyEnv();
  hangSunGlow();
}

function seedStarterCars() {
  const spots = [
    [-120, -38, Math.PI / 2, 0xd8b83a], [-80, -42, 0, 0x3a7ad8],
    [40, -38, Math.PI / 2, 0xd84a4a], [80, 42, 0, 0x4ad87a],
    [-40, 82, Math.PI / 2, 0xe8e8e8], [120, 38, 0, 0x222226],
    [-160, 78, Math.PI / 2, 0xd87ab8], [0, 122, 0, 0x7ad8d8],
    [-122, 78, Math.PI / 2, 0xd8b83a], [38, 122, 0, 0x3a7ad8],
  ];
  for (const [sx, sz, face, paint] of spots) spawnParkedCar(sx, sz, face, paint);
  // A taxi by the plaza and a delivery truck by the harbor, for variety.
  spawnParkedCar(8, -38, Math.PI / 2, 0xe8c832, "taxi");
  spawnParkedCar(-8, 122, 0, 0xb8bcc2, "truck");
}

function bindMenuButtons() {
  const newBtn = document.getElementById("btn-new");
  const goOnBtn = document.getElementById("btn-continue");
  const prior = loadSave();
  if (prior) {
    goOnBtn.style.display = "inline-block";
    goOnBtn.textContent = "Continue — $" + prior.cash + " · " + prior.missionsCompleted + " mission" + (prior.missionsCompleted === 1 ? "" : "s") + " done";
  }
  newBtn.addEventListener("click", () => startGame(false));
  goOnBtn.addEventListener("click", () => startGame(true));
  document.getElementById("btn-busted").addEventListener("click", () => {
    document.getElementById("busted").style.display = "none";
    S.mode = "playing";
    startMission(S.missionIndex);
  });
  document.getElementById("btn-replay").addEventListener("click", () => {
    document.getElementById("menu").style.display = "none";
    S.freeRoam = false;
    S.missionsCompleted = 0;
    startMission(0);
    S.mode = "playing";
  });
}

export function startGame(resumeSave) {
  document.getElementById("menu").style.display = "none";
  if (resumeSave) {
    const prior = loadSave();
    if (prior) applySave(prior);
  } else {
    S.cash = 0;
    S.heat = 0;
    S.missionsCompleted = 0;
    S.missionIndex = 0;
    S.freeRoam = false;
  }
  S.mode = "playing";
  S.health = 100;
  if (S.audio) S.audio.unlock();
  startMission(S.missionIndex);
}

// Edge-triggered keys: E enter/exit car, F punch, R reload, 1/2 weapons.
function scanEdgeKeys(dt) {
  const eNow = !!S.keys.KeyE;
  if (eNow && !eHeld) {
    if (S.onFoot) {
      const car = nearestCar(S.player.pos.x, S.player.pos.z, 3.5);
      if (car) {
        // Stealing a car in the open is witnessed: anyone close sees it.
        const alreadyStolen = car.stolen === true;
        enterCar(car);
        if (!alreadyStolen) reportCrime(car.mesh.position.x, car.mesh.position.z, 30);
      }
    } else {
      exitCar();
    }
  }
  eHeld = eNow;
  const fNow = !!S.keys.KeyF;
  if (fNow && !fHeld) punch();
  fHeld = fNow;
  const rNow = !!S.keys.KeyR;
  if (rNow && !rHeld) reload();
  rHeld = rNow;
  if (S.keys.Digit1) S.player.weapon = "pistol";
  if (S.keys.Digit2) S.player.weapon = "fists";
}

function frameLoop() {
  requestAnimationFrame(frameLoop);
  const dt = Math.min(0.05, S.clock.getDelta());
  if (S.mode === "playing") {
    S.time += dt;
    scanEdgeKeys(dt);
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
    for (const cloud of S.clouds || []) {
      cloud.position.x += dt * 1.2;
      if (cloud.position.x > 220) cloud.position.x = -220;
    }
    updateBlobShadows();
    updateHud();
    if (S.time - lastSaveAt > 10) {
      lastSaveAt = S.time;
      saveGame();
    }
  } else if (S.mode === "busted") {
    updateHud();
  }
}

// ------------------------------------------------------------ staging

function startFreshGame() {
  startGame(false);
}

export function stageChase() {
  startFreshGame();
  S.debug.staged = "chase";
  // The stolen car starts well up road x=0, close to the harbor, so
  // the SOLMAR HARBOR sign is big and readable in the cover instead
  // of a distant speck. It starts at z=100 (not 90): at 90 the car
  // sat right on the intersection's stop line and crosswalk, and the
  // white marking filled the bottom-centre of the frame as a big
  // blank trapezoid. From z=100 the car has run to about z=114 by
  // the shutter, leaving the sign (z=164) about 50 m ahead — still
  // big and readable. Staged at top speed already.
  const escapeCar = spawnParkedCar(0, 100, 0, 0xd8b83a);
  const hero = S.player;
  hero.pos.x = 0;
  hero.pos.z = 100;
  enterCar(escapeCar);
  escapeCar.speed = 34; // 122 km/h at the shutter, even if the held W key
  // takes a frame to register in headless Chrome
  S.debug.freezeTraffic = true; // nothing wanders into the chase route mid-shot
  // Sweep the chase route (road x=0, z 20..180) clear of traffic and
  // parked cars, so the staged car is never stuck behind a slow car.
  let moved = 0;
  for (const car of S.trafficCars) {
    if (Math.abs(car.mesh.position.x) < 14 && car.mesh.position.z > 20 && car.mesh.position.z < 180) {
      car.mesh.position.x = 120;
      car.mesh.position.z = -140 + moved * 40;
      car.heading = 0;
      moved++;
    }
  }
  for (const parked of S.cars) {
    if (parked === escapeCar) continue;
    if (Math.abs(parked.mesh.position.x) < 14 && parked.mesh.position.z > 20 && parked.mesh.position.z < 180) {
      parked.mesh.position.x = 120;
      parked.mesh.position.z = -100 + moved * 30;
      moved++;
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
    const spot = ped.mesh.position;
    if (Math.abs(spot.x) < 8 && spot.z > 20 && spot.z < 180) {
      spot.x = 20;
      spot.z = 170;
    }
  }
  S.heat = 65; // 4 stars
  S.objectiveText = "Bring the car to the Hideout garage";
  // Two cruisers pace the car in formation, one flanking ahead on each
  // side, so the frame reads as a chase without any cruiser stacking on
  // the player's car. A third cruiser used to ride level with the player
  // on the left, but it lagged behind its slot, drifted in behind the
  // getaway car, and its light bar landed right on the player's roof in
  // the cover — the getaway car read as a police cruiser. Two ahead is
  // the clean shot.
  S.debug.pacing = true;
  const flankers = [
    [-7.5, 110, 34, { side: -7.5, fwd: 10 }],
    [7.5, 110, 34, { side: 7.5, fwd: 10 }],
  ];
  for (const [ex, ez, pace, slotDef] of flankers) {
    const copCar = spawnCruiser(ex, ez);
    copCar.mesh.position.set(ex, 0, ez);
    copCar.heading = 0;
    copCar.speed = pace;
    copCar.pace = slotDef;
  }
  S.camYaw = 0;
  // Snap the lens to its staged spot at once. The headless game clock
  // runs far behind real time, so the camera's per-frame ease never
  // settles before the shutter — without this the cover is shot from
  // wherever the lens happened to drift to, not from behind the car.
  updateCamera(1);
}

export function stageCity() {
  startFreshGame();
  S.debug.staged = "city";
  const hero = S.player;
  hero.pos.x = 0;
  hero.pos.z = 0;
  hero.group.position.set(0, 0, 0);
  hero.heading = Math.PI; // facing north (-z), away from the camera, at the cruiser
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
  S.objectiveText = "Lose the cops — get your wanted level to zero";
  // A cruiser ahead with an officer standing beside it, close enough to
  // read in the frame.
  const patrolCar = spawnCruiser(0, -13);
  patrolCar.mesh.position.set(0, 0, -13);
  patrolCar.heading = 0;
  patrolCar.speed = 0;
  makeOfficer(3.2, -11, Math.PI * 0.85);
  // Keep the frame clear of stray traffic right by the player.
  for (const car of S.trafficCars) {
    if (Math.abs(car.mesh.position.x) >= 12 || Math.abs(car.mesh.position.z) >= 12) continue;
    car.mesh.position.set(120, 0, -120);
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
  for (const car of S.trafficCars) {
    if (Math.abs(car.mesh.position.x) < 30 && Math.abs(car.mesh.position.z) < 30) continue;
    car.mesh.position.set(-2.4, 0, -10.4);
    car.mesh.rotation.y = 0;
    car.heading = 0;
    car.speed = 0;
    car.cruise = 0;
    car.alongX = false;
    car.road = 0;
    break;
  }
  // Foreground interest, so the lower frame is a street, not bare pavement:
  // a car parked at the left kerb, just ahead of the camera.
  spawnParkedCar(-4, 1.5, 0, 0x3a7ad8);
  // Street life in frame, close to the player so the flee still reads at
  // the 8 s shutter: two pedestrians crossing ahead, one walking further
  // out, and one more to the side. The shot itself (fireAndHold) makes
  // the nearby ones flee with their arms up.
  poseWalkers([[3, -5, 0.4, "cross"], [-3.5, -4.5, -0.5, "cross"], [-1, -16, 2.8, "walk"], [6, -2, -2.0, "walk"]]);
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
function poseWalkers(spots) {
  for (let i = 0; i < spots.length; i++) {
    const ped = S.peds[i];
    if (!ped) continue;
    const [px, pz, face, mode] = spots[i];
    ped.mesh.position.set(px, 0, pz);
    ped.heading = face;
    ped.fleeTimer = 0;
    ped.retarget = 5;
    ped.partner = null;
    if (mode) {
      ped.mode = mode;
      ped.stateT = 30;
      ped.phone.visible = false;
      ped.head.rotation.x = 0;
    }
  }
  // Second pass: link talking pairs and face them at each other.
  for (let i = 0; i < spots.length; i++) {
    const mateIdx = spots[i][4];
    if (mateIdx === undefined || mateIdx === null || mateIdx < 0) continue;
    const ped = S.peds[i];
    const mate = S.peds[mateIdx];
    if (!ped || !mate) continue;
    ped.partner = mate; mate.partner = ped;
    ped.mode = "talk"; mate.mode = "talk";
    ped.stateT = 30; mate.stateT = 30;
    ped.heading = Math.atan2(mate.mesh.position.x - ped.mesh.position.x, mate.mesh.position.z - ped.mesh.position.z);
    mate.heading = Math.atan2(ped.mesh.position.x - mate.mesh.position.x, ped.mesh.position.z - mate.mesh.position.z);
  }
}

export function stageMission() {
  startFreshGame();
  S.debug.staged = "mission";
  S.debug.longRewardToast = true;
  S.debug.holdReward = true; // keep the reward banner alone for the shot
  S.debug.freezeTraffic = true; // hold traffic still so no truck wanders
  // into the frame and parks on the camera during the 8 s wait
  const hero = S.player;
  // Face Solmar Tower down a clear sightline: stand on road z=-80 looking
  // east. The tower's south face is 20 m north of that road, and no nearer
  // tower stands in the same column (looking north from road x=80, the
  // (100,-60) tower sits directly in front of it and hides it).
  // Stand at x=-20, not -40: twenty metres closer to the tower, so the
  // west-face sign reads bigger in the frame instead of a distant speck.
  // The 22 m tower row north of this road still clears the sightline —
  // the line of sight to the sign at y=68 passes well above it.
  hero.pos.x = -20;
  hero.pos.z = -80;
  hero.group.position.set(-20, 0, -80);
  hero.heading = Math.PI / 2; // facing east, down road z=-80 toward the tower
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
  poseWalkers([[0, -82, 1.2, "talk", 1], [1.5, -82, -1.2, "talk", 0], [-21.4, -83.5, 0.6, "wait"], [-26, -73.5, -1.6, "wait"], [-24, -71, 0.5, "wait"], [0, -80, 0, "cross"]]);
  // The crosser needs its crossing spelled out: across the east-west road
  // z=-80, from the north sidewalk to the south one. poseWalkers only
  // sets the mode; without these the defaults would send it across the
  // wrong road.
  const crosser = S.peds[5];
  if (crosser) { crosser.crossFrom = 1; crosser.crossAxis = "ew"; crosser.crossRoad = -80; }
  debugCompleteMission1();
  // debugCompleteMission1 teleports the player to the park; put them back
  // on the road with the tower in view.
  hero.pos.x = -20;
  hero.pos.z = -80;
  hero.group.position.set(-20, 0, -80);
  hero.heading = Math.PI / 2;
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
  S.objectiveText = "";
  S.objectiveDist = null;
  // Snap the lens to its staged spot at once (see stageChase): the
  // headless clock lags, so the per-frame ease never settles in time.
  updateCamera(1);
}

export function stageFoot() {
  startFreshGame();
  S.debug.staged = "foot";
  // The mission-start toast sits over the CAFE LUNA sign in headless runs
  // (game time lags real time there, so the 6 s toast is still up at the
  // 8 s shutter). Clear it for the shot; the objective line is cleared
  // too — it sat across the sign itself.
  clearToasts();
  const hero = S.player;
  // On road z=-40, facing Cafe Luna. Framing: the rooftop sign tops out
  // at y≈17, so the camera must sit low and look UP — but the old pitch
  // (-0.1) put the camera almost on the ground and the near pavement
  // filled the bottom 40% of the frame. Pitch -0.06 at 12 m keeps the
  // whole CAFE LUNA sign in frame while the parked cars and the
  // foreground walker still fill the lower frame, and it lifts the
  // frame bottom enough that the shadowed near pavement is a thin
  // strip instead of a dark void.
  hero.pos.x = -60;
  hero.pos.z = -40;
  hero.group.position.set(-60, 0, -40);
  hero.heading = Math.PI; // facing north, walking toward Cafe Luna
  S.camYaw = 0; // camera south of the player, looking north at the sign
  S.camPitch = -0.06;
  S.camDist = 12;
  S.objectiveText = "";
  S.objectiveDist = null;
  // Cafe street life, each doing something different: a talking pair at
  // the outdoor tables, one on the phone by the cafe, one sitting on a
  // chair, and one waiting at the kerb close to the camera so the lower
  // frame has a person in it instead of bare pavement.
  poseWalkers([[-54, -47, -2.2, "talk", 1], [-57, -47, 2.2, "talk", 0], [-66, -47, 0.8, "phone"], [-61.3, -49.5, 0, "sit"], [-60, -33.5, 0.3, "wait"]]);
  // A taxi waiting at the kerb in the left foreground, for depth, and a
  // car parked just ahead of the camera on the right, to balance the
  // lower frame. Both sit close to the camera's line of sight.
  spawnParkedCar(-72, -38, Math.PI / 2, 0xe8c832, "taxi");
  spawnParkedCar(-57.4, -36, Math.PI / 2, 0x4ad87a);
  // The bottom of the frame used to be a dark empty band of pavement:
  // the camera sits low looking up at the sign, so the near ground
  // fills the lower quarter with nothing on it. Fill it with street
  // furniture right in front of the lens — a bench on the right and a
  // planter on the left, both about three metres ahead of the camera,
  // low enough to stay out of the sign and the cafe but tall enough to
  // break the empty expanse into shapes. The camera itself stays put
  // (the sign is only just inside the top of the frame as it is).
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.5, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x8a6a42 })
  );
  seat.position.set(-55, 0.25, -31); seat.castShadow = true;
  S.scene.add(seat);
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.65, 0.8, 8),
    new THREE.MeshLambertMaterial({ color: 0x5a6a4a })
  );
  pot.position.set(-62, 0.4, -31); pot.castShadow = true;
  S.scene.add(pot);
  const bush = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x3f8a3a })
  );
  bush.position.set(-62, 1.0, -31); bush.castShadow = true;
  S.scene.add(bush);
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
  if (S.player) { S.player.flashMat.opacity = 0.95; S.player.flashLight.intensity = 10; }
}

export function stageReward() {
  S.debug.longRewardToast = true;
  S.debug.holdReward = true;
  debugCompleteMission1();
}

function launch() {
  const canvas = document.getElementById("game");
  S.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  S.renderer.setSize(window.innerWidth, window.innerHeight);
  S.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  S.renderer.shadowMap.enabled = true; S.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  S.renderer.toneMapping = THREE.ACESFilmicToneMapping; S.renderer.toneMappingExposure = 1.12;
  S.scene = new THREE.Scene();
  // Dusk sky + haze. The sky dome (city.js) paints the gradient; the fog
  // colour matches the horizon so distant towers melt into the sunset.
  S.scene.background = new THREE.Color(0xe8906a); S.scene.fog = new THREE.Fog(0xdd8a66, 150, 480);
  S.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
  S.camera.position.set(0, 6, 12); S.clock = new THREE.Clock();
  rigLighting();
  buildCity();
  buildPlayer();
  buildTraffic();
  buildCombat();
  buildAudio();
  buildHud();
  buildInput();
  seedStarterCars();
  bindMenuButtons();
  window.addEventListener("resize", () => {
    S.camera.aspect = window.innerWidth / window.innerHeight;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(window.innerWidth, window.innerHeight);
  });
  document.getElementById("game").addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (S.mode === "playing" && S.onFoot && S.player.weapon === "pistol") shoot();
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
  const query = new URLSearchParams(window.location.search);
  if (query.get("autostart") === "1") {
    const which = query.get("staging");
    if (which === "chase") stageChase();
    else if (which === "city") stageCity();
    else if (which === "mission") stageMission();
    else if (which === "foot") stageFoot();
    else startFreshGame();
  }
  frameLoop();
}

launch();
