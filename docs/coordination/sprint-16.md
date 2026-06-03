---
project: music-league-bot
sprint: sprint-16-standings-players
created: 2026-06-03T10:36:19Z
updated: 2026-06-03T10:36:19Z
status: active
---

# music-league-bot — coordination doc (sprint-16-standings-players)

> **Standings player integrity + add-player.** Two linked asks from the user
> running Hip Jammers Season 3 digests: (1) a known player ("Mom" / Lori) is
> **missing from the standings for rounds 1 & 2** — she should sit at the top of
> round 1 with 19 pts — yet she **does** appear in the "education" round
> (round-109, = S3 round 3). Diagnose the root cause *before* fixing: this
> smells like a roster/identity/de-anon issue (sprint-12 fixed a de-anon import
> bug), not a one-off manual gap — don't mask a systemic bug with a manual add.
> (2) Add the ability to **add a player in the standings section** (extends the
> sprint-15 `EditableStandingsTable`), where adding a player in a round also
> **registers that player into the season + league** wherever players are
> canonically stored — not just the single round's standings.
>
> Roster: **backend** (data model, standings computation, the standings mutation
> endpoint) + **frontend** (the standings-editing UI). viz not needed this sprint.
>
> **Existing mechanism to extend (do not invent a parallel route):** the
> standings mutation endpoint is `POST /api/digest/[roundId]/standings`, already
> discriminating on `action: 'adopt' | 'edit'` (see
> `ui/src/routes/api/digest/[roundId]/standings/+server.ts:38,42`). Add-player is
> a new `action: 'add-player'` on that same endpoint. Standings payload (shipped
> sprint-15): per-user `{ name, rank, prevRank, priorTotal, roundPoints, currentTotal }`.

## Sprint Goals

- Make standings show every player — and let you add one
  Missing players appear; adding a player in a round registers them in the season and league.

## Active Sprint Plan

- [x] {agent: backend, id: diagnose-missing-player} Diagnose why a known player ("Mom" / Lori) is absent from the Hip Jammers Season 3 standings for rounds 1 & 2 (she should be top of round 1 with 19 pts) while she **does** appear in round-109 (= S3 round 3, the "education" round). Trace the standings computation from its source data through to the `GET /api/digest/[roundId]/standings` payload. Map where players are canonically stored across the system: league membership, season/competitor roster, per-round submissions/results, and any identity / de-anonymization mapping (the sprint-12 de-anon import fix is a lead). Pin the root cause to one of: data gap (never imported for those rounds), identity mismatch (name-vs-id, de-anon alias), or a join/filter in the standings query that drops players with no submission in a given round. **Read-only diagnosis — no schema or data mutation in this task.**
  - **Acceptance:** an Activity Log entry names the exact root cause with `file:line` for the standings query/computation and the table(s) where players are canonically stored; states whether other players/leagues/rounds are affected by the same cause; and recommends the fix path (code fix vs. data correction vs. add-player). No code or data changed.

- [ ] {agent: backend, id: fix-missing-player, depends: diagnose-missing-player} Apply the fix identified by `diagnose-missing-player` so the player appears in the Hip Jammers Season 3 standings for rounds 1 & 2 with correct points (round 1: 19 pts, top of standings), and so the standings computation correctly includes eligible players going forward (if the root cause is query/join logic, fix the computation; if it is a data/identity gap, correct the data via the canonical path). Do not hardcode a single player — fix the underlying cause.
  - **Acceptance:** on prod (`192.168.4.217:3002`), the standings for Hip Jammers S3 round 1 show the player at the top with 19 pts and round 2 includes her; `GET /api/digest/[roundId]/standings` for the relevant round ids returns her row with correct points. `npm run check` passes; deployed via `docker compose build --no-cache bot-ui && up -d --force-recreate bot-ui`; root cause + fix + verification recorded in the Activity Log.

