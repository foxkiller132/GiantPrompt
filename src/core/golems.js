// Golem unit system.
//
// The Golemsmith Hub periodically forges Worker Golems (consuming its spec inputs).
// Golems are programmed via Glyphs to service a route: they travel between the two
// nearest processing machines, and while active they grant a small throughput bonus
// to the machine they're currently servicing — the first concrete payoff of the
// semi-automated mid game. Movement is deterministic so the DAC stays authoritative.

import { MACHINES } from '../data/gamedata.js';
import { golemSpeedBonus } from './perks.js';

const FORGE_EVERY = 6;      // ticks between golem production
const GOLEM_SPEED = 0.15;   // tiles per tick (workers)
const COMBAT_SPEED = 0.22;  // combat golems are faster hunters
const MINE_BONUS = 1;       // extra element extracted per tick by a stationed miner
const MAX_GOLEMS = 12;

export function tickGolems(state) {
  // --- Production: each Golemsmith Hub forges a worker on cadence ----------
  for (const hub of state.machines.filter(m => m.type === 'golemsmithHub')) {
    const def = MACHINES.golemsmithHub;
    const ready = state.tick % FORGE_EVERY === 0;
    const affordable = Object.entries(def.inputs)
      .every(([r, rate]) => (state.resources[r] || 0) >= rate);
    if (ready && affordable && state.golems.length < MAX_GOLEMS) {
      for (const [r, rate] of Object.entries(def.inputs)) state.resources[r] -= rate;
      // Forge a Combat Golem when enemies threaten and few are deployed; otherwise
      // a Worker that patrols the production route.
      const combatCount = state.golems.filter(g => g.kind === 'combat').length;
      const miningCount = state.golems.filter(g => g.kind === 'mining').length;
      const wantCombat = (state.enemies?.length || 0) > 0 && combatCount < 4;
      const wantMining = !wantCombat && miningCount < 3 &&
        (state.nodes || []).some(n => n.reserve > 0);
      let golem;
      if (wantCombat) golem = { id: state.nextId++, kind: 'combat', x: hub.x + 0.5, y: hub.y + 0.5 };
      else if (wantMining) golem = { id: state.nextId++, kind: 'mining', x: hub.x + 0.5, y: hub.y + 0.5 };
      else golem = { id: state.nextId++, kind: 'worker', x: hub.x + 0.5, y: hub.y + 0.5,
                     route: assignRoute(state, hub), leg: 0 };
      state.golems.push(golem);
    }
  }

  // --- Movement -----------------------------------------------------------
  for (const g of state.golems) {
    if (g.kind === 'combat') {
      // Hunt the nearest enemy; idle near the hub if none remain.
      let target = null, bestD = Infinity;
      for (const e of state.enemies || []) {
        const d = Math.hypot(e.x - g.x, e.y - g.y);
        if (d < bestD) { bestD = d; target = e; }
      }
      if (!target) continue;
      const dx = target.x - g.x, dy = target.y - g.y;
      const dist = Math.hypot(dx, dy) || 1;
      const cspeed = COMBAT_SPEED + golemSpeedBonus(state);
      if (dist > 0.4) { g.x += (dx / dist) * cspeed; g.y += (dy / dist) * cspeed; }
      continue;
    }
    if (g.kind === 'mining') {
      // Travel to the nearest live node; while stationed, boost its extraction.
      let node = null, bestD = Infinity;
      for (const n of state.nodes || []) {
        if (n.reserve <= 0) continue;
        const d = Math.hypot((n.x + 0.5) - g.x, (n.y + 0.5) - g.y);
        if (d < bestD) { bestD = d; node = n; }
      }
      if (!node) continue;
      const dx = (node.x + 0.5) - g.x, dy = (node.y + 0.5) - g.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > 0.4) { g.x += (dx / dist) * GOLEM_SPEED; g.y += (dy / dist) * GOLEM_SPEED; }
      else {
        const bonus = Math.min(MINE_BONUS, node.reserve);
        state.resources[node.element] = (state.resources[node.element] || 0) + bonus;
        node.reserve -= bonus;
      }
      continue;
    }
    // Workers patrol their assigned route.
    if (!g.route || g.route.length < 2) continue;
    const target = g.route[g.leg];
    const dx = target.x - g.x, dy = target.y - g.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= GOLEM_SPEED) {
      g.x = target.x; g.y = target.y;
      g.leg = (g.leg + 1) % g.route.length; // patrol the loop
    } else {
      g.x += (dx / dist) * GOLEM_SPEED;
      g.y += (dy / dist) * GOLEM_SPEED;
    }
  }

  // --- Portal teleport: a golem reaching a powered portal emerges at its link --
  const portals = state.machines.filter(m => m.type === 'portalGenerator' && m.active !== false);
  if (portals.length >= 2) {
    for (const g of state.golems) {
      if (g.portalCooldown > 0) { g.portalCooldown--; continue; }
      for (let i = 0; i < portals.length; i++) {
        const p = portals[i];
        if (Math.hypot((p.x + 0.5) - g.x, (p.y + 0.5) - g.y) <= 0.45) {
          const exit = portals[(i + 1) % portals.length];
          g.x = exit.x + 0.5; g.y = exit.y + 0.5;
          g.portalCooldown = 8; // ticks before it can re-enter a portal
          break;
        }
      }
    }
  }
}

// Route = waypoints at the two nearest processing machines to the hub.
function assignRoute(state, hub) {
  const targets = state.machines
    .filter(m => m.id !== hub.id && MACHINES[m.type].category === 'processing')
    .map(m => ({ x: m.x + 0.5, y: m.y + 0.5, d: Math.hypot(m.x - hub.x, m.y - hub.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .map(({ x, y }) => ({ x, y }));
  return [{ x: hub.x + 0.5, y: hub.y + 0.5 }, ...targets];
}
