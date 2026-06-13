// Enemy spawning & combat — driven strictly by Arcane Residue.
//
// Per the Threat Escalation Curve, both spawn frequency and enemy power scale
// with total residue. Enemies path toward the nearest machine and, on contact,
// sabotage it: stealing resources (early) up to disabling/damaging core nodes
// (late). All resolution is deterministic and centralized so the host/DAC remains
// the sole authority over combat outcomes.

import { threatTierFor, MACHINES, MACHINE_HEALTH } from '../data/gamedata.js';
import { defenseMultiplier } from './perks.js';
import { wonderDefenseMult } from './wonders.js';
import { eventSpawnMult } from './events.js';

const ENEMY_SPEED = 0.08;
const CONTACT = 0.4;        // tiles
const MAX_ENEMIES = 40;
const BOSS_EVERY = 90;      // ticks between boss assaults at the late tier

// Per-tier combatants. `power` drives sabotage severity; `loot` is resource theft.
// `speed` (tiles/tick) is optional; defaults to ENEMY_SPEED. Fast raiders pressure
// the factory quickly; armored brutes soak defense fire.
const ROSTER = {
  calm:  [],
  early: [{ name: 'Goblin', hp: 3,  power: 1, loot: 2 },
          { name: 'Imp', hp: 2, power: 1, loot: 5, speed: 0.16 }],
  mid:   [{ name: 'Orc', hp: 8, power: 3, loot: 4 },
          { name: 'Wraith', hp: 6, power: 4, loot: 3, speed: 0.12 },
          { name: 'Brute', hp: 22, power: 5, loot: 4, speed: 0.05 }],
  late:  [{ name: 'Dragon', hp: 24, power: 9, loot: 8 },
          { name: 'Lich', hp: 20, power: 8, loot: 6 },
          { name: 'Basilisk', hp: 44, power: 7, loot: 5, speed: 0.045 }],
};

