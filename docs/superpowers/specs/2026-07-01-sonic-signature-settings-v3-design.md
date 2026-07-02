# Sonic Signature settings v3 — design

**Date:** 2026-07-01
**Status:** Approved (brainstorming complete)
**Supersedes/extends:** `2026-07-01-sonic-signature-v2-design.md` (v2 shipped Tasks 1–7)

## Goal

Round out the Taste Waveform ("Sonic Signature") admin experience with the visual
knobs that existed in the original design toy but were dropped in the verbatim port,
plus in-panel player exploration and a league separation-score readout, and make the
settings tabs scannable via collapsible panels.

Five user requests drive this:

1. **In-panel player select** — preview any player's full profile from the settings
   panel without navigating away.
2. **Remove the bside settings gear** — end users must not tweak waveform settings on
   their own. *(Already removed in v2 Task 4; this spec only verifies it.)*
3. **Re-add dropped "look" knobs** — palette, line style, nodes, axis order, band,
   amplitude. (Data knobs — signal/vote-value/downvotes/lyrical/spread/all-leagues —
   are already live and unchanged.)
4. **Collapsible panels** — every settings panel in the **App Settings** (`/settings`)
   and **Music League Setup** (`/settings/setup`) tabs, collapsed by default.
5. **Separation score** — mean pairwise distance between every pair of fingerprints in a
   league. Higher = more distinct people. Shown in the settings panel.

## Background — where the knobs come from

The current live engine (`taste-waveform.ts`) was ported from
`taste-waveform-package/` (the "Waveform Lab" + "Signature Settings" design toy). The
toy's **data** panel ("Configure the data") was fully ported; the **look** panel
("Configure the look") was not. The dropped look knobs, with the toy's defaults:

| Knob | Type / options | Toy default | Engine touch-point today |
|------|----------------|-------------|--------------------------|
| Palette | `'neon' \| 'cool' \| 'spectrum'` | `neon` | `TRAITS` (hardcoded, L66) |
| Line style | `'strand' \| 'solid' \| 'none'` | `strand` | thick own-signature line (L245–247) |
| Nodes | `'glow' \| 'dot' \| 'none'` | `glow` | node dots (L248, `opts.nodes`) |
| Axis order | `'alt' \| 'raw' \| 'lyric-last' \| 'lyric-first'` | `alt` | `ORDER` (hardcoded `[0,4,3,2,1]`, L70) |
| Band | on/off + opacity | off, `0.04` | (new — no current render) |
| Amplitude | number multiplier | `1.2` | (new — effectively `1.0` today) |

The **thick line** = the player's own averaged signature strand (dark halo L246 + bold
gradient L247), always drawn today with no control. The **league-average line**
(`showLeagueAvg`, faint gray dashed overlay, L240–243) is a separate, already-shipped
v2 feature and is left as-is.

## A. Engine changes (`taste-waveform.ts`, applied identically in `ui/` and `bside/`)

### A1. Extend `TasteSettings` + defaults

Add fields to the `TasteSettings` interface and `DEFAULT_TASTE_SETTINGS`:

```ts
palette: 'neon' | 'cool' | 'spectrum';           // default 'neon'
lineStyle: 'strand' | 'solid' | 'none';          // default 'strand'
nodeStyle: 'glow' | 'dot' | 'none';              // default 'glow'
order: 'alt' | 'raw' | 'lyric-last' | 'lyric-first'; // default 'alt'
band: boolean;                                   // default false
bandOpacity: number;                             // default 0.04
amplitude: number;                               // default 1.0  (preserves current render)
```

