// Solmar City — keyboard and mouse.
// Held keys live in S.keys by e.code, mouse deltas pile into S.mouseDX /
// S.mouseDY for the camera, and this module owns pointer lock with a
// drag-orbit fallback for browsers that refuse the lock. M toggles sound.

import { S } from './state.js';

function onKeyDown(e) {
  S.keys[e.code] = true;
  // M mutes and unmutes, once per press rather than on key repeat.
  if (e.code === 'KeyM' && !e.repeat) S.muted = !S.muted;
  // Space is the handbrake while driving; stop the page scrolling.
  if (e.code === 'Space' && S.mode === 'playing') e.preventDefault();
} // end of onKeyDown()

function onKeyUp(e) {
  S.keys[e.code] = false;
} // end of onKeyUp()

function onBlur() {
  // Tabbing away releases every held key, so the player never returns
  // to a car driving itself into the ocean.
  for (const k of Object.keys(S.keys)) S.keys[k] = false;
} // end of onBlur()

function onMouseMove(e) {
  const locked = S.pointerLocked;
  const dragging = S.dragOrbit && S.mode === 'playing';
  if (!locked && !dragging) return;
  S.mouseDX += e.movementX || 0;
  S.mouseDY += e.movementY || 0;
} // end of onMouseMove()

function tryLockPointer(surface) {
  try { surface.requestPointerLock(); } catch (_) { /* drag-orbit fallback */ }
} // end of tryLockPointer()

export function buildInput() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const surface = document.getElementById('game');
  // Clicking the canvas locks the mouse for looking around. The same
  // click also reaches the shoot handler in main.js; the two listeners
  // do not get in each other's way.
  surface.addEventListener('mousedown', (e) => {
    if (S.mode !== 'playing') return;
    if (e.button === 0 && !S.pointerLocked) tryLockPointer(surface);
    if (e.button === 0) S.dragOrbit = true;
  });
  window.addEventListener('mouseup', () => {
    S.dragOrbit = false;
  });
  document.addEventListener('pointerlockchange', () => {
    S.pointerLocked = document.pointerLockElement === surface;
  });
  document.addEventListener('mousemove', onMouseMove);
  // The wheel zooms the chase / third-person camera in and out.
  surface.addEventListener('wheel', (e) => {
    if (S.mode === 'playing') return;
    const next = S.camDist + Math.sign(e.deltaY) * 1.2;
    S.camDist = Math.min(16, Math.max(4, next));
  }, { passive: true });
} // end of buildInput()
