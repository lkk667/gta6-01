// Solmar City — save / continue.
// Persists the campaign to localStorage under a versioned key so a stale
// save from an older build never loads. The menu's Continue button reads
// the same key. Autosave fires every 10 s from the game loop.

import { S } from './state.js';

const SAVE_KEY = 'solmar-city-save-v4';
const SAVE_VERSION = 4;

export function saveGame() {
  try {
    const data = {
      version: SAVE_VERSION,
      cash: S.cash,
      missionsCompleted: S.missionsCompleted,
      missionIndex: S.missionIndex,
      freeRoam: S.freeRoam,
      health: S.health,
      playerX: S.player ? S.player.pos.x : 0,
      playerZ: S.player ? S.player.pos.z : 0,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (_) {
    // Storage can be unavailable (private mode, quota); the game keeps
    // running and the menu simply shows no Continue button.
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SAVE_VERSION) return null;
    return data;
  } catch (_) {
    return null;
  }
}

export function applySave(saved) {
  if (!saved) return;
  S.cash = saved.cash || 0;
  S.missionsCompleted = saved.missionsCompleted || 0;
  S.missionIndex = saved.missionIndex || 0;
  S.freeRoam = !!saved.freeRoam;
  S.health = saved.health != null ? saved.health : 100;
  if (S.player && saved.playerX != null && saved.playerZ != null) {
    S.player.pos.x = saved.playerX;
    S.player.pos.z = saved.playerZ;
    S.player.group.position.set(saved.playerX, 0, saved.playerZ);
  }
}
