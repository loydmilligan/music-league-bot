---
project: music-league-bot
sprint: sprint-25
title: League/Season/Round/Player Model Foundation
status: active
created: 2026-06-11T22:56:09Z
activated: 2026-06-11
updated: 2026-06-11T23:04:00Z
---

# music-league-bot — coordination doc (sprint-25)

> **The foundation sprint.** Makes the app's knowledge of leagues, seasons, rounds, and players accurate and explicit. Fixes three live symptoms (digest "Next Round Up" wrong round/deadlines, shortlist H2H locked to one league, second league stuck at 6 rounds), builds the league → season → player-assignment model with per-player chat identity, ships the setup/management UI, and lands the full FK + history migration onto stable player IDs. Research basis: `docs/coordination/planning-league-model.md`. Roadmap card: `active-league-management` (planned, large).

## Sprint Goals

- Make leagues, rounds, and players first-class and accurate
  Right next round everywhere; both leagues usable; stable player identity.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | DB schema + migrations, importer/season lifecycle, `$lib/db/*` services, `/api/*` routes | Svelte components, page routes, digest UI |
| frontend | Svelte components + routes: setup/management screens, shortlist UI, digest section controls | DB schema, importer, API route internals |
| orc | wave-gate ceremonies: cross-checks, ratification cards, prod deploy, context resets | project code (orc manages; project agents work) |

## Gate & Context-Reset Protocol (sprint-25 discipline)

This is a long sprint, run deliberately in four waves with a hard gate after
each. Owner direction (2026-06-11): keep agent context as short as possible
while making sure agents have everything they need on reset — frequent clears
+ good handoffs are what keep long-session hallucinations down.

At each `gate-N` task, in order:

1. **Agent handoffs.** Each agent writes a wave handoff entry at the top of
   `## Activity Log`: what landed (files + behavior), decisions made,
   anything surprising, and exactly what a fresh session needs to know to
   continue. Write it for your own replacement.
2. **Cross-check.** Each agent verifies the *other* lane's acceptance lines
   for the wave (run the commands, click the UI) and notes pass/fail in its
   handoff entry. An agent-level ratification of the wave.
3. **Version + changelog.** Bump the UI version (synced to package.json) and
   update CHANGELOG.md with all wave changes — visible and under-the-hood.
4. **Ratification card.** Orc emits one `ratification-needed` card per gate
   summarizing the wave (what shipped, cross-check results, deploy intent).
   The user ratifies in the warren. **No wave-N+1 prompts are sent until the
   card resolves `ratified`.**
5. **Deploy.** One orc-gated cached prod deploy → http://192.168.4.217:3002,
   then a browser smoke pass (mobile 412×892, console clean) on the wave's
   surfaces.
