## Backend findings — 2026-06-11

### 1. What exists today

**Schema (ui/src/lib/db/schema.ts)**

| Table | Relevant columns | Notes |
|-------|-----------------|-------|
| `leagues` | `id`, `slug`, `name`, `is_active` (0/1), `active_round_id` FK→rounds | `is_active` + `active_round_id` added sprint-22 via ALTER migrations |
| `seasons` | `id`, `league_id`, `season_number`, `status` (active\|complete) | One row per (league, season number); status is write-once-per-import |
| `rounds` | `id`, `season_id`, `ml_round_id`, `name`, `description`, `submission_deadline`, `voting_deadline` | Ordered by `id` (insertion order) everywhere |
| `competitors` | `id`, `ml_competitor_id`, `name` | ML-scoped identity; no chat linkage; not league-scoped |

No `players` table. No per-season roster table. `competitors` is the only player-like entity, and it is global and ML-import-only.

**Active-round management (ui/src/lib/db/activeRound.ts)**

- `markLeagueActive` — sets `leagues.is_active`
- `setActiveRound` — sets `leagues.active_round_id`; validates round belongs to league
- `getActiveLeaguesActiveRounds` — queries `WHERE is_active = 1`, resolves active round via: (1) manual slot `active_round_id`, (2) derived `getCurrentRoundForSeason`, (3) null
- `getActiveSeasonId` — `SELECT id FROM seasons WHERE league_id = ? AND status = 'active' ORDER BY season_number DESC LIMIT 1`
- `createRoundWithDeadlines` — creates a manual round under the league's active season; `ml_round_id = manual:<seasonId>:<ts>`

**Season derivation (ui/src/lib/db/rounds.ts, ui/src/lib/lifecycle.ts)**

`getRoundPhasesForSeason` walks rounds ascending by `id`, applies: voting past → archive; sub past → voting (or archive if no vote deadline); prev=archive → submission; else → upcoming. `getCurrentRoundForSeason` sorts by phase priority (submission < voting < upcoming < archive), newest-createdAt as tiebreak.

**"Next Round Up" source (ui/src/lib/db/nextRound.ts)**

`getNextRound(db, roundId)`:
1. Finds the current round's `season_id`
2. Queries ALL rounds for that season ordered by `id`
3. Finds `idx` of current round in the list
4. Returns `rounds[idx + 1]` — the next row in the same season

Returns: `{ theme: nx.name || nx.description, deadline: nx.submission_deadline ?? nx.voting_deadline, submissionsSoFar }`.
Called from `GET /api/digest/:roundId/next-round`, loaded server-side at `routes/digest/[roundId]/+page.server.ts`.

**Import lifecycle (ui/src/lib/import/importer.ts + startupScan.ts)**

```ts
const status = parsed.rounds.length > 0 && parsed.votes.length > 0 ? 'complete' : 'active';
const seasonId = upsertSeason(db, league.id, seasonNumber, status);
```

`upsertSeason` uses `ON CONFLICT(league_id, season_number) DO UPDATE SET status=excluded.status` — every import OVERWRITES the season's status using the same heuristic.

**Settings route**

`routes/settings/+page.server.ts` exposes re-import and has access to the import_log. The `leagues.is_active` backfill in `client.ts` runs once at first boot after the ALTER migration, setting `is_active = 1` for any league that has a `status = 'active'` season at that moment.

---

### 2. Root causes of the three symptoms

#### Symptom 1: "Next Round Up" section ships wrong round / deadline

**Root cause: `getNextRound` is season-scoped, not league-scoped.**

It gets `rounds WHERE season_id = <current>` and returns `rounds[idx + 1]`. This breaks in two ways:

a. **End-of-season edge case** — if the current round IS the last one in its season, `getNextRound` returns null even though a new season (and its round 1) may already exist in the DB. The digest's "Next Round Up" section silently disappears or shows stale data.

b. **Theme vs. name confusion** — `getNextRound` returns `nx.name || nx.description` as the theme. In ML's data model, `rounds.name` is the round title (e.g. "Round 7") and `rounds.description` is the thematic prompt. If the next round doesn't have its description filled yet, the section shows "Round 7" as the theme — which is correct formatting but semantically misleading.

c. **Deadline ambiguity** — returns `submission_deadline ?? voting_deadline`. If submission deadline is null (manual round, not yet filled), it falls back to the voting deadline. A nil/nil round returns `null` for deadline, suppressing the countdown even when the round exists.

