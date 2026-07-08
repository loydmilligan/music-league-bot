# Feature Design Brief — League Research tab *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** music-league-bot
> **Feature:** "League research" tab on the `/history` screen · **Date:** 2026-07-07 · **Brief version:** 1
> **Repo (local checkout):** `/home/loydmilligan/Projects/music-league-bot`

---

## 0. How CD will use this brief *(fixed — do not edit)*

CD will: (1) read this brief and load/observe the design system as it's actually
implemented; (2) confirm and, if needed, top up the decision points to 4–6 total;
(3) build a pannable **canvas** of options with visual aids — both for the ideas named
and for the open areas CD is invited to explore; (4) iterate in chat to settle each
decision; (5) produce the **full design** for the feature, fitted to the existing product;
(6) write a process summary and decision log; (7) assemble a **handoff packet** (see
`Handoff-Packet-Manifest.md`); (8) return a **kickoff prompt** for CC to implement.

---

## 1. Product & feature snapshot

- **Product:** A private companion app for the group's Music League games — imports league
  export data, enriches every song (popularity/obscurity, audio features, genre tags), and
  surfaces research + digest tooling. SvelteKit web UI, dark "ops dashboard" aesthetic.
- **The feature, in one sentence:** A new **League research** tab on `/history` that presents a
  small set of "that's kinda cool" analytical visuals scoped to **a single league at a time**.
- **Why now:** Fast-follow on the history tooling — the team wants to explore interesting angles
  over a league's data and see which visuals earn their keep before investing further (and,
  later, feeding the digest).
- **Who reviews / decides:** The repo owner (single decision-maker).
- **Deadline / milestone, if any:** None. This is an exploratory first pass.

---

## 2. Repo orientation

- **What the codebase is:** SvelteKit app (Svelte 5 runes) under `ui/`, SQLite via
  better-sqlite3, Tailwind **v4** (`@import "tailwindcss"` + `@theme`, **no** `tailwind.config.js`).
  All UI in `ui/src/`. Charts are **hand-rolled** (raw SVG strings or pure CSS/flex bars) —
  **there is no charting library and one should not be added.**
- **How to run / view it:** `cd ui && npm run dev`; the feature lives at route `/history`
  (new tab `?tab=league`). Prod: `mlb37.mattmariani.com` (dark theme only).
- **Key directories:** `ui/src/routes/history/` (the screen), `ui/src/lib/components/`
  (reusable UI), `ui/src/lib/taste-waveform/` (the SVG "Sonic Signature" engine),
  `ui/src/lib/digest/` (pure-CSS charts like `StandingsChart.svelte`), `ui/src/app.css` +
  `ui/src/lib/shortlist/colors_and_type.css` (the two token sources).

### 2a. Design system, as implemented

- **System in use:** **"Mash Co."** — a dark-first, monospace-accented, data-dense system with a
  single hot-orange "pulp" accent. It is fully implemented in the repo; **match it exactly.** No
  external/named system (Mashco/DogBelly) should be introduced.
- **Where tokens live:**
  - `ui/src/app.css` (lines 15–62) — Tailwind v4 `@theme` block → generates the utility classes
    the tab components actually use (`bg-bg`, `text-accent`, `font-mono`, …). **Dark-only.**
  - `ui/src/lib/shortlist/colors_and_type.css` (322 lines) — the `:root` CSS-variable "single
    source of truth" (`--ink-*`, `--mash-*`, `--fg`, `--r-*`, `--fs-*`) used by the vanilla-CSS
    charts (StandingsChart, taste-waveform). Imported by `app.css`.
- **Component library location & inventory:** `ui/src/lib/components/` — see §8.
- **Icon set / illustration system:** No icon library. Uses **Unicode glyphs** as marks
  (`♪ ◈ ◑` for the existing tabs; `▾` chevrons; `+`/`−` toggles; `▲/▼/–` movement arrows;
  emoji medals `🥇🥈🥉💩🗣️`).
- **Fonts:** `font-display` = **Bricolage Grotesque** (headings), `font-sans` = **Inter Tight**
  (body), `font-mono` = **JetBrains Mono** (labels/counts/eyebrows — used heavily).

### 2b. Existing visual & interaction vocabulary

