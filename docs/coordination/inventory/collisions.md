# Collision Reproductions — sprint-26

> **How this was produced:** Each suspect was driven in the real dev server
> (port 5180, prod DB `data/league.db`). DB state was verified before and after
> via sqlite3 queries. All mutations were restored to their baseline values after
> each test. 2026-06-12.
>
> Write-path row references (W1–W19) cross-reference
> `docs/coordination/inventory/write-paths.md`.

---

## Collision 1 — Season status: manual flip vs ZIP rescan/import

**Verdict: CONFIRMED**
**Severity: data-loss**
**Colliding writers:** W6 (`setSeasonStatus` via `/setup` "Mark complete") vs W1 (importZipData / rescan) and W2 (importLiveRoundsData / CLI import)

### Repro steps

```sql
-- 0. BEFORE STATE
SELECT id, league_id, season_number, status FROM seasons WHERE id = 7;
-- Result: 7|4|1|active
```

1. In `/setup`, click "Mark complete" for Nostalgia Pit Season 1. Behind the scenes:
   ```
   PATCH /api/leagues/4/seasons/7
   Body: {"status":"complete"}
   Response: {"id":7,"leagueId":4,"seasonNumber":1,"status":"complete"}
   ```

2. Verify DB reflects manual flip:
   ```sql
   SELECT status FROM seasons WHERE id = 7;
   -- Result: complete  ✓
   ```

