// Solmar City — shared game state.
// One mutable state object every system reads and writes, so the city, the
// player, the traffic, the police and the missions always agree about the
// world. Nothing here touches the DOM or the renderer.

export const WORLD = {
  halfSize: 230, // playable city square, x and z in [-230, 230]
  beachZ: 208, // sand starts here; the ocean lies beyond it
  oceanZ: 226,
};

export const STREETS = [-186, -124, -62, 0, 62, 124, 186];

export const state = {
  mode: 'menu', // 'menu' | 'playing' | 'paused' | 'busted' | 'wasted' | 'done'
  time: 0,
  cash: 0,
  health: 100,
  maxHealth: 100,
  ammo: 48, // reserve pistol rounds
  magazine: 12, // rounds in the pistol right now
  magazineSize: 12,
  wantedHeat: 0, // 0..100; stars are derived from this
  missionsCompleted: 0,
  missionIndex: 0, // next mission to play
  freeRoam: false, // true after the final mission
  carsStolen: 0,
  pedestriansHit: 0,
  shotsFired: 0,

  // The player, on foot or behind a wheel.
  player: {
    x: 0,
    z: 24,
    heading: Math.PI, // facing south, toward the beach plaza
    speed: 0,
    onFoot: true,
    inCar: null, // the driven car object, or null
    moving: false,
    running: false,
    punching: 0, // punch animation timer
    shooting: 0, // muzzle-flash timer
    bustedTimer: 0, // how long a police car has held the player
    invulnerable: 0,
  },

  // Third-person camera orbit, driven by the mouse.
  camera: { yaw: Math.PI, pitch: 0.32, distance: 9, shake: 0 },

  // The active mission objective, shown on the HUD.
  objective: 'Start a mission at the gold marker.',
  objectiveDistance: 0,
  missionTarget: null, // { x, z } world position of the gold marker, or null
  missionTimer: 0, // seconds left on a timed stage, 0 = untimed
  missionMessage: '',

  // Short-lived toast text on the HUD.
  toast: '',
  toastTimer: 0,
};

export function wantedStars() {
  if (state.wantedHeat <= 0) return 0;
  return Math.min(5, Math.ceil(state.wantedHeat / 20));
}

export function addWanted(amount) {
  state.wantedHeat = Math.max(0, Math.min(100, state.wantedHeat + amount));
}

export function addCash(amount) {
  state.cash += amount;
}

export function setToast(text, seconds = 3) {
  state.toast = text;
  state.toastTimer = seconds;
}

// Deterministic pseudo-random helper so the city layout is the same every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function distance2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
