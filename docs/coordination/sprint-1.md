---
project: music-league-bot
sprint: sprint-1
title: Dashboard Foundation
status: closed
created: 2026-05-14T16:36:41.376Z
updated: 2026-05-14T16:36:41.376Z
---

# music-league-bot — coordination doc (sprint-1)

> Strict template per Session O2=B / seed §12 Phase 8. The dashboard
> reads this as the canonical substrate (seed §3.7); orc emits
> `coord-doc-stale` cards when drift is detected (§3.8 / O7=A).
>
> Section headings are load-bearing — keep them as-is so the parser can
> find them. Section bodies are markdown-flexible.

## Plan Source

<!-- Identifies which plan substrate orc-tower reads for the "what next"
     project header (per the v1.x sprint-orchestration spec §4.3).
     The source of truth is `methodology.planning` in the tower-side
     profile.md; this section is the project-readable mirror. If the
     two disagree, that is itself a coord-doc-stale signal. -->

- Type: inline
- Path: this document (`## Active Sprint Plan` section)
- Active unit: sprint-1

## Sprint Goals

<!-- One or two sentences per goal. The dashboard surfaces these at the
     top of the project view as the "what next, always" anchor. -->

- Stand up a SvelteKit full-stack dashboard (adapter-node) that surfaces every Music League season, round, and playlist from the local `league.db`. Server routes own all DB access; the home/season/round pages are the primary "what's in my league" view.
- Make ZIP exports a first-class ingest path: on startup the app scans `data/*/season-*/export.zip` and imports rounds, submissions, votes, and competitors, with an in-UI re-import action surfaced from the settings page.
- Ship a per-round song research workflow — Spotify search, candidate list, 1–5 ratings (theme fit, discovery, nostalgia, personal), notes, and a configurable weighted score that the user tunes from settings.
- Deploy as a Docker service on port 3002 sharing the host `data/` volume, with a background Songlink worker draining the YTM resolution queue at ≤10/min so round pages can deep-link to YouTube Music.

## Active Initiatives

<!-- Each initiative is one heading, e.g. `### Initiative — short name`,
     with a 1-2 sentence body. Include a status tag in the heading
     (e.g. "[in-flight]", "[blocked]", "[done]"). When `methodology.
     planning: inline` is configured, the Active Sprint Plan below
     replaces this section's role; treat this one as a high-altitude
     narrative summary or omit. -->

- _None yet._

## Active Sprint Plan

