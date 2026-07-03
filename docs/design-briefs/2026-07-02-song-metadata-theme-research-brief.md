# Feature Design Brief *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** Music League bot
> **Feature:** Song-metadata display in the Theme Research surface · **Date:** 2026-07-02 · **Brief version:** 1
> **Repo (local checkout):** `/home/loydmilligan/Projects/music-league-bot`

---

## 0. How CD will use this brief *(fixed — do not edit)*

CD will: (1) read this brief and load/observe the design system as implemented; (2) confirm/top up decision points to 4–6; (3) build a pannable canvas of options with visual aids; (4) iterate to settle each; (5) produce the full design fitted to the product; (6) write a process + decision log; (7) assemble a handoff packet; (8) return a kickoff prompt for CC to implement.

---

## 1. Product & feature snapshot

- **Product:** A private companion web app for a group's Music League games — imports league data, researches songs/players/themes, and generates round "digests." SvelteKit UI, dark, dense, mono-accented ("Mash Co." house style).
- **The feature, in one sentence:** Surface the per-song metadata we already collect (popularity/obscurity, audio features, lyrics presence, genre tags) inside the **Theme Research** view, so the user can size up past picks at a glance and on demand.
- **Why now:** We've built a metadata pipeline (Last.fm popularity, Spotify popularity, librosa audio features, LRCLIB lyrics, genre tags) but it's largely invisible in the app — it only shows in the digest Tastemaker section and the universal SongCard. The user wants it where they *research*.
- **Who reviews / decides:** The single owner/operator (solo product).
- **Deadline / milestone:** None. **Conservative first pass** explicitly requested.

---

## 2. Repo orientation *(from the local checkout)*

- **What the codebase is:** SvelteKit (adapter-node, **Svelte 5 runes**), Tailwind **v4**, better-sqlite3. UI lives in `ui/`. Self-contained (its own `/api/*` server routes + sqlite at `data/league.db`).
- **How to run / view it:** `cd ui && npm run dev -- --host --port 51XX`. Type-gate: `npm run check`. Routes of interest below.
- **Key directories:** `ui/src/routes/history/` (target area), `ui/src/lib/components/` (feature components incl. the three research tabs), `ui/src/lib/song/` (universal SongCard), `ui/src/lib/digest/` (KPI tiles, sections), `ui/src/lib/db/schema.ts` (data model), `ui/src/app.css` + `ui/src/lib/shortlist/colors_and_type.css` (design tokens).

### 2a. Design system, as implemented

- **System in use:** **Mashco** (the "Mash Co. Design System"), implemented directly in code. CD should treat the **in-code tokens as source of truth**.
- **Where tokens live:** `ui/src/app.css` (Tailwind v4 `@theme {}` → utilities like `bg-surface`, `text-fg-dim`) which imports `ui/src/lib/shortlist/colors_and_type.css` (raw Mash Co custom properties). The two are kept in sync (same hex, different names). A design-system handoff copy also lives at `data/Mash Co. Design System-handoff/mash-co-design-system`.
- **Component library:** `ui/src/lib/components/`, `ui/src/lib/song/`, `ui/src/lib/digest/`, `ui/src/lib/metadata-queue/` (inventory in §8).
- **Icon set / illustration:** No icon library — the app uses **emoji** (🥇🥈🥉💩🗣️♪♫) and small inline SVG (e.g. TasteWaveform). Section markers are text glyphs (`+`/`−`, `∴`, `◎`).
- **Fonts:** `--font-display` "Bricolage Grotesque"; `--font-sans` "Inter Tight"; `--font-mono` "JetBrains Mono".

### 2b. Existing visual & interaction vocabulary

- **Color palette (actual):**
  - Surfaces (darkest→lighter): `--ink-0 #07090c` (bg) · `--ink-1 #0d1116` (elevated) · `--ink-2 #141921` (surface/cards) · `--ink-3 #1d2128` (hover) · `--ink-4 #283039` (line/border-muted) · `--ink-5 #3a4451` (border).
  - Text: `--fg #f1f4f7` · `--fg-2 #c2cad3` (muted) · `--fg-muted #8b97a4` (dim) · `--fg-quiet #5a6773` (faint/eyebrows).
  - Accent (brand orange): `--accent #ff5b2e` · strong `#d94c23` · deep `#8a2d15` · tinted bg `#221a14`.
  - **Axis/metadata colors (use these for any metadata gauges):** Discovery/obscurity **sky `#5aa3ff`**; Theme-fit/error **ember `#e6566c`**; Quality/success **moss `#3ec27a`**; Replayability/warning **amber `#e8a83a`**. Chip surfaces: `--sky-bg #16263f`, `--ember-bg #3b1a22`, `--health-bg #1d3a2a`.
