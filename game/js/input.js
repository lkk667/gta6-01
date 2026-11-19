// Solmar City — keyboard + mouse input (v4 polish, re-implemented).
// Pointer lock with a drag-orbit fallback for browsers that refuse it.

import { S } from './state.js';

export function buildInput() {
  const canvas = S.renderer.domElement;
  window.addEventListener('keydown', (e) => {
    S.keys[e.code] = true;
    if (e.code === 'KeyM') {
      S.muted = !S.muted;
      if (S.audio) S.audio.engine(0, false);
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    S.keys[e.code] = false;
  });
  window.addEventListener('blur', () => {
    S.keys = {};
  });

  canvas.addEventListener('click', () => {
    if (S.mode !== 'playing') return;
    if (S.audio) S.audio.unlock();
    if (!S.pointerLocked && canvas.requestPointerLock) {
      try {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => { /* fallback: drag orbit */ });
      } catch (e) { /* fallback: drag orbit */ }
    }
  });
  document.addEventListener('pointerlockchange', () => {
    S.pointerLocked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (S.mode !== 'playing') return;
    if (S.pointerLocked) {
      S.camYaw -= e.movementX * 0.0032;
      S.camPitch += e.movementY * 0.0022;
      S.camPitch = Math.max(-0.15, Math.min(0.85, S.camPitch));
    } else if (S.dragOrbit && e.buttons === 1) {
      S.camYaw -= e.movementX * 0.005;
      S.camPitch += e.movementY * 0.003;
      S.camPitch = Math.max(-0.15, Math.min(0.85, S.camPitch));
    }
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) S.dragOrbit = true;
  });
  window.addEventListener('mouseup', () => {
    S.dragOrbit = false;
  });
  canvas.addEventListener('wheel', (e) => {
    const next = S.camDist + Math.sign(e.deltaY) * 0.8;
    S.camDist = Math.max(5, Math.min(14, next));
  }, { passive: true });
}
