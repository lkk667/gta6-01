// Solmar City — synthesized sound.
// Everything is WebAudio, no audio files: a low engine hum that follows
// road speed, a two-tone police siren while wanted, and one-shot blips
// for gunfire, punches, pickups, the mission jingle, crashes and horns.
// The context is created on the first user gesture (unlock) so browsers
// do not block it; every call is guarded so a missing AudioContext can
// never throw into the game loop.

import { S } from './state.js';

export function buildAudio() {
  const audio = {
    ctx: null,
    master: null,
    engineOsc: null,
    engineGain: null,
    sirenOsc: null,
    sirenGain: null,
    sirenHi: false,
    sirenFlip: 0,
    sirenLast: 0,

    unlock() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.5;
          this.master.connect(this.ctx.destination);
          // Engine: a low sawtooth whose pitch follows road speed.
          this.engineOsc = this.ctx.createOscillator();
          this.engineOsc.type = 'sawtooth';
          this.engineOsc.frequency.value = 50;
          this.engineGain = this.ctx.createGain();
          this.engineGain.gain.value = 0;
          const engineFilter = this.ctx.createBiquadFilter();
          engineFilter.type = 'lowpass';
          engineFilter.frequency.value = 320;
          this.engineOsc.connect(engineFilter);
          engineFilter.connect(this.engineGain);
          this.engineGain.connect(this.master);
          this.engineOsc.start();
          // Siren: a sine that alternates between two notes.
          this.sirenOsc = this.ctx.createOscillator();
          this.sirenOsc.type = 'sine';
          this.sirenOsc.frequency.value = 700;
          this.sirenGain = this.ctx.createGain();
          this.sirenGain.gain.value = 0;
          this.sirenOsc.connect(this.sirenGain);
          this.sirenGain.connect(this.master);
          this.sirenOsc.start();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (_) { /* sound is optional; the game plays on silently */ }
    },

    // A short burst of filtered noise. Used for gunshots and crashes.
    burst(dur, freq, vol) {
      try {
        if (!this.ctx || S.muted) return;
        const len = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = freq;
        const gain = this.ctx.createGain();
        gain.gain.value = vol;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        src.start();
      } catch (_) { /* ignore */ }
    },

    // A short pitched blip. Used for pickups, punches and the horn.
    blip(freq, dur, type, vol) {
      try {
        if (!this.ctx || S.muted) return;
        const osc = this.ctx.createOscillator();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start();
        osc.stop(this.ctx.currentTime + dur);
      } catch (_) { /* ignore */ }
    },

    gunshot() { this.burst(0.12, 1800, 0.5); },
    punch() { this.blip(120, 0.12, 'sine', 0.5); },
    pickup() { this.blip(880, 0.15, 'sine', 0.35); this.blip(1320, 0.2, 'sine', 0.25); },
    crash() { this.burst(0.3, 500, 0.6); },
    horn() { this.blip(370, 0.25, 'square', 0.2); },

    jingle() {
      // Mission-complete arpeggio: four rising notes.
      try {
        if (!this.ctx || S.muted) return;
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => {
          setTimeout(() => this.blip(f, 0.22, 'triangle', 0.35), i * 110);
        });
      } catch (_) { /* ignore */ }
    },

    // Engine hum, driven every frame from updateDriving while the player
    // is in a car. pace is 0..1 (speed / top speed); isAuto is true while
    // a car is being driven. When the player is on foot updateDriving does
    // not call this, and tick() fades the hum out.
    engine(pace, isAuto) {
      try {
        if (!this.ctx || S.muted) return;
        if (!this.engineOsc || !this.engineGain) return;
        if (!isAuto) {
          this.engineGain.gain.value = 0;
          return;
        }
        const p = Math.min(1, Math.max(0, pace || 0));
        this.engineOsc.frequency.value = 45 + p * 100;
        this.engineGain.gain.value = 0.04 + p * 0.05;
      } catch (_) { /* ignore */ }
    },

    // Police siren, driven every frame from updatePolice with the distance
    // to the nearest cruiser. Closer cruisers are louder; the tone
    // alternates between two notes on a half-second cycle.
    siren(d) {
      try {
        if (!this.ctx || S.muted) return;
        if (!this.sirenOsc || !this.sirenGain) return;
        this.sirenLast = Date.now();
        if ((S.heat || 0) <= 0) {
          this.sirenGain.gain.value = 0;
          return;
        }
        const near = Math.max(0, 1 - (d || 0) / 80);
        this.sirenGain.gain.value = 0.05 * near;
        const hi = Math.floor(S.time * 2) % 2 === 0;
        this.sirenOsc.frequency.value = hi ? 950 : 700;
      } catch (_) { /* ignore */ }
    },

    // A short siren whoop when a car is stolen and the police are alerted.
    sirenBurst() {
      try {
        if (!this.ctx || S.muted) return;
        this.blip(950, 0.18, 'sine', 0.35);
        setTimeout(() => this.blip(700, 0.18, 'sine', 0.35), 180);
      } catch (_) { /* ignore */ }
    },

    // BUSTED sting: three descending notes.
    busted() {
      try {
        if (!this.ctx || S.muted) return;
        const notes = [392, 330, 262];
        notes.forEach((f, i) => {
          setTimeout(() => this.blip(f, 0.3, 'triangle', 0.4), i * 200);
        });
      } catch (_) { /* ignore */ }
    },

    // Called on a timer (not every frame): the safety net that silences
    // the continuous sounds when they no longer apply. The engine hum is
    // driven per-frame by engine() while driving; the siren is driven
    // per-frame by siren() while a cruiser is near.
    tick() {
      try {
        if (!this.ctx) return;
        if (S.muted) {
          if (this.engineGain) this.engineGain.gain.value = 0;
          if (this.sirenGain) this.sirenGain.gain.value = 0;
          return;
        }
        // On foot, the engine hum fades out (updateDriving no longer calls
        // engine() to keep it alive).
        if (S.onFoot && this.engineGain) this.engineGain.gain.value = 0;
        // If no cruiser has been near recently, the siren fades out.
        if (this.sirenGain && Date.now() - this.sirenLast > 600) {
          this.sirenGain.gain.value = 0;
        }
      } catch (_) { /* ignore */ }
    },
  };

  S.audio = audio;
  // The continuous sounds update on a 120 ms timer instead of every
  // frame; the one-shots fire immediately from combat / missions.
  setInterval(() => audio.tick(), 120);
}
