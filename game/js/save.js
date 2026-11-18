// Solmar City — saving and loading.
// Progress (cash, missions, health, ammo, position) lives in localStorage
// under one key. Nothing else persists: the city, traffic and police are
// rebuilt fresh on every load, which keeps a save small and honest.

import { state } from './state.js';

const SAVE_KEY = 'solmar-city-save-v1';

export function saveGame() {
  try {
    const data = {
      version: 1,
      cash: state.cash,
      health: state.health,
      ammo: state.ammo,
      magazine: state.magazine,
      missionsCompleted: state.missionsCompleted,
      missionIndex: state.missionIndex,
      freeRoam: state.freeRoam,
      carsStolen: state.carsStolen,
      playerX: state.player.x,
      playerZ: state.player.z,
      playerHeading: state.player.heading,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    return false;
  }
}

export function loadSaveData() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch (error) {
    return null;
  }
}

export function hasSave() {
  return loadSaveData() !== null;
}

export function applySaveData(data) {
  state.cash = data.cash || 0;
  state.health = data.health || 100;
  state.ammo = data.ammo || 0;
  state.magazine = data.magazine || 12;
  state.missionsCompleted = data.missionsCompleted || 0;
  state.missionIndex = data.missionIndex || 0;
  state.freeRoam = !!data.freeRoam;
  state.carsStolen = data.carsStolen || 0;
  state.player.x = typeof data.playerX === 'number' ? data.playerX : 0;
  state.player.z = typeof data.playerZ === 'number' ? data.playerZ : 24;
  state.player.heading = typeof data.playerHeading === 'number' ? data.playerHeading : Math.PI;
  state.player.onFoot = true;
  state.player.inCar = null;
  state.wantedHeat = 0;
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch (error) {
    // Storage may be unavailable; a missing save is not fatal.
  }
}