export function tickEnemies(state, rng = Math.random) {
  const tier = threatTierFor(state.residue);
  const roster = ROSTER[tier.id];
  state.enemies ||= [];

  // Ascension scaling: each completed Purification permanently ramps the threat,
  // so the endless run keeps getting harder even though purifying dumps residue.
  // hp/power scale up; spawn cadence tightens.
  const asc = 1 + (state.purifications || 0) * 0.3;
  const scale = (proto) => ({
    ...proto, hp: Math.round(proto.hp * asc), power: Math.round(proto.power * asc),
  });

  // --- Spawning: chance rises with residue, ascension, and difficulty -----
  const diff = state.difficulty || 1;
  if (roster.length && state.enemies.length < MAX_ENEMIES) {
    const spawnChance = Math.min(0.9, (state.residue / 12000) * asc * diff * eventSpawnMult(state));
    if (rng() < spawnChance) {
      const proto = scale(roster[Math.floor(rng() * roster.length)]);
      const edge = spawnEdge(state, rng);
      const e = { id: state.nextId++, ...proto, maxHp: proto.hp, x: edge.x, y: edge.y };
      // Elite modifier: chance rises with ascension. Shielded soaks damage;
      // regenerating heals over time — both demand stronger focus-fire.
      if (tier.id !== 'early' && rng() < Math.min(0.3, 0.08 * asc)) {
        if (rng() < 0.5) { e.shielded = 0.5; e.name = 'Shielded ' + e.name; }
        else { e.regen = Math.max(0.3, e.maxHp * 0.01); e.name = 'Vile ' + e.name; }
      }
      state.enemies.push(e);
    }
  }

  // --- Boss waves: at the late tier, periodically unleash a single Elder boss --
  if (tier.id === 'late' && state.tick % BOSS_EVERY === 0 &&
      !state.enemies.some(e => e.isBoss)) {
    const roll = rng();
    const proto = roll < 0.34 ? { name: 'Elder Lich', hp: 140, power: 14, loot: 12 }
      : roll < 0.67 ? { name: 'Ancient Dragon', hp: 180, power: 18, loot: 14 }
      : { name: 'Hex Tyrant', hp: 160, power: 10, loot: 10, suppress: 3.5 }; // disables nearby machines
    const boss = { ...scale(proto), suppress: proto.suppress };
    const edge = spawnEdge(state, rng);
    state.enemies.push({ id: state.nextId++, ...boss, maxHp: boss.hp, isBoss: true, x: edge.x, y: edge.y });
  }

  // --- Defense: golems within range strike the nearest enemy --------------
  const events = [];
  for (const g of state.golems || []) {
    const range = g.kind === 'combat' ? 1.6 : 1.2;
    const dmg = g.kind === 'combat' ? 5 : 2; // combat golems hit harder
    let best = null, bestD = range;
    for (const e of state.enemies) {
      const d = Math.hypot(e.x - g.x, e.y - g.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) best.hp -= dmg * (best.shielded ? (1 - best.shielded) : 1);
  }
  // --- Active defense: any powered defensive structure (def.range/def.damage)
  // blasts the nearest enemy in range. Generalized so new towers/spires work. --
  const defMult = defenseMultiplier(state) * wonderDefenseMult(state);
  for (const tower of state.machines.filter(m => MACHINES[m.type].damage && m.active !== false)) {
    const def = MACHINES[tower.type];
    const tx = tower.x + 0.5, ty = tower.y + 0.5;
    let best = null, bestD = def.range;
    for (const e of state.enemies) {
      const d = Math.hypot(e.x - tx, e.y - ty);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      best.hp -= def.damage * defMult * (best.shielded ? (1 - best.shielded) : 1);
      tower.firingAt = { x: best.x, y: best.y };
    } else tower.firingAt = null;
  }

  // Regenerating elites heal a little each tick (never above their max).
  for (const e of state.enemies) {
    if (e.regen && e.hp > 0) e.hp = Math.min(e.maxHp, e.hp + e.regen);
  }

  const slain = state.enemies.filter(e => e.hp <= 0).length;
  if (slain) events.push({ type: 'enemy-slain', count: slain });
  state.enemies = state.enemies.filter(e => e.hp > 0);

  // --- Movement + sabotage on contact -------------------------------------
  for (const e of state.enemies) {
    // Bosses make for the economy core (Condenser/Transmuter) per the spec's
    // "targeting core production nodes"; lesser foes hit the nearest machine.
    const target = (e.isBoss && nearestCore(state, e)) || nearestMachine(state, e);
    if (!target) continue;
    const dx = (target.x + 0.5) - e.x, dy = (target.y + 0.5) - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= CONTACT) {
      // Sabotage: steal resources and degrade the machine.
      for (const r of ['manaStream', 'component', 'refined', 'glyph']) {
        if (state.resources[r] > 0) {
          state.resources[r] = Math.max(0, state.resources[r] - e.loot);
          break;
        }
      }
      target.health = (target.health ?? MACHINE_HEALTH) - e.power;
      events.push({ type: 'sabotage', enemy: e.name, machine: target.id });
      if (target.health <= 0) {
        state.machines = state.machines.filter(m => m.id !== target.id);
        events.push({ type: 'machine-destroyed', machine: target.id });
      }
    } else {
      const sp = e.speed || ENEMY_SPEED;
      e.x += (dx / dist) * sp;
      e.y += (dy / dist) * sp;
    }
  }
  // --- Suppression: a Hex Tyrant disables machines within its aura (next tick) --
  const suppressors = state.enemies.filter(e => e.suppress);
  for (const m of state.machines) {
    m.suppressed = suppressors.some(b =>
      Math.hypot((m.x + 0.5) - b.x, (m.y + 0.5) - b.y) <= b.suppress);
  }

  return { events, tier };
}

function factoryCentroid(state) {
  const ms = state.machines;
  if (!ms.length) return { x: 17, y: 11 };
  let sx = 0, sy = 0;
  for (const m of ms) { sx += m.x; sy += m.y; }
  return { x: sx / ms.length, y: sy / ms.length };
}

function spawnEdge(state, rng) {
  // Spawn on a ring around the factory centroid, from a random direction, so foes
  // always converge from the surrounding edges relative to wherever you build —
  // independent of world size or which expansion area you've settled.
  const c = factoryCentroid(state);
  const radius = 16 + rng() * 6;
  const a = rng() * Math.PI * 2;
  return { x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius };
}

const CORE_TYPES = new Set(['aetherCondenser', 'arcaneTransmuter']);
function nearestCore(state, e) {
  let best = null, bestD = Infinity;
  for (const m of state.machines) {
    if (!CORE_TYPES.has(m.type)) continue;
    const d = Math.hypot(m.x - e.x, m.y - e.y);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

function nearestMachine(state, e) {
  let best = null, bestD = Infinity;
  for (const m of state.machines) {
    const d = Math.hypot(m.x - e.x, m.y - e.y);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}
