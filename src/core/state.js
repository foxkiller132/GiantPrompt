// Authoritative game state and deterministic tick simulation.
//
// All critical state changes flow through `applyTick` / `place` here. This is by
// design: in the P2P model the Designated Authority Client (the host) runs this
// module and is the only peer permitted to commit results, then broadcasts the
// resulting snapshot. Non-host peers render the snapshot and send intents only.
// Keeping mutation centralized and deterministic is what makes that validation
// (and desync/cheat detection) tractable later.

import { MACHINES, threatTierFor, TECH, TECH_LOCKED, MODULES, MODULE_CYCLE, MACHINE_HEALTH } from '../data/gamedata.js';

export const PURIFIER_GOAL = 250;   // base goal; scales up with each ascension
const CLEANSE_PER_GLYPH = 3;        // partial scrub — residue still climbs during purification
const RESIDUE_DECAY = 0.996;        // ~0.4%/tick passive dissipation -> pollution equilibrium

// The Glyphs required for the next Purification grow with each completed one, so
// at high ascension purification competes harder against upgrades and research.
export function purifierGoal(state) {
  return Math.round(PURIFIER_GOAL * (1 + (state.purifications || 0) * 0.5));
}
import { tickGolems } from './golems.js';
import { tickEnemies } from './enemies.js';
import { checkAchievements } from './achievements.js';
import { outputMultiplier, residueMultiplier } from './perks.js';
import { wonderOutputMult, wonderResidueMult, wonderPurifyRate } from './wonders.js';
import { tickWorldEvent, eventOutputMult, eventResidueMult } from './events.js';
import { tickObjectives } from './objectives.js';

