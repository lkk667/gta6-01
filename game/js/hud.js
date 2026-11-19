// Solmar City — HUD: stars, cash, health, ammo, objective, speed, toasts,
// live minimap (v4 polish). Stars and cash sit on a translucent panel now;
// unlit stars are bright-outlined, lit stars glow gold; health and ammo get
// icons and bigger numbers; the speedometer hides while on foot; minimap
// police dots are big and flash red/blue.

import { S, WORLD, starsFromHeat } from './state.js';

let els = {};
let minimap = null;
let mctx = null;

export function buildHud() {
  els = {
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
  minimap = document.getElementById('minimap');
  mctx = minimap.getContext('2d');
}

function renderStars(n) {
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += `<span class="star ${i < n ? 'lit' : 'dim'}">★</span>`;
  }
  return html;
}

export function updateHud() {
  if (!els.stars) return;
  const stars = starsFromHeat(S.heat);
  els.stars.innerHTML = renderStars(stars);
  els.cash.textContent = '$' + S.cash;
  els.healthBar.style.width = Math.max(0, S.health) + '%';
  els.healthText.textContent = Math.round(S.health);
  els.ammo.textContent = `${S.magazine} / ${S.reserve}`;
  const dist = S.objectiveDist === null || S.objectiveDist === undefined
    ? ''
    : ` — ${Math.round(S.objectiveDist)}m`;
  els.objective.textContent = S.objectiveText + dist;
  // Speedometer only while driving.
  if (S.onFoot) {
    els.speed.style.display = 'none';
  } else {
    els.speed.style.display = 'block';
    els.speed.textContent = `${Math.round(S.speedKmh)} km/h`;
  }
  // Crosshair only on foot with the pistol.
  const showCross = S.mode === 'playing' && S.onFoot && S.player && S.player.weapon === 'pistol';
  els.crosshair.style.display = showCross ? 'block' : 'none';
  // Toasts, newest last.
  const now = S.time;
  S.toasts = S.toasts.filter((t) => t.until > now);
  els.toasts.innerHTML = S.toasts.map((t) =>
    `<div class="toast"><b>${t.text}</b>${t.sub ? `<span>${t.sub}</span>` : ''}</div>`
  ).join('');
  // Busted overlay.
  els.bust.style.display = S.mode === 'busted' ? 'flex' : 'none';
  drawMinimap(stars);
}

function drawMinimap(stars) {
  const g = mctx;
  const W = 150;
  const H = 150;
  const scale = W / (WORLD.size + 40);
  const toMap = (x, z) => [(x + WORLD.half + 20) * scale, (z + WORLD.half + 20) * scale];
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#101418';
  g.fillRect(0, 0, W, H);
  // Ocean + sand at the south edge (deep dusk blue water).
  const [, oceanY] = toMap(0, WORLD.half);
  g.fillStyle = '#2a4a7a';
  g.fillRect(0, oceanY, W, H - oceanY);
  g.fillStyle = '#e8d8a0';
  g.fillRect(0, oceanY - 4, W, 4);
  // City blocks first, then roads over them, so roads read as streets.
  // Blocks get slightly varied dusk colours instead of one flat grey.
  const blockCols = ['#2e3440', '#38343e', '#33302e', '#2e3a40'];
  for (const rx of WORLD.roads) {
    for (const rz of WORLD.roads) {
      const [bx, by] = toMap(rx + 5, rz + 5);
      g.fillStyle = blockCols[Math.abs((rx + rz) / 40) % blockCols.length];
      g.fillRect(bx, by, 30 * scale, 30 * scale);
    }
  }
  g.strokeStyle = '#aab3c3';
  g.lineWidth = 5;
  for (const r of WORLD.roads) {
    const [x1, y1] = toMap(r, -WORLD.half);
    const [x2, y2] = toMap(r, WORLD.half);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    const [ax, ay] = toMap(-WORLD.half, r);
    const [bx, by] = toMap(WORLD.half, r);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  }
  // Compass: the map is north-up, so N sits at the top edge.
  g.font = 'bold 12px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText('N', W / 2, 3);
  g.fillStyle = '#ffffff';
  g.fillText('N', W / 2, 3);
  // Park.
  const [pkx, pky] = toMap(25, 25);
  g.fillStyle = '#4c8a3c';
  g.fillRect(pkx, pky, 30 * scale, 30 * scale);
  // Mission beacon: big pulsing gold dot with a glow halo.
  if (S.beacon && S.beacon.group.visible) {
    const [bx, by] = toMap(S.beacon.target.x, S.beacon.target.z);
    const pulse = 5 + Math.sin(S.time * 4) * 1.5;
    g.save();
    g.shadowColor = '#ffd94a';
    g.shadowBlur = 10;
    g.fillStyle = '#ffd94a';
    g.beginPath(); g.arc(bx, by, pulse, 0, Math.PI * 2); g.fill();
    g.restore();
    g.strokeStyle = '#fff2b8';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(bx, by, pulse + 2.5, 0, Math.PI * 2); g.stroke();
  }
  // Cash drops: green dots.
  if (S.dropSpots) {
    g.fillStyle = '#4ad87a';
    for (const d of S.dropSpots) {
      if (d.taken) continue;
      const [dx, dy] = toMap(d.x, d.z);
      g.beginPath(); g.arc(dx, dy, 3, 0, Math.PI * 2); g.fill();
    }
  }
  // Police cruisers: BIG flashing red/blue dots.
  const flashRed = Math.sin(S.time * 7) > 0;
  for (const c of S.cruisers) {
    const [cx, cy] = toMap(c.mesh.position.x, c.mesh.position.z);
    g.fillStyle = flashRed ? '#ff2a2a' : '#2a6aff';
    g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.stroke();
  }
  // Player arrow.
  const [px, py] = toMap(S.player.pos.x, S.player.pos.z);
  g.save();
  g.translate(px, py);
  g.rotate(S.player.heading);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, -7);
  g.lineTo(5, 6);
  g.lineTo(-5, 6);
  g.closePath();
  g.fill();
  g.restore();
  void stars;
}
