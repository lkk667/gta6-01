// Solmar City — saving and continuing.
// The campaign is stored in localStorage under a versioned key, so a save
// from an older build can never load by mistake. The menu's Continue
// button reads the same key, and the game loop autosaves every 10 s.

import { S } from './state.js';

// Bump both of these together when the save shape changes.
const SAVE_KEY = 'solmar-city-save-v4';
const SAVE_VERSION = 4;

function readPlayerPos() {
  if (!S.player) return { x: 0, z: 0 };
  return { x: S.player.pos.x, z: S.player.pos.z };
} // end of readPlayerPos()

export function saveGame() {
  try {
    const where = readPlayerPos();
    const payload = { version: SAVE_VERSION };
    payload.cash = S.cash;
    payload.missionsCompleted = S.missionsCompleted;
    payload.missionIndex = S.missionIndex;
    payload.freeRoam = S.freeRoam;
    payload.health = S.health;
    payload.playerX = where.x;
    payload.playerZ = where.z;
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch (_) {
    // Storage may be unavailable (private mode, quota). The game just
    // keeps running and the menu shows no Continue button.
  }
} // end of saveGame()

export function loadSave() {
  let stored;
  try {
    stored = localStorage.getItem(SAVE_KEY);
  } catch (_) {
    return null;
  }
  if (!stored) return null;
  let record;
  try {
    record = JSON.parse(stored);
  } catch (_) {
    return null;
  }
  if (!record || record.version !== SAVE_VERSION) return null;
  return record;
} // end of loadSave()

export function applySave(record) {
  if (!record) return;
  S.cash = record.cash || 0;
  S.missionsCompleted = record.missionsCompleted || 0;
  S.missionIndex = record.missionIndex || 0;
  S.freeRoam = !!record.freeRoam;
  S.health = record.health != null ? record.health : 100;
  const hasPos = record.playerX != null && record.playerZ != null;
  if (S.player && hasPos) {
    S.player.pos.x = record.playerX;
    S.player.pos.z = record.playerZ;
    S.player.group.position.set(record.playerX, 0, record.playerZ);
  }
}
