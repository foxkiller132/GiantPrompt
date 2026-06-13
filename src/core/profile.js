// Lifetime player profile — meta-progression that persists across all runs and
// save slots. Unlike per-run state (which lives in saves), this is a single
// account-wide tally stored separately in localStorage, surfaced on the main menu
// to reward continued play over a long campaign.

const KEY = 'aa:profile';
const DEFAULT = { runs: 0, purifications: 0, enemiesSlain: 0, bestAscension: 0, playTicks: 0 };

export function getProfile() {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULT }; }
}

function save(p) { localStorage.setItem(KEY, JSON.stringify(p)); }

export function recordRunStarted() { const p = getProfile(); p.runs += 1; save(p); }
export function recordPurification(level) {
  const p = getProfile();
  p.purifications += 1;
  if (level > p.bestAscension) p.bestAscension = level;
  save(p);
}
export function recordSlain(n) { const p = getProfile(); p.enemiesSlain += n; save(p); }
export function recordPlayTicks(n) { const p = getProfile(); p.playTicks += n; save(p); }
