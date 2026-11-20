// Solmar City — save / continue.
// Persists the campaign to localStorage under a versioned key so a stale
// save from an older build never loads. The menu's Continue button reads
// the same key. Autosave fires every 10 s from the game loop.

import { S } from './state.js';

const STORAGE_KEY = 'solmar-city-save-v4';
const STORAGE_VERSION = 4;

export function saveGame() {
  try {
    const payload = {
      version: STORAGE_VERSION,
      cash: S.cash,
      missionsCompleted: S.missionsCompleted,
      missionIndex: S.missionIndex,
      freeRoam: S.freeRoam,
      health: S.health,
      playerX: S.player ? S.player.pos.x : 0,
      playerZ: S.player ? S.player.pos.z : 0,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {
    // Storage can be unavailable (private mode, quota); the game keeps
    // running and the menu simply shows no Continue button.
  }
}

export function loadSave() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const record = JSON.parse(stored);
    if (!record || record.version !== STORAGE_VERSION) return null;
    return record;
  } catch (_) {
    return null;
  }
}

export function applySave(record) {
  if (!record) return;
  S.cash = record.cash || 0;
  S.missionsCompleted = record.missionsCompleted || 0;
  S.missionIndex = record.missionIndex || 0;
  S.freeRoam = !!record.freeRoam;
  S.health = record.health != null ? record.health : 100;
  if (S.player && record.playerX != null && record.playerZ != null) {
    S.player.pos.x = record.playerX;
    S.player.pos.z = record.playerZ;
    S.player.group.position.set(record.playerX, 0, record.playerZ);
  }
}
