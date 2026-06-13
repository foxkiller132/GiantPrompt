// Objectives — a guided sequence that gives the long single run direction, the
// way Factorio's tech ladder and milestones do. Objectives are ordered; the
// current one advances when its `test(state)` passes. They are guidance only and
// never gate anything. state.objective is the index of the current objective.

export const OBJECTIVES = [
  { id: 'glyphcraft',  name: 'Research Glyphcraft',          test: s => s.researched.includes('glyphcraft') },
  { id: 'carver',      name: 'Build a Glyph Carver',          test: s => s.machines.some(m => m.type === 'glyphCarver') },
  { id: 'logistics',   name: 'Research Arcane Logistics',     test: s => s.researched.includes('logistics') },
  { id: 'runecraft',   name: 'Research Runecraft',            test: s => s.researched.includes('runecraft') },
  { id: 'first_rune',  name: 'Forge your first Rune',         test: s => (s.resources.rune || 0) >= 1 },
  { id: 'aegis',       name: 'Research Aegis Protocols',      test: s => s.researched.includes('aegis') },
  { id: 'first_purify',name: 'Complete a Zone Purification',  test: s => (s.purifications || 0) >= 1 },
  { id: 'wonder',      name: 'Raise a Wonder',                test: s => (s.wonders || []).length >= 1 },
  { id: 'ascension3',  name: 'Reach Ascension 3',             test: s => (s.purifications || 0) >= 3 },
];

// Advance through any completed objectives. Returns the newly completed objective
// def (for a banner) or null. state.objective indexes the *current* objective.
export function tickObjectives(state) {
  if (state.objective == null) state.objective = 0;
  let completed = null;
  while (state.objective < OBJECTIVES.length && OBJECTIVES[state.objective].test(state)) {
    completed = OBJECTIVES[state.objective];
    state.objective += 1;
  }
  return completed;
}

export function currentObjective(state) {
  const i = state.objective || 0;
  return i < OBJECTIVES.length ? OBJECTIVES[i] : null;
}
