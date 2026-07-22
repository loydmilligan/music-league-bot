# Handoff: Theme Research — Song Metadata Display

## Overview
Adds inline + expandable song metadata to pick rows on the Theme Research tab (History → Player Research → per-theme results). Currently rows show only rank, title, artist, submitter, and points. This design adds: at-a-glance obscurity/energy/lyrics indicators, album art, an in-place expand with the full metadata catalog, and a slot for three fields that are approved but not yet populated (release year, explicit badge, sentiment tone).

## About the Design Files
The bundled `.dc.html` file is a **design reference** built in an HTML prototyping tool — it is not production code to copy directly. It renders live and is interactive (click a row to expand it) so you can inspect real behavior, but its markup/JS framework has nothing to do with the app's stack. **Recreate this design in the existing codebase** (Svelte, per the `ui/` app's existing surfaces — see `PlayerResearchTab.svelte`, `SongCard.svelte`, `TastemakerSection.svelte` for the established patterns) using the same CSS class vocabulary (`.usc-*`, `.dg-*`) and design tokens already in use there.

Open the file directly in a browser to interact with it. The canvas contains several rounds of exploration (Turn 1, Turn 2, Turn 3) above a **"Final" section at the very top — build from that section only.** The other sections are the design-review trail (options that were considered and rejected) — do not implement those.

## Fidelity
**High-fidelity.** Colors, spacing, and type all reuse this project's real design-system tokens (`--sky`, `--accent`, `--moss`, `--ink-*`, `--r-3`, `--font-mono`, etc.) and existing `.usc-*` component classes from `song.css` — not invented values. Implement pixel-for-pixel where token-backed; the row chrome (padding, borders, radii) should match exactly.

## Screens / Views

### Theme Research pick row (collapsed)
**Purpose:** Scan a theme's picks and get a quick read on how obscure/energetic/lyrical each pick is, without clutter.

**Layout:** Single row, flex, `align-items: center`, `gap: 12px`, `padding: 11px 14px`, background `var(--surface)`, `border: 1px solid var(--line)` (or `var(--accent)` when expanded), `border-radius: var(--r-3)`. The whole row is a `<button>` (full-width, transparent, no default button chrome) so the entire row is the click target for expand/collapse.

Row children, in order:
1. **Rank** — `width: 20px`, right-aligned, `font-family: var(--font-mono)`, `font-size: 12px`, `color: var(--fg-quiet)`.
2. **Album art thumbnail** — `34×34px`, `border-radius` per the `.usc-art-ph` class (reuse it verbatim from `song.css`). If art exists: fill with the real image (currently mocked as a `linear-gradient(135deg, var(--ink-3), var(--ink-2))` placeholder — swap for the real `<img>`/background-image). If missing (**63% of rows will be missing this** — see Design Tokens/Coverage below): render `.usc-art-ph` with the track's first-letter initial as text content, same visual weight as a loaded thumbnail so rows don't jump size.
3. **Title + artist + indicator row** — flex:1, min-width:0, two-line stack:
   - Line 1: title (`font-weight:600; font-size:14px; color:var(--fg)`) and artist (`font-family:var(--font-mono); font-size:11.5px; color:var(--fg-muted)`) inline, `gap:8px`, wrapping allowed.
   - Line 2 (`margin-top:6px`, flex row, `align-items:center`, `gap:8px`): the **three ring-gauge indicators** (see Components below) followed by an optional genre-tag pill.
4. **Submitter** — pill: `font-family:var(--font-mono); font-size:10.5px; color:var(--fg-muted); background:var(--ink-2); border:1px solid var(--line); border-radius:999px; padding:3px 10px`. Truncate long names.
5. **Points** — `font-family:var(--font-display); font-weight:700; font-size:15px; color:var(--accent); width:26px; text-align:right`. Show `—` when null (fresh/pending picks with no votes yet).
6. **Expand caret** — `▸` collapsed / `▾` expanded, `font-family:var(--font-mono); font-size:12px; color:var(--fg-quiet)`.

