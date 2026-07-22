# League Research tab — decision log

Reference: `League Research — Decision Canvas.dc.html` (interactive; the "Final spec" section at the top is the build target). Options are labeled D{n}{letter} throughout — cite these ids if you need to revisit a call.

## D1 — Tab layout
**Decided: 1b — single visual switcher.** A segmented control (Heatmap / Drift / Genre) swaps one full-size panel in place, inside the existing `/history` shell with the shared league+season scope bar above it.
- Considered: 1a stacked collapsible panels (PlayerResearchTab accordion idiom), 1c dashboard grid (all three visible at once), 1d wildcard hero+drawers (heatmap always-on, drift/genre as expandable strips).
- Why: keeps the first pass focused — one visual at a time, no accordion chrome, no competing panels fighting for attention on a brand-new tab.

## D2 — Heatmap attribute lens
**Decided: 2d — base Points matrix + auto-surfaced callouts.** The heatmap itself stays the simplest form (raw Points, intensity-graded per the existing `.dgA-matrix` idiom) with no lens-toggle at all; underneath it, 1–2 auto-generated sentences call out the strongest signal(s) directly (e.g. "X → Y: N pts across M votes — the single strongest one-way relationship in the league").
- Considered: 2a recolor-on-toggle (Points/Obscurity/Energy buttons swap the cell coloring, with a small persistent Points reference chip), 2b small multiples (three mini-grids side by side, no toggling), 2c bivariate cells (dot size = points, hue = obscurity, in one grid).
- Why: doing the "who rewards obscure picks" reading *for* the user in words is more valuable in a first pass than adding an interactive lens control — simpler UI, and callouts surface insight rather than requiring the user to hunt for it visually. This forgoes the Obscurity/Energy lens toggle for now; flag if that's wanted as a fast-follow.

## D3 — Genre comparison (submit vs. vote)
**Decided: 3c — diverging/tornado bars.** Each genre gets one row; submit-share bar extends left of a center label, vote-share bar extends right — mismatch direction reads immediately (e.g. "submits rock, votes hip-hop").
- Considered: 3a radar/spider (no app precedent, overlapping polygons distort area), 3b paired horizontal bars (StandingsChart idiom, clear but takes more vertical space per genre), 3d wildcard delta rows (reuses taste-overlap row/bar mechanic, most text-first/console-native).
- Genre tags use **aggressive normalization** per your call — casing collapsed, near-duplicates merged (hip hop/rap/hip-hop → hip-hop; metalcore/deathcore/industrial → metal, etc.), era/mood/vocalist noise (80s, female vocalists) dropped from the taxonomy entirely.

## D4 — Obscurity drift
**Decided: 4b — filled median area + winner dots.** The league's round-by-round median obscurity renders as a soft filled area (amber/pulp); each round's actual winning song's obscurity plots as a separate sky dot, so an outlier winner reads as a point breaking from the area rather than a jagged second line.
- Considered: 4a smooth dual-line (median + winner as two full polylines, taste-waveform idiom), 4c wildcard small-multiples-per-season (one compact chart per season side by side, trading continuity for direct season-shape comparison).
- Season boundaries: dashed vertical rule + "S{n}" label at each season's first round, validated against Hip Jammers' real 3-season/27-round data (the only real cross-season case available).
- **Edge case handled explicitly:** a genuine 2-way tie for round winner (Second Best, Round 10) must render as two separate winner-dots at the same x — never averaged into one misleading point. See D4d in the canvas.

## Open areas (flagged, not fully resolved — lightweight treatment only)
- **Scope-control bar** (league + season selector): shown inline in every mockup as pill buttons; state should deep-link via URL (`?league=&season=`) so a shared link reproduces the exact view. Not deeply explored as its own decision point this round — revisit if it needs richer behavior (e.g. "all seasons" aggregate view).
- **Sparse/early-league states**: not canvassed with dedicated mockups this round. Recommend a fast-follow pass once the tab ships, using a league with <3 rounds as the real test case (Second Best/Hip Jammers are both mature enough to not exercise this).

## Data used
- **Second Best** (14 players, 10 rounds, single season) — heatmap matrix, genre split (Mashew), Round 10 tie edge case.
- **Hip Jammers** (9 players, 3 seasons / 27 rounds) — the only real multi-season case; used for D4 season boundaries.
