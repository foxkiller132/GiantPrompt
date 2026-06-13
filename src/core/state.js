// Authoritative game state and deterministic tick simulation.
//
// All critical state changes flow through `applyTick` / `place` here. This is by
// design: in the P2P model the Designated Authority Client (the host) runs this
// module and is the only peer permitted to commit results, then broadcasts the
// resulting snapshot. Non-host peers render the snapshot and send intents only.
// Keeping mutation centralized and deterministic is what makes that validation
// (and desync/cheat detection) tractable later.

import { MACHINES, threatTierFor } from '../data/gamedata.js';
import { tickGolems } from './golems.js';
import { tickEnemies } from './enemies.js';

export function createState() {
  return {
    tick: 0,
    residue: 0,
    resources: {
      manaCrystal: 25, fire: 40, water: 40, earth: 40, air: 40,
      manaStream: 0, refined: 0, ingot: 0, component: 4, glyph: 0,
    },
    purifier: 0,    // Zone Purification progress toward the victory condition
    status: 'playing', // 'playing' | 'won' | 'lost'
    machines: [],   // { id, type, x, y, active, health }
    golems: [],     // { id, kind, x, y, route, leg }
    enemies: [],    // { id, name, hp, power, loot, x, y }
    nodes: [],      // { id, element, x, y, rate, reserve } — natural raw-element sources
    nextId: 1,
  };
}

// Scatter natural raw-element nodes. Each passively trickles its element into the
// global pool (natural acquisition) until its reserve depletes, keeping the
// Elemental Refinery fed without manual resupply.
export function seedNodes(state, specs) {
  for (const n of specs) {
    state.nodes.push({ id: state.nextId++, reserve: 5000, rate: 1, ...n });
  }
}

function tickNodes(state) {
  for (const n of state.nodes) {
    if (n.reserve <= 0) continue;
    const amount = Math.min(n.rate, n.reserve);
    state.resources[n.element] = (state.resources[n.element] || 0) + amount;
    n.reserve -= amount;
  }
}

export function place(state, type, x, y) {
  if (!MACHINES[type]) throw new Error(`Unknown machine type: ${type}`);
  const machine = { id: state.nextId++, type, x, y, active: true };
  state.machines.push(machine);
  return machine;
}

// Advance the simulation one tick. Returns a list of feedback events so the UI
// layer can attach satisfying visual/audio feedback to each real state change.
export function applyTick(state) {
  state.tick++;
  const events = [];
  let residueDelta = 0;

  tickNodes(state);

  for (const m of state.machines) {
    const def = MACHINES[m.type];

    // A machine only runs if every required input is fully available this tick.
    const canRun = Object.entries(def.inputs).every(
      ([res, rate]) => (state.resources[res] || 0) >= rate
    );

    m.active = canRun;
    if (!canRun) continue;

    for (const [res, rate] of Object.entries(def.inputs)) {
      state.resources[res] -= rate;
    }
    for (const [res, rate] of Object.entries(def.outputs)) {
      state.resources[res] = (state.resources[res] || 0) + rate;
    }
    residueDelta += def.residue;
    events.push({ type: 'machine-active', id: m.id, machine: m.type });
  }

  tickGolems(state);
  const enemyResult = tickEnemies(state);
  events.push(...enemyResult.events);

  state.residue += residueDelta;

  // Victory: channel surplus Glyphs into the Zone Purifier. Sustaining a fully
  // automated, defended factory long enough purifies the zone and wins the run.
  const PURIFIER_GOAL = 100;
  if (state.status === 'playing' && state.resources.glyph >= 1) {
    state.resources.glyph -= 1;
    state.purifier = Math.min(PURIFIER_GOAL, state.purifier + 1);
    if (state.purifier >= PURIFIER_GOAL) state.status = 'won';
  }
  // Defeat: the factory is wiped out.
  if (state.status === 'playing' && state.machines.length === 0 && state.tick > 5) {
    state.status = 'lost';
  }

  return { events, residueDelta, tier: threatTierFor(state.residue), status: state.status };
}

// Deterministic snapshot the host broadcasts to peers (and for save/load).
export function snapshot(state) {
  return JSON.parse(JSON.stringify(state));
}

export function restore(state, snap) {
  Object.assign(state, JSON.parse(JSON.stringify(snap)));
}
