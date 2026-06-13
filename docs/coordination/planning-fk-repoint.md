# FK Hard-Repoint Sprint — Planning Doc

**Written by:** backend-agent · **Sprint:** sprint-26 · **Task:** repoint-groundwork
**Date:** 2026-06-12
**Purpose:** Pre-planning intelligence for the future sprint that promotes `player_id`
from additive/nullable backfill to the primary join column in gameplay tables.

---

## Background

Sprint-25 added `player_id` columns additively to `ml_submissions`, `votes`, and
`season_standings` (boot migration, `client.ts:200-225`). These columns hold a
direct FK to `players.id` for any row whose submitter/voter's competitor has been
linked. They are NOT yet the query path — all read-side code still joins through
`competitor_id`/`voter_id → competitors → players`.

The hard-repoint sprint changes the dominant read path to `player_id` for
player-level aggregation, enabling cross-account merges (one player → many
competitors) and removing the intermediate competitor hop from hot queries.
The `competitor_id`/`voter_id` columns stay — they preserve per-account identity
and anchor the dedup UNIQUE constraints.

---

## Section 1 — Read-Site Inventory

Every read site that joins gameplay tables through `competitor_id` or `voter_id`.
Cross-checked against:

```
grep -rn 'competitor_id\|voter_id' ui/src/lib --include='*.ts'
```

### R1 — `playerHistory.ts` (player history feature)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R1a | `ui/src/lib/db/playerHistory.ts:54` | `JOIN competitors c ON c.id = m.competitor_id` — fetches all submissions for a player by first finding their competitor ids | **YES** — inner loop currently fetches competitor ids for a player, then filters by `m.competitor_id IN (...)`. Replace with `WHERE m.player_id = ?` |
| R1b | `ui/src/lib/db/playerHistory.ts:95` | `JOIN competitors c ON c.id = v.voter_id` — same pattern for votes | **YES** — replace with `WHERE v.player_id = ?` |
| R1c | `ui/src/lib/db/playerHistory.ts:167` | `JOIN competitors c ON c.id = m.competitor_id` — competitor song list for a player's history page | **YES** — same two-step competitor-collect-then-filter pattern; `player_id = ?` collapses it |
| R1d | `ui/src/lib/db/playerHistory.ts:171` | `WHERE m.competitor_id IN (${placeholders})` — filter clause for the above | **YES** — consequent of R1c; single `WHERE m.player_id = ?` replaces both |

**Repoint impact:** `playerHistory.ts` is the highest-value target. The
current pattern requires two SQL round-trips (fetch competitor ids for player,
then query submissions by those ids). After repoint: single query with
`WHERE m.player_id = ?`.

---

### R2 — `standings.ts` (standings calculation and read)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R2a | `ui/src/lib/db/standings.ts:73` | `SELECT m.competitor_id AS cid, c.name AS name, COALESCE(SUM(v.points), 0) AS pts` | **YES** (behavior change) — currently groups by competitor, yielding per-account standings. Repoint to `GROUP BY m.player_id` merges multi-account players. Behavioral change must be explicit in repoint sprint scope. |
| R2b | `ui/src/lib/db/standings.ts:75` | `JOIN competitors c ON c.id = m.competitor_id` — name lookup | **YES** — after repoint, `JOIN players p ON p.id = m.player_id` for name |
| R2c | `ui/src/lib/db/standings.ts:77-78` | `WHERE m.competitor_id IS NOT NULL GROUP BY m.competitor_id` | **YES** — becomes `WHERE m.player_id IS NOT NULL GROUP BY m.player_id` |
| R2d | `ui/src/lib/db/standings.ts:136` | INSERT to `season_standings(season_id, round_id, competitor_id, ...)` — write path, storing the result | **YES (schema change)** — see Section 3. The `season_standings` table PK is `(round_id, competitor_id)`; a player-level table needs a different PK |
| R2e | `ui/src/lib/db/standings.ts:153,157,161` | SELECT from `season_standings` with `competitor_id` field | **YES (consequent of R2d)** — once schema changes, these reads follow |

