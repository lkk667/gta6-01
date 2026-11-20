// Solmar City — HUD + minimap.
// Reads S every frame and paints the DOM: wanted stars, cash, objective
// with distance, health bar, ammo, speedometer (driving only), crosshair
// (on foot with the pistol), toasts, and a live 150x150 canvas minimap
// with roads, blocks, ocean, the player arrow, the mission beacon and
// flashing police dots. All DOM lookups happen once in buildHud.

import * as THREE from '../vendor/three.module.min.js';
import { S, WORLD, LANDMARKS, starsFromHeat } from './state.js';

let els = null;
let mapCtx = null;
let lastStars = -1;
let lastCash = -1;
let lastObjective = '';
let lastHealth = -1;
let lastAmmo = '';
let lastSpeed = '';

export function buildHud() {
  els = {
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
  if (els.minimap) mapCtx = els.minimap.getContext('2d');
}

function renderStars() {
  const n = starsFromHeat(S.heat);
  if (n === lastStars || !els.stars) return;
  lastStars = n;
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += '<span class="star ' + (i < n ? 'lit' : 'dim') + '">★</span>';
  }
  els.stars.innerHTML = html;
}

function renderCash() {
  if (S.cash === lastCash || !els.cash) return;
  lastCash = S.cash;
  els.cash.textContent = '$' + S.cash;
}

function renderObjective() {
  if (!els.objective) return;
  let text = S.objectiveText || '';
  if (S.objectiveDist != null) text += ' — ' + Math.round(S.objectiveDist) + ' m';
  if (text === lastObjective) return;
  lastObjective = text;
  els.objective.textContent = text;
}

function renderHealth() {
  const hp = Math.max(0, Math.round(S.health));
  if (hp === lastHealth) return;
  lastHealth = hp;
  if (els.healthBar) els.healthBar.style.width = hp + '%';
  if (els.healthText) els.healthText.textContent = String(hp);
}

function renderAmmo() {
  const text = S.magazine + ' / ' + S.reserve;
  if (text === lastAmmo) return;
  lastAmmo = text;
  if (els.ammoCount) els.ammoCount.textContent = text;
}

function renderSpeed() {
  if (!els.speed) return;
  // The speedometer only exists while driving; on foot it is hidden so it
  // never shows a stale 0 km/h under the character.
  if (S.onFoot) {
    if (lastSpeed !== 'hidden') {
      lastSpeed = 'hidden';
      els.speed.style.display = 'none';
    }
    return;
  }
  const text = Math.round(S.speedKmh || 0) + ' km/h';
  if (text === lastSpeed) return;
  lastSpeed = text;
  els.speed.style.display = 'block';
  els.speed.textContent = text;
}

function renderCrosshair() {
  if (!els.crosshair) return;
  const show = S.mode === 'playing' && S.onFoot && S.player && S.player.weapon === 'pistol';
  els.crosshair.style.display = show ? 'block' : 'none';
}

function renderToasts() {
  if (!els.toasts) return;
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
  if (els.toasts._last !== html) {
    els.toasts._last = html;
    els.toasts.innerHTML = html;
  }
}

// Map world (x,z) in [-190,190] onto the 150x150 minimap canvas.
function mapX(x) { return ((x + WORLD.half) / (WORLD.half * 2)) * 150; }
function mapY(z) { return ((z + WORLD.half) / (WORLD.half * 2)) * 150; }

function drawMinimap() {
  if (!mapCtx) return;
  const g = mapCtx;
  // Land + ocean. The south strip (z > 170) is the beach and the sea.
  g.fillStyle = '#101418';
  g.fillRect(0, 0, 150, 150);
  g.fillStyle = '#1d4a6a';
  g.fillRect(0, mapY(170), 150, 150 - mapY(170));
  // City blocks in four muted dusk colours, so the map reads as streets
  // rather than a blank grid.
  const blockCols = ['#2a2f3a', '#33302e', '#2e3330', '#352e33'];
  let bi = 0;
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      const bx = rx + 20, bz = rz + 20;
      if (bz >= 150) continue;
      g.fillStyle = blockCols[bi++ % blockCols.length];
      g.fillRect(mapX(bx - 15), mapY(bz - 15), 30 / 380 * 150, 30 / 380 * 150);
    }
  }
  // Roads, thick enough to read at a glance.
  g.strokeStyle = '#6a7078';
  g.lineWidth = 5;
  for (const r of WORLD.roads) {
    g.beginPath(); g.moveTo(mapX(r), 0); g.lineTo(mapX(r), 150); g.stroke();
    g.beginPath(); g.moveTo(0, mapY(r)); g.lineTo(150, mapY(r)); g.stroke();
  }
  // Mission beacon: a gold dot with a glow ring.
  if (S.beacon && S.beacon.position) {
    const bx = mapX(S.beacon.position.x);
    const by = mapY(S.beacon.position.z);
    g.fillStyle = 'rgba(255, 217, 74, 0.35)';
    g.beginPath(); g.arc(bx, by, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd94a';
    g.beginPath(); g.arc(bx, by, 3.5, 0, Math.PI * 2); g.fill();
  }
  // Police cruisers: flashing red/blue dots with a white ring.
  const flashRed = Math.floor(S.time * 3) % 2 === 0;
  for (const c of S.cruisers || []) {
    const cx = mapX(c.mesh.position.x);
    const cy = mapY(c.mesh.position.z);
    g.fillStyle = flashRed ? '#ff2a2a' : '#2a7aff';
    g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, 4.5, 0, Math.PI * 2); g.stroke();
  }
  // The player: a gold arrow pointing along the heading.
  if (S.player) {
    const px = mapX(S.player.pos.x);
    const py = mapY(S.player.pos.z);
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
  if (!els) return;
  renderStars();
  renderCash();
  renderObjective();
  renderHealth();
  renderAmmo();
  renderSpeed();
  renderCrosshair();
  renderToasts();
  drawMinimap();
}
