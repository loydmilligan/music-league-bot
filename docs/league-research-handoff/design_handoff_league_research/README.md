# Handoff: League Research tab

## Overview
A new `/history` tab, "League research," showing three views of a league's history: a voter×submitter points heatmap, a genre submit-vs-vote comparison, and a round-by-round obscurity drift chart. See `DECISION_LOG.md` for the full rationale behind each choice; this file covers the buildable spec.

## About the Design Files
`League Research — Decision Canvas.dc.html` is a **design reference**, not production code — built in an HTML prototyping tool, not the app's real Svelte/SvelteKit stack. It's live and interactive (click the Heatmap/Drift/Genre tabs) so you can inspect real behavior. **Build only from the section labeled "Final spec"** at the very top of the file (`<section id="final" data-screen-label="Final spec">`). Everything below it (labeled "Turn 1") is the design-review trail — options considered and rejected — not to be implemented.

Recreate this in the existing codebase's real components and CSS classes, matching the Mash Co. dark ops-dashboard system exactly — reuse `.dgA-matrix`/`.dgA-mx-*` classes from `digest.css` for the heatmap and callouts, `.taste-overlap-row` idiom from `taste-overlap.css` if you pick up the D3 wildcard later, and the JetBrains Mono / sky-ember-moss-amber token vocabulary throughout. No charting library — all charts here are hand-rolled SVG or CSS/flex, matching `StandingsChart.svelte`'s existing precedent.

## Fidelity
**High-fidelity structurally, conservative visually per the brief's "first pass" framing.** Reuses real design tokens (`--sky`, `--accent`, `--moss`, `--amber`, `--ink-*`, `--r-2/3/4`, `--font-mono`, `--mash-pulp-soft/edge`) — do not invent new colors or spacing. All chart data shown is real (Second Best and Hip Jammers league exports), not fabricated placeholder numbers.

## Screens / Views

### Shared shell (all three panels)
Sits inside the existing `/history` tab bar (songs / themes / players / **league**, new tab active with the pulp-orange underline). Below the tab bar: a scope-control bar with **league** and **season** pill-selectors (mash-pulp-soft background when active, `--ink-2`/`--line` when inactive) — reused unchanged across all three panels. Below that: a 3-way segmented switcher (`Heatmap` / `Drift` / `Genre`) using the same segmented-control visual as elsewhere in the app (`--surface` track, `--mash-pulp-soft` active pill, `--accent` active text). Exactly one panel renders below the switcher at a time — no accordion, no simultaneous panels.

### Heatmap panel (D2 → 2d)
**Purpose:** show who rewards whom, at a glance, across the whole roster (up to ~15×15).

A single points-intensity matrix, reusing the `.dgA-matrix`/cell `data-p="0..5"` intensity-grading pattern already in `digest.css`. Rows = voters, columns = submitters, diagonal cells (self) rendered as inert `--ink-3` blocks. Cell background intensity scales with points (`-2` to `26` range observed in real data) via the accent/pulp color ramp; cell text shows the raw point total. Hover any cell for the exact tooltip: `"{voter} → {submitter}: {points} pts across {count} votes"`. Blank/never-voted pairs render as flat `--ink-2` with no number.

Below the grid: **1–2 auto-generated callout sentences**, styled as `.dgA-mx-callout` (tag chip + text), computed from the data — e.g. surfacing the single strongest voter→submitter relationship, and (if one exists at obscurity ≥60) the strongest "rewards deep cuts" pairing. These callouts replace an interactive attribute-lens toggle for this first pass — no Obscurity/Energy recolor control ships yet (see Decision Log D2 for why, and as a flagged fast-follow).

### Drift panel (D4 → 4b)
**Purpose:** show how obscure the league's picks run over time, and highlight standout winners.

SVG line/area chart, `600×200` viewBox (scale to container). X-axis is chronological round order across all of a league's seasons (not per-season reset); Y-axis is obscurity 0–100 (inverted, 0 obscurity at bottom). Two data series:
1. **League median obscurity per round** — rendered as a filled polygon (soft accent/pulp fill, `color-mix(in oklch, var(--accent) 20%, transparent)`, `stroke:var(--accent)`) closed to the x-axis baseline.
2. **Round winner's obscurity** — rendered as individual `--sky` dots (r=3.5), one per round, NOT connected by a line. This is deliberate: a winner is a single event per round, not a continuous quantity, and dots avoid implying trend where there is none.