**Note:** Repointing standings changes semantics: two competitors sharing one
player would have their points summed. This is the intended end state but must be
explicitly decided in scope — the digest currently renders per-competitor rows and
would show merged player rows instead.

---

### R3 — `seasonData.ts` (season view data)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R3a | `ui/src/lib/db/seasonData.ts:175` | `LEFT JOIN competitors c ON c.id = m.competitor_id` — submission listing, gets competitor name per submission | **NO (keep)** — competitor-level display is correct here; each submission is shown under the account that submitted it |
| R3b | `ui/src/lib/db/seasonData.ts:177` | `WHERE m.competitor_id IS NOT NULL` — filter for identified submissions | **NO** — this filter intent survives post-repoint; `competitor_id IS NOT NULL` still means "identified submission" (vs. anonymous playlist-ingest row) |
| R3c | `ui/src/lib/db/seasonData.ts:293` | `JOIN competitors cv ON cv.id = v.voter_id` — voter name on vote rows | **NO (keep)** — per-vote display; voter identity is per competitor account |

---

### R4 — `roundStats.ts` (round statistics)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R4a | `ui/src/lib/db/roundStats.ts:17` | `COUNT(DISTINCT competitor_id) AS n FROM ml_submissions WHERE round_id = ? AND competitor_id IS NOT NULL` — participant count | **DECISION NEEDED** — currently counts competitors (accounts). After repoint, `COUNT(DISTINCT player_id)` counts players. Semantics differ if any player has two accounts in the same round. Today: no such case (29 competitors → 29 players, 1:1 except unknowns). Flag for scope decision. |
| R4b | `ui/src/lib/db/roundStats.ts:25` | `WHERE m.competitor_id IS NOT NULL` — filter for identified submissions in stats query | **NO** — filter intent unchanged; keep as-is |

---

### R5 — `digest/llm.ts` (LLM context builder)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R5a | `ui/src/lib/digest/llm.ts:102` | `LEFT JOIN competitors c ON c.id = m.competitor_id` — builds submission context for LLM prompt | **NO** — competitor-level name resolution for prompt text; keeps attribution at account level |
| R5b | `ui/src/lib/digest/llm.ts:123` | `JOIN competitors c ON c.id = v.voter_id` — voter names in LLM vote context | **NO** — same rationale |

---

### R6 — `songHistory.ts` (song history feature)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R6a | `ui/src/lib/db/songHistory.ts:81` | `LEFT JOIN competitors c ON c.id = m.competitor_id` — main song history query, gets submitter name | **NO** — per-submission attribution stays at competitor level |
| R6b | `ui/src/lib/db/songHistory.ts:114-115` | `JOIN competitors c ON c.id = m.competitor_id WHERE c.ml_competitor_id = ?` — finds "my submissions" by ml_competitor_id | **NO** — identity for "me" is by ML account (ml_competitor_id), not player. This is personal-account-scope filtering and should remain. |

---

### R7 — `themeHistory.ts` (theme chooser history)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R7a | `ui/src/lib/db/themeHistory.ts:63` | `LEFT JOIN competitors c ON c.id = m.competitor_id` — gets submitter name for theme attribution | **NO** — competitor-level display |

---

### R8 — `research.ts` (song research / "am I the only one who submitted this?")

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R8a | `ui/src/lib/db/research.ts:25` | `JOIN competitors c ON ms.competitor_id=c.id WHERE c.ml_competitor_id=?` — checks if the owner previously submitted this song | **NO** — identity is by ML account; correct to stay account-scoped |
| R8b | `ui/src/lib/db/research.ts:27` | `WHERE c.ml_competitor_id=?` — same query's filter | **NO** — consequent of R8a |
| R8c | `ui/src/lib/db/research.ts:31` | `ms.competitor_id != (SELECT id FROM competitors WHERE ml_competitor_id=?)` — excludes own submission from "others who submitted" | **NO** — account-scoped identity check |

