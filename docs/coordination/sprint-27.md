---
project: music-league-bot
sprint: sprint-27
title: Collision Fixes (FB-1..FB-5)
status: active
created: 2026-06-13T01:05:00Z
activated: 2026-06-13
updated: 2026-06-13T01:56:39Z
---

# music-league-bot — coordination doc (sprint-27)

> **The fix sprint.** Sprint-26 inventoried every write path and confirmed
> four live collisions; this sprint lands the fixes, severity-ordered from
> the ratified fix backlog (sprint-26 `## Fix Backlog`, FB-1..FB-5). The
> proven `status_source` pattern from season-override-fix is the template
> for FB-1. FB-4 (importer auto-link) clears the last MISSING precondition
> (PC-4) for the future FK hard-repoint sprint. Frontend re-runs the
> sprint-26 collision repros as the verification harness — the repro steps
> in `inventory/collisions.md` were written to be re-runnable; now they
> get re-run. Origin: sprint-26 gate ratification (2026-06-13, card
> `rn-af85e974…`).

## Sprint Goals

- Fix the collisions the inventory caught
  Manual edits survive re-imports; the app gives one answer for the active round.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | DB schema + migrations, importer, `$lib/db/*` services, `/api/*` routes, derivation logic | Svelte components, page routes |
| frontend | Svelte components + routes, hands-on UI verification, collision repro re-runs | DB schema, importer, API route internals |
| orc | sprint gate: cross-checks, version + CHANGELOG, ratification card, prod deploy, context resets | project code (orc manages; project agents work) |

## Working agreements (sprint-27)

- The sprint-26 inventory docs (`docs/coordination/inventory/`) are the map:
  every fix task names its W/D/C rows; consult them before touching code.
- Hands-on means hands-on: UI claims require driving the real UI (dev server)
  and noting what was clicked; DB claims require before/after queries.
- Mid-wave context discipline: past ~60-70% context, write a handoff entry
  and request a reset from orc.
- No prod deploy except by orc at the gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: round-edit-markers} **FB-1 (P1, data-loss) — manual round edits survive ZIP re-import.** `upsertRound` (`ui/src/lib/db/rounds.ts`) ON CONFLICT unconditionally overwrites `name`, `description`, and `spotify_playlist_url` from the ZIP (C2: W3 vs W1). Apply the proven season `status_source` pattern at field level: an edit marker (e.g. `edited_fields` column or per-field `*_source`) set by `patchRound` (W3) and the round edit modal path, which the importer upsert then respects — ZIP values only land on fields the user hasn't manually edited. Idempotent boot migration per house pattern.
  - **Acceptance:** regression test: patch a fixture round's name, re-import its ZIP data, name survives while untouched fields still refresh from the ZIP; re-run the C2 repro steps from `inventory/collisions.md` (round 118 rename → `/settings` re-scan) — name survives; `npm run check` 0 errors; `npx vitest run` green.

- [-] {agent: backend, id: override-staleness} **FB-2 (P2, wrong-display) — stale digest next-round override no longer hides deadline updates.** `digest_drafts.next_round_*_override` wins unconditionally with no expiry or link to the `rounds` row (C3: W14 vs W3/W11/W12). Make deadline writes to a round (W3 patchRound, W11 settings form, W12 auto-fill) clear — or visibly mark stale — any digest draft override that shadows that round. Pick the simplest shape that kills the silent-shadow behavior; preserve the explicit "↺ Reset to computed" flow.
  - **Acceptance:** re-run the C3 repro from `inventory/collisions.md` (set override on digest 111 → update round 130 deadlines in `/settings`) — `GET /api/digest/111/next-round` returns the updated deadlines, or returns the override explicitly flagged stale and the digest UI shows the flag; unit test covering the clear/flag path; `npm run check` 0 errors.

- [-] {agent: backend, id: active-round-unify} **FB-3 (P2, wrong-display) — one answer for "which round is active".** `layout.ts pickCurrentRound` ignores the `leagues.active_round_id` pin while `resolveActiveRound` honors it even into archive, so the home rail and the ActiveRounds modal disagree on the same page (C4: W9; D1 vs D3/D4; also the dual next-round concepts D5/D6 vs D7). Unify: one shared derivation module consumed by both paths, and the pin loses force (auto-clear or fall through to derived) once the pinned round reaches archive phase.
  - **Acceptance:** re-run the C4 observation from `inventory/collisions.md` — home rail and ActiveRounds modal report the same round for Hip Jammers; unit test: pinned round in archive phase → derivation falls through to the deadline-derived round; the divergence-matrix pairs D1 vs D3/D4 now AGREE by construction (same module); `npm run check` 0 errors; `npx vitest run` green.

- [-] {agent: backend, id: importer-autolink} **FB-4 (P3, repoint blocker) — importer writes `player_id` on new competitor rows.** `upsertCompetitor` doesn't set `player_id`, so every newly imported competitor reopens the null-gap that PC-3 just verified closed (PC-4 in `planning-fk-repoint.md`; W1/W2). On insert, auto-link deterministically (existing `ml_competitor_id` backfill rule); when no deterministic match exists, leave NULL — the /setup unlinked banner (sprint-26 linking-ui) is the designed catch. New gameplay rows for an already-linked competitor get `player_id` at write time.
  - **Acceptance:** test: import introducing a new competitor whose `ml_competitor_id` matches a player → row lands linked with gameplay `player_id` populated; non-matching competitor → NULL link and it appears in the /setup unlinked banner; PC-4 marked ✅ in `planning-fk-repoint.md`; `npx vitest run` green.

