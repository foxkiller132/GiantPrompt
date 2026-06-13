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

## Implemented

- Core resource/machine model (Aether Condenser, Elemental Refinery, Arcane
  Transmuter, Glyph Carver, Golemsmith Hub, Automated Conduit, Portal Generator).
- Deterministic per-tick simulation with input gating and residue accumulation.
- Threat meter driven directly by total Arcane Residue (Calm → Goblins →
  Wraiths → Dragons).
- Draggable, position-persisting (sticky-anchor) HUD panels.
- Canvas world render with glowing active machines.
- **Build/placement** interaction: select a blueprint → ghost preview → place.
- **Golem units** forged by the Golemsmith Hub that patrol routes and defend.
- **Enemy spawning & combat** scaled to residue; machines take damage / fall.
- **Victory & defeat**: channel surplus Glyphs into the Zone Purifier to win;
  lose if the factory is wiped out. Animated end-of-run overlay.
- **Raw-element node extraction** for a self-sustaining economy.
- **Audio + visual feedback** (WebAudio chimes + canvas pulse rings).
- **Automated Conduit flow bonus** boosting adjacent machine throughput.
- **Portal Generator paired teleport** for golems between linked portals.
- **Machine upgrades**: spend Glyphs to level up output (per-level bonus).
- **P2P multiplayer (WebRTC)** with the host as **Designated Authority Client**:
  the host runs the authoritative tick and broadcasts snapshots; guests render
  them and send validated intents. Manual SDP signaling (no server) via the
  Network panel.
- **Save/load** with autosave (versioned localStorage snapshots).
- **Research tech tree** gating advanced machines (Transmuter as research lab).
- **Peer presence cursors** in P2P sessions.
- **Machine inspector** tooltip (recipe, level, status, upgrade cost).
- **Minimap** overview of machines, enemies, golems, and nodes.
- **Ward Towers** — mana-powered defensive structures.
- **Pause + 1×/2×/3× game speed** controls.
- **Demolish mode** to remove machines.
- **Combat Golems** that hunt enemies; **boss waves** at the late tier.
- **Residue cleansing** via the Purifier; **sound mute** toggle.

## Roadmap (remaining)

1. Hosted signaling option (QR/relay) to replace manual SDP copy/paste
   (requires a relay/signaling server — out of scope for a serverless build).
2. >2-peer mesh and Mining Golems.
3. Balance tuning pass once play-tested.