6. **Context reset.** Orc clears BOTH agent panes (`/clear`), then sends each
   a re-orientation prompt: read this coord-doc (roster row, protocol, the
   wave's tasks, latest handoff entries) — nothing else. Agents resume from
   the doc, not from session memory.

Mid-wave, if an agent's context passes ~60–70%, it should proactively write a
handoff entry and request a reset from orc rather than pushing on.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

### Wave 1 — symptom fixes

- [ ] {agent: backend, id: season-status} **Fix the season-status heuristic.** The importer overwrites season status on every re-import (`upsertSeason` ON CONFLICT + the `rounds.length > 0 && votes.length > 0` heuristic in `ui/src/lib/import/importer.ts`) — root cause of the second league stuck at 6 rounds. A season is `complete` only when all its rounds have votes AND no open/future rounds exist; re-import must never demote an `active` season the user has touched. Add a manual-override path (DB + `$lib/db` function; API lands in `mgmt-apis`). Cover with regression tests against a real sqlite fixture: partial import, re-import over active, full final import.
  - **Acceptance:** new importer tests pass (`npm test` in `ui/`, partial/re-import/full cases green); after re-importing the Second Best export, its current season has `status='active'` and ALL its rounds present in `rounds` (count > 6); `npm run check` 0 errors.

- [ ] {agent: backend, id: next-round-fix} **Fix `getNextRound` — cross-season + honest fields.** `ui/src/lib/db/nextRound.ts` only returns the next row in the same season; at end-of-season it returns null even when the next season's round 1 exists. Look across seasons within the league; return the theme from `description` (fall back to `name` only when description is empty, flagged so the UI can tell); return `submission_deadline` and `voting_deadline` separately instead of the `??` collapse, so the digest can never show the wrong deadline silently.
  - **Acceptance:** unit test covering last-round-of-season → returns next season's round 1; `GET /api/digest/:roundId/next-round` for a Second Best end-of-season round returns the real next round with correct deadlines; `npm run check` 0 errors.

- [ ] {agent: backend, id: active-derivation} **Derive active leagues + fix all-archived resolution.** In `ui/src/lib/db/activeRound.ts`, `getActiveLeaguesActiveRounds` gates on `leagues.is_active = 1` — derive active leagues from seasons with `status='active'` instead, keeping the manual flag as an override (not the sole gate). In the derivation path, when every round in the active season is past-deadline, stop resolving the latest archived round as "active"; return an explicit `needsNextRound` state the UI can render as a create-next-round prompt.
  - **Acceptance:** `GET /api/active-rounds` lists BOTH leagues (Hip Jammers + Second Best) with their real current rounds once season-status is fixed; an all-archived fixture season yields `needsNextRound: true` rather than an archived round; `npm run check` 0 errors.

- [ ] {agent: frontend, id: league-toggle} **League active-toggle UI.** Add a control calling the existing `PATCH /api/leagues/:leagueId/active` (endpoint exists; nothing in the UI calls it today). Place it where leagues are listed (home panel or settings "Active rounds" section). Reflect state immediately in `ActiveRounds.svelte`.
  - **Acceptance:** toggling the second league active in the UI makes its slot appear in the Active rounds panel without a manual DB write; toggle state survives reload; `npm run check` 0 errors.

- [ ] {agent: orc, id: gate-1, depends: season-status,next-round-fix,active-derivation,league-toggle} **Gate 1 — symptoms verified dead.** Run the Gate & Context-Reset Protocol (handoffs → cross-check → version+changelog → ratification card → deploy → reset both panes). Wave focus for the smoke: digest next-round section shows the true next round + deadlines for both leagues; both leagues' current rounds reachable.
  - **Acceptance:** both agents' wave-1 handoff entries exist in `## Activity Log` with cross-check pass notes; a `ratification-needed` card for gate-1 was emitted and resolved `ratified`; prod (192.168.4.217:3002) smoke at 412×892 shows both leagues' real current rounds with 0 console errors; both agent panes cleared and re-oriented.

### Wave 2 — multi-league surfacing

- [ ] {agent: backend, id: open-rounds-multi, depends: gate-1} **Multi-league open rounds API.** `/api/rounds/open` (feeds the shortlist assign popover) must include every league with a derived active round — not just `is_active=1` — so the H2H flow can target either league. Keep the response shape grouped by league as the popover expects.
  - **Acceptance:** `curl /api/rounds/open` returns rounds for both active leagues; assign popover (existing UI) lists both league groups; `npm run check` 0 errors.

- [ ] {agent: frontend, id: shortlist-strip, depends: gate-1} **Shortlist active-round header strip.** Sticky "quick assign" header on `/shortlist`: one row per active league showing league name, current round theme + deadlines (from `/api/active-rounds`), and per-song quick-assign to that league's active round. Pattern reference: `ActiveRounds.svelte`.
  - **Acceptance:** at 412×892 the strip renders one row per active league with round + deadlines; quick-assigning a song lands it on that league's active round (visible in the round's candidate pool); `npm run check` 0 errors.