### Ring-gauge indicator (the core new component)
Three per row, in fixed order: **obscurity → energy → lyrics**. Each is a 20×20px (22×22 viewBox) SVG:
- Background ring: full circle, `r=9`, `stroke:var(--line)`, `stroke-width:2`, no fill.
- Foreground arc: same circle, `stroke: var(--axis-color)`, `stroke-width:2`, `stroke-linecap:round`, rotated `-90deg` so it starts at 12 o'clock. `stroke-dasharray = circumference` (`2π×9 ≈ 56.5`), `stroke-dashoffset = circumference × (1 − pct/100)` where `pct` is the metric's 0–100 value (lyrics is boolean → treat `has_lyrics` as 100, instrumental as 0).
- Centered glyph (currentColor = axis color): obscurity = small filled dot + ring outline (a "target" glyph); energy = a bolt/lightning path; lyrics = a wavy line (waveform-ish squiggle). Reuse the exact paths from the prototype's `<svg>` markup.
- **Opacity tiers** on both the arc and the glyph: `1` if value ≥60, `0.6` if <60 (present), `0.3` if the field is missing/not-yet-analyzed for that pick.
- **Tooltip:** native `title` attribute on the wrapping `<span>` — exact value + context, e.g. `"Obscurity 72/100 (Rabbit Hole)"`, `"Energy 56/100"`, `"Lyrics on file"` / `"Instrumental"`, or `"Obscurity — not analyzed yet"` when missing. **No numeric value is ever shown in the collapsed row** — hover (tooltip) or expand are the only ways to see it.
- **Axis colors** (from the catalog's canonical axis-color list): obscurity = `--sky`, energy = `--accent` (amber, per Mashco "energy/replay" mapping — confirm which token alias resolves to amber in your codebase's copy of `colors_and_type.css`), lyrics = `--moss`.
- **Missing data:** still render the full indicator (ring + glyph) at 0.3 opacity — never hide it. This keeps every row's "shape" (3 indicators + optional tag) visually consistent whether the pick is fully analyzed or freshly imported.

### Genre tag pill (inline)
Only rendered `sc-if hasTag` — **omitted entirely when no tags exist** (do not show a muted/empty placeholder inline; ~3/641 corpus songs and most fresh picks have none). When present, shows only the **first/top tag** as a small pill: `font-family:var(--font-mono); font-size:10.5px; font-weight:500; padding:2px 8px; border-radius:999px; border:1px solid color-mix(in oklch, var(--sky) 40%, var(--line)); color:var(--sky); background:color-mix(in oklch, var(--sky) 12%, transparent)`.

### Expanded state (in-place sub-expand)
Triggered by clicking anywhere on the row (not a separate icon-button). On expand: row border turns `var(--accent)` (200ms transition), caret flips to `▾`, and a panel opens below the row header, `padding: 0 14px 16px 66px` (left-indented to align under the title, not the rank/art), with `border-top: 1px solid var(--line)` and `padding-top: 12px` above its content. Three stacked layers, `gap:14px`:

1. **Headline** (`.usc-layer-label` heading "headline") — `.usc-stats` grid of `.usc-stat` items (reuse these exact classes from `song.css`):
   - Popularity: `{popularity_proxy} / obsc {obscurity}`
   - Tempo: `{bpm} bpm · {key} {scale}` (e.g. "82.7 bpm · A major")
   - Energy: `.usc-energy` bar (reuse class) + numeric `{energy_pct}` alongside
   - Lyrics: "on file" / "—" (instrumental) / "not analyzed yet"
   - Duration: `m:ss` formatted from `duration_s`
