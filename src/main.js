// Arcane Automata — bootstrap & game loop.
// Vanilla ES modules, zero runtime dependencies (per the minimal-stack mandate).

import { RESOURCES, MACHINES, threatTierFor } from './data/gamedata.js';
import { createState, place, applyTick, seedNodes, upgrade, upgradeCost, snapshot, restore, isUnlocked, research, canResearch, removeMachine } from './core/state.js';
import { TECH } from './data/gamedata.js';
import { Panel } from './ui/panel.js';
import { BuildController } from './ui/build.js';
import { Sound, pulse, drawPulses, isMuted, setMuted } from './ui/feedback.js';
import { Net } from './net/p2p.js';
import { saveGame, loadGame, hasSave } from './core/save.js';

const TICK_MS = 1000;
const TILE = 64;

const state = createState();
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

// Seed a small starter factory. Synthesis is pre-researched so the Transmuter is
// buildable from the start; the rest of the tech tree is the player's to unlock.
state.researched.push('synthesis');
place(state, 'elementalRefinery', 4, 4);
place(state, 'aetherCondenser', 6, 4);
place(state, 'arcaneTransmuter', 5, 6);

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

  refreshBlueprintLocks();
  refreshResearch();

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
  research: new Panel('research', 'Research — Arcane Transmuter', buildResearchBody()),
  network: new Panel('network', 'Network — P2P', buildNetworkBody()),
};

function buildResearchBody() {
  const el = document.createElement('div');
  el.innerHTML = '<p class="aa-note">Spend resources at the Transmuter to unlock ' +
    'higher-tier machines.</p><div id="tech-list"></div>';
  return el;
}

// Render the tech list with affordability/lock state; called each tick.
function refreshResearch() {
  const list = document.getElementById('tech-list');
  if (!list) return;
  list.innerHTML = Object.entries(TECH).map(([id, t]) => {
    const done = state.researched.includes(id);
    const ok = !done && canResearch(state, id);
    const cost = Object.entries(t.cost).map(([r, n]) => `${n} ${r}`).join(', ');
    const cls = done ? 'is-done' : ok ? 'is-ready' : 'is-locked';
    const label = done ? 'Researched ✓' : `Research (${cost})`;
    return `<div class="aa-row aa-tech ${cls}" data-tech="${id}" role="button" tabindex="0">` +
      `<span>${t.name}</span><em>${label}</em></div>`;
  }).join('');
  list.querySelectorAll('.aa-tech.is-ready').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.tech;
      if (net.role === 'guest' && net.connected) { net.sendIntent('research', { tech: id }); return; }
      if (research(state, id)) { Sound.portal(); refreshResearch(); }
    });
  });
}

// Network panel: manual-signaling WebRTC. Host generates an offer; guest pastes
// it and returns an answer; host pastes the answer to connect.
function buildNetworkBody() {
  const el = document.createElement('div');
  el.innerHTML = `
    <p class="aa-note">Host = Designated Authority Client. No server: copy/paste
    the codes to connect a peer.</p>
    <div class="aa-net-status">Status: <em id="net-status">solo</em></div>
    <div class="aa-net-actions">
      <button id="net-host" class="aa-dock-btn">Host</button>
      <button id="net-join" class="aa-dock-btn">Join</button>
    </div>
    <label class="aa-net-field">Your code (share this)
      <textarea id="net-local" rows="2" readonly placeholder="—"></textarea></label>
    <label class="aa-net-field">Peer code (paste here)
      <textarea id="net-remote" rows="2" placeholder="paste peer code"></textarea></label>
    <button id="net-apply" class="aa-dock-btn">Apply Peer Code</button>`;
  return el;
}

function wireNetworkPanel() {
  const status = document.getElementById('net-status');
  const local = document.getElementById('net-local');
  const remote = document.getElementById('net-remote');
  net.onStatus = (s) => { status.textContent = `${net.role || 'solo'} · ${s}`; };

  document.getElementById('net-host').addEventListener('click', async () => {
    status.textContent = 'host · gathering…';
    local.value = await net.host();
    status.textContent = 'host · share your code, then apply the peer answer';
  });
  document.getElementById('net-join').addEventListener('click', () => {
    status.textContent = 'guest · paste the host code below, then Apply';
    net.role = 'guest-pending';
  });
  document.getElementById('net-apply').addEventListener('click', async () => {
    const code = remote.value.trim();
    if (!code) return;
    if (net.role === 'host') {
      await net.acceptAnswer(code);
      status.textContent = 'host · connecting…';
    } else {
      local.value = await net.join(code);
      status.textContent = 'guest · send this answer back to the host';
    }
  });
}
wireNetworkPanel();

