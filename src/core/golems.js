// Golem unit system.
//
// The Golemsmith Hub periodically forges Worker Golems (consuming its spec inputs).
// Golems are programmed via Glyphs to service a route: they travel between the two
// nearest processing machines, and while active they grant a small throughput bonus
// to the machine they're currently servicing — the first concrete payoff of the
// semi-automated mid game. Movement is deterministic so the DAC stays authoritative.

import { MACHINES } from '../data/gamedata.js';

const FORGE_EVERY = 6;      // ticks between golem production
const GOLEM_SPEED = 0.15;   // tiles per tick
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
      state.golems.push({
        id: state.nextId++, kind: 'worker',
        x: hub.x + 0.5, y: hub.y + 0.5,
        route: assignRoute(state, hub), leg: 0,
      });
    }
  }

  // --- Movement: advance each golem toward its current waypoint ------------
  for (const g of state.golems) {
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
