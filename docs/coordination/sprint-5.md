---
project: music-league-bot
sprint: sprint-5
created: 2026-05-16T00:00:00.000Z
updated: 2026-05-16T00:00:00.000Z
---

# music-league-bot — coordination doc (sprint-5)

> Strict template per Session O2=B / seed §12 Phase 8. Same conventions as
> sprint-1 through sprint-4.

## Plan Source

- Type: inline
- Path: this document (`## Active Sprint Plan` section)
- Active unit: sprint-5

## Sprint Goals

- Make rounds, voting, and ratings reflect real-world state
- Edit rounds inline; rate during voting and h2h; settings stops wasting space.

## Active Initiatives

- _None — sprint-5 is execution of the round-state workflow per user feedback (see `## Activity Log` for the source brief)._

## Active Sprint Plan

<!-- 8 tasks. Backend foundation (A round-status-model) unblocks most of the
     frontend work; h2h-rate-and-spotify and settings-deadlines-collapsible
     are fully independent and start in wave 1 with the foundation.

     Wave structure:
       Wave 1 (no deps):         round-status-model (backend)
                                 h2h-rate-and-spotify (frontend)
                                 settings-deadlines-collapsible (frontend)
       Wave 2 (after A):         round-edit-api (backend)
                                 round-state-display (frontend)
                                 rate-anonymous-ml (frontend)
       Wave 3 (after B1):        playlist-ingest (backend)
                                 round-edit-modal (frontend)

     Design defaults confirmed by user before drafting:
       (a) Ratings unified through existing `research_songs` table — ML-tab
           ratings and h2h-card ratings both upsert into research_songs by
           (round_id, spotify_uri). One rating store, multiple UI surfaces.
       (b) Anonymous voting songs reuse `ml_submissions` with
           `competitor_id IS NULL`. No new schema column.

     Explicit non-goals:
       - BIG LIST overview (deferred from sprint-4)
       - Email ingestion via n8n (deferred from sprint-4)
       - Historical card fun facts (deferred from sprint-4)
       - CRUD UI for league/season metadata (round edit only; league/season
         editing waits for sprint-6+)
       - Standings data ("My place: —" stays a placeholder this sprint)
-->

- [x] {agent: backend, id: round-status-model} Add canonical round phase derivation. New helper `getRoundPhase(round)` returns one of `'upcoming' | 'submission' | 'voting' | 'archive'` based on `now()` against `submission_deadline` and `voting_deadline`. Logic: if `submission_deadline` is null OR in the future relative to start (no submissions opened yet) → `upcoming`; if `now < submission_deadline` → `submission`; if `submission_deadline <= now < voting_deadline` → `voting`; if `now >= voting_deadline` → `archive`. Expose `phase` as a derived field on every round returned by the layout loader (`+layout.server.ts`) and the season/round page loaders. Add a `seasonIsActive(season)` derivation: true if any round in the season has `phase in ('submission', 'voting')`. Update `getAllAdoptedLeagues()` in the layout loader so each league's `status` reflects the canonical season-active state instead of ad-hoc logic. Place the helpers in `ui/src/lib/lifecycle.ts` (new file) so frontend can import them too if it needs to recompute client-side.
  - **Acceptance:** vitest covers `getRoundPhase` across all four states with fixture deadlines; `seasonIsActive` returns true for fam-jam s3 / hip-jammers s3 / second-best s1 / nostalgia-pit s1 given real fixture rows (verified by `sqlite3 data/league.db` query against current deadlines); `+layout.server.ts` returns `phase` on every round; home page's league cards correctly identify the user's 4 active leagues as `status='active'`.