export function createState() {
  return {
    tick: 0,
    residue: 0,
    resources: {
      manaCrystal: 25, fire: 40, water: 40, earth: 40, air: 40,
      manaStream: 0, refined: 0, ingot: 0, component: 4, glyph: 0, rune: 0,
    },
    peers: {},      // { host:{x,y}, guest:{x,y} } — live cursor presence
    researched: [], // unlocked tech ids
    researching: null, // active continuous research { id, spent }
    purifier: 0,    // progress toward the next Zone Purification milestone
    purifying: false, // whether surplus Glyphs are routed into the Purifier
    runName: '',    // player-given label for this run (shown in the slot list)
    difficulty: 1,  // threat multiplier chosen at New Game (Calm/Standard/Relentless)
    purifications: 0, // completed purifications (escalating endgame, never terminal)
    stats: { enemiesSlain: 0, machinesBuilt: 0, peakResidue: 0 }, // run statistics
    achievements: [], // unlocked achievement ids
    objective: 0,     // index of the current guided objective
    perkPoints: 0,    // unspent ascension perk points (1 per purification)
    perks: {},        // perk id -> level
    wonders: [],      // built wonder ids (permanent run effects)
    status: 'playing', // 'playing' | 'lost' (defeat is recoverable from a save)
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
    // Large reserves so a long single run isn't walled by depletion (there is no
    // exploration to find new patches); `rate` is the real throughput limiter.
    state.nodes.push({ id: state.nextId++, reserve: 200000, rate: 1, ...n });
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

// Cycle a machine's installed Glyph module (none → resonance → channeling →
// amplifier → none). Installing a module costs 1 Glyph; removing is free.
// Returns the new module id (or null), or false if it couldn't be afforded.
export function cycleModule(state, machineId) {
  const m = state.machines.find(x => x.id === machineId);
  if (!m) return false;
  const idx = MODULE_CYCLE.indexOf(m.module ?? null);
  const next = MODULE_CYCLE[(idx + 1) % MODULE_CYCLE.length];
  if (next && (state.resources.glyph || 0) < 1) return false; // installing costs a Glyph
  if (next) state.resources.glyph -= 1;
  m.module = next;
  return next;
}

// Remove a machine (demolish). Returns true if one was removed.
export function removeMachine(state, machineId) {
  const before = state.machines.length;
  state.machines = state.machines.filter(m => m.id !== machineId);
  return state.machines.length < before;
}

// Upgrade a machine one level. Cost scales with level and is paid in Glyphs (the
// spec's machine-upgrade currency). Returns true if the upgrade was applied.
export function upgradeCost(level) { return level * 3; }

export function upgrade(state, machineId) {
  const m = state.machines.find(x => x.id === machineId);
  if (!m) return false;
  m.level = m.level || 1;
  const cost = upgradeCost(m.level);
  if ((state.resources.glyph || 0) < cost) return false;
  state.resources.glyph -= cost;
  m.level += 1;
  return true;
}

// Output multiplier from a machine's upgrade level (+50% per level beyond 1).
function levelBonus(m) { return 1 + 0.5 * ((m.level || 1) - 1); }

// Count powered Automated Conduits orthogonally adjacent to a machine.
function adjacentConduits(state, m) {
  return state.machines.filter(c =>
    c.type === 'automatedConduit' && c.active !== false &&
    Math.abs(c.x - m.x) + Math.abs(c.y - m.y) === 1
  ).length;
}

// Worker Golems currently servicing a machine (within ~1 tile while patrolling).
// This is the Golemsmith's concrete payoff: each grants a small output bonus.
function servicingWorkers(state, m) {
  let n = 0;
  for (const g of state.golems) {
    if (g.kind !== 'worker') continue;
    if (Math.hypot(g.x - (m.x + 0.5), g.y - (m.y + 0.5)) < 1.0) n++;
  }
  return n;
}

// Is a machine type available to place yet (start-unlocked or researched)?
export function isUnlocked(state, type) {
  if (!TECH_LOCKED.has(type)) return true;
  const tech = Object.entries(TECH).find(([, t]) => t.unlocks.includes(type));
  return tech ? state.researched.includes(tech[0]) : true;
}

// Continuous (science-style) research. A tech's `cost` is the *total* of each
// resource it consumes; while it is the active research, the factory feeds those
// resources over time. You must build and sustain production to advance — this is
// the main source of long, Factorio-like pacing.

// Resource units drawn per tick per ingredient while researching.
const RESEARCH_RATE = 1;

// Can a tech be *started* (prereqs met, not done, not already the active research).
export function canResearch(state, techId) {
  const t = TECH[techId];
  if (!t || state.researched.includes(techId)) return false;
  if (state.researching && state.researching.id === techId) return false;
  return t.requires.every(r => state.researched.includes(r));
}

// Begin researching a tech (replaces any current research-in-progress).
export function research(state, techId) {
  if (!canResearch(state, techId)) return false;
  state.researching = { id: techId, spent: {} };
  return true;
}

// Advance the active research by consuming available inputs. Returns the tech id
// when it completes this tick, else null.
function tickResearch(state) {
  const r = state.researching;
  if (!r) return null;
  const t = TECH[r.id];
  if (!t) { state.researching = null; return null; }
  let done = true;
  for (const [res, total] of Object.entries(t.cost)) {
    const spent = r.spent[res] || 0;
    if (spent < total) {
      const take = Math.min(RESEARCH_RATE, total - spent, state.resources[res] || 0);
      if (take > 0) { state.resources[res] -= take; r.spent[res] = spent + take; }
      if ((r.spent[res] || 0) < total) done = false;
    }
  }
  if (done) {
    const id = r.id;
    state.researched.push(id);
    state.researching = null;
    return id;
  }
  return null;
}

// UI helper: { id, frac } progress of the active research, or null.
export function researchProgress(state) {
  const r = state.researching;
  if (!r) return null;
  const t = TECH[r.id];
  let spent = 0, total = 0;
  for (const [res, n] of Object.entries(t.cost)) { total += n; spent += Math.min(n, r.spent[res] || 0); }
  return { id: r.id, frac: total ? spent / total : 1 };
}

export function place(state, type, x, y) {
  if (!MACHINES[type]) throw new Error(`Unknown machine type: ${type}`);
  if (!isUnlocked(state, type)) throw new Error(`Machine not yet researched: ${type}`);
  const machine = { id: state.nextId++, type, x, y, active: true };
  state.machines.push(machine);
  if (state.stats) state.stats.machinesBuilt++;
  return machine;
}

// Advance the simulation one tick. Returns a list of feedback events so the UI
// layer can attach satisfying visual/audio feedback to each real state change.
export function applyTick(state) {
  state.tick++;
  const events = [];
  let residueDelta = 0;

  const worldEvt = tickWorldEvent(state);
  if (worldEvt) events.push(worldEvt);

  const doneTech = tickResearch(state);
  if (doneTech) events.push({ type: 'researched', id: doneTech });

  const outMult = outputMultiplier(state) * wonderOutputMult(state) * eventOutputMult(state);

  tickNodes(state);

  for (const m of state.machines) {
    const def = MACHINES[m.type];

    // Overclock doubles throughput (and input draw + residue) for burst output.
    const oc = m.overclock ? 2 : 1;
    // Installed Glyph module trade-offs (input/output/residue multipliers).
    const mod = MODULES[m.module] || {};
    const inMul = (mod.input ?? 1) * oc;
    const resMul = mod.residue ?? 1;

    // A machine runs only if not suppressed and every (modified) input is available.
    const canRun = !m.suppressed && Object.entries(def.inputs).every(
      ([res, rate]) => (state.resources[res] || 0) >= rate * inMul
    );

    m.active = canRun;
    if (!canRun) continue;

    // Flow bonus: each powered Automated Conduit adjacent to this machine boosts
    // its output throughput (+15% each, capped) — the conduit's spec role of
    // keeping high-throughput machines continuously fed.
    const flow = (1 + Math.min(0.6, 0.15 * adjacentConduits(state, m)))
      * (1 + Math.min(0.4, 0.08 * servicingWorkers(state, m)))
      * levelBonus(m) * outMult * oc * (mod.output ?? 1);

    for (const [res, rate] of Object.entries(def.inputs)) {
      state.resources[res] -= rate * inMul;
    }
    for (const [res, rate] of Object.entries(def.outputs)) {
      state.resources[res] = (state.resources[res] || 0) + rate * flow;
    }
    residueDelta += def.residue * levelBonus(m) * oc * resMul;
    events.push({ type: 'machine-active', id: m.id, machine: m.type });
  }

  tickGolems(state);
  const enemyResult = tickEnemies(state);
  events.push(...enemyResult.events);

  // Slow self-repair: damaged machines mend over time when not overwhelmed, so a
  // chipped factory recovers between waves rather than carrying permanent scars.
  for (const m of state.machines) {
    if (m.health != null && m.health < MACHINE_HEALTH) {
      m.health = Math.min(MACHINE_HEALTH, m.health + 0.05);
    }
  }

  state.residue += residueDelta * residueMultiplier(state) * wonderResidueMult(state) * eventResidueMult(state);
  // Passive dissipation (the environment absorbing pollution). This creates a
  // Factorio-style equilibrium: a steady factory settles at a steady residue
  // level (≈ generation / RESIDUE_DECAY), so the long run is sustainable and you
  // escalate threat by *expanding*, not merely by existing.
  state.residue = Math.max(0, state.residue * RESIDUE_DECAY);

  // Run statistics.
  if (state.stats) {
    for (const ev of enemyResult.events) {
      if (ev.type === 'enemy-slain') state.stats.enemiesSlain += ev.count;
    }
    if (state.residue > state.stats.peakResidue) state.stats.peakResidue = Math.floor(state.residue);
  }

  // Zone Purifier: a deliberate, toggleable sink. When engaged, it routes surplus
  // Glyphs into purification — a trade-off against research, upgrades, and modules,
  // which all also want Glyphs. Off by default so it never silently starves them.
  if (state.status === 'playing' && state.purifying && state.resources.glyph >= 1) {
    state.resources.glyph -= 1;
    state.purifier += wonderPurifyRate(state);
    // Purification actively scrubs pollution, easing the threat curve — but only
    // while you can spare the Glyphs the rest of the factory also wants.
    state.residue = Math.max(0, state.residue - CLEANSE_PER_GLYPH);
    // Milestone: completing a purification is a major reward, not an end. Play
    // continues; each purification scrubs a large chunk of residue and is logged
    // so the run can escalate indefinitely.
    if (state.purifier >= purifierGoal(state)) {
      state.residue = Math.max(0, state.residue - purifierGoal(state) * 4);
      state.purifier = 0;
      state.purifications += 1;
      state.perkPoints = (state.perkPoints || 0) + 1; // grant an ascension perk point
      events.push({ type: 'purified', total: state.purifications });
    }
  }
  // Defeat: the factory is wiped out.
  if (state.status === 'playing' && state.machines.length === 0 && state.tick > 5) {
    state.status = 'lost';
  }

  for (const a of checkAchievements(state)) {
    events.push({ type: 'achievement', id: a.id, name: a.name });
  }

  const doneObj = tickObjectives(state);
  if (doneObj) events.push({ type: 'objective', name: doneObj.name });

  return { events, residueDelta, tier: threatTierFor(state.residue), status: state.status };
}

// Deterministic snapshot the host broadcasts to peers (and for save/load).
export function snapshot(state) {
  return JSON.parse(JSON.stringify(state));
}

export function restore(state, snap) {
  // Merge the snapshot onto a fresh default base so any field absent from an
  // older save gets its current default rather than a stale value left over in
  // the live state object — keeping save migration robust as fields are added.
  const merged = createState();
  Object.assign(merged, JSON.parse(JSON.stringify(snap)));
  Object.assign(state, merged);
}
