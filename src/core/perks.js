// Ascension Perks — a second progression axis for the endless loop.
//
// Each completed Purification grants one perk point (state.perkPoints). Points are
// spent to permanently level perks for the current run (state.perks: id -> level).
// Effects are read back through perkLevel() at the relevant simulation sites, so
// the data here stays the single source of truth and the sim stays deterministic.

export const PERKS = [
  { id: 'efficiency', name: 'Arcane Efficiency', max: 5, per: '+10% machine output',     desc: 'All machines produce more per tick.' },
  { id: 'wardmaster', name: 'Wardmaster',        max: 5, per: '+15% defense damage',      desc: 'Ward Towers and Aegis Spires hit harder.' },
  { id: 'purity',     name: 'Purifying Craft',   max: 5, per: '-8% residue generated',    desc: 'Machines emit less Arcane Residue.' },
  { id: 'swiftness',  name: 'Golem Swiftness',   max: 5, per: '+20% combat golem speed',  desc: 'Combat golems hunt enemies faster.' },
];

const MAX = Object.fromEntries(PERKS.map(p => [p.id, p.max]));

export function perkLevel(state, id) {
  return (state.perks && state.perks[id]) || 0;
}

export function canSpendPerk(state, id) {
  return (state.perkPoints || 0) >= 1 && perkLevel(state, id) < (MAX[id] || 0);
}

export function spendPerk(state, id) {
  if (!canSpendPerk(state, id)) return false;
  state.perks ||= {};
  state.perks[id] = perkLevel(state, id) + 1;
  state.perkPoints -= 1;
  return true;
}

// ---- Effect getters (used by the simulation) --------------------------------
export const outputMultiplier  = (state) => 1 + 0.10 * perkLevel(state, 'efficiency');
export const defenseMultiplier = (state) => 1 + 0.15 * perkLevel(state, 'wardmaster');
export const residueMultiplier = (state) => Math.max(0, 1 - 0.08 * perkLevel(state, 'purity'));
export const golemSpeedBonus   = (state) => 0.044 * perkLevel(state, 'swiftness'); // +20% of base 0.22 per level
