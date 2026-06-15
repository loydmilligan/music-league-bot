---
project: music-league-bot
sprint: sprint-5-round-state-model
created: 2026-05-16T00:00:00Z
updated: 2026-05-16T00:00:00Z
status: planning
ratified: ""
closed: ""
shipped_tasks: 0
deferred_tasks: 0
tags:
  - music-league-bot
  - sprint
  - planning
  - round-state
  - voting-workflow
related:
  - "[[sprint-5-tracking]]"
  - "[[../tests/sprint 2-3-results]]"
parent:
  - music-league-bot
---

# music-league-bot — coordination doc (sprint-5-round-state-model)

> Cross-surface sprint. **Backend** owns the round phase model + edit API +
> Spotify playlist ingest. **Frontend** owns the round-edit modal, state
> display across home/season/round pages, rating-during-voting (ML tab) +
> rating-from-h2h, and the settings layout fix. **Infra** has no own-lane
> tasks but stays available as a load-balancing pool `(as frontend, parallel)`
> per the sprint-1 review Q2 ratification.
>
> **Why this sprint:** sprint-2 + sprint-4 delivered the dashboard skin and
> polish; sprint-3 delivered head-to-head picking. With those in place,
> manual testing surfaced that the app doesn't actually model the
> real-world lifecycle of a Music League round. The user is in four
> currently-active leagues (fam-jam s3 round 10 voting, hip-jammers s3
> round 2 submission, second-best s1 round 3 submission, nostalgia-pit s1
> round 2 submission); none of them surface as "active" because the home
> loader has no canonical sense of round phase. Editing rounds (themes,
> deadlines, playlist links) is impossible. Rating songs during voting is
> impossible (the rating UI only lives on the Research tab; ML tab is
> read-only). Forgetting to rate a song before it hits the h2h picker
> traps the song with no rating. The sprint-4 settings two-column layout
> half-solved the "scroll a million miles" problem because the big
> deadlines table was inside the grid stretching the weights column
> uselessly tall. All of this is in scope.
>
> **Scope:** round lifecycle modeling + edit surface + rating expansions +
> settings layout fix. **Out of scope:** standings data, BIG LIST overview,
> email ingestion, historical fun facts, league/season metadata editing
> (round metadata only). These were captured in sprint-4's `## Deferred to
> sprint-5+` section and stay deferred to sprint-6+.
>
> Strict template per Session O2=B / seed §12 Phase 8.

## Plan Source

- Type: inline
- Path: this document (`## Active Sprint Plan` section)
- Active unit: sprint-5-round-state-model
- Methodology: planning=inline, testing=none, review=none
- Companion: [[sprint-5-tracking]] for per-task checklists + status

## Sprint Goals

- Make rounds, voting, and ratings reflect real-world state.
  Edit rounds inline; rate during voting and from h2h; settings stops wasting space.

## Active Initiatives

- _Superseded by `## Active Sprint Plan` while `methodology.planning: inline` is active. See [[sprint-5-tracking]] for the per-initiative dashboard view._

## Active Sprint Plan

<!-- 8 tasks. Backend foundation (round-status-model) gates most frontend
     work; h2h-rate-and-spotify and settings-deadlines-collapsible are
     fully independent and run in wave 1 alongside the foundation.

     Wave structure:
       Wave 1 (no deps):       A round-status-model (backend)
                               C2 h2h-rate-and-spotify (frontend)
                               D1 settings-deadlines-collapsible (frontend)
       Wave 2 (after A):       B1 round-edit-api (backend)
                               B4 round-state-display (frontend)
                               C1 rate-anonymous-ml (frontend)
       Wave 3 (after B1):      B2 playlist-ingest (backend)
                               B3 round-edit-modal (frontend)

     Agent distribution (planned):
       - backend (own lane): A, B1, B2 — 3 tasks
       - frontend (own lane): B3, B4, C1, C2 OR D1 — 4-5 tasks
       - infra (as frontend, parallel): pick up 1 of D1 / C2 to balance

     Design defaults confirmed by user before drafting (logged in Decision
     Log below):
       D1. Ratings unified through `research_songs` (one rating store,
           multiple UI surfaces).
       D2. Anonymous voting songs reuse `ml_submissions.competitor_id IS NULL`
           (no new schema column).

     Mid-sprint decisions anticipated (default proposals shipped against
     unless user surfaces otherwise — same pattern as sprints 2/3/4):
       M-A. Round-edit modal trigger placement — wrench icon in round
            header vs context-menu vs always-visible Edit button?
            Default: pencil/wrench icon at the right of the round H1.
       M-B. Playlist-ingest error surfacing — silent log + warning chip
            on the round page vs blocking modal vs orc-tower decision card?
            Default: warning chip on the round page next sprint pass.
       M-C. Rate-anonymous-ml UI: inline expandable row vs side-panel
            overlay vs modal? Default: inline expandable below the song
            row, matches the Research tab's ResearchList editor pattern.

     Explicit non-goals (deferred to sprint-6+):
       - BIG LIST overview (unified Spotify playlist of every song
         participated on). Big feature; sprint-6 or later.
       - Email ingestion via n8n for live submit/vote counts. Needs n8n
         integration setup work first.
       - Manual submit/vote entry path (Music League doesn't notify users
         about their own actions). Depends on broader tracking schema.
       - Historical card fun facts (genre breakdown, biggest procrastinator,
         etc.). Needs new aggregation queries.
       - CRUD UI for league + season metadata (round metadata only this
         sprint via round-edit-modal).
       - Standings data ("My place: —" placeholder ships this sprint).
