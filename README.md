# 🔮 Arcane Automata

A factory-building simulation where you automate magical processes to generate
powerful resources — while the **Arcane Residue** (pollution) you emit acts as a
beacon that summons increasingly world-ending enemies.

Built to the **GDT v1.0** specification.

## Run

No build step, no dependencies. Serve the folder and open it:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Architecture (per the Technical Mandate)

- **Zero runtime dependencies** — vanilla ES modules + Canvas (minimal stack).
- **Authoritative tick** — `src/core/state.js` centralizes every critical state
  change. In the P2P model the host runs this as the **Designated Authority
  Client (DAC)**, validates results, and broadcasts snapshots; peers send
  intents only. This is what makes desync/cheat prevention tractable.
- **Sticky-anchor UI** — `src/ui/panel.js` makes every non-map element draggable
  and persists its coordinates to `localStorage`, snapping back on reopen.
- **Deliberate polish** — panels open/close with magical transitions; active
  machines glow. No jarring immediate state changes.
- **Single source of truth** — `src/data/gamedata.js` encodes the spec's exact
  machines, recipes, and the residue→threat curve.

## Implemented so far (iteration 1)

- Core resource/machine model (Aether Condenser, Elemental Refinery, Arcane
  Transmuter, Glyph Carver, Golemsmith Hub, Automated Conduit, Portal Generator).
- Deterministic per-tick simulation with input gating and residue accumulation.
- Threat meter driven directly by total Arcane Residue (Calm → Goblins →
  Wraiths → Dragons).
- Draggable, position-persisting HUD panels.
- Canvas world render with glowing active machines.

## Roadmap

1. Build/placement interaction on the canvas grid; resource node extraction.
2. Golem unit system with Glyph-programmed routing & pathfinding.
3. Conduit/portal transport networks.
4. Enemy spawning & combat tied to the threat tiers; victory condition.
5. WebRTC P2P mesh with the DAC host loop and snapshot reconciliation.
6. Audio + richer interaction feedback.
