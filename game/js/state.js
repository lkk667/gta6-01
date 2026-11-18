// Solmar City — shared state, constants and helpers.
// Every module reads and writes this one object, so the whole game
// agrees on cash, health, ammo, wanted heat and the current mission.

export const VERSION = '2.0.0-solmar';

// World layout: a road grid, blocks between the roads, a beach on the
// south edge and the ocean beyond it. All units are metres-ish.
export const WORLD = {
  half: 190, // playable area runs -190..190 on both axes
  roadGap: 40, // roads sit on multiples of 40
  roadHalf: 6, // half-width of a road
  beachZ: 168, // sand starts here
  oceanZ: 196, // water starts here
  topSpeed: 34, // units per second, about 122 km/h
  walkSpeed: 6,
  runSpeed: 10.5,
};

// Roads run on these lines (both axes).
export const ROAD_LINES = [-160, -120, -80, -40, 0, 40, 80, 120, 160];

// Fixed landmark blocks, by block centre (blocks sit between roads).
export const LANDMARKS = {
  solmarTower: { x: -60, z: -60 },
  cafeLuna: { x: 60, z: 20 },
  hideout: { x: -140, z: 140 },
  harbor: { x: 140, z: 176 },
  hospital: { x: -100, z: 60 },
  parkA: { x: 20, z: -60 },
  parkB: { x: -20, z: 100 },
  carParkA: { x: 100, z: -100 },
  carParkB: { x: -60, z: -140 },
};

// Small helpers -------------------------------------------------------------
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const angleLerp = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
export const fmtCash = (n) => '$' + Math.round(n).toLocaleString('en-US');

/** Deterministic random, so the city looks the same on every load. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wanted stars from heat: 0 heat is clean, 20 heat is 2 stars, 100 is 5. */
export function starsFromHeat(heat) {
  if (heat <= 0) return 0;
  if (heat < 20) return 1;
  if (heat < 40) return 2;
  if (heat < 60) return 3;
  if (heat < 80) return 4;
  return 5;
}

/** The one shared game state. Modules mutate its fields directly. */
export const S = {
  version: VERSION,
  mode: 'menu', // 'menu' | 'playing' | 'busted'
  time: 0,
  cash: 0,
  health: 100,
  maxHealth: 100,
  magazine: 12,
  magSize: 12,
  reserve: 60,
  weapon: 'pistol', // 'pistol' | 'fist'
  wantedHeat: 0,
  stars: 0,
  lastHeatGain: -100,
  missionsCompleted: 0,
  missionIndex: -1,
  mission: null, // active mission runtime object
  missionStage: 0,
  objective: 'Welcome to Solmar City',
  objectiveDist: 0,
  speedKmh: 0,
  onFoot: true,
  busted: false,
  bustedTimer: 0,
  muted: false,
  // Player / driving
  player: null, // set by player.js: { pos, heading, speed, ... }
  car: null, // the car the player is driving, or null
  stolenCar: false,
  // World entities, filled by their modules
  colliders: [], // { minX, maxX, minZ, maxZ }
  trafficCars: [],
  peds: [],
  cruisers: [],
  pickups: [],
  drops: [], // mission 4 collectibles
  // Toasts: { text, until, big }
  toasts: [],
  // Camera shake: { t, mag }
  shake: { t: 0, mag: 0 },
  // Staging / debug helpers
  debug: {
    holdFlashUntil: 0,
    autoDrive: false,
    staged: null,
    longRewardToast: false,
  },
  // Live hooks filled in by main.js
  hooks: {},
};

export function addHeat(n) {
  S.wantedHeat = clamp(S.wantedHeat + n, 0, 100);
  S.stars = starsFromHeat(S.wantedHeat);
  if (n > 0) S.lastHeatGain = S.time;
}

export function setHeat(n) {
  S.wantedHeat = clamp(n, 0, 100);
  S.stars = starsFromHeat(S.wantedHeat);
  if (n > 0) S.lastHeatGain = S.time;
}

export function addCash(n) {
  S.cash += n;
  return S.cash;
}

/** Show a toast line. `seconds` defaults to 4; toasts fade on their own. */
export function toast(text, seconds = 4, big = false) {
  S.toasts.push({ text, until: S.time + seconds, big });
  if (S.toasts.length > 4) S.toasts.shift();
}

export function addShake(mag, dur = 0.25) {
  S.shake.mag = Math.max(S.shake.mag, mag);
  S.shake.t = Math.max(S.shake.t, dur);
}
