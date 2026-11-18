// Solmar City — saving: the game autosaves to localStorage and the
// start menu offers Continue when a save exists.

import { S } from './state.js';
import { player } from './player.js';

export const SAVE_KEY = 'solmar-city-save-v2';

export function saveGame() {
  try {
    const data = {
      version: S.version,
      cash: S.cash,
      health: S.health,
      magazine: S.magazine,
      reserve: S.reserve,
      missionsCompleted: S.missionsCompleted,
      missionIndex: S.missionIndex,
      x: player.pos.x,
      z: player.pos.z,
      heading: player.heading,
      time: S.time,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== S.version) return null;
    return data;
  } catch (err) {
    return null;
  }
}

export function hasSave() {
  return loadSave() !== null;
}

export function applySave(data) {
  S.cash = data.cash || 0;
  S.health = data.health ?? 100;
  S.magazine = data.magazine ?? 12;
  S.reserve = data.reserve ?? 60;
  S.missionsCompleted = data.missionsCompleted || 0;
  if (typeof data.x === 'number' && typeof data.z === 'number') {
    player.pos.set(data.x, 0, data.z);
    player.heading = data.heading || 0;
    player.camYaw = player.heading + Math.PI;
    player.group.position.copy(player.pos);
  }
}
