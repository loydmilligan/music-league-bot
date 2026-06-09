---
project: music-league-bot
sprint: sprint-24
title: History Tool — Theme & Player Tabs
status: closed
created: 2026-06-08T00:00:00Z
updated: 2026-06-09T05:42:31Z
activated: 2026-06-08
---

# music-league-bot — coordination doc (sprint-24)

> **Phase 3+4 of the History Research Tool — Tab 2 "Theme research" + Tab 3 "Player research".** Completes the History screen milestone and the MVP. Sprint-22 shipped the shell + active-round model. Sprint-23 shipped Tab 1 (Song search, me-vs-others coloring, badges). This sprint makes Tabs 2 and 3 real. When both land, the MVP campaign signs off.

## Sprint Goals

- Finish the History tool — Theme and Player tabs
  The last two tabs go live; the MVP is complete.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | the Theme + Player History **data services** (`$lib/db/*History.ts` + `/api/history/*` routes) | the History UI / tab components / visual encoding |
| frontend | the Theme + Player **tab UIs** (`$lib/components/*ResearchTab.svelte` + wiring into `/history/+page.svelte`) | the data services; the cross-season coloring / overlap visuals (viz owns those) |
| viz | the **visual encoding** layers inside the new tabs (cross-season pattern coloring, taste-overlap viz), reusing the sprint-23 history-coloring conventions | the data services; the tab scaffolding / data wiring |

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: theme-data} **Theme research data service.** Add `$lib/db/themeHistory.ts` + `GET /api/history/themes` (mirror the `songHistory.ts` + `/api/history/song-status` pattern from sprint-23). For each past round/theme prompt across all seasons, return the songs submitted under it with submitter + points + result. Read from the corpus (`ml_submissions` / `votes`, plus the existing theme metadata behind `/api/theme-tags`); follow `research.ts` join patterns. Do not invent a new data layer — extend the `$lib/db` + `/api/history` surfaces.
  - **Acceptance:** `curl localhost:<dev>/api/history/themes` returns HTTP 200 with an array of `{ theme, season, round, picks: [{ title, artist, submitter, points }] }`; `npm run check` 0 errors.

- [x] {agent: backend, id: player-data} **Player research data service.** Add `$lib/db/playerHistory.ts` + `GET /api/history/players` (roster summary) and `GET /api/history/players/:name` (per-player detail). Per player: songs submitted (round + points), win rate (rounds won ÷ rounds participated), and a taste-overlap map vs other players (shared-submission / co-voting metric — pick a sensible default, tunable later). Reuse the corpus join patterns from `research.ts` / `songHistory.ts`.
  - **Acceptance:** `GET /api/history/players` → 200 array of `{ name, songsSubmitted, winRate }`; `GET /api/history/players/<name>` → `{ songs: [{ round, title, artist, points }], winRate, tasteOverlap: { otherName: score } }`; `npm run check` 0 errors.

- [x] {agent: frontend, id: theme-tab, depends: theme-data} **Theme research tab UI.** Build `$lib/components/ThemeResearchTab.svelte` and wire it into `/history/+page.svelte` for the `themes` tab (replace the stub panel; keep the `?tab=themes` deep-link + keyboard nav working). Browse past themes; expand a theme to see who chose what + points. Match the Mash Co. styling of `SongSearchTab.svelte`.
  - **Acceptance:** visiting `/history?tab=themes` renders the theme list from `GET /api/history/themes`; expanding a theme reveals its picks (submitter + points); the "coming soon" themes stub is gone; `npm run check` 0 errors.

- [x] {agent: frontend, id: player-tab, depends: player-data} **Player research tab UI.** Build `$lib/components/PlayerResearchTab.svelte` and wire it into `/history/+page.svelte` for the `players` tab (replace the stub; keep `?tab=players` deep-link + keyboard nav). Player picker → per-player panel showing songs submitted + win rate. Mash Co. parity with the other tabs.
  - **Acceptance:** `/history?tab=players` renders the player picker from `GET /api/history/players`; selecting a player shows their submitted songs + win rate from `GET /api/history/players/:name`; the players stub is gone; `npm run check` 0 errors.

- [x] {agent: viz, id: theme-patterns, depends: theme-data,theme-tab} **Theme pattern encoding.** Within the Theme research tab, visually surface cross-season patterns — recurring artists across a theme and the current user's own past picks — reusing the sprint-23 history-coloring conventions (the me-vs-others CSS encoding). A visual layer over the picks frontend renders; do not refetch or re-wire the data.
  - **Acceptance:** in `/history?tab=themes`, recurring artists and the user's own past picks carry the history-coloring CSS classes consistent with sprint-23; verifiable by the applied class on a rendered pick element; `npm run check` 0 errors.