#### Symptom 2: Shortlist H2H round-assignment only works for one league

**Root cause: `getActiveLeaguesActiveRounds` only surfaces leagues where `leagues.is_active = 1`.**

The active-rounds component (`ActiveRounds.svelte`, served by `GET /api/active-rounds`) calls `getActiveLeaguesActiveRounds`, which filters to `is_active = 1`. The shortlist assign-to-round picker is sourced from this same API response. If the second league has `is_active = 0` — either because it was never manually toggled, or because the sprint-22 backfill ran before that league's active season was imported — its rounds never appear in the picker.

Additionally, `setActiveRound` requires a `leagues.is_active = 1` league to hold an `active_round_id`. So even if the round exists in the DB, the shortlist H2H flow can't address it.

Secondary issue: the shortlist page `load` (`routes/shortlist/+page.server.ts`) does not pass active-round context to the page — that's fetched client-side via the `ActiveRounds` widget. If client-side fetch fails or the widget hasn't loaded, the picker is empty regardless of league activation state.

#### Symptom 3: Second league shows only 6 rounds in the active-rounds section

**Root cause: the importer's `status` heuristic overwrites season status on every re-import, with no awareness of mid-season state.**

The critical line:
```ts
const status = parsed.rounds.length > 0 && parsed.votes.length > 0 ? 'complete' : 'active';
```

If the second league's season-1 ZIP was imported at a point when it contained 6 completed rounds (each with votes), the status was written as `complete`. The 7th round is in-progress at import time and either:
- is NOT in the ZIP yet (ML exports only include completed rounds in some views), so the active season's round count stays at 6, OR
- IS in the ZIP with zero votes, but the heuristic still evaluates `votes.length > 0 = true` (because rounds 1–6 have votes) → `complete`; the active season `getActiveSeasonId` then returns null because the only season is `complete`.

In `getActiveLeaguesActiveRounds`, `getActiveSeasonId` returns null → `availableRounds = []` → the active-rounds UI shows the league with 0 (or null) available rounds. The owner sees "6 rounds" because that's what the DB has AND the season is somehow still showing as active, which means the more likely case is: the DB holds TWO seasons for that league — an older 6-round one still marked `active`, and a newer one — but `getActiveSeasonId` picks the highest `season_number` one that is `active`, and if the second season was imported as `complete`, the 6-round one is the only active one found.

The `getRoundsForSeason` called on that 6-round active season therefore returns 6 rounds, and `getCurrentRoundForSeason` over all 6 (past-deadline) rounds produces phase=`archive` for all of them — meaning the resolved active round falls through to the derived path but returns the latest archived round, not the real current one.

---

### 3. Proposed model evaluation: league → season → player-assignment

**Current state:**
- `competitors` is ML-import-only, global (not per-league or per-season), stores `ml_competitor_id` + `name`
- No explicit roster model; players are implicitly "whoever submitted in a round"
- No chat-identity linkage from competitor → WhatsApp sender / Google Chat handle
- Fam-jam uses Google Chat with manual paste — no ML identity for those players at all

**Proposed model requirements (schema changes):**

```
players (id, name, chat_type, chat_identifier, ml_competitor_id, created_at)
  -- chat_type: 'whatsapp' | 'google-chat' | null
  -- chat_identifier: phone in WA format, GChat handle, or null
  -- ml_competitor_id: nullable FK → competitors(ml_competitor_id) for ML-linked players

season_players (season_id, player_id, joined_at)
  -- PK (season_id, player_id)
  -- tracks roster changes mid-season
```

**Evaluation:**

*Strengths of the proposed model:*
1. Decouples identity from import source — a player who exists only in Google Chat can be represented without an ML export
2. Per-season roster enables "who was playing in S2 but not S3" queries, which the history views need
3. `chat_type + chat_identifier` directly enables future WhatsApp → player and Google Chat → player lookup for smart shortlist suggestions
4. Aligns with the history views already in the codebase (`playerHistory.ts`, `/api/history/players`) which currently operate on `competitors.name` strings, not stable IDs