- **Color palette (actual tokens/hex):**
  - Surfaces: `bg #07090c` (page) · `bg-elevated #0d1116` (section cards) · `surface #141921` ·
    `surface-hover #1d2128` · `border #3a4451` · `border-muted #283039` (default card border).
  - Text: `fg #f1f4f7` · `fg-muted #c2cad3` · `fg-dim #8b97a4` · `fg-faint #5a6773` (labels/eyebrows).
  - Accent: `accent #ff5b2e` ("pulp", active/primary, used sparingly) · `accent-strong #d94c23` ·
    `accent-deep #8a2d15` · `accent-bg #221a14`.
  - **Data/axis palette** (use these for series colors): `sky #5aa3ff` · `ember #e6566c` ·
    `moss/health #3ec27a` · `amber #e8a83a`. The taste-waveform default "neon" theme adds
    `#ff5bbe #ffd23a #5affd0 #5a8cff #ff5b6e #b65bff`.
- **Type scale:** `--fs-*` = 12/13/15(base)/17/20/26/34/46/62/84px; semantic classes `.t-h1`–`.t-h4`,
  `.t-eyebrow`, `.t-mono`. Eyebrows are all-caps mono, `tracking-widest`, `text-[10px]`,
  `text-fg-faint`.
- **Spacing:** `--s-1..11` = 4/8/12/16/20/24/32/40/56/72/96px. Cards `rounded-xl`; chips
  `rounded-sm`/`rounded-full`.
- **Signature components & behavior:** hairline cards (`bg-surface border border-border-muted
  rounded-xl`); `CollapsiblePanel` accordions with `+`/`−` toggle + persisted open state;
  `MetricTiles` KPI grid (`text-3xl font-display` numbers, mono captions); `StatusChip` pills
  (`text-[10px] tracking-widest uppercase`); pure-SVG waveforms and pure-CSS bar charts.
- **Interaction patterns:** one-open-at-a-time accordions keyed by id; `Esc` collapses an open
  item; tab state deep-linked via `?tab=` with `goto(replaceState, keepFocus, noScroll)`; full
  arrow-key roving `tablist`; tooltips are **native `title=`** (no tooltip component).
- **Tone of UI copy:** terse, lowercase-technical, console-flavored. Real strings:
  breadcrumb `music-league-bot · /history`; count headers `Results [{n}]` / `Players [{n}]`;
  empty states in **italic mono** e.g. *"No players yet — once leagues are imported they show up
  here."*; errors as `text-warn` mono; button `Search`/`Searching…`.
- **Established states:** **no skeletons.** Loading = italic-mono line (*"Loading {name}…"*);
  empty = italic-mono line; error = `font-mono text-xs text-warn` line.

### 2c. Current information architecture

- **Top-level nav / IA:** `/history` is a `max-w-5xl` screen with an h1 "History", a one-line
  blurb, and a `role="tablist"` strip (bottom-border, active tab = `border-accent text-accent`).
  Three tabs today: **♪ Song search** (`songs`, default), **◈ Theme research** (`themes`),
  **◑ Player research** (`players`). Deep-linked via `?tab=`. Each tab body is
  `<div class="space-y-6">` → a lead intro `section` (`bg-bg-elevated … rounded-xl p-4` + mono
  eyebrow) → a results `section`.
- **Where the user is when this feature becomes relevant:** browsing `/history` to explore the
  league corpus; this adds a fourth sibling tab for single-league deep exploration.

---

## 3. The feature — what & why

- **What it does:** Adds a **League research** tab. The user picks **one league** (and optionally
  one season vs all seasons), then sees three visuals over that scope: a directional
  voter→submitter **points heatmap** (with an attribute lens), an **obscurity drift** line chart,
  and a per-player **submit-vs-vote genre** comparison.
- **Core user value:** Surfaces social/relational and taste patterns within a league that the
  numbers-only tabs can't show — "who rewards whom, and for what kind of song," "is the league
  drifting obscure," "does this person vote for what they submit."
- **The one outcome it must deliver:** At least one visual that makes the owner go "huh, that's
  cool" and want to keep it. This is a discovery pass, not a committed dashboard.
- **Scope — in / out / later:**

