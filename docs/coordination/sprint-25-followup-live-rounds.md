# Sprint 25 Follow-up: live round import + active-round picker

## Read me first

This note is the resume point for the current follow-up work. If context is low, start here:

- [docs/coordination/sprint-25.md](./sprint-25.md)
- [ui/src/lib/db/activeRound.ts](/home/loydmilligan/Projects/music-league-bot/ui/src/lib/db/activeRound.ts)
- [ui/src/lib/import/importer.ts](/home/loydmilligan/Projects/music-league-bot/ui/src/lib/import/importer.ts)
- [scripts/ml-auth-trigger.mjs](/home/loydmilligan/Projects/music-league-bot/scripts/ml-auth-trigger.mjs)
- [scripts/ml-reconcile.mjs](/home/loydmilligan/Projects/music-league-bot/scripts/ml-reconcile.mjs)

## Problem statement

There are two related issues to finish before sprint 25 can move on cleanly:

1. The export/import path is incomplete. `export.zip` does not reliably contain all live rounds, especially rounds that are still in submission/voting or only visible through the CLI/browser automation path. The app needs to use the existing CLI bridge to recover live round metadata instead of trusting ZIP contents alone.
2. The active-round picker hides a live Hip Jammers season. Hip Jammers season 3 has a round in `voting`, but the UI does not offer it because the DB still marks that season `complete`, and the picker currently keys off `seasons.status='active'`.

These are the same class of bug from two angles: the DB is stale, and the live source of truth is being underused.

## Current understanding

- The active-round UI reads from `/api/active-rounds`, which comes from `ui/src/lib/db/activeRound.ts`.
- `getActiveSeasonId()` currently finds seasons only by `status='active'`.
- `getActiveSeasonsWithLeague()` in `ui/src/lib/db/leagues.ts` has the same assumption.
- The import path in `ui/src/lib/import/importer.ts` infers season completion from parsed ZIP data alone.
- `scripts/ml-auth-trigger.mjs` already has the host-side CLI bridge for export.
- `scripts/ml-reconcile.mjs` already proves the CLI can surface live round data via `rounds themes` and `rounds list`.

Observed DB state for the Hip Jammers case:

- Hip Jammers season 3 exists in the DB.
- Round 107 is currently `voting`.
- The season row is still `complete`.
- Because of that, the active-round picker does not surface that season as active.

## What I am going to do

### 1. Add a regression test for stale season state

Write a focused test that shows the failure mode directly:

- a season is stored as `complete`
- one of its rounds is still live (`submission` or `voting`)
- the active-round derivation must still surface the league as active enough for the picker to work

This test should fail before the fix so we know we are not just changing the symptom.

### 2. Fix active-season derivation

Update the active-round selection logic so it does not depend exclusively on `seasons.status='active'` when a live round is present.

The intended behavior:

- manual active round still wins
- otherwise use the current live round if one exists
- otherwise, if the season is stale but has live rounds, treat it as active for picker purposes
- if every round is archived, surface `needsNextRound` instead of an archived round

The UI should be able to show the Hip Jammers live round without requiring a manual DB repair.

### 3. Add live-round reconciliation to the import/export flow

Use the CLI/browser automation path to pull live round metadata before or alongside ZIP import.

The likely shape:

- call the host CLI bridge from the import endpoint
- ask the CLI for live league round data, not just `export.zip`
- merge or upsert that live data into the DB before computing the next-round / active-round views

The goal is not to replace the ZIP export. The goal is to stop treating ZIP contents as the only source of truth for rounds that are still changing.

### 4. Keep the UI and data model aligned

Once the backend data is corrected, make sure:

- `/api/active-rounds` returns the live Hip Jammers round
- the picker list includes that round
- the digest next-round display still shows the correct deadlines
- the home page and settings screen remain consistent with the same source of truth

## Implementation order

1. Test first
2. Fix active-season derivation
3. Add CLI-based live round reconciliation
4. Verify the active-round picker on the real data set
5. Run `ui` tests and checks

I am intentionally not bundling unrelated player CRUD work into this pass. The current goal is to make live round visibility correct and reliable.

## Verification target

I will treat this as done when the following are true:

- Hip Jammers season 3 appears in the active-round UI with its voting round
- the round picker list includes the live round
- `export.zip` no longer has to be perfect for the UI to recover live round state
- `cd ui && npx vitest run` passes
- `cd ui && npm run check` passes

## Files likely to change

- `ui/src/lib/db/activeRound.ts`
- `ui/src/lib/db/leagues.ts`
- `ui/src/lib/import/importer.ts`
- `ui/src/routes/api/digest/[roundId]/import-export-zip/+server.ts`
- `scripts/ml-auth-trigger.mjs`
- tests under `ui/src/lib/*/*.test.ts`

## Notes for a resume session

The most important detail is that this is not just a UI bug. The picker is failing because the DB is stale, and the stale state comes from trusting ZIP data too much. Fixing only one side will leave the other side brittle.