**Season boundaries:** a dashed vertical rule (`--line-strong`) at each season's first round, labeled `S{n}` in small mono type below the axis. Validated against Hip Jammers' real data: 3 seasons, 27 total rounds, boundaries at round 1 (S1), and wherever S2/S3 begin.

**Tie handling (critical edge case):** when a round has a genuine 2-way (or n-way) tie for the win — confirmed real case: Second Best Round 10, "I'd Rather Go Blind" (obscurity 27) tied with "Nights Like These" (obscurity 72) — render **one dot per tied song** at that round's x position, each at its own obscurity y-value. Never average tied songs into a single point; that would fabricate a value that doesn't represent either song.

### Genre panel (D3 → 3c)
**Purpose:** compare what a player submits vs. what they vote for, by genre, to surface taste mismatches.

Per-player view (player selection mechanism TBD by whoever wires this to real UI — the canvas mocks a fixed player for the demo). Diverging/tornado bar chart: for each of the league's top ~8 normalized genre tags, one row with two bars sharing a center label — submit-share bar (`--accent`, rounded left corner) extends left, vote-share bar (`--sky`, rounded right corner) extends right, both as `%` of that player's total submits/votes-given respectively. Row height 16px, bar height 10px.

**Genre tag normalization is aggressive**, per your decision: lowercase/trim, then merge near-duplicates into a curated taxonomy (e.g. `hip hop`/`rap`/`hiphop` → `hip-hop`; `metalcore`/`deathcore`/`industrial` → `metal`; `alternative`/`alternative rock` → `alt rock`). Era/mood/demographic tags (`80s`, `90s`, `female vocalists`) are dropped entirely rather than merged — they're not genres. See the canvas's embedded synonym map for the exact mapping used; extend it as more leagues surface new raw tags.

## Interactions & Behavior
- Switcher tab click → swap panel, no transition/animation specified (match whatever transition convention the rest of `/history` already uses, if any).
- Heatmap cell hover → native tooltip with exact numbers (no click behavior).
- Scope bar (league/season pills) → click to change scope; state should be reflected in the URL (see below) so it deep-links.
- No other click targets in this first pass — no drill-down from heatmap cell to a song list, no drill-down from a drift point to that round's results. Flag if that's wanted later.

## State Management
- Active panel (`heatmap` | `drift` | `genre`) — local UI state, does not need to persist across visits.
- League + season scope — **should deep-link via URL** (e.g. `?league=<slug>&season=<n>`), so a shared link reproduces the exact view. This wasn't a fully separate canvas decision this round (see Decision Log's Open Areas) — implement the deep-link now since it's low-cost and clearly right, but treat the rest of the scope-bar's behavior (e.g. an "all seasons" aggregate mode) as open.

## Design Tokens
Colors: `--accent`/pulp-orange (points/submit-share/median-area), `--sky` (winner dots/vote-share), `--moss`/`--amber` (reserved, not used in the locked D2/D3/D4 but present in the app's data-series axis palette for future lenses), `--ink-0/1/2/3` (backgrounds, cell fills), `--line`/`--line-strong` (borders, season-boundary rule), `--fg`/`--fg-2`/`--fg-muted`/`--fg-quiet` (text hierarchy), `--mash-pulp-soft`/`--mash-pulp-edge` (active-state chips/pills/tabs).
Radius: `--r-1` (segmented-control pill), `--r-2` (scope pills, small controls), `--r-3` (panel content), `--r-4` (outer panel container).
Type: `--font-mono` (all labels, counts, tooltips, axis text), `--font-display` (used sparingly for headers elsewhere in the app — not needed inside this tab's chart content itself).
Reused classes: `.dgA-matrix`/`.dgA-mx-callouts`/`.dgA-mx-callout`/`.dgA-mx-callout-tag`/`.dgA-mx-callout-text` from `digest.css`.

## Assets
No image assets. All charts are inline SVG (copy paths/geometry logic directly from the `.dc.html` source's `renderVals()` — it already computes ring/line/polygon coordinates from raw round data, straightforward to port to Svelte reactive statements) or CSS/flex bars.

## Files
- `League Research — Decision Canvas.dc.html` — interactive design reference. Build only from `<section id="final">`.
- `DECISION_LOG.md` — the full rationale for each of D1–D4, plus the two flagged-but-not-fully-resolved open areas (scope bar, sparse states).