*Risks and complications:*
1. **`competitors` is referenced widely.** `ml_submissions.competitor_id`, `votes.voter_id`, `head_to_head_matches` (via `research_songs.round_id`), `season_standings.competitor_id`, `rounds.theme_chooser_id` all reference `competitors(id)`. The migration path is: add `players`, create a 1:1 mapping `players.id ↔ competitors.id` for existing ML-imported competitors, then migrate FKs in a subsequent sprint. Doing it all at once is high-risk.
2. **Name matching is fragile.** `playerHistory.ts` currently matches by `competitors.name` string. Migrating to a stable `player_id` requires reconciling names that may have changed across imports.
3. **`season_players` vs. derived roster.** The app can derive the roster from `ml_submissions JOIN rounds JOIN seasons` for any ML-imported season. Maintaining a separate `season_players` table requires keeping it in sync during imports — the importer would need to upsert `season_players` rows from `competitors` for every imported round. Adding this to the import path is a correctness risk.
4. **No Google Chat import today.** Adding `chat_type = 'google-chat'` is forward-looking but adds zero functionality until the fam-jam intake pipeline exists. Low cost to add the column; high cost to misdesign it.

**Alternative approach (lower risk):**
Skip the full model migration for now; instead:
1. Fix the three symptoms directly (season status logic, next-round cross-season, active-league gating)
2. Add a `players` table as an ADDITIVE layer — new table, new FKs, no migration of existing `competitors` FKs yet
3. Link `players.ml_competitor_id → competitors.ml_competitor_id` (string join, no FK rewrite) so history views can join without touching submissions/votes tables
4. Defer `season_players` until a concrete use case demands it (e.g. the standings page needing "who is in this season")

---

### 4. Backend jobs created

| # | Title | Description |
|---|-------|-------------|
| 1 | **Fix season-status heuristic** | Rewrite `importer.ts` status logic: a season is `complete` only when ALL rounds have votes AND the export explicitly signals end-of-season (e.g. a flag in the ZIP metadata, or a "no open rounds" check). Add a Settings UI toggle to manually override a season's status. |
| 2 | **Fix `getNextRound` — cross-season + next-league-season** | Rewrite `nextRound.ts` to look beyond the current season: if the current round is the last in its season, find the first round of the next season for the same league. Guard against empty description → fall back to round name with clarity. |
| 3 | **Fix `getActiveLeaguesActiveRounds` — auto-activate second league** | Remove the dependency on `leagues.is_active` for the active-rounds UI; instead, derive active leagues from seasons with `status = 'active'` (already stored). The `is_active` manual flag can remain as an override but should not be the sole gate. |
| 4 | **Fix active-round derivation for all-archived seasons** | `getCurrentRoundForSeason` returns the latest archived round when all rounds are past. This is misleading as "the active round" — instead, if all rounds are archived and no future rounds exist, the active-round slot should surface a "create next round" prompt, not point at an archived round. |
| 5 | **Add `players` table + migration scaffold** | Add `players (id, name, chat_type, chat_identifier, ml_competitor_id, created_at)` to schema. Backfill from `competitors` (1 player per competitor). No FK rewrites in this job — purely additive. |
| 6 | **Add `season_players` junction table** | Add `season_players (season_id, player_id, joined_at)`. Update importer to upsert rows from the round's competitors on each import. Wire the Settings UI to show rosters per season. |
| 7 | **History views: migrate name-string matching to player_id** | `playerHistory.ts` and `/api/history/players` currently key off `competitors.name`. Once `players` exists, replace string matching with stable `player_id` joins so renames don't fracture history. |
| 8 | **Shortlist H2H: surface both-leagues' active rounds** | The shortlist assign-to-round picker currently depends on `is_active = 1`. Once job 3 lands, update the picker to show rounds from ALL leagues with a current active round (derived, not manual-flagged). |
| 9 | **Settings: per-league season management UI** | Expose season status (active/complete) as an editable field in Settings. Allow manually marking a season active/complete, manually re-assigning the `active_round_id`, and re-importing without status overwrite. |
| 10 | **Chat-identity mapping UI** | UI to link a `player` to a WhatsApp phone/GChat handle. Used to route `chat_mentions.sender_name` → player entity. No backend ingestion logic yet — just the data model and an admin CRUD page. |

---

### 5. Effort vote: **Large**

**Rationale:** Jobs 1–4 fix the three named symptoms and are individually medium-sized, but they touch the import pipeline, the active-round resolution chain, and the season lifecycle model — three systems with interlocking state. Getting all three symptoms fixed correctly without regressions in the digest prep flow, the home page "active seasons" section, and the history tab requires careful sequencing and regression coverage. Jobs 5–10 are the model build-out, which is genuinely large: `players` touches 5+ tables transitively once FKs are migrated, and the per-season roster model requires import-path changes tested against real ZIP files.

