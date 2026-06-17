---
status: active
campaign: bside-season-awareness
sprint: S1
created: 2026-06-16
---

# music-league-bot — coordination doc (sprint-36)

> **Campaign:** b-side: Season Awareness · **Sprint:** S1 — Awareness Backbone.
> Spec: `docs/superpowers/specs/2026-06-16-bside-season-awareness-design.md`.
> Plan (authoritative task steps + code): `docs/superpowers/plans/2026-06-16-bside-season-awareness-s1.md`.

## Sprint Goals

Build the deterministic data backbone for the Season-Update section — UI-free, LLM-free, fully unit-tested.

Two file-disjoint lanes: a lean digest→read-model context channel, and the season-signals engine over a temporal read-model. No user-facing surface ships in S1 (that's S2).

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A — lean channel:** `$lib/db/schema.ts`, `$lib/db/client.ts` (the `digest_drafts.archive_context` migration), `$lib/digest/archiveContext.ts`, `$lib/digest/llm.ts` (`writeDraft` only) | `$lib/dashboard/*` |
| frontend (pane 1.3) | **Lane B — signals backbone (pure logic this sprint, no UI):** `$lib/dashboard/seasonTimeline.ts`, `$lib/dashboard/seasonSignals.ts`, and ONE additive export of `getActiveSeasonId` in `$lib/db/activeRound.ts` if not already exported | `$lib/db/schema.ts`, `$lib/db/client.ts`, `$lib/digest/*` |
| orc | sprint gate: cross-check both lanes committed, run the final full `npm run check` + `vitest run`, report per-lane; **no deploy this sprint** (no user-facing surface — deploy lands with S2) | project code |

## Working agreements (sprint-36)

- **Lanes are file-disjoint — stay in your lane.** Backend never edits `$lib/dashboard/*`; frontend never edits `$lib/db/schema.ts` / `$lib/db/client.ts` / `$lib/digest/*`.
- **Shared working tree → commit PATH-SCOPED.** Both panes share the one mlb working tree. Each commit lists only your lane's files: `git commit -m "…" -- <your paths>`. **Never `git commit --amend`** on the shared HEAD.
- **Per-task test runs are SCOPED.** Use the targeted `npx vitest run <specific test>` from each task — do NOT run the full `npm run check` mid-sprint (it would typecheck the other lane's in-progress code). The single full `npm run check` is the orc gate, after both lanes land.
- **Dev loop, not prod-per-change.** `npm run dev` (5173) + scoped `vitest` per the plan. Never serve on 4444.
- **Sonnet workers.** Follow the plan doc task-by-task (TDD: failing test → run → implement → pass → path-scoped commit).
- **Log completion here.** Append a one-line Activity Log entry per task with the commit hash so orc can gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     Full step-by-step code lives in the plan doc; tasks below mirror its Task numbers. -->

- [ ] {agent: backend, id: channel-schema} **Plan Task 1 — `archive_context` column.** Add nullable `archive_context TEXT` to `digest_drafts` (schema.ts) + additive ALTER-TABLE migration in client.ts (follow the `phase`-column pattern).
  - **Acceptance:** existing `vitest run src/lib/digest` green (migration idempotent on `:memory:` DBs); committed path-scoped.

- [ ] {agent: backend, id: channel-capture, depends: channel-schema} **Plan Task 2 — capture + reader.** Create `$lib/digest/archiveContext.ts` (`buildArchiveContext` + `getArchiveContext`), wire `buildArchiveContext` into `writeDraft` in `llm.ts`.
  - **Acceptance:** `vitest run src/lib/digest/archiveContext.test.ts` green (3 tests); digest suite still green; committed path-scoped.

- [ ] {agent: frontend, id: timeline} **Plan Task 3 — season timeline assembler.** Create `$lib/dashboard/seasonTimeline.ts` + test (per-round standings via `computeStandings`, per-round tastemaker via `getDiscoverability`, vote pairs). Export `getActiveSeasonId` from `activeRound.ts` if needed (additive).
  - **Acceptance:** `vitest run src/lib/dashboard/seasonTimeline.test.ts` green (2 tests); committed path-scoped.

- [ ] {agent: frontend, id: signals-movers, depends: timeline} **Plan Task 4 — signals types + movers.** Create `$lib/dashboard/seasonSignals.ts` + test (bigMover / faller).
  - **Acceptance:** `vitest run src/lib/dashboard/seasonSignals.test.ts` green (movers); committed.

- [ ] {agent: frontend, id: signals-streaks, depends: signals-movers} **Plan Task 5 — streaks.**
  - **Acceptance:** streaks tests green; committed.

- [ ] {agent: frontend, id: signals-discovery, depends: signals-streaks} **Plan Task 6 — discovery shifts.**
  - **Acceptance:** discoveryShifts tests green; committed.

- [ ] {agent: frontend, id: signals-rivalries, depends: signals-discovery} **Plan Task 7 — reciprocal-downvote rivalries** (spot-trading deferred to S2 if needed — log it, don't silently drop).
  - **Acceptance:** rivalries tests green; committed.

- [ ] {agent: frontend, id: signals-tension, depends: signals-rivalries} **Plan Task 8 — upcoming tension + `computeSeasonSignalsForLeague` DB entry point.**
  - **Acceptance:** full `seasonSignals.test.ts` green; committed.

- [ ] {agent: frontend, id: signals-integration, depends: signals-tension} **Plan Task 9 — DB-backed integration test.** `seasonSignals.integration.test.ts`.
  - **Acceptance:** integration test green; committed.

- [ ] {agent: orc, id: gate, depends: channel-capture,signals-integration} **Gate.** Cross-check both lanes committed (tree clean, path-scoped); run the single full `npm run check` (0 errors) + `vitest run` (all green); report per-lane; mark S1 done. No deploy (no user-facing surface).
  - **Acceptance:** 0 typecheck errors; full vitest green; both lanes' commits listed; doc → `status: closed`; S2 readiness noted.

## Decision Log

### 2026-06-16 — Parallel-2 decomposition, owner-ratified (warren)
Card `dr-704f16ff`. S1 dispatched as two file-disjoint lanes — backend (1.2) runs the lean channel (plan Tasks 1-2); frontend (1.3) runs the signals backbone (plan Tasks 3-9). Sonnet workers, path-scoped commits, orc-gated final check. Architecture settled in the approved spec/plan; this is an orchestration decision only.

## Ratification Log

_S1 has no content/user-facing surface — no content ratification gate this sprint._

## Blockers

_None._

## Activity Log

### 2026-06-16 — orc — sprint-36 (S1) kicked off
- Campaign `bside-season-awareness` carved; spec `3868bd4`, war-table `cfc87e5`, S1 plan `2a6a0cb`.
- Decomposition ratified (card `dr-704f16ff`, parallel-2). Roster: backend=channel (plan T1-2), frontend=signals backbone (plan T3-9).
- Dispatched both lanes (owner authorized "deploy", Sonnet 4.6 workers): backend (Lane A, plan T1-2) + frontend (Lane B, plan T3-9). Both confirmed running.
- NOTE (warren bug): the prod warren `/api/panes/:id/capture` 500s on every pane, which breaks the E4-gated `/send` — dispatched via `tmux send-keys` fallback instead. Log to warren review queue.
- Holding for agent-finish hooks; orc runs the `gate` task once both lanes report done.

### 2026-06-16 — backend (Lane A) — Tasks 1 + 2 complete
- T1 `734ded8`: `archive_context TEXT` column in `digest_drafts` (schema.ts + additive migration in client.ts); existing 35 digest tests green.
- T2 `c684924`: `archiveContext.ts` (`buildArchiveContext` + `getArchiveContext`); wired into `writeDraft`; 38/38 digest tests green (3 new).

### 2026-06-16 — orc — Lane A reviewed ✓
- Commits path-scoped + in-lane (734ded8 = db only; c684924 = digest only; no dashboard/ touches).
- Scoped digest suite 38/38 green. Lane A accepted pending the final full gate.
- Holding for Lane B (frontend, plan T3-9).

### 2026-06-16 — frontend (Lane B) — Tasks 3–9 complete
- T3 `9b48ac7`: `seasonTimeline.ts` + test — `buildSeasonTimeline` (per-round standings + tastemaker + vote pairs); 2 tests green.
- T4 `f19e763`: `seasonSignals.ts` + test — `SeasonSignals` types + movers (bigMover/faller); 3 movers tests green.
- T5 `f3a9b6c`: streak detection wired + test; 4 tests green.
- T6 `f9c075a`: discovery-behavior shifts wired + test; 5 tests green.
- T7 `385ea0e`: reciprocal-downvote rivalry detection + test (spot-trading deferred to S2, logged in commit message); 6 tests green.
- T8 `36261c1`: upcoming tension + `computeSeasonSignalsForLeague` DB entry point + test; 7 tests green.
- T9 `309de56`: DB-backed integration test (`seasonSignals.integration.test.ts`); full dashboard suite 124/124 green.
- Lane B files: `dashboard/seasonTimeline.ts`, `dashboard/seasonTimeline.test.ts`, `dashboard/seasonSignals.ts`, `dashboard/seasonSignals.test.ts`, `dashboard/seasonSignals.integration.test.ts` only. No schema/client/digest touches.