- [ ] {agent: frontend, id: digest-next-round-edit, depends: gate-1} **Digest "Next Round Up" persist + edit.** Today the section renders outside `DigestSection` with no controls, and the GenerateModal exclude toggle is client-state only (lost on reload). Persist the exclude flag; wrap the section in the standard `DigestSection` controls (kebab: edit/exclude); add inline editing for theme text + deadline with a stored override that wins over the computed value on load. Persist via `PATCH /api/digest/:roundId/next-round`.
  - **Acceptance:** excluding the section survives a page reload; editing theme/deadline persists and renders the override after reload; computed value returns when the override is cleared; `npm run check` 0 errors.

- [ ] {agent: frontend, id: h2h-league-selector, depends: open-rounds-multi} **H2H flow league context.** The head-to-head ranking trigger must carry a league: read from active-league context with an explicit selector when more than one league is active, and pass `leagueId` through the flow so the winner lands on the right league's round.
  - **Acceptance:** with both leagues active, starting H2H prompts for (or clearly shows) the target league; completing a ranking writes to the selected league's active round only; `npm run check` 0 errors.

- [ ] {agent: orc, id: gate-2, depends: open-rounds-multi,shortlist-strip,digest-next-round-edit,h2h-league-selector} **Gate 2 — both leagues fully usable.** Run the Gate & Context-Reset Protocol. Wave focus for the smoke: complete a real shortlist→assign→H2H pass against the Second Best current round; edit + exclude the digest next-round section on a real draft.
  - **Acceptance:** both agents' wave-2 handoff entries with cross-check notes; gate-2 ratification card resolved `ratified`; prod smoke passes the Second Best H2H assignment end-to-end at 412×892 with 0 console errors; both panes cleared and re-oriented.

### Wave 3 — player model + setup screens

- [ ] {agent: backend, id: player-model, depends: gate-2} **Players + season rosters (additive).** Add `players` (id, name, chat_type, chat_identifier, ml_competitor_id, created_at) and `season_players` (season_id, player_id, joined_at). Backfill one player per existing competitor (deterministic via `ml_competitor_id`). Importer upserts `season_players` rows from each imported round's competitors. No FK rewrites in this task — purely additive; migration is wave 4.
  - **Acceptance:** migration runs on a copy of the real DB without data loss (row counts logged before/after); every competitor has exactly one player; `season_players` populated for all imported seasons; importer test proves roster upsert on re-import; `npm run check` 0 errors.

- [ ] {agent: backend, id: mgmt-apis, depends: gate-2} **Season + player management APIs.** Endpoints to: mark a season active/complete (manual override from `season-status`); reassign a league's `active_round_id`; explicitly pin the "next round" per league (stored, wins over `getNextRound` inference); CRUD a player's chat identity (chat_type whatsapp|google-chat + chat_identifier) and season membership. Route chat_mentions.sender_name → player lookup as a service function (no ingestion changes).
  - **Acceptance:** each endpoint exercised by a test or curl transcript in the handoff (season status flip, next-round pin, player chat-identity set, season membership add/remove); pinned next round is returned by `/api/digest/:roundId/next-round`; `npm run check` 0 errors.

- [ ] {agent: frontend, id: league-season-mgmt, depends: mgmt-apis} **League + season management screen.** Setup surface (route or settings panel) per league: active flag, display name, chat type; its seasons with status controls (active/complete); current-round assignment and explicit next-round pin (from `mgmt-apis`).
  - **Acceptance:** from the UI alone: flip a season's status, set the active round, pin the next round — each persists across reload and is reflected in the Active rounds panel and digest next-round section; `npm run check` 0 errors.

- [ ] {agent: frontend, id: roster-screen, depends: player-model,mgmt-apis} **Player roster screen.** Per league-season roster view/edit: add/remove players (season membership), display name, chat type (whatsapp | google-chat) + chat handle per player, and a membership picker showing every league/season a player belongs to (players span leagues).
  - **Acceptance:** a player in both leagues shows both memberships; setting a chat handle persists and round-trips via the `mgmt-apis` endpoints; adding a player to the Fam Jam season with chat_type=google-chat works with no ML identity; `npm run check` 0 errors.