- [ ] {agent: backend, id: add-player-endpoint, depends: diagnose-missing-player} Extend the existing standings mutation endpoint `POST /api/digest/[roundId]/standings` (today `action: 'adopt' | 'edit'`) with a new `action: 'add-player'` that adds a player to the round's standings with a name + points **and** registers that player into the canonical season + league roster identified in `diagnose-missing-player` — so the player persists across rounds and future digests, not just this one round's standings. Reuse the existing standings persistence + reconciliation path (`action:'edit'` writes gospel); do not add a parallel route or a separate add-player mechanism.
  - **Acceptance:** `POST /api/digest/[roundId]/standings` with `{ action: 'add-player', name, points }` returns 200 with the updated standings payload including the new player; a DB check confirms the player now exists in the season + league roster table(s) (not only this round's standings); fetching standings for a **different** round in the same season shows the player is known. `npm run check` passes; deployed; the request/response shape + exactly which tables were written are recorded in the Activity Log for frontend.

- [ ] {agent: frontend, id: add-player-ui, depends: add-player-endpoint} Add an "add player" affordance to the standings-editing surface — extend the sprint-15 `EditableStandingsTable.svelte` (reachable via the standings section's "✎ edit figures" path). A control opens a small form (player name + round points) that submits via the new `action: 'add-player'` on `POST /api/digest/[roundId]/standings`; on success the standings chart/table re-render from the returned payload with the new player included, reusing the existing `standingsOverride` `$state` pattern (no page reload).
  - **Acceptance:** on prod, opening the editable standings table shows an "add player" control; submitting a name + points adds the row, persists, and the standings chart re-renders including the new player without a reload; the added player carries into the season (visible when generating a digest for another round in that season). `npm run check` passes; deployed; visual check recorded in the Activity Log.

### Deploy

Each change deploys to prod per `CLAUDE.md`: `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. **Serialize deploys** (review-queue item 6: concurrent `up` on the shared `bot-ui` container races) — or use `npm run dev` (vite HMR in `ui/`) for UI iteration and deploy once at the end.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | the standings data model + computation, the player/competitor/league-membership storage, and the standings mutation endpoint (`ui/src/routes/api/digest/[roundId]/standings/+server.ts`), plus any `ui/src/lib/db/**` query/persistence the standings/roster path uses | the standings-editing Svelte UI (`EditableStandingsTable.svelte`, the standings section components) |
| frontend | the standings-editing UI (`ui/src/lib/digest/**` standings components incl. `EditableStandingsTable.svelte`, the standings section affordances) | the `+server.ts` standings endpoint, the standings computation, the player/roster persistence, and `ui/src/lib/db/**` |

---

## Decision Log

- **D1** — Diagnose-before-fix on the missing player. The fix must address the root cause (roster/identity/query), not paper over it with a one-off manual add. Surface to the user if the same cause affects other players/leagues/rounds.
- **D2** — Add-player extends the existing `POST /api/digest/[roundId]/standings` endpoint as `action: 'add-player'` — same mechanism as `adopt`/`edit`; no parallel route.
- **D3** — Adding a player in a round writes through to the canonical season + league roster, not just that round's standings, so the player persists across rounds and future digests.
- **D4** — Roster split: backend owns the endpoint + data model + computation; frontend owns the `EditableStandingsTable` UI. viz not staffed this sprint.

## Blockers

## Activity Log

### 2026-06-03 — docs — Sprint plan created: standings player integrity + add-player (sprint-16)
- 4 tasks for the standings work: diagnose-missing-player (read-only) → fix-missing-player (backend), add-player-endpoint (backend), add-player-ui (frontend)
- 3 backend / 1 frontend / 0 docs
- deps: `fix-missing-player` and `add-player-endpoint` both depend on `diagnose-missing-player` (need root cause + the canonical player-storage map first); `add-player-ui` depends on `add-player-endpoint` (consumes the `action:'add-player'` request/response shape). Kickoff is diagnosis-first — a deliberate serial gate, since both the fix path and the add-player persistence target depend on knowing where players are canonically stored
- grounded in existing plumbing: standings endpoint `POST /api/digest/[roundId]/standings` (`action: 'adopt'|'edit'` today → add `'add-player'`), the sprint-15 `EditableStandingsTable.svelte` + `standingsOverride` `$state` re-render path, and the standings payload shape `{ name, rank, prevRank, priorTotal, roundPoints, currentTotal }`
- sprint-15 set to `paused` (back-burnered per user — done-but-unreviewed, not closed) so the warren advances to sprint-16

### 2026-06-03 — backend — diagnose-missing-player: ROOT CAUSE FOUND (read-only, no changes)

**Root cause: a DATA GAP — Lori's round-1 *submission row* was never imported into `ml_submissions`.** Not an identity/de-anon mismatch, and not a query bug per se. Her song exists only as **orphan votes** (votes cast *on* it, with no submission row to attach them to), so the standings computation — which is spined on `ml_submissions` — can't see her or her points.

**The numbers (corrected round map):** Hip Jammers S3 = `season_id 6`; rounds in sequence are **r1=round 102 "Your Permanent Record", r2=103, r3=104 "Department of Education"** (104 is the "education" round — the coord-doc's "round-109" label is wrong; 109 is a Second Best round).
- Round **102 (S3 r1):** 8 submitters but **9 distinct voters**. The one voter-without-submission is **Lori (`lorimariani`, competitor `id 16`)** — she cast 7 votes but has **0 rows in `ml_submissions`**.
- There is exactly **one orphan song** in r102: `spotify:track:4IRHwIZHzlHT1FQpRa5RdE`, **17 pts from 8 voters**, **absent from `ml_submissions` in every round**. Lori is *not* among its voters (you can't self-vote) → it is almost certainly her missing submission. At 17 pts it tops r102 (next is missmara 13). ⚠️ User expected **19**; DB shows **17** — flag the 2-pt gap (memory, or two more votes also dropped).
- Round **103 (S3 r2):** 9 submitters = 9 voters; Lori **is** present (12 pts). She is *not* missing from r2's source data. The user's "missing from r1 & r2" is: absent entirely from r1, and in r2's standings her totals are wrong/under-ranked because the r1 points never accrue (prior_total starts at 0).

**Canonical player storage (mapped):** the **only** player table is the **global `competitors`** (`id, ml_competitor_id, name`) — *no* `league_id`/`season_id`, and **no membership/roster table exists**. A player's membership in a season/league is **implicit**: it's derived from having rows in `ml_submissions.competitor_id` (as submitter) and/or `votes.voter_id` (as voter) for that season's rounds. `season_standings` (sprint-14 gospel) is downstream of those, not a roster.

**Where it breaks (file:line):**
- `ui/src/lib/db/standings.ts:64-78` `pointsByCompetitor()` — the spine is `FROM ml_submissions m JOIN competitors c … LEFT JOIN votes v …` filtered `WHERE … m.competitor_id IS NOT NULL`. A song with votes but **no submission row** (orphan), or a player who only voted, contributes **nothing** and never appears. This is correct given the data — it's faithfully summing what's stored — but it means a missing submission row silently erases a player + their received points.
- `ui/src/lib/db/standings.ts:94` `computeStandings()` builds the payload from that map; `getStandings()` (`standings.ts:205`) lazily persists it into `season_standings` and serves the stored gospel.
- `GET /api/digest/[roundId]/standings` → `ui/src/routes/api/digest/[roundId]/standings/+server.ts:9,17`. Verified: r102's stored `season_standings` has exactly **8 rows, no Lori**; missmara tops at 13 (the real top, Lori's 17, is invisible).

**Scope — this is SYSTEMIC, not one-off.** Orphan-vote songs (votes with no matching submission) exist in **7 rounds across multiple leagues/seasons**: rounds **35, 58, 66, 71, 76, 102, 110** (71 & 76 each have **2** orphan songs, ~30–34 orphan pts). So other players in other leagues/rounds are under-counted or missing by the same cause. r102 is uniquely easy to attribute (only one voter-without-submission → unambiguously Lori); rounds with 2 orphans can't be auto-attributed without the source export. Likely origin: the original ML export/import (or sprint-12 de-anon) dropped these submission rows while keeping the votes.

**Recommended fix path (for decision — NOT applied):**
1. **`fix-missing-player` = a DATA correction via the canonical path, not a computation rewrite.** Insert the missing `ml_submissions` row for Lori in r102: `competitor_id 16`, `spotify_uri spotify:track:4IRHwIZHzlHT1FQpRa5RdE` (+ title/artist/album, fetchable from Spotify like sprint-15 podium art). The 17 orphan votes then join → she tops r1 and her r2/r3 priors correct themselves. Then re-`adopt` computed for r102/103/104 to refresh the `season_standings` gospel. **Decision needed:** accept **17** (DB truth) vs chase the user's **19** (would need the source export to confirm 2 missing votes).
2. **Systemic option (recommend surfacing to user):** detect orphan-vote songs at import/standings time and either backfill submission rows from the source export (zip / Spotify playlist) — robust but needs source data for the ambiguous multi-orphan rounds — or, at minimum, **log/flag** orphan songs so they're not silently dropped. A pure computation change can't conjure the submitter identity for 2-orphan rounds; the data must be corrected.
3. **`add-player-endpoint` implication:** since there's no roster table, "register a player into the season + league" must = **upsert a `competitors` row** (find-by-name or create with a generated `ml_competitor_id`) **+ create an `ml_submissions` row in the round** (that's what makes them a season member and what standings count) **+ write the gospel `season_standings` via the existing `applyEdits` path**. There is no separate membership write — the submission row *is* the membership.

**No code or data changed.** Stopping here per the diagnose-before-fix gate — awaiting decision on (a) accept 17 vs pursue 19, and (b) one-off Lori correction vs systemic orphan-backfill across the 7 affected rounds.
