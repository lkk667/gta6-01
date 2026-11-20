// Solmar City — keyboard + mouse input.
// Tracks held keys in S.keys (by e.code), accumulates mouse deltas into
// S.mouseDX / S.mouseDY for the camera, and owns pointer lock with a
// drag-orbit fallback for browsers that refuse the lock. M toggles sound.

import { S } from './state.js';

export function buildInput() {
  window.addEventListener('keydown', (e) => {
    S.keys[e.code] = true;
    // M toggles sound, once per press (not on key repeat).
    if (e.code === 'KeyM' && !e.repeat) S.muted = !S.muted;
    // Keep the page from scrolling on Space (the handbrake) while playing.
    if (e.code === 'Space' && S.mode === 'playing') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    S.keys[e.code] = false;
  });
  window.addEventListener('blur', () => {
    // Losing the window clears every held key, so the player never comes
    // back to a car driving itself into the ocean.
    for (const k of Object.keys(S.keys)) S.keys[k] = false;
  });

  const canvas = document.getElementById('game');
  // Click the canvas to lock the mouse for looking around. A click also
  // fires the shoot handler in main.js; the two listeners do not clash.
  canvas.addEventListener('mousedown', (e) => {
    if (S.mode !== 'playing') return;
    if (e.button === 0 && !S.pointerLocked) {
      try { canvas.requestPointerLock(); } catch (_) { /* drag-orbit fallback */ }
    }
    if (e.button === 0) S.dragOrbit = true;
  });
  window.addEventListener('mouseup', () => {
    S.dragOrbit = false;
  });
  document.addEventListener('pointerlockchange', () => {
    S.pointerLocked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (S.pointerLocked) {
      S.mouseDX += e.movementX || 0;
      S.mouseDY += e.movementY || 0;
    } else if (S.dragOrbit && S.mode === 'playing') {
      S.mouseDX += e.movementX || 0;
      S.mouseDY += e.movementY || 0;
    }
  });
  // Mouse wheel zooms the chase / third-person camera in and out.
  canvas.addEventListener('wheel', (e) => {
    if (S.mode === 'playing') return;
    S.camDist = Math.min(16, Math.max(4, S.camDist + Math.sign(e.deltaY) * 1.2));
  }, { passive: true });
}
