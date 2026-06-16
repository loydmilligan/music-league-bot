---
project: music-league-bot
sprint: sprint-34
roadmapItem: round-phase-model-and-action-center
title: Round phase becomes operator-controlled
status: active
created: 2026-06-16T05:52:13Z
activated: 2026-06-16
updated: 2026-06-16T05:52:13Z
---

# music-league-bot — coordination doc (sprint-34)

> **Phase-first slice of the `round-phase-model-and-action-center` roadmap card.**
> Today a round's phase (`submission/voting/archive`) is *derived* from deadlines
> vs. the clock (`ui/src/lib/lifecycle.ts → getRoundPhasesForSeason`), walking
> rounds by `id` order. The moment a voting deadline passes, the round silently
> flips to `archive` and drops out of the active slot — exactly when its digest
> needs generating (live: r7 "The Bones Are Their Money" did this). This sprint
> makes **phase a stored field advanced by buttons**, demotes deadlines to
> informational, and makes the active-round resolution read the stored phase.
> It **de-scopes** the active-round-truth piece from `active-league-management`.
> The Action Center (the notification/todo center + End-Voting→digest-todo
> trigger) is the on-deck **sprint-35**; it rides on this substrate.
> Design: `~/.config/taw/wiki/Projects/music-league-bot/round-phase-and-action-center-spec.md`.

## Sprint Goals

Put round phase under operator control

Buttons advance the round; deadlines stop deciding what's active.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | `$lib/db/*` (rounds, migrations, `activeRound.ts`, `activeRoundDerive.ts`, `lifecycle.ts`), `/api/rounds/*` phase endpoints, prep-checks | Svelte components, page routes |
| frontend | the round / active-round Svelte components + the phase modals (operator app), hands-on verification | DB, the lifecycle/activeRound logic, API internals |
| orc | sprint gate: cross-check, version + CHANGELOG, ratification card, deploy, prod walk, context resets | project code |

## Working agreements (sprint-34)

- **Additive migration.** The `rounds.phase` column is new and must backfill
  every existing row from the current derivation before anything reads it — no
  round may be left with a null phase. Keep the migration compatible with
  `active-league-management`'s planned FK migration (no rename/restructure of
  `rounds` keys).
- **Stored phase is authoritative; deadlines are informational.** After the
  source-of-truth rewrite, no code path may flip a round's phase off the clock.
  Deadline derivation survives only as a fallback when `phase` is null.
- **Dev loop, not prod-per-change** (per the two-loop workflow): each lane uses
  `npm run dev` (5173) + `npm run check`; one orc-gated cached prod deploy at the
  gate. Never serve on 4444.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: phase-schema} **Add the stored `rounds.phase` column + backfill.** Add `phase TEXT` to `rounds` (`not-started | submission | voting | complete`) via a migration, and backfill every existing row from the current deadline-derived phase (`getRoundPhasesForSeason`, mapping its `archive` → `complete`). No row may be left null.
  - **Acceptance:** migration runs clean; `SELECT phase, count(*) FROM rounds GROUP BY phase` shows zero nulls; second-best r7 (id 134) backfills to `complete` and r8 (id 131) to `submission`, matching today's derivation; `npm run check` 0 errors.

- [x] {agent: backend, id: phase-api, depends: phase-schema} **Phase-transition endpoints.** `POST /api/rounds/:id/end-submission` (body `{endTimestamp, mode:'accelerated'|'speedy', speedyDays}` → set `phase=voting`; `speedy` shifts `voting_deadline` to end+`speedyDays`, `accelerated` leaves it). `POST /api/rounds/:id/end-voting` (→ `phase=complete`; returns a suggested next-round `submission_deadline` prefill). Guard illegal transitions.
  - **Acceptance:** end-submission flips `submission→voting` and (speedy, days=3) sets `voting_deadline = end+3d`; end-voting flips `voting→complete` and returns the prefill; ending voting from `submission` is rejected (4xx); route tests green; `npm run check` 0.

- [ ] {agent: backend, id: phase-truth, depends: phase-schema} **Make stored phase authoritative.** Rewrite `activeRound.ts` / `activeRoundDerive.ts` / `lifecycle.ts` callers to read `rounds.phase`; keep deadline derivation only as a fallback when `phase` is null. Stop prep-checks hard-blocking on missing/auto-filled deadlines.
  - **Acceptance:** the active round for `second-best` resolves from stored phase (a round with a *past* `voting_deadline` but `phase=voting` stays active — the clock no longer flips it); `getRoundPhase`/derive used only when `phase` is null; prep-checks pass with a blank deadline; `npx vitest run` green for the lifecycle/activeRound suites.

