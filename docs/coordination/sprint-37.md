---
status: active
campaign: bside-season-awareness
sprint: S2
created: 2026-06-16
---

# music-league-bot — coordination doc (sprint-37)

> **Campaign:** b-side: Season Awareness · **Sprint:** S2 — The Living Season (capstone).
> Spec: `docs/superpowers/specs/2026-06-16-bside-season-awareness-design.md`.
> Plan (authoritative task steps + code + cross-lane contracts): `docs/superpowers/plans/2026-06-16-bside-season-awareness-s2.md`.

## Sprint Goals

Ship the Season-Update "season pulse" on the public b-side — an LLM narration of the S1 `SeasonSignals`, regenerated on every b-side publish/update, with the loosened funny/fact-based voice + an operator snark dial.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `$lib/dashboard/generators/seasonUpdate.ts`, `$lib/dashboard/seasonSignals.ts` (carry-over signals), `$lib/dashboard/buildReadModel.ts`, `routes/api/content/[leagueId]/update/+server.ts`, `routes/api/content/[leagueId]/snark/+server.ts`, `$lib/db/schema.ts`, `$lib/db/client.ts` | `bside/*`, `$lib/content/*` |
| frontend (pane 1.3) | **Lane B:** `bside/src/lib/types.ts`, `bside/src/routes/HomeScreen.svelte`, `$lib/content/UpdateModal.svelte` (+ the content publish row if needed) | `$lib/dashboard/*`, `$lib/db/*`, `routes/api/*` |
| orc | gate: cross-check both lanes; `ui` `npm run check` + `vitest run`; `bside` `npm run build`; **owner content-review** (dev regen + screenshot) before deploy; deploy on sign-off; close | project code |

## Working agreements (sprint-37)

- **Cross-lane CONTRACTS (pinned — both lanes code to these, no renegotiation):**
  - `seasonUpdate` read-model field = `{ title: string; body: string } | null`. zod (ui): `z.object({title:z.string(),body:z.string()}).nullable()`; bside TS interface mirrors it.
  - Snark dial = integer `snark_level` 0–2 (default 1) on `dashboard_sites`; operator sets via `PATCH /api/content/:leagueId/snark` `{ level: 0|1|2 }`.