If scoped narrowly to symptom fixes only (jobs 1–4 + job 8), the effort is **medium** (~2–3 sprints). Full model (all 10 jobs) is **large** (~4–6 sprints).

The highest-risk job is **job 1** (season-status heuristic): the current `upsertSeason` ON CONFLICT clause overwrites status on every startup-scan re-import. A wrong fix here silently breaks the home page's "active seasons" section and every digest's round-index. It should be gated by a test that exercises the partial-import, re-import, and full-import cases against a real sqlite fixture.

---

## Frontend findings — 2026-06-11

### 1. What exists today — league/round controls in the UI

**Active-round management (exists, functional for round pinning):**
`ui/src/lib/active/ActiveRounds.svelte` is the primary management surface, rendered on the home page under the "Active rounds" panel. It shows one slot per league the backend considers active, each with:
- The resolved active round (theme + submission/voting deadlines + phase badge)
- A modal with three actions: **Choose from list** (`PUT /api/leagues/{leagueId}/active-round`), **Create new round** (POST with deadlines + auto-pins), **Clear slot** (`DELETE /api/leagues/{leagueId}/active-round`)

This handles "pin which round is current" — but only for leagues already flagged `is_active = 1` in the DB.

**League active-toggle (API exists, UI missing entirely):**
`PATCH /api/leagues/{leagueId}/active` (`ui/src/routes/api/leagues/[leagueId]/active/+server.ts`) exists and calls `markLeagueActive(db, leagueId, active)`. However, **nothing in the UI calls this endpoint**. The `ActiveRounds.svelte` comment explicitly says "Mark a league active from its page to track its round here" — but there is no league page with that toggle. This is the direct UI-side cause of symptom (3): the second league is unreachable because no UI can flip it to `is_active = 1`.

**Settings page:**
`ui/src/routes/settings/+page.svelte` has an "Active rounds" collapsible section (~lines 616–693) that shows deadline info read-only. No league-marking or round-selection controls.

**What's missing entirely:**
- A league detail / setup page (or panel) with an active-flag toggle
- Any UI for managing seasons (which season is "current" for a league)
- Any UI for player entities — no roster screens, no chat-identity fields, no league/season membership pickers
- A dedicated "next round" pin, separate from the active round (today "next round" is inferred at digest time from round-index ordering, not explicitly pinned anywhere)

---

### 2. Shortlist UI — active-league dependency

**Current state:**
`ui/src/routes/shortlist/+page.svelte` is global — `getShortlistSongs(db)` returns all songs with no league or round filter. The assign flow (`ui/src/lib/shortlist/AssignPopover.svelte`) fetches `/api/rounds/open` on open, returning all open rounds across all leagues. The popover already groups rounds by league (lines ~86–96) and has league filter pills — clicking a league pill narrows the round list.

The multi-league gap is not in the filtering UI — it's in what populates the list. The picker depends on leagues being `is_active = 1`. Until the second league is activated (backend job 3 or via F1 below), its rounds never appear, so the h2h flow silently targets only the first league's rounds.

There is also no "quick assign to this league's active round" shortcut. The user must manually locate the correct round. With two concurrent active leagues this is error-prone.

**What changes for full multi-league support:**

1. **Dependency on backend job 3 / F1** — the second league must be reachable first. Without that, UI changes are cosmetic.
2. **Active-round header strip** — fetch `/api/active-rounds` on page load; render a sticky "Quick assign" header at the top with one row per active league showing league name, active round theme/deadlines, and per-song quick-assign buttons. `ActiveRounds.svelte` already demonstrates this pattern.
3. **Default-select active round in assign popover** — with one active league, pre-highlight its active round at top. With two, surface both prominently and require a selection.
4. **H2H flow league context** — the head-to-head ranking trigger needs a league selector (or reads from active-league context) before running. The UI trigger must pass `leagueId`.

---

### 3. Digest UI — "Next Round Up" editability

**Where it's rendered (`ui/src/routes/digest/[roundId]/+page.svelte`, lines 1019–1025):**

```svelte
{#if showNextRound && NextRoundSlot}
  <div class="dg-section-wrap" data-section-kind="nextRound">
    <section class="dg-section">
      <NextRoundSlot kind="nextRound" content={{}} data={nextRoundData} variant="visual" />
    </section>
  </div>
{/if}
```

