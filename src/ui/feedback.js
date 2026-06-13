// Interaction feedback — satisfying audio + visual response for core actions.
//
// Audio is synthesized live via the WebAudio API (zero dependencies, per the
// minimal-stack mandate). Visuals are short-lived canvas "pulses" the render loop
// draws and ages out. The AudioContext is created lazily on first user gesture so
// browsers don't block it.

let actx = null;
let muted = localStorage.getItem('aa:muted') === '1';
let volume = clamp01(parseFloat(localStorage.getItem('aa:volume') ?? '0.8'));

function clamp01(v) { return Math.max(0, Math.min(1, isNaN(v) ? 0.8 : v)); }

export function isMuted() { return muted; }
export function setMuted(on) {
  muted = on;
  localStorage.setItem('aa:muted', on ? '1' : '0');
}
export function getVolume() { return volume; }
export function setVolume(v) {
  volume = clamp01(v);
  localStorage.setItem('aa:volume', String(volume));
}

function audio() {
  if (muted) return null;
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}

// Small arcane chime: a quick sine/triangle blip with an exponential decay.
function chime(freq, { dur = 0.18, type = 'sine', gain = 0.12 } = {}) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const peak = Math.max(0.0001, gain * volume);
  env.gain.setValueAtTime(0.0001, ac.currentTime);
  env.gain.exponentialRampToValueAtTime(peak, ac.currentTime + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(env).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

// Named cues for the core actions called out in the spec.
export const Sound = {
  place:   () => chime(523.25, { type: 'triangle' }),                 // machine placed
  activate:() => chime(659.25, { dur: 0.12, gain: 0.06 }),            // machine activation
  collect: () => chime(783.99, { type: 'sine', dur: 0.1, gain: 0.08 }),// resource collection
  portal:  () => { chime(440); setTimeout(() => chime(880), 70); },   // portal transfer
  slain:   () => chime(196, { type: 'sawtooth', dur: 0.2, gain: 0.08 }),// enemy slain
  win:     () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => chime(f, { dur: 0.3 }), i * 140)),
  lose:    () => [392, 311, 233].forEach((f, i) => setTimeout(() => chime(f, { type: 'sawtooth', dur: 0.35 }), i * 160)),
};

// Visual pulses: transient rings the world render layer draws and ages.
const pulses = [];
export function pulse(x, y, color = '#8fc0ff') {
  pulses.push({ x, y, color, life: 1 });
}
export function drawPulses(ctx, tile, dt) {
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.life -= dt * 2.2;
    if (p.life <= 0) { pulses.splice(i, 1); continue; }
    const px = p.x * tile + tile / 2, py = p.y * tile + tile / 2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, (1 - p.life) * tile, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