-->

- [ ] {agent: backend, id: round-status-model} **A. Round status model** — derive canonical phase from deadlines (`upcoming` / `submission` / `voting` / `archive`). `getRoundPhase(round)` helper in new `ui/src/lib/lifecycle.ts`. Compute `seasonIsActive(season)` from any current-phase round. Update layout loader so league cards correctly identify the 4 user-confirmed active leagues. Vitest covers the four phase boundaries.
  - **Acceptance:** see [[sprint-5-tracking#A round-status-model]]; also coord-doc canonical at `docs/coordination/sprint-5.md`.

- [ ] {agent: backend, id: round-edit-api, depends: round-status-model} **B1. Round edit API** — `PATCH /api/rounds/[roundId]` accepting partial `{name, theme, submission_deadline, voting_deadline, playlist_url}`. Adds `playlist_url TEXT` column. Validation: ISO dates, deadline ordering, Spotify URL pattern. Returns updated row + derived phase. Fire-and-forget triggers playlist-ingest when phase=voting and playlist_url is set.
  - **Acceptance:** see [[sprint-5-tracking#B1 round-edit-api]].

- [ ] {agent: backend, id: playlist-ingest, depends: round-edit-api} **B2. Playlist ingest** — `ingestPlaylist(roundId, playlistUrl)` in `ui/src/lib/import/playlistIngest.ts`. Fetches tracks via existing `spotify.ts`, inserts as `ml_submissions` with `competitor_id IS NULL`. Idempotent on `(round_id, spotify_uri)`. No-ops gracefully if SPOTIFY_CLIENT_ID is unset.
  - **Acceptance:** see [[sprint-5-tracking#B2 playlist-ingest]].

- [ ] {agent: frontend, id: round-edit-modal, depends: round-edit-api} **B3. Round edit modal** — wrench/pencil icon in round page header opens a modal with name/theme/deadlines/playlist_url inputs. Save → PATCH → invalidateAll. Standard Svelte 5 overlay; no library. Modal closes on success; route data refreshes.
  - **Acceptance:** see [[sprint-5-tracking#B3 round-edit-modal]].

- [ ] {agent: frontend, id: round-state-display, depends: round-status-model} **B4. Round state display** — replace ad-hoc round state logic everywhere with loader-supplied `phase`. Visual chips: UPCOMING (muted), SUBMITTING (accent), VOTING (warn), ARCHIVED (muted). Surfaces: home league cards, season detail rounds list, round detail header. User's 4 active leagues land in `Needs you this week` after this.
  - **Acceptance:** see [[sprint-5-tracking#B4 round-state-display]].

- [ ] {agent: frontend, id: rate-anonymous-ml, depends: round-status-model} **C1. Anonymous ML rating** — during voting phase, ML tab songs are rateable via the 4-dimension scoring system. Click expands an inline rating editor under the song row; saves upsert `research_songs` keyed by `(round_id, spotify_uri)`. **Blue dots** (not orange) visually mark voting-phase ratings. After archive, dots revert to orange.
  - **Acceptance:** see [[sprint-5-tracking#C1 rate-anonymous-ml]].

- [ ] {agent: frontend, id: h2h-rate-and-spotify} **C2. H2H rate + Spotify embed** — inline rating controls on each `HeadToHeadCard` (4×5 dots, upserts research_songs); Spotify play button with lazy-loading `iframe` to `open.spotify.com/embed/track/{trackId}`. Only touches the card component.
  - **Acceptance:** see [[sprint-5-tracking#C2 h2h-rate-and-spotify]].

- [ ] {agent: frontend, id: settings-deadlines-collapsible} **D1. Settings deadlines collapsible** — move the Round deadlines big-list out of the sprint-4 two-column grid and down to a full-width `<details>` collapsed by default. Two columns above auto-size to natural content height (no wasted space below weights column). User's real intent.
  - **Acceptance:** see [[sprint-5-tracking#D1 settings-deadlines-collapsible]].

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| infra | `ui/package.json`, `ui/svelte.config.js`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/src/app.html`, `ui/src/app.css`, `Dockerfile.ui`, `docker-compose.yml`, `.env.example`, `ui/static/**` | `ui/src/**` (except static) |
| backend | `ui/src/lib/**` (except `lib/components/**`), `ui/src/hooks.server.ts`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/+layout.server.ts`, `ui/src/routes/api/**` | `ui/src/routes/**/+page.svelte`, `ui/src/lib/components/**`, infra files |
| frontend | `ui/src/routes/**/+page.svelte`, `ui/src/routes/+layout.svelte`, `ui/src/lib/components/**` | `ui/src/lib/db/**`, `ui/src/lib/import/**`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/api/**`, infra files |

## Decision Log

**Pre-sprint design decisions** (confirmed by user before drafting, ratified at sprint plan acceptance):

### D1 — Rating storage: UNIFIED VIA `research_songs`
- Implementation: ML-tab voting ratings and h2h-card ratings both upsert into the existing `research_songs` table, keyed by `(round_id, spotify_uri)`.
- Rationale: existing CRUD endpoints reusable; rating data unified regardless of entry surface; the user gets one place where all their judgments live.
- Alternative considered: separate rating columns on `ml_submissions` for ML ratings. Rejected as splitting the rating concept across two tables.

### D2 — Anonymous voting songs: REUSE `ml_submissions.competitor_id IS NULL`
- Implementation: when a Spotify playlist URL is added during voting phase, ingest pulls tracks and inserts as `ml_submissions` rows with `competitor_id IS NULL`. The ML export upload at archive time later fills in `competitor_id` once submitter info is known.
- Rationale: column is already nullable in the schema; no migration; the data model maps cleanly to the real-world flow (anonymous-during-voting → submitter-revealed-at-archive).
- Alternative considered: add an `is_anonymous` boolean column. Rejected as redundant — null competitor_id is the canonical "we don't know yet" signal.

**Mid-sprint decisions anticipated** — see the `<!-- comment block -->` in the Active Sprint Plan section above for M-A through M-C with default proposals. Agents ship against defaults unless surfaced as `mcp__orc-tower-protocol__emit_decision_request` cards.

## Ratification Log

_Sprint-1 review ratification `rn-760a2713` (checkbox-in-the-landing-commit) is still pending in the inbox; sprints 2, 3, 4 agents all adopted it voluntarily and it's holding up. Sprint-5 agents are expected to continue the pattern; orc will surface a formal ratification at sprint close._

## Contract Changes

<!-- Additive REST surface (does not change existing routes):
       PATCH  /api/rounds/[roundId]
     Schema change (additive, picked up via CREATE TABLE IF NOT EXISTS or
     ALTER TABLE ADD COLUMN on next boot):
       rounds.playlist_url TEXT (nullable)
     New helper module:
       ui/src/lib/lifecycle.ts — exports getRoundPhase(round), seasonIsActive(season)
-->

## Blockers

<!-- None at sprint start. -->

## Activity Log

### 2026-05-16 — docs — Sprint plan refresh: round state model + voting workflow

- created `docs/coordination/sprint-5.md` (canonical orc-tower coord-doc, parsed by warren), this `docs/planning/sprint-5.md` (obsidian-style narrative mirror), and `docs/tracking/sprint-5-tracking.md` (metabind-interactive task tracker)
- 8 tasks: 3 backend (round-status-model, round-edit-api, playlist-ingest) / 5 frontend (round-edit-modal, round-state-display, rate-anonymous-ml, h2h-rate-and-spotify, settings-deadlines-collapsible) / 0 infra own-lane
- scope sourced from user verbal feedback after sprint-4 deploy testing: round phase derivation, round-edit modal with playlist ingest, rate-during-voting (blue dots in ML tab), rate-from-h2h cards, Spotify embed on h2h cards, settings layout fix (deadlines big-list collapsible at bottom)
- design defaults pre-confirmed: unified ratings via `research_songs`; anonymous songs via `ml_submissions.competitor_id IS NULL`
- depends graph: round-status-model gates round-edit-api, round-state-display, rate-anonymous-ml; round-edit-api gates playlist-ingest + round-edit-modal; h2h-rate-and-spotify and settings-deadlines-collapsible are independent (wave 1 starters)
- agent load: heaviest backend lift since sprint-1 (3 tasks); 5 frontend tasks again so infra picks up `(as frontend, parallel)` for load balancing