- **Type scale:** `--fs-xs 12` / `sm 13` / `md 15` (base) / `lg 17` / `xl 20` / `2xl 26` / `3xl 34` … Eyebrow labels: `.t-eyebrow` = 12px bold mono uppercase 0.08em tracking.
- **Spacing/grid/density:** 4px base scale (`--s-1..11`). **Dense**, information-rich layouts. De-facto card/panel radius is `rounded-xl` (~12px); chips `rounded-sm`/`rounded-full`.
- **Signature components & behavior:** Cards/panels = `bg-bg-elevated`/`bg-surface` + `border border-border-muted rounded-xl`. **Collapsible rows** (Theme/Player research) expand in place, gaining a `border-accent-deep` accent when open. KPI **stat tiles** (`StatStrip`, `MetricTiles`): mono tabular value + tiny mono-caps label. **StatusChip**: 10px mono, tracking-widest, uppercase, 1px border, 7 tones.
- **Interaction patterns:** Expansion via in-place collapse/expand (research tabs) OR a mobile **bottom-sheet** + desktop expanded sheet (universal `SongCard`/`SongSheet`). Save actions show inline `"Saved ✓"` (mono, `fg-faint`, auto-dismiss 2s). Motion tokens: `--dur-fast 120ms` / `--dur-base 200ms`, `--ease-out`.
- **Tone of UI copy:** Terse, mono-caps section eyebrows; lowercase italic for empty/loading. Real strings: `"No themes yet — once leagues are imported they show up here."`, `"Loading themes…"`, section eyebrows like `"TASTE OVERLAP"`, `"SONGS SUBMITTED"`, `"SIGNAL MODE"`.
- **Established states:** Empty/loading = `font-mono text-sm text-fg-faint italic`. Section eyebrow = `font-mono text-[10px] tracking-widest uppercase text-fg-faint`.

### 2c. Current information architecture

- **Top-level nav** (`ui/src/routes/+layout.svelte`): Active round `/` · Shortlist `/shortlist` · Chat Content `/chat` · Content `/content` · **History `/history`** · Settings `/settings`.
- **History is 3 URL-driven tabs:** `/history?tab=songs` (Song Search), `?tab=themes` (**Theme Research** ← this feature), `?tab=players` (Player Research). Tab strip: `border-b`, active `border-accent text-accent border-b-2`.
- **Where the feature becomes relevant:** the user is in **Theme Research** looking at a past round's theme and its picks, deciding what a theme rewards / what songs fit.

---

## 3. The feature — what & why

- **What it does:** For each song shown in Theme Research, display the metadata we already store — **obscurity/popularity**, **audio features** (BPM, key/scale, energy), **lyrics presence**, and **genre tags** — as compact inline signals on the row, with a way to expand a single song for the full detail.
- **Core user value:** Judge a theme's picks (and by extension what the theme rewards) using objective signal, without leaving the research view or cross-referencing the digest.
- **The one outcome it must deliver:** At a glance in Theme Research, the user can read each pick's key metadata; on demand, see everything known about one song.
- **Scope — in / out / later:**

| In scope | Explicitly out | Later (phase 2) |
|---|---|---|
| Metadata display in **Theme Research** (`ThemeResearchTab.svelte`) | Editing/entering metadata (except existing flows) | Add metadata as an **option on the universal SongCard** (`ui/src/lib/song/SongCard.svelte`) → makes it available on Song Search + many screens |
| **Inline chips/badges** on pick rows + **expandable per-song detail** | Showing it on Song Search / Player Research now | Cross-song comparison views |
| Partial-coverage ("not analyzed yet") handling | New metadata *collection* | Filtering/sorting themes by metadata |

---

## 4. Where it lives — touchpoints & entry points

- **Screen this modifies:** `ui/src/lib/components/ThemeResearchTab.svelte` (rendered at `/history?tab=themes` via `ui/src/routes/history/+page.svelte`).
- **Current state of that screen:** a collapsible list of past round themes; expanding a theme reveals its **picks** ranked by points — each pick row today shows: rank · title · artist (mono) · submitter pill · points (accent, `font-display` bold). Data from `GET /api/history/themes` → `{ theme, season, round, picks: [{ title, artist, submitter, points }] }`.
- **New entry points:** none new at the nav level — the metadata attaches to existing pick rows (inline) and a per-song expand affordance.
- **How it fits IA:** an enhancement *within* the Theme Research tab; no new route.
- **What it must not disrupt:** the theme→picks collapse/expand behavior; the `data-artist`/`data-submitter`/`data-points` attributes on pick rows (a documented future viz seam); the History coloring system.