**Back-compat is critical:** all defaults reproduce today's output exactly. `amplitude`
defaults to `1.0` (not the toy's `1.2`) so existing waveforms don't shift; the toy's
1.2 remains reachable via the slider. Old `read_model.taste.settings` blobs lacking
these keys resolve to defaults via the existing `{ ...DEFAULT_TASTE_SETTINGS, ...loaded }`
merge in every consumer.

### A2. Palette → theme resolution

Introduce a `THEMES` map keyed by `PaletteName`, each a 6-color trait array (source
values from the design zip's `sonic-signature.ts` `THEMES`):

```ts
const THEMES = {
  neon:     ['#ff5bbe','#ffd23a','#5affd0','#5a8cff','#ff5b6e','#b65bff'], // == current TRAITS
  cool:     ['#5aa3ff','#3fb6c4','#3ec27a','#6a8cff','#4ad0d9','#5ad0a0'],
  spectrum: ['#ff5b2e','#e8a83a','#5aa3ff','#3ec27a','#e6566c','#3fb6c4'],
};
```

`TRAITS` becomes `THEMES[settings.palette]` resolved once per engine build. `neon`
equals the current constant, so default output is byte-identical.

### A3. Axis order resolution

`ORDER` becomes a lookup by `settings.order`:

- `alt` → `[0,4,3,2,1]` (current)
- `raw` → `[0,1,2,3,4]`
- `lyric-last` → axis 4 (lyrical) moved to the end
- `lyric-first` → axis 4 first

Order only affects column placement (visual), not the archetype/read math, which uses
axis indices directly.

### A4. Render honors the new knobs (`buildChart`)

- **lineStyle** — gates the thick strand block (L245–247): `strand` = current gradient
  halo+stroke; `solid` = single flat stroke in a resolved trait/base color, no gradient;
  `none` = skip the thick line entirely (faint sample lines + nodes still render).
- **nodeStyle** — `glow` = current halo+core circles; `dot` = single small solid dot per
  node; `none` = skip nodes. Replaces the boolean `opts.nodes` gate.
- **band** — when on, fill the area between the strand and the center line at
  `bandOpacity`, using the resolved palette (a soft under-glow). Off by default.
- **amplitude** — multiply deviation before plotting (folds into the `TX`/`scale` path
  alongside `spread`); `1.0` = no change.

`BuildChartOpts` keeps `chrome`/`sample`/`leagueAvg`; the new look values come from
`settings` (already threaded into the engine), so per-call opts stay minimal. The
existing `opts.nodes` is superseded by `settings.nodeStyle`.

### A5. Separation score

Add an engine method:

```ts
separation(): { score: number; baseline: number; mult: number }
```

- `score` — mean Euclidean distance over all unordered player pairs in the (scoped)
  league, computed from each player's `sig6` vector (the same axis-adjusted space used
  for `leagueSig`).
- `baseline` — the same statistic computed under `signal: 'all'` (the flattening
  baseline the toy compared against).
- `mult` — `score / baseline` (the "×N vs all-votes" figure).

Implementation builds a second lightweight engine pass with `signal:'all'` on the same
`LeagueData` for the baseline. Guard: leagues with < 2 players return `score: 0, mult: 1`.

## B. API + persistence

- Extend the Zod schema in `ui/src/routes/api/settings/taste/+server.ts` with the seven
  new fields and sane bounds:
  - `palette` enum, `lineStyle` enum, `nodeStyle` enum, `order` enum
  - `band: boolean`, `bandOpacity: number` (0–0.3), `amplitude: number` (0.6–2.2)
- `getTasteSettings` / `DEFAULT_TASTE_SETTINGS` (in `$lib/db/settings.ts` and the engine)
  gain matching defaults.
- The existing POST apply-to-live path (transactional DB write + per-site
  `read_model.taste.settings` patch across all 3 dashboard sites) is unchanged — it just
  serializes more fields. No migration needed; absent keys fall back to defaults on read.

## C. Settings panel UI (`settings/setup` → Sonic Signature section)

### C1. "Configure the look" subsection

A new controls group beside the existing data controls:

- Palette — 3-way segmented (neon / cool / spectrum)
- Line style — 3-way segmented (strand / solid / none)
- Nodes — 3-way segmented (glow / dot / none)
- Axis order — select (alt / raw / lyric-last / lyric-first)
- Band — toggle + opacity slider (enabled only when band on)
- Amplitude — slider (0.6–2.2×)

All bind into the same `tasteSettings` object saved by the existing
`saveTasteSettings()` / apply-to-live flow. Live preview updates reactively (the engine
is a `$derived` of `tasteSettings`).

### C2. League → Player pickers + full-profile preview

- Two selects above the live preview: **League** (from the setup page's already-loaded
  `leagues`), then **Player** (players in that league, derived client-side).
- Player pool + rows come from the existing `/api/history/taste` block; the chosen
  league scopes it via `scopedLeague(block, settings, leagueId)`; the chosen player
  indexes into that scoped engine.
- Preview renders the **full hero profile**: waveform + archetype name + auto-written
  read + chips — the same view players see — so every knob's effect on the prose and
  chrome is visible in-panel.
- Default selection: first league, first player. Falls back gracefully if a league has
  no eligible players.

### C3. Separation score readout

For the currently-selected league, show `engine.separation()`:

- Big number (`score`, 1 decimal) + mono `"×{mult} vs all-votes"`.
- Caption: *"Mean distance between every pair of fingerprints. Higher = more distinct
  people."*
- Updates live as data knobs change (the point of the number: watch it move with signal
  source).

## D. Collapsible panels

- New reusable component `ui/src/lib/components/CollapsiblePanel.svelte`:
  - Props: `id` (stable key), `title`, optional `glyph`/`subtitle`, `defaultOpen=false`.
  - Header row with title + chevron; body slot; smooth expand/collapse.
  - Persists open/closed in `localStorage` under a namespaced key (`tw-panel:{id}`);
    **collapsed by default** on first visit.
- Wrap every `<section>` panel in:
  - **App Settings** (`/settings`): Email ingestion, Song metadata queue, Rating
    weights, Rating weights (legacy), ZIP import & rescan, Debug mode.
  - **Music League Setup** (`/settings/setup`): Leagues & Seasons, Round management, ML
    competitor roster, Player roster, Bulk-set deadlines, Sonic Signature settings.
- Wrapping is presentational only — no change to each panel's internal logic.

## E. bside gear verification

Grep confirms no `cog`/`gear`/`localStorage`/settings-toggle in `bside/src` (removed in
v2 Task 4). This spec requires only a **visual confirmation** on a live bside profile /
share overlay that no settings affordance is present. No code change expected; if any
stray affordance is found, remove it.

## Isolation / boundaries

- **Engine** (`taste-waveform.ts`) — pure render+math; owns palette/order/lineStyle/
  nodeStyle/band/amplitude/separation. No UI, no fetch. Tested in isolation.
- **API** (`/api/settings/taste`) — validates + persists + applies-to-live. Contract:
  `TasteSettings` in, `{ ok, patched }` out.
- **CollapsiblePanel** — generic presentational wrapper, zero coupling to taste.
- **Settings panel** — composes engine + pickers + separation; the only place the three
  come together.

The two engine copies (`ui/` and `bside/`) must stay in lockstep — every engine change
is applied to both files identically (existing project pattern).

## Testing

- **Engine unit tests** (`ui/src/lib/taste-waveform/*.test.ts`):
  - defaults reproduce current SVG (palette=neon, order=alt, lineStyle=strand,
    nodeStyle=glow, band=off, amplitude=1.0 → unchanged output markers).
  - palette swaps trait colors; order permutes column x-positions; lineStyle=none omits
    the thick strand; nodeStyle=none omits nodes.
  - `separation()` math: known small fixture → hand-checked mean pairwise distance;
    < 2 players → `score 0, mult 1`.
- `npm run check` (svelte-check) clean.
- Dev-server visual smoke on `/settings/setup`: pickers switch players, look knobs
  change the preview, separation number moves with signal source; panels collapse and
  persist; App Settings panels collapse too.
- Visual confirm bside has no settings gear.

## Non-goals

- No new palettes beyond the three from the design source.
- No per-player persisted settings — settings remain system-wide (v2 decision).
- No changes to the data knobs or the league-average line.
- No changes to digest export beyond what the shared engine already produces.