- [ ] {agent: orc, id: gate-3, depends: player-model,mgmt-apis,league-season-mgmt,roster-screen} **Gate 3 — the model is real and manageable.** Run the Gate & Context-Reset Protocol. Wave focus for the smoke: from a clean browser, mark seasons, pin next rounds, and link 2–3 real players' chat identities (including one fam-jam Google Chat player) entirely through the new screens.
  - **Acceptance:** both agents' wave-3 handoff entries with cross-check notes; gate-3 ratification card resolved `ratified`; prod smoke completes the setup-screen pass at 412×892 with 0 console errors; both panes cleared and re-oriented.

### Wave 4 — identity migration

- [ ] {agent: backend, id: history-player-id, depends: gate-3} **History views on player_id.** Migrate `playerHistory.ts` and `/api/history/players` (+ `/api/history/players/:name`) from `competitors.name` string matching to stable `player_id` joins, so renames don't fracture history and cross-league identity unifies. Keep response shapes the History tab already consumes (or coordinate a shape change with frontend via a handoff note).
  - **Acceptance:** renaming a player (UI or direct update) leaves their full history intact in `/history?tab=players`; a player in both leagues shows one unified record; existing History tab renders unchanged (27-player roster, taste overlap) on prod data; `npm run check` 0 errors.

- [ ] {agent: backend, id: fk-migration, depends: history-player-id} **FK migration: gameplay tables → players.** Repoint `ml_submissions.competitor_id`, `votes.voter_id`, `season_standings.competitor_id`, `rounds.theme_chooser_id` at `players`, with a deterministic backfill from the `player-model` mapping. Run on a copy of the real DB first with before/after row-count + spot-check assertions (a known round's standings identical pre/post). Full regression pass over digest generation, standings, and history.
  - **Acceptance:** migration script output (row counts, spot-checks) recorded in the handoff entry; digest for a known closed round (e.g. Hip Jammers r-104) generates identically pre/post migration; standings + History tabs render correctly on prod data; `npm test` and `npm run check` green.

- [ ] {agent: orc, id: gate-4, depends: history-player-id,fk-migration} **Gate 4 — sprint close.** Run the Gate & Context-Reset Protocol one final time: handoffs, cross-check, version + CHANGELOG, ratification card (sprint review), deploy, full regression smoke (digest, standings, history, shortlist, setup screens). Flip this doc's `status` to closed on ratification.
  - **Acceptance:** gate-4 ratification card resolved `ratified`; prod smoke at 412×892 covers digest/standings/history/shortlist/setup with 0 console errors; CHANGELOG lists all sprint-25 changes with the bumped version; doc `status: closed`.

## Decision Log

### 2026-06-11 — Full scope ratified (owner)
Owner ratified the full 20-job scope including the FK/history migration originally proposed as a follow-up sprint: "just go for it — not worried about a long sprint." Trade-off acknowledged: migration buys rename-proof history, cross-league identity, and the write path for non-ML leagues; it gates the analytics roadmap wing.

### 2026-06-11 — Gates + context-reset discipline (owner)
Mid-sprint ratification gates a few times per sprint, ratified by both agents (cross-check) and the user (warren card). Agents reset context at every gate after writing handoff entries; mid-wave proactive reset at ~60–70% context. Rationale: short context with good handoffs minimizes long-session hallucinations.

## Ratification Log

_(gate cards land here as they resolve)_

## Blockers

_None._

## Activity Log

### 2026-06-11 — orc-agent — Sprint plan authored: league/season/round/player foundation
- Created sprint-25 coord-doc; wrote `## Active Sprint Plan` with 18 tasks across 4 gated waves (8 backend / 6 frontend / 4 orc gates) from the planned roadmap card `active-league-management` (research: `planning-league-model.md`, two-agent pass).
- Wave 1 symptom fixes → Gate 1; Wave 2 multi-league surfacing → Gate 2; Wave 3 player model + setup screens → Gate 3; Wave 4 history/FK migration → Gate 4 (sprint close).
- New `## Gate & Context-Reset Protocol` section encodes the owner's gating + frequent-context-clear discipline; orc added to the roster for gate ceremonies only.