---

## 5. Users & jobs for this feature

- **Who:** the solo operator doing theme research (power user, knows the data).
- **Jobs-to-be-done (priority):**
  1. Skim a theme's picks and read each song's headline metadata (how obscure? fast/slow? energetic? has lyrics?) without extra clicks.
  2. Drill into one song to see everything known about it (all popularity/audio/lyrics/tags fields).
  3. Infer what a theme *rewards* (e.g., "this theme skews deep-cut, low-energy, instrumental").
- **Frequency & context:** occasional, deliberate research sessions; desktop-first but the app is mobile-aware (bottom-sheets exist).
- **What they do today instead:** cross-reference the digest Tastemaker section, or open the universal SongCard elsewhere — metadata isn't in Theme Research at all.

---

## 6. Ideas to flesh out *(named by the team)*

### Idea A — Inline metadata chips/badges on pick rows
- **The idea:** compact, at-a-glance metadata signals rendered directly on each theme pick row (no expansion needed).
- **Why interested:** the primary job is *skimming* picks; chips keep the density the app favors.
- **Known constraints / behavior:** must fit the existing pick-row layout (rank · title · artist · submitter · points) without crowding it; use the axis colors (sky/ember/moss/amber) and the `StatusChip`/mono-caps idiom already in the app; conservative = a *small* curated set of chips, not every field.
- **Open questions:** which 2–4 metadata make the cut for inline (see D1); how to encode obscurity (number vs bucket label like "Rabbit Hole" vs colored dot); how chips wrap on narrow widths.

### Idea B — Expandable per-song detail (drawer/expand)
- **The idea:** click a pick to reveal the *full* metadata for that one song — all popularity/audio/lyrics/tags fields, laid out.
- **Why interested:** the deep-dive job; keeps the row clean while making everything reachable.
- **Known constraints / behavior:** the app already has two expand idioms — (a) in-place collapsible rows (Theme/Player research), and (b) the universal SongCard's expanded sheet + mobile bottom-sheet. The expand should reuse one of these, not invent a third (see D2). Note there is a **nesting** consideration: a theme is already an expandable row, so a per-pick expand is an expand-within-an-expand.
- **Open questions:** in-place expand vs side drawer vs bottom sheet; what the full detail layout looks like (mirror the SongCard `statRow`?).

---

## 7. Open areas for CD to explore *(CC-identified)*

### Open area 1 — Partial-coverage / "not analyzed yet" state *(proposed by CC)*
- **What it is & why it's worth a look:** coverage is uneven — **popularity_proxy** is now populated corpus-wide (0–100), but **audio features** are only partially backfilled (require a per-song librosa "analyze" job) and **lyrics presence** and **tags** may be missing for a given song. So many rows will have *some* metadata and *some* holes. How the design represents "we don't have this yet" (dim placeholder · omit the chip · a subtle "analyze" affordance) materially shapes both the inline and expanded views. This is the highest-value open area for a conservative first pass.
- **How it relates:** every chip/field needs an empty treatment; a naive design will look broken on partially-covered songs.

### Open area 2 — Portability to the universal SongCard (phase-2 seam) *(proposed by CC)*
- **What it is & why it's worth a look:** phase 2 will add this metadata display as an option on `SongCard` (`ui/src/lib/song/SongCard.svelte`), which **already has a `statRow`** rendering popularity/bpm/key/scale/energy/hasLyrics. So the Theme-Research treatment should be designed so its visual language can later drop into SongCard's `meta` layer rather than diverging from it. CD should keep the metadata "module" visually self-contained/portable.
- **How it relates:** avoids designing a Theme-Research-only look that we then have to redo for the universal card.

---

## 8. Existing patterns to honor / reuse

