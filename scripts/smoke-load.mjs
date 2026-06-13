// Smoke test: load src/main.js under a stubbed DOM/Canvas and fail if the module
// throws during evaluation. Catches the class of bug where a top-level call hits
// the temporal dead zone of a later `const`/`let`, aborting module evaluation so
// event handlers never attach (e.g. the menu buttons going inert).
//
// Run: node scripts/smoke-load.mjs
//
// This is not a substitute for real in-browser testing — it only verifies the
// module initializes top-to-bottom without throwing. Interaction-time behavior
// still needs a browser.

const store = {};
const makeEl = () => new Proxy(function () {}, {
  get(t, p) {
    if (p === 'style') return new Proxy({}, { get: () => '', set: () => true });
    if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    if (p === 'dataset') return {};
    if (p === 'getContext') return () => new Proxy({}, { get() { return () => {}; } });
    if (p === 'querySelectorAll') return () => [];
    if (p === 'querySelector') return () => makeEl();
    if (p === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 800, height: 600 });
    if (['addEventListener', 'removeEventListener', 'appendChild', 'remove',
         'setAttribute', 'focus', 'blur', 'play', 'insertBefore'].includes(p)) return () => {};
    if (p === 'children' || p === 'childNodes') return [];
    if (p === 'hidden') return true;
    if (p in t) return t[p];
    return makeEl();
  },
  set(t, p, v) { t[p] = v; return true; },
});
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
globalThis.document = new Proxy({}, {
  get(t, p) {
    if (p === 'getElementById' || p === 'querySelector') return () => makeEl();
    if (p === 'querySelectorAll') return () => [];
    if (p === 'createElement') return () => makeEl();
    if (p === 'addEventListener') return () => {};
    if (p === 'body') return makeEl();
    return makeEl();
  },
});
globalThis.window = globalThis;
globalThis.innerWidth = 800;
globalThis.innerHeight = 600;
globalThis.addEventListener = () => {};
globalThis.AudioContext = function () { return new Proxy({}, { get() { return () => ({}); } }); };
globalThis.requestAnimationFrame = () => 0;
globalThis.performance = { now: () => 0 };

try {
  await import('../src/main.js');
  console.log('✓ smoke-load: main.js initialized without throwing');
} catch (e) {
  console.error('✗ smoke-load FAILED — main.js threw during module evaluation:');
  console.error(e.stack || e.message);
  process.exit(1);
}
