---
project: music-league-bot
sprint: sprint-17-digest-visuals
created: 2026-06-03T11:15:15Z
updated: 2026-06-03T11:56:50Z
status: active
---

# music-league-bot — coordination doc (sprint-17-digest-visuals)

> **Three new digest sections + the popularity data to power one of them.** Two
> sections deferred back in sprint-14 (D6) plus a new "who submits obscure music"
> visual the user asked for. (1) **By-the-numbers stat strip** — compact round-stat
> tiles. (2) **Next-round preview** — teases the upcoming round (theme, deadline,
> submissions-so-far). (3) **Submission discoverability** — a per-player
> "tastemaker leaderboard" for the season: who submits songs nobody's heard vs.
> who submits the same old crap everyone knows.
>
> **Discoverability metric (decided with user):** obscurity = inverse of a
> **Last.fm playcount** popularity score. `src/api/lastfm.ts` already has
> `getLastfmTrackInfo()` + `computePopularityProxies()` (log-normalized
> listeners+playcount → 0–100). Per song, `obscurity = 100 − proxy`; per player,
> average obscurity across their season submissions (higher = more obscure picks).
> **Constraint:** Spotify's API exposes `track.popularity` (0–100) and
> `artist.followers` but **NOT** monthly listeners or stream counts — so the real
> "how many people have heard this" signal is Last.fm, not Spotify streams.
>
> **Build context gotcha:** `src/` is OUTSIDE the ui Docker build context
> (`Dockerfile.ui: COPY ui/ ./`), so the ui cannot import `src/api/lastfm.ts` at
> render time (same constraint sprint-13 hit). Popularity must be **fetched and
> persisted to the DB** (by the main bot in `src/`, or a ui-local mirror) so the
> digest reads a stored score, never a live Last.fm call at render.
>
> Roster: **backend** (data + persistence), **viz** (visual components), **frontend**
> (wire sections into the digest page + export). Same lanes as sprint-14/15.
>
> **Section wiring pattern (from sprint-15, do not invent a new one):** register
> a section kind in `SECTION_KINDS` (`ui/src/lib/digest/llm.ts`) + a component in
> `VISUAL_COMPONENTS` (`ui/src/routes/digest/[roundId]/+page.svelte:432`), data-driven
> via the section's `visualData`. Must render in **web view AND PDF/PNG export**.

## Sprint Goals

- Add three digest sections — and reveal who picks the obscure stuff
  By-the-numbers strip, next-round preview, and a per-player obscurity leaderboard.

## Active Sprint Plan

- [x] {agent: backend, id: popularity-fetch} Add a per-song popularity-metadata fetch + persistence pass. For each submission's song in a season, fetch Last.fm listeners/playcount via the existing `getLastfmTrackInfo()` (`src/api/lastfm.ts:8`) and compute the 0–100 proxy via `computePopularityProxies()` (`:40`); persist per song (a `song_popularity` table or columns on the song/submission record: `listeners`, `playcount`, `popularity_proxy`, `fetched_at`) so the digest reads a stored score — no live Last.fm call at render (src/ is outside the ui build context). Cache: skip songs already fetched. Optionally capture Spotify `track.popularity` in the same pass as a supplementary column (cheap, already fetching the track). Provide a backfill for an existing season.
  - **Acceptance:** a DB table/columns hold `listeners`/`playcount`/`popularity_proxy` per song; a backfill run populates Hip Jammers Season 3's songs; a second run is a no-op for already-fetched songs (cache verified); `npm run check` passes; deployed via `docker compose build --no-cache bot-ui && up -d --force-recreate bot-ui`; the persisted shape recorded in the Activity Log for `discoverability-data`.

- [x] {agent: backend, id: discoverability-data, depends: popularity-fetch} Add a season-level discoverability query exposed on the digest data path. For the round's season, compute per player: `obscurityScore` = mean of `(100 − popularity_proxy)` across their season submissions, plus `submissionCount` and `avgPopularity`. Surface it the same way standings are surfaced (a `discoverability` section's `visualData`, fetched server-side — mirror the standings payload mechanism from sprint-15, not a bespoke client call). Self-suppress when no popularity data exists.
  - **Acceptance:** the digest data for a round carries a `discoverability` payload — an array of `{ name, obscurityScore (0–100), submissionCount, avgPopularity }` for the round's season, ranked most-obscure first; verified on prod for Hip Jammers S3 (e.g. r-104) with real numbers; `npm run check` passes; deployed; the shape recorded in the Activity Log for viz.