2. **Genre tags** (`.usc-layer-label` heading "genre tags") — `.usc-tags` wrapping `.usc-tag` pills (one per tag, up to 5) if present; else italic muted note: *"not analyzed yet — genre tags fetch after import"* (`font-family:var(--font-mono); font-size:12px; color:var(--fg-quiet); font-style:italic`).
3. **🟡 Coming soon** (opacity `0.55` on the whole block, heading includes a small muted annotation "— approved, not yet populated") — placeholder `.usc-stat` rows for **Release year**, **Explicit**, **Tone**, each showing `—` in `var(--fg-quiet)`. This layer exists purely so the module doesn't need re-layout when those fields ship — see Design Tokens/Planned Fields below for exactly how to convert a placeholder row into a live one.

*(The prototype's exploration trail also validated a second expand mechanism — a full-screen bottom-sheet reusing the existing SongCard/SongSheet component — as a possible **phase-2** treatment if this metadata needs to be reachable from other surfaces later. Not part of this handoff; mentioned for context only.)*

## Interactions & Behavior
- **Click row → toggle expand.** Only one row's expand state is tracked per row (independent per row, multiple rows can be expanded at once — no accordion behavior).
- **Hover any ring-gauge indicator → native tooltip** with the exact value/label (see tooltip strings above).
- No other click targets inside the collapsed row (submitter pill and points are display-only).
- Transition: border-color 200ms on expand/collapse. No other animation (panel appears instantly — this matches the app's existing collapsible-row idiom elsewhere in Player Research; don't add a slide/height animation unless the codebase's existing expand pattern already has one, in which case match it).

## State Management
- Per-row boolean `expanded` (keyed by pick id / rank — not global).
- No fetch-on-expand: all headline + raw-signal fields should already be present in the row's data payload (from the theme's picks query); only the "coming soon" placeholders show no data by design.

## Design Tokens
- Colors: `--sky` (obscurity), `--accent`/amber (energy), `--moss` (lyrics-positive), `--line` (ring track, borders), `--accent` (expanded border, points, ring foreground reuse), `--fg` / `--fg-2` / `--fg-muted` / `--fg-quiet` (text hierarchy), `--ink-2` / `--ink-3` (art fallback gradient, submitter pill bg), `--surface` (row bg).
- Radius: `--r-3` (row), `--r-4` (container panel), `999px` (pills/rings).
- Type: `--font-display` (points, theme title), `--font-mono` (rank, submitter, tooltips-adjacent labels, tags), `--font-body` (title default).
- Spacing: row padding `11px 14px`; row gap `12px`; indicator gap `8px`; expand panel left-indent `66px`, `padding-top:12px`.
- Ring geometry: `r=9`, `stroke-width=2`, circumference `≈56.5`, `stroke-dashoffset = circumference × (1 − pct/100)`.
- Opacity tiers: `1` (≥60), `0.6` (<60, present), `0.3` (missing/not analyzed).

### Coverage realities to design for (both must look correct)
1. **Completed rounds:** popularity/energy/lyrics ~fully covered; tags ~empty on a few; album art only **~37% covered** — fallback initial is not an edge case, it's closer to the majority case.
2. **Fresh/in-progress rounds:** only identity + points present; audio/lyrics/tags all pending → all three ring indicators render at 0.3 opacity, no tag pill, art fallback.

### Planned (🟡) fields — how they slot in later
When `release_year`, `is_explicit`, and `sentiment_norm`/`sentiment_score` ship, they were validated (in the exploration trail, not the final build) to drop into the **inline chip/indicator row** as additional small elements (year as plain mono text, explicit as an ember badge, tone as a moss/ember-colored signed chip) with no structural change to the row — the row's flex-wrap already accommodates more items. In the expanded panel, they simply move from the "🟡 coming soon" placeholder layer into the "headline" layer once populated. No component rework needed either place.

## Assets
No image/icon assets to hand off — all glyphs are inline SVG paths (copy directly from the `.dc.html` source), and album art uses the existing `.usc-art-ph` component/class from `song.css` (already in the codebase).

## Files
- `Theme Research — Metadata Canvas.dc.html` — the full interactive design reference. **Build only from the section labeled "Final" at the top of the file** (`<section id="final" data-screen-label="Final spec">`). Everything below it (Turn 1/2/3) is prior exploration kept for audit trail, not spec.
