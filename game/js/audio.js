// Solmar City — synthesized WebAudio sound (v4 polish, re-implemented).
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

  function ensure() {
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

  function blip(freq, dur, type, vol, slideTo) {
    const c = ensure();
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

  function noise(dur, vol, lowpass) {
    const c = ensure();
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
    unlock() { ensure(); },
    engine(amount, driving) {
      if (!engineOsc || S.muted) {
        if (engineGain) engineGain.gain.value = 0;
        return;
      }
      ensure();
      engineGain.gain.value = driving ? 0.05 + amount * 0.06 : 0;
      engineOsc.frequency.value = 55 + amount * 130;
    },
    siren(dist) {
      if (!sirenOsc) return;
      ensure();
      sirenTimer += 1;
      const vol = S.muted ? 0 : Math.max(0, 0.05 - dist * 0.0006);
      sirenGain.gain.value = vol;
      const hi = Math.sin(S.time * 4) > 0;
      sirenOsc.frequency.value = hi ? 950 : 700;
    },
    sirenBurst() { blip(950, 0.4, 'sine', 0.15, 700); },
    gunshot() { noise(0.14, 0.5, 3000); blip(160, 0.1, 'square', 0.25, 60); },
    punch() { noise(0.09, 0.3, 500); },
    pickup() { blip(660, 0.12, 'sine', 0.2, 990); },
    missionJingle() {
      blip(523, 0.14, 'sine', 0.22);
      setTimeout(() => blip(659, 0.14, 'sine', 0.22), 130);
      setTimeout(() => blip(784, 0.28, 'sine', 0.24), 260);
    },
    missionStart() { blip(440, 0.2, 'triangle', 0.2, 660); },
    crash() { noise(0.25, 0.4, 800); },
    horn() { blip(370, 0.3, 'square', 0.12, 370); },
    click() { blip(1200, 0.05, 'square', 0.12); },
    reload() { blip(300, 0.06, 'square', 0.15); blip(500, 0.06, 'square', 0.15); },
    busted() { blip(220, 0.5, 'sawtooth', 0.2, 110); },
  };
  return S.audio;
}
