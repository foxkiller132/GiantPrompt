// Arcane Automata — bootstrap & game loop.
// Vanilla ES modules, zero runtime dependencies (per the minimal-stack mandate).

import { RESOURCES, MACHINES } from './data/gamedata.js';
import { createState, place, applyTick, seedNodes } from './core/state.js';
import { Panel } from './ui/panel.js';
import { BuildController } from './ui/build.js';
import { Sound, pulse, drawPulses } from './ui/feedback.js';

const TICK_MS = 1000;
const TILE = 64;

const state = createState();
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

// Seed a small starter factory so the simulation visibly does something.
place(state, 'elementalRefinery', 4, 4);
place(state, 'aetherCondenser', 6, 4);
place(state, 'arcaneTransmuter', 5, 6);
place(state, 'golemsmithHub', 7, 6);

// Natural raw-element nodes feed the refinery; a mana node feeds the condenser.
seedNodes(state, [
  { element: 'fire', x: 1, y: 2 }, { element: 'water', x: 10, y: 2 },
  { element: 'earth', x: 2, y: 9 }, { element: 'air', x: 9, y: 9 },
  { element: 'manaCrystal', x: 8, y: 2, rate: 0.5 },
]);

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ---- HUD -------------------------------------------------------------------
const resourceBar = document.getElementById('resource-bar');
const threatFill = document.getElementById('threat-fill');
const threatTier = document.getElementById('threat-tier');

function renderHud(tier) {
  resourceBar.innerHTML = Object.entries(state.resources)
    .filter(([, v]) => v > 0 || ['manaStream', 'component'].includes(0))
    .map(([key, v]) => {
      const r = RESOURCES[key];
      if (!r) return '';
      return `<span class="aa-res" title="${r.desc}">${r.icon}&nbsp;${Math.floor(v)}</span>`;
    }).join('');

  const pct = Math.min(100, (state.residue / 1000) * 100);
  threatFill.style.width = `${pct}%`;
  threatFill.style.background = tier.color;
  threatTier.textContent = `${tier.label} · ${Math.floor(state.residue)}`;
  threatTier.style.color = tier.color;

  const purFill = document.getElementById('purifier-fill');
  if (purFill) purFill.style.width = `${state.purifier}%`;

  const golemCount = document.getElementById('golem-count');
  if (golemCount) golemCount.textContent = String(state.golems.length);

  if (state.status !== 'playing' && !document.getElementById('aa-end')) {
    const won = state.status === 'won';
    const overlay = document.createElement('div');
    overlay.id = 'aa-end';
    overlay.className = 'aa-frame';
    overlay.innerHTML =
      `<h1>${won ? '⟡ Zone Purified' : '☠ Factory Overrun'}</h1>` +
      `<p>${won ? 'You sustained production and neutralized the arcane threat.'
                : 'The Arcane Residue summoned more than your defenses could hold.'}</p>`;
    document.body.appendChild(overlay);
  }
}