- **Reuse as-is:** `StatusChip.svelte` (tone pills), `SectionLabel.svelte` + the `font-mono text-[10px] tracking-widest uppercase text-fg-faint` eyebrow, the axis colors (sky/ember/moss/amber), `bg-bg-elevated border border-border-muted rounded-xl` card idiom, the empty/loading `font-mono … italic` style.
- **Reference (don't necessarily reuse, but match):** the universal SongCard `statRow` (`ui/src/lib/song/SongCard.svelte` ~L166–196) which already renders `popularity.proxy`, `audio.bpm/key/scale`, `energy` (as a progress bar), and `hasLyrics` ("on file" / "—") — this is the closest existing metadata layout and phase-2 target; the digest `StatStrip.svelte` KPI-tile idiom for compact numeric display.
- **May extend with care:** `ThemeResearchTab.svelte` pick-row markup (keep the `data-*` attributes intact).
- **Do NOT touch:** the universal `SongCard` internals (phase 2), the History coloring system (`ui/src/lib/history/history-coloring.css`), the digest, the theme→picks collapse behavior, any metadata *collection*/queue code.

---

## 9. Decision points to game out ⭐

---

### D1. Which metadata go **inline** vs only in the **expanded** detail · **[Required — from team]**
- **The decision:** for a conservative first pass, which 2–4 metadata earn a chip on the row, and which live only in the expand.
- **Why it matters:** inline density vs legibility; the row already carries rank/title/artist/submitter/points. Too many chips and it's noise; too few and skimming loses value.
- **Options on the table:** candidates = obscurity/popularity, BPM, key/scale, energy, lyrics (yes/no), top genre tag. Likely inline set: obscurity + energy + lyrics + (one tag); everything in the expand.
- **Constraints:** must not break the pick-row grid; only `popularity_proxy` is reliably populated — audio/lyrics/tags are partial (see D3). Use axis colors + `StatusChip` idiom.
- **What CD should canvas:** 2–3 inline-chip sets (minimal / balanced / rich) shown **in-context on real pick rows**, at desktop and narrow widths.
- **How we'll decide:** pick the densest set that still skims cleanly on a partially-covered row.

---

### D2. Expand mechanism for a single pick · **[Required — from team]**
- **The decision:** how the per-song detail opens, given a theme row is *already* an expandable container.
- **Why it matters:** avoids awkward expand-within-expand; must feel native.
- **Options:** (a) in-place sub-expand of the pick row (matches ThemeResearchTab/PlayerResearchTab collapsibles); (b) desktop side/inline drawer; (c) the existing mobile **bottom-sheet** + desktop expanded-sheet pattern from `SongCard`/`SongSheet` (bonus: aligns with phase-2 portability).
- **Constraints:** reuse an existing expand idiom, not a third; keep the parent theme expand working; Svelte 5 runes.
- **What CD should canvas:** the full-detail layout in each mechanism, in-context inside an expanded theme, desktop + mobile.
- **How we'll decide:** least-nested, most-native, and closest to the phase-2 SongCard detail.

---

### D3. How to show **missing / not-yet-analyzed** metadata · **[Proposed by CC]**
- **The decision:** the empty treatment per metadatum when a song lacks audio/lyrics/tags.
- **Why it matters:** most rows will be partially covered; this is what makes the surface look finished vs broken.
- **Options:** omit the chip entirely · show a dimmed placeholder ("—" / "not analyzed") · show a subtle "analyze" affordance (audio analysis is a real queued action in-app).
- **Constraints:** conservative first pass — probably no new "analyze" trigger here unless trivial; must read consistently inline and in the expand.
- **What CD should canvas:** a fully-covered row vs a sparsely-covered row, side by side, in both inline and expanded forms.
- **How we'll decide:** whichever keeps a half-empty row calm and honest.

---

### D4. Encoding of obscurity/popularity & energy (number vs bucket vs gauge) · **[Proposed by CC]**
- **The decision:** how the continuous 0–100 values read at a glance.
- **Why it matters:** these are the headline signals; the app already has a bucket vocabulary (Radio Hit / Recognizable / Curious Cut / Rabbit Hole from `discoverability.ts`) and axis colors.
- **Options:** raw number · bucket label + color (reuse the Tastemaker buckets) · a tiny colored dot/gauge (sky for obscurity, amber for energy) · SongCard-style mini progress bar.
- **Constraints:** must be legible at chip size; reuse existing bucket names/colors for consistency with the digest.
- **What CD should canvas:** the same row rendered with 2–3 encodings.
- **How we'll decide:** most readable at a glance that stays consistent with the Tastemaker/digest language.

---

### D5. *(open stub for CD)*
### D6. *(open stub for CD)*

---

## 10. Constraints

- **Technical / data:**
  - **Metadata is keyed by `spotify_uri`** (`song_popularity`, `song_audio_features`, `song_lyrics_metrics`). **But `GET /api/history/themes` picks currently return only `{ title, artist, submitter, points }` — no `spotify_uri`.** So a build prerequisite is threading `spotify_uri` onto theme picks and joining the metadata (either enrich the themes API, or a batch "metadata-by-URI" endpoint). CD should design assuming the metadata will be available per pick; CC will handle the plumbing. `(constraint — noted for build)`
  - Fields available: `song_popularity` (popularity_proxy 0–100, spotify_popularity, tags JSON, listeners/playcount, popularity_source); `song_audio_features` (bpm, key, scale major/minor, energy 0–1, duration_s); `song_lyrics_metrics` (has_lyrics, word_count, line_count — only `has_lyrics` currently surfaced).
  - Svelte 5 runes; Tailwind v4; must pass `npm run check`.
- **Brand & consistency:** must read as the same Mash Co app — dark, dense, mono-caps eyebrows, axis colors, `rounded-xl` cards.
- **Accessibility bar:** legible at the app's small mono sizes; color is reinforced with text/label (don't rely on hue alone for obscurity/energy); expand controls keyboard-reachable (the app uses ARIA tab/panel patterns already).
- **Risks / past problems:** partial metadata coverage (the main design risk); over-crowding an already-dense row.