- [x] {agent: backend, id: stats-strip-data} Add the by-the-numbers stat-strip data to the digest payload for a round: total votes cast, number of submitters, biggest blowout margin (winner − runner-up points), closest race (smallest gap between adjacent ranks), and number of unique artists. Compute from the round's submissions/votes (reuse the standings/`pointsByCompetitor` source data; this is backend-lane DB work).
  - **Acceptance:** the digest data for a round carries `stats: { totalVotes, submitters, blowoutMargin, closestRace, uniqueArtists }`; verified on prod for a real round (e.g. r-104); `npm run check` passes; deployed; the shape recorded in the Activity Log for viz.

- [x] {agent: backend, id: next-round-data} Add next-round preview data. From the league's round list, find the round after the current one and expose its theme/name, voting (or submission) deadline, and submissions-so-far count. Return null when the current round is the latest (the section then self-suppresses).
  - **Acceptance:** the digest data carries `nextRound: { theme, deadline, submissionsSoFar } | null`; verified on prod for both a mid-season round (populated) and the latest round (null); `npm run check` passes; deployed; the shape recorded in the Activity Log for viz/frontend.

- [x] {agent: viz, id: discoverability-viz, depends: discoverability-data} Build the discoverability "tastemaker leaderboard" component against the `discoverability` payload: per-player horizontal bars ranked by `obscurityScore` (0–100), a clear axis label (e.g. "obscure picks ← → crowd-pleasers"), each row showing the player, their score, and `submissionCount`. Two variants via the variant system: web/interactive and PDF/static. Self-suppress when the payload is empty.
  - **Acceptance:** given a `discoverability` payload the component renders ranked obscurity bars (most-obscure on top) with per-player score + submission count; web and PDF/static variants both render with no horizontal overflow; `npm run check` passes.

- [x] {agent: viz, id: stats-strip-viz, depends: stats-strip-data} Build the by-the-numbers stat-strip component: a compact tile row rendering the `stats` payload (total votes, submitters, blowout margin, closest race, unique artists). Reflows to a single column at mobile/PDF width (respect the sprint-13 `dg-export--mobile` reflow conventions). Web + PDF/static variants.
  - **Acceptance:** the component renders the five stat tiles from the `stats` payload; reflows cleanly at mobile width and in the PDF export (no overflow); `npm run check` passes.

- [x] {agent: viz, id: next-round-viz, depends: next-round-data} Build the next-round preview section component against the `nextRound` payload: theme/name prominent, deadline/countdown, and a submissions-so-far indicator. Renders nothing when `nextRound` is null. Web + PDF/static variants.
  - **Acceptance:** given a populated `nextRound` payload the section renders theme + deadline + submissions-so-far; given null it renders nothing (self-suppress); web + PDF variants; `npm run check` passes.

- [ ] {agent: frontend, id: wire-sections, depends: discoverability-viz,stats-strip-viz,next-round-viz} Register the three new sections in the digest page so each renders in the web view AND the PDF/PNG export, fed by its backend payload — mirror the sprint-15 standings/chat wiring: add each kind to `SECTION_KINDS` (`ui/src/lib/digest/llm.ts`) and its component to `VISUAL_COMPONENTS` (`ui/src/routes/digest/[roundId]/+page.svelte:432`), passing the section's `visualData`. Place them sensibly in the digest order (stat strip near the top; discoverability + next-round after the analytical sections). Coordinate the `visualData` plumbing with backend's payloads.
  - **Acceptance:** on prod (`192.168.4.217:3002`), a digest for a real round (e.g. r-104) shows the by-the-numbers strip, the discoverability leaderboard, and the next-round preview, and all three also appear in a PDF/PNG export; sections self-suppress when their data is empty/null; `npm run check` passes; deployed; visual check (web + export) recorded in the Activity Log.

### Deploy