- [x] {agent: backend, id: regen-skip-excluded} **FB-5 (P4, annoyance) — regeneration skips excluded sections.** Both regenerate paths filter only `state !== 'locked'`, so excluded sections burn LLM tokens on content nobody sees (C5). Skip `state = 'excluded'` in the whole-draft filter (`api/digest/[roundId]/regenerate`) and reject (or no-op) single-section regenerate on an excluded section.
  - **Acceptance:** test or curl transcript: whole-draft regenerate on a draft with one excluded section leaves that section's `regen_count` and `content_json` unchanged; `npm run check` 0 errors.

- [ ] {agent: frontend, id: collision-reverify, depends: round-edit-markers,override-staleness,active-round-unify} **Re-run the collision repros against the fixes.** Drive the exact C2, C3, and C4 repro sequences from `inventory/collisions.md` in the real dev UI (DB before/after via sqlite, same as sprint-26), at desktop and 412×892 where UI is involved. Append a "re-test after sprint-27 fixes" verdict to each entry: FIXED / STILL-BROKEN with evidence. Restore all DB state to baseline.
  - **Acceptance:** `inventory/collisions.md` updated with a re-test section per C2/C3/C4 entry, each verdict FIXED with the observed after-state; any STILL-BROKEN verdict is reported to orc as a blocker before the gate; DB restored to baseline.

- [ ] {agent: frontend, id: ui-consistency-pass, depends: active-round-unify} **Home page agrees with itself — hands-on pass.** After unification, walk `/` (home rail + ActiveRounds), `/setup` (active-round select), and `/digest` next-round display for all four leagues at desktop and 412×892: every surface must name the same active round per league, and a pinned-then-archived round must visibly fall through to the derived round rather than showing stale.
  - **Acceptance:** one Activity Log entry tabulating per-league round shown on each of the four surfaces — all rows agree; 412×892 screenshots for `/` and `/setup` attached or referenced; 0 console errors in devtools on the walked pages.

- [ ] {agent: orc, id: gate-close, depends: round-edit-markers,override-staleness,active-round-unify,importer-autolink,regen-skip-excluded,collision-reverify,ui-consistency-pass} **Gate — cross-check, ship, close.** Orc runs the gate: each agent verifies the other lane's acceptance, version bump + CHANGELOG for the code tasks, ratification card summarizing the five fixes and the re-test verdicts, one cached prod deploy, 412×892 prod smoke (round-name durability + home-page agreement), panes reset, doc closed.
  - **Acceptance:** cross-check Activity Log entries from both agents all PASS; v-bump + CHANGELOG committed; card ratified; prod smoke passes with 0 console errors; doc `status: closed`.

## Decision Log

### 2026-06-13 — Sprint scope = ratified fix backlog (owner, via sprint-26 gate card)
Sprint-26 gate ratification adopted FB-1..FB-5 as the sprint-27 seed. All five
fixes taken in one sprint, severity-ordered; FB-4 additionally clears PC-4 so
the FK repoint sprint becomes schedulable afterward.

## Ratification Log

_(gate cards land here as they resolve)_

## Blockers

_None._

## Activity Log

### 2026-06-12 — backend — FB-1 (round-edit-markers) DONE · commit 4b095cf
- Added `edited_fields TEXT NOT NULL DEFAULT '[]'` column to `rounds` via idempotent boot migration (`client.ts`)
- `upsertRound` ON CONFLICT now guards `name`/`description`/`spotify_playlist_url` with `instr(rounds.edited_fields,'"fieldname"') > 0` CASE — ZIP values skip protected fields
- `patchRound` stamps touched importer-overwritable field names into `edited_fields` after each write; `updateRound` does the same for `name`/`description`
- Private `markEditedFields` helper merges new names into the JSON array without duplicates
- 5 regression tests in `rounds.patch.test.ts` (C2 repro: patch name → upsertRound → name survives, untouched fields refresh; updateRound path; multi-field; deadline-only patch doesn't protect name)
- `npm run check`: 0 errors · `npx vitest run`: 187/187 green

### 2026-06-12 — backend — FB-5 (regen-skip-excluded) DONE · commit b38fcbb
- Whole-draft regenerate: extended filter from `state !== 'locked'` to `state !== 'locked' && state !== 'excluded'` (`api/digest/[roundId]/regenerate/+server.ts`)
- Single-section regenerate: added `if (section.state === 'excluded') throw error(400, 'section is excluded')` matching the locked guard (`api/digest/[roundId]/sections/[id]/regenerate/+server.ts`)
- New test file `ui/src/lib/digest/regen-skip-excluded.test.ts`: 3 tests verify only 'default' sections are regenerable, excluded section regen_count/content_json stay unchanged, and state string is 'excluded' for the single-section guard
- `npm run check`: 0 errors · `npx vitest run`: 187/187 green

### 2026-06-13 — docs — Sprint plan authored: collision fixes FB-1..FB-5
- created sprint-27 coord-doc; `## Active Sprint Plan` body has 8 tasks
- 5 backend (one per FB item) / 2 frontend (repro re-runs + UI consistency pass) / 1 orc gate
- deps: collision-reverify ← the three C-fix tasks; ui-consistency-pass ← active-round-unify; gate ← all
- verification harness = re-running the sprint-26 `inventory/collisions.md` repro steps