<!-- Lightweight task list for the current sprint when `methodology.
     planning: inline` is configured. orc-tower's InlineArtifactSource
     parses this section. Format:

       - [x] {agent: backend, id: my-task} Body of the task
       - [-] {agent: frontend, depends: my-task} Another task
       - [x] {agent: docs} A done task

     Status:
       - [ ]   pending
       - [-]   in-progress
       - [x]   done
       - [!]   blocked

     Metadata in `{...}` is optional and precedes the body:
       - agent     — must match an entry in `## Agent Roster`
       - depends   — comma-separated; numeric (1-indexed within this
                     section) or slug (matches another task's `id:`)
       - id        — optional slug; makes the task referenceable

     Edit this section directly to add/remove/reorder tasks. orc-tower
     never writes to it; ratification cards propose entries elsewhere
     (Activity Log, Decision Log) but plan changes are author-driven.

     When every task reaches [x], SprintHeader surfaces kickoff buttons
     ("Run sprint review →" / "Plan next sprint →") that pre-fill
     SendPromptModal with the relevant template. The warren never
     auto-sends — the confirmation gate is sacred (CLAUDE.md §3.6).
     See: docs/design/2026-05-05-sprint-kickoff-flow.md -->

- [x] {agent: infra, id: scaffold} Task 1 — SvelteKit scaffold: `ui/package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `app.html`, `app.css`, and the `+layout.svelte` nav shell. Smoke-test `npm run dev` before handing off.
- [x] {agent: backend, id: db-schema, depends: scaffold} Task 2 — `ui/src/lib/db/schema.ts` (CREATE TABLE + DEFAULT_SETTINGS) and `client.ts` (`openLeagueDb()` / `getDb()` singleton against `data/league.db`).
- [x] {agent: backend, id: types, depends: scaffold} Task 3 — `ui/src/lib/types.ts` shared interfaces (League, Season, Round, Submission, Vote, ResearchSong, Settings, etc.) used by both server and svelte components.
- [x] {agent: backend, id: leagues-db, depends: db-schema, types} Task 4 — `ui/src/lib/db/leagues.ts` league + season queries and SEED_LEAGUES bootstrap.
- [x] {agent: backend, id: scoring, depends: types} Task 5 — `ui/src/lib/scoring.ts` weighted-score formula and `ui/src/lib/db/settings.ts` (`getSettings()`, `updateWeights()`).
- [x] {agent: backend, id: import, depends: leagues-db} Task 6 — ZIP ingest pipeline: `ui/src/lib/import/zipParser.ts`, `importer.ts`, `startupScan.ts`, plus `rounds.ts`, `submissions.ts`, `importLog.ts` db modules.
- [x] {agent: backend, id: hooks-research, depends: import, scoring} Task 7 — `ui/src/hooks.server.ts` (DB init + startup import) and `ui/src/lib/db/research.ts` CRUD for `research_songs`.
- [x] {agent: backend, id: ytm-api, depends: db-schema} Task 11 — `ui/src/lib/songlink.ts`, `ui/src/lib/db/ytmQueue.ts`, and `routes/api/ytm/[spotifyUri]/+server.ts` (resolve + cache).
- [x] {agent: backend, id: queue-worker, depends: ytm-api} Task 14 — `ui/src/lib/queueWorker.ts` background drain loop (≤10/min) wired from `hooks.server.ts`.
- [x] {agent: backend, id: research-api, depends: hooks-research} Task 12.1, 12.4 — `routes/api/research/[roundId]/+server.ts` (GET/POST/PATCH/DELETE) and `routes/api/spotify/search/+server.ts`; reuses `ui/src/lib/spotify.ts`.
- [x] {agent: frontend, id: home, depends: hooks-research} Task 8 — home `+page.server.ts` loader and `+page.svelte` showing active seasons, past seasons, and all-songs roll-up.
- [x] {agent: frontend, id: season, depends: hooks-research} Task 9 — `league/[league]/season/[n]/+page.server.ts` + `+page.svelte` season detail view.
- [x] {agent: frontend, id: round, depends: hooks-research, ytm-api} Task 10 — round `+page.server.ts` + `+page.svelte` with ML / chat tabs and YTM deep links.
- [x] {agent: frontend, id: research-ui, depends: round, research-api} Task 12.2–12.3 — `ResearchList` component (Spotify search, ratings, notes, weighted score) wired into the round page.
- [x] {agent: frontend, id: settings-ui, depends: research-api, queue-worker} Task 13 — `settings/+page.server.ts` + `+page.svelte` for weights, import/rescan, deadlines, and queue status.
- [x] {agent: infra, id: docker, depends: settings-ui, research-ui} Task 15 — `Dockerfile.ui`, `docker-compose.yml` `bot-ui` service on :3002 mounting `./data`, and `.env.example` additions.

## Agent Roster

<!-- O5=A — owns / doesNotTouch live here, not in per-agent profiles. The
     dashboard reads this table to flag pane activity that touches another
     agent's doesNotTouch territory. -->

| Agent | Owns | Does not touch |
|---|---|---|
| infra | `ui/package.json`, `ui/svelte.config.js`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/src/app.html`, `ui/src/app.css`, `Dockerfile.ui`, `docker-compose.yml`, `.env.example` | `ui/src/**` (after scaffold lands) |
| backend | `ui/src/lib/**`, `ui/src/hooks.server.ts`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/api/**` | `ui/src/routes/**/+page.svelte`, `ui/src/lib/components/**`, infra files |
| frontend | `ui/src/routes/**/+page.svelte`, `ui/src/routes/+layout.svelte`, `ui/src/lib/components/**` | `ui/src/lib/db/**`, `ui/src/lib/import/**`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/api/**`, infra files |

- **infra** — Tasks 1 (scaffold + configs) and 15 (Dockerfile.ui + compose entry + env example).
- **backend** — Tasks 2–7 (db schema/client, types, leagues/seasons, scoring, ZIP import, hooks + research db), 11 (songlink + YTM api + queue db), 14 (background queue worker), plus all `+page.server.ts` loaders and `routes/api/**` handlers feeding the frontend.
- **frontend** — Task 1.6 layout shell, Tasks 8–10 (home / season / round `+page.svelte`), Task 12.2–12.3 (ResearchList component wired into round), Task 13 (settings page UI).

## Decision Log

<!-- Each entry: `### {{date}} — {{decision-id}} — {{summary}}` with a
     short body. Tower's audit log (~/.orc-tower/<slug>/audit/) is
     canonical for decision-request resolutions; this section is the
     project-readable mirror (N7) — orc proposes entries via
     ratification cards. -->

_No decisions yet._

## Ratification Log

<!-- Same shape as Decision Log; entries land here when a
     ratification-needed card resolves with kind "ratified". -->

_No ratifications yet._

## Contract Changes

<!-- API / schema / coord-doc-template changes that other agents must
     respect. Each entry: `### {{date}} — {{summary}}` + body listing
     before/after. The dashboard surfaces unprocessed entries as
     "contract changes since you last looked." -->

_No contract changes yet._

## Blockers

<!-- One bullet per active blocker. Format:
     `- [<agent>] <one-line blocker> — <link or reference>`. Resolved
     blockers move to the Activity Log. -->

- _None._

## Activity Log

<!-- Per-agent updates land here, newest first. Format:

     ### {{date}} — {{agent}} — {{summary}}
     - what changed
     - why
     - links: PRs, audit entries

     Drift detection (O6) compares this section's most recent timestamp
     against git history; if commits land on owns paths without a
     matching entry, orc emits a coord-doc-stale card proposing an
     entry for the agent that committed. -->

### 2026-05-14 — infra — docker landed
- `Dockerfile.ui`: multi-stage Node 22 bookworm-slim build — builder installs python3/make/g++ for better-sqlite3 native compile, runs `npm ci && npm run build`, prunes to prod deps; runtime stage copies `build/`, `node_modules`, and `package.json` and runs `node build/index.js`
- `docker-compose.yml`: new `bot-ui` service on :3002 with `env_file: .env`, `NODE_ENV=production`, `PORT=3002`, `HOST=0.0.0.0`, `DATA_DIR=/app/data`, mounts host `./data → /app/data`
- `.env.example`: documents `DATA_DIR` and `MY_COMPETITOR_ID` for the UI runtime
- verified: `docker compose build bot-ui` clean; `up -d` → HTTP 200 on `/` and `/settings`; no errors in container logs
- sprint-1 task list now 16/16
- commit: 43c5e7f

### 2026-05-14 — frontend — research-ui landed
- `ui/src/lib/components/ResearchList.svelte`: Spotify search box + results, candidate list with 1–5 rating buttons across themeFit/discoveryPotential/nostalgiaPotential/personalRating, notes textarea, save-for-future toggle, computed weighted score (uses shared `scoring.computeScore` against loader `settings`), Spotify/YT Music deep links, remove
- wired into the round page's research tab (replaces the stub in fe49efa); CRUD via `/api/research/[roundId]` with optimistic UI + rollback on failure
- svelte-check clean on new files (only pre-existing `vite.config.ts` error remains)
- commit: 53c8179

### 2026-05-14 — infra — scaffold landed
- SvelteKit project scaffolded under `ui/` (minimal template, TS, adapter-node, Tailwind v4, Vitest, better-sqlite3 + adm-zip)
- dev server smoke test passed (nav bar renders, Tailwind generating styles)
- commit: 25298f1

### 2026-05-14 — backend — types landed
- shared TypeScript interfaces
- commit: 04082c3

### 2026-05-14 — infra (as backend, parallel) — db-schema landed
- schema.ts + client.ts with WAL/FK, settings seeded
- vitest passing (2/2)
- commit: 58e43ef

### 2026-05-14 — backend — scoring landed
- weighted-mean formula + settings db
- vitest passing
- commit: 80c399f

### 2026-05-14 — infra (as backend, parallel) — ytm-api landed
- songlink wrapper + queue helpers + /api/ytm route with cache
- commit: eed97e1

### 2026-05-14 — frontend (as backend, parallel) — leagues-db landed
- league + season db layer with SEED bootstrap
- vitest passing (3/3)
- commit: 06e404d

### 2026-05-14 — infra (as backend, parallel) — queue-worker partial landed
- queueWorker.ts module + /api/ytm-queue route (hooks.server.ts wiring deferred)
- commit: a92fafe

### 2026-05-14 — frontend (as backend, parallel) — research-crud landed
- research_songs CRUD db layer
- commit: 14a1e63

### 2026-05-14 — backend — import landed
- zipParser, importer, startupScan + rounds/submissions/importLog db
- vitest passing (3/3, real fixture ZIPs)
- commit: d83f6e7

### 2026-05-14 — infra (as backend, final) — hooks-wiring landed
- hooks.server.ts: DB init + startup ZIP import + queue worker start
- commit: fb313d9

### 2026-05-14 — backend — research-api landed
- /api/research/[roundId] CRUD + /api/spotify/search
- commit: 920ad03

### 2026-05-14 — frontend — home landed
- submissionsDb adapter + home loader + home svelte page
- smoke test passed (HTTP 200, Active Now / All Songs Ever sections render)
- commit: 5377664

### 2026-05-14 — infra (as frontend, parallel) — season landed
- season detail page (loader + svelte): league/season lookup, rounds list with song + research counts
- svelte-check clean on new files
- commit: 3baf3a5

### 2026-05-14 — backend (as frontend, parallel) — settings-ui landed
- settings page: weights, import, deadlines, queue sections
- svelte-check clean for new files (1 pre-existing error in vite.config.ts)
- commit: f0d65c1

### 2026-05-14 — frontend — round landed
- round detail page with ML/chat tabs + YTM toggle; research tab stubbed
- 404 paths verified; populated render blocked on startupScan `.gitkeep` bug (separate)
- commit: fe49efa

### 2026-05-14 — backend — startupScan .gitkeep fix
- startupScan now filters readdir entries to actual directories via statSync and requires the `season-*` prefix; stray files like `.gitkeep` or `.DS_Store` at the league or season level no longer crash the scan with ENOTDIR
- new vitest covers a temp data dir containing a `.gitkeep` file plus a stray non-season subdir; full lib suite green (13/13)
- unblocks populated round-page renders from fe49efa
- commit: 32544a4