**Why it can't be removed or edited:**
LLM-generated sections (podium, villain, flow, etc.) are wrapped in `<DigestSection>` (`ui/src/lib/digest/DigestSection.svelte`), which provides a kebab menu (edit inline, move up/down, delete from draft), lock/exclude toggles, and a regen button. `NextRoundPreview` is rendered **outside** `DigestSection` entirely — a naked `<section>` with no controls. It is not in the `data.sections` array; it's a special case appended after the LLM section loop.

The only "exclude" path is the `nextRoundInclude` toggle in `GenerateModal` (lines ~310–326), which sets `nextRoundExcluded` client-side state (line 549). This suppresses the section for the session but is **not persisted** — a page reload resets it.

The "next round" data itself is fetched fresh on every page load from `/api/digest/{roundId}/next-round` (pure DB computation via `getNextRound`). There is no stored override; any client-side edit would be lost on reload.

**What making it editable and removable requires:**

1. **Persist exclude state** — add a `next_round_excluded` column to `digest_drafts` (or store it as a synthetic row in `digest_sections`). A PATCH endpoint to survive reload.
2. **Wrap in DigestSection** — construct a synthetic section entry for `nextRound` in the page's section state model, giving it the same kebab/exclude/delete controls. The alternative (adding controls directly to the `dg-section-wrap` div) is more surgical but diverges from the established pattern.
3. **Inline editing** — `SectionInlineEditor.svelte` handles `'quotes' | 'podium' | 'consensus'` today. Adding `'nextRound'` needs a form for theme text + deadline date. Edited values stored as an override (JSON blob in `digest_sections` or a dedicated table); `+page.server.ts` load checks for an override first, falls back to computed.
4. **New API endpoint** — `PATCH /api/digest/{roundId}/next-round` to persist the override and the exclude flag.

This is a coherent medium-sized job: DB migration + two new endpoints + DigestSection wrapping + inline editor extension. Estimated 1–2 days focused.

---

### 4. Frontend jobs

| # | Title | Description |
|---|-------|-------------|
| F1 | **League active-toggle UI** | Add a toggle button (home page panel or league settings) calling `PATCH /api/leagues/{leagueId}/active`; immediately unblocks the second league in ActiveRounds |
| F2 | **League management screen** | New route `/leagues/{slug}/settings` (or modal panel from home) for league metadata: active flag, display name, chat type (whatsapp / google-chat) |
| F3 | **Season management UI** | Surface for marking a season active/complete within a league; needed so shortlist and digest scope to the right season when multiple seasons exist |
| F4 | **Player roster screen** | Route for viewing/editing players per league-season: add/remove, set display name, set chat type + chat username |
| F5 | **Player chat-identity fields** | Form fields on the player editor for `chatType` (whatsapp/google-chat) and `chatHandle`; links an ML player name to a chat user |
| F6 | **Shortlist active-round header strip** | Sticky "Quick assign" section at the top of the shortlist page, one row per active league, with active round info + per-song quick-assign buttons |
| F7 | **Shortlist H2H league selector** | League selector in the head-to-head ranking flow so it targets the correct active league's round |
| F8 | **Digest "Next Round Up" persist + edit** | Persist exclude state to DB; wrap section in DigestSection controls; add inline theme/deadline editing with stored override |
| F9 | **Digest next-round explicit pin UI** | Control in digest prepare flow or active-rounds panel to explicitly designate which round is "next" per league, rather than inferring from round ordering |

---

### 5. Effort vote: **Large**

**Rationale:** The symptom-fix subset (F1, F6, F8) is individually small-to-medium and achievable in a focused sprint:
- F1 (league active toggle): ~1–2 hours — one button calling an existing endpoint
- F6 (shortlist strip): half a day — header component reading `/api/active-rounds`, already available
- F8 (digest next-round editable): 1–2 days — DB migration + two endpoints + DigestSection wrapping + inline editor

However, the full proposed model (F2–F5, F7, F9) depends on backend schema jobs (players table, season_players, chat-identity model) that don't exist yet. The frontend cannot render player rosters or chat-identity fields until those DB tables and APIs exist. That makes the full frontend build-out contingent on backend jobs 5–7 landing first, making the combined effort genuinely large: 3–5 sprints end-to-end.

**Recommended sequencing:** ship F1 + F6 + F8 as a symptom-fix sprint (quick wins, no schema dependency). Then sequence F2–F5 after the `players` and `season_players` backend jobs land. F7 and F9 follow naturally once the core model is in place.
