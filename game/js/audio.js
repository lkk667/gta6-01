// Solmar City — synthesized WebAudio sound.
// Every sound is generated, no audio files: engine hum, siren, gunshot,
// punch, pickup, mission jingle, crash, horn, reload click.

import { S } from './state.js';

export function buildAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;

  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 60;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain);
      engineGain.connect(ctx.destination);
      engineOsc.start();
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'sine';
      sirenOsc.frequency.value = 800;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(ctx.destination);
      sirenOsc.start();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // Short oscillator tone, optionally sliding to another pitch.
  function tone(freq, dur, type, vol, slideTo) {
    const c = ensureCtx();
    if (!c || S.muted) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.2, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }

  // Burst of filtered noise (gunshots, crashes, punches).
  function burst(dur, vol, lowpass) {
    const c = ensureCtx();
    if (!c || S.muted) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol || 0.3;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass || 1200;
    src.connect(f);
    f.connect(g);
    g.connect(c.destination);
    src.start();
  }

  S.audio = {
    unlock() { ensureCtx(); },
    engine(amount, driving) {
      if (!engineOsc || S.muted) {
        if (engineGain) engineGain.gain.value = 0;
        return;
      }
      ensureCtx();
      engineGain.gain.value = driving ? 0.05 + amount * 0.06 : 0;
      engineOsc.frequency.value = 55 + amount * 130;
    },
    siren(dist) {
      if (!sirenOsc) return;
      ensureCtx();
      sirenTimer += 1;
      const vol = S.muted ? 0 : Math.max(0, 0.05 - dist * 0.0006);
      sirenGain.gain.value = vol;
      const hi = Math.sin(S.time * 4) > 0;
      sirenOsc.frequency.value = hi ? 950 : 700;
    },
    sirenBurst() { tone(950, 0.4, 'sine', 0.15, 700); },
    gunshot() { burst(0.14, 0.5, 3000); tone(160, 0.1, 'square', 0.25, 60); },
    punch() { burst(0.09, 0.3, 500); },
    pickup() { tone(660, 0.12, 'sine', 0.2, 990); },
    missionJingle() {
      tone(523, 0.14, 'sine', 0.22);
      setTimeout(() => tone(659, 0.14, 'sine', 0.22), 130);
      setTimeout(() => tone(784, 0.28, 'sine', 0.24), 260);
    },
    missionStart() { tone(440, 0.2, 'triangle', 0.2, 660); },
    crash() { burst(0.25, 0.4, 800); },
    horn() { tone(370, 0.3, 'square', 0.12, 370); },
    click() { tone(1200, 0.05, 'square', 0.12); },
    reload() { tone(300, 0.06, 'square', 0.15); tone(500, 0.06, 'square', 0.15); },
    busted() { tone(220, 0.5, 'sawtooth', 0.2, 110); },
  };
  return S.audio;
}