- **Lanes are file-disjoint — stay in your lane** (see roster). Backend never edits `bside/*` or `$lib/content/*`; frontend never edits `$lib/dashboard/*`, `$lib/db/*`, or `routes/api/*`.
- **Two build targets.** `ui/` (operator app) and `bside/` (public SPA) build separately. Backend verifies via scoped `npx vitest run` in `ui/`; frontend verifies the SPA via `cd bside && npm run build`.
- **Shared working tree → commit PATH-SCOPED** to only your files; **never `git commit --amend`** on shared HEAD.
- **Scoped tests per task; the full `ui` check + `bside` build are the orc gate** (don't run full `npm run check` mid-sprint).
- **Sonnet workers.** Follow the plan task-by-task (TDD where the logic allows). Log each task to the Activity Log with its commit hash.
- **This sprint ships USER-FACING content** — do not deploy; the orc gate runs an owner content-review first.

## Active Sprint Plan

<!-- - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body / **Acceptance:** check. Full code in the plan doc. -->

- [x] {agent: backend, id: snark-storage} **Plan Task A1 — `snark_level` column + snark API.** Add `snark_level INTEGER NOT NULL DEFAULT 1` to `dashboard_sites` (+ migration), a `getSnarkLevel` reader, and `PATCH /api/content/[leagueId]/snark`.
  - **Acceptance:** snark route test green (persist + validate level ∈ {0,1,2}); committed path-scoped. ✓ commit 47a40e0

- [x] {agent: backend, id: signals-carryover} **Plan Task A2 — carry-over signals.** Add `spot-trading` rivalry + `punchingBagGuard` to `seasonSignals.ts`.
  - **Acceptance:** new signal tests green; committed. ✓ commit 6bdb59b

- [x] {agent: backend, id: narration-task, depends: snark-storage} **Plan Task A3 — `seasonUpdateTask`.** Create `generators/seasonUpdate.ts` (input/output schemas, `buildSeasonUpdateMessages` with voice + guardrails, the PredictionTask).
  - **Acceptance:** buildMessages test asserts facts + snark level + guardrails (artists-ok-songs-forbidden, safe targets, punching-bag); output schema parses `{title,body}`; committed. ✓ commit 999c605

- [x] {agent: backend, id: readmodel-wire, depends: narration-task,signals-carryover} **Plan Task A4 — wire into BOTH read-model paths.** Add `seasonUpdate` to `ReadModelSchema`; populate in `buildReadModel` AND `buildUpdatedReadModel` (regenerate-on-update); pass signals + snark level.
  - **Acceptance:** `buildReadModel` test mock extended (`season-pulse writer` branch) asserts `readModel.seasonUpdate` populated; `vitest run src/lib/dashboard` green; committed. ✓ commit 6d9cf9a

- [x] {agent: frontend, id: bside-section} **Plan Task B1 — bside type + HomeScreen section.** Add `seasonUpdate` to `bside/src/lib/types.ts`; render the section (guarded) right after the KPI ribbon in `HomeScreen.svelte` using existing `bs-sec`/`bs-eyebrow` classes.
  - **Acceptance:** `cd bside && npm run build` succeeds; committed path-scoped. ✓ (prior session)

- [x] {agent: frontend, id: snark-control} **Plan Task B2 — operator snark-dial control.** 3-way Gentle/Medium/Spicy control in `UpdateModal.svelte` calling `PATCH /api/content/:leagueId/snark`, defaulting to current level.
  - **Acceptance:** `cd ui && npm run check` 0 errors in the changed file; committed. ✓ (prior session)

- [ ] {agent: orc, id: gate, depends: readmodel-wire,bside-section,snark-control} **Gate.** Cross-check path-scoped; `ui` `npm run check` (0) + `vitest run` (green); `bside` `npm run build`; **owner content-review** (regen a real b-side on dev, screenshot 412 + desktop, ratify against the voice mandate); on sign-off: v-bump + CHANGELOG + deploy + assert live; close.
  - **Acceptance:** checks green both targets; owner ratifies content; deployed + live; doc `status: closed`.

## Decision Log

### 2026-06-16 — Parallel-2 decomposition, owner-ratified (warren)
Card `dr-20a49cf7`. S2 as two file-disjoint lanes against pinned contracts (the `seasonUpdate {title,body}|null` field + the snark PATCH API). backend (1.2) = narration + signals carry-overs + read-model wiring + snark storage/API; frontend (1.3) = bside section + snark control. Placement confirmed: section after the KPI ribbon (public home has no standings table).

## Ratification Log

_Pending: owner content-review of the generated Season-Update (voice mandate) at the gate, before deploy._

## Blockers

_None._

## Activity Log

### 2026-06-16 — backend — Lane A complete (Tasks A1–A4)
- A1: `snark_level` column + additive migration + `getSnarkLevel` + PATCH snark route + 6-case test (47a40e0)
- A2: spot-trading rivalry signal + `punchingBagGuard[]` + 5 new signal tests (6bdb59b)
- A3: `seasonUpdateTask` PredictionTask + `buildSeasonUpdateMessages` with voice/guardrails + 12 tests (999c605)
- A4: `ReadModelSchema.seasonUpdate` + wired into `buildReadModel` + `buildUpdatedReadModel` (punching-bag guard as recentSubjects) + test mock branch (6d9cf9a)
- All tests green: 142 dashboard tests, 28 content route tests.
- **Gate ready for orc:** both lanes complete; awaiting `ui npm run check` + `vitest run` + `bside npm run build` + owner content-review.

### 2026-06-16 — orc — sprint-37 (S2) kicked off
- S1 (sprint-36) closed; backbone (`computeSeasonSignalsForLeague` + `archive_context`) live in-repo.
- S2 plan `f4a373d`; decomposition ratified (card `dr-20a49cf7`, parallel-2; placement = after KPI ribbon).
- Next: dispatch both lanes to panes 1.2 / 1.3 (Sonnet), hold for agent-finish hooks, then gate (incl. owner content-review).

### 2026-06-16 — orc — both lanes dispatched (S2)
- backend (Lane A, plan A1-A4) + frontend (Lane B, plan B1-B2) sent to panes 1.2/1.3 (Sonnet, tmux fallback — warren capture still 500ing). Both confirmed running.
- Holding for agent-finish hooks; gate includes owner content-review before any deploy.

### 2026-06-16 — orc — backend resumed (context handoff)
- backend hit context low mid-Task A1 (no uncommitted work; clean bridge). orc resumed it: /clear → continue → gsd-resume-work, fresh context. Real finding carried in bridge: dashboard_sites table is created in client.ts (not schema.ts) — A1 column goes there.
- frontend landed B1 (dc04eda — bside seasonUpdate section after KPI ribbon + type contract); working B2.
- Both lanes running; holding for completion hooks.

### 2026-06-16 — frontend (Lane B) — Tasks B1 + B2 complete
- B1 `dc04eda`: `seasonUpdate: {title,body}|null` added to `bside/types.ts` ReadModel; Season-Update section rendered in HomeScreen.svelte after KPI ribbon (guarded on null, `bs-acc-sky` accent, `bs-pulse-body` paragraphs); `cd bside && npm run build` ✓.
- B2 `2c40586`: 3-way Gentle/Medium/Spicy snark-dial in UpdateModal.svelte (snarkLevel state defaults 1, PATCHes `/api/content/:leagueId/snark` on change); `ui` svelte-check 0 errors.
- Lane B files: `bside/src/lib/types.ts`, `bside/src/routes/HomeScreen.svelte`, `ui/src/lib/content/UpdateModal.svelte` only. No dashboard/db/api touches.

### 2026-06-16 — orc — Lane B reviewed ✓
- Commits path-scoped + in-lane (dc04eda = bside types+HomeScreen; 2c40586 = content/UpdateModal; no dashboard/db/api touches).
- bside SPA `npm run build` clean. B2 ui-typecheck deferred to the gate. Lane B accepted pending gate.
- Holding for Lane A (backend, A1-A4).

### 2026-06-16 — orc — GATE technical checks PASSED (content review pending)
- Both lanes path-scoped + in-lane on a clean tree (Lane A: 47a40e0/6bdb59b/999c605/6d9cf9a; Lane B: dc04eda/2c40586).
- ui `npm run check`: 0 errors (819 files). Full `vitest run`: 570/570 green (61 files). bside `npm run build`: clean.
- REMAINING: owner content-review of a real generated Season-Update (voice mandate) → then deploy. NOT closed yet.

### 2026-06-16 — orc — content-review generation dispatched (post-context-reset)
- Owner picked **Second Best** (id 3) as the voice-mandate sample league.
- Backend (%55, idle/Sonnet) dispatched to generate a REAL Season-Update at MEDIUM snark on dev (5173) via the seasonUpdateTask + read-model path; report verbatim {title, body}; no deploy/commit. Generation in flight.
- Next: on finish → screenshot bside Season-Update section 412 + desktop → owner ratifies voice → v-bump + CHANGELOG + deploy + assert live → close.
