// Solmar City — HUD + minimap.
// Reads S every frame and paints the DOM: wanted stars, cash, objective
// with distance, health bar, ammo, speedometer (driving only), crosshair
// (on foot with the pistol), toasts, and a live 150x150 canvas minimap
// with roads, blocks, ocean, the player arrow, the mission beacon and
// flashing police dots. All DOM lookups happen once in buildHud; each
// renderer caches its last value so the DOM is only touched on change.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, starsFromHeat } from './state.js';

let ui = null;
let mapG = null;
let prevStars = -1;
let prevCash = -1;
let prevObjective = '';
let prevHealth = -1;
let prevAmmo = '';
let prevSpeed = '';

export function buildHud() {
  ui = {
    stars: document.getElementById('stars'),
    cash: document.getElementById('cash'),
    objective: document.getElementById('objective'),
    healthBar: document.getElementById('health-bar'),
    healthText: document.getElementById('health-text'),
    ammoCount: document.getElementById('ammo-count'),
    speed: document.getElementById('speed'),
    toasts: document.getElementById('toasts'),
    crosshair: document.getElementById('crosshair'),
    minimap: document.getElementById('minimap'),
  };
  if (ui.minimap) mapG = ui.minimap.getContext('2d');
}

function drawStars() {
  const n = starsFromHeat(S.heat);
  if (n === prevStars || !ui.stars) return;
  prevStars = n;
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += '<span class="star ' + (i < n ? 'lit' : 'dim') + '">★</span>';
  }
  ui.stars.innerHTML = html;
}

function drawCash() {
  if (S.cash === prevCash || !ui.cash) return;
  prevCash = S.cash;
  ui.cash.textContent = '$' + S.cash;
}

function drawObjective() {
  if (!ui.objective) return;
  let text = S.objectiveText || '';
  // The distance only rides along when there is an objective to attach it
  // to; a cleared objective (a staged shot) shows nothing, not a lone
  // "— 171 m" pill floating over the scene.
  if (text && S.objectiveDist != null) text += ' — ' + Math.round(S.objectiveDist) + ' m';
  if (text === prevObjective) return;
  prevObjective = text;
  ui.objective.textContent = text;
}

function drawHealth() {
  const hp = Math.max(0, Math.round(S.health));
  if (hp === prevHealth) return;
  prevHealth = hp;
  if (ui.healthBar) ui.healthBar.style.width = hp + '%';
  if (ui.healthText) ui.healthText.textContent = String(hp);
}

function drawAmmo() {
  const text = S.magazine + ' / ' + S.reserve;
  if (text === prevAmmo) return;
  prevAmmo = text;
  if (ui.ammoCount) ui.ammoCount.textContent = text;
}

function drawSpeed() {
  if (!ui.speed) return;
  // The speedometer only exists while driving; on foot it is hidden so it
  // never shows a stale 0 km/h under the character.
  if (S.onFoot) {
    if (prevSpeed !== 'hidden') {
      prevSpeed = 'hidden';
      ui.speed.style.display = 'none';
    }
    return;
  }
  const text = Math.round(S.speedKmh || 0) + ' km/h';
  if (text === prevSpeed) return;
  prevSpeed = text;
  ui.speed.style.display = 'block';
  ui.speed.textContent = text;
}

function drawCrosshair() {
  if (!ui.crosshair) return;
  const show = S.mode === 'playing' && S.onFoot && S.player && S.player.weapon === 'pistol';
  ui.crosshair.style.display = show ? 'block' : 'none';
}