---

### R9 — `discoverability.ts` (cross-round song discoverability)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R9a | `ui/src/lib/db/discoverability.ts:92` | `JOIN competitors c ON c.id = m.competitor_id` — submitter name for discoverability query | **NO** — competitor-level display |
| R9b | `ui/src/lib/db/discoverability.ts:94` | `WHERE m.competitor_id IS NOT NULL` — excludes anonymous playlist-ingest rows | **NO** — filter intent unchanged |
| R9c | `ui/src/lib/db/discoverability.ts:158` | `WHERE m.competitor_id IS NOT NULL` — same filter in a variant query | **NO** — same |

---

### R10 — `submissions.ts` (submission listing)

| # | File : line | Query shape | Repoint required? |
|---|-------------|-------------|-------------------|
| R10a | `ui/src/lib/db/submissions.ts:41` | `JOIN competitors c ON s.competitor_id=c.id` — adds `submitter_name` to submission rows | **NO** — per-submission competitor name for display |

---

### Excluded hits (with reason)

| File : line(s) | Reason excluded |
|----------------|-----------------|
| `ui/src/lib/db/schema.ts:29-49` | Schema DDL — column definitions, not query sites |
| `ui/src/lib/db/client.ts:24-47,182-225` | Boot migrations (write paths; already in write-path inventory as W18/W19) |
| `ui/src/lib/db/competitors.ts:8,18-25` | Write path (`setCompetitorPlayerLink`, `resyncCompetitorPlayerIds`) — not a read site |
| `ui/src/lib/db/submissions.ts:5-6,15-28,34-36` | Write paths (`upsertCompetitor`, `upsertSubmission`, `upsertVote`) |
| `ui/src/lib/db/players.ts:36,69,175` | `ml_competitor_id` column on `players` table — separate concept; not a join through `competitor_id`/`voter_id` in gameplay tables |
| `ui/src/lib/import/playlistIngest.ts:9,53` | INSERT column list and comment — write path, not a read site |
| All `*.test.ts` files | Test fixtures — not production query paths |

---

## Section 2 — Preconditions Checklist

The hard-repoint sprint is safe only when ALL of these hold:

### PC-1 — All competitors linked to players
**Status: DONE** — all 29 existing competitors were linked manually by orc at
sprint-25 close via user-confirmed mapping. Every row in `competitors` has
`player_id != NULL`.
**Satisfying task:** sprint-25 gate close (manual action by orc).

### PC-2 — Re-sync live: link/unlink triggers immediate gameplay backfill
**Status: DONE** — `linking-api-resync` (sprint-26) ships `resyncCompetitorPlayerIds`
and `PATCH /api/competitors/:id`. Any link change now propagates to
`ml_submissions.player_id`, `votes.player_id`, and `season_standings.player_id`
instantly without a container reboot.
**Satisfying task:** sprint-26 `linking-api-resync` ✅

### PC-3 — Zero NULL `player_id` rows in gameplay tables
**Status: VERIFY before repoint sprint** — run the following against the live DB
before gating the repoint sprint:

```sql
SELECT 'ml_submissions' t, COUNT(*) nulls FROM ml_submissions WHERE player_id IS NULL AND competitor_id IS NOT NULL
UNION ALL
SELECT 'votes', COUNT(*) FROM votes WHERE player_id IS NULL
UNION ALL
SELECT 'season_standings', COUNT(*) FROM season_standings WHERE player_id IS NULL;
```

All three counts must be 0. If any row has a NULL `player_id` with a non-null
`competitor_id`/`voter_id`, the corresponding competitor was either added after
the boot backfill ran or the re-sync was not triggered.

### PC-4 — Importer writes `player_id` on new competitor rows ⚠️ MISSING

