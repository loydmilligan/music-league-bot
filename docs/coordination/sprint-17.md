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

- [x] {agent: frontend, id: wire-sections, depends: discoverability-viz,stats-strip-viz,next-round-viz} Register the three new sections in the digest page so each renders in the web view AND the PDF/PNG export, fed by its backend payload — mirror the sprint-15 standings/chat wiring: add each kind to `SECTION_KINDS` (`ui/src/lib/digest/llm.ts`) and its component to `VISUAL_COMPONENTS` (`ui/src/routes/digest/[roundId]/+page.svelte:432`), passing the section's `visualData`. Place them sensibly in the digest order (stat strip near the top; discoverability + next-round after the analytical sections). Coordinate the `visualData` plumbing with backend's payloads.
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

### 2026-06-03 — frontend — wire-sections DONE — sprint-17 complete (deployed, prod-verified)

Wired all three new sections via the **sprint-15 standings mechanism** (synthetic `DigestKind`, NOT `SECTION_KINDS`). **Why not SECTION_KINDS** (despite the literal task wording): these are data-driven sections served by separate GET endpoints, not LLM prose — adding them to `SECTION_KINDS` would (a) make the LLM draft prose for them and (b) violate the `digest_sections.kind` CHECK constraint on INSERT, breaking draft generation. `standings` (sprint-15) used the synthetic path for exactly this reason; this mirrors it.

- **variants.ts:** `DigestKind |= 'stats' | 'discoverability' | 'nextRound'`; `VISUAL_CAPABLE` true for each.
- **+page.server.ts:** `Promise.all` fetch of `/api/digest/:id/{stats,discoverability,next-round}` server-side (failure-isolated → null), added to the refine/finalize page data. Server-side fetch = renders in the Puppeteer export too.
- **+page.svelte:** registered `stats→StatStrip`, `discoverability→TastemakerLeaderboard`, `nextRound→NextRoundPreview` in `VISUAL_COMPONENTS`. Render order: **stat strip near the top** (after masthead, before the LLM sections), **discoverability + next-round after the analytical sections** (post-standings, before footer). Each wrap gated by a `show*` guard (payload present/non-empty) so nothing renders when empty/null — belt-and-suspenders with each component's own self-suppression.

**Prod verification (`192.168.4.217:3002`):**
- **Web (r-104):** stat strip 5 tiles (`{56,9,0,0,9}`), tastemaker leaderboard 9 rows (Mashew 25 → Kristin 6), next-round "▶ Up next" — all present with real data.
- **Export:** `png-sections` emits per-section PNGs incl. `-0-stats`, `-7-discoverability`, `-8-nextround`; in-container Puppeteer (export mode) confirms all three `data-section-kind` present, **no page errors**; viewed the discoverability + stat-strip PNGs (leaderboard bars/axis/inline avg-popularity; stat strip single-column reflow) — clean, no overflow.
- **Self-suppression:** r-112 (`nextRound` null + `discoverability` null) → both sections absent, stats still renders; r-109 (`discoverability` null) → discoverability absent, next-round renders.
- `npm run check` 0 errors. Deployed serialized (build --no-cache → up --force-recreate → verify-landed). Stayed in lane (page wiring + SECTION_KINDS-adjacent `DigestKind` + visualData plumbing); the three components are viz's, mounted as-built.

**✅ sprint-17 complete** — all 8 tasks done (4 backend / 3 viz / 1 frontend).

### 2026-06-03 — backend — discoverability UAT: data-quality verification (READ-ONLY, no changes)

**Verdict: the rankings ARE corrupted by bad INPUT data — Last.fm title-variant fragmentation — on top of a squashed 0-100 scale. Aggregation is correct; the per-song popularity is unreliable.** 27/27 S3 songs have popularity (no NULLs silently excluded); per-player means reproduce the leaderboard exactly (Mashew 25, mmariani13 21, Ronm 14, greg 13, margs 10, Sasha 9, lori 8, missmara 7, Kristin 6).

**Full S3 (season 6) breakdown — player → song → stored numbers (obsc = 100 − proxy):**