| In scope | Explicitly out | Later |
|---|---|---|
| New `league` tab; league + season scope controls; the 3 visuals; native Mash Co. styling; empty/loading/error states | Digest integration / "flag for digest"; league superlatives (already exist); voting-by-playlist-position (needs a data backfill); any new charting library | Digest hooks once a visual proves out; playlist-position chart after backfill; per-visual export/share |

---

## 4. Where it lives — touchpoints & entry points

- **Screens this touches:** only `ui/src/routes/history/+page.svelte` (add a 4th tab + panel) and
  a new `ui/src/lib/components/LeagueResearchTab.svelte`. New API routes under
  `ui/src/routes/api/history/league/[leagueId]/`. **No other screen changes.**
- **New entry points:** the 4th tab in the `/history` tab strip; deep link `?tab=league`.
- **How it fits the current IA:** a sibling of the existing three tabs, same shell and layout
  convention. It is the **only** tab that is single-league-scoped (siblings are whole-corpus).
- **What it must not disrupt:** the existing three tabs, their deep-linking, and the roving
  arrow-key tablist behavior must keep working unchanged.

---

## 5. Users & jobs for this feature

- **Who uses this feature:** the repo owner (and one other trusted user) — no public/end-user
  audience.
- **Jobs-to-be-done (priority order):**
  1. Explore relational dynamics in a league — who rewards/punishes whom, and for what kind of song.
  2. See whether a league's taste drifts (more obscure / poppier) over time.
  3. Compare what a player submits vs what they vote for.
- **Frequency & context:** occasional, exploratory, desktop-first (it's a research/ops surface).
- **What they do today instead:** the numbers-only Player research tab + manual SQL / intuition.

---

## 6. Ideas to flesh out *(named by the team)*

### Idea A — Directional points heatmap (with attribute lens)
- **The idea:** Matrix, rows = voters, cols = submitters (league roster), cell = points that voter
  gave that submitter within scope; self-cells blank. A **mode toggle** switches the cell encoding:
  `Points` (brightness = total points) vs `Obscurity` / `Energy` / `Era` (cell = points-weighted
  average of that attribute across the songs the voter rewarded).
- **Why the team is interested:** Reveals blocs, one-way admiration, quiet rivalries — and, with the
  lens, "does A reward B *specifically* for obscure picks?" This is the flagship and the most novel.
- **Known constraints / behavior:** Bounded by a single league's roster (so not sparse the way a
  corpus-wide matrix would be). Native `title=` tooltip shows raw numbers (points, song count,
  attribute value). Attribute sources: obscurity = `100 − popularity_proxy`, energy from audio
  features, era from release metadata (exclude songs lacking a year).
- **Open questions:** How to express the lens visually (see D2). How large can a roster get (some
  leagues may have 15–20+ players → matrix legibility).

