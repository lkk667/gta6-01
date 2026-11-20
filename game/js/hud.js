// Solmar City — HUD: stars, cash, health, ammo, objective, speed, toasts,
// live minimap. Stars and cash sit on a translucent panel now;
// unlit stars are bright-outlined, lit stars glow gold; health and ammo get
// icons and bigger numbers; the speedometer hides while on foot; minimap
// police dots are big and flash red/blue.

import { S, WORLD, starsFromHeat } from './state.js';

let ui = {};
let mapCanvas = null;
let mapCtx = null;

export function buildHud() {
  ui = {
    stars: document.getElementById('stars'),
    cash: document.getElementById('cash'),
    healthBar: document.getElementById('health-bar'),
    healthText: document.getElementById('health-text'),
    ammo: document.getElementById('ammo-count'),
    objective: document.getElementById('objective'),
    speed: document.getElementById('speed'),
    toasts: document.getElementById('toasts'),
    crosshair: document.getElementById('crosshair'),
    hint: document.getElementById('hint'),
    bust: document.getElementById('busted'),
  };
  mapCanvas = document.getElementById('minimap');
  mapCtx = mapCanvas.getContext('2d');
}

function starRow(n) {
  const spans = [];
  for (let i = 0; i < 5; i++) {
    spans.push(`<span class="star ${i < n ? 'lit' : 'dim'}">★</span>`);
  }
  return spans.join('');
}

export function updateHud() {
  if (!ui.stars) return;
  const wanted = starsFromHeat(S.heat);
  ui.stars.innerHTML = starRow(wanted);
  ui.cash.textContent = '$' + S.cash;
  ui.healthBar.style.width = Math.max(0, S.health) + '%';
  ui.healthText.textContent = Math.round(S.health);
  ui.ammo.textContent = `${S.magazine} / ${S.reserve}`;
  const dist = S.objectiveDist === null || S.objectiveDist === undefined
    ? ''
    : ` — ${Math.round(S.objectiveDist)}m`;
  ui.objective.textContent = S.objectiveText + dist;
  // Speedometer only while driving.
  if (S.onFoot) {
    ui.speed.style.display = 'none';
  } else {
    ui.speed.style.display = 'block';
    ui.speed.textContent = `${Math.round(S.speedKmh)} km/h`;
  }
  // Crosshair only on foot with the pistol.
  const showCross = S.mode === 'playing' && S.onFoot && S.player && S.player.weapon === 'pistol';
  ui.crosshair.style.display = showCross ? 'block' : 'none';
  // Toasts, newest last.
  const now = S.time;
  S.toasts = S.toasts.filter((t) => t.until > now);
  let html = '';
  for (const t of S.toasts) {
    html += `<div class="toast"><b>${t.text}</b>${t.sub ? `<span>${t.sub}</span>` : ''}</div>`;
  }
  ui.toasts.innerHTML = html;
  // Busted overlay.
  ui.bust.style.display = S.mode === 'busted' ? 'flex' : 'none';
  drawMinimap(wanted);
}

function drawMinimap(stars) {
  const ctx = mapCtx;
  const size = 150;
  const k = size / (WORLD.size + 40);
  const project = (x, z) => [(x + WORLD.half + 20) * k, (z + WORLD.half + 20) * k];
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, size, size);
  // Ocean + sand at the south edge (deep dusk blue water).
  const [, oceanY] = project(0, WORLD.half);
  ctx.fillStyle = '#2a4a7a';
  ctx.fillRect(0, oceanY, size, size - oceanY);
  ctx.fillStyle = '#e8d8a0';
  ctx.fillRect(0, oceanY - 4, size, 4);
  // City blocks first, then roads over them, so roads read as streets.
  // Blocks get slightly varied dusk colours instead of one flat grey.
  const shades = ['#2e3440', '#38343e', '#33302e', '#2e3a40'];
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      const [bx, by] = project(rx + 5, rz + 5);
      const shade = Math.abs((rx + rz) / 40) % shades.length;
      ctx.fillStyle = shades[shade];
      ctx.fillRect(bx, by, 30 * k, 30 * k);
    }
  }
  ctx.strokeStyle = '#aab3c3';
  ctx.lineWidth = 5;
  for (const r of WORLD.roads) {
    const [x1, y1] = project(r, -WORLD.half);
    const [x2, y2] = project(r, WORLD.half);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const [ax, ay] = project(-WORLD.half, r);
    const [bx, by] = project(WORLD.half, r);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  // Compass: the map is north-up, so N sits at the top edge.
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText('N', size / 2, 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('N', size / 2, 3);
  // Park.
  const [pkx, pky] = project(25, 25);
  ctx.fillStyle = '#4c8a3c';
  ctx.fillRect(pkx, pky, 30 * k, 30 * k);
  // Mission beacon: big pulsing gold dot with a glow halo.
  if (S.beacon && S.beacon.group.visible) {
    const [bx, by] = project(S.beacon.target.x, S.beacon.target.z);
    const pulse = 5 + Math.sin(S.time * 4) * 1.5;
    ctx.save();
    ctx.shadowColor = '#ffd94a';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffd94a';
    ctx.beginPath(); ctx.arc(bx, by, pulse, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#fff2b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(bx, by, pulse + 2.5, 0, Math.PI * 2); ctx.stroke();
  }
  // Cash drops: green dots.
  if (S.dropSpots) {
    ctx.fillStyle = '#4ad87a';
    for (const d of S.dropSpots) {
      if (d.taken) continue;
      const [dx, dy] = project(d.x, d.z);
      ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Police cruisers: BIG flashing red/blue dots.
  const redPhase = Math.sin(S.time * 7) > 0;
  for (const c of S.cruisers) {
    const [cx, cy] = project(c.mesh.position.x, c.mesh.position.z);
    ctx.fillStyle = redPhase ? '#ff2a2a' : '#2a6aff';
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.stroke();
  }
  // Player arrow.
  const [px, py] = project(S.player.pos.x, S.player.pos.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(S.player.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  void stars;
}
