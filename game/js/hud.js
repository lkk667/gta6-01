// Solmar City — HUD and minimap.
// Reads S every frame and paints the DOM: wanted stars, cash, objective
// with distance, health bar, ammo, speedometer (driving only), crosshair
// (on foot with the pistol), toasts, and a live 150x150 canvas minimap
// with roads, blocks, ocean, the player arrow, the mission beacon and
// flashing police dots. All DOM lookups happen once in buildHud; each
// painter caches its last value so the DOM is only touched on change.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, starsFromHeat } from './state.js';

let dom = null;
let mapCtx = null;
let lastStars = -1;
let lastCash = -1;
let lastObjective = '';
let lastHealth = -1;
let lastAmmo = '';
let lastSpeed = '';

const MAP_SIZE = 150;
const MAP_HALF = WORLD.half;

export function buildHud() {
  dom = {
    stars: document.getElementById('stars'),
    cash: document.getElementById('cash'),
    objective: document.getElementById('objective'),
    healthBar: document.getElementById('health-bar'),
    healthText: document.getElementById('health-text'),
    ammoCount: document.getElementById('ammo-count'),
    speed: document.getElementById('speed'),
    speedNum: document.getElementById('speed-num'),
    speedFill: document.getElementById('speed-fill'),
    speedlines: document.getElementById('speedlines'),
    toasts: document.getElementById('toasts'),
    crosshair: document.getElementById('crosshair'),
    minimap: document.getElementById('minimap'),
  };
  if (dom.minimap) mapCtx = dom.minimap.getContext('2d');
} // end of buildHud()

function paintStars() {
  const n = starsFromHeat(S.heat);
  if (n === lastStars || !dom.stars) return;
  lastStars = n;
  const spans = [];
  for (let i = 0; i < 5; i++) {
    spans.push('<span class="star ' + (i < n ? 'lit' : 'dim') + '">★</span>');
  }
  dom.stars.innerHTML = spans.join('');
  // At 4 stars the lit stars breathe red/blue, like the cruisers' bars.
  dom.stars.classList.toggle('hot', n >= 4);
}

function paintCash() {
  if (S.cash === lastCash || !dom.cash) return;
  lastCash = S.cash;
  dom.cash.textContent = '$' + S.cash;
} // end of paintCash()

function paintObjective() {
  if (!dom.objective) return;
  const base = S.objectiveText || '';
  // The distance only rides along when there is an objective to attach
  // it to; a cleared objective (a staged shot) shows nothing, not a lone
  // "— 171 m" pill floating over the scene.
  const suffix = base && S.objectiveDist != null
    ? ' — ' + Math.round(S.objectiveDist) + ' m'
    : '';
  const text = base + suffix;
  // An empty objective hides the pill entirely: no blank dark capsule
  // floating over the scene in a staged shot.
  dom.objective.style.display = text ? '' : 'none';
  if (text === lastObjective) return;
  lastObjective = text;
  dom.objective.textContent = text;
} // end of paintObjective()

function paintHealth() {
  const hp = Math.max(0, Math.round(S.health));
  if (hp === lastHealth) return;
  lastHealth = hp;
  if (dom.healthBar) dom.healthBar.style.width = hp + '%';
  if (dom.healthText) dom.healthText.textContent = String(hp);
} // end of paintHealth()

function paintAmmo() {
  const text = S.magazine + ' / ' + S.reserve;
  if (text === lastAmmo) return;
  lastAmmo = text;
  if (dom.ammoCount) dom.ammoCount.textContent = text;
} // end of paintAmmo()

function paintSpeed() {
  if (!dom.speed) return;
  // The speedometer only exists while driving; on foot it is hidden so
  // it never shows a stale 0 km/h under the character.
  if (S.onFoot) {
    if (lastSpeed !== 'hidden') {
      lastSpeed = 'hidden';
      dom.speed.style.display = 'none';
      if (dom.speedlines) dom.speedlines.style.opacity = '0';
    }
    return;
  }
  const kmh = Math.round(S.speedKmh || 0);
  const text = kmh + ' km/h';
  if (text === lastSpeed) return;
  lastSpeed = text;
  dom.speed.style.display = 'block';
  if (dom.speedNum) dom.speedNum.textContent = String(kmh);
  else dom.speed.textContent = text;
  // The rev bar fills with speed and shifts cyan -> pink -> orange-red.
  const frac = Math.min(1, kmh / 122);
  if (dom.speedFill) {
    dom.speedFill.style.width = Math.round(frac * 100) + '%';
    dom.speedFill.style.background = frac < 0.4 ? '#2ad8ff' : frac < 0.75 ? '#ff5a9a' : '#ff4a2a';
  }
  // Past 100 km/h the edge speed lines fade in, never blocking the view.
  if (dom.speedlines) dom.speedlines.style.opacity = kmh >= 100 ? '0.12' : '0';
}

function paintCrosshair() {
  if (!dom.crosshair) return;
  const show = S.mode === 'playing' && S.onFoot && S.player && S.player.weapon === 'pistol';
  dom.crosshair.style.display = show ? 'block' : 'none';
} // end of paintCrosshair()