3. Navigate to `/settings` and click "Re-scan disk" (or submit the "Import" form with any league's ZIP). Behind the scenes:
   ```
   POST /settings?/rescan
   Response: {"type":"success","status":200,"data":"[{\"success\":1},true]"}
   ```

4. Check DB after rescan:
   ```sql
   SELECT status FROM seasons WHERE id = 7;
   -- Result: active   ← CLOBBERED
   ```

### Root cause

`inferSeasonStatus` in `ui/src/lib/import/importer.ts:19`:
```typescript
if (existing?.status === 'active') return 'active';   // preserves 'active'
if (parsed.rounds.length === 0) return 'active';       // empty ZIP → force 'active'
return parsed.rounds.every(r => votedRounds.has(r.id)) ? 'complete' : 'active';
```

The check `if (existing?.status === 'active')` only short-circuits for the active→active case. When a season is manually set to `complete`, the importer ignores the override and re-derives. For Nostalgia Pit the ZIP rounds.csv is empty (header only), so the `parsed.rounds.length === 0` branch fires unconditionally, always returning `'active'`. For leagues with actual rounds in the ZIP, any round that lacks votes in the exported data also returns `'active'`.

`importLiveRoundsData` (W2) is even more aggressive: it always upserts with `'active'` first (`upsertSeason(db, league.id, seasonNumber, 'active')` on line 76), then re-derives from deadline phase.

The `/digest/:roundId` "Import from CLI" button (W2) invokes both paths and is also affected.

### No restore needed

The rescan itself returned the season to `active`, which was the original state.

---

## Collision 2 — Round name: /setup edit vs ZIP re-import

**Verdict: CONFIRMED**
**Severity: data-loss**
**Colliding writers:** W3 (`patchRound` via `PATCH /api/rounds/:roundId`) vs W1 (importZipData)

### Repro steps

```sql
-- 0. BEFORE STATE (Fam-Jam s4 practice round, ml_round_id in export.zip)
SELECT id, name FROM rounds WHERE id = 118;
-- Result: 118|PRACTICE ROUND: Dance. Like no one's listening...to this.
```

1. In `/setup`, inline-edit the round name for Fam-Jam Season 4 Round 1 (saves on blur). Behind the scenes:
   ```
   PATCH /api/rounds/118
   Body: {"name":"SPRINT26-COLLISION-TEST-ROUND"}
   Response: round.name = "SPRINT26-COLLISION-TEST-ROUND"
   ```

2. Verify DB:
   ```sql
   SELECT name FROM rounds WHERE id = 118;
   -- Result: SPRINT26-COLLISION-TEST-ROUND  ✓
   ```

3. Navigate to `/settings` → "Re-scan disk":
   ```
   POST /settings?/rescan
   Response: {"type":"success","status":200}
   ```

4. Check DB after rescan:
   ```sql
   SELECT name FROM rounds WHERE id = 118;
   -- Result: PRACTICE ROUND: Dance. Like no one's listening...to this.   ← CLOBBERED
   ```

### Root cause

`upsertRound` in `ui/src/lib/db/rounds.ts:26`:
```sql
INSERT INTO rounds (season_id, ml_round_id, name, description, ...)
VALUES (...)
ON CONFLICT(ml_round_id) DO UPDATE SET name=excluded.name, description=excluded.description, ...
```

The upsert unconditionally overwrites `name`, `description`, and `spotify_playlist_url` from the ZIP on every import. Any customisation made via `/setup` inline edit or the `/league/.../round/:id` edit modal is silently clobbered on the next ZIP import.

**Scope note:** Only leagues whose export.zip contains round rows are affected. The nostalgia-pit ZIP has an empty rounds.csv, so round names for that league are safe. Fam-Jam, Hip Jammers, and Second Best ZIPs contain rounds and are exposed.

### State restored

Round 118 name restored to ML original via `PATCH /api/rounds/118 {"name":"PRACTICE ROUND..."}`.

---

## Collision 3 — Digest next-round override vs /settings deadline update

**Verdict: CONFIRMED**
**Severity: wrong-display**
**Colliding writers:** W14 (`digest_drafts.next_round_*_override` via `PATCH /api/digest/:roundId/next-round`) vs W3/W11/W12 (deadline writes to `rounds` table)

### Repro steps

```sql
-- 0. BEFORE STATE (round 130 "Something Spooky" — the next round after digest round 111)
SELECT submission_deadline, voting_deadline FROM rounds WHERE id = 130;
-- Result: 2026-06-12T02:14:00.000Z | 2026-06-16T02:14:00.000Z

SELECT next_round_sub_deadline_override FROM digest_drafts WHERE id = 'draft-111-e14aedb7';
-- Result: NULL (no override active)
```

1. In `/digest/111`, click the kebab → "✎ Edit theme + deadlines", set overrides:
   ```
   PATCH /api/digest/111/next-round
   Body: {"themeOverride":"COLLISION-TEST-THEME",
          "submissionDeadlineOverride":"2099-01-01T00:00:00Z",
          "votingDeadlineOverride":"2099-01-15T00:00:00Z"}
   Response: {"ok":true}
   ```

2. Later, in `/settings` deadline form, update round 130's actual deadlines:
   ```
   POST /settings?/updateDeadline
   Body: roundId=130&submissionDeadline=2026-06-14T07:00&votingDeadline=2026-06-19T07:00
   Response: {"type":"success"}
   ```

3. Verify the rounds table was updated (the "truth"):
   ```sql
   SELECT submission_deadline, voting_deadline FROM rounds WHERE id = 130;
   -- Result: 2026-06-14T07:00 | 2026-06-19T07:00  ✓ (correctly updated)
   ```

4. Check what the digest next-round API returns — which value wins in the digest display?
   ```
   GET /api/digest/111/next-round
   Response: {
     "nextRound": {
       "submissionDeadline": "2099-01-01T00:00:00Z",   ← STALE OVERRIDE WINS
       "votingDeadline": "2099-01-15T00:00:00Z",
       "theme": "COLLISION-TEST-THEME"
     },
     "hasOverride": true
   }
   ```

### Root cause

The `digest_drafts.next_round_*_override` columns win unconditionally over `rounds.submission_deadline` / `rounds.voting_deadline` in the next-round endpoint. There is no expiry, no link to the underlying `rounds` row, and no notification to the user that a stale override is hiding their deadline update. The user must manually click "↺ Reset to computed" in the digest kebab to clear the override.

A user who updates deadlines in `/settings` or the `/league/.../round/:id` edit modal after an override was set sees correct data everywhere except the digest "Next Round Up" section, which silently continues to display the stale override values.

### State restored

Override cleared via `PATCH /api/digest/111/next-round {"themeOverride":null,...}`.
Round 130 deadlines restored to original via `PATCH /api/rounds/130 {"submission_deadline":"2026-06-12T02:14:00.000Z","voting_deadline":"2026-06-16T02:14:00.000Z"}`.

---

## Collision 4 — Active-round pin vs layout.ts deadline-derived "current" round

**Verdict: CONFIRMED**
**Severity: wrong-display**
**Colliding writers:** W9 (`leagues.active_round_id` via `PUT /api/leagues/:id/active-round`) vs D3/D4 (layout.ts `pickCurrentRound` derivation — read-only divergence)

### Repro steps (read-only — no DB mutation required)

```sql
-- 0. Current state
SELECT id, name, active_round_id FROM leagues WHERE id = 1;
-- Result: 1|Hip Jammers|107
```

1. Home page loads. The main league rail uses `layout.ts getAllAdoptedLeagues`:
   ```
   GET / (page data)
   → Hip Jammers: currentRoundId=108, currentRoundLabel="Don't Make Me Sing",
                  currentRoundPhase="submission"
   ```
   (`pickCurrentRound` selects the highest-priority deadline-based round)

2. The `ActiveRounds` component loads separately on mount:
   ```
   GET /api/active-rounds
   → Hip Jammers activeRound: { id: 107, name: "🐜 🐜 👖",
                                 phase: "archive", source: "manual" }
   ```
   (`resolveActiveRound` respects the `active_round_id=107` pin)

### Divergence observed

On 2026-06-12:
- Round 107 (🐜 🐜 👖): voting deadline = 2026-06-12 → **archive** phase
- Round 108 (Don't Make Me Sing): submission deadline = 2026-06-29 → **submission** phase

The home page rail says "Don't Make Me Sing (active/submission)". The ActiveRounds modal says "🐜 🐜 👖 (archive)". These are shown on the same page simultaneously.

### Root cause

`layout.ts pickCurrentRound` ignores `leagues.active_round_id` entirely — it selects the round with the best (submission > voting > upcoming > archive) phase from all rounds in the season. `resolveActiveRound` in `activeRound.ts` checks the `active_round_id` pin first and returns it regardless of phase, only falling through to derived if the pin is dangling (no row found). The pin is not auto-cleared when the pinned round moves to archive, so a stale pin persists until the user explicitly selects a new round in the ActiveRounds modal.

See backend audit divergence matrix: D1 (`resolveActiveRound`) vs D3/D4 (`layout.ts`) — CAN-DIVERGE.

### No DB mutation performed

Read-only verification via API calls only.

---

## Collision 5 — Digest section excluded state vs whole-draft regeneration

**Verdict: NOT-A-BUG**
**Severity: annoyance (wasted LLM tokens)**

### Analysis (source-read, no UI steps needed)

The suspected collision: does "↻ Regenerate whole draft" un-exclude a section?

`POST /api/digest/:roundId/regenerate` (`ui/src/routes/api/digest/[roundId]/regenerate/+server.ts:32`):
```typescript
const regenerable = sections.filter(s => s.state !== 'locked');
```

`replaceSectionContent` (`ui/src/lib/digest/llm.ts:632`):
```sql
UPDATE digest_sections SET content_json = ?, regen_count = regen_count + 1 WHERE id = ?
```

The filter includes `state = 'excluded'` sections in the regeneration set (only `locked` is skipped). However, `replaceSectionContent` only writes `content_json` and `regen_count` — it does **not** reset `state`. An excluded section remains excluded after whole-draft regeneration; its content is updated silently but the user still sees it as excluded.

### Verdict rationale

No data loss and no wrong display: the excluded state is preserved across regeneration. The only consequence is unnecessary LLM calls on sections the user won't see, which wastes tokens but doesn't break the workflow.

Single-section regenerate (`POST /api/digest/:roundId/sections/:id/regenerate`) also allows regenerating excluded sections (only checks `state === 'locked'`), but similarly preserves the excluded state after the call.

---

## Collision 6 — League-active flag and active-round pin: same-endpoint concurrent writes

**Verdict: NOT-A-BUG**
**Severity: none**

### Analysis

From screen inventory cross-reference:
- League active toggle: `/` home and `/setup` both call `PATCH /api/leagues/:id/active` → W8
- Active-round pin: `/setup` select and `ActiveRounds` modal both call `PUT /api/leagues/:id/active-round` → W9

Both surfaces write the same field via the same endpoint. The last write wins, which is the correct behavior for these fields (user explicitly making a choice in either location should stick). No hidden re-derivation exists that could clobber these writes.

---

## Summary

| # | Suspect | Verdict | Severity | Writers |
|---|---------|---------|----------|---------|
| 1 | Season status: manual flip vs ZIP import | **CONFIRMED** | data-loss | W6 vs W1/W2 |
| 2 | Round name: /setup edit vs ZIP re-import | **CONFIRMED** | data-loss | W3 vs W1 |
| 3 | Digest next-round override vs deadline update | **CONFIRMED** | wrong-display | W14 vs W3/W11/W12 |
| 4 | Active-round pin vs layout.ts derived round | **CONFIRMED** | wrong-display | W9 (D1 vs D3/D4) |
| 5 | Digest exclude state vs whole-draft regen | **NOT-A-BUG** | annoyance | — |
| 6 | League-active / active-round same-endpoint overlap | **NOT-A-BUG** | none | W8, W9 |
