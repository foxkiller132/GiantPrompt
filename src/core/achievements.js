// Achievement milestones.
//
// Each achievement has a `test(state)` predicate evaluated every tick. Newly
// satisfied ones are recorded in state.achievements (so they persist in saves)
// and surfaced as events for a banner + sound. Predicates read only derived run
// state, so they stay deterministic and host-authoritative.

export const ACHIEVEMENTS = [
  { id: 'first_machine', name: 'Groundbreaker',  desc: 'Build your first machine.',        test: s => s.stats?.machinesBuilt >= 1 },
  { id: 'industrialist', name: 'Industrialist',  desc: 'Build 25 machines in a run.',       test: s => s.stats?.machinesBuilt >= 25 },
  { id: 'first_blood',   name: 'First Blood',    desc: 'Slay an enemy.',                    test: s => s.stats?.enemiesSlain >= 1 },
  { id: 'exterminator',  name: 'Exterminator',   desc: 'Slay 250 enemies.',                 test: s => s.stats?.enemiesSlain >= 250 },
  { id: 'first_purify',  name: 'Cleanser',       desc: 'Complete a Zone Purification.',     test: s => (s.purifications || 0) >= 1 },
  { id: 'ascendant',     name: 'Ascendant',      desc: 'Reach 5 purifications (ascension 5).', test: s => (s.purifications || 0) >= 5 },
  { id: 'high_residue',  name: 'Walking the Edge',desc: 'Survive a peak residue of 2000.',   test: s => s.stats?.peakResidue >= 2000 },
  { id: 'survivor',      name: 'Long Haul',      desc: 'Sustain a run for 30 minutes.',     test: s => s.tick >= 1800 },
];

// Record any newly satisfied achievements on the state and return their defs.
export function checkAchievements(state) {
  state.achievements ||= [];
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (!state.achievements.includes(a.id) && a.test(state)) {
      state.achievements.push(a.id);
      unlocked.push(a);
    }
  }
  return unlocked;
}