function drawToasts() {
  if (!ui.toasts) return;
  // Expire toasts whose time is up, unless the staging harness asked the
  // reward banner to be held for the screenshot.
  const alive = [];
  for (const t of S.toasts) {
    if (t.until != null && S.time > t.until && !S.debug.holdReward) continue;
    alive.push(t);
  }
  if (alive.length !== S.toasts.length) S.toasts.length = 0, S.toasts.push(...alive);
  let html = '';
  for (const t of S.toasts) {
    html += '<div class="toast"><b>' + t.text + '</b>' + (t.sub ? '<span>' + t.sub + '</span>' : '') + '</div>';
  }
  if (ui.toasts._last !== html) {
    ui.toasts._last = html;
    ui.toasts.innerHTML = html;
  }
}

// Map world (x,z) in [-190,190] onto the 150x150 minimap canvas.
function toMapX(x) { return ((x + WORLD.half) / (WORLD.half * 2)) * 150; }
function toMapY(z) { return ((z + WORLD.half) / (WORLD.half * 2)) * 150; }

function paintMinimap() {
  if (!mapG) return;
  const g = mapG;
  // Land + ocean. The south strip (z > 170) is the beach and the sea.
  g.fillStyle = '#101418';
  g.fillRect(0, 0, 150, 150);
  g.fillStyle = '#1d4a6a';
  g.fillRect(0, toMapY(170), 150, 150 - toMapY(170));
  // City blocks in four muted dusk colours, so the map reads as streets
  // rather than a blank grid.
  const blockPalette = ['#2a2f3a', '#33302e', '#2e3330', '#352e33'];
  let bi = 0;
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      const bx = rx + 20, bz = rz + 20;
      if (bz >= 150) continue;
      g.fillStyle = blockPalette[bi++ % blockPalette.length];
      g.fillRect(toMapX(bx - 15), toMapY(bz - 15), 30 / 380 * 150, 30 / 380 * 150);
    }
  }
  // Roads, thick enough to read at a glance.
  g.strokeStyle = '#6a7078';
  g.lineWidth = 5;
  for (const r of WORLD.roads) {
    g.beginPath(); g.moveTo(toMapX(r), 0); g.lineTo(toMapX(r), 150); g.stroke();
    g.beginPath(); g.moveTo(0, toMapY(r)); g.lineTo(150, toMapY(r)); g.stroke();
  }
  // Mission beacon: a gold dot with a glow ring.
  if (S.beacon && S.beacon.position) {
    const bx = toMapX(S.beacon.position.x);
    const by = toMapY(S.beacon.position.z);
    g.fillStyle = 'rgba(255, 217, 74, 0.35)';
    g.beginPath(); g.arc(bx, by, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd94a';
    g.beginPath(); g.arc(bx, by, 3.5, 0, Math.PI * 2); g.fill();
  }
  // Police cruisers: flashing red/blue dots with a white ring.
  const redPhase = Math.floor(S.time * 3) % 2 === 0;
  for (const c of S.cruisers || []) {
    const cx = toMapX(c.mesh.position.x);
    const cy = toMapY(c.mesh.position.z);
    g.fillStyle = redPhase ? '#ff2a2a' : '#2a7aff';
    g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, 4.5, 0, Math.PI * 2); g.stroke();
  }
  // The player: a gold arrow pointing along the heading.
  if (S.player) {
    const px = toMapX(S.player.pos.x);
    const py = toMapY(S.player.pos.z);
    const hd = S.player.heading || 0;
    g.save();
    g.translate(px, py);
    // Canvas y is down and z is south, so the heading rotates clockwise
    // from north: angle = PI - heading maps the world facing onto canvas.
    g.rotate(Math.PI - hd);
    g.fillStyle = '#ffd94a';
    g.beginPath();
    g.moveTo(0, -6); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath();
    g.fill();
    g.restore();
  }
  // Compass north at the top centre.
  g.fillStyle = '#ffd94a';
  g.font = 'bold 11px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('N', 75, 12);
}

export function updateHud() {
  if (!ui) return;
  drawStars();
  drawCash();
  drawObjective();
  drawHealth();
  drawAmmo();
  drawSpeed();
  drawCrosshair();
  drawToasts();
  paintMinimap();
}