function paintToasts() {
  if (!dom.toasts) return;
  // Expire toasts whose time is up, unless the staging harness asked the
  // reward banner to be held for the screenshot.
  const alive = [];
  for (let i = 0; i < S.toasts.length; i++) {
    const t = S.toasts[i];
    if (t.until != null && S.time > t.until && !S.debug.holdReward) continue;
    alive.push(t);
  }
  if (alive.length !== S.toasts.length) {
    S.toasts.length = 0;
    S.toasts.push(...alive);
  }
  const parts = [];
  for (const t of S.toasts) {
    parts.push('<div class="toast"><b>' + t.text + '</b>' + (t.sub ? '<span>' + t.sub + '</span>' : '') + '</div>');
  }
  const html = parts.join('');
  if (dom.toasts._last !== html) {
    dom.toasts._last = html;
    dom.toasts.innerHTML = html;
  }
}

// Map world (x,z) in [-190,190] onto the 150x150 minimap canvas.
function toMapX(x) { return ((x + MAP_HALF) / (MAP_HALF * 2)) * MAP_SIZE; }
function toMapY(z) { return ((z + MAP_HALF) / (MAP_HALF * 2)) * MAP_SIZE; }

// A filled disc on the minimap canvas.
function disc(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
} // end of disc()

// A stroked ring on the minimap canvas.
function ring(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
} // end of ring()

const GOLD = '#ffd94a';

function paintBlocks(g) {
  // City blocks in four muted dusk colours, so the map reads as streets
  // rather than a blank grid.
  const palette = ['#2a2f3a', '#33302e', '#2e3330', '#352e33'];
  let bi = 0;
  for (let i = 0; i < WORLD.roads.length; i++) {
    for (let j = 0; j < WORLD.roads.length; j++) {
      const bx = WORLD.roads[i] + 20;
      const bz = WORLD.roads[j] + 20;
      if (bz >= 150) continue;
      g.fillStyle = palette[bi++ % palette.length];
      g.fillRect(toMapX(bx - 15), toMapY(bz - 15), 30 / 380 * 150, 30 / 380 * 150);
    }
  }
}

function paintRoads(g) {
  // Roads, thick enough to read at a glance.
  g.strokeStyle = '#6a7078';
  g.lineWidth = 5;
  for (const r of WORLD.roads) {
    g.beginPath();
    g.moveTo(toMapX(r), 0);
    g.lineTo(toMapX(r), 150);
    g.stroke();
    g.beginPath();
    g.moveTo(0, toMapY(r));
    g.lineTo(150, toMapY(r));
    g.stroke();
  }
}

function paintBeaconDot(g) {
  // Mission beacon: a gold dot with a glow ring.
  if (!S.beacon || !S.beacon.position) return;
  const bx = toMapX(S.beacon.position.x);
  const by = toMapY(S.beacon.position.z);
  g.fillStyle = 'rgba(255, 217, 74, 0.35)';
  disc(g, bx, by, 7);
  g.fillStyle = GOLD;
  disc(g, bx, by, 3.5);
} // end of paintBeaconDot()

function paintPoliceDots(g) {
  // Police cruisers: flashing red/blue dots with a white ring.
  const redPhase = Math.floor(S.time * 3) % 2 === 0;
  const cruisers = S.cruisers || [];
  for (let i = 0; i < cruisers.length; i++) {
    const c = cruisers[i];
    const cx = toMapX(c.mesh.position.x);
    const cy = toMapY(c.mesh.position.z);
    g.fillStyle = redPhase ? '#ff2a2a' : '#2a7aff';
    disc(g, cx, cy, 3);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    ring(g, cx, cy, 4.5);
  }
}

function paintPlayerArrow(g) {
  // The player: a gold arrow pointing along the heading.
  if (!S.player) return;
  const px = toMapX(S.player.pos.x);
  const py = toMapY(S.player.pos.z);
  const hd = S.player.heading || 0;
  g.save();
  g.translate(px, py);
  // Canvas y is down and z is south, so the heading rotates clockwise
  // from north: angle = PI - heading maps the world facing onto canvas.
  g.rotate(Math.PI - hd);
  g.fillStyle = GOLD;
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(4.5, 5);
  g.lineTo(-4.5, 5);
  g.closePath();
  g.fill();
  g.restore();
} // end of paintPlayerArrow()

function paintMinimap() {
  if (!mapCtx) return;
  const g = mapCtx;
  // Land + ocean. The south strip (z > 170) is the beach and the sea.
  g.fillStyle = '#101418';
  g.fillRect(0, 0, 150, 150);
  g.fillStyle = '#1d4a6a';
  g.fillRect(0, toMapY(170), 150, 150 - toMapY(170));
  paintBlocks(g);
  paintRoads(g);
  paintBeaconDot(g);
  paintPoliceDots(g);
  paintPlayerArrow(g);
  // Compass north at the top centre.
  g.fillStyle = GOLD;
  g.font = 'bold 11px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('N', 75, 12);
} // end of paintMinimap()

export function updateHud() {
  if (!dom) return;
  paintStars();
  paintCash();
  paintObjective();
  paintHealth();
  paintAmmo();
  paintSpeed();
  paintCrosshair();
  paintToasts();
  paintMinimap();
} // end of updateHud()
