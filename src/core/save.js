// Save / load persistence.
//
// The full game state is serializable (the same snapshot the P2P host broadcasts),
// so persistence is just snapshot → localStorage → restore. The host autosaves on
// a cadence; a manual save/load is exposed through the UI. Versioned so future
// schema changes can migrate or reject stale saves rather than corrupt a run.

import { snapshot, restore } from './state.js';

const KEY = 'aa:save';
const VERSION = 1;

export function saveGame(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ts: Date.now(), state: snapshot(state) }));
    return true;
  } catch { return false; }
}

export function hasSave() {
  return !!localStorage.getItem(KEY);
}

// Returns true if a compatible save was loaded into `state`.
export function loadGame(state) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.v !== VERSION || !data.state) return false; // reject incompatible saves
    restore(state, data.state);
    return true;
  } catch { return false; }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}
