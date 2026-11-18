// Solmar City — the HUD: wanted stars, cash, health, ammo, objective
// with distance, speed in km/h, toasts, the crosshair, and a live
// canvas minimap of the city.

import { S, WORLD, fmtCash } from './state.js';
import { objectiveText } from './missions.js';
import { player } from './player.js';

let els = {};
let mapCtx = null;
let lastToastCount = 0;

export function buildHud() {
  els = {
    hud: document.getElementById('hud'),
    stars: document.getElementById('stars'),
    cash: document.getElementById('cash'),
    healthFill: document.getElementById('health-fill'),
    healthText: document.getElementById('health-text'),
    ammo: document.getElementById('ammo'),
    objective: document.getElementById('objective'),
    speed: document.getElementById('speed'),
    toasts: document.getElementById('toasts'),
    crosshair: document.getElementById('crosshair'),
    hint: document.getElementById('hint'),
    map: document.getElementById('minimap'),
  };
  mapCtx = els.map.getContext('2d');
}

function starRow() {
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += `<span class="star ${i < S.stars ? 'on' : ''}">★</span>`;
  }
  return out;
}

export function updateHud() {
  if (!els.hud) return;
  els.stars.innerHTML = starRow();
  els.cash.textContent = fmtCash(S.cash);
  els.healthFill.style.width = `${Math.max(0, (S.health / S.maxHealth) * 100)}%`;
  els.healthText.textContent = `${Math.round(S.health)}`;
  els.ammo.textContent = S.weapon === 'pistol' ? `${S.magazine} / ${S.reserve}` : 'FISTS';
  els.objective.textContent = objectiveText();
  els.speed.textContent = S.onFoot
    ? `${Math.round(player.speed * 3.6)} km/h`
    : `${Math.round(S.speedKmh)} km/h`;
  els.speed.style.display = S.mode === 'playing' ? 'block' : 'none';

  // Crosshair shows while the pistol is drawn on foot.
  els.crosshair.style.display = S.mode === 'playing' && S.onFoot && S.weapon === 'pistol'
    ? 'block'
    : 'none';

  // Hint bar: different help on foot and in a car.
  els.hint.textContent = S.onFoot
    ? 'WASD move · Shift run · click to lock mouse · move mouse to look · left-click shoot · F punch · R reload'
    : 'WASD drive · Space handbrake · E exit car · click to lock mouse · move mouse to look';
  if (S.mode === 'playing') {
    els.hint.style.display = 'block';
    // Hide the hint a while after the game starts so it does not cover play.
    if (S.time > 25) els.hint.style.opacity = '0.55';
  } else {
    els.hint.style.display = 'none';
  }

  // Toasts: keep only the live ones, fade them out.
  const live = S.toasts.filter((t) => S.time < t.until);
  if (live.length !== S.toasts.length) S.toasts = live;
  if (live.length !== lastToastCount || live.length > 0) {
    els.toasts.innerHTML = live
      .map((t) => `<div class="toast${t.big ? ' big' : ''}">${t.text}</div>`)
      .join('');
    lastToastCount = live.length;
  }

  drawMinimap();
}

function drawMinimap() {
  const ctx = mapCtx;
  if (!ctx) return;
  const W = 180;
  const H = 180;
  const scale = W / (WORLD.half * 2 + 20);
  const toMap = (x, z) => [W / 2 + x * scale, H / 2 + z * scale];
  ctx.clearRect(0, 0, W, H);

  // City base.
  ctx.fillStyle = '#20262c';
  ctx.fillRect(0, 0, W, H);
  // Ocean strip at the bottom.
  const [, oceanY] = toMap(0, WORLD.oceanZ);
  ctx.fillStyle = '#1e7fae';
  ctx.fillRect(0, oceanY, W, H - oceanY);
  // Sand strip.
  const [, beachY] = toMap(0, WORLD.beachZ);
  ctx.fillStyle = '#eed9a4';
  ctx.fillRect(0, beachY, W, oceanY - beachY);
  // Roads.
  ctx.strokeStyle = '#565e66';
  ctx.lineWidth = 2;
  for (let l = -160; l <= 160; l += 40) {
    const [x1] = toMap(l, 0);
    ctx.beginPath();
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, H);
    ctx.stroke();
    const [, y1] = toMap(0, l);
    ctx.beginPath();
    ctx.moveTo(0, y1);
    ctx.lineTo(W, y1);
    ctx.stroke();
  }

  const dot = (x, z, r, color) => {
    const [mx, my] = toMap(x, z);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // Mission drops.
  for (const drop of S.drops || []) {
    if (!drop.taken) dot(drop.x, drop.z, 3, '#7affc8');
  }
  // Traffic cars.
  for (const car of S.trafficCars) {
    dot(car.group.position.x, car.group.position.z, 2, '#9aa4ae');
  }
  // Police cruisers flash red/blue.
  for (const car of S.cruisers) {
    const on = Math.sin(S.time * 6) > 0;
    dot(car.group.position.x, car.group.position.z, 3.5, on ? '#ff3333' : '#3388ff');
  }
  // Mission beacon.
  if (S.mission) {
    const t = S.mission.def.target();
    // Mission 4's target is the drops; use the first untaken one instead.
    if (S.missionIndex === 3) {
      const next = (S.drops || []).find((d) => !d.taken);
      if (next) dot(next.x, next.z, 4, '#ffc832');
    } else if (S.missionIndex === 4 && S.missionStage === 1) {
      dot(-140, 140, 4, '#ffc832');
    } else {
      dot(t.x, t.z, 4, '#ffc832');
    }
  }
  // The player: a white arrow pointing where they face.
  const px = S.car ? S.car.group.position.x : player.pos.x;
  const pz = S.car ? S.car.group.position.z : player.pos.z;
  const heading = S.car ? S.car.heading : player.heading;
  const [mx, my] = toMap(px, pz);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(Math.atan2(Math.sin(heading), Math.cos(heading)) + Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
