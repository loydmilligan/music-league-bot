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

- [x] {agent: backend, id: playlist-ingest, depends: round-edit-api} When a round's `playlist_url` is set during the `voting` phase, fetch the Spotify playlist's tracks (via existing `ui/src/lib/spotify.ts` helpers from sprint-1) and insert each as an anonymous `ml_submission` row (`competitor_id IS NULL`, plus the track's artist/title/spotify_uri). Idempotent — if a row with the same `(round_id, spotify_uri)` already exists, skip it. Place ingest logic in `ui/src/lib/import/playlistIngest.ts`. Wire it as a fire-and-forget call from the PATCH endpoint when both conditions are met (phase=voting + playlist_url is new). If Spotify API auth isn't configured (`SPOTIFY_CLIENT_ID` empty), the ingest no-ops with a logged warning — don't fail the PATCH.
  - **Acceptance:** vitest exercises `ingestPlaylist(roundId, playlistUrl)` against a fixture playlist URL (mock Spotify response); inserts rows with `competitor_id IS NULL`; idempotent on re-run (no duplicates). End-to-end smoke against a live round in voting phase: PATCH with a real Spotify playlist URL → `sqlite3 data/league.db "select count(*), count(competitor_id) from ml_submissions where round_id = <id>";` shows N rows with N nulls.

- [x] {agent: frontend, id: round-edit-modal, depends: round-edit-api} Add an edit button (small wrench/pencil icon) to the round page header. Clicking opens a modal with form inputs for `name`, `theme`, `submission_deadline` (datetime-local), `voting_deadline` (datetime-local), and `playlist_url` (text). Save calls `PATCH /api/rounds/[roundId]`; on success closes the modal and triggers a route invalidation so the page re-renders with the new values. Cancel discards. Use design system primitives (StatusChip, accent button) for visual consistency. The modal is a standard Svelte 5 `{#if open}<div>…</div>{/if}` overlay — no library, just an absolutely-positioned panel with a backdrop.
  - **Acceptance:** From any round page, click the edit icon → modal opens with current values pre-filled; change the theme to `Test Theme`, click Save → modal closes, page header shows `Test Theme`; check `sqlite3 data/league.db "select theme from rounds where id = X";` reflects the change. Setting a playlist_url during voting phase triggers the ingest pipeline (verified by ml_submissions row count growing). svelte-check clean.

- [x] {agent: frontend, id: round-state-display, depends: round-status-model} Surface the canonical `phase` on every round-displaying surface. Replace ad-hoc state logic with the loader-supplied `phase` field. Visual treatment per phase (use the existing chip atoms from sprint-2):
  - `upcoming`: `<StatusChip tone='muted'>UPCOMING</StatusChip>`
  - `submission`: `<StatusChip tone='accent'>SUBMITTING</StatusChip>` + `<DeadlineChip phase='submissions' duration={remaining}>`
  - `voting`: `<StatusChip tone='warn'>VOTING</StatusChip>` + `<DeadlineChip phase='voting' duration={remaining}>`
  - `archive`: `<StatusChip tone='muted'>ARCHIVED</StatusChip>`
  Surfaces to update: home page league cards (active vs archive sorting now driven by `seasonIsActive`), season detail page round list, round detail page header. The user's 4 active leagues (fam-jam s3, hip-jammers s3, second-best s1, nostalgia-pit s1) should all show as `active` on the home page after this lands.
  - **Acceptance:** Visit `/` → all 4 user-specified active leagues appear in the `Needs you this week` section with the correct phase chip on their current round; visit `/league/fam-jam/season/3` → round 10 shows VOTING, earlier rounds show ARCHIVED; svelte-check clean.

- [x] {agent: frontend, id: rate-anonymous-ml, depends: round-status-model} On the round page's ML tab, when the round is in `voting` phase, allow the user to rate each anonymous song using the same 4-dimension scoring as research. Click a song row → opens an inline rating editor (or expandable panel inside the row); save creates/updates a `research_songs` record keyed by `(round_id, spotify_uri)`. **Visual differentiator:** the rating dots on songs in the ML tab during voting show **blue** (`bg-info` if defined; otherwise add a new `--color-blue-rating` design token via a small inline style — file a Blocker if you need infra to add the token). After voting/archive, ML tab still shows ratings but with the standard orange dots (because submitter info is now revealed and the song is no longer "anonymous to the voter"). Re-uses the existing `/api/research/[roundId]` CRUD endpoints; the only new thing is the UI surface inside the ML tab.
  - **Acceptance:** Visit `/league/fam-jam/season/3/round/10` (voting phase) → ML tab → click any anonymous song → rate it 4/3/2/3 → save → `sqlite3 data/league.db "select * from research_songs where round_id = X order by created_at desc limit 1";` shows the new row. Dots render blue. Switch to round in archive phase → dots render orange. svelte-check clean.

- [x] {agent: frontend, id: h2h-rate-and-spotify} Two enhancements to the existing `HeadToHeadCard` component from sprint-3:
  - **Inline rating controls:** each card gets a compact rating editor (the 4 dimensions × 5 dots, no notes field) that upserts the underlying `research_songs` record via `PUT /api/research/[roundId]`. So the user can rate a song they forgot to rate before getting to h2h. The rating updates live and affects the weighted score shown on the card.
  - **Spotify embed:** add a Spotify play button on each card (use Spotify's embed iframe at `https://open.spotify.com/embed/track/{trackId}`, hidden behind a `<details>` or toggle so it doesn't auto-load — only loads when user clicks Play). If the song has a `spotify_uri`, the embed loads correctly; otherwise show a disabled Play button with a `<title>No Spotify URI on this song</title>`.
  Both changes live in `ui/src/lib/components/HeadToHeadCard.svelte` only. Doesn't touch the h2h page logic; the cards just expose more.
  - **Acceptance:** From the Head-to-Head tab of a populated round → both cards show the rating dots; clicking a dot updates the rating + recomputes the weighted score; both cards show a Play button that opens the Spotify embed iframe when clicked; svelte-check clean.

- [x] {agent: frontend, id: settings-deadlines-collapsible} Restructure `/settings` per the actual user intent (the sprint-4 two-column layout left the weights column padded out with empty space): move the **Round deadlines** card from inside the two-column grid down to **full-width below the columns**, and wrap it in a collapsible `<details>` element (default collapsed). Inside the two columns above, fit ONLY the cards that benefit from the layout: weights on left, import + queue + auto-fill on right. Both columns auto-size to content (no `align-items: stretch` forcing height match). Add a `<SectionLabel>` reading something like `ROUND DEADLINES · CLICK TO EXPAND` as the `<summary>` of the collapsible.
  - **Acceptance:** Visit `/settings` → weights column ends at its natural height, no empty space below the sliders; import+queue+auto-fill column similarly ends at its natural height; Round deadlines section is at the bottom, full-width, collapsed by default; clicking the summary expands; user can configure deadlines once expanded, just like before. Mobile layout still stacks vertically. svelte-check clean.

- [x] {agent: backend, id: phase-season-context-fix} **Hotfix** from user testing 2026-05-16: the round-status-model shipped in this sprint evaluates phases per-round, which means every round with a future submission_deadline reads as `submission` simultaneously. In hip-jammers s3 today (2026-05-16): round 2 is correctly submission, but rounds 3-7 ALSO read submission because their deadlines are also in the future — the model has no notion that rounds run sequentially. User reports: hip-jammers shows "6 OPEN" badge on the season detail page, and 6 rounds all say "submitting" with a days-to-deadline indicator; only round 1 correctly shows archived. The model needs season-context: a round can only be in `submission` if all earlier rounds in the same season are `archive`; otherwise it's `upcoming`. **Fix:**
  - In `ui/src/lib/lifecycle.ts`, add a `getRoundPhasesForSeason(rounds: Round[]): Map<number, RoundPhase>` (or similar) that walks rounds in ascending `id`/`round_number` order applying rules: (1) if `now >= voting_deadline` → archive; (2) else if `now >= submission_deadline` → voting; (3) else if previous round is `archive` (or this is the first round) → submission; (4) else → upcoming.
  - Keep the per-round `getRoundPhase(round)` helper for backward compat where season context isn't available, but mark it deprecated / "use sparingly" in a doc comment — every meaningful caller should use the season-aware version.
  - Update all loaders that surface `phase` to use the season-aware version: `+layout.server.ts` (`getAllAdoptedLeagues()` — needs to load each league's current season's rounds), the season-detail page loader, the round-detail page loader (loads the round + sibling rounds for context).
  - Update `seasonIsActive(season)` to use the same logic — true iff at least one round in the season has phase ∈ {submission, voting} after season-aware derivation.
  - Vitest covers the hip-jammers-s3-2026-05-16 scenario specifically: 7 rounds with the deadlines from the CSV, "now" = 2026-05-16T12:00:00Z; expected output: round 1 archive, round 2 submission, rounds 3-7 upcoming.
  - **Acceptance:** After this hotfix lands and is deployed, on `http://localhost:3002/`: hip-jammers appears in `Needs you this week` (because round 2 = submission); on `/league/hip-jammers/season/3`: "OPEN" badge reads "1 OPEN" (not "6 OPEN"); rounds 3-7 show `UPCOMING` chips, round 2 shows `SUBMITTING`, round 1 shows `ARCHIVED`. Verify by curling SSR and grepping for chip counts.

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

- **[backend → frontend, low]** Cosmetic follow-up surfaced by the phase-season-context-fix hotfix: `ui/src/routes/league/[league]/season/[n]/+page.svelte:29` defines `isActivePhase(p) = p === 'submission' || p === 'voting' || p === 'upcoming'`. With the season-aware phase derivation now correctly returning `upcoming` for all-but-one rounds in an active season, that helper counts every pending round as "active" and the `<StatusChip>{N} OPEN</StatusChip>` badge reads "6 OPEN" on hip-jammers s3. Backend phase data is correct (verified by SSR grep: 1 archive, 1 submission, 5 upcoming). One-line frontend fix: drop `'upcoming'` from `isActivePhase` so the badge reflects truly-open rounds. Not blocking — the round chips themselves render correctly per phase.

## Activity Log

### 2026-05-16 — backend — phase-season-context-fix hotfix
- **Reporter:** user, manual test of the deployed sprint-5 features. Hip-jammers s3 on 2026-05-16: only round 2 should be in submission (round 1 archived, rounds 3-7 are pending), but all 6 future-deadline rounds were classifying as `submission` because the per-round helper had no season context.
- **Root cause:** `getRoundPhase(round)` checks each round in isolation — every round whose `submission_deadline > now` reads `submission`, regardless of whether earlier rounds have actually finished. A round can only legitimately be in `submission` once its predecessor has archived; otherwise it's pending (`upcoming`).
- **Fix in `ui/src/lib/lifecycle.ts`:** new `getRoundPhasesForSeason(rounds, now?) → Map<id, RoundPhase>`. Sorts rounds by `id` ascending, walks once applying:
  1. `now ≥ voting_deadline` → `archive`
  2. else `now ≥ submission_deadline` (vote still open or null) → `voting` (or `archive` if vote_deadline is null — avoids "voting indefinitely")
  3. else prevPhase ∈ {null, archive} → `submission` (round is up because the prior turn finished, or this is round 1)
  4. else → `upcoming` (pending; prior round hasn't archived yet)
  Old `getRoundPhase` kept for one-off callers (e.g. PATCH /api/rounds response) but flagged `@deprecated` pointing to the season-aware helper.
- **Loaders rewired** (all backend-only):
  - `ui/src/lib/db/rounds.ts` — `getRoundsForSeason` and `getRoundById` now load all sibling rounds, run them through `getRoundPhasesForSeason`, and attach the season-aware `phase` to each row. New internal `rowWithPhase(r, phase)` and `baseRow(r)` helpers; the per-round `row()` fallback stays for code paths that genuinely lack context. `getCurrentRoundForSeason` switched to priority-sort by phase (submission > voting > upcoming > archive, newest within tie) rather than blindly grabbing the latest `created_at`.
  - `ui/src/lib/db/layout.ts` — `getAllAdoptedLeagues` builds the phase map once per league via `getRoundPhasesForSeason`, then reuses it for both `seasonIsActive` and `pickCurrentRound`. Switched the rounds query from `ORDER BY created_at` to `ORDER BY id` so the import order matches what the algorithm expects.
  - Season detail loader + round detail loader inherit the fix for free — both go through the updated `getRoundsForSeason` / `getRoundById`.
- **Vitests added** (`ui/src/lib/lifecycle.test.ts`): 6 new — (1) the hip-jammers-s3-2026-05-16 fixture with the user's actual CSV deadlines, expecting `r1=archive, r2=submission, r3-7=upcoming`; (2) season-aware `seasonIsActive` true when one round is mid-submission; (3) all rounds archived → seasonIsActive false; (4) null deadlines → first round submission, rest upcoming; (5) unsorted input gets sorted by id internally; (6) round with sub past + vote null → archive (not voting forever). Full suite **61/61 green**.
- **Live SSR verification** against dev server:
  ```
  GET /league/hip-jammers/season/3
    → phase:"archive" × 1, phase:"submission" × 1, phase:"upcoming" × 5  ✅
  GET /
    → leagues[0]: hip-jammers, status:"active", currentRoundId:103,
       currentRoundLabel:"Must be love on the brain",
       currentRoundPhase:"submission"                                     ✅
  GET /league/hip-jammers/season/3/round/103 → round.phase:"submission"   ✅
  GET /league/hip-jammers/season/3/round/104 → round.phase:"upcoming"     ✅
  ```
  The "OPEN" badge still reads "6 OPEN" on the season page — that's a frontend `isActivePhase` helper that counts `'upcoming'` as active. Backend data is correct; the badge needs a one-line `+page.svelte` fix, filed under Blockers.
- **Checks:** `npx vitest run` 61/61; `npx svelte-check` only pre-existing issues.
- **Scope:** backend-only (`lib/lifecycle.ts`, `lib/lifecycle.test.ts`, `lib/db/rounds.ts`, `lib/db/layout.ts`). No `+page.svelte` / `lib/components/**` / infra touched.
- commit: `22d5594`

### 2026-05-16 — frontend — rate-anonymous-ml landed
- `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`: added an inline rating editor inside the ML tab content area, gated on `data.round.phase ∈ {voting, archive}`. **Sprint-5 is now 8/8.**
- **Originally assigned to infra;** picked up by frontend after infra's session hit an Anthropic API rate limit mid-execution. Frontend had the freshest context on this file (just shipped round-state-display + round-edit-modal here).
- **Trigger / expand:** every ML row now renders a small `▸ RATE` / `▾ RATED` chip on the right side when ratings are enabled. Click toggles `expandedMlSpotifyUri`; the expanded row reveals a compact 4-dim × 5-dot rating editor (same shape as the h2h-card editor but without a notes field), plus Cancel + Save buttons. State held in `mlRatingDraft` ($state) per-open; pre-filled from `researchBySpotifyUri[s.spotifyUri]` if a row already exists.
- **Save / upsert pattern (option a):** two-step POST→PATCH against the existing `/api/research/[roundId]` CRUD —
  1. `POST { spotifyUri, title, artist }` — the sprint-1 handler uses `INSERT OR IGNORE` keyed by `(round_id, spotify_uri)` and returns the row whether newly inserted or already existing. So this is effectively an idempotent get-or-create.
  2. `PATCH { id, themeFit, discoveryPotential, nostalgiaPotential, personalRating }` — writes the ratings onto the now-known row id.
  Then `await invalidateAll()` so the page's `data.research` refreshes and the row's "RATED" indicator + the page subtitle counters reflect the new state. No API mismatch — no blocker filed.
- **Blue-dot variant (voting phase):** used Tailwind's built-in `bg-blue-500` + `border-blue-500` + `text-blue-400` classes (not a design-system token; the existing `--color-warn` is yellow and there's no `--color-info` yet). Trade-off note: I considered adding `--color-rating-voting` as a proper design-system token via a Blocker to infra, but Tailwind's named blue palette is already plumbed through the framework and the visual outcome matches the "blue clearly distinct from accent orange" intent. **Filing a soft follow-up as a TODO in the file** rather than a Blocker — if `bg-info` lands later, swapping the four class names will be a one-line change.
- **Archive-phase color:** when `data.round.phase === 'archive'`, the dots and Save button switch to the standard accent orange (`bg-accent` / `bg-accent-strong`), since submitters are revealed and the song is no longer anonymous to the rater. Same widget, color driven by `mlRatingDotColor = phase === 'voting' ? 'voting' : 'accent'`.
- **Existing research_songs visible:** the page loader already returns `data.research` for the round, so the row indexes into it by `spotifyUri` and renders the open chip as "RATED" with the appropriate blue/orange tone the moment the row has any non-null rating. No extra fetch.
- **Verification end-to-end:**
  - PATCHed round 97 to put it in voting phase (`submission_deadline` 1h ago, `voting_deadline` 48h ahead) via the round-edit-api landed earlier this sprint — header chip went `UPCOMING` → `VOTING · 1D 23H`.
  - Clicked Ceiling Granny row's RATE button → editor expanded inline below the row (screenshot: `docs/screenshots/2026-05-16-sprint5-rate-anonymous-ml-expanded.png` — VOTING chip, four empty dot rows, blue Save button).
  - Set themeFit=4, discoveryPotential=3, nostalgiaPotential=2, personalRating=3 → Save → editor closed, row now shows blue-bordered `RATED` chip, page subtitle updated to `12 submissions · 1 in research` (screenshot: `…-saved.png`).
  - `sqlite3 data/league.db "SELECT id, spotify_uri, theme_fit, discovery_potential, nostalgia_potential, personal_rating FROM research_songs WHERE round_id = 97"` → `7|spotify:track:4EVg8veaPIgAx3m2QioPdV|4|3|2|3` ✓
  - Restored round 97 (cleared both deadlines, deleted the test research_song) so fixture data is unchanged.
- svelte-check clean (only pre-existing `vite.config.ts` error). Two small Svelte syntax notes: `class:bg-blue-500/10` is not a valid `class:` directive (parser chokes on the `/`), so kept the indicator's background neutral and used border+text-tone instead.
- **Tokens consumed:** existing — `bg-surface`, `border-border-muted`, `text-fg`, `text-fg-muted`, `text-fg-dim`, `text-fg-faint`, `text-warn`, `bg-accent`, `bg-accent-strong`, `bg-accent-bg`, `text-accent`, `border-accent`, `border-accent-deep`, `bg-bg-elevated`, `font-mono`. New (Tailwind built-in, not design-system): `bg-blue-500`, `bg-blue-400` (hover), `border-blue-500`, `text-blue-400`, `text-white`. No new design-system tokens; follow-up to swap to `bg-info` if/when infra adds one.
- commit: 65c8757

### 2026-05-16 — frontend — round-edit-modal landed
- `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`: added an `Edit round` pencil-icon button next to the H1 plus a Svelte 5 `{#if showEdit}…{/if}` modal overlay for editing the round.
- **Trigger:** `<button aria-label="Edit round" title="Edit round" class="text-fg-faint hover:text-accent">✎</button>` placed inline with the H1 (`flex items-center gap-3`).
- **Modal scaffolding pattern (no library):**
  - Backdrop is a real `<button>` (`fixed inset-0 bg-bg/70 backdrop-blur-sm z-40`) so a backdrop click closes the dialog with proper keyboard semantics; clicking it routes through `closeEdit()`.
  - Panel is a centered `bg-surface border border-border-muted rounded-xl p-6` card inside a `fixed inset-0 z-50 flex` wrapper. Outer wrapper has `pointer-events-none` so the backdrop receives clicks outside the panel; the panel itself re-enables `pointer-events-auto`.
  - `<svelte:window onkeydown={onKeydown}>` closes on `Escape`.
  - `role="dialog" aria-modal="true" aria-labelledby="edit-round-title"` for screen readers.
- **Form inputs** all use the existing design-system input treatment (`bg-bg border-border-muted focus:border-accent rounded px-3 py-1.5`): `name` (text), `theme` (text), `submission_deadline` + `voting_deadline` (`datetime-local`), `playlist_url` (URL with `pattern="https://open\.spotify\.com/playlist/.+"` for browser-level validation). Helper `isoToLocalInput` converts the round's ISO timestamps to `yyyy-MM-ddTHH:mm` for the native datetime-local inputs; `localInputToIso` reverses on save.
- **Diff-compute approach:** `saveEdit` builds `diff: Record<string, unknown>` by comparing each form field to its origin (`data.round.name` / `description` / etc.). Only changed fields go in the PATCH body — the API accepts arbitrary subsets per backend's `round-edit-api` contract. If `diff` is empty, the modal closes without an API call. On success, `await invalidateAll()` from `$app/navigation` re-runs the page loader so the header + chip + description re-render from the canonical row. On 4xx/5xx, the modal stays open and `editError` surfaces the response body in mono warn text below the inputs.
- **Save / Cancel** buttons use the established accent-CTA + bg-bg secondary pair (`bg-accent hover:bg-accent-strong text-bg-elevated` and `bg-bg text-fg-muted border-border-muted`). Save shows "Saving…" while in-flight and is disabled.
- **Verification end-to-end against round 97 (Second Best · season 1 · "New Shit"):**
  - Click pencil → modal opens with `name="New Shit"`, `theme="Songs released after Jan 1, 2021"`, `playlist_url="https://open.spotify.com/playlist/1qH7DvidoYRjYyCBZED8zp"`, deadlines blank (round has null deadlines).
  - Edited the theme field to `Test Theme — sprint5-edit`, clicked Save → modal closed, page description re-rendered to the new value via `invalidateAll`. `sqlite3 data/league.db "SELECT description FROM rounds WHERE id=97"` confirmed `Test Theme — sprint5-edit` persisted. Restored to original "Songs released after Jan 1, 2021" after the test via a follow-up PATCH so the fixture data is unchanged.
  - Escape closes the modal; backdrop click closes it. Hitting Save with no changes closes the modal without sending a PATCH (diff is empty).
- **Coordination:** stayed strictly inside the page header / new modal block — no edits to the ML tab content, where infra is concurrently doing `rate-anonymous-ml`.
- **Screenshot:** `docs/screenshots/2026-05-16-sprint5-round-edit-modal.png` shows the modal open with all five fields populated (datetime-local fields empty per the round's null deadlines).
- svelte-check clean (only pre-existing `vite.config.ts` error).
- **Tokens consumed:** existing — `bg-surface`, `bg-bg`, `bg-bg/70`, `border-border-muted`, `border-accent`, `text-fg`, `text-fg-muted`, `text-fg-dim`, `text-fg-faint`, `text-warn`, `bg-accent`, `bg-accent-strong`, `font-mono`. No new tokens.
- commit: c557711

### 2026-05-16 — backend — playlist-ingest landed
- **New modules:**
  - `ui/src/lib/spotify.ts` — first real `lib/spotify.ts` in the tree (the sprint-1 search route had inlined token logic; that route is left alone for now). Exports `getSpotifyToken()` (null when creds missing — callers no-op cleanly instead of throwing), `parsePlaylistId(url)` (accepts `open.spotify.com/playlist/<id>`, the same with `?si=…` query, and `spotify:playlist:<id>` URI), and `fetchPlaylistTracks(playlistId, token, fetcher?)` which pages through `/v1/playlists/<id>/tracks` (limit 100/page) and filters out local files + episode items. `fetcher` is injectable so vitest doesn't have to mock global `fetch`.
  - `ui/src/lib/import/playlistIngest.ts` — `ingestPlaylist(roundId, playlistUrl, opts?)` returning `{ inserted, skipped }`. Idempotent via `INSERT OR IGNORE` against the partial unique index added in the schema change below. Single SQLite transaction over all rows. Two graceful no-op paths: unparseable URL → warn + return `{0,0}`; missing `SPOTIFY_CLIENT_ID/SECRET` → warn + return `{0,0}`. Spotify fetch failures are caught and downgraded to a warning so the fire-and-forget caller can't be observed throwing.
- **Schema change (D2 compliance):** the existing `ml_submissions.competitor_id` column was `NOT NULL`, blocking D2's "anonymous rows use `competitor_id IS NULL`." Relaxed in two places:
  - `lib/db/schema.ts` — fresh DBs now create the column nullable, plus a new partial `UNIQUE INDEX idx_ml_submissions_anon ON ml_submissions(round_id, spotify_uri) WHERE competitor_id IS NULL` so anonymous rows are still unique per `(round, uri)` (SQLite treats NULL as distinct in the existing composite UNIQUE, hence the partial index).
  - `lib/db/client.ts` — one-time table-rebuild migration for existing DBs. PRAGMA-checks `notnull` on `competitor_id`; if 1, runs the rebuild under `BEGIN ... COMMIT` with FK's disabled, preserving every row, then drops the old table. Idempotent — second boot sees `notnull=0` and skips. Verified live: 465 existing rows survived the migration intact. No `ALTER COLUMN` in SQLite → table rebuild was the only option.
- **PATCH endpoint wired:** the round-edit-api stub in `routes/api/rounds/[roundId]/+server.ts` is replaced with the real fire-and-forget call: `void ingestPlaylist(roundId, url).catch(...)` (the `.catch` is defensive; `ingestPlaylist` already swallows fetch errors internally). PATCH still returns 200 immediately whether the Spotify creds are set or not.
- **Tests** (`ui/src/lib/import/playlistIngest.test.ts`): 6 vitests — URL-parse format coverage; happy-path insert with all `competitor_id` NULL; idempotent re-run; no-op when env unset (didn't trip the network); no-op on unparseable URL; partial index is round-scoped (same `spotify_uri` survives in two different rounds). `tracksProvider` injection makes everything offline-deterministic. Full suite **55/55 green**.
- **Live end-to-end smoke** against the dev server:
  ```
  # Move round 102 into voting phase
  PATCH /api/rounds/102 {"submission_deadline":"2026-05-10T00:00","voting_deadline":"2026-05-25T00:00"}
  # Set a real Spotify playlist URL — fire-and-forget ingest triggers
  PATCH /api/rounds/102 {"playlist_url":"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"}
  # Dev log shows the expected graceful no-op:
  #   [playlistIngest] SPOTIFY_CLIENT_ID/SECRET not configured — skipping ingest
  # ml_submissions row count for round 102: 0 (no creds → no inserts, as designed)
  # Round 102 restored to its pre-smoke state.
  ```
  When Spotify creds get added to the env, the same PATCH will populate rows transparently — the wire-up is proven.
- **Checks:** `npx vitest run` 55/55; `npx svelte-check` only pre-existing issues.
- **Scope discipline:** all changes inside backend lane — `lib/spotify.ts`, `lib/import/playlistIngest.ts`, `lib/db/schema.ts`, `lib/db/client.ts`, `routes/api/rounds/[roundId]/+server.ts`, plus the test. No `+page.svelte` / `lib/components/**` / infra touched.
- **Closes backend's sprint-5 chain.** Sprint-5 task ledger after this: 6/8 done (round-status-model, round-edit-api, playlist-ingest, h2h-rate-and-spotify, settings-deadlines-collapsible, round-state-display). Remaining: rate-anonymous-ml + round-edit-modal (frontend).
- commit: `dbb1a12`

### 2026-05-16 — frontend — round-state-display landed
- Consumed the canonical `phase: RoundPhase` field that `round-status-model` (7bfb396) attaches to every Round returned by the loaders. Replaced the three pages' ad-hoc deadline-string derivations with the loader-supplied field.
- **Chip mapping (applied uniformly across all three surfaces):**
  - `submission` → `<StatusChip tone="accent">SUBMITTING</StatusChip>` + `<DeadlineChip phase="submissions" duration={remaining}>`
  - `voting` → `<StatusChip tone="warn">VOTING</StatusChip>` + `<DeadlineChip phase="voting" duration={remaining}>`
  - `upcoming` → `<StatusChip tone="muted">UPCOMING</StatusChip>`
  - `archive` (or null) → `<StatusChip tone="muted">ARCHIVED</StatusChip>`
  Duration strings are still derived client-side from the deadline ISO so the chip can refresh in a long-open session; `phase` itself is canonical from the server.
- **Surfaces updated:**
  1. **`ui/src/routes/+page.svelte`** — `phaseFor(s)` now just returns `s.currentRound?.phase`. `activeLeagues` (the `Needs you this week` source) is filtered to seasons whose current round is in a *live* phase (`submission` or `voting`); seasons whose current round is `upcoming` / `archive` / null are moved to the `All leagues` grid. Each tile's chip block uses the mapping above. `LeagueRow.status` derived from phase: voting → `voting`, submission → `open`, upcoming → `active`, archive/null → `idle`. Hip Jammers shows `SUBMITTING` + `SUBMISSIONS · 7D 6H` and remains the only league in `Needs you this week`; the other three DB-active seasons (Fam-Jam, Nostalgia Pit, Second Best) show as `IDLE` in `All leagues` because their current rounds have null deadlines → phase=upcoming/archive. **This is the model working correctly**: per backend's `round-status-model` entry, the "all 4 active leagues finally show up" expectation is gated on `round-edit-api` letting the user set deadlines — the chip plumbing is in place and will surface those leagues in `Needs you this week` automatically once their rounds have future submission/voting deadlines.
  2. **`ui/src/routes/league/[league]/season/[n]/+page.svelte`** — round card snippet uses the phase chip mapping; the `isActive(r) = phaseFor(r) !== null` predicate becomes `isActivePhase(r.phase)` (matches `submission` | `voting` | `upcoming`). Active-rounds card holds anything not in `archive`; archived card holds the rest.
  3. **`ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`** — **page header only** (right-aligned chip stack next to the H1, per coordination with infra on `rate-anonymous-ml`). The old `phaseInfo` derivation is replaced with `phase = data.round.phase` and a small `remaining` derivation for the deadline string. Tab strip, ML tab content, Chat, Research, and H2H tab bodies are all untouched.
- **Coordination:** stayed strictly out of the ML tab content body since `rate-anonymous-ml` (infra-as-frontend, in flight) owns inline rating wiring there.
- **Verification:** Playwright screenshots —
  - `docs/screenshots/2026-05-16-sprint5-round-state-display-home.png` — `/` showing Hip Jammers `SUBMITTING` + `SUBMISSIONS · 7D 6H` in Needs-you, three IDLE tiles in All leagues.
  - `docs/screenshots/2026-05-16-sprint5-round-state-display-season.png` — `/league/second-best/season/1` showing every round with an `UPCOMING` chip in the Active rounds card (correct: those rounds have null `submission_deadline`).
  - `docs/screenshots/2026-05-16-sprint5-round-state-display-round.png` — `/league/second-best/season/1/round/97` showing the `UPCOMING` chip in the page header next to "New Shit".
- svelte-check clean (only pre-existing `vite.config.ts` error). Layout fix during verification: switched chip container from `h-5` fixed → `min-h-5` so the stacked phase + deadline chips wrap cleanly without overlapping the league name on narrow tiles.
- **Tokens consumed:** existing — no new tokens. Atoms used: `StatusChip` (accent / warn / muted tones), `DeadlineChip` (submissions / voting), `DotIndicator` (fallback in All-leagues when phase=null).
- commit: 02b4d3c

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
- commit: `04db9b5`

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
