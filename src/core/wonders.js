// Wonders — late-game mega-projects. Each is built once per run from a large
// resource investment and grants a powerful, permanent effect. They are major
// goals for a long session: prestige sinks that reshape the endgame. Effects are
// read back at the relevant simulation sites, keeping this the source of truth.

export const WONDERS = [
  { id: 'aetherNexus',   name: 'Aether Nexus',   cost: { rune: 30, component: 40, manaStream: 200 }, desc: '+40% output from all machines.' },
  { id: 'voidConduit',   name: 'Void Conduit',   cost: { rune: 35, component: 30, glyph: 20 },        desc: '-40% Arcane Residue generated.' },
  { id: 'sanctumWall',   name: 'Sanctum Wall',   cost: { rune: 50, ingot: 60 },                       desc: '+100% defensive structure damage.' },
  { id: 'grandPurifier', name: 'Grand Purifier', cost: { rune: 40, glyph: 60 },                       desc: 'Purification progresses twice as fast.' },
];

export function hasWonder(state, id) { return (state.wonders || []).includes(id); }

export function canBuildWonder(state, id) {
  const w = WONDERS.find(x => x.id === id);
  if (!w || hasWonder(state, id)) return false;
  return Object.entries(w.cost).every(([res, n]) => (state.resources[res] || 0) >= n);
}

export function buildWonder(state, id) {
  if (!canBuildWonder(state, id)) return false;
  for (const [res, n] of Object.entries(WONDERS.find(x => x.id === id).cost)) state.resources[res] -= n;
  state.wonders ||= [];
  state.wonders.push(id);
  return true;
}

// ---- Effect getters ---------------------------------------------------------
export const wonderOutputMult  = (state) => hasWonder(state, 'aetherNexus')  ? 1.4 : 1;
export const wonderResidueMult = (state) => hasWonder(state, 'voidConduit')  ? 0.6 : 1;
export const wonderDefenseMult = (state) => hasWonder(state, 'sanctumWall')  ? 2 : 1;
export const wonderPurifyRate  = (state) => hasWonder(state, 'grandPurifier') ? 2 : 1;
