// Enemy spawning & combat — driven strictly by Arcane Residue.
//
// Per the Threat Escalation Curve, both spawn frequency and enemy power scale
// with total residue. Enemies path toward the nearest machine and, on contact,
// sabotage it: stealing resources (early) up to disabling/damaging core nodes
// (late). All resolution is deterministic and centralized so the host/DAC remains
// the sole authority over combat outcomes.

import { threatTierFor, MACHINES } from '../data/gamedata.js';

const ENEMY_SPEED = 0.08;
const CONTACT = 0.4;        // tiles
const MAX_ENEMIES = 40;
const BOSS_EVERY = 90;      // ticks between boss assaults at the late tier

// Per-tier combatants. `power` drives sabotage severity; `loot` is resource theft.
const ROSTER = {
  calm:  [],
  early: [{ name: 'Goblin', hp: 3,  power: 1, loot: 2 }],
  mid:   [{ name: 'Orc', hp: 8, power: 3, loot: 4 }, { name: 'Wraith', hp: 6, power: 4, loot: 3 }],
  late:  [{ name: 'Dragon', hp: 24, power: 9, loot: 8 }, { name: 'Lich', hp: 20, power: 8, loot: 6 }],
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

  // --- Spawning: chance rises with residue and ascension ------------------
  if (roster.length && state.enemies.length < MAX_ENEMIES) {
    const spawnChance = Math.min(0.85, (state.residue / 4000) * asc);
    if (rng() < spawnChance) {
      const proto = scale(roster[Math.floor(rng() * roster.length)]);
      const edge = spawnEdge(state, rng);
      state.enemies.push({ id: state.nextId++, ...proto, maxHp: proto.hp, x: edge.x, y: edge.y });
    }
  }

  // --- Boss waves: at the late tier, periodically unleash a single Elder boss --
  if (tier.id === 'late' && state.tick % BOSS_EVERY === 0 &&
      !state.enemies.some(e => e.isBoss)) {
    const boss = scale(rng() < 0.5
      ? { name: 'Elder Lich', hp: 140, power: 14, loot: 12 }
      : { name: 'Ancient Dragon', hp: 180, power: 18, loot: 14 });
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
    if (best) best.hp -= dmg;
  }
  // --- Active defense: any powered defensive structure (def.range/def.damage)
  // blasts the nearest enemy in range. Generalized so new towers/spires work. --
  for (const tower of state.machines.filter(m => MACHINES[m.type].damage && m.active !== false)) {
    const def = MACHINES[tower.type];
    const tx = tower.x + 0.5, ty = tower.y + 0.5;
    let best = null, bestD = def.range;
    for (const e of state.enemies) {
      const d = Math.hypot(e.x - tx, e.y - ty);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) { best.hp -= def.damage; tower.firingAt = { x: best.x, y: best.y }; }
    else tower.firingAt = null;
  }

  const slain = state.enemies.filter(e => e.hp <= 0).length;
  if (slain) events.push({ type: 'enemy-slain', count: slain });
  state.enemies = state.enemies.filter(e => e.hp > 0);

  // --- Movement + sabotage on contact -------------------------------------
  for (const e of state.enemies) {
    const target = nearestMachine(state, e);
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
      target.health = (target.health ?? 10) - e.power;
      events.push({ type: 'sabotage', enemy: e.name, machine: target.id });
      if (target.health <= 0) {
        state.machines = state.machines.filter(m => m.id !== target.id);
        events.push({ type: 'machine-destroyed', machine: target.id });
      }
    } else {
      e.x += (dx / dist) * ENEMY_SPEED;
      e.y += (dy / dist) * ENEMY_SPEED;
    }
  }
  return { events, tier };
}

function spawnEdge(state, rng) {
  // Spawn just off one of the four map edges relative to the factory centroid.
  const side = Math.floor(rng() * 4);
  const span = 24;
  if (side === 0) return { x: rng() * span, y: -1 };
  if (side === 1) return { x: span, y: rng() * span };
  if (side === 2) return { x: rng() * span, y: span };
  return { x: -1, y: rng() * span };
}

function nearestMachine(state, e) {
  let best = null, bestD = Infinity;
  for (const m of state.machines) {
    const d = Math.hypot(m.x - e.x, m.y - e.y);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}