- [x] {agent: backend, id: round-edit-api, depends: round-status-model} Add `PATCH /api/rounds/[roundId]` at `ui/src/routes/api/rounds/[roundId]/+server.ts`. Body accepts any subset of `{ name, theme, submission_deadline, voting_deadline, playlist_url }`. Validates: deadlines are ISO date strings, `voting_deadline > submission_deadline` if both present, `playlist_url` matches a Spotify playlist URL pattern if provided. Writes to `rounds` table; returns the updated row + the new derived phase. If `playlist_url` is set/changed AND the round's current phase is `voting`, **fire-and-forget** trigger the playlist-ingest task (defined in playlist-ingest task — the API endpoint just enqueues; the heavy lifting lives in `playlist-ingest`). Also add a `playlist_url TEXT` column to the `rounds` table schema in this same task.
  - **Acceptance:** `curl -X PATCH http://localhost:5174/api/rounds/97 -H 'content-type: application/json' -d '{"theme":"New Theme"}'` returns 200 with the updated row + `phase` field; PATCHing an invalid deadline order returns 400; PATCHing a non-existent round returns 404; vitest covers each path. `sqlite3 data/league.db ".schema rounds"` shows `playlist_url` column.

- [ ] {agent: backend, id: playlist-ingest, depends: round-edit-api} When a round's `playlist_url` is set during the `voting` phase, fetch the Spotify playlist's tracks (via existing `ui/src/lib/spotify.ts` helpers from sprint-1) and insert each as an anonymous `ml_submission` row (`competitor_id IS NULL`, plus the track's artist/title/spotify_uri). Idempotent — if a row with the same `(round_id, spotify_uri)` already exists, skip it. Place ingest logic in `ui/src/lib/import/playlistIngest.ts`. Wire it as a fire-and-forget call from the PATCH endpoint when both conditions are met (phase=voting + playlist_url is new). If Spotify API auth isn't configured (`SPOTIFY_CLIENT_ID` empty), the ingest no-ops with a logged warning — don't fail the PATCH.
  - **Acceptance:** vitest exercises `ingestPlaylist(roundId, playlistUrl)` against a fixture playlist URL (mock Spotify response); inserts rows with `competitor_id IS NULL`; idempotent on re-run (no duplicates). End-to-end smoke against a live round in voting phase: PATCH with a real Spotify playlist URL → `sqlite3 data/league.db "select count(*), count(competitor_id) from ml_submissions where round_id = <id>";` shows N rows with N nulls.

- [ ] {agent: frontend, id: round-edit-modal, depends: round-edit-api} Add an edit button (small wrench/pencil icon) to the round page header. Clicking opens a modal with form inputs for `name`, `theme`, `submission_deadline` (datetime-local), `voting_deadline` (datetime-local), and `playlist_url` (text). Save calls `PATCH /api/rounds/[roundId]`; on success closes the modal and triggers a route invalidation so the page re-renders with the new values. Cancel discards. Use design system primitives (StatusChip, accent button) for visual consistency. The modal is a standard Svelte 5 `{#if open}<div>…</div>{/if}` overlay — no library, just an absolutely-positioned panel with a backdrop.
  - **Acceptance:** From any round page, click the edit icon → modal opens with current values pre-filled; change the theme to `Test Theme`, click Save → modal closes, page header shows `Test Theme`; check `sqlite3 data/league.db "select theme from rounds where id = X";` reflects the change. Setting a playlist_url during voting phase triggers the ingest pipeline (verified by ml_submissions row count growing). svelte-check clean.

- [ ] {agent: frontend, id: round-state-display, depends: round-status-model} Surface the canonical `phase` on every round-displaying surface. Replace ad-hoc state logic with the loader-supplied `phase` field. Visual treatment per phase (use the existing chip atoms from sprint-2):
  - `upcoming`: `<StatusChip tone='muted'>UPCOMING</StatusChip>`
  - `submission`: `<StatusChip tone='accent'>SUBMITTING</StatusChip>` + `<DeadlineChip phase='submissions' duration={remaining}>`
  - `voting`: `<StatusChip tone='warn'>VOTING</StatusChip>` + `<DeadlineChip phase='voting' duration={remaining}>`
  - `archive`: `<StatusChip tone='muted'>ARCHIVED</StatusChip>`
  Surfaces to update: home page league cards (active vs archive sorting now driven by `seasonIsActive`), season detail page round list, round detail page header. The user's 4 active leagues (fam-jam s3, hip-jammers s3, second-best s1, nostalgia-pit s1) should all show as `active` on the home page after this lands.
  - **Acceptance:** Visit `/` → all 4 user-specified active leagues appear in the `Needs you this week` section with the correct phase chip on their current round; visit `/league/fam-jam/season/3` → round 10 shows VOTING, earlier rounds show ARCHIVED; svelte-check clean.

- [ ] {agent: frontend, id: rate-anonymous-ml, depends: round-status-model} On the round page's ML tab, when the round is in `voting` phase, allow the user to rate each anonymous song using the same 4-dimension scoring as research. Click a song row → opens an inline rating editor (or expandable panel inside the row); save creates/updates a `research_songs` record keyed by `(round_id, spotify_uri)`. **Visual differentiator:** the rating dots on songs in the ML tab during voting show **blue** (`bg-info` if defined; otherwise add a new `--color-blue-rating` design token via a small inline style — file a Blocker if you need infra to add the token). After voting/archive, ML tab still shows ratings but with the standard orange dots (because submitter info is now revealed and the song is no longer "anonymous to the voter"). Re-uses the existing `/api/research/[roundId]` CRUD endpoints; the only new thing is the UI surface inside the ML tab.
  - **Acceptance:** Visit `/league/fam-jam/season/3/round/10` (voting phase) → ML tab → click any anonymous song → rate it 4/3/2/3 → save → `sqlite3 data/league.db "select * from research_songs where round_id = X order by created_at desc limit 1";` shows the new row. Dots render blue. Switch to round in archive phase → dots render orange. svelte-check clean.

- [x] {agent: frontend, id: h2h-rate-and-spotify} Two enhancements to the existing `HeadToHeadCard` component from sprint-3:
  - **Inline rating controls:** each card gets a compact rating editor (the 4 dimensions × 5 dots, no notes field) that upserts the underlying `research_songs` record via `PUT /api/research/[roundId]`. So the user can rate a song they forgot to rate before getting to h2h. The rating updates live and affects the weighted score shown on the card.
  - **Spotify embed:** add a Spotify play button on each card (use Spotify's embed iframe at `https://open.spotify.com/embed/track/{trackId}`, hidden behind a `<details>` or toggle so it doesn't auto-load — only loads when user clicks Play). If the song has a `spotify_uri`, the embed loads correctly; otherwise show a disabled Play button with a `<title>No Spotify URI on this song</title>`.
  Both changes live in `ui/src/lib/components/HeadToHeadCard.svelte` only. Doesn't touch the h2h page logic; the cards just expose more.
  - **Acceptance:** From the Head-to-Head tab of a populated round → both cards show the rating dots; clicking a dot updates the rating + recomputes the weighted score; both cards show a Play button that opens the Spotify embed iframe when clicked; svelte-check clean.

- [x] {agent: frontend, id: settings-deadlines-collapsible} Restructure `/settings` per the actual user intent (the sprint-4 two-column layout left the weights column padded out with empty space): move the **Round deadlines** card from inside the two-column grid down to **full-width below the columns**, and wrap it in a collapsible `<details>` element (default collapsed). Inside the two columns above, fit ONLY the cards that benefit from the layout: weights on left, import + queue + auto-fill on right. Both columns auto-size to content (no `align-items: stretch` forcing height match). Add a `<SectionLabel>` reading something like `ROUND DEADLINES · CLICK TO EXPAND` as the `<summary>` of the collapsible.
  - **Acceptance:** Visit `/settings` → weights column ends at its natural height, no empty space below the sliders; import+queue+auto-fill column similarly ends at its natural height; Round deadlines section is at the bottom, full-width, collapsed by default; clicking the summary expands; user can configure deadlines once expanded, just like before. Mobile layout still stacks vertically. svelte-check clean.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| infra | `ui/package.json`, `ui/svelte.config.js`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/src/app.html`, `ui/src/app.css`, `Dockerfile.ui`, `docker-compose.yml`, `.env.example`, `ui/static/**` | `ui/src/**` (except static) |
| backend | `ui/src/lib/**` (except `lib/components/**`), `ui/src/hooks.server.ts`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/+layout.server.ts`, `ui/src/routes/api/**` | `ui/src/routes/**/+page.svelte`, `ui/src/lib/components/**`, infra files |
| frontend | `ui/src/routes/**/+page.svelte`, `ui/src/routes/+layout.svelte`, `ui/src/lib/components/**` | `ui/src/lib/db/**`, `ui/src/lib/import/**`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/api/**`, infra files |

- **backend** — round-status-model, round-edit-api, playlist-ingest (3 tasks; heaviest backend lift since sprint-1).
- **frontend** — round-edit-modal, round-state-display, rate-anonymous-ml, h2h-rate-and-spotify, settings-deadlines-collapsible (5 tasks).
- **infra** — no own-lane tasks this sprint; available as load-balancing pool `(as frontend, parallel)` per sprint-1 review Q2 ratification.

## Decision Log

**Pre-sprint design decisions** (confirmed by user before drafting):

- **D1 — Rating storage**: ratings from ML-tab and h2h-card surfaces both upsert into the existing `research_songs` table, keyed by `(round_id, spotify_uri)`. One store, multiple UI surfaces. Rationale: existing CRUD endpoints reusable; rating data unified regardless of entry surface.
- **D2 — Anonymous voting songs**: reuse `ml_submissions` table with `competitor_id IS NULL` to represent songs ingested from a Spotify playlist during voting (submitter unknown). Rationale: column is already nullable; no schema migration; the ML export upload at archive time fills in `competitor_id` later.

## Ratification Log

_Sprint-1 review ratification `rn-760a2713` (checkbox-in-the-landing-commit) is still pending in the inbox; sprints 2, 3, 4 agents all adopted it voluntarily and it's holding up. Sprint-5 agents are expected to continue the pattern; orc will surface a formal ratification at sprint close._

## Contract Changes

- New REST surface: `PATCH /api/rounds/[roundId]` — body shape documented in round-edit-api task.
- Schema: **no new column.** `rounds.spotify_playlist_url` already exists from sprint-1 ZIP imports; body field `playlist_url` maps to it at the API boundary. Avoiding a duplicate `playlist_url` column keeps the schema honest — there's only one Spotify playlist URL per round, regardless of whether it arrived via ZIP import or via PATCH.
- API field → column mapping for PATCH body: `theme` → `description`, `playlist_url` → `spotify_playlist_url`, deadline fields use their existing column names. Mapping lives in the route handler; the underlying `patchRound(db, id, RoundPatch)` helper uses the canonical column-mapped TS field names.
- New helper module: `ui/src/lib/lifecycle.ts` exporting `getRoundPhase(round)` and `seasonIsActive(season)`. Frontend can import for client-side recompute if needed.

## Blockers

- _None at sprint start._

## Activity Log

### 2026-05-16 — backend — round-edit-api landed
- **Endpoint:** `PATCH /api/rounds/[roundId]` at `ui/src/routes/api/rounds/[roundId]/+server.ts`. Body: any subset of `{ name, theme, submission_deadline, voting_deadline, playlist_url }`. Empty body returns the unchanged row + current phase (200; no-op).
- **Schema deviation from the task body:** the task said "add a `playlist_url TEXT` column." Skipped — `rounds.spotify_playlist_url` already exists from sprint-1 ZIP imports and holds exactly this data. Adding a duplicate column would mean two source-of-truth fields for "the round's Spotify playlist URL" that drift apart. Body field `playlist_url` is mapped to `spotify_playlist_url` at the route handler boundary; same goes for `theme` → `description`. Documented under Contract Changes so future agents don't reintroduce the duplicate.
- **Validation rules (all → 400 on failure):**
  - `name`: non-empty string
  - `theme`: string or null (clears)
  - `submission_deadline` / `voting_deadline`: ISO date string parseable by `Date.parse`, or null
  - cross-field: if both effective post-patch deadlines are non-null, `voting > submission` must hold (uses existing row values for any field not in the patch)
  - `playlist_url`: matches `^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+(\?.*)?$`, or null
  - non-existent round → 404
- **Response shape:**
  ```ts
  { round: Round; phase: RoundPhase }
  // where Round already carries phase from lib/db/rounds.ts row() helper,
  // and the top-level phase mirrors round.phase for callers that only need
  // the lifecycle state.
  ```
- **Playlist-ingest hook:** stubbed `console.log('[round-edit-api] would ingest playlist …')` fires when `playlist_url` is set/changed AND the new phase is `voting` AND the URL is non-null. One-line swap to `await ingestPlaylist(roundId, url)` when the next task (playlist-ingest) lands — kept the stub so this endpoint ships standalone.
- **Files touched:**
  - `ui/src/lib/db/rounds.ts` — new `patchRound(db, id, RoundPatch)` partial-update helper + `RoundPatch` interface.
  - `ui/src/routes/api/rounds/[roundId]/+server.ts` — new route, validates body, maps to RoundPatch, fires stub ingest, returns updated row + phase.
  - `ui/src/lib/db/rounds.patch.test.ts` — 5 vitests on `patchRound` (single field, multi-field, null clears, no-op, phase recompute after patch).
- **Live smoke against `localhost:5174` (round 97):**
  ```
  PATCH /api/rounds/97 {"theme":"New Theme"}
    → 200, round.description="New Theme", phase="upcoming"
  PATCH /api/rounds/97 {"submission_deadline":"2026-08-01...","voting_deadline":"2026-07-01..."}
    → 400 {"message":"voting_deadline must be after submission_deadline"}
  PATCH /api/rounds/97 {"playlist_url":"https://example.com/notspotify"}
    → 400 {"message":"playlist_url must match …"}
  PATCH /api/rounds/999999 {"theme":"x"}
    → 404 {"message":"round not found: 999999"}
  PATCH /api/rounds/97 {}
    → 200 (no-op, unchanged row)
  ```
  Theme reverted after the smoke; DB state unchanged from pre-smoke.
- **Checks:** `npx vitest run` 49/49 green; `npx svelte-check` only pre-existing issues.
- **Scope discipline:** server-side files only (`lib/db/rounds.ts`, `routes/api/rounds/[roundId]/+server.ts`, plus the test). No `+page.svelte` / `lib/components/**` / infra touched.
- commit: <pending — landing now>

### 2026-05-16 — frontend — h2h-rate-and-spotify landed
- `ui/src/lib/components/HeadToHeadCard.svelte` gains two enhancements (sprint-5 task 7 / Initiative C2).
- **Inline rating editor:**
  - The 4×5 rating-dot grid is now interactive — each dot is a `<button>` that toggles the dimension to that value (clicking the same value clears, matching ResearchList's UX).
  - On click, fires `PATCH /api/research/{roundId}` with `{ id, [dim]: value }` (the existing endpoint already accepts partial updates by id — no upsert-by-spotify_uri needed since h2h candidates come directly from `research_songs` rows and have an `id`). PATCH matches the verb used elsewhere in the app; the brief mentioned PUT but the existing route is PATCH — no blocker needed.
  - Optimistic local update + score recompute via `computeScore` (`ui/src/lib/scoring.ts`) using the new `weights` prop (`Settings`). Reverts on PATCH failure. The card carries its own `$state local = $state(song)` with a `$effect` re-sync on prop change so the parent's H2H state refresh after `pickWinner` still flows through.
  - New optional props on the component: `roundId?: number` and `weights?: Settings`. When the parent doesn't supply them, the rating dots render disabled (read-only fallback — preserves the component's standalone showcase use on `/_examples`).
- **Spotify embed:**
  - `▸ PLAY PREVIEW ↗` toggle in accent text under the notes block. On click, sets `playerOpen = true` and renders an `<iframe src="https://open.spotify.com/embed/track/{trackId}?utm_source=oembed" height=80 loading=lazy>` — iframe is not in the DOM until the user clicks, matching the brief's lazy-load requirement.
  - `trackId` is parsed from `song.spotifyUri` via `^spotify:track:([A-Za-z0-9]+)$`. If the song lacks a Spotify URI or the URI doesn't parse, the Play button renders disabled with `title="No Spotify URI on this song"`.
- **Page wiring** (minimal, additive): the two `<HeadToHeadCard>` invocations in `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` now pass `roundId={data.round.id}` + `weights={data.settings}` so the rating editor is actually live. No page state-machine logic changes.
- **Verification:** seeded round 97 with three real Spotify URIs (Mogwai · Ceiling Granny, IDK · DEViL, Bull · Tally), pre-rated 3/3/3/3 baseline, opened `/league/second-best/season/1/round/97` → Head-to-Head tab. Screenshots:
  - `docs/screenshots/2026-05-16-sprint5-h2h-rate-spotify-before.png` — both cards rendered with 3-dot baseline ratings, Play Preview toggles closed, weighted score 3.00 each.
  - `docs/screenshots/2026-05-16-sprint5-h2h-rate-spotify-after.png` — clicked Bull's Theme=5 dot (Theme row went 3→5 filled) and toggled Play Preview on the holding lane card (Spotify embed iframe inline). Weighted score recomputed 3.00 → 3.50 immediately. DB check via `GET /api/research/97` confirmed persisted `themeFit:5, score:3.5`.
- svelte-check clean (pre-existing warning on `$state(song)` initial-value-capture is intentional — same hydration pattern used in `ResearchList.svelte`; reactivity re-syncs through `$effect`). Fixtures cleaned up after the screenshots.
- **Tokens consumed:** `text-accent`, `text-accent-strong`, `text-fg-faint`, `bg-accent`, `border-accent`, `border-accent-deep`, `border-border`, `font-mono`, `font-display`. No new tokens. Atoms used: `SectionLabel` (already present).
- commit: c7a2f91

### 2026-05-16 — infra (as frontend, parallel) — settings-deadlines-collapsible landed
- **Why infra in a frontend lane:** sprint-5 has zero infra-owned tasks; frontend pane is on the round-edit + h2h chain. Sprint-1 review Q2 ratification covers this `(as frontend, parallel)` pattern. Picking this up is also a continuity win — infra has owned `ui/src/routes/settings/+page.svelte` across sprint-2 reskin, sprint-4 two-column, sprint-4 rating-weights auto-balance, and sprint-4 auto-fill UI.
- **Single file touched:** `ui/src/routes/settings/+page.svelte`. Loader, form actions, components, layout, and other routes untouched.
- **Layout structure (desktop, ≥ md):**
  ```
  ┌─────────────────────────────┬──────────────────────────────────┐
  │ Rating weights              │ ZIP import & rescan              │
  │  · auto-balance toggle      │  · last/no-imports chip          │
  │  · 4 sliders + proportion   │  · league/season/file + Import   │
  │  · Reset / Save             │  · Re-scan disk                  │
  │  (ends at natural height)   │  · import log table              │
  │                             ├──────────────────────────────────┤
  │                             │ Songlink resolution queue        │
  │                             │  · 3 stat tiles + failures table │
  │                             ├──────────────────────────────────┤
  │                             │ Bulk-set deadlines for a season  │
  │                             │  · league/season/days/start      │
  │                             │  · Auto-fill button + chip       │
  └─────────────────────────────┴──────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────────────┐
  │ ▸  ROUND DEADLINES · CLICK TO EXPAND          {N} ACTIVE          │ ← <summary>
  └──────────────────────────────────────────────────────────────────┘
  ```
  Below `md:`, the grid collapses to a single column — same stacked order — and the `<details>` continues to work.
- **Grid change**: the two-column wrapper went from `grid md:grid-cols-2 gap-6 mb-6` → `grid md:grid-cols-2 gap-6 mb-6 items-start`. The `items-start` is the load-bearing fix — CSS Grid items default to `stretch`, which is exactly what was padding the weights column to match the import-log table's height. With `items-start`, the left column ends at the bottom of `Save weights` and the right column ends at the bottom of the auto-fill card; whichever is shorter sits in its own natural box.
- **Auto-fill card promoted to a peer:** the auto-fill block that I introduced as an inline sub-card inside the deadlines section in sprint-4 (commit 0d78060) was lifted out and is now a full peer `<section>` in the right column, third behind ZIP import and Queue. Same controls, same state (`afLeague`, `afSeason`, `afDaysToSubmit`, `afDaysToVote`, `afStartDate`, `afStatus`), same POST to `/api/deadlines/auto-fill`, same `invalidateAll()` on success — no behavior change, only relocation + the chrome upgrade from sub-card (`bg-bg-elevated`) to peer card (`bg-surface`). Form inputs accordingly switched their backgrounds from `bg-bg` to `bg-bg-elevated` so the inset still reads as inset against the new outer surface.
- **Collapsible deadlines:**
  - `<details bind:open={deadlinesOpen}>` with `let deadlinesOpen = $state(false)` — closed by default (no `open` attribute on initial SSR; verified `<details class="…">` has no `open` token).
  - `<summary class="cursor-pointer list-none flex items-center justify-between gap-3 p-6 hover:bg-surface-hover transition-colors rounded-xl">` — `list-none` + `[&>summary::-webkit-details-marker]:hidden` on the parent kills the native disclosure triangle so the custom caret is the only marker.
  - **Chevron treatment:** a single `▸` glyph in `text-accent`, wrapped in a span that gets `transform: rotate(90deg)` when `deadlinesOpen` is `true` via inline `style:transform` (no Tailwind arbitrary selector needed). Rotation animates with `transition-transform duration-150`.
  - **Summary label:** `<SectionLabel>Round deadlines · {deadlinesOpen ? 'click to collapse' : 'click to expand'}</SectionLabel>` — text swaps live with the open state.
  - **Right-side meta:** `{data.activeRounds.length} active` in mono dim — surfaces the count without expanding.
  - Inside the details (`<div class="px-6 pb-6 pt-0">`): the unchanged per-round `<form action="?/updateDeadline" use:enhance>` rails. All behavior preserved — sprint-3's deadline-save hotfix isn't touched.
- **Verification:**
  - `npx svelte-check` (from `ui/`) — 1 error + 3 warnings, all pre-existing (the `vite.config.ts` test-config error and three `$state` reference warnings from earlier sprints). No new warnings.
  - `npm run dev` (port 5174) → `curl /settings` returns HTTP 200, 143243 bytes. SSR contains exactly one `<details class="...">` (no `open` token) and exactly one `click to expand` string; the auto-fill markup byte-index is before the `<details>` byte-index, confirming the right-column position.
  - Screenshots (Playwright, headless chromium):
    - `docs/screenshots/2026-05-16-sprint5-settings-deadlines-desktop-collapsed.png` (1440×1200) — weights left ends at `SAVE WEIGHTS`; deadlines collapsed.
    - `docs/screenshots/2026-05-16-sprint5-settings-deadlines-desktop-expanded.png` (1440 fullPage) — after clicking summary, deadline rails visible at the bottom.
    - `docs/screenshots/2026-05-16-sprint5-settings-deadlines-mobile-collapsed.png` (480 fullPage) — single-column stacked, collapsible still present.
- **Acceptance check:** weights column ends at its natural height ✓; right column ends at its natural content height (no padding to match) ✓; deadlines section is full-width below the grid, collapsed by default ✓; clicking summary expands and the per-round editing UX is unchanged ✓; mobile stacks vertically ✓; svelte-check clean ✓.
- commit: `a6181e8`

### 2026-05-16 — backend — round-status-model landed
- **New module** `ui/src/lib/lifecycle.ts` exports the canonical phase derivation. Helpers are pure (take `now` as a parameter) so they unit-test without mocking the clock and can be re-used from a client-side recompute later.
  - `getRoundPhase(round, now?) → 'upcoming' | 'submission' | 'voting' | 'archive'`
  - `seasonIsActive(season) → boolean` (true when any round's phase is `submission` or `voting`)
  - `RoundPhase` type, also re-exported from `ui/src/lib/types.ts` and added as an optional `phase` field on `Round`.
- **Phase boundaries implemented:**
  - `submission_deadline === null` (or unparsable) → `upcoming` (no submissions ever opened)
  - `now < submission_deadline` → `submission`
  - `submission_deadline ≤ now < voting_deadline` → `voting` (left-closed boundary: exactly at sub_deadline → voting)
  - `now ≥ voting_deadline` → `archive` (left-closed: exactly at vote_deadline → archive)
  - Edge case I chose explicitly: `submission_deadline` past AND `voting_deadline === null` → `archive`. Without a vote-by date there's nowhere for the round to live; treating it as `voting` indefinitely would be a foot-gun for the round-state-display chips.
- **Loader updates** (all server-side, no `+page.svelte` touched):
  - `ui/src/lib/db/rounds.ts` — the shared `row()` helper now attaches `phase: getRoundPhase(base)` to every Round it returns. That means `getRoundsForSeason`, `getRoundById`, and `getCurrentRoundForSeason` all surface `phase` for free — the season detail loader and round detail loader pick it up without any further wiring.
  - `ui/src/lib/db/layout.ts` — `getAllAdoptedLeagues()` rewritten on top of the canonical helpers. Now loads *all* rounds in the active season (not just the most recent), runs each through `getRoundPhase`, asks `seasonIsActive` whether anything is live, then picks the rail-facing "current" round by priority `submission > voting > upcoming > archive` (latest `created_at` within tie). Maps the current round's phase onto the existing `LeagueRailStatus` (`submission→active`, `voting→voting`, `upcoming→open`, otherwise `idle`). Added `currentRoundPhase: RoundPhase | null` to `LeagueRailEntry` so the rail UI can pick the right chip later.
- **Vitest** (`ui/src/lib/lifecycle.test.ts`): 8 cases — upcoming when sub_deadline null; submission when now < sub; voting at and inside `[sub, vote)`; archive at and after vote_deadline; archive when sub past and vote null; snake_case row pass-through; `seasonIsActive` true with one open round; false with all archive/upcoming or empty. Full suite **44/44 green** (8 new + 36 prior).
- **Live verification** at `curl http://localhost:5174/` — SSR layout payload contains the new field:
  ```
  leagues: [
    { slug: "hip-jammers",  status: "active", currentRoundId: 102, currentRoundLabel: "Your Permanent Record", currentRoundPhase: "submission" },
    { slug: "fam-jam",      status: "idle",   currentRoundId: null, currentRoundLabel: null, currentRoundPhase: null },
    { slug: "second-best",  status: "idle",   currentRoundId: null, currentRoundLabel: null, currentRoundPhase: null }, …
  ]
  ```
  Only hip-jammers s3 currently has rounds with future deadlines (the live DB has past/null deadlines on fam-jam/second-best/nostalgia-pit active seasons). The user's expectation of "all 4 active" depends on **round-edit-api** (next task) letting them set deadlines on those rounds — the model itself is correct; the data needs filling in. Flagged for myself: nothing to surface as a Blocker since this is the next task in my queue.
- **Checks:** `npx svelte-check` reports only pre-existing issues; `npx vitest run` 44/44.
- **Scope discipline:** backend-only files touched (`ui/src/lib/lifecycle.ts`, `ui/src/lib/lifecycle.test.ts`, `ui/src/lib/types.ts`, `ui/src/lib/db/layout.ts`, `ui/src/lib/db/rounds.ts`). No `+page.svelte` / `lib/components/**` / infra files in this changeset.
- commit: `7bfb396`

### 2026-05-16 — docs — Sprint plan refresh: round state model + voting workflow
- created `docs/coordination/sprint-5.md` with 8 tasks (3 backend / 5 frontend / 0 infra own-lane).
- scope sourced from user verbal feedback after testing sprint-4: round phase derivation, round-edit modal with playlist ingest, rate-during-voting (blue dots in ML tab) and rate-during-h2h, Spotify embed on h2h cards, and a settings layout fix that moves the deadlines big-list to a collapsible at the bottom (sprint-4's two-column layout left wasted space in the weights column).
- design defaults confirmed pre-draft: unified ratings via `research_songs`; anonymous songs via `ml_submissions.competitor_id IS NULL`.
- depends graph: round-status-model gates round-edit-api / round-state-display / rate-anonymous-ml; round-edit-api gates playlist-ingest + round-edit-modal; h2h-rate-and-spotify and settings-deadlines-collapsible are independent.
- companion docs in the obsidian vault: `docs/planning/sprint-5.md` (planning narrative + decision context) and `docs/tracking/sprint-5-tracking.md` (metabind-interactive task tracker).