document.querySelectorAll('#dock .aa-dock-btn[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => panels[btn.dataset.panel].toggle());
});

// Sound mute toggle.
const muteBtn = document.getElementById('dock-mute');
function refreshMute() { muteBtn.textContent = isMuted() ? '🔇' : '🔊'; }
muteBtn.addEventListener('click', () => { setMuted(!isMuted()); refreshMute(); });
refreshMute();

// Demolish toggle (dock button + 'X' key).
document.getElementById('dock-demolish').addEventListener('click', () => setDemolish(!demolishMode));
window.addEventListener('keydown', (e) => {
  if ((e.key === 'x' || e.key === 'X') && e.target === document.body) setDemolish(!demolishMode);
});

// ---- Save / load -----------------------------------------------------------
document.getElementById('dock-save').addEventListener('click', () => {
  if (saveGame(state)) { Sound.collect(); flashDock('dock-save', 'Saved ✓'); }
});
document.getElementById('dock-load').addEventListener('click', () => {
  if (net.connected) return; // don't yank state out from under a live session
  if (loadGame(state)) { Sound.portal(); flashDock('dock-load', 'Loaded ✓'); }
});
function flashDock(id, label) {
  const btn = document.getElementById(id);
  const prev = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = prev; }, 1100);
}

// ---- Networking (P2P / DAC) ------------------------------------------------
const net = new Net();
// GUEST: replace local state with the host's authoritative snapshot.
net.onSnapshot = (snap) => { restore(state, snap); };
// HOST: validate and apply guest intents (the DAC is the sole committer).
net.onIntent = (kind, args) => {
  if (kind === 'place' && !state.machines.some(m => m.x === args.x && m.y === args.y)) {
    const m = place(state, args.type, args.x, args.y);
    pulse(m.x, m.y, '#c9a45a');
  } else if (kind === 'upgrade') {
    upgrade(state, args.id);
  } else if (kind === 'research') {
    research(state, args.tech);
  } else if (kind === 'cursor') {
    state.peers.guest = { x: args.x, y: args.y };
  } else if (kind === 'demolish') {
    removeMachine(state, args.id);
  }
};

// ---- Build / placement -----------------------------------------------------
function commitPlace(type, gx, gy) {
  if (net.role === 'guest' && net.connected) { net.sendIntent('place', { type, x: gx, y: gy }); return; }
  const m = place(state, type, gx, gy);
  Sound.place();
  pulse(m.x, m.y, '#c9a45a');
  renderHud(tier);
}
const build = new BuildController(state, canvas, TILE, commitPlace);

// Machine inspector: hover a placed machine to see its recipe, level, and status.
const inspector = document.getElementById('inspector');
function fmtRates(rates) {
  const entries = Object.entries(rates);
  if (!entries.length) return '—';
  return entries.map(([r, n]) => `${(RESOURCES[r]?.icon) || ''} ${n} ${RESOURCES[r]?.name || r}`).join('<br>');
}
canvas.addEventListener('pointermove', (e) => {
  if (build.isActive()) { inspector.hidden = true; return; }
  const r = canvas.getBoundingClientRect();
  const gx = Math.floor((e.clientX - r.left) / TILE);
  const gy = Math.floor((e.clientY - r.top) / TILE);
  const m = state.machines.find(x => x.x === gx && x.y === gy);
  if (!m) { inspector.hidden = true; return; }
  const def = MACHINES[m.type];
  const lvl = m.level || 1;
  inspector.innerHTML =
    `<div class="aa-insp-title">${def.glyph} ${def.name} <em>L${lvl}</em></div>` +
    `<div class="aa-insp-purpose">${def.purpose}</div>` +
    `<div class="aa-insp-grid"><div><b>In</b><br>${fmtRates(def.inputs)}</div>` +
    `<div><b>Out</b><br>${fmtRates(def.outputs)}</div></div>` +
    `<div class="aa-insp-foot">${m.active === false ? '⏸ starved' : '⚡ active'} · ` +
    `residue ${def.residue}/tick · upgrade: ${upgradeCost(lvl)} ${RESOURCES.glyph.icon}</div>`;
  inspector.hidden = false;
  inspector.style.left = `${Math.min(e.clientX + 16, window.innerWidth - 250)}px`;
  inspector.style.top = `${Math.min(e.clientY + 16, window.innerHeight - 160)}px`;
});
canvas.addEventListener('pointerleave', () => { inspector.hidden = true; });

