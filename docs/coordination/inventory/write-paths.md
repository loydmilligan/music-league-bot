# Write-Path Inventory & Active-Round Derivation Audit

**Sprint:** sprint-26 · **Tasks:** write-path-inventory, active-derivation-audit
**Author:** backend-agent · **Date:** 2026-06-12

---

## Section 1 — Write-Path Inventory

Every code path that INSERTs or UPDATEs `rounds`, `seasons`, or `leagues` (and the `settings` KV rows that stand in for a `next_round_overrides` table).

> **Note on `next_round_overrides`:** No dedicated table exists. The next-round pin is stored in the `settings` table under key `next_round_override:<leagueId>`. Write paths for that key are included as W13.

### Table

| # | Writer | Surface | File : line | Fields Written | Trigger | Collision Notes |
|---|--------|---------|-------------|---------------|---------|-----------------|
| **W1** | `importZipData` — ZIP import | Settings page form action (`importZip`) or `/api/digest/:roundId/import-export-zip` (step 4) | `ui/src/lib/import/importer.ts:36-57` | `seasons.status` (via `inferSeasonStatus`), `rounds.ml_round_id/name/description/spotify_playlist_url` (upsert, no deadline update) | User uploads ZIP on settings page; digest prepare button | **Sprint-25 finding 1**: `inferSeasonStatus` re-derives `status` from vote coverage on every import. A manually-completed season with any unvoted round is re-set to `active`. No override guard exists. Also conflicts with W6 (manual flip), W7/W8 (every re-import stomps). |
| **W2** | `importLiveRoundsData` — CLI bridge snapshot | `/api/digest/:roundId/import-export-zip` (step 3, before ZIP) | `ui/src/lib/import/importer.ts:64-100` | `seasons.status` (writes `active` first at line 76, then re-derives at line 94), `rounds.ml_round_id/name/description/spotify_playlist_url/submission_deadline/voting_deadline` (full upsert via `upsertRoundWithDeadlines`) | Automatic during digest prepare: triggers `GET /rounds-snapshot` from CLI bot container | **Collision with W6/W7/W8**: always writes `active` to the season (line 76) before any round processing — this clobbers any manual `complete` flip even before the ZIP import arrives. Also overwrites deadlines (W3/W4/W5) when ML returns non-null deadlines (`COALESCE(?, existing)` in upsertRoundWithDeadlines means ML non-null wins). |
| **W3** | `patchRound` + `updateRound` — round edit API | `/api/rounds/:roundId` (PATCH) | `ui/src/routes/api/rounds/[roundId]/+server.ts:106-107`; `ui/src/lib/db/rounds.ts:121` (`patchRound`), `156` (`updateRound`) | `rounds.name`, `rounds.description`, `rounds.submission_deadline`, `rounds.voting_deadline`, `rounds.spotify_playlist_url`, `rounds.tag`, `rounds.theme_submitted_by`, `rounds.round_number` | User edits round in the setup screen rounds table | **Collision with W1**: a subsequent ZIP import upserts `name/description/playlist` (no deadline fields in W1's `upsertRound`). **Collision with W2**: a subsequent live snapshot can overwrite deadlines. **Collision with W14**: the digest next-round editor stores *overrides* in `digest_drafts`, not the `rounds` table — W3 edits the source, but the draft override silently wins in the digest view until the draft is regenerated. |
| **W4** | `updateDeadlines` — auto-fill API | `/api/deadlines/auto-fill` (POST) | `ui/src/routes/api/deadlines/auto-fill/+server.ts:58`; `ui/src/lib/db/rounds.ts:173` | `rounds.submission_deadline`, `rounds.voting_deadline` (all rounds in a season, bulk) | User clicks "Auto-fill deadlines" in settings | **Collision with W2**: bulk-writes all deadlines; a subsequent live snapshot import that returns non-null ML deadlines will re-overwrite. **Collision with W5**: both write the same columns via different entry points with no coordination. |
| **W5** | `updateDeadlines` — settings page form action | `/settings` form action `updateDeadline` | `ui/src/routes/settings/+page.server.ts:78`; `ui/src/lib/db/rounds.ts:173` | `rounds.submission_deadline`, `rounds.voting_deadline` (individual round; `undefined`=leave-alone on empty) | User edits a deadline cell in the settings page table | Same collision set as W4 (W2 can re-overwrite; W3/W4 can race). |
| **W6** | `setSeasonStatus` — season status mgmt API | `/api/leagues/:leagueId/seasons/:seasonId` (PATCH) | `ui/src/routes/api/leagues/[leagueId]/seasons/[seasonId]/+server.ts:23`; `ui/src/lib/db/leagues.ts:56` | `seasons.status` | Admin flips season status in setup UI | **Primary collision (sprint-25 finding 1)**: any subsequent ZIP import (W1), live snapshot import (W2), or `ml-rebuild.mjs --apply` (W15) will re-derive and overwrite status. No `status_source` or override guard. A `complete` flip re-activated itself in prod (Nostalgia Pit, sprint-25 gate-2). |
| **W7** | `upsertSeason` (ZIP path) | Called by W1 (`importer.ts:37`) | `ui/src/lib/db/leagues.ts:49-53`; call at `importer.ts:37` | `seasons.status` (ON CONFLICT DO UPDATE sets the newly-inferred value) | Part of W1 flow | Same as W1 — `inferSeasonStatus` re-runs every ZIP import and the UPSERT overwrites whatever is stored. |
| **W8** | `upsertSeason` (live-round path) | Called by W2 (`importer.ts:76,94`) | `ui/src/lib/db/leagues.ts:49-53`; calls at `importer.ts:76,94` | `seasons.status` (written twice: first `active` at line 76, then re-derived at line 94) | Part of W2 flow | Two `upsertSeason` calls per import. Line 76 unconditionally forces `active`; line 94 re-derives. If the re-derived value is `complete` the final write is correct, but the first write at line 76 already clobbered any manual flip for the duration of the transaction. |
| **W9** | `seedLeagues` — boot seed + rescan | Boot (`openLeagueDb` → `runStartupImport`) and settings "Rescan" action | `ui/src/lib/db/leagues.ts:12-16`; `ui/src/lib/import/startupScan.ts:18` | `leagues.slug`, `leagues.name` (ON CONFLICT(slug) updates `name` only) | Container boot; user clicks "Rescan" in settings | **Low collision**: only updates `name`. Does not touch `is_active`, `active_round_id`, `exclude_from_combined`. |
| **W10** | `markLeagueActive` — league active toggle | `/api/leagues/:leagueId/active` (PATCH) | `ui/src/routes/api/leagues/[leagueId]/active/+server.ts:19`; `ui/src/lib/db/activeRound.ts:85` | `leagues.is_active` | Admin marks league active/inactive in setup UI | Low collision: `is_active` is purely the manual flag; derived "active" logic in `getActiveSeasonId` is an OR of `is_active` OR season live-round check. The two don't conflict — they combine. |
| **W11** | `setActiveRound` — active-round slot | `/api/leagues/:leagueId/active-round` (PUT / DELETE) | `ui/src/routes/api/leagues/[leagueId]/active-round/+server.ts:24,40`; `ui/src/lib/db/activeRound.ts:101` | `leagues.active_round_id` | Admin sets/clears manual active-round pin in setup UI | **Potential collision**: the pinned round's deadlines can be edited by W3/W4/W5 or overwritten by W2 without invalidating the pin. The pin stays pointing to the same round (which is correct for identity) but the round's display data may have changed under it. |
| **W12** | `createRoundWithDeadlines` — manual round create | `/api/leagues/:leagueId/rounds` (POST); optionally also writes `leagues.active_round_id` if `set_active=true` | `ui/src/routes/api/leagues/[leagueId]/rounds/+server.ts:54`; `ui/src/lib/db/activeRound.ts:208-221` | `rounds.*` (INSERT with `manual:<seasonId>:<ts>` ml_round_id), optionally `leagues.active_round_id` | Admin creates a round in setup UI | **Known manual-first gotcha** (documented at `activeRound.ts:189`): if ML later imports a round with the same name, it arrives under a real `ml_round_id` → duplicate row, different id. Must be resolved manually. |
| **W13** | `settings` KV upsert — next-round pin | `/api/leagues/:leagueId/next-round` (PATCH / DELETE) | `ui/src/routes/api/leagues/[leagueId]/next-round/+server.ts:33-37` | `settings.value` (key `next_round_override:<leagueId>`); DELETE clears it | Admin pins/clears the "next round" in setup or digest UI | **Conceptual collision with W14**: this KV pin selects *which* round is "next" in the shortlist/setup view. The digest next-round section independently reads `getNextRound()` (chronological) + draft overrides — the KV pin is never consulted by the digest rendering path. Two independent "next round" concepts; see divergence matrix row D5/D7. |
| **W14** | `digest_drafts` next-round fields | `/api/digest/:roundId/next-round` (PATCH) | `ui/src/routes/api/digest/[roundId]/next-round/+server.ts:89`; the `UPDATE digest_drafts SET ...` | `digest_drafts.next_round_excluded`, `digest_drafts.next_round_theme_override`, `digest_drafts.next_round_sub_deadline_override`, `digest_drafts.next_round_vote_deadline_override` | User edits next-round block in the digest editor | **Collision with W3/W4/W5**: these overrides are stored in `digest_drafts`, not `rounds`. W3/W4/W5 edit the `rounds` source; the draft override silently wins in the digest view, masking the updated rounds-table value until the draft is regenerated. |
| **W15** | `ml-rebuild.mjs --apply` | CLI script | `scripts/ml-rebuild.mjs:160,164,183` | `seasons.status` (unconditionally sets `active` at line 160), `rounds.ml_round_id/name/description/spotify_playlist_url/submission_deadline/voting_deadline` (UPDATE via COALESCE for deadlines) | Manual: `node scripts/ml-rebuild.mjs --apply` | **Highest-risk collision**: always sets `seasons.status = 'active'` unconditionally (no COALESCE guard, no status check). Clobbers any manual `complete` flip. Same sprint-25 finding 1 pattern, amplified — the operator must remember to re-flip after running this script. |
| **W16** | `ml-reconcile.mjs --apply` | CLI script | `scripts/ml-reconcile.mjs:157` | `rounds.ml_round_id/name/description/submission_deadline/voting_deadline` (UPDATE via `COALESCE(?, existing)`) | Manual: `node scripts/ml-reconcile.mjs --apply` | **Collision with W3/W4/W5**: COALESCE means null ML deadline preserves, but non-null ML deadline overwrites. A deadline hand-edited via W3/W5 that ML also has a value for will be clobbered. |
| **W17** | `import-round-csv.mjs` | CLI script | `scripts/import-round-csv.mjs:115` | `rounds.*` (INSERT only; skips existing by name match) | Manual: `node scripts/import-round-csv.mjs` | **Low collision**: INSERT-only with name-match skip. Does not update deadlines or other fields on existing rows. |
| **W18** | Boot migration backfill: `leagues.is_active` | Container boot (one-shot) | `ui/src/lib/db/client.ts:100` | `leagues.is_active = 1` for leagues with an active season | Container first boot after column added | **One-shot**: nested in column-add guard; only fires once per DB. No ongoing collision. |
| **W19** | Boot migration backfill: `rounds.theme_submitted_by` | Container boot (runs every boot but guarded) | `ui/src/lib/db/client.ts:225` | `rounds.theme_submitted_by` (backfill from `theme_chooser_id` → competitor → player) | Container boot (WHERE guard: only unlinked rows with `theme_chooser_id` set) | **Low ongoing risk**: WHERE guard limits effect to rows not yet backfilled. Currently 0 rows on prod (per sprint-25 note). |

---

### Cross-check: grep coverage

The following command was used to verify completeness:

```
grep -rn "UPDATE rounds\|UPDATE seasons\|UPDATE leagues\|INSERT INTO rounds\|INSERT INTO seasons\|INSERT INTO leagues" ui/src scripts --include="*.ts" --include="*.js" --include="*.mjs"
```

**Every hit is covered above or justified as excluded:**

| Hit | Disposition |
|-----|------------|
| `ui/src/lib/db/activeRound.test.ts:164` | Test fixture — not production code |
| `ui/src/lib/db/digestData.test.ts:17` | Test fixture — not production code |
| `ui/src/lib/shortlist/shortlist.test.ts:125-126` | Test fixture — not production code |
| `ui/src/lib/db/leagues.ts:13` | → W9 |
| `ui/src/lib/db/leagues.ts:50` | → W7/W8 (upsertSeason) |
| `ui/src/lib/db/leagues.ts:56` | → W6 (setSeasonStatus) |
| `ui/src/lib/db/rounds.ts:26` | → W7 (upsertRound via W1) |
| `ui/src/lib/db/rounds.ts:41` | → W8 (upsertRoundWithDeadlines via W2) |
| `ui/src/lib/db/rounds.ts:121` | → W3 (patchRound) |
| `ui/src/lib/db/rounds.ts:156` | → W3 (updateRound) |
| `ui/src/lib/db/rounds.ts:173` | → W4/W5 (updateDeadlines) |
| `ui/src/lib/db/activeRound.ts:85` | → W10 (markLeagueActive) |
| `ui/src/lib/db/activeRound.ts:101` | → W11 (setActiveRound) |
| `ui/src/lib/db/activeRound.ts:208` | → W12 (createRoundWithDeadlines) |
| `ui/src/lib/db/client.ts:100` | → W18 (boot backfill) |
| `ui/src/lib/db/client.ts:225` | → W19 (boot backfill) |
| `scripts/ml-rebuild.mjs:160,164,183` | → W15 |
| `scripts/ml-reconcile.mjs:157` | → W16 |
| `scripts/import-round-csv.mjs:115` | → W17 |
| `scripts/backfill-popularity.ts:*` | Excluded: writes `song_popularity` table only — not in scope. |

**The two known collision cases** from the sprint mandate each have a filled collision-notes cell:
- Multiple round-edit paths: W3 vs W14 (deadlines in rounds vs. draft overrides), W3 vs W2 (deadline overwrite on re-import).
- Season-status writers: W6 vs W1/W2/W8/W15 (the sprint-25 finding 1 pattern).

---

## Section 2 — Active-Round Derivation Audit

Every site that decides a league's "active", "current", or "next" round, plus a divergence matrix.

### Derivation Sites

| # | Site | File : line | Inputs | Precedence / Rule |
|---|------|-------------|--------|-------------------|
| **D1** | `resolveActiveRound` | `ui/src/lib/db/activeRound.ts:104-130` | `leagues.active_round_id`, `getActiveSeasonId()` output → `getCurrentRoundForSeason()` | (1) `active_round_id` if set and resolves to a real round → returns `source:'manual'`; (2) `getCurrentRoundForSeason(activeSeasonId)` if phase≠`archive` → returns `source:'derived'`; (3) null |
| **D2** | `getActiveSeasonId` | `ui/src/lib/db/activeRound.ts:69-81` | `seasons.status`, `getCurrentRoundForSeason()` → round phases | Walks seasons DESC by `season_number`. Returns the first season where `status='active'` **OR** `seasonHasLiveRound()` (any round phase≠archive). Falls through to null if none qualify. |
| **D3** | `layout.ts:getAllAdoptedLeagues` active-season lookup | `ui/src/lib/db/layout.ts:64-73` | `seasons.status` only (SQL subquery) | SQL: `SELECT s.id WHERE status='active' ORDER BY season_number DESC LIMIT 1`. **No live-round fallback.** Result used to drive the nav-rail status label. |
| **D4** | `layout.ts:pickCurrentRound` | `ui/src/lib/db/layout.ts:36-49` | Season's rounds + phase map (from `getRoundPhasesForSeason`) | Priority: submission(0) > voting(1) > upcoming(2) > archive(3); ties broken by latest `created_at`. **Ignores `leagues.active_round_id` entirely.** |
| **D5** | `nextRound.ts:getNextRound` | `ui/src/lib/db/nextRound.ts:16-54` | Current round id → fetches all rounds in the league (across all seasons) ordered by `season_number, rounds.id` | Returns `rounds[idx+1]` where `idx` = index of current round in the full ordered list. Crosses season boundaries. No active-season concept. |
| **D6** | `digest/:roundId/next-round` GET | `ui/src/routes/api/digest/[roundId]/next-round/+server.ts:28-64` | `getNextRound()` output + `digest_drafts.next_round_*` override columns | Draft override wins per field when non-null: `theme_override ?? computed.theme`, `sub_deadline_override ?? computed.submissionDeadline`, etc. Excluded flag suppresses the whole section. |
| **D7** | `/api/leagues/:leagueId/next-round` GET | `ui/src/routes/api/leagues/[leagueId]/next-round/+server.ts:43-49` | `settings` KV: key `next_round_override:<leagueId>` | Returns the admin-pinned round id (or null if no pin). **Entirely separate from D5/D6.** The KV pin is never read by the digest next-round computation. |
| **D8** | `getOpenRounds` (shortlist assign popover) | `ui/src/lib/shortlist/shortlist.ts:91-102` | `getActiveLeaguesActiveRounds()` → `resolveActiveRound()` per active league | Delegates to D1/D2 chain. Returns the `activeRound` for each active league. Consistent with D1. |
| **D9** | `buildLeagueActiveRound:needsNextRound` | `ui/src/lib/db/activeRound.ts:141` | `leagues.active_round_id`, `getActiveSeasonId()` → all rounds in active season → phases | `needsNextRound = !manualRound && availableRounds.length > 0 && all rounds archived`. Signals the "no live round — pick/create" UI state. |
| **D10** | Live-round repair path (`importLiveRoundsData` from `import-export-zip`) | `ui/src/routes/api/digest/[roundId]/import-export-zip/+server.ts:144-199`; `ui/src/lib/import/importer.ts:64-100` | ML CLI snapshot response (`/rounds-snapshot`), current season status | Runs before ZIP import during digest prepare. Sets `seasons.status='active'` (W8), imports round deadlines. When `needsNextRound` (D9) is true, this path may create or update rounds in the active season, changing what D1/D2 resolve afterward. |

### Divergence Matrix

| Pair | Verdict | Condition |
|------|---------|-----------|
| **D2 `getActiveSeasonId` vs D3 `layout.ts` active-season lookup** | **CAN-DIVERGE** | D2 includes seasons where `status='complete'` but some round has `phase≠archive`; D3 only looks at `status='active'`. A manually-completed season (`W6`) with non-archived rounds is "active" to D2 but shows `active_season_id=null` in D3. Nav rail goes idle; active-rounds panel still resolves a round. |
| **D1 `resolveActiveRound` vs D4 `layout.ts:pickCurrentRound`** | **CAN-DIVERGE** | D1 checks `leagues.active_round_id` first (manual pin); D4 ignores `active_round_id` entirely, always picking phase-derived current round. A manually pinned round (`W11`) shows as active in D1/D8 but D4 shows whatever round the deadline math makes current, which may be a different round. |
| **D5 `getNextRound` vs D7 `/api/leagues/:id/next-round` KV pin** | **CAN-DIVERGE** | Always diverge if admin has set a KV pin (W13). `getNextRound` is chronological; the KV pin is arbitrary. The digest (D6) uses D5; the setup next-round pin uses D7. These are two independent "next round" concepts with no shared authority. |
| **`leagues.is_active` flag vs D2 season-derived active** | **CAN-DIVERGE** | `is_active=1` marks a league active even if all its seasons are `complete` and every round is archived (e.g. a manually activated league awaiting a new import). D2's `getActiveSeasonId` returns null for that league (no active/live season). The league shows `isActive=true` (via the OR in `buildLeagueActiveRound:147`) but `activeSeasonId=null`, so `activeRound=null` and `availableRounds=[]`. Result: league appears in active-rounds panel with the "no active round" modal, but `getOpenRounds` (D8) filters it out (since `activeRound==null`). |
| **D9 `needsNextRound` vs D10 live-round repair path** | **CAN-DIVERGE** | `needsNextRound` can be true (all rounds archived, no pin) while the repair path has not yet run. The repair path only fires during a digest prepare for that league's round — it does not self-trigger when `needsNextRound` is detected. So a league with `needsNextRound=true` stays in that state until a user initiates a digest prepare cycle. |
| **W1/W2 `inferSeasonStatus` vs W6 `setSeasonStatus`** | **CAN-DIVERGE** | Any re-import (W1/W2) or `ml-rebuild.mjs --apply` (W15) re-derives status and overwrites. No guard. This is the **live sprint-25 finding 1** bug: manual `complete` flip → next import sets back to `active`. |
| **D6 digest next-round vs D7 KV pin** | **CAN-DIVERGE** | The digest next-round section (D6) computes from chronological order + draft overrides. The KV pin (D7) is consumed by setup/shortlist UI. If admin pinned round N+2 as "next" in D7, the digest still shows round N+1 (the chronological successor). They are independently managed. |
| **D1 `resolveActiveRound` vs D8 `getOpenRounds`** | **AGREES** | Both call `getActiveLeaguesActiveRounds()` which calls `resolveActiveRound()`. Identical derivation path. |
| **D5 `getNextRound` vs D6 digest next-round GET** | **AGREES** (with extension) | D6 calls D5 first, then applies draft overrides. Without draft overrides, they agree. With overrides, D6 departs from D5 for specific fields (theme, deadlines). |

---

## Appendix — Key Function Cross-Reference

| Function | File | Called by |
|----------|------|-----------|
| `inferSeasonStatus` | `importer.ts:19` | W1 (importZipData) |
| `upsertSeason` | `leagues.ts:49` | W7/W8 via importer; W15 directly |
| `setSeasonStatus` | `leagues.ts:55` | W6 via API route |
| `upsertRound` | `rounds.ts:23` | W1 (ZIP: no deadline fields) |
| `upsertRoundWithDeadlines` | `rounds.ts:32` | W2 (live snapshot: full fields including deadlines) |
| `patchRound` | `rounds.ts:106` | W3 via `/api/rounds/:id` |
| `updateRound` | `rounds.ts:139` | W3 via `/api/rounds/:id` |
| `updateDeadlines` | `rounds.ts:160` | W4 (auto-fill API), W5 (settings form) |
| `markLeagueActive` | `activeRound.ts:84` | W10 via `/api/leagues/:id/active` |
| `setActiveRound` | `activeRound.ts:93` | W11 via `/api/leagues/:id/active-round`; W12 if `set_active=true` |
| `createRoundWithDeadlines` | `activeRound.ts:192` | W12 via `/api/leagues/:id/rounds` |
| `getActiveSeasonId` | `activeRound.ts:69` | D2; called from `buildLeagueActiveRound`, `createRoundWithDeadlines` |
| `resolveActiveRound` | `activeRound.ts:104` | D1; called from `buildLeagueActiveRound` |
| `getNextRound` | `nextRound.ts:16` | D5; called from `/api/digest/:id/next-round` GET |
| `getOpenRounds` | `shortlist.ts:91` | D8; called from `/api/rounds/open` |
| `seedLeagues` | `leagues.ts:12` | W9; boot + rescan |
| `importZipData` | `importer.ts:30` | W1; settings + import-export-zip |
| `importLiveRoundsData` | `importer.ts:64` | W2; import-export-zip (step 3) |
