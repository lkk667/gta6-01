// Solmar City — shared state.
// One mutable world object every system reads and writes. No network, no
// imports from other game modules: this file stands alone.

export const WORLD = {
  size: 380,
  half: 190,
  roadGap: 40,
  roads: [-160, -120, -80, -40, 0, 40, 80, 120, 160],
  playerTopSpeed: 34, // units per second on the road
  cruiserBaseSpeed: 32, // cruisers keep pace with (and can catch) the player
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
  // run state
  mode: 'menu', // 'menu' | 'playing' | 'busted'
  time: 0,
  version: 4,
  saveLoaded: false,
  // player stats
  cash: 0,
  health: 100,
  maxHealth: 100,
  magazine: 12,
  magSize: 12,
  reserve: 60,
  heat: 0, // 0..100, maps to 0..5 stars
  // mission progress
  missionsCompleted: 0,
  missionIndex: 0,
  missionStage: 0, // per-mission sub-stage (e.g. 0 = steal a car, 1 = drive to garage)
  objectiveText: '',
  objectiveDist: null, // metres to the current target, null = show no distance
  // movement
  onFoot: true,
  speedKmh: 0,
  bustTimer: 0,
  bustedAt: null,
  // three.js handles, filled in by main.js / builders
  scene: null,
  camera: null,
  renderer: null,
  clock: null,
  player: null, // { group, body, head, gun, flash, pos: {x,z}, heading, speed, ... }
  cars: [], // parked + stolen drivable cars (vehicles.js records)
  trafficCars: [],
  peds: [],
  cruisers: [],
  pickups: [],
  colliders: [], // { x, z, r } circles the player and cars must not enter
  beacon: null, // { group, ring, pillar, gem, target: {x,z} }
  // ui + input
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
  debug: { longRewardToast: false, holdFlash: false, staged: null },
};

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

export function addHeat(amount) {
  S.heat = Math.max(0, Math.min(100, S.heat + amount));
}

export function clearToasts() {
  S.toasts.length = 0;
}

// Push a banner. `life` seconds, default 5. Oldest banners drop past 4.
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

// Deterministic PRNG so the city layout is stable between runs.
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

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.hypot(dx, dz);
}

// Nearest road coordinate to a value (roads every 40 units).
export function nearestRoad(v) {
  return Math.round(v / WORLD.roadGap) * WORLD.roadGap;
}