**Status: NOT MET** — `upsertCompetitor` in `submissions.ts:4-7` inserts
only `ml_competitor_id` and `name`. No `player_id` is written on new competitor
rows during a ZIP import. The boot backfill at `client.ts:182-210` is one-shot
(guarded by the column-add check) and will not fire for competitors added after
the initial migration.

**Effect:** Any new ML participant (e.g. Sarah Zucker's second account in Second
Best) that arrives via a future ZIP import will have `player_id = NULL` in
`ml_submissions` and `votes` until an operator uses the linking UI (sprint-26
`linking-ui`) to link the competitor and trigger `resyncCompetitorPlayerIds`.

**Required fix before repoint sprint:** Add auto-link logic to `upsertCompetitor`
(or call it from `importZipData`/`importLiveRoundsData`) — e.g.:

```sql
UPDATE competitors SET player_id = (
  SELECT p.id FROM players p WHERE p.ml_competitor_id = competitors.ml_competitor_id
) WHERE id = <newly-upserted-id> AND player_id IS NULL;
```

Then call `resyncCompetitorPlayerIds` for the newly-linked competitor. Without
this, PC-3 will degrade over time and the repoint sprint will need to re-run a
full backfill before it can proceed.

**Blocking:** YES — the repoint sprint should not begin until PC-4 is resolved and
PC-3 is verified at 0 nulls.

### PC-5 — Linking UI available for operator corrections
**Status: In-progress** — sprint-26 `linking-ui` task (frontend lane) will land
before the gate. Operators need a UI to link new competitors that PC-4's auto-link
misses (e.g. a competitor whose `ml_competitor_id` doesn't match any
`players.ml_competitor_id`).
**Satisfying task:** sprint-26 `linking-ui` (frontend lane).

---

## Section 3 — Per-Table Migration Steps

### Table: `ml_submissions`

Current state: `competitor_id` (nullable FK → `competitors.id`) + `player_id`
(nullable FK → `players.id`, additive from sprint-25 boot migration).

The UNIQUE constraint `UNIQUE(round_id, spotify_uri, competitor_id)` is NOT changed
— it is a dedup guarantee at the competitor-account level and must be preserved.

**Migration steps:**

1. **Precondition verify:** assert 0 rows with `player_id IS NULL AND competitor_id IS NOT NULL` (PC-3).
2. **New index:** `CREATE INDEX IF NOT EXISTS idx_ml_submissions_player ON ml_submissions(round_id, player_id)` — enables the `WHERE player_id = ?` and `GROUP BY player_id` query patterns at R1/R2 without a full scan.
3. **Read-site updates (see repoint list):** update `playerHistory.ts` R1a-R1d and `standings.ts` R2a-R2c to join via `player_id`.
4. **No column removal in this sprint** — `competitor_id` stays; it remains valid for display (who submitted per account) and for the anonymous-row filter (`competitor_id IS NULL`).

**Rollback:** Drop the new index. Revert the query changes in `playerHistory.ts` and `standings.ts`. No schema data loss — the `player_id` column is additive and was already there before the sprint.

---

### Table: `votes`

Current state: `voter_id` INTEGER NOT NULL FK → `competitors.id` + `player_id`
(nullable FK, additive from sprint-25 boot migration).

**Migration steps:**

1. **Precondition verify:** assert 0 rows with `player_id IS NULL` (PC-3 for votes — every vote has a voter; all voters must be linked).
2. **New index:** `CREATE INDEX IF NOT EXISTS idx_votes_player ON votes(round_id, player_id)`.
3. **Read-site updates:** update `playerHistory.ts` R1b to join via `player_id`. `seasonData.ts` R3c and `llm.ts` R5b stay on `voter_id` (they show per-account vote attribution).
4. **No column removal** — `voter_id` stays.

**Rollback:** Drop index. Revert `playerHistory.ts` query changes.

---

### Table: `season_standings`

Current state: PK `(round_id, competitor_id)` + `player_id` additive (nullable,
boot migration). This table is pre-computed standings written by `computeStandings`
in `standings.ts`.

