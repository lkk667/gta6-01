// Solmar City — keyboard and mouse input.
// Pointer lock for looking around, with a click-drag fallback for
// browsers and headless runs where the lock is refused.

import { S } from './state.js';

export const input = {
  keys: new Set(),
  lookDX: 0,
  lookDY: 0,
  mouseDown: false,
  dragging: false,
  locked: false,
  clicked: false, // a fresh left click this frame
  pressed: new Set(), // keys pressed this frame (edge-triggered)
};

let canvas = null;
let lastX = 0;
let lastY = 0;

export function initInput(canvasEl) {
  canvas = canvasEl;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => input.keys.clear());

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });

  canvas.addEventListener('click', () => {
    if (S.mode !== 'playing') return;
    if (!input.locked && canvas.requestPointerLock) {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (err) {
        /* pointer lock unavailable: drag-orbit fallback below */
      }
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    input.mouseDown = true;
    input.dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 0) input.clicked = true;
  });
  window.addEventListener('mouseup', () => {
    input.mouseDown = false;
    input.dragging = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (input.locked) {
      input.lookDX += e.movementX || 0;
      input.lookDY += e.movementY || 0;
    } else if (input.dragging) {
      input.lookDX += e.clientX - lastX;
      input.lookDY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  // Keep the context menu from popping up over the game.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** Consume this frame's edge-triggered input. Call once per frame. */
export function endFrameInput() {
  input.lookDX = 0;
  input.lookDY = 0;
  input.clicked = false;
  input.pressed.clear();
}

export function keyDown(code) {
  return input.keys.has(code);
}

export function keyPressed(code) {
  return input.pressed.has(code);
}