// Presence: broadcast our cursor (tile-space) to the peer, throttled.
let lastCursorSent = 0;
canvas.addEventListener('pointermove', (e) => {
  if (!net.connected) return;
  const now = performance.now();
  if (now - lastCursorSent < 60) return;
  lastCursorSent = now;
  const r = canvas.getBoundingClientRect();
  const pos = { x: (e.clientX - r.left) / TILE, y: (e.clientY - r.top) / TILE };
  if (net.role === 'guest') net.sendIntent('cursor', pos);
  else state.peers.host = pos; // host carries its own cursor in the snapshot
});

// Demolish mode: click a machine to remove it instead of upgrading.
let demolishMode = false;
function setDemolish(on) {
  demolishMode = on;
  if (on) build.cancel();
  canvas.style.cursor = on ? 'not-allowed' : 'default';
  const btn = document.getElementById('dock-demolish');
  if (btn) btn.classList.toggle('is-active', on);
}

// Click a placed machine (when not building) to upgrade it with Glyphs.
canvas.addEventListener('click', (e) => {
  if (build.isActive()) return;
  const r = canvas.getBoundingClientRect();
  const gx = Math.floor((e.clientX - r.left) / TILE);
  const gy = Math.floor((e.clientY - r.top) / TILE);
  const m = state.machines.find(x => x.x === gx && x.y === gy);
  if (!m) return;

  if (demolishMode) {
    if (net.role === 'guest' && net.connected) { net.sendIntent('demolish', { id: m.id }); return; }
    if (removeMachine(state, m.id)) { Sound.slain(); pulse(m.x, m.y, '#d35f5f'); renderHud(tier); }
    return;
  }

  if (net.role === 'guest' && net.connected) { net.sendIntent('upgrade', { id: m.id }); return; }
  if (upgrade(state, m.id)) { Sound.activate(); pulse(m.x, m.y, '#c9a45a'); renderHud(tier); }
  else { Sound.slain(); } // not enough Glyphs — soft denial cue
});

// Selecting a blueprint enters build mode (Shift+drop releases the tool).
document.querySelectorAll('.aa-build').forEach(row => {
  const pick = () => {
    if (!isUnlocked(state, row.dataset.build)) { Sound.slain(); return; } // locked
    setDemolish(false);
    build.select(row.dataset.build);
  };
  row.addEventListener('click', pick);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
});

