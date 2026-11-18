// Solmar City — synthesised sound.
// Every effect is built with the Web Audio API at run time: oscillators and
// filtered noise, no audio files, no network. The context is created on the
// first user gesture (the Start button), as browsers require.

let ctx = null;
let masterGain = null;
let engineOsc = null;
let engineOsc2 = null;
let engineGain = null;
let engineFilter = null;
let sirenOsc = null;
let sirenGain = null;
let sirenHigh = true;
let sirenTimer = 0;
let muted = false;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  ctx = new AudioContextClass();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.5;
  masterGain.connect(ctx.destination);
  startEngineLoop();
  startSirenLoop();
}

export function toggleMute() {
  muted = !muted;
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.5;
  return muted;
}

function startEngineLoop() {
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 55;
  engineOsc2 = ctx.createOscillator();
  engineOsc2.type = 'square';
  engineOsc2.frequency.value = 28;
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 420;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineOsc2.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(masterGain);
  engineOsc.start();
  engineOsc2.start();
}

function startSirenLoop() {
  sirenOsc = ctx.createOscillator();
  sirenOsc.type = 'triangle';
  sirenOsc.frequency.value = 750;
  sirenGain = ctx.createGain();
  sirenGain.gain.value = 0;
  sirenOsc.connect(sirenGain);
  sirenGain.connect(masterGain);
  sirenOsc.start();
}

// Called every frame: engine pitch follows driving speed, siren wails while wanted.
export function updateAudio(drivingSpeed01, wantedStars, dt) {
  if (!ctx) return;
  const targetEngine = drivingSpeed01 > 0.02 ? 0.05 + drivingSpeed01 * 0.11 : 0.0;
  engineGain.gain.setTargetAtTime(targetEngine, ctx.currentTime, 0.1);
  engineOsc.frequency.setTargetAtTime(55 + drivingSpeed01 * 165, ctx.currentTime, 0.1);
  engineOsc2.frequency.setTargetAtTime(28 + drivingSpeed01 * 82, ctx.currentTime, 0.1);
  engineFilter.frequency.setTargetAtTime(380 + drivingSpeed01 * 1400, ctx.currentTime, 0.1);

  if (wantedStars > 0) {
    sirenTimer -= dt;
    if (sirenTimer <= 0) {
      sirenTimer = 0.42;
      sirenHigh = !sirenHigh;
      sirenOsc.frequency.setTargetAtTime(sirenHigh ? 920 : 660, ctx.currentTime, 0.03);
    }
    sirenGain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.2);
  } else {
    sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  }
}

function noiseBurst(duration, filterFreq, volume) {
  if (!ctx) return;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start();
}

function tone(freq, duration, type, volume, slideTo) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export function playGunshot() {
  noiseBurst(0.14, 2800, 0.5);
  tone(160, 0.08, 'square', 0.18, 60);
}

export function playPunch() {
  noiseBurst(0.09, 500, 0.4);
  tone(110, 0.1, 'sine', 0.25, 55);
}

export function playPickup() {
  tone(660, 0.1, 'sine', 0.25);
  setTimeout(() => tone(990, 0.14, 'sine', 0.25), 90);
}

export function playCash() {
  tone(880, 0.08, 'triangle', 0.22);
  setTimeout(() => tone(1174, 0.1, 'triangle', 0.22), 80);
  setTimeout(() => tone(1568, 0.16, 'triangle', 0.22), 160);
}

export function playMissionComplete() {
  [523, 659, 784, 1046].forEach((freq, i) => {
    setTimeout(() => tone(freq, 0.22, 'triangle', 0.28), i * 120);
  });
}

export function playBusted() {
  tone(392, 0.25, 'sawtooth', 0.22, 196);
  setTimeout(() => tone(311, 0.4, 'sawtooth', 0.22, 155), 220);
}

export function playCrash() {
  noiseBurst(0.25, 900, 0.5);
  tone(90, 0.2, 'sine', 0.3, 40);
}

export function playClick() {
  tone(1200, 0.05, 'square', 0.12);
}

export function playHorn() {
  tone(370, 0.18, 'square', 0.15);
  tone(466, 0.18, 'square', 0.12);
}
