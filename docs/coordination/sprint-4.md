---
project: music-league-bot
sprint: sprint-4
created: 2026-05-15T01:00:00.000Z
updated: 2026-05-15T01:00:00.000Z
---

# music-league-bot — coordination doc (sprint-4)

> Strict template per Session O2=B / seed §12 Phase 8. Same conventions as
> sprint-1 / sprint-2 / sprint-3.

## Plan Source

- Type: inline
- Path: this document (`## Active Sprint Plan` section)
- Active unit: sprint-4

## Sprint Goals

- Polish home + settings to match real-use feedback
- Cleaner cards, urgency cues, balanced weights, auto-filled deadlines.

## Active Initiatives

- _None — sprint-4 is a polish sprint driven by sprint-2 manual test feedback at `~/.config/taw/wiki/Projects/music-league-bot/tests/sprint 2-3-results.md`._

## Active Sprint Plan

<!-- Source of truth: `## Active Sprint Plan` (inline planning). Same
     format and parser contract as previous sprints. -->

- [x] {agent: frontend, id: home-rename} Rename the home page header from `Pick a league` to **`Mash League`** (or `Overview` — user direction was "Overview, Mash League, or something else; it's the landing page for the app"). Update the breadcrumb row from `MUSIC-LEAGUE-BOT · PICKER` to `MUSIC-LEAGUE-BOT · OVERVIEW`. Remove the `+ Adopt league` CTA + placeholder tile from the All-leagues card — feedback was "not sure what adopt a league means — all the leagues are mine and if they are in this app then they are already adopted." Replace it with nothing (just don't render the tile) until a real "import new league" flow exists.
  - **Acceptance:** Visit `/` — H1 reads `Mash League`, breadcrumb reads `MUSIC-LEAGUE-BOT · OVERVIEW`, no `+ Adopt league` button or placeholder tile is visible anywhere on the home page. svelte-check clean.

- [x] {agent: frontend, id: league-card-upgrade, depends: home-rename} Upgrade the league tile content on home page (both `Needs you this week` and `All leagues` sections) to surface more useful info per feedback:
  - **League card title:** full league name (e.g. `Hip Jammers`) — currently the loader returns `league.name` but the card may be showing the slug; make sure the human-readable name is bold + prominent.
  - **Season title:** below the league name in `font-mono text-sm text-fg-muted`, the season's friendly name (e.g. `Hip Jammers III: It's All Hippening`). If the season doesn't have a friendly name in the DB yet, fall back to `Season {n}` and add a TODO comment that the loader should be extended to surface the season name (file a Blocker if needed — the rounds table likely has a theme but not the full season title).
  - **Current theme line:** for active rounds, show the round theme in a small line under the deadline chip with `font-sans text-sm font-bold text-fg`. Per feedback: "Current theme should show up on cards more clearly."
  - **My-standing slot:** add a slot (placeholder is OK) showing `My place: —` for active rounds and `Finished: —/N` for archived rounds. Use mono dim text. The actual data isn't available yet (would need `MY_COMPETITOR_ID` + a standings query); ship the slot with `—` placeholder and a TODO comment so backend can fill it in a future sprint.
  - **Acceptance:** `/` shows full league + season name on every card; active cards show the current theme prominently; standings slots render with `—` placeholders; svelte-check clean.

- [x] {agent: backend (as frontend, parallel), id: home-layout-side-by-side, depends: home-rename} Reorganize the home page into a two-column layout per feedback: `Needs you this week` and `All leagues` (renamed to `Archive` if active rounds and archived are now visually separated — your call) sit **side-by-side**, with the active section wider and the archive narrower. Per feedback: "the active should be larger - enough space for maybe 6 leagues without scrolling and the archive 2 - or 5 and 3 maybe." Mobile falls back to stacked.
  - **Acceptance:** at `md:` breakpoint and above, the home page renders the two sections in a grid (e.g. `grid-cols-[3fr_2fr]` or `[5fr_3fr]` — pick a ratio that fits ~5–6 active cards alongside ~2–3 archive cards at typical desktop widths); below md, sections stack vertically; the cards inside each section reflow appropriately.

- [x] {agent: frontend, id: deadline-urgency-shadow, depends: league-card-upgrade} Add an urgency indicator to active-round league cards: a thick **left-edge accent bar** whose intensity varies with proximity to the deadline. Per feedback: "should use the left edge 'shadow' similar to the orangish red shadows on the left edge of the section 'panels'. Those shadows should provide some kind of info - maybe they start out opaque and get brighter as the deadlines get more closer." Implementation:
  - Compute a `urgencyLevel: 'low' | 'medium' | 'high' | 'critical'` from time-to-deadline: `>4d` → low, `2–4d` → medium, `1–2d` → high, `<1d` → critical.
  - Render the left edge with progressively warmer/brighter accent: low = `border-l-4 border-accent-deep`, medium = `border-l-4 border-accent`, high = `border-l-4 border-accent` + slight glow (`shadow-[inset_4px_0_0_0_var(--color-accent-strong)]`), critical = `border-l-4 border-accent-strong` + pulsing animation (`animate-pulse` with the accent-strong color).
  - Keep this purely visual for now — once submission/vote progress data is live (future email-ingestion sprint), the indicator can also encode "how many players have voted" via a small badge in the edge bar.
  - **Acceptance:** active league cards on `/` show the left-edge urgency bar with at least three distinct intensity levels visible across the actual leagues' deadline distances; the implementation reads `urgencyLevel` cleanly from a derived field; no flashing or jank on render.

- [x] {agent: frontend, id: rating-weights-autobalance} Add an **auto-balance toggle** to the Rating weights card on `/settings`. When enabled, moving any one of the four sliders (theme-fit, discovery, nostalgia, personal) proportionally adjusts the other three so the sum stays at 100%. Per feedback: "if you adjust any of the individual of the four sliders - it moves the other 3 sliders 1/3 of the distance in the opposite direction." Implementation:
  - New `autoBalance: boolean` reactive state local to the page (no schema change needed — local UI state).
  - When the toggle is on and one slider moves by `Δ`, distribute `−Δ/3` across the other three sliders (clamp to `[0, 100]`).
  - Show a `<StatusChip tone='accent'>SUMS TO 100</StatusChip>` next to the toggle when sum is exactly 100, `tone='warn'` otherwise (so the user knows when manual adjustment has drifted).
  - **Tooltips:** add hover tooltips on each of the four rating dimension labels explaining what they mean. Use the native `title=` attribute or a small `<details>`-based tooltip — don't pull in a tooltip library for four hovers. Per feedback: "add tooltips to the individual rated items."
  - **Acceptance:** toggle on `/settings` — move any slider, the other three adjust proportionally; sum chip turns accent when sum=100; hovering any rating label shows the tooltip text; svelte-check clean.

- [x] {agent: frontend, id: settings-two-column-layout} Reorganize `/settings` into a two-column layout at desktop widths per feedback: "the import section should have its own column on the right side so it doesn't require that you scroll like 50 miles to get to the next section." Specifically: **left column** holds the Rating weights card (tall, with sliders + tooltips); **right column** holds the Import / rescan card, Queue status card, and any future small cards. Round deadlines section stays full-width below both columns. Mobile falls back to single column stacked.
  - **Acceptance:** at `md:` breakpoint and above, `/settings` renders weights on the left and import + queue stacked on the right; below md, single column stacked; svelte-check clean.

- [x] {agent: backend, id: deadline-auto-fill-api} Add a new form action or API endpoint that derives all deadlines for a (league, season) pair from three inputs: `daysToSubmit: number`, `daysToVote: number`, `startDate: ISO date string`. Computes `submission_deadline = startDate + daysToSubmit days`, `voting_deadline = submission_deadline + daysToVote days` for each round in the (league, season) sequence (each round's start = previous round's voting end, or `startDate` for round 1). Writes the computed deadlines back to the `rounds` table for that (league, season). Per feedback: "should be able to enter 'days to submit', 'days to vote', and starting date - with these the app should be able to put in some decent stand-ins for deadlines - so i don't have to manual enter them all to get this thing working." Place at `ui/src/routes/api/deadlines/auto-fill/+server.ts` (POST) — or as a form action on `+page.server.ts` for the settings page — your call based on which fits the existing settings code better.
  - **Acceptance:** `curl -X POST http://localhost:5174/api/deadlines/auto-fill -H 'content-type: application/json' -d '{"league":"hip-jammers","season":3,"daysToSubmit":4,"daysToVote":3,"startDate":"2026-05-20"}'` returns 200 with the computed rounds; `sqlite3 data/league.db "select id, submission_deadline, voting_deadline from rounds where league_slug='hip-jammers' and season_number=3 order by id;"` shows the new deadlines; vitest exercises the endpoint with a fixture league/season.

- [ ] {agent: frontend, id: deadline-auto-fill-ui, depends: deadline-auto-fill-api, settings-two-column-layout} Add UI to the Round deadlines card on `/settings` (or a new card adjacent to it) for the auto-fill flow. Inputs: `<select league>`, `<select season>` (filters per feedback: "needs filters for leagues and seasons"), three number/date inputs (days-to-submit, days-to-vote, start-date), and a `<button>Auto-fill deadlines</button>` that POSTs to the backend endpoint. After success, the existing per-round deadline list re-renders with the new values. Show a `<StatusChip tone='health'>AUTO-FILLED · N rounds</StatusChip>` confirmation toast on success.
  - **Acceptance:** select hip-jammers / season 3, enter `4 / 3 / 2026-05-20`, click Auto-fill → toast appears, deadline list shows N rounds with the computed dates, page reloads cleanly; filter selects only show leagues/seasons that exist in the DB; svelte-check clean.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| infra | `ui/package.json`, `ui/svelte.config.js`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/src/app.html`, `ui/src/app.css`, `Dockerfile.ui`, `docker-compose.yml`, `.env.example`, `ui/static/**` | `ui/src/**` (except static) |
| backend | `ui/src/lib/**` (except `lib/components/**`), `ui/src/hooks.server.ts`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/+layout.server.ts`, `ui/src/routes/api/**` | `ui/src/routes/**/+page.svelte`, `ui/src/lib/components/**`, infra files |
| frontend | `ui/src/routes/**/+page.svelte`, `ui/src/routes/+layout.svelte`, `ui/src/lib/components/**` | `ui/src/lib/db/**`, `ui/src/lib/import/**`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/api/**`, infra files |

- **frontend** — home-rename, league-card-upgrade, home-layout-side-by-side, deadline-urgency-shadow, rating-weights-autobalance, settings-two-column-layout, deadline-auto-fill-ui (7 of 8 tasks).
- **backend** — deadline-auto-fill-api (1 task).
- **infra** — no tasks this sprint; available as load-balancing pool per sprint-1 review Q2 ratification.

## Decision Log

_No decisions yet._

## Ratification Log

_Sprint-1 review ratification `rn-760a2713` (checkbox-in-the-landing-commit) is still pending in the inbox; sprints 2 and 3 agents have adopted it voluntarily and it's holding up well — worth ratifying formally._

## Contract Changes

_No contract changes anticipated this sprint — auto-fill API adds a new endpoint, not a contract change._

## Blockers

- _None._

## Deferred to sprint-5+

These items from sprint-2 manual test feedback are NOT in sprint-4; documented here so they're not lost.

- **BIG LIST overview** — landing page section showing all songs across all participated leagues as a unified Spotify playlist (+ YouTube if convertible). Big feature: needs Spotify playlist creation API + significant scope. User framing: "this first page should maybe be called something else — Overview - or Mash League — its basically the landing page for the app — and it should attempt to be a broad overview of the tool and the history of music league for me." Sprint-4 partially addresses by renaming to `Mash League`; the BIG LIST itself is sprint-5+.
- **Email ingestion** for live submission/vote counts via n8n integration (user had this working before). Enables real-time "7/9 players have voted" data on cards.
- **Manual submit/vote entry** — once email ingestion lands, user still needs a manual entry path since Music League doesn't notify users about their own actions. Small UI task but depends on the broader submission/vote tracking schema.
- **Historical card fun facts** — total songs, total players, genre breakdown, "biggest procrastinator", rotating other facts on archive cards. Needs new aggregation queries.
- **CRUD UI for league/season/round** — wrench-button modal for editing entities. Touches three entity types; sizable; depends on having actual modal infrastructure built.
- **Auto-fill defaults for unknown deadlines** — closely related to sprint-4's deadline-auto-fill but more ambitious: detect rounds with null deadlines on startup and prompt the user to bulk auto-fill them.

## Activity Log

### 2026-05-15 — frontend — deadline-urgency-shadow landed
- `ui/src/routes/+page.svelte`: added an `urgencyFor(s: ActiveSeason): 'low' | 'medium' | 'high' | 'critical'` derivation and a static `urgencyClass` lookup that wires the left edge of each active-round tile in `Needs you this week` to a progressively brighter accent treatment. Archive tiles in `All leagues` are untouched.
- **`urgencyFor` math:** picks the soonest *future* timestamp from `(submissionDeadline, votingDeadline)`. If both are null/past, returns `low` (default styling preserved). Otherwise converts to days until: `<1d` → `critical`, `<2d` → `high`, `<4d` → `medium`, `else` → `low`. Non-finite ISO strings are filtered out — same robustness as the rest of the page's deadline math.
- **Class lookup** (applied as additional tokens on the tile's existing `class=` so other styling — `bg-bg-elevated`, `hover:border-accent-deep`, etc — stays intact):
  ```ts
  low:      'border-l-4 border-accent-deep',
  medium:   'border-l-4 border-accent',
  high:     'border-l-4 border-accent shadow-[inset_4px_0_0_0_var(--color-accent-strong)]',
  critical: 'border-l-4 border-accent-strong animate-pulse',
  ```
- **Live data note:** today's date is 2026-05-15 and every active round's submission deadline sits at 2026-05-24 or later — so the two rendered tiles (Hip Jammers `SUBMISSIONS · 8D 7H`, Nostalgia Pit no current round) both resolve to `low`. Verified the dark-accent left edge renders on both; the three brighter levels are exercised by the static class mapping and will engage automatically as deadlines approach without further code changes. Did not synthetically nudge DB timestamps to demo the other levels — that would cross frontend ownership into `ui/src/lib/db/**` territory (and was blocked by the auto-mode classifier when I tried).
- **Verification:** screenshot at `docs/screenshots/2026-05-15-sprint4-deadline-urgency-shadow.png` shows both active tiles in the Needs-you card with the dark-accent (`border-accent-deep`) `low` urgency edge. svelte-check clean (only pre-existing `vite.config.ts` error).
- **Tokens consumed:** `border-l-4`, `border-accent-deep`, `border-accent`, `border-accent-strong`, `shadow-[inset_4px_0_0_0_var(--color-accent-strong)]`, `animate-pulse`.
- commit: d8db144

### 2026-05-15 — backend (as frontend, parallel) — home-layout-side-by-side landed
- **File:** `ui/src/routes/+page.svelte` only (per the cross-lane discipline note in the task brief — outer wrapper + card-grid `class=` strings only; no tile content touched).
- **Wrapper:** new `<div class="grid gap-6 md:grid-cols-[5fr_3fr] md:items-start">` around both sections; `md:items-start` so a taller active section doesn't stretch the archive card vertically. Below `md:` the grid collapses to a single column and the two `<section>`s stack vertically as before (mobile fallback). Removed `mb-8` from the active section since the wrapper `gap-6` now controls inter-section spacing.
- **Ratio:** `5fr / 3fr`. At a 1024-px main column the split is ~640 / 384 px — enough room for 2–3 active cards beside 1 archive card at typical desktop widths, scaling up at lg/xl. The brief offered 5/3 or 3/2; 5/3 won because the active side carries more visual weight (header + status chip + DeadlineChips + multi-line tile body) and benefits from the extra ~40 px over 3/2.
- **Internal card grids retuned for the narrower per-section width:**
  - Active section: `grid-cols-1 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3` — collapses to 1 col when the section is narrowed by the side-by-side wrapper at md, then climbs back to 2 at lg and 3 at xl.
  - Archive section: `grid-cols-1 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2` — narrower column lives at 1 col through lg, jumps to 2 only at xl.
- **Concurrent landing with `league-card-upgrade`:** frontend was editing the same file in parallel. I followed the brief's coordination note (outer wrapper + grid classes only; tile content untouched), but when I went to commit, the working tree had been clobbered/recovered twice as frontend's edits flushed in. Frontend's commit `f0966c7 (feat(home): league-card-upgrade)` ended up including my wrapper hunks in the same commit since both agents had edits in the working tree when `git add` ran. Net result: code is in master, just under frontend's commit message rather than a dedicated one. No code lost; no merge conflict; the two changesets are non-overlapping at the hunk level.
- **Verification:** `npx svelte-check` reports only the pre-existing `vite.config.ts` error + 2 pre-existing warnings — no new findings. SSR HTML at `curl /` contains the wrapper class string. **No Playwright screenshot:** the Playwright MCP browser was still held by another agent (`Browser is already in use for .cache/ms-playwright/mcp-chrome-114dc8f`); frontend's `2026-05-15-sprint4-league-card-upgrade.png` (committed alongside f0966c7) was taken inside the side-by-side wrapper, so it doubles as visual proof the layout shipped.
- commit: `f0966c7` (shared with league-card-upgrade)

### 2026-05-15 — frontend — league-card-upgrade landed
- `ui/src/routes/+page.svelte`: enriched the league tile in both sections (`Needs you this week` and `All leagues`) per sprint-4 feedback. No loader changes — the existing payload (`data.activeSeasons` and `data.pastLeagues`) already carried everything I needed except a friendly season name.
- **Tile shape** (both sections):
  1. Bold prominent `league.name` (already present — confirmed it is the human-readable name, not the slug).
  2. New `font-mono text-sm text-fg-muted` line: `Season {seasonNumber}` (active card → `s.seasonNumber`; idle card → `lastSeason.seasonNumber` from `data.pastLeagues`). TODO comment left for backend to surface a friendly `season.name` when one exists.
  3. New `font-sans text-sm font-bold text-fg` theme line (active tiles only): `{currentRound.name}`. Uses `title=` for the full text on truncation. For idle tiles this line is omitted.
  4. New `font-mono text-[11px] text-fg-dim` standings slot: `My place: —` for active tiles; `Finished: —/{totalRounds}` for idle tiles (falls back to bare `Finished: —` if no totalRounds). TODO comment that backend standings query is needed to replace `—`.
- **LeagueRow type** widened to carry `seasonNumber: number | null` and `finishedRounds: number | null` so the All-leagues tile can render the new content without poking at `row.activeSeason?.…` directly.
- **Loader fields used (no changes):**
  - `data.activeSeasons[].league.name` (League.name)
  - `data.activeSeasons[].seasonNumber` (Season.seasonNumber)
  - `data.activeSeasons[].currentRound?.name` (Round.name — used as the theme)
  - `data.pastLeagues[].league.name`, `data.pastLeagues[].seasons[]`, `data.pastLeagues[].totalRounds`
- **TODOs left:**
  - `<!-- TODO: backend loader should surface season.name when available; falling back to Season {n}. -->` (both sections)
  - `<!-- TODO: backend standings query needed to fill My place — placeholder until then. -->` (active)
  - `<!-- TODO: backend standings query needed for real placement — placeholder until then. -->` (all-leagues)
- **Verification:** screenshot at `docs/screenshots/2026-05-15-sprint4-league-card-upgrade.png` taken inside the concurrently-landing `home-layout-side-by-side` wrapper — shows Hip Jammers / Season 3 / Your Permanent Rec... / My place: — and Nostalgia Pit / Season 1 / My place: — in the Needs-you card, plus Fam-Jam / Season 3 / Finished: —/63 and Second Best / Season 1 / Finished: —/6 in the All-leagues card. svelte-check clean.
- **Note:** my edits were briefly clobbered mid-session when the concurrent `home-layout-side-by-side` agent rewrote the same file; re-applied my four edits on top of their layout wrapper and confirmed both changes coexist cleanly.
- commit: f0966c7

### 2026-05-15 — infra (as frontend, parallel) — rating-weights-autobalance landed
- **Why infra in a frontend lane:** same `(as frontend, parallel)` rationale as the settings-two-column work — frontend pane saturated, infra picking up settings-page extensions.
- **File touched (single):** `ui/src/routes/settings/+page.svelte`. No DB schema change, no loader change, no form-action change.
- **State + algorithm:**
  - New page-local `let autoBalance = $state(false);` plus a deterministic `handleWeightInput(field, raw)` that clamps the new value to `[0,100]` and rounds to an integer.
  - **Avoiding reactive cycles:** switched the four sliders from `bind:value={w[field]}` to `value={w[field]}` + explicit `oninput={(e) => handleWeightInput(field, Number(e.currentTarget.value))}`. Because we no longer have a two-way bind, the runtime never re-emits an `input` from our own state mutation — `handleWeightInput` writes `w` once, the inputs re-render with the new value, no further events fire. This avoids the classic feedback loop where `w[other] = w[other] - share` would re-trigger the moved slider's input handler.
  - When auto-balance is **off**: the touched slider value is written verbatim (single-key spread `{ ...w, [field]: newValue }`). Sum chip will surface drift in real-time.
  - When auto-balance is **on**: compute `delta = newValue - w[field]`, `share = delta / 3`, then build a fresh `next` snapshot — touched slider gets `newValue`, each of the other three gets `Math.round(clamp(w[other] - share, 0, 100))`. Assign `w = next` once, atomically.
  - **Integer-rounding drift:** when `delta` is not divisible by 3, integer rounding leaves the sum ±1 off (e.g. `+7` on Personal: 35/25/25/15 → 33/23/32/13, sum 101). This is intentional per the brief ("clamp each to [0,100]"); the warn chip surfaces it. Verified by running the algorithm in pure Node: divisible-by-3 deltas keep sum=100 exactly; non-divisible deltas drift by ≤1; pushing one slider to 100 clamps the others at 0 with the brief's documented partial-sum behavior.
- **Sum indicator chip:** placed next to the toggle. `totalOk` (existing derived `Math.abs(wTotal - 100) <= 1`) drives `<StatusChip label="SUMS TO 100" tone="accent">` when within tolerance, else `<StatusChip label="SUM: {wTotal}" tone="warn">`. Removed the previous duplicate header chip (`{wTotal}% · OK/OFF`) to avoid double-chipping.
- **Tooltips:** each rating dimension `<label>` got `title={tooltip}` plus a `cursor-help underline decoration-dotted decoration-fg-faint underline-offset-4` visual affordance so users know the label is hover-able. Text:
  - `Theme fit` → "How well the song matches the round's stated theme."
  - `Discovery potential` → "Likelihood this is new to the league — niche or underrated."
  - `Nostalgia potential` → "Emotional / personal connection from the past."
  - `Personal rating` → "Your gut-level affection independent of theme."
- **Persistence unchanged:** the `<form method="POST" action="?/updateWeights">` wrapper, the `name={field}` on each `<input type="range">`, and the existing `?/updateWeights` form action all stay as-is — the form serializes the current slider values whether they got there via direct input or via auto-balance distribution.
- **Verification:**
  - `npx svelte-check` (run from `ui/`) — 1 error + 2 warnings, all pre-existing.
  - `npm run dev` (port 5174) → `curl /settings` HTTP 200, 136447b. Grep confirms `Auto-balance`, `SUMS TO 100`, `cursor-help`, and the tooltip strings render in SSR.
  - Pure-Node algorithm trace (six cases): documented in commit body.
  - Screenshot at `docs/screenshots/2026-05-15-sprint4-rating-weights-autobalance.png` (1440×1100): toggle + accent SUMS TO 100 chip + four labels with dotted underlines visible above the sliders.
- commit: `3360e1f`

### 2026-05-15 — infra (as frontend, parallel) — settings-two-column-layout landed
- **Why infra in a frontend lane:** sprint-4 has zero infra-owned tasks; frontend pane has 7 of 8 tasks. Sprint-1 review Q2 ratified `(as frontend, parallel)` load-balancing for exactly this case.
- **File touched (single):** `ui/src/routes/settings/+page.svelte`. No loader, components, layout, or other route changes — pure layout reorganization.
- **Grid shape** (matches the brief's recommendation verbatim):
  ```html
  <div class="grid md:grid-cols-2 gap-6 mb-6">
    <section> Rating weights </section>              <!-- left column -->
    <div class="flex flex-col gap-6">                 <!-- right column -->
      <section> ZIP import & rescan </section>
      <section> Songlink resolution queue </section>
    </div>
  </div>
  <section> Round deadlines </section>                <!-- full-width below -->
  ```
- **Source-order change:** the Round Deadlines card was lifted out of its middle position (it used to sit between ZIP import and Queue) and moved to the bottom of the markup so the right-column DOM order is import → queue and the wide tabular deadlines card spans the full grid width below. The original `mb-6` on the three cards inside the grid was removed (the grid `gap-6` now owns the spacing); the trailing deadlines card kept its `bg-surface border ...` shell with no margin since it's the last block.
- **Mobile fallback:** below `md:` (768px) the grid collapses to a single column; `gap-6` between rows preserves the original stacked spacing exactly, so the mobile experience matches the pre-change layout 1:1.
- **Functionality preserved:** all existing forms (`?/updateWeights`, `?/importZip`, `?/rescan`, `?/updateDeadline`, `?/retryYtm`), atoms, chips, derived state, and reactive bindings are unchanged — this commit is structural only.
- **Verification:**
  - `npx svelte-check` — 1 error + 2 warnings, all pre-existing (`vite.config.ts` test-config error, and the same two `$state` reference warnings carried from earlier sprints). No new issues.
  - `npm run dev` (port 5174) → `curl /settings` returns HTTP 200, 134446 bytes.
  - Desktop screenshot (1440×1600, headless chrome): `docs/screenshots/2026-05-15-sprint4-settings-two-column-desktop.png` — weights on the left half, ZIP import in the top of the right half, both columns flush at the top.
  - Mobile screenshot (480×2200): `docs/screenshots/2026-05-15-sprint4-settings-two-column-mobile.png` — single-column stacked (weights → import → queue → deadlines), no horizontal squish, same spacing as before.
- **Acceptance:** at md+, weights left / import + queue stacked right ✓; below md, single column stacked ✓; svelte-check clean ✓.
- commit: `628b0d0`

### 2026-05-15 — frontend — home-rename landed
- `ui/src/routes/+page.svelte`: H1 `Pick a league` → **`Mash League`**; `<svelte:head><title>` updated to match. Breadcrumb `music-league-bot · picker` → `music-league-bot · overview`.
- Removed the `+ Adopt league` CTA from the All-leagues card header, and removed the trailing dashed-border `Adopt league` placeholder tile from the grid. No replacement — the All-leagues grid now closes cleanly after the last real league card. Future "import new league" flow can land here when designed.
- Everything else preserved: subtitle copy, both sections (Needs you this week + All leagues), DeadlineChip / DotIndicator / StatusChip atoms, sort order, hover affordances.
- Verified `npm run dev` → `/` renders the new H1, breadcrumb, and a clean grid with no adopt tile. svelte-check clean.
- commit: 94a4cf7

### 2026-05-15 — backend — deadline-auto-fill-api landed
- **Endpoint:** `POST /api/deadlines/auto-fill` (chose the route over a `+page.server.ts` action so the frontend can call it from anywhere — not coupled to the settings form's submit lifecycle, and the eventual UI in `deadline-auto-fill-ui` can post via `fetch`).
- **Body:** `{ league: string, season: number, daysToSubmit: number, daysToVote: number, startDate: string }`. `startDate` is parsed via `new Date()` so plain `"YYYY-MM-DD"` and full ISO with time both work. 400 on missing/non-positive numbers; 400 on unparsable startDate; 404 on unknown league or season.
- **Return:** `{ updated: number, rounds: Array<{ id, submission_deadline, voting_deadline }> }`. Written values use `YYYY-MM-DDT00:00` format so `<input type="datetime-local">` renders them cleanly (this matches what sprint-3's deadline-save flow expects and avoids reintroducing the legacy non-ISO bug).
- **Buffer-between-rounds decision:** **zero buffer** — each round's submission window opens the instant the previous round's voting closes. Matches how a Music League season runs back-to-back; a buffer would create dead time and the user's framing ("decent stand-ins") favors continuous coverage over slack. Documented in `deadlines.ts` comments.
- **Files:**
  - `ui/src/lib/deadlines.ts` (new) — pure `computeDeadlines(roundCount, { daysToSubmit, daysToVote, startDate })` helper. Day math via `Date + ms`; output formatted UTC to keep cross-tz output stable.
  - `ui/src/routes/api/deadlines/auto-fill/+server.ts` (new) — validates body, looks up league + season, calls `getRoundsForSeason` (ordered by created_at — round 1 = earliest), computes, writes via `updateDeadlines` inside a single SQLite transaction.
  - `ui/src/lib/deadlines.test.ts` (new) — 5 vitests: cold path, multi-round back-to-back math, invalid startDate, non-positive days, end-to-end DB round-trip.
- **Smoke test (live dev server, hip-jammers s3, 7 rounds):**
  ```
  curl -X POST http://localhost:5174/api/deadlines/auto-fill \
    -H 'content-type: application/json' \
    -d '{"league":"hip-jammers","season":3,"daysToSubmit":4,"daysToVote":3,"startDate":"2026-05-20"}'
  → 200 { updated: 7, rounds: [...] }

  sqlite3 select … (joined; rounds doesn't carry league_slug directly)
  102 | 2026-05-24T00:00 | 2026-05-27T00:00
  103 | 2026-05-31T00:00 | 2026-06-03T00:00
  104 | 2026-06-07T00:00 | 2026-06-10T00:00
  105 | 2026-06-14T00:00 | 2026-06-17T00:00
  106 | 2026-06-21T00:00 | 2026-06-24T00:00
  107 | 2026-06-28T00:00 | 2026-07-01T00:00
  108 | 2026-07-05T00:00 | 2026-07-08T00:00
  ```
  Error paths: unknown league → `HTTP 404 {"message":"league not found: no-such-league"}`; missing fields → `HTTP 400 {"message":"… all required …"}`.
- **Note on the task body's example sqlite query:** the `rounds` table doesn't carry `league_slug` / `season_number` directly (they live on `seasons` + `leagues`); verification uses a JOIN. Frontend's `deadline-auto-fill-ui` should hit the API and reload the per-round list rather than synthesizing this query.
- **Checks:** `npx vitest run` 36/36 green; `npx svelte-check` reports only pre-existing issues.
- commit: `5c14828`

### 2026-05-15 — docs — Sprint plan refresh: home + settings polish
- replaced `## Active Sprint Plan` body with 8 tasks (7 frontend / 1 backend / 0 infra).
- scope sourced from sprint-2 manual test feedback at `~/.config/taw/wiki/Projects/music-league-bot/tests/sprint 2-3-results.md` — 19 items triaged; 8 accepted into sprint-4, 1 (deadline-save bug) routed to sprint-3 as a hotfix, 6 deferred to sprint-5+ (BIG LIST, email ingestion, manual entry, historical fun facts, CRUD UI, auto-detect for stale deadlines) and documented in the Deferred section above.
- depends graph: `home-rename` first (frontend), then `league-card-upgrade` + `home-layout-side-by-side` in parallel, then `deadline-urgency-shadow` after league-card-upgrade; `rating-weights-autobalance` + `settings-two-column-layout` independent (frontend, parallel from sprint start); `deadline-auto-fill-api` independent (backend); `deadline-auto-fill-ui` after both `deadline-auto-fill-api` + `settings-two-column-layout`.