Each change deploys to prod per `CLAUDE.md`: `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. **Serialize deploys** (review-queue item 6: concurrent `up` on the shared `bot-ui` container races) — or use `npm run dev` (vite HMR in `ui/`) for UI iteration and deploy once at the end.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | popularity fetch + persistence, the discoverability/stats/next-round data queries, and the digest data payloads (`ui/src/routes/api/digest/**`, `ui/src/lib/db/**`, the `src/api/lastfm.ts` fetch path) | the Svelte section components and the digest page section registration |
| viz | the three new visual components (`ui/src/lib/digest/**` new section components) and their web/PDF variants | the data queries, the payload shapes, the `+server.ts` routes, and the digest-page section wiring |
| frontend | the digest-page section registration + ordering (`ui/src/routes/digest/[roundId]/+page.svelte`, `ui/src/lib/digest/llm.ts` SECTION_KINDS) and `visualData` plumbing | the data queries/persistence, `src/api/lastfm.ts`, and the visual component internals |

---

## Decision Log

- **D1** — Three sections this sprint: by-the-numbers stat strip + next-round preview (both deferred in sprint-14 D6) + a new submission-discoverability visual. Bump-chart "season arc" stays deferred.
- **D2** — Discoverability metric = inverse of a **Last.fm playcount** popularity score (`computePopularityProxies`, log-normalized listeners+playcount → 0–100; obscurity = 100 − proxy; per player = mean across season submissions). Chosen over Spotify track-popularity / artist-followers because Last.fm playcount is the truest "how many people have heard this." Spotify track.popularity may ride along as a supplementary column.
- **D3** — Spotify API does **not** expose monthly listeners or stream counts; only `track.popularity` (0–100) + `artist.followers`. The user's "song streams" intent is served by Last.fm playcount.
- **D4** — Popularity is **fetched once and persisted to the DB**, never called live at digest render — `src/` is outside the ui Docker build context, and render-time API calls are too slow/rate-limited.
- **D5** — New sections wire via the existing `SECTION_KINDS` + `VISUAL_COMPONENTS` + `visualData` mechanism (sprint-15), rendering in web AND PDF/PNG export; no parallel rendering path.
- **D6** — Roster: backend (data) + viz (components) + frontend (wiring) — same lanes as sprint-14/15. viz re-staffed.

## Blockers

## Activity Log

### 2026-06-03 — docs — Sprint plan staged: digest visuals (sprint-17, PLANNED)
- 8 tasks: popularity-fetch + discoverability-data + stats-strip-data + next-round-data (backend); discoverability-viz + stats-strip-viz + next-round-viz (viz); wire-sections (frontend)
- 4 backend / 3 viz / 1 frontend / 0 docs
- deps: `discoverability-data` ← `popularity-fetch`; each viz component ← its backend data task; `wire-sections` ← all three viz components. `popularity-fetch`, `stats-strip-data`, `next-round-data` start at kickoff (backend picks them off in any order); viz follows each data task; frontend wires last
- grounded in: `src/api/lastfm.ts` (`getLastfmTrackInfo`/`computePopularityProxies`), the sprint-15 section-wiring mechanism (`SECTION_KINDS` in `llm.ts` + `VISUAL_COMPONENTS` at `+page.svelte:432` + `visualData`), and the standings payload-surfacing pattern
- STAGED outside `docs/coordination/` so it does not become the warren's active sprint while sprint-16 is in flight; promote (git mv + status→active) when sprint-16 closes
- user decisions captured: visuals = stat-strip + next-round + discoverability (not bump-chart); discoverability signal = Last.fm playcount

### 2026-06-03 — viz — all 3 section components built against documented shapes (commit 1c950db)
Built in parallel with backend's data tasks — coded against the coord-doc payload shapes with sample data, no waiting on live data. All three read their payload from the `data` prop (the section's `visualData`, same mechanism as StandingsChart) and implement `VisualComponentProps`. Web/static variant split detected via `?export=1` on the page URL (the flag every export render sets; PDF loads at `format=mobile`).
- **discoverability-viz** → `ui/src/lib/digest/TastemakerLeaderboard.svelte`. Ranked horizontal bars, **most-obscure first**, axis "obscure picks ← → crowd-pleasers"; row = rank + name + obscurityScore (0–100, bar width ∝ score) + submissionCount. **avgPopularity**: revealed on row hover (web) / shown inline always (export, `.is-static`). Reads a bare array **or** `{ discoverability: [...] }`; sorts desc defensively. **Self-suppresses** (renders nothing) on empty payload. Payload consumed: `[{ name, obscurityScore, submissionCount, avgPopularity }]`.
- **stats-strip-viz** → `ui/src/lib/digest/StatStrip.svelte`. 5 tiles (value + label) from `{ totalVotes, submitters, blowoutMargin, closestRace, uniqueArtists }`; blowout/closest carry a `pt` suffix. Row by default; **reflows to single column** inside the `.dg-export--mobile` frame (PDF + mobile PNG) via `:global(.dg-export--mobile) .ss` + a `max-width:520px` media query. Renders only the tiles whose value is present; suppresses if none.
- **next-round-viz** → `ui/src/lib/digest/NextRoundPreview.svelte`. Pulp-tinted card: "▶ Up next" eyebrow, prominent **theme**, deadline + submissions-so-far chips. Deadline = **relative countdown** ("closes in 3 days") on web vs **absolute date only** in export (a static artifact shouldn't bake in a stale "in N days"). **Renders nothing** when `nextRound` is null/empty. Payload: `{ theme, deadline, submissionsSoFar } | null`.
- **Verification:** `npm run check` 0 errors (none of the three flagged). Smoked all three in isolation via Playwright in **both web and export modes**: leaderboard bars + hover-reveal (web) → all details inline (export); stat strip row → single-column in a `.dg-export--mobile` frame; next-round countdown (web) → absolute-only (export); null next-round renders nothing. No horizontal overflow. Temp `_viz-preview` harness removed after.
- **Lane hygiene:** added only the three new `.svelte` files + scoped CSS. Did not touch the `+server.ts` data routes, the payload shapes, or the digest-page section registration.
- **➡ handoff to frontend (`wire-sections`):** register each kind in `SECTION_KINDS` (`llm.ts`) + `VISUAL_COMPONENTS` (`+page.svelte:432`), pass each section's backend payload as `visualData`. Suggested kinds: `discoverability` → `TastemakerLeaderboard`, `stats` → `StatStrip`, `nextRound` (or `next-round`) → `NextRoundPreview`. Components are **unreferenced → tree-shaken** until registered, so the prod web+PDF check rides with that wiring. No standalone viz deploy (serialize-deploys; nothing in the bundle yet).

### 2026-06-03 — backend — Wave 1 ALL 4 backend data tasks done + deployed + prod-smoked

**🔓 `discoverability-data` is done too (popularity-fetch unblocked it) — `discoverability-viz` is unblocked.** All shapes below are live on prod (`192.168.4.217:3002`).

- **popularity-fetch** — `song_popularity` table (PK `spotify_uri`): `listeners, playcount, popularity_proxy (0-100), spotify_popularity, fetched_at, artist, title`. Fetched via `scripts/backfill-popularity.ts` (`tsx`, imports the existing `src/api/lastfm.ts` `getLastfmTrackInfo`/`computePopularityProxies`) — runs at root (can import `src/`), **not** in the ui container; the digest only ever reads the stored score. `popularity_proxy` is recomputed over the whole corpus (the metric is relative). Spotify `track.popularity` rides along. **Idempotent:** skips songs already present; a 2nd run = "0 unfetched, no-op" (verified). **Backfilled Hip Jammers S3** (season 6): 27 songs, all with data (e.g. Arctic Monkeys "Do I Wanna Know?" proxy 100; Lori's GYBR proxy 91). **Run for other seasons:** `tsx scripts/backfill-popularity.ts <seasonId>` (or no arg = all unfetched).
- **stats-strip-data** — `GET /api/digest/:roundId/stats` → `{ stats: { totalVotes, submitters, blowoutMargin, closestRace, uniqueArtists } }`. `totalVotes`=vote rows; `blowoutMargin`=top-song − runner-up points; `closestRace`=smallest adjacent gap; `uniqueArtists`=distinct first-listed artists. **Prod:** r104 `{56,9,0,0,9}` (top two tied at 15 → 0/0, truthful); r102 `{67,9,4,0,9}` (Lori 17 − missmara 13 = 4). ✅
- **next-round-data** — `GET /api/digest/:roundId/next-round` → `{ nextRound: { theme, deadline, submissionsSoFar } | null }`. Next round in the season by id; `deadline` = submission ∥ voting deadline; `null` on the latest round. **Prod:** r104 → `{theme:"Pump Up The Sasha", deadline:2026-06-01…, submissionsSoFar:0}`; r117 (latest) → `null`. ✅
- **discoverability-data** — `GET /api/digest/:roundId/discoverability` → `{ discoverability: [{ name, obscurityScore (0-100), submissionCount, avgPopularity }] | null }`, ranked **most-obscure first**. Per player over the round's **season**: `obscurityScore`=mean(100 − popularity_proxy), `avgPopularity`=mean(proxy). `null` when the season has **zero** popularity-scored songs (self-suppress); partial coverage returns what's scored. **Prod (r104):** 9 players, Mashew most obscure (25) → Kristin crowd-pleaser (6). ✅
- **Verification:** `npm run check` 0 errors; full suite **123 passing** (+5 new: stats/next-round/discoverability). Deployed serialized (`build --no-cache && up -d --force-recreate`).
- **Lane note:** backend only — `song_popularity` + the three GET data endpoints + `lib/db` queries + the root backfill script (`src/api/lastfm.ts` path). Did **not** touch the viz section components or the digest-page section wiring (viz/frontend). **➡ viz:** build `stats-strip-viz`/`next-round-viz`/`discoverability-viz` against the shapes above. **➡ frontend (`wire-sections`):** fetch these 3 GETs in the page loader and pass each as the section's `visualData`, mirroring the sprint-15 standings plumbing.
