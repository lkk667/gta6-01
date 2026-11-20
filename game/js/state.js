// Solmar City — shared world state.
// One plain object every system reads and writes. It holds the run, the
// player's stats, the mission progress, the live handles, and the UI
// queues. It imports nothing from the other game modules, so nothing can
// tangle: every other file imports from here, never the reverse.

export const WORLD = {
  size: 380,
  half: 190,
  roadGap: 40,
  roads: [-160, -120, -80, -40, 0, 40, 80, 120, 160],
  playerTopSpeed: 34, // metres per second on the road
  cruiserBaseSpeed: 32, // cruisers keep pace with the player and can catch them
  cruiserPerStar: 1.5,
};

export const LANDMARKS = {
  hideout: { x: -120, z: 120, label: 'the Hideout' },
  marinaPark: { x: 40, z: 40, label: 'Marina Park' },
  cafeLuna: { x: -40, z: -40, label: 'Cafe Luna' },
  solmarTower: { x: 80, z: -120, label: 'Solmar Tower' },
  harbor: { x: 0, z: 168, label: 'Solmar Harbor' },
  hospital: { x: 120, z: -40, label: 'Solmar General' },
  plaza: { x: 0, z: 0, label: 'Marina Plaza' },
};

export const S = {
  // Run.
  mode: 'menu', // 'menu' | 'playing' | 'busted'
  time: 0,
  version: 4,
  saveLoaded: false,
  freeRoam: false,
  // Player stats.
  cash: 0,
  health: 100,
  maxHealth: 100,
  magazine: 12,
  magSize: 12,
  reserve: 60,
  heat: 0, // 0..100, maps onto 0..5 wanted stars
  // Missions.
  missionsCompleted: 0,
  missionIndex: 0,
  missionStage: 0, // sub-stage inside the current mission
  objectiveText: '',
  objectiveDist: null, // metres to the target, null hides the distance
  // Movement and arrest.
  onFoot: true,
  speedKmh: 0,
  bustTimer: 0,
  bustedAt: null,
  // Three.js handles, filled in by main.js and the builders.
  scene: null,
  camera: null,
  renderer: null,
  clock: null,
  sun: null,
  clouds: [],
  player: null, // { group, torso, head, legL, legR, armL, armR, gun, flashMat, flashLight, pos, heading, speed, walkPhase, weapon, punchTimer, flashTimer }
  currentCar: null, // the car the player is driving, or null on foot
  cars: [], // parked + stolen drivable cars (vehicles.js)
  trafficCars: [], // the 28 moving traffic cars (traffic.js)
  peds: [], // the 40 pedestrians (traffic.js)
  cruisers: [],
  pickups: [],
  colliders: [], // { x, z, r } circles the player and cars must not enter
  benches: [], // { x, z } seats a pedestrian can sit on (city.js fills this)
  trafficLights: null, // [{ x, z, red, yellow, green }] (city.js fills this)
  beacon: null, // { group, ring, ... } the gold mission marker (missions.js)
  // UI and input.
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
  debug: { longRewardToast: false, holdFlash: false, staged: null, holdReward: false, freezeTraffic: false, freezePolice: false, noSpawn: false, pacing: false },
};

// Wanted stars from heat: 0 below 1, then a star at each cut.
const STAR_CUTS = [20, 40, 60, 85];

export function starsFromHeat(heat) {
  if (heat <= 0) return 0;
  let stars = 1;
  for (const cut of STAR_CUTS) {
    if (heat >= cut) stars++;
    else break;
  }
  return stars;
}

// Heat stays inside 0..100 no matter how much is added or removed.
export function addHeat(amount) {
  S.heat = Math.max(0, Math.min(100, S.heat + amount));
}

export function clearToasts() {
  S.toasts.length = 0;
}

// A banner on the HUD. `life` seconds, default 5. Past four, the oldest drops.
export function toast(text, sub, life) {
  const entry = {
    id: ++S.toastSeq,
    text,
    sub: sub || '',
    until: S.time + (life === undefined ? 5 : life),
  };
  S.toasts.push(entry);
  while (S.toasts.length > 4) S.toasts.shift();
  return entry;
}

// Deterministic PRNG: the same seed paints the same city on every run.
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mix = Math.imul(state ^ (state >>> 15), 1 | state);
    mix = (mix + Math.imul(mix ^ (mix >>> 7), 61 | mix)) ^ mix;
    return ((mix ^ (mix >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Straight-line distance on the ground plane. (Named dist2 for history;
// it returns real metres, not a squared distance.)
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.hypot(dx, dz);
}

// Nearest road coordinate to a value. Roads run every 40 units.
export function nearestRoad(v) {
  return Math.round(v / WORLD.roadGap) * WORLD.roadGap;
}