- [ ] {agent: frontend, id: phase-ui, depends: phase-api} **Phase buttons + modals on the active-round surface.** An **End Submission Phase** button → modal (editable end-timestamp + Accelerated vs Speedy, prefill N=3 days) posting to `/api/rounds/:id/end-submission`; an **End Voting Phase** button → modal that completes the round and shows the next-round submission-deadline prefill. Render deadlines as informational, not gating.
  - **Acceptance:** both buttons render on the active-round view; the End Submission modal posts the chosen mode and the phase pill flips to **Voting**; End Voting completes the round and surfaces the prefill; verified hands-on on dev at 1280 + mobile 412; `npm run check` 0.

- [ ] {agent: orc, id: gate, depends: phase-schema,phase-api,phase-truth,phase-ui} **Gate — cross-check, ship, walk the flow, close.** Cross-check all lanes; `npm run check` + `npx vitest run`; version bump + CHANGELOG (visible + under-the-hood); ratification card; build + deploy; then walk the LIVE flow on `mlbot2.mattmariani.com`: advance a test round through **End Submission → End Voting**, confirm the active-round slot follows the stored phase (not the clock), and confirm a stale/blank deadline no longer mis-flips the active round. Panes reset, doc closed.
  - **Acceptance:** all worker tasks `[x]`; 0 typecheck errors + vitest green; v-bump + CHANGELOG committed; ratification card emitted + ratified; live: phase buttons advance a round and the active slot tracks stored phase, stale deadline does not mis-flip; 0 console errors; doc `status: closed`.

## Decision Log

### 2026-06-16 — Phase-first, standalone (owner-ratified)
Build the stored-phase model before / independent of `active-league-management`.
The `rounds.phase` column is additive and the live pain (rounds dropping off the
active slot when a deadline passes) is acute now. This sprint de-scopes the
"active-round truth" piece + the `activeRound`/`lifecycle` rewrite from
`active-league-management`, which inherits them as done.

### 2026-06-16 — Action Center is sprint-35, not this sprint
The notification/todo center, its `cards` table + reactive resolver + escalation,
and the End-Voting→digest-todo trigger are the second half of the roadmap card.
They depend on the phase substrate landing first, so they're scoped to the
on-deck sprint-35. Web Push is v2.

## Ratification Log

_Pending — gate task emits the sprint-close ratification card._

## Blockers

_None._

## Activity Log

### 2026-06-16 — backend — phase-api: end-submission + end-voting endpoints
- Added `StoredPhase`, `getRoundStoredPhase`, `endSubmissionPhase`, `endVotingPhase` helpers to `rounds.ts`
- `POST /api/rounds/:id/end-submission`: body `{endTimestamp, mode, speedyDays?}` → `submission→voting`; speedy mode shifts `voting_deadline` to `end+speedyDays`; accelerated leaves it unchanged
- `POST /api/rounds/:id/end-voting`: `voting→complete`; returns `nextSubmissionDeadline` prefill from next round in season
- Both guard illegal transitions (422) and unknown rounds (404)
- 16 new tests in `rounds.phase.test.ts`; 507/507 suite green; `npm run check` 0 errors

### 2026-06-16 — backend — phase-schema: add rounds.phase column + full backfill
- Added `phase TEXT CHECK(phase IN ('not-started','submission','voting','complete'))` to `rounds` in both `schema.ts` (fresh DBs) and `client.ts` migration (existing DBs)
- Backfill imports `getRoundPhasesForSeason` from lifecycle.ts; runs per-season in a single transaction, mapping `archive`→`complete` and `upcoming`→`not-started`
- Verified on live DB: 0 null phases; r7 id=134 → `complete`, r8 id=131 → `submission`; `npm run check` 0 errors

### 2026-06-16 — docs — Sprint plan refresh: round phase becomes operator-controlled
- created sprint-34 coord-doc; wrote `## Active Sprint Plan` with 5 tasks (phase-first slice of `round-phase-model-and-action-center`)
- 3 backend / 1 frontend / 1 orc gate
- deps: `phase-api` + `phase-truth` parallel after `phase-schema`; `phase-ui` after `phase-api`; gate after all four
- scoped to the phase model only; Action Center deferred to sprint-35, Web Push to v2
