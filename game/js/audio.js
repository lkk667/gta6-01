// Solmar City — synthesized sound.
// WebAudio only, no audio files: a low engine hum that tracks road speed,
// a two-tone police siren while wanted, and one-shot blips for gunfire,
// punches, pickups, the mission jingle, crashes and horns. The context is
// created on the first user gesture (unlock) so browsers do not block it,
// and every call is guarded so a missing AudioContext can never throw
// into the game loop.

import { S } from './state.js';

export function buildAudio() {
  // A short burst of filtered noise. Gunshots and crashes use this.
  function noiseBurst(audio, dur, freq, vol) {
    if (!audio.ctx || S.muted) return;
    try {
      const len = Math.floor(audio.ctx.sampleRate * dur);
      const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = audio.ctx.createBufferSource();
      src.buffer = buf;
      const filter = audio.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq;
      const gain = audio.ctx.createGain();
      gain.gain.value = vol;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(audio.master);
      src.start();
    } catch (_) { /* a failed blip stays silent */ }
  }

  // A short pitched blip. Pickups, punches and the horn use this.
  function toneBlip(audio, freq, dur, type, vol) {
    if (!audio.ctx || S.muted) return;
    try {
      const osc = audio.ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      const gain = audio.ctx.createGain();
      gain.gain.setValueAtTime(vol, audio.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(audio.master);
      osc.start();
      osc.stop(audio.ctx.currentTime + dur);
    } catch (_) { /* a failed tone stays silent */ }
  }

  // Play a short melody: one blip per note, spaced `gap` ms apart.
  function playMelody(audio, notes, gap, dur, type, vol) {
    if (!audio.ctx || S.muted) return;
    for (let i = 0; i < notes.length; i++) {
      const when = i * gap;
      const freq = notes[i];
      setTimeout(() => audio.blip(freq, dur, type, vol), when);
    }
  }

  function makeOscillator(audio, type, freq) {
    const osc = audio.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    return osc;
  }

  function makeGain(audio, level) {
    const gain = audio.ctx.createGain();
    gain.gain.value = level;
    return gain;
  }

  const audio = {
    ctx: null,
    master: null,
    engineOscillator: null,
    engineLevel: null,
    sirenOscillator: null,
    sirenLevel: null,
    sirenHigh: false,
    sirenStep: 0,
    sirenSeen: 0,

    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.master = makeGain(this, 0.5);
          this.master.connect(this.ctx.destination);
          // Engine: a low sawtooth whose pitch follows road speed.
          this.engineOscillator = makeOscillator(this, 'sawtooth', 50);
          this.engineLevel = makeGain(this, 0);
          const engineLowpass = this.ctx.createBiquadFilter();
          engineLowpass.type = 'lowpass';
          engineLowpass.frequency.value = 320;
          this.engineOscillator.connect(engineLowpass);
          engineLowpass.connect(this.engineLevel);
          this.engineLevel.connect(this.master);
          this.engineOscillator.start();
          // Siren: a sine that alternates between two notes.
          this.sirenOscillator = makeOscillator(this, 'sine', 700);
          this.sirenLevel = makeGain(this, 0);
          this.sirenOscillator.connect(this.sirenLevel);
          this.sirenLevel.connect(this.master);
          this.sirenOscillator.start();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (_) { /* sound is optional; the game plays on silently */ }
    },

    burst(dur, freq, vol) {
      noiseBurst(this, dur, freq, vol);
    },

    blip(freq, dur, type, vol) {
      toneBlip(this, freq, dur, type, vol);
    },

    gunshot() { this.burst(0.12, 1800, 0.5); },

    punch() { this.blip(120, 0.12, 'sine', 0.5); },

    pickup() {
      this.blip(880, 0.15, 'sine', 0.35);
      this.blip(1320, 0.2, 'sine', 0.25);
    },

    crash() { this.burst(0.3, 500, 0.6); },

    horn() { this.blip(370, 0.25, 'square', 0.2); },

    jingle() {
      // Mission-complete arpeggio: four rising notes.
      playMelody(this, [523, 659, 784, 1047], 110, 0.22, 'triangle', 0.35);
    },

    // BUSTED sting: three descending notes.
    busted() {
      playMelody(this, [392, 330, 262], 200, 0.3, 'triangle', 0.4);
    },

    // A short siren whoop when a stolen car alerts the police.
    sirenBurst() {
      if (!this.ctx || S.muted) return;
      try {
        this.blip(950, 0.18, 'sine', 0.35);
        setTimeout(() => this.blip(700, 0.18, 'sine', 0.35), 180);
      } catch (_) { /* a failed whoop stays silent */ }
    },

    // Engine hum, driven every frame from updateDriving while the player
    // is in a car. pace is 0..1 (speed / top speed); isAuto is true while
    // a car is being driven. On foot updateDriving does not call this,
    // and tick() fades the hum out.
    engine(pace, isAuto) {
      if (!this.ctx || S.muted) return;
      if (!this.engineOscillator || !this.engineLevel) return;
      try {
        if (!isAuto) {
          this.engineLevel.gain.value = 0;
          return;
        }
        const p = Math.min(1, Math.max(0, pace || 0));
        this.engineOscillator.frequency.value = 45 + p * 100;
        this.engineLevel.gain.value = 0.04 + p * 0.05;
      } catch (_) { /* a failed engine update stays silent */ }
    },

    // Police siren, driven every frame from updatePolice with the
    // distance to the nearest cruiser. Closer cruisers sound louder; the
    // tone flips between two notes on a half-second cycle.
    siren(d) {
      if (!this.ctx || S.muted) return;
      if (!this.sirenOscillator || !this.sirenLevel) return;
      try {
        this.sirenSeen = Date.now();
        const sirenGain = this.sirenLevel.gain;
        if ((S.heat || 0) <= 0) {
          sirenGain.value = 0;
          return;
        }
        const near = Math.max(0, 1 - (d || 0) / 80);
        sirenGain.value = 0.05 * near;
        const hi = Math.floor(S.time * 2) % 2 === 0;
        this.sirenOscillator.frequency.value = hi ? 950 : 700;
      } catch (_) { /* a failed siren update stays silent */ }
    },

    // Called on a timer (not every frame): the safety net that silences
    // the continuous sounds when they no longer apply. The engine hum is
    // driven per-frame by engine() while driving; the siren is driven
    // per-frame by siren() while a cruiser is near.
    tick() {
      if (!this.ctx) return;
      try {
        if (S.muted) {
          if (this.engineLevel) this.engineLevel.gain.value = 0;
          if (this.sirenLevel) this.sirenLevel.gain.value = 0;
          return;
        }
        // On foot the engine hum fades out (updateDriving no longer calls
        // engine() to keep it alive).
        if (S.onFoot && this.engineLevel) this.engineLevel.gain.value = 0;
        // If no cruiser has been near recently, the siren fades out.
        const quietFor = Date.now() - this.sirenSeen;
        if (this.sirenLevel && quietFor > 600) {
          this.sirenLevel.gain.value = 0;
        }
      } catch (_) { /* a failed tick stays silent */ }
    },
  };

  S.audio = audio;
  // The continuous sounds update on a 120 ms timer instead of every
  // frame; the one-shots fire immediately from combat / missions.
  setInterval(() => audio.tick(), 120);
} // end of buildAudio()