// ---- Panels (draggable, position-persisting) -------------------------------
function buildPanelBody(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

const panels = {
  inventory: new Panel('inventory', 'Resource Inventory', buildPanelBody(
    Object.values(RESOURCES).map(r =>
      `<div class="aa-row"><span>${r.icon} ${r.name}</span><em>${r.kind}</em></div>`).join(''))),
  blueprints: new Panel('blueprints', 'Blueprint Library', buildPanelBody(
    Object.entries(MACHINES).map(([key, m]) =>
      `<div class="aa-row aa-build" data-build="${key}" role="button" tabindex="0">` +
      `<span>${m.glyph} ${m.name}</span><em>${m.purpose}</em></div>`).join(''))),
  golems: new Panel('golems', 'Golem Console', buildPanelBody(
    '<p class="aa-note">Worker Golems are forged by the Golemsmith Hub and ' +
    'patrol routes between the nearest processing machines.</p>' +
    '<div class="aa-row"><span>Active Golems</span><em id="golem-count">0</em></div>')),
  network: new Panel('network', 'Network — P2P', buildPanelBody(
    '<p class="aa-note">Host acts as Designated Authority Client. ' +
    'WebRTC peer mesh planned; the authoritative tick already runs host-side.</p>')),
};

document.querySelectorAll('.aa-dock-btn').forEach(btn => {
  btn.addEventListener('click', () => panels[btn.dataset.panel].toggle());
});

// ---- Build / placement -----------------------------------------------------
const build = new BuildController(state, canvas, TILE, (m) => {
  Sound.place();
  pulse(m.x, m.y, '#c9a45a');
  renderHud(tier);
});

// Selecting a blueprint enters build mode (Shift+drop releases the tool).
document.querySelectorAll('.aa-build').forEach(row => {
  const pick = () => build.select(row.dataset.build);
  row.addEventListener('click', pick);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
});

// ---- World render ----------------------------------------------------------
function renderWorld() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Faint arcane grid.
  ctx.strokeStyle = 'rgba(120, 160, 220, 0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += TILE) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += TILE) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Raw-element nodes — faint crystalline deposits beneath the factory layer.
  for (const n of state.nodes) {
    const px = n.x * TILE + TILE / 2, py = n.y * TILE + TILE / 2;
    const depleted = n.reserve <= 0;
    ctx.save();
    ctx.globalAlpha = depleted ? 0.2 : 0.8;
    ctx.shadowBlur = depleted ? 0 : 14;
    ctx.shadowColor = RESOURCES[n.element]?.kind === 'resource' ? '#8fc0ff' : '#a0ffb0';
    ctx.fillStyle = '#dfe8ff';
    ctx.font = '22px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(RESOURCES[n.element]?.icon || '◆', px, py);
    ctx.restore();
  }

  // Portal link beam between the first two powered portals.
  const portals = state.machines.filter(m => m.type === 'portalGenerator' && m.active !== false);
  if (portals.length >= 2) {
    const a = portals[0], b = portals[1];
    ctx.save();
    ctx.strokeStyle = 'rgba(159, 120, 255, 0.4)';
    ctx.lineWidth = 3; ctx.setLineDash([6, 8]);
    ctx.shadowBlur = 10; ctx.shadowColor = '#9f78ff';
    ctx.beginPath();
    ctx.moveTo(a.x * TILE + TILE / 2, a.y * TILE + TILE / 2);
    ctx.lineTo(b.x * TILE + TILE / 2, b.y * TILE + TILE / 2);
    ctx.stroke();
    ctx.restore();
  }

  for (const m of state.machines) {
    const def = MACHINES[m.type];
    const px = m.x * TILE, py = m.y * TILE;

    // Conduits render as a slim glowing channel rather than a full machine block.
    if (m.type === 'automatedConduit') {
      ctx.save();
      ctx.shadowBlur = m.active ? 14 : 0; ctx.shadowColor = '#6fa8ff';
      ctx.fillStyle = m.active ? 'rgba(111,168,255,0.55)' : 'rgba(90,95,110,0.4)';
      ctx.fillRect(px + 6, py + TILE / 2 - 7, TILE - 12, 14);
      ctx.restore();
      continue;
    }

    const glow = m.active ? 18 : 0;
    ctx.save();
    ctx.shadowBlur = glow;
    ctx.shadowColor = '#6fa8ff';
    ctx.fillStyle = m.active ? 'rgba(40, 58, 96, 0.95)' : 'rgba(30, 34, 44, 0.9)';
    ctx.strokeStyle = m.active ? '#8fc0ff' : '#5a5f6e';
    ctx.lineWidth = 2;
    roundRect(ctx, px, py, TILE - 6, TILE - 6, 8);
    ctx.fill(); ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#dfe8ff';
    ctx.font = '26px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, px + (TILE - 6) / 2, py + (TILE - 6) / 2);
  }

  // Golems — small glowing motes patrolling their routes.
  for (const g of state.golems) {
    const px = g.x * TILE, py = g.y * TILE;
    ctx.save();
    ctx.shadowBlur = 10; ctx.shadowColor = '#9fffd0';
    ctx.fillStyle = '#cfffe6';
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Enemies — ember-red motes converging on the factory.
  for (const e of state.enemies) {
    const px = e.x * TILE, py = e.y * TILE;
    ctx.save();
    ctx.shadowBlur = 12; ctx.shadowColor = '#ff6b6b';
    ctx.fillStyle = '#ffb3b3';
    ctx.beginPath();
    ctx.arc(px, py, 5 + Math.min(6, e.power), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPulses(ctx, TILE, 1 / 60);
  build.drawGhost(ctx);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---- Loops -----------------------------------------------------------------
let tier;
let lastStatus = 'playing';
function simulationStep() {
  const result = applyTick(state);
  tier = result.tier;

  // Attach feedback to real state changes reported by the authoritative tick.
  for (const ev of result.events) {
    if (ev.type === 'enemy-slain') Sound.slain();
    else if (ev.type === 'machine-destroyed') {
      const m = state.machines.find(x => x.id === ev.machine);
      if (m) pulse(m.x, m.y, '#d35f5f');
    }
  }
  if (state.status !== lastStatus) {
    if (state.status === 'won') Sound.win();
    else if (state.status === 'lost') Sound.lose();
    lastStatus = state.status;
  }

  renderHud(tier);
}
setInterval(simulationStep, TICK_MS);

function frame() {
  renderWorld();
  requestAnimationFrame(frame);
}
simulationStep();
frame();
