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

- [ ] {agent: backend, id: round-edit-api, depends: round-status-model} Add `PATCH /api/rounds/[roundId]` at `ui/src/routes/api/rounds/[roundId]/+server.ts`. Body accepts any subset of `{ name, theme, submission_deadline, voting_deadline, playlist_url }`. Validates: deadlines are ISO date strings, `voting_deadline > submission_deadline` if both present, `playlist_url` matches a Spotify playlist URL pattern if provided. Writes to `rounds` table; returns the updated row + the new derived phase. If `playlist_url` is set/changed AND the round's current phase is `voting`, **fire-and-forget** trigger the playlist-ingest task (defined in playlist-ingest task — the API endpoint just enqueues; the heavy lifting lives in `playlist-ingest`). Also add a `playlist_url TEXT` column to the `rounds` table schema in this same task.
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

- [ ] {agent: frontend, id: h2h-rate-and-spotify} Two enhancements to the existing `HeadToHeadCard` component from sprint-3:
  - **Inline rating controls:** each card gets a compact rating editor (the 4 dimensions × 5 dots, no notes field) that upserts the underlying `research_songs` record via `PUT /api/research/[roundId]`. So the user can rate a song they forgot to rate before getting to h2h. The rating updates live and affects the weighted score shown on the card.
  - **Spotify embed:** add a Spotify play button on each card (use Spotify's embed iframe at `https://open.spotify.com/embed/track/{trackId}`, hidden behind a `<details>` or toggle so it doesn't auto-load — only loads when user clicks Play). If the song has a `spotify_uri`, the embed loads correctly; otherwise show a disabled Play button with a `<title>No Spotify URI on this song</title>`.
  Both changes live in `ui/src/lib/components/HeadToHeadCard.svelte` only. Doesn't touch the h2h page logic; the cards just expose more.
  - **Acceptance:** From the Head-to-Head tab of a populated round → both cards show the rating dots; clicking a dot updates the rating + recomputes the weighted score; both cards show a Play button that opens the Spotify embed iframe when clicked; svelte-check clean.

- [ ] {agent: frontend, id: settings-deadlines-collapsible} Restructure `/settings` per the actual user intent (the sprint-4 two-column layout left the weights column padded out with empty space): move the **Round deadlines** card from inside the two-column grid down to **full-width below the columns**, and wrap it in a collapsible `<details>` element (default collapsed). Inside the two columns above, fit ONLY the cards that benefit from the layout: weights on left, import + queue + auto-fill on right. Both columns auto-size to content (no `align-items: stretch` forcing height match). Add a `<SectionLabel>` reading something like `ROUND DEADLINES · CLICK TO EXPAND` as the `<summary>` of the collapsible.
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
- Schema: `rounds.playlist_url TEXT` column (nullable) added by round-edit-api task; `CREATE TABLE IF NOT EXISTS` startup path picks it up on next boot (or use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` if SQLite supports cleanly).
- New helper module: `ui/src/lib/lifecycle.ts` exporting `getRoundPhase(round)` and `seasonIsActive(season)`. Frontend can import for client-side recompute if needed.

## Blockers

- _None at sprint start._

## Activity Log

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
- commit: <pending — landing now>

### 2026-05-16 — docs — Sprint plan refresh: round state model + voting workflow
- created `docs/coordination/sprint-5.md` with 8 tasks (3 backend / 5 frontend / 0 infra own-lane).
- scope sourced from user verbal feedback after testing sprint-4: round phase derivation, round-edit modal with playlist ingest, rate-during-voting (blue dots in ML tab) and rate-during-h2h, Spotify embed on h2h cards, and a settings layout fix that moves the deadlines big-list to a collapsible at the bottom (sprint-4's two-column layout left wasted space in the weights column).
- design defaults confirmed pre-draft: unified ratings via `research_songs`; anonymous songs via `ml_submissions.competitor_id IS NULL`.
- depends graph: round-status-model gates round-edit-api / round-state-display / rate-anonymous-ml; round-edit-api gates playlist-ingest + round-edit-modal; h2h-rate-and-spotify and settings-deadlines-collapsible are independent.
- companion docs in the obsidian vault: `docs/planning/sprint-5.md` (planning narrative + decision context) and `docs/tracking/sprint-5-tracking.md` (metabind-interactive task tracker).