---

## 11. Success criteria

- **Good design =** the user can skim a theme's picks and read headline metadata without expanding, and get the full picture on one click, and it looks like it was always part of Theme Research.
- **Metrics:** N/A (solo tool) — judged qualitatively by fit + usefulness in research.
- **"Fits the product" concretely:** uses Mashco tokens/components verbatim, matches the existing collapsible-row + eyebrow + StatusChip idioms, and the metadata module is visually portable to the phase-2 SongCard.

---

## 12. Deliverables & logistics

- **Fidelity:** high-fidelity, in-context (feature shown inside the real Theme Research tab).
- **Variations wanted:** the inline-chip set (D1), the expand mechanism (D2), the missing-state treatment (D3), and the value encoding (D4) — plus a fully-covered vs sparsely-covered row.
- **Format:** Handoff packet per `Handoff-Packet-Manifest.md` (zip) + a kickoff prompt for CC. Keep the metadata module documented as a portable unit for phase-2 SongCard reuse.
- **Review cadence:** one option-canvas pass, settle decisions, then full design; one joint review of the packet before build.

---

## 13. Open questions & unknowns

- Which exact inline chip set (D1) — needs the team's call on the canvas.
- Expand mechanism (D2) — in-place vs bottom-sheet.
- Missing-metadata treatment (D3).
- `(unknown — needs decision)` Should the expand offer an inline "analyze audio" action for songs lacking audio features (ties into the parked audio-from-playlist work), or stay read-only this pass? Leaning read-only for the conservative pass.
- `(assumption)` Theme picks can be reliably mapped to a `spotify_uri` (they come from real submissions, which have URIs) — CC to confirm during plumbing.

---

## Appendix — file map & references

- **Design tokens:** `ui/src/app.css`, `ui/src/lib/shortlist/colors_and_type.css`; handoff copy `data/Mash Co. Design System-handoff/mash-co-design-system`.
- **Target surface:** `ui/src/lib/components/ThemeResearchTab.svelte`; host route `ui/src/routes/history/+page.svelte`; data `GET /api/history/themes`.
- **Metadata model:** `ui/src/lib/db/schema.ts` (`song_popularity`, `song_audio_features`, `song_lyrics_metrics`); read paths `ui/src/lib/dashboard/tasteData.ts`, `ui/src/lib/db/discoverability.ts`.
- **Reuse/reference components:** `ui/src/lib/components/StatusChip.svelte`, `SectionLabel.svelte`; `ui/src/lib/song/SongCard.svelte` (`statRow` ~L166–196, phase-2 target) + `SongSheet.svelte`; `ui/src/lib/digest/StatStrip.svelte`.
- **Bucket vocabulary:** `ui/src/lib/db/discoverability.ts` (Radio Hit / Recognizable / Curious Cut / Rabbit Hole).
- **Sample data for mockups:** `docs/design-briefs/2026-07-02-song-metadata-sample-data.json` — **real** league data (6 themes across Second Best + Hip Jammers, 67 picks) with every metadata field per pick + coverage flags, plus a `partial_coverage_examples` block of real audio-missing songs and a `coverage_note` describing real-world coverage. **Use this for the option-canvas mockups so they read as the real product**, and use the sparse rows for the D3 "not analyzed yet" state.