| player | r | artist | title | listeners | playcount | proxy | obsc | spotify |
|---|---|---|---|--:|--:|--:|--:|--:|
| Mashew | 102 | The Vandals | I Have a Date | 10,306 | 47,898 | 61 | **39** | 36 |
| Mashew | 103 | Jawbreaker | Want | 78,911 | 482,856 | 75 | 25 | 40 |
| Mashew | 104 | Beastie Boys | Fight For Your Right | 826,520 | 4,293,781 | 88 | 12 | 73 |
| mmariani13 | 102 | Fleetwood Mac | Second Hand News - 2004 Remaster | 487,071 | 2,689,325 | 85 | 15 | 56 |
| mmariani13 | 103 | LL COOL J | I Need Love | 123,897 | 407,289 | 75 | 25 | 52 |
| mmariani13 | 104 | Alanis Morissette | You Learn - 2015 Remaster | 132,649 | 617,409 | 77 | 23 | 68 |
| Ronm | 102 | The Rolling Stones | (I Can't Get No) Satisfaction | 296,392 | 1,016,945 | 80 | 20 | 75 |
| Ronm | 103 | Al Green | Let's Stay Together | 1,408,589 | 9,207,917 | 92 | 8 | 79 |
| Ronm | 104 | Supertramp | The Logical Song | 588,961 | 3,254,190 | 86 | 14 | 55 |
| gregamariani | 102 | Nelly, Murphy Lee, Ali | Air Force Ones | 158,013 | 592,466 | 77 | 23 | 66 |
| gregamariani | 103 | Steve Miller Band | The Joker | 935,059 | 5,732,481 | 89 | 11 | 79 |
| gregamariani | 104 | Wheatus | Teenage Dirtbag | 1,650,242 | 14,969,671 | 94 | 6 | 87 |
| margs | 102 | Darius Rucker | Wagon Wheel | 367,938 | 3,151,668 | 85 | 15 | 84 |
| margs | 103 | Stevie Wonder | Isn't She Lovely | 920,564 | 5,032,396 | 89 | 11 | 75 |
| margs | 104 | Britney Spears | ...Baby One More Time | 2,092,841 | 17,267,852 | 95 | 5 | 87 |
| Sasha Mariana | 102 | George Michael | Careless Whisper | 1,724,493 | 14,738,134 | 94 | 6 | 79 |
| Sasha Mariana | 103 | The Beatles | In My Life - Remastered 2009 | 1,002,014 | 9,118,416 | 91 | 9 | 80 |
| Sasha Mariana | 104 | The Police | Don't Stand So Close To Me | 826,021 | 4,226,258 | 88 | 12 | 73 |
| lorimariani | 102 | Elton John | Goodbye Yellow Brick Road - Re | 907,507 | 8,325,996 | 91 | 9 | 78 |
| lorimariani | 103 | Neil Young | Harvest Moon | 946,808 | 7,829,212 | 91 | 9 | 79 |
| lorimariani | 104 | Pearl Jam | Jeremy | 1,350,596 | 10,417,135 | 93 | 7 | 76 |
| missmara | 102 | Bonnie Tyler | Total Eclipse of the Heart | 1,337,832 | 9,121,567 | 92 | 8 | 84 |
| missmara | 103 | Arctic Monkeys | Do I Wanna Know? | 2,913,969 | 45,553,717 | 100 | 0 | 90 |
| missmara | 104 | Wet Leg | Chaise Longue | 395,400 | 3,497,693 | 86 | 14 | 66 |
| Kristin | 102 | The All-American Rejects | Move Along | 1,138,294 | 8,814,971 | 92 | 8 | 76 |
| Kristin | 103 | Paramore | Still into You | 2,047,868 | 28,260,483 | 97 | 3 | 67 |
| Kristin | 104 | Pink Floyd | Another Brick in the Wall, Pt. | 1,203,375 | 8,676,834 | 92 | 8 | 85 |

**FLAGGED — confirmed Last.fm mismatches (live re-queries with `autocorrect=1`, same as the fetch):**
- **Beastie Boys "Fight For Your Right" — variant fragmentation, ~50× swing.** The submission title matches Last.fm entry "Fight for Your Right" = **826K** listeners (stored, obsc 12). The *canonical* "(You Gotta) Fight for Your Right (To Party!)" entry = **15,877** listeners (would be obsc ~58). Same song, two entries; which one is matched is pure luck of the title string. → Mashew's Beastie pick is his *most mainstream* (obsc 12); his #1-most-obscure rank is actually driven by The Vandals (obsc 39) + Jawbreaker (25), which are genuinely obscure punk. The user's "Beastie Boys = mainstream" intuition is right, but it isn't what's ranking Mashew #1.
- **Rolling Stones "(I Can't Get No) Satisfaction" — stored value is stale/wrong.** Stored = **296K** / 1.0M (obsc 20). A live re-query of the *identical* artist+title now returns **663K / 3.3M** — and even that undercounts (scrobbles split across mono/stereo/remaster/live entries). The stored number doesn't even reproduce on re-query → unreliable. Inflates Ronm's obscurity.
- **Alanis "You Learn - 2015 Remaster" — remaster variant undercounts 3.4×.** Stored = **132K** (obsc 23) vs clean "You Learn" = **451K** (obsc ~13). Inflates mmariani13's obscurity (#2). Same pattern risk on every "- Remaster/Remastered" title: Beatles "In My Life - Remastered 2009" 1.0M vs clean 669K; Fleetwood Mac "Second Hand News - 2004 Remaster" 487K vs clean 335K. The matched count depends on the Spotify title suffix, not the song's true total.
- **Karaoke/cover title:** Mashew r102 title is "I Have a Date - Originally Performed by The Vandals" (a cover/karaoke marker on the Spotify track); Last.fm `autocorrect` still landed on the real Vandals (10K, genuinely obscure) — OK here, but "Originally Performed by …" Spotify tracks are a mismatch risk in general.

**NOT a data error — missmara is correctly low-obscurity.** Her three S3 picks have realistic, verified Last.fm numbers: Total Eclipse 1.34M, Arctic Monkeys "Do I Wanna Know?" 2.9M (control: stored == live, exact), Wet Leg "Chaise Longue" 395K. She ranks near the bottom because she genuinely picked **popular** songs this season — the rankings reflect her actual r-104-season submissions, not a lookup bug. (If the user expected her obscure, it's an expectation mismatch, not bad data.)

**Two compounding problems:**
1. **Bad input (primary):** title-variant fragmentation — remaster/live/mono/"(You Gotta)…"/cover entries split scrobbles, and `track.getInfo` matches whatever the literal Spotify title resolves to, often not the canonical max-scrobble entry. Cuts both ways (over- and under-counts) unpredictably. Recent single-entry songs (Arctic Monkeys, Wet Leg, Paramore) are accurate; classic-catalog songs are not.
2. **Squashed scale (secondary):** corpus max playcount is one outlier (Arctic Monkeys 45.5M); log-normalizing against it compresses everything into proxy ~75-100 / obsc 0-25, so a single variant-mismatch swings rank disproportionately.

**Recommended fix paths (for decision — NOT applied):**
- **Normalize the title before lookup:** strip "- Remaster(ed)…", "- … Mix/Mono/Stereo", "(Live…)", "- Originally Performed by…", trailing parentheticals → query the canonical track. Cheap, biggest win.
- **Pick the max-scrobble match:** use `track.search` and take the highest-listener result for the artist, instead of `track.getInfo` on the literal title (handles "(You Gotta) Fight for Your Right" vs "Fight for Your Right").
- **De-squash the proxy:** rank/percentile within the season (or cap the normalizing max) instead of log-normalizing against a lone 45M outlier.
- Re-backfill affected songs after whichever lookup change lands (the `fetched_at` cache makes a forced refresh easy).

**Read-only — no code or data changed.** Reporting for the fix decision.

### 2026-06-03 — backend — discoverability-fix: normalized search-based Last.fm lookup + S3 re-backfill (deployed; CLEAN data for user review)

**Lookup fixed** (`src/api/lastfm.ts`): `getLastfmPopularity()` now (1) `normalizeTrackTitle()` strips `- Remaster(ed)/Mix/Mono/Stereo/Live/Originally Performed by…` dash + qualifier-parenthetical suffixes, then (2) uses `track.search` and takes the **highest-listener result for the artist**, then (3) `getInfo` on that canonical match for authoritative listeners+playcount. `scripts/backfill-popularity.ts` gained `--force` (re-fetch cached, upsert). **Proxy scale left as-is (log-norm)** per the brief — user reviews per-song numbers first. **Force re-backfilled Hip Jammers S3 (season 6): 27/27 refreshed.** `npm run check` 0 errors (ui) + root `tsc` clean; deployed.

**CLEAN per-player → per-song (obsc = 100 − proxy):**

| player | r | artist | title | listeners | playcount | proxy | obsc | sp |
|---|---|---|---|--:|--:|--:|--:|--:|
| Mashew | 102 | The Vandals | I Have a Date | 12,182 | 55,342 | 62 | **38** | 36 |
| Mashew | 103 | Jawbreaker | Want | 78,935 | 483,042 | 75 | 25 | 40 |
| Mashew | 104 | Beastie Boys | Fight For Your Right | 826,641 | 4,294,801 | 88 | 12 | 73 |
| mmariani13 | 102 | Fleetwood Mac | Second Hand News | 487,071 | 2,689,325 | 85 | 15 | 56 |
| mmariani13 | 103 | LL COOL J | I Need Love | 123,904 | 407,331 | 75 | 25 | 52 |
| mmariani13 | 104 | Alanis Morissette | You Learn | 451,801 | 2,453,084 | 85 | 15 | 68 |
| gregamariani | 102 | Nelly | Air Force Ones | 158,053 | 592,618 | 77 | 23 | 66 |
| gregamariani | 103 | Steve Miller Band | The Joker | 935,059 | 5,732,481 | 89 | 11 | 79 |
| gregamariani | 104 | Wheatus | Teenage Dirtbag | 1,651,254 | 14,982,227 | 94 | 6 | 87 |
| Ronm | 102 | The Rolling Stones | (I Can't Get No) Satisfaction | 663,151 | 3,328,006 | 87 | 13 | 75 |
| Ronm | 103 | Al Green | Let's Stay Together | 1,408,859 | 9,210,671 | 92 | 8 | 79 |
| Ronm | 104 | Supertramp | The Logical Song | 588,961 | 3,254,190 | 86 | 14 | 55 |
| margs | 102 | Darius Rucker | Wagon Wheel | 368,184 | 3,154,374 | 85 | 15 | 84 |
| margs | 103 | Stevie Wonder | Isn't She Lovely | 921,122 | 5,036,086 | 89 | 11 | 75 |
| margs | 104 | Britney Spears | ...Baby One More Time | 2,094,421 | 17,282,751 | 95 | 5 | 87 |
| Sasha Mariana | 102 | George Michael | Careless Whisper | 1,724,952 | 14,743,216 | 94 | 6 | 79 |
| Sasha Mariana | 103 | The Beatles | In My Life | 1,002,469 | 9,124,556 | 91 | 9 | 80 |
| Sasha Mariana | 104 | The Police | Don't Stand So Close To Me | 826,212 | 4,227,540 | 88 | 12 | 73 |
| lorimariani | 102 | Elton John | Goodbye Yellow Brick Road | 907,900 | 8,330,070 | 91 | 9 | 78 |
| lorimariani | 103 | Neil Young | Harvest Moon | 947,387 | 7,836,083 | 91 | 9 | 79 |
| lorimariani | 104 | Pearl Jam | Jeremy | 1,350,885 | 10,420,203 | 93 | 7 | 76 |
| missmara | 102 | Bonnie Tyler | Total Eclipse of the Heart | 1,338,995 | 9,130,661 | 92 | 8 | 84 |
| missmara | 103 | Arctic Monkeys | Do I Wanna Know? | 2,914,938 | 45,572,769 | 100 | 0 | 90 |
| missmara | 104 | Wet Leg | Chaise Longue | 395,556 | 3,499,338 | 86 | 14 | 66 |
| Kristin | 102 | The All-American Rejects | Move Along | 1,138,294 | 8,814,971 | 92 | 8 | 76 |
| Kristin | 103 | Paramore | Still into You | 2,048,779 | 28,282,281 | 97 | 3 | 67 |
| Kristin | 104 | Pink Floyd | Another Brick in the Wall, Pt. 2 | 1,203,375 | 8,676,834 | 92 | 8 | 85 |

**CLEAN leaderboard (mean obscurity, most-obscure first):** Mashew 25 · mmariani13 **18** · gregamariani 13 · Ronm **12** · margs 10 · Sasha 9 · lorimariani 8 · missmara 7 · Kristin 6.

**What changed vs the dirty run:**
- **Rolling Stones "(I Can't Get No) Satisfaction": 296,392 → 663,151 listeners** (obsc 20 → 13). Was a stale/low variant; search-max found the canonical (Mono) entry. → **Ronm 14 → 12, drops rank 3 → 4.**
- **Alanis "You Learn - 2015 Remaster": 132,649 → 451,801** (obsc 23 → 15). Normalized to "You Learn" → canonical, no longer the low remaster entry. → **mmariani13 21 → 18** (stays #2).
- **Beastie Boys "Fight For Your Right": ~unchanged (826,641, obsc 12).** Search-max already returns the popular entry, not the 16k "(You Gotta)…" split — so it's correctly *not* obscure. Mashew's #1 rank is driven by **The Vandals (obsc 38) + Jawbreaker (25)** — genuinely obscure punk, not the Beastie Boys.
- **Beatles "In My Life" / Fleetwood Mac "Second Hand News": unchanged** — search-max already picked the remaster entries (which legitimately have the *most* scrobbles), so no correction needed.
- **missmara unchanged (7, near bottom) — confirmed not a data bug.** Her picks (Total Eclipse 1.34M, Arctic Monkeys 2.9M, Wet Leg 395k) are genuinely popular; numbers verified correct.

**Note for the next pass (per orc heads-up):** per-song obscurity + spotify_popularity are now stored per `spotify_uri` and joinable in `discoverability.ts` — so a "repeated mainstream pick count" / per-song surfacing is a straightforward payload extension (not built this pass). **Scale still squashed** (corpus max = Arctic Monkeys 45.5M plays compresses proxy into ~62-100); rescale is the open follow-up after the user reviews these clean numbers.

**Deploy note:** the lookup fix lives in `src/` (outside the ui build context) and the correction is DB data — so prod served the clean numbers the moment the re-backfill finished (verified live on `GET /api/digest/104/discoverability` before redeploy). bot-ui rebuilt anyway to keep the image in sync. Read/compute path unchanged.
