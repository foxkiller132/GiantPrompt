// Random world events — periodic, temporary global modifiers that keep a long
// run dynamic. The host orchestrates them (Math.random is fine: the host is
// authoritative and broadcasts the resulting state.event to peers). Effects are
// read back via the multiplier getters at the relevant simulation sites.

export const EVENTS = {
  manaSurge:   { name: 'Mana Surge',    dur: 90,  desc: '+30% machine output',          output: 1.3 },
  arcaneStorm: { name: 'Arcane Storm',  dur: 90,  desc: '+60% residue, heavier waves',  residue: 1.6, spawn: 1.4 },
  tranquility: { name: 'Tranquility',   dur: 140, desc: 'foes subside',                 spawn: 0.4 },
  bounty:      { name: 'Arcane Bounty', instant: true, desc: 'resource windfall' },
};

const POOL = ['manaSurge', 'arcaneStorm', 'tranquility', 'bounty'];
const EVENT_EVERY = 240; // ticks between event rolls

export function eventActive(state) {
  return state.event && state.event.until > state.tick ? EVENTS[state.event.id] : null;
}

// Orchestrate the world-event lifecycle. Returns an event object for banners.
export function tickWorldEvent(state, rng = Math.random) {
  if (state.event && state.event.until <= state.tick) {
    const ended = state.event.id;
    state.event = null;
    return { type: 'event-end', id: ended };
  }
  if (!state.event && state.tick > 120 && state.tick % EVENT_EVERY === 0 && rng() < 0.6) {
    const id = POOL[Math.floor(rng() * POOL.length)];
    const def = EVENTS[id];
    if (def.instant) {
      state.resources.component = (state.resources.component || 0) + 20;
      state.resources.rune = (state.resources.rune || 0) + 8;
      return { type: 'event', id, name: def.name, instant: true };
    }
    state.event = { id, until: state.tick + def.dur };
    return { type: 'event', id, name: def.name };
  }
  return null;
}

export const eventOutputMult  = (s) => { const e = eventActive(s); return (e && e.output)  || 1; };
export const eventResidueMult = (s) => { const e = eventActive(s); return (e && e.residue) || 1; };
export const eventSpawnMult   = (s) => { const e = eventActive(s); return (e && e.spawn)   || 1; };
