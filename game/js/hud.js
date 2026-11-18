// Solmar City — the HUD and the minimap.
// Plain DOM over the canvas: wanted stars, cash, health, ammo, the mission
// objective, speed, toasts and the pause/busted screens. The minimap is a
// 2D canvas drawn every frame: the road grid, the beach, the player arrow,
// traffic, police, pedestrians and the gold mission marker, north-up.

import { state, wantedStars, STREETS } from './state.js';
import { PLACES } from './city.js';

let elements = {};
let minimapCtx = null;

export function initHud() {
  elements = {
    stars: document.getElementById('hud-stars'),
    cash: document.getElementById('hud-cash'),
    healthFill: document.getElementById('hud-health-fill'),
    healthText: document.getElementById('hud-health-text'),
    ammo: document.getElementById('hud-ammo'),
    objective: document.getElementById('hud-objective'),
    objectiveDist: document.getElementById('hud-objective-dist'),
    missionTitle: document.getElementById('hud-mission'),
    speed: document.getElementById('hud-speed'),
    toast: document.getElementById('hud-toast'),
    crosshair: document.getElementById('hud-crosshair'),
    hint: document.getElementById('hud-hint'),
    minimap: document.getElementById('hud-minimap'),
    wantedLabel: document.getElementById('hud-wanted-label'),
  };
  if (elements.minimap) minimapCtx = elements.minimap.getContext('2d');
}

function formatCash(value) {
  return '$' + value.toLocaleString('en-US');
}

export function updateHud(world) {
  if (!elements.stars) return;
  const stars = wantedStars();
  elements.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  elements.stars.style.color = stars > 0 ? '#ffd24a' : 'rgba(255,255,255,0.55)';
  elements.wantedLabel.textContent = stars > 0 ? 'WANTED' : 'CLEAN';
  elements.wantedLabel.style.color = stars > 0 ? '#ff5a4e' : 'rgba(255,255,255,0.55)';
  elements.cash.textContent = formatCash(state.cash);
  elements.healthFill.style.width = Math.max(0, state.health) + '%';
  elements.healthFill.style.background = state.health > 50 ? '#3fae6a' : state.health > 25 ? '#e8a33d' : '#d94f3d';
  elements.healthText.textContent = Math.ceil(state.health) + ' HP';
  elements.ammo.textContent = `🔫 ${state.magazine} / ${state.ammo}`;
  elements.missionTitle.textContent = world.missionTitle || '';
  elements.objective.textContent = state.objective;
  if (state.missionTarget) {
    const dx = state.missionTarget.x - state.player.x;
    const dz = state.missionTarget.z - state.player.z;
    const d = Math.round(Math.sqrt(dx * dx + dz * dz));
    elements.objectiveDist.textContent = `${d}m`;
  } else {
    elements.objectiveDist.textContent = '';
  }
  if (state.player.inCar) {
    elements.speed.textContent = `${Math.round(Math.abs(state.player.inCar.speed) * 3.6)} km/h`;
    elements.speed.style.display = 'block';
  } else {
    elements.speed.style.display = 'none';
  }
  // Crosshair only when the pistol is drawn (aiming on foot).
  const aiming = state.player.onFoot && world.aiming;
  elements.crosshair.style.display = aiming ? 'block' : 'none';
  // Context hint: what E does right now.
  elements.hint.textContent = world.hint || '';
  // Toast.
  if (state.toastTimer > 0) {
    elements.toast.textContent = state.toast;
    elements.toast.style.opacity = '1';
  } else {
    elements.toast.style.opacity = '0';
  }

  drawMinimap(world);
}

function worldToMap(x, z, size) {
  const half = 240;
  return {
    x: ((x + half) / (half * 2)) * size,
    y: ((z + half) / (half * 2)) * size,
  };
}

function drawMinimap(world) {
  if (!minimapCtx || !elements.minimap) return;
  const size = elements.minimap.width;
  const g = minimapCtx;
  g.clearRect(0, 0, size, size);
  // Sea and sand at the bottom (south).
  g.fillStyle = '#1d4e63';
  g.fillRect(0, 0, size, size);
  const beach = worldToMap(0, 208);
  g.fillStyle = '#3f7d5a';
  g.fillRect(0, 0, size, beach.y);
  g.fillStyle = '#eed9a4';
  g.fillRect(0, beach.y, size, size - beach.y);
  // Roads.
  g.strokeStyle = '#3a3f45';
  g.lineWidth = 4;
  for (const s of STREETS) {
    const px = worldToMap(s, 0).x;
    const pz = worldToMap(0, s).y;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, size); g.stroke();
    g.beginPath(); g.moveTo(0, pz); g.lineTo(size, pz); g.stroke();
  }
  // Named places.
  g.fillStyle = '#ffd24a';
  g.font = 'bold 9px sans-serif';
  for (const key of Object.keys(PLACES)) {
    const place = PLACES[key];
    const p = worldToMap(place.x, place.z, size);
    g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  // Mission target: pulsing gold star.
  if (state.missionTarget) {
    const p = worldToMap(state.missionTarget.x, state.missionTarget.z, size);
    const pulse = 4 + Math.sin(state.time * 5) * 2;
    g.fillStyle = '#ffd24a';
    g.beginPath();
    g.arc(p.x, p.y, pulse, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5;
    g.stroke();
  }
  // Traffic (yellow), pedestrians (grey), police (flashing blue/red).
  const dot = (x, z, color, r) => {
    const p = worldToMap(x, z, size);
    g.fillStyle = color;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fill();
  };
  for (const car of world.trafficCars || []) {
    if (car.kind === 'traffic') dot(car.x, car.z, '#e8c84a', 2);
  }
  for (const ped of world.pedestrians || []) {
    if (ped.state !== 'down') dot(ped.x, ped.z, '#cccccc', 1.2);
  }
  for (const car of world.policeCars || []) {
    const flash = Math.floor(state.time * 4) % 2 === 0;
    dot(car.x, car.z, flash ? '#ff2222' : '#2244ff', 3);
  }
  // The player: a white arrow that turns with the heading.
  const pp = worldToMap(state.player.x, state.player.z, size);
  g.save();
  g.translate(pp.x, pp.y);
  g.rotate(Math.atan2(Math.sin(state.player.heading), Math.cos(state.player.heading)) * 0 + state.player.heading);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#222222';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(4.5, 5);
  g.lineTo(0, 2.5);
  g.lineTo(-4.5, 5);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
  // North tick.
  g.fillStyle = '#ffffff';
  g.font = 'bold 10px sans-serif';
  g.fillText('N', size - 12, 12);
}
