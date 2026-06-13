// Save / load persistence with multiple slots.
//
// The full game state is serializable (the same snapshot the P2P host broadcasts),
// so persistence is snapshot → localStorage → restore. Saves live in numbered
// slots; each carries metadata (timestamp + run progress) so the menu can show a
// meaningful slot list. An "active slot" tracks where autosave and quick-save go.
// Versioned so future schema changes can migrate or reject stale saves.

import { snapshot, restore } from './state.js';

const PREFIX = 'aa:save:';
const ACTIVE_KEY = 'aa:activeSlot';
const VERSION = 1;
export const SLOT_COUNT = 3;

function keyFor(slot) { return `${PREFIX}${slot}`; }

export function getActiveSlot() { return Number(localStorage.getItem(ACTIVE_KEY) ?? '0'); }
export function setActiveSlot(slot) { localStorage.setItem(ACTIVE_KEY, String(slot)); }

// Save the live state into a slot, stamping progress metadata for the slot list.
export function saveToSlot(state, slot) {
  try {
    const meta = { tick: state.tick, purifications: state.purifications || 0,
                   machines: state.machines.length, residue: Math.floor(state.residue) };
    localStorage.setItem(keyFor(slot),
      JSON.stringify({ v: VERSION, ts: Date.now(), meta, state: snapshot(state) }));
    return true;
  } catch { return false; }
}

export function loadFromSlot(state, slot) {
  try {
    const raw = localStorage.getItem(keyFor(slot));
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.v !== VERSION || !data.state) return false; // reject incompatible saves
    restore(state, data.state);
    return true;
  } catch { return false; }
}

export function slotMeta(slot) {
  try {
    const raw = localStorage.getItem(keyFor(slot));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.v !== VERSION) return null;
    return { ts: data.ts, ...(data.meta || {}) };
  } catch { return null; }
}

export function listSlots() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i, meta: slotMeta(i) }));
}

export function clearSlot(slot) { localStorage.removeItem(keyFor(slot)); }

export function anySave() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => slotMeta(i)).some(Boolean);
}

// ---- Active-slot conveniences (used by autosave + quick Save/Load) ----------
export function saveGame(state) { return saveToSlot(state, getActiveSlot()); }
export function loadGame(state) { return loadFromSlot(state, getActiveSlot()); }
export function hasSave() { return !!slotMeta(getActiveSlot()); }
export function clearSave() { clearSlot(getActiveSlot()); }
