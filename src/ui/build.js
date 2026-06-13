// Build & placement interaction on the canvas grid.
//
// Player selects a machine type (build mode), sees a ghost preview snapped to the
// grid, and clicks an empty tile to place it. Placement routes through the
// authoritative `place()` in core/state.js so the host/DAC remains the single
// committer of state. Right-click / Escape cancels build mode.

import { MACHINES } from '../data/gamedata.js';
import { place } from '../core/state.js';

export class BuildController {
  constructor(state, canvas, tile, onPlace) {
    this.state = state;
    this.canvas = canvas;
    this.tile = tile;
    this.onPlace = onPlace || (() => {});
    this.selected = null;          // machine type key, or null
    this.ghost = { x: -1, y: -1, valid: false };

    canvas.addEventListener('pointermove', (e) => this._hover(e));
    canvas.addEventListener('click', (e) => this._click(e));
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cancel(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.cancel(); });
  }

  select(type) {
    this.selected = MACHINES[type] ? type : null;
    this.canvas.style.cursor = this.selected ? 'crosshair' : 'default';
  }

  cancel() {
    this.selected = null;
    this.ghost.x = this.ghost.y = -1;
    this.canvas.style.cursor = 'default';
  }

  isActive() { return !!this.selected; }

  occupied(gx, gy) {
    return this.state.machines.some(m => m.x === gx && m.y === gy);
  }

  _tileFromEvent(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      gx: Math.floor((e.clientX - r.left) / this.tile),
      gy: Math.floor((e.clientY - r.top) / this.tile),
    };
  }

  _hover(e) {
    if (!this.selected) return;
    const { gx, gy } = this._tileFromEvent(e);
    this.ghost = { x: gx, y: gy, valid: !this.occupied(gx, gy) && gy >= 1 };
  }

  _click(e) {
    if (!this.selected) return;
    const { gx, gy } = this._tileFromEvent(e);
    if (this.occupied(gx, gy) || gy < 1) return; // keep top row clear of the HUD
    const m = place(this.state, this.selected, gx, gy);
    this.onPlace(m);
    // Hold the tool for rapid placement; Shift releases after one drop.
    if (e.shiftKey) this.cancel();
  }

  // Draw the ghost preview. Called from the world render loop.
  drawGhost(ctx) {
    if (!this.selected || this.ghost.x < 0) return;
    const def = MACHINES[this.selected];
    const px = this.ghost.x * this.tile, py = this.ghost.y * this.tile;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = this.ghost.valid ? 'rgba(95, 211, 168, 0.4)' : 'rgba(211, 95, 95, 0.4)';
    ctx.strokeStyle = this.ghost.valid ? '#5fd3a8' : '#d35f5f';
    ctx.lineWidth = 2;
    ctx.fillRect(px + 3, py + 3, this.tile - 6, this.tile - 6);
    ctx.strokeRect(px + 3, py + 3, this.tile - 6, this.tile - 6);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#eef4ff';
    ctx.font = '26px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, px + this.tile / 2, py + this.tile / 2);
    ctx.restore();
  }
}
