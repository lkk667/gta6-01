// Solmar City — the shared world.
// One plain object that every system reads and writes: the run, the
// player numbers, the mission progress, the live Three.js handles and the
// UI queues. It depends on no other game module, so the dependency arrow
// always points inward: the rest of the game imports from here.

function makeLandmark(x, z, label) {
  return { x, z, label };
} // end of makeLandmark()

// City geometry and driving numbers.
export const WORLD = {
  size: 380, half: 190, roadGap: 40,
  roads: [-160, -120, -80, -40, 0, 40, 80, 120, 160],
  // Top road speed in metres per second.
  playerTopSpeed: 34,
  // Cruisers can keep up with the player and catch them.
  cruiserBaseSpeed: 32,
  cruiserPerStar: 1.5,
};

// Named places the missions and the minimap refer to.
export const LANDMARKS = {
  hideout: makeLandmark(-120, 120, 'the Hideout'),
  marinaPark: makeLandmark(40, 40, 'Marina Park'),
  cafeLuna: makeLandmark(-40, -40, 'Cafe Luna'),
  solmarTower: makeLandmark(80, -120, 'Solmar Tower'),
  harbor: makeLandmark(0, 168, 'Solmar Harbor'),
  hospital: makeLandmark(120, -40, 'Solmar General'),
  plaza: makeLandmark(0, 0, 'Marina Plaza'),
};

const DEBUG_FLAGS = {
  longRewardToast: false,
  holdFlash: false,
  staged: null,
  holdReward: false,
  freezeTraffic: false,
  freezePolice: false,
  noSpawn: false,
  pacing: false,
};

export const S = {
  // Run state. mode is 'menu', 'playing' or 'busted'.
  mode: 'menu', time: 0, version: 4, saveLoaded: false, freeRoam: false,
  // Player numbers.
  cash: 0, health: 100, maxHealth: 100, magazine: 12, magSize: 12, reserve: 60,
  // Wanted heat, 0..100, driving 0..5 stars.
  heat: 0,
  // Campaign progress.
  missionsCompleted: 0, missionIndex: 0,
  // Sub-stage inside the current job.
  missionStage: 0,
  objectiveText: '',
  // Metres to the target; null hides the distance pill.
  objectiveDist: null,
  // On foot vs driving, and the arrest clock.
  onFoot: true, speedKmh: 0, bustTimer: 0, bustedAt: null,
  // Three.js handles, filled in by main.js and the builders.
  scene: null,
  camera: null,
  renderer: null,
  clock: null,
  sun: null,
  clouds: [],
  // The player rig: group, torso, head, legL, legR, armL, armR, gun,
  // flashMat, flashLight, pos, heading, speed, walkPhase, weapon,
  // punchTimer, flashTimer.
  player: null,
  // The car being driven, or null while on foot.
  currentCar: null,
  // Parked and stolen drivable cars (vehicles.js).
  cars: [],
  // The 28 moving traffic cars (traffic.js).
  trafficCars: [],
  // The 40 pedestrians (traffic.js).
  peds: [],
  cruisers: [],
  pickups: [],
  // Circles { x, z, r } the player and cars must not enter.
  colliders: [],
  // Seats { x, z } a pedestrian can sit on (city.js fills this).
  benches: [],
  // Traffic lights [{ x, z, red, yellow, green }] (city.js fills this).
  trafficLights: null,
  // The gold mission marker { group, ring, ... } (missions.js).
  beacon: null,
  // UI and input queues.
  toasts: [],
  toastSeq: 0,
  keys: {},
  mouseDX: 0,
  mouseDY: 0,
  camYaw: Math.PI * 0.75,
  camPitch: 0.32,
  camDist: 9.5,
  pointerLocked: false,
  dragOrbit: false,
  muted: false,
  audio: null,
  debug: DEBUG_FLAGS,
};

// Wanted stars from heat: none below 1, then one more at each cut.
const STAR_CUTS = [20, 40, 60, 85];

export function starsFromHeat(heatValue) {
  if (heatValue <= 0) return 0;
  let count = 1;
  for (let i = 0; i < STAR_CUTS.length; i++) {
    if (heatValue < STAR_CUTS[i]) break;
    count += 1;
  }
  return count;
}

// Clamp heat into 0..100 however much is added or removed.
export function addHeat(delta) {
  S.heat = clamp(S.heat + delta, 0, 100);
} // end of addHeat()

export function clearToasts() {
  S.toasts.length = 0;
} // end of clearToasts()

// Show a HUD banner for `seconds` (5 by default). Past four banners
// the oldest one drops off.
export function toast(title, detail, seconds) {
  const entry = {
    id: ++S.toastSeq,
    text: title,
    sub: detail || '',
    until: S.time + (seconds === undefined ? 5 : seconds),
  };
  S.toasts.push(entry);
  while (S.toasts.length > 4) S.toasts.shift();
  return entry;
} // end of toast()

// Seeded PRNG: one seed paints the same city on every run.
export function mulberry32(seedValue) {
  let seedState = seedValue >>> 0;
  return function () {
    seedState |= 0;
    seedState = (seedState + 0x6d2b79f5) | 0;
    let hashed = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    hashed = (hashed + Math.imul(hashed ^ (hashed >>> 7), 61 | hashed)) ^ hashed;
    return ((hashed ^ (hashed >>> 14)) >>> 0) / 4294967296;
  };
} // end of mulberry32()

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
} // end of clamp()

// Ground-plane distance in real metres. (The old name says dist2, but the
// value is a plain distance, not a squared one.)
export function dist2(fromX, fromZ, toX, toZ) {
  return Math.hypot(fromX - toX, fromZ - toZ);
} // end of dist2()

// Snap a coordinate to the nearest road line; roads repeat every 40 units.
export function nearestRoad(coord) {
  return Math.round(coord / WORLD.roadGap) * WORLD.roadGap;
} // end of nearestRoad()
