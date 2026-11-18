// Solmar City — sound, all synthesized with WebAudio: engine hum, the
// police siren, gunshots, punches, pickups, the mission jingle, crashes
// and the horn. Nothing is loaded from a file.

import { S } from './state.js';

let ctx = null;
let master = null;
let engineOsc = null;
let engineGain = null;
let sirenOscA = null;
let sirenOscB = null;
let sirenGain = null;
let sirenHigh = false;
let sirenTimer = 0;

function ensureCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch (err) {
    ctx = null;
  }
  return ctx;
}

/** Call from the first user gesture; browsers block audio before one. */
export function initAudio() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  startEngine();
  startSiren();
}

function startEngine() {
  if (!ctx || engineOsc) return;
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 55;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(filter);
  filter.connect(engineGain);
  engineGain.connect(master);
  engineOsc.start();
}

function startSiren() {
  if (!ctx || sirenOscA) return;
  sirenOscA = ctx.createOscillator();
  sirenOscA.type = 'sine';
  sirenOscA.frequency.value = 660;
  sirenOscB = ctx.createOscillator();
  sirenOscB.type = 'sine';
  sirenOscB.frequency.value = 880;
  sirenGain = ctx.createGain();
  sirenGain.gain.value = 0;
  sirenOscA.connect(sirenGain);
  sirenOscB.connect(sirenGain);
  sirenGain.connect(master);
  sirenOscA.start();
  sirenOscB.start();
}

function noiseBurst(duration, filterFreq, gainValue) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.value = gainValue;
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start();
}

function blip(freq, duration, type = 'sine', gainValue = 0.25, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainValue, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export const audio = {
  shoot() {
    noiseBurst(0.14, 2400, 0.5);
    blip(160, 0.08, 'square', 0.2);
  },
  emptyClick() {
    blip(1200, 0.05, 'square', 0.12);
  },
  punch() {
    noiseBurst(0.1, 500, 0.4);
    blip(90, 0.12, 'sine', 0.35);
  },
  reload() {
    blip(500, 0.06, 'square', 0.15);
    blip(700, 0.06, 'square', 0.15, 0.09);
  },
  pickup() {
    blip(880, 0.09, 'sine', 0.22);
    blip(1320, 0.12, 'sine', 0.22, 0.08);
  },
  jingle() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => blip(n, 0.22, 'triangle', 0.28, i * 0.11));
  },
  crash(intensity = 1) {
    noiseBurst(0.3, 900, Math.min(0.6, 0.25 * intensity));
    blip(70, 0.25, 'sine', 0.3);
  },
  horn() {
    blip(220, 0.35, 'square', 0.18);
    blip(277, 0.35, 'square', 0.15);
  },
  busted() {
    const notes = [392, 330, 262, 196];
    notes.forEach((n, i) => blip(n, 0.3, 'sawtooth', 0.2, i * 0.16));
  },
};

/** Per-frame: engine pitch follows speed, siren wails while wanted. */
export function updateAudio(dt) {
  if (!ctx || S.muted) {
    if (engineGain) engineGain.gain.value = 0;
    if (sirenGain) sirenGain.gain.value = 0;
    return;
  }
  if (engineGain) {
    const speed = S.car ? Math.abs(S.car.speed) : 0;
    const target = S.car ? 0.05 + (speed / 34) * 0.11 : 0;
    engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
    if (engineOsc) engineOsc.frequency.setTargetAtTime(55 + speed * 4.2, ctx.currentTime, 0.1);
  }
  if (sirenGain && sirenOscA && sirenOscB) {
    const wanted = S.stars > 0 && S.cruisers.length > 0;
    sirenGain.gain.setTargetAtTime(wanted ? 0.045 : 0, ctx.currentTime, 0.2);
    sirenTimer += dt;
    if (sirenTimer > 0.45) {
      sirenTimer = 0;
      sirenHigh = !sirenHigh;
      sirenOscA.frequency.value = sirenHigh ? 880 : 660;
      sirenOscB.frequency.value = sirenHigh ? 660 : 880;
    }
  }
}

export function setMuted(m) {
  S.muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}