This table requires the most careful migration because its PK encodes a semantic
choice (standings are per-competitor, not per-player).

**Option A — Add a parallel player-level standings table (recommended):**
- Leave `season_standings` (and its PK) untouched; it remains the digest gospel.
- Add `season_standings_by_player (season_id, round_id, player_id, name, …)` with
  `PRIMARY KEY (round_id, player_id)` as an aggregated view.
- The digest continues reading from `season_standings`; `/history?tab=players` reads
  from `season_standings_by_player`.
- No rollback risk to existing features.

**Option B — Change PK (breaking migration):**
- Rename `season_standings` → `season_standings_old`.
- Create new `season_standings` with `PRIMARY KEY (round_id, player_id)`.
- Backfill from `season_standings_old` (aggregate competitor rows for same player).
- Update all readers in `standings.ts` and the digest render path.
- **High risk:** digest rendering and historical data depend on this table; any gap
  in backfill breaks past digests.

**Recommendation:** Start with Option A. Revisit Option B in a follow-on sprint
once the player-level view is validated.

**Migration steps (Option A):**

1. Add new table `season_standings_by_player` via an idempotent boot migration.
2. Write a one-time backfill script: for each `(round_id, player_id)` group in the
   existing `season_standings`, aggregate `round_points` and `current_total`.
3. Update `computeStandings` to write to BOTH tables in a single transaction.
4. Update `/history?tab=players` reader to query `season_standings_by_player`.

**Rollback:** The new table is additive. Drop `season_standings_by_player` to
revert. `season_standings` is unchanged throughout.

---

### Tables that need no migration

| Table | Reason |
|-------|--------|
| `rounds` | Has `theme_submitted_by → players.id` (already direct FK, not through competitors) |
| `leagues`, `seasons` | No `competitor_id`/`voter_id` FK; not in scope |
| `competitors` | Keeps `player_id` column as the link; no query change needed here |
| `settings` KV | Not gameplay data |

---

## Section 4 — Go / No-Go Checklist

Before the repoint sprint may begin:

### Hard blockers (all must be YES to start)

- [ ] **PC-3 verified at zero:** query from Section 2 PC-3 returns 0 for all three tables on the live DB.
- [ ] **PC-4 fix merged:** `upsertCompetitor` auto-links new competitors on import; sprint-26 `linking-ui` allows manual correction of misses.
- [ ] **New index plan reviewed:** the indexes listed in Section 3 have been reviewed for size impact (ML corpus is small; no concern expected, but verify row counts).
- [ ] **`season_standings` option decided:** Option A vs Option B scoped in the repoint sprint plan. Digest rendering must be listed as in-scope or explicitly out-of-scope.

### Strongly recommended (flag if NO but do not block)

- [ ] **Test coverage for player-level standings:** at least one integration test asserting that two competitors linked to the same player produce a merged standings row.
- [ ] **Round-participant count semantics decided:** `COUNT(DISTINCT player_id)` vs `COUNT(DISTINCT competitor_id)` for round stats (R4a) — affects the displayed participant number on any round with multi-account players.
- [ ] **`playerHistory.ts` tests updated:** R1a–R1d changes alter query structure; existing playerHistory tests must continue to pass with the rewritten queries.
- [ ] **One sprint-26 collision confirmed resolved:** `season_standings` repoint is high-complexity; if sprint-26 `collision-repros` surfaces a season_standings collision, resolve it before the repoint adds more moving parts.

---

## Appendix — Sprint-26 Task Cross-Reference

| Precondition | Sprint-26 task that satisfies it |
|---|---|
| All competitors linked | sprint-25 gate (manual mapping by orc) |
| Re-sync live | `linking-api-resync` [x] |
| Linking UI for corrections | `linking-ui` [ ] (frontend lane) |
| Importer auto-linking | **NOT IN SPRINT-26** — new work needed before repoint sprint |
| Zero-null verify | Verify at repoint sprint gate (not a code task; a DB query) |
