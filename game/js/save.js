// Solmar City — localStorage autosave.

import { S } from './state.js';

const KEY = 'solmar-city-save-v4';
const SAVE_VERSION = 4;

function snapshot() {
  const p = S.player;
  return {
    version: SAVE_VERSION,
    cash: S.cash,
    health: S.health,
    magazine: S.magazine,
    reserve: S.reserve,
    heat: S.heat,
    missionsCompleted: S.missionsCompleted,
    missionIndex: S.missionIndex,
    x: p ? p.pos.x : 0,
    z: p ? p.pos.z : -8,
    heading: p ? p.heading : 0,
    savedAt: Date.now(),
  };
}

export function saveGame() {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot()));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== SAVE_VERSION) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export function applySave(data) {
  if (!data) return false;
  S.cash = data.cash || 0;
  S.health = data.health || 100;
  S.magazine = data.magazine === undefined ? 12 : data.magazine;
  S.reserve = data.reserve === undefined ? 60 : data.reserve;
  S.heat = data.heat || 0;
  S.missionsCompleted = data.missionsCompleted || 0;
  S.missionIndex = data.missionIndex || 0;
  const p = S.player;
  if (p) {
    p.pos.x = data.x || 0;
    p.pos.z = data.z === undefined ? -8 : data.z;
    p.heading = data.heading || 0;
    p.group.position.set(p.pos.x, 0, p.pos.z);
  }
  S.saveLoaded = true;
  return true;
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