// Reflect lock state on blueprint rows each tick.
function refreshBlueprintLocks() {
  document.querySelectorAll('.aa-build').forEach(row => {
    row.classList.toggle('is-locked', !isUnlocked(state, row.dataset.build));
  });
}

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

    if ((m.level || 1) > 1) {
      ctx.fillStyle = '#c9a45a';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(`L${m.level}`, px + TILE - 10, py + 4);
    }
  }

  // Ward Towers — faint range ring + a beam to the current target.
  for (const t of state.machines.filter(m => m.type === 'wardTower')) {
    const cx = (t.x + 0.5) * TILE, cy = (t.y + 0.5) * TILE;
    ctx.save();
    ctx.strokeStyle = 'rgba(143,192,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, MACHINES.wardTower.range * TILE, 0, Math.PI * 2);
    ctx.stroke();
    if (t.firingAt && t.active !== false) {
      ctx.strokeStyle = 'rgba(159,220,255,0.85)';
      ctx.lineWidth = 2; ctx.shadowBlur = 8; ctx.shadowColor = '#9fdcff';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(t.firingAt.x * TILE, t.firingAt.y * TILE);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Golems — workers glow teal; combat golems are larger and amber-edged.
  for (const g of state.golems) {
    const px = g.x * TILE, py = g.y * TILE;
    const combat = g.kind === 'combat';
    ctx.save();
    ctx.shadowBlur = 10; ctx.shadowColor = combat ? '#ffd89a' : '#9fffd0';
    ctx.fillStyle = combat ? '#ffe6b0' : '#cfffe6';
    ctx.beginPath();
    ctx.arc(px, py, combat ? 7 : 6, 0, Math.PI * 2);
    ctx.fill();
    if (combat) { ctx.strokeStyle = '#c9a45a'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.restore();
  }

  // Enemies — ember-red motes converging on the factory; bosses loom larger.
  for (const e of state.enemies) {
    const px = e.x * TILE, py = e.y * TILE;
    const r = e.isBoss ? 16 : 5 + Math.min(6, e.power);
    ctx.save();
    ctx.shadowBlur = e.isBoss ? 22 : 12; ctx.shadowColor = e.isBoss ? '#ff3b3b' : '#ff6b6b';
    ctx.fillStyle = e.isBoss ? '#ff8a8a' : '#ffb3b3';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Health bar for bosses (and wounded elites).
    if (e.maxHp && (e.isBoss || e.hp < e.maxHp)) {
      const w = e.isBoss ? 40 : 18, frac = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(px - w / 2, py - r - 8, w, 4);
      ctx.fillStyle = e.isBoss ? '#ff5f5f' : '#ffb3b3';
      ctx.fillRect(px - w / 2, py - r - 8, w * frac, 4);
    }
    if (e.isBoss) {
      ctx.fillStyle = '#ffd0d0'; ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(e.name, px, py - r - 12);
    }
  }

  // Peer presence cursor: show the *other* player's pointer.
  if (net.connected) {
    const peer = net.role === 'guest' ? state.peers.host : state.peers.guest;
    if (peer) {
      const px = peer.x * TILE, py = peer.y * TILE;
      ctx.save();
      ctx.shadowBlur = 10; ctx.shadowColor = '#c9a45a';
      ctx.fillStyle = '#f0d89a';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + 16);
      ctx.lineTo(px + 5, py + 11);
      ctx.lineTo(px + 11, py + 11);
      ctx.closePath();
      ctx.fill();
      ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(net.role === 'guest' ? 'host' : 'guest', px + 12, py + 10);
      ctx.restore();
    }
  }

  drawPulses(ctx, TILE, 1 / 60);
  build.drawGhost(ctx);
  drawMinimap();
}

// Minimap: a compact overview of the factory, enemies, and nodes in a corner.
const MAP_SPAN = 24; // world tiles represented edge-to-edge
function drawMinimap() {
  const size = 150, pad = 14;
  const ox = canvas.width - size - pad, oy = canvas.height - size - pad - 44;
  const s = size / MAP_SPAN;
  ctx.save();
  ctx.fillStyle = 'rgba(10,12,18,0.82)';
  ctx.strokeStyle = 'rgba(201,164,90,0.5)';
  ctx.lineWidth = 1;
  roundRect(ctx, ox, oy, size, size, 8);
  ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.rect(ox, oy, size, size); ctx.clip();

  for (const n of state.nodes) {
    ctx.fillStyle = n.reserve > 0 ? 'rgba(159,200,255,0.7)' : 'rgba(120,120,120,0.4)';
    ctx.fillRect(ox + n.x * s, oy + n.y * s, 3, 3);
  }
  for (const m of state.machines) {
    ctx.fillStyle = m.active === false ? '#6a6f7e' : '#8fc0ff';
    ctx.fillRect(ox + m.x * s, oy + m.y * s, 4, 4);
  }
  for (const g of state.golems) {
    ctx.fillStyle = '#9fffd0';
    ctx.fillRect(ox + g.x * s, oy + g.y * s, 2, 2);
  }
  for (const e of state.enemies) {
    ctx.fillStyle = '#ff7b7b';
    ctx.fillRect(ox + e.x * s, oy + e.y * s, 3, 3);
  }
  ctx.restore();
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
  // Guests do not run the simulation — the host (DAC) is authoritative and we
  // simply render the snapshots it broadcasts.
  if (net.role === 'guest' && net.connected) { tier = threatTierFor(state.residue); renderHud(tier); return; }

  const result = applyTick(state);
  tier = result.tier;
  if (net.role === 'host') net.broadcast(snapshot(state));
  if (state.tick % 20 === 0) saveGame(state); // autosave (host/solo only)

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
// Variable-speed scheduler: 0 = paused, 1×/2×/3× tick rate. A self-rescheduling
// timeout (instead of a fixed setInterval) lets speed change take effect at once.
let gameSpeed = 1;
let tickTimer = null;
function scheduleTick() {
  clearTimeout(tickTimer);
  if (gameSpeed <= 0) return;
  tickTimer = setTimeout(() => { simulationStep(); scheduleTick(); }, TICK_MS / gameSpeed);
}
function setSpeed(s) {
  gameSpeed = s;
  document.querySelectorAll('#dock .aa-speed').forEach(b =>
    b.classList.toggle('is-active', Number(b.dataset.speed) === s));
  scheduleTick();
}
document.querySelectorAll('#dock .aa-speed').forEach(btn =>
  btn.addEventListener('click', () => setSpeed(Number(btn.dataset.speed))));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    setSpeed(gameSpeed > 0 ? 0 : 1);
  }
});

function frame() {
  renderWorld();
  requestAnimationFrame(frame);
}
simulationStep();
setSpeed(1);
frame();