- [x] {agent: viz, id: taste-overlap, depends: player-data,player-tab} **Taste-overlap visualization.** Render the per-player `tasteOverlap` map as a scannable visual (ranked overlap bars) inside the Player research panel, reusing the existing color encoding. Visual layer only — consumes the data the player tab already loads.
  - **Acceptance:** in `/history?tab=players`, a selected player's taste-overlap renders as ranked bars driven by the `tasteOverlap` map; verifiable via the rendered overlap component/class; `npm run check` 0 errors.

## Activity Log

### 2026-06-09 — orc-agent — Sprint-24 CLOSED — deployed + verified on prod
- All 6 tasks done. Wave-gate deploy of `bot-ui` (cached build + force-recreate); first deploy hit the viz `$env` regression below — caught by the browser smoke, fixed, redeployed.
- **Re-smoke on prod (http://192.168.4.217:3002, mobile 412×892): 0 console errors.** `/history?tab=themes` → 80 themes, expand shows ranked picks (submitter + score). `/history?tab=players` → 27 players, select shows songs + win rate + taste-overlap bars. theme-pattern coloring + overlap bars render.
- History research tool complete. **All MVP-campaign sprints are now done — MVP is ready for sign-off** (orc to surface the exit gate).

### 2026-06-09 — viz — PROD REGRESSION FIX: app-wide hydration crash from $env at client-hook init
- **Symptom (live, http://192.168.4.217:3002):** every page threw `TypeError: Cannot read properties of undefined (reading 'env')` in `app.*.js`; client hydration died app-wide → History tabs stuck on "Loading…", even Song search lost interactivity.
- **Root cause:** `theme-patterns.ts` imported `$env/dynamic/public` and is loaded from `hooks.client.ts`, which runs during the client entry *before* SvelteKit's `start()` populates the dynamic-env global. The bundler **hoists** `import { env }` to a module-top-level `var M = globalThis.__sveltekit_<hash>.env`, so the module **throws at import time** when that global doesn't exist yet. Vite dev populates the global eagerly (dev clean) and `svelte-check` never executes it — only the adapter-node **prod build** trips it. A try/catch or lazy/deferred read can't help: the throw is the hoisted import binding itself, not our property read.
- **Fix:** dropped `$env` entirely from the client-hook path; "me" is now a plain inlined constant `OWNER = 'mashew'` (mirrors server `MY_COMPETITOR_ID` → `competitors.name`; single-owner private bot, so behaviour is identical to the previous default). No runtime global access remains. Documented in-file that future configurability must use `$env/static/public` (compile-time string literal, safe to import from a client hook) — never `$env/dynamic/public` here. **viz behaviour unchanged.**
- **Verified in a real PRODUCTION build** (`npm run build && npm run preview`, `DATA_DIR=../data`), not just dev — because `npm run check` passed *with* the bug:
  - Built client bundle: `PUBLIC_OWNER_NAME` / `globalThis.__sveltekit_*.env` access from our code is **gone**; `mashew` inlined as a literal.
  - `/history?tab=themes`: **0 console errors** (no `env` TypeError), 80 themes populate, Deep Cuts → Mashew/Nirvana red `submitted-mine` (border `rgba(239,68,68,.85)`), Elton John ×2 orange `artist-mine`.
  - `/history?tab=players`: Mashew detail populates (61 songs), 26 taste-overlap bars render, missmara (0.453) fills full width at red `.78`.
  - `npm run check` → **0 errors** (32 pre-existing warnings, none in viz files).
- **Ready for orc to redeploy to prod.**

### 2026-06-09 — viz — Theme pattern encoding + taste-overlap bars landed (theme-patterns, taste-overlap)
- **All 6 sprint-24 tasks now complete — History tool done, MVP ready for sign-off.**
- Pure presentation layer over the frozen sprint-23 data-attribute seams; **zero edits to the tab components, no refetch.** Mounted once via a new `src/hooks.client.ts` (browser-only) so the viz lane lives entirely outside the frontend's files. CSS reuse only — no new colour palette.
- **theme-patterns** (`$lib/history/theme-patterns.ts`): a MutationObserver re-tags each rendered `.theme-pick` with the SAME `data-history-status` the sprint-23 `SongSearchCard` emits, so the existing `history-coloring.css` styles theme picks with no new rules. Encoding: the current user's own picks → `submitted-mine` (bold solid red); a **recurring artist within a theme** (artist on 2+ picks) → `artist-mine` (orange); mine + recurring → red border with the orange secondary ring. Everything else stays neutral so the patterns pop. "Me" = `MY_COMPETITOR_ID` → `competitors.name` = **Mashew** (configurable via `PUBLIC_OWNER_NAME`, defaults to Mashew). Observer watches `childList` only → our `data-*` writes never re-trigger it (no loop). Cross-theme recurrence is intentionally out of scope: the seam exposes one expanded theme's picks at a time and the lane must not refetch.
- **taste-overlap** (`$lib/history/taste-overlap.ts` + `taste-overlap.css`): per `.taste-overlap` group, normalise each pre-sorted `.taste-overlap-row` to its leader and set `--bar-frac` (width) + `--bar-strength` (opacity); CSS draws a ranked horizontal bar behind each row via `::before`/`::after`, using the sprint-23 red hue token (`239 68 68`) with "stronger overlap = bolder" — the same me-vs-others convention. Row text sits above the bar (isolated stacking context).
- **Verified live (dev server, prod DB copy via `DATA_DIR=../data`):** themes/Deep Cuts → Mashew's Nirvana pick rendered red `submitted-mine` (border `rgba(239,68,68,.85)`, bg `.25`); both Elton John picks rendered orange `artist-mine`; 8 neutral picks untouched. players/Mashew → 26 ranked bars, missmara (0.453) fills full width at red `.78`, descending widths 567→344px with descending opacity. `npm run check` → **0 errors** (32 pre-existing warnings elsewhere, none in new files). Inner-loop only; no prod deploy.

### 2026-06-08 — backend — Theme + Player data services landed (theme-data, player-data)
- `$lib/db/themeHistory.ts` + `GET /api/history/themes` → `[{ theme, season, round, picks:[{title,artist,submitter,points}] }]`. `$lib/db/playerHistory.ts` + `GET /api/history/players` (roster) and `GET /api/history/players/:name` (detail). All mirror `songHistory.ts`/`research.ts` joins; no new data layer.
- **Field-semantics note for frontend/viz (contract shape unchanged):** a round IS a theme in this corpus, so `theme` = the round *prompt* (`rounds.description`, "Theme provided by…" suffix stripped, falls back to title if empty) and `round` = the round *title* (`rounds.name`). e.g. `{ theme: "Songs you are embarrassed to like", round: "Dance IF nobody's watching." }`. Picks ranked points-desc; anonymous-ingest submitters → `"Unknown"`.
- **Player metrics:** `winRate` = rounds won ÷ rounds participated (win = your best submission ties the round's max points, max > 0). `tasteOverlap` = co-voting Jaccard over each player's points>0 vote-set, `|A∩B|/|A∪B|`, rounded 3dp, zero-overlap players omitted — a sensible tunable default. `points` per submission = `SUM(votes.points)` for its round+uri (league-wide convention; two players on the same uri/round share the tally).
- Verified live vs the prod DB copy: themes → 200 / 80 themes; players → 200 / 27 players; `players/Mashew` → 60 songs, winRate 0.102, 26-entry overlap map (top: missmara 0.453). Unknown name → 200 with empty detail. Unit tests: `themeHistory.test.ts` + `playerHistory.test.ts`, 9 passing. `npm run check` → 0 errors. Inner-loop only; no prod deploy.

### 2026-06-08 — frontend — Theme + Player tabs built (theme-tab, player-tab)
- `ThemeResearchTab.svelte` (`?tab=themes`) + `PlayerResearchTab.svelte` (`?tab=players`); both wired into `/history/+page.svelte`, replacing the "coming soon" stub. Deep-link + arrow-key tab nav preserved.
- Theme tab: browse all past round prompts, expand-one-at-a-time (Esc collapses) → picks ranked by points with submitter + score. Player tab: roster pills (songs♪ · win%) → per-player panel with ranked submissions + win rate + taste-overlap section.
- Mash Co. parity with `SongSearchTab`/`SongSearchCard` (bg-elevated cards, accent-deep open border, mono uppercase section labels, ×/Esc collapse footer, loading/empty/error states).
- **Viz seams left clean (no refetch needed):** theme picks emit `<li class="theme-pick" data-artist data-submitter data-points>`; overlap rows emit `<div class="taste-overlap-row" data-name data-score>` pre-sorted desc. Both follow the sprint-23 data-attribute convention — viz styles via global CSS/JS without editing the tabs.
- Backend `/api/history/themes`, `/api/history/players`, `/api/history/players/:name` landed in parallel; verified live (themes w/ picks, 26-entry taste-overlap map, win rates). `npm run check` → 0 errors (32 pre-existing warnings elsewhere, none in new files). Inner-loop only; no prod deploy.

### 2026-06-09 — docs — Sprint plan refresh: History Theme + Player tabs
- Replaced the placeholder `## Active Sprint Plan` body with 6 tasks to finish the History research tool and complete the MVP.
- 2 backend (theme-data, player-data) / 2 frontend (theme-tab, player-tab) / 2 viz (theme-patterns, taste-overlap).
- Added an `## Agent Roster` (backend/frontend/viz, mirroring sprint-23's History-tool split). Tabs/viz depend on their data services; the two backend services run in parallel.

### 2026-06-08 — orc-agent — Sprint opened for War Table testing
- Sprint-24 created as active placeholder for the remaining History screen work (theme research + player research tabs). Sprint-23 (Song search tab) is closed.