### Idea B — Obscurity drift
- **The idea:** Line chart, x = rounds in chronological order (spanning seasons under "All
  seasons", with season boundaries marked), y = obscurity (`100 − popularity_proxy`). **Line A** =
  league median obscurity of each round's submissions; **Line B** = obscurity of each round's
  **winning** song.
- **Why the team is interested:** Shows both the league's drift and whether obscure songs actually
  win — a single glanceable trend.
- **Known constraints / behavior:** Single season → only that season's rounds. Should read natively
  next to the existing SVG waveforms / CSS bars.
- **Open questions:** Chart style + how season boundaries and the "winning song" series render
  (see D4).

### Idea C — Genre radar (submit vs vote)
- **The idea:** Per-player comparison of the genres a player **submits** vs the genres they **vote
  for** (points-weighted). Axes = top ~8 genres in the chosen league (from `song_popularity.tags`,
  Last.fm); rarer tags ignored. Player picker selects the subject.
- **Why the team is interested:** Exposes mismatches — "submits indie, votes pop." Complements the
  abstract Sonic Signature with real genre *names*.
- **Known constraints / behavior:** Last.fm tags are free-form and messy (casing, near-dupes like
  "hip hop"/"hip-hop") — expect normalization iteration. The app has **no radar precedent** but a
  strong **bar-chart** precedent (`StandingsChart`, `CostBarChart`).
- **Open questions:** Radar vs paired/diverging bars (see D3).

---

## 7. Open areas for CD to explore *(proposed by CC)*

### Open area 1 — Scope controls (league + season): placement, persistence, and shared behavior *(proposed by CC)*
- **What it is & why it's worth a look:** All three visuals react to one league + season selection.
  Where do those controls live (a persistent header bar above the visuals? inline per-visual?), how
  do they read in the Mash Co. vocabulary (pill row like the player selector? a mono dropdown?), and
  does the selection persist across tab switches / reloads (the app already persists panel open-state
  via `panelState.ts` and deep-links tab state via `?tab=`). This is the connective tissue of the
  whole tab.
- **How it relates:** Without a clear, native scope-control pattern, three good visuals feel like
  three disconnected widgets.

### Open area 2 — Early / sparse-league states *(proposed by CC)*
- **What it is & why it's worth a look:** A league with one season or few rounds gives a thin
  heatmap and a 2-point drift line. The app has a strong italic-mono empty-state voice but no
  "partial data" pattern. Worth a few options for how each visual degrades gracefully (and what the
  minimum viable data is before a visual renders vs shows a "not enough data yet" line).
- **How it relates:** These visuals will frequently run on small leagues; graceful low-data behavior
  determines whether the tab feels solid or broken on day one.

---

## 8. Existing patterns to honor / reuse

- **Components to reuse as-is:**
  - `ui/src/lib/components/CollapsiblePanel.svelte` — the accordion for each visual section (persists
    open state per-`id`).
  - `ui/src/lib/components/StatusChip.svelte` — pills / mode tags (tones: accent/health/muted/warn/sky/ember/amber).
  - `ui/src/lib/components/SectionLabel.svelte` — uppercase mono eyebrows.
  - `ui/src/lib/metadata-queue/MetricTiles.svelte` — the KPI/stat-tile grid, if any summary numbers
    are wanted atop a visual.
  - `ui/src/lib/components/DotIndicator.svelte`, `BadgeStrip.svelte` — as needed.
- **Patterns to follow:**
  - Tab body layout: `<div class="space-y-6">` → lead intro `section` (`bg-bg-elevated border
    border-border-muted rounded-xl p-4` + mono eyebrow) → visual sections.
  - Collapsible sub-section header: mono `text-[10px] tracking-widest uppercase text-fg-faint` label
    + `▾` chevron that toggles `class:rotate-180`, divided by `pt-3 border-t border-border-muted`
    (see `PlayerResearchTab.svelte` ~lines 578–692).
  - Charts: **raw SVG string** (à la `taste-waveform/taste-waveform.ts`, Catmull-Rom splines,
    `linearGradient` defs, `preserveAspectRatio` responsive) **or pure CSS/flex bars** (à la
    `digest/StandingsChart.svelte`, `debug/CostBarChart.svelte`). **Never a charting library.**
  - The **data-attribute viz seam**: history rows layer color via `[data-history-status]` CSS
    (`history/history-coloring.css`) and ranked bars via `taste-overlap-row ::before` widths — the
    sanctioned way to paint viz onto rows without touching data wiring.
  - Series colors from the `sky / ember / moss / amber` axis palette or `--mash-pulp`; tooltips via
    native `title=`; empty/loading = italic-mono lines; errors = `text-warn` mono.
- **Things CD may extend, with care:** a new custom SVG chart module for the heatmap and the drift
  line (following the taste-waveform build approach); a scope-control bar component.
- **Things CD should NOT touch / change:** the existing three tabs and their content; the tablist /
  deep-link / arrow-key behavior in `history/+page.svelte`; the token files; the dark-only theme.

---

## 9. Decision points to game out ⭐

> These are the "let's see the options visually" asks. D1–D3 especially want an in-context canvas —
> the visual shown **inside the real `/history` shell**, dark Mash Co. styling, on realistic league
> data (10–20 players, several rounds).

---

### D1. How do three heterogeneous visuals coexist in one tab? · **[Proposed by CC]**

- **The decision / question:** What is the tab's overall layout — the heatmap, the drift line, and
  the genre comparison are very different shapes and sizes.
- **Why it matters:** Sets the whole feel of the tab and how much scrolling/switching the user does;
  affects how the shared scope controls attach (Open area 1).
- **Options on the table:**
  1. **Stacked `CollapsiblePanel` sections** (one per visual) — most native, matches
     PlayerResearchTab; user expands what they want.
  2. **Single visual switcher** — a mono segmented control picks one visual at a time, rendered big
     in one canvas; least clutter, most focus (fits "conservative first pass").
  3. **Dashboard grid** — all three visible at once in a responsive grid; most "wow" but densest and
     hardest to keep legible.
- **Constraints from the existing system:** must live in the `max-w-5xl` shell; reuse
  `CollapsiblePanel`; desktop-first.
- **What CD should put on the canvas:** 2–3 in-context layouts of the full tab (real shell + scope
  bar + populated visuals), so the density trade-off is visible.
- **How we'll decide:** which reads as native and least cluttered while still showing something
  cool on first load.

---

### D2. How is the heatmap's attribute lens expressed? · **[Required — from team]**

- **The decision / question:** When the mode is `Obscurity` / `Energy` / `Era`, how does the matrix
  show it — versus the base `Points` view?
- **Why it matters:** This is the flagship's whole payoff; the wrong encoding makes it a pretty grid
  that says nothing.
- **Options on the table:**
  1. **Single matrix, recolor on toggle** — one grid; the mode toggle swaps the color scale (points
     → attribute average). Simplest, fits conservative first pass.
  2. **Small multiples** — mini-matrices side by side (Points / Obscurity / Energy), compare at a
     glance; denser.
  3. **Bivariate cells** — cell *size* = points, cell *hue* = attribute; one grid encodes both at
     once; richest but hardest to read.
- **Constraints:** raw-SVG grid; native `title=` tooltips; single-league roster (bounded size, but
  15–20+ players stresses legibility); use the axis palette for the color scale.
- **What CD should put on the canvas:** the same real matrix rendered all three ways, at a realistic
  roster size, with the `Points` baseline shown alongside.
- **How we'll decide:** does the "A rewards B for obscure picks" insight pop out without reading the
  tooltip?

---

### D3. Genre comparison — radar vs. paired/diverging bars? · **[Required — from team]**

- **The decision / question:** Idea C is written as a radar, but the app has no radar precedent and a
  strong bar precedent. Radar or bars?
- **Why it matters:** Radar charts distort area and are debated for accuracy; bars would match
  `StandingsChart`/`CostBarChart` and ship more native. But the radar reads as more "signature" and
  sits near the Sonic Signature waveform.
- **Options on the table:**
  1. **Radar / spider** (submit polygon vs vote polygon overlaid) — signature look, matches the
     waveform's spirit.
  2. **Paired horizontal bars** (per genre: submit % vs vote %) — most native, pure-CSS, most
     legible.
  3. **Diverging / tornado bars** (submit left, vote right off a center axis) — compact, emphasizes
     mismatch direction.
- **Constraints:** top ~8 league genres as the categories; points-weighted vote distribution; pure
  CSS or raw SVG.
- **What CD should put on the canvas:** the same player's submit-vs-vote data shown as radar and as
  (at least one) bar form, side by side.
- **How we'll decide:** which makes "submits X, votes Y" clearest while looking native to Mash Co.

---

### D4. Obscurity-drift chart style & season boundaries · **[Proposed by CC]**

- **The decision / question:** How the two-line drift renders, and how "All seasons" boundaries and
  the "winning song" series are drawn.
- **Why it matters:** Determines whether the trend is glanceable and whether season structure is
  readable in the "All seasons" view.
- **Options on the table:** (a) smooth SVG spline in the taste-waveform idiom with vertical season
  dividers + labels; (b) stepped/area line; (c) winning-song series as a second line vs. dots vs. a
  shaded band around the median.
- **Constraints:** raw SVG; axis palette (e.g. median = pulp, winner = sky); responsive
  `preserveAspectRatio`.
- **What CD should put on the canvas:** 2 style variants over a multi-season timeline.
- **How we'll decide:** trend legibility + native feel next to the waveforms.

---

### D5. *(open stub for CD)* — e.g. scope-control bar treatment (Open area 1) or sparse-data states (Open area 2). **[Proposed by CC]**

---

## 10. Constraints

- **Technical:** SvelteKit + Svelte 5 runes; Tailwind v4 `@theme` utilities; SQLite read side.
  **No charting library** — SVG strings or CSS bars only. Desktop-first; keep DOM light for
  large matrices.
- **Brand & consistency:** must read as the same "Mash Co." product — dark-only, JetBrains Mono
  labels, pulp accent used sparingly, hairline `rounded-xl` cards.
- **Accessibility bar:** match existing behavior — roving-tabindex tablist already handled at the
  page; keyboard-reachable controls; sufficient contrast on the dark palette; do not rely on color
  alone for the heatmap (tooltips carry raw numbers).
- **Risks / past problems:** (assumption) genre-tag normalization will be noisy; (assumption) large
  rosters could make the heatmap cramped; the winning-song obscurity line depends on release-year
  coverage which is partial (era mode must degrade gracefully).

---

## 11. Success criteria

- **How we'll judge the design is good:** it looks indistinguishable from a native `/history` tab;
  at least one visual produces an immediate "that's cool"; each visual is legible on realistic
  single-league data without reading tooltips.
- **Metrics it should move:** none formal — this is a discovery pass; the bar is "worth keeping /
  worth feeding the digest later."
- **What "fits the product" means, concretely:** reuses `CollapsiblePanel` / `StatusChip` /
  `MetricTiles`; charts built as SVG/CSS in the taste-waveform / StandingsChart idiom; mono eyebrows;
  italic-mono empty/loading and `text-warn` errors; pulp + axis-palette colors only.

---

## 12. Deliverables & logistics

- **Fidelity expected:** high-fidelity in-context mockups (feature shown inside the real `/history`
  shell, dark Mash Co. styling) — enough to choose D1–D4.
- **Variations wanted, and on what:** the option sets named in D1 (layout), D2 (lens encoding), and
  D3 (radar vs bars) are the priority canvases; D4 is secondary.
- **Deliverable format:** Handoff packet per `Handoff-Packet-Manifest.md` (zip) + a kickoff prompt
  for CC to implement. Additions: a token/component mapping showing which existing classes and
  components each new element uses.
- **Review cadence:** single owner reviews the canvas, settles D1–D4 in chat, then approves the full
  design.

---

## 13. Open questions & unknowns

- Genre-tag normalization approach (casing/near-dupes) — how aggressive, and picked by whom? *(unknown — needs decision)*
- Maximum realistic league roster size, which drives heatmap legibility. *(unknown — CD should design for ~15–20)*
- Release-year coverage for the heatmap "Era" mode and the drift winning-song line. *(assumption: partial; degrade gracefully)*
- Whether scope selection should persist across tab switches / reloads (deep-link vs local state). *(unknown — Open area 1)*
- Minimum data thresholds before each visual renders vs. shows a "not enough data" line. *(unknown — Open area 2)*

---

## Appendix — file map & references

- **Design tokens:** `ui/src/app.css` (15–62, Tailwind v4 `@theme`), `ui/src/lib/shortlist/colors_and_type.css` (`:root` vars).
- **Component library:** `ui/src/lib/components/` (`CollapsiblePanel`, `StatusChip`, `SectionLabel`, `DotIndicator`, `BadgeStrip`), `ui/src/lib/metadata-queue/MetricTiles.svelte`.
- **Chart references:** `ui/src/lib/taste-waveform/taste-waveform.ts` + `TasteWaveform.svelte` (SVG idiom); `ui/src/lib/digest/StandingsChart.svelte`, `ui/src/lib/debug/CostBarChart.svelte` (pure-CSS bars); `ui/src/lib/history/history-coloring.css` + `taste-overlap.css` (data-attribute viz seam).
- **Screens the feature touches:** `ui/src/routes/history/+page.svelte`; sibling tabs `SongSearchTab.svelte`, `ThemeResearchTab.svelte`, `PlayerResearchTab.svelte` in `ui/src/lib/components/`.
- **Design spec (source of truth for behavior):** `docs/superpowers/specs/2026-07-07-league-research-tab-design.md`.
- **Other references:** `docs/Music League Stats Architecture Summary.md` (the reference project this borrows concepts from).
