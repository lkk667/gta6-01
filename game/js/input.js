// Solmar City — keyboard and mouse input.
// Tracks held keys, mouse orbit deltas and click-to-shoot, and owns pointer
// lock so the mouse can orbit the third-person camera while playing.

export const keys = new Set();

export const mouse = {
  dx: 0, // accumulated orbit delta since the last frame
  dy: 0,
  dragging: false,
  leftDown: false,
  rightDown: false,
  clicked: false, // a fresh left click this frame (for shooting)
};

let canvas = null;
let pointerLocked = false;

export function initInput(gameCanvas, onPauseKey, onInteractKey) {
  canvas = gameCanvas;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    keys.add(event.code);
    if (event.code === 'Escape' || event.code === 'KeyP') onPauseKey();
    if (event.code === 'KeyE') onInteractKey();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      mouse.leftDown = true;
      mouse.clicked = true;
      mouse.dragging = true;
    }
    if (event.button === 2) mouse.rightDown = true;
    if (!pointerLocked) lockPointer();
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) {
      mouse.leftDown = false;
      mouse.dragging = false;
    }
    if (event.button === 2) mouse.rightDown = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (event) => {
    if (pointerLocked) {
      mouse.dx += event.movementX;
      mouse.dy += event.movementY;
    } else if (mouse.dragging) {
      mouse.dx += event.movementX;
      mouse.dy += event.movementY;
    }
  });
}

export function lockPointer() {
  if (!canvas) return;
  try {
    const result = canvas.requestPointerLock();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (error) {
    // Headless browsers and some desktops refuse pointer lock; drag-orbit
    // still works, so a refusal is never fatal.
  }
}

export function unlockPointer() {
  try {
    if (document.pointerLockElement) document.exitPointerLock();
  } catch (error) {
    // Ignore: leaving pointer lock is best-effort.
  }
}

export function consumeMouseDelta() {
  const out = { dx: mouse.dx, dy: mouse.dy };
  mouse.dx = 0;
  mouse.dy = 0;
  return out;
}

export function consumeClick() {
  const wasClicked = mouse.clicked;
  mouse.clicked = false;
  return wasClicked;
}

export function isDown(code) {
  return keys.has(code);
}

export function isRightDown() {
  return mouse.rightDown;
}

export function anyMoveKey() {
  return (
    keys.has('KeyW') || keys.has('ArrowUp') ||
    keys.has('KeyS') || keys.has('ArrowDown') ||
    keys.has('KeyA') || keys.has('ArrowLeft') ||
    keys.has('KeyD') || keys.has('ArrowRight')
  );
}
