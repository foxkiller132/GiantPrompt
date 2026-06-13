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

## How it plays

A single, long run — the pace and pull of Factorio, in an arcane setting. There
is no prestige, no new-game-plus, no terminal win: you grow one factory over a
long time and the world grows with it.

- **Scale production.** Every recipe feeds the next: raw elements → refined
  elements & ingots → components & glyphs → runes → high-tier machines. Demand
  climbs, so you build *more* and balance ratios.
- **Research is continuous.** Selecting a tech makes your factory feed it over
  time; advancing means building and sustaining throughput. The **Items** panel
  shows live amounts and net production rates so you can find bottlenecks.
- **Pollution finds equilibrium.** Machines emit **Arcane Residue**, which draws
  enemies. Residue passively dissipates, so a steady factory settles at a steady
  threat level — you escalate the threat by *expanding*, and manage it by
  purifying, Resonance modules, or the Void Conduit wonder.
- **Defend in layers.** Ward Towers (from the start), Combat/Worker/Mining
  Golems, and rune-fuelled Aegis Spires. Bosses make for your economy core, so
  perimeter walls aren't enough.
- **Deep tactical levers.** Per-machine levels, 2× **overclock** (shift-click),
  and **Glyph modules** (alt-click) trade output, input, and residue.
  Run-wide **Ascension Perks** and one-time **Wonders** reshape the late game.
- **The Purifier is a choice.** Toggle it to spend surplus Glyphs scrubbing
  residue and earning ascension perks — competing with research and upgrades for
  the same Glyphs. Each Purification is a milestone, not an ending; the threat
  ascends a tier harder and the run deepens.

**Direction** comes from the **Goals** panel (a guided objective ladder),
tracked by run **stats**, **achievements**, and a cross-run **lifetime profile**.
**World events** (mana surges, arcane storms) keep long stretches dynamic.

The factory sprawls across a **world larger than the screen**: pan with WASD /
arrow keys, middle-mouse drag, or click the **minimap** to jump. A node only
yields once you **claim** it by building a machine nearby — the starter taps the
home field, while richer **expansion patches** farther out lie dormant until you
build out to them, driving the classic expand-toward-resources loop.

## Sessions & multiplayer

- **Save-based:** named save slots with metadata, autosave, export/import codes.
- **Co-op:** WebRTC **P2P** with the host as Designated Authority Client and
  live peer presence cursors (manual SDP signaling, no server).

## Possible future work

- Hosted signaling (QR/relay) to replace manual SDP copy/paste (needs a server).
- More intermediate recipe tiers and late research to extend the ladder.
- A balance/feel pass once the game has been played at length in a browser.
