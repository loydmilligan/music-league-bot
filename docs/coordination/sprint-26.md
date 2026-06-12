---
project: music-league-bot
sprint: sprint-26
title: Feature Inventory & Collision Review
status: active
created: 2026-06-12T22:03:42Z
activated: 2026-06-12
updated: 2026-06-12T22:08:06Z
---

# music-league-bot — coordination doc (sprint-26)

> **The stocktaking sprint.** The app grew fast and early development predated
> the current process discipline — multiple features now write the same state
> through different doors. This sprint inventories every feature and screen
> (hands-on, in the running UI), maps every write path and every "which round
> is active" derivation, reproduces the suspected collisions, and lands the
> two fixes already proven live: durable season-status overrides (sprint-25
> close-out finding 1 — Nostalgia Pit re-activated itself after a manual flip)
> and competitor→player linking with backfill re-sync (finding 2 — the
> player_id backfill is one-shot). Output feeds a prioritized fix backlog and
> the groundwork doc for the future FK hard-repoint sprint. Origin: owner
> direction at sprint-25 close (2026-06-12) + sprint-25 Ratification Log
> gate-4 findings.

## Sprint Goals

- Map every feature, catch the collisions before they bite
  One inventory, reproduced conflicts, durable season + player-link fixes.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | DB schema + migrations, importer/season lifecycle, `$lib/db/*` services, `/api/*` routes, inventory of server-side write paths | Svelte components, page routes |
| frontend | Svelte components + routes, hands-on UI walkthroughs and screen inventory, UI collision reproductions | DB schema, importer, API route internals |
| orc | sprint gate: consolidation of findings into a fix backlog, ratification card, prod deploy, context resets | project code (orc manages; project agents work) |

## Working agreements (sprint-26)

- Inventory deliverables are committed markdown under `docs/coordination/inventory/` —
  they are sprint artifacts, written for the NEXT sprint's planner.
- Hands-on means hands-on: UI claims require driving the real UI (dev server)
  and noting what was clicked; DB claims require before/after queries.
- Mid-wave context discipline carries over from sprint-25: past ~60-70%
  context, write a handoff entry and request a reset from orc.
- No prod deploy except by orc at the gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: write-path-inventory} **Inventory every write path to round/season/league state.** Find every code path that INSERTs/UPDATEs `rounds`, `seasons`, `leagues`, or `next_round_overrides` — importer, mgmt APIs (`/api/leagues/...`), digest next-round editor (`/api/digest/:roundId/next-round`), setup-screen endpoints, reconcile scripts in `scripts/`, the CLI-bridge snapshot supplement, and any bot/api-container writers. Produce `docs/coordination/inventory/write-paths.md`: one table row per writer — surface, file:line, fields written, trigger (user action / import / boot), and a collision-notes column flagging where two writers touch the same field with different rules.
  - **Acceptance:** doc committed; cross-checked complete against `grep -rn "UPDATE rounds\|UPDATE seasons\|UPDATE leagues\|INSERT INTO rounds\|INSERT INTO seasons" ui/src scripts` (every hit appears in the table or is justified as excluded); the two known cases (multiple round-info edit paths; season-status writers) each have a filled collision-notes cell.

- [x] {agent: backend, id: active-derivation-audit} **Audit every "which round is active" derivation.** Enumerate each site that decides a league's active/current/next round — `ui/src/lib/db/activeRound.ts`, `nextRound.ts`, `layout.ts`, the shortlist `/api/rounds/open` path, the digest next-round computation, the live-round repair path from sprint-25-followup, and `leagues.active_round_id`/`next_round_overrides` consumers. For each: file:line, inputs, precedence rules, and a divergence matrix showing where two sites can answer differently for the same league. Append as a section of `docs/coordination/inventory/write-paths.md` or a sibling doc.
  - **Acceptance:** every derivation site listed with file:line; the matrix explicitly covers the known splits (`is_active` flag vs season-derived; `needsNextRound` vs repair path; pinned override vs inferred next round) and marks each pair AGREES / CAN-DIVERGE with the condition under which they diverge.

- [x] {agent: frontend, id: screen-inventory} **Hands-on screen + feature inventory.** Walk every route in `ui/src/routes` in the running dev app at both 412×892 and desktop. Produce `docs/coordination/inventory/screens.md`: per screen — purpose, every user action available, which API endpoint each action calls, and an overlap column flagging actions that mutate the same state as another screen (e.g. round editing exists in /setup rounds table AND digest next-round edit AND import).
  - **Acceptance:** every directory under `ui/src/routes` (pages, not API routes) appears in the doc; each screen's actions are mapped to endpoints (verified against the network tab or source); at least the round-editing overlap set is fully cross-referenced to the write-path inventory's rows.

- [-] {agent: frontend, id: collision-repros} **Reproduce the suspected collisions in the real UI.** For each suspected collision (seed list: round info edited in /setup vs digest next-round override vs re-import; season status flipped manually vs importer re-derivation; active-round pin vs derived active round; digest exclude state vs regeneration), drive the actual UI/API sequence and record a verdict. DB before/after via sqlite queries; UI steps listed so they're re-runnable.
  - **Acceptance:** `docs/coordination/inventory/collisions.md` committed with one entry per suspect: numbered repro steps, before/after state, verdict CONFIRMED / NOT-A-BUG / NEEDS-BACKEND-REPRO, and severity (data-loss / wrong-display / annoyance). Every CONFIRMED entry names the colliding writers by write-path-inventory row.

- [-] {agent: backend, id: season-override-fix} **Make manual season-status flips durable (live bug).** Sprint-25 close-out finding 1: `seasons` has no override marker, so the importer heuristic re-derives status and clobbers manual flips (Nostalgia Pit re-activated itself). Add an override column (e.g. `status_source TEXT CHECK(status_source IN ('derived','manual')) DEFAULT 'derived'`) via the house-pattern idempotent boot migration; `setSeasonStatus` sets `manual`; the importer heuristic skips seasons marked `manual` in BOTH directions (no demotion AND no promotion).
  - **Acceptance:** regression test: mark a fixture season complete+manual, run a re-import with unvoted rounds, status stays `complete`; flip Nostalgia Pit (league 4, season 7) to complete on the real DB and verify `status_source='manual'`; `npm run check` 0 errors; `npm test` green.

- [-] {agent: backend, id: linking-api-resync} **Competitor→player linking API + backfill re-sync.** Carried from sprint-25 close (option 2). Endpoint to set/clear `competitors.player_id` (follow the existing mgmt-API route patterns under `ui/src/routes/api/`), plus a re-sync service function that re-runs the deterministic gameplay backfill (`ml_submissions`/`votes`/`season_standings.player_id` from `competitors.player_id`) for the affected competitor — fixing close-out finding 2 (the boot backfill is one-shot, nested in the column-creation guard).
  - **Acceptance:** curl transcript in the handoff: PATCH a test competitor's link → row persists; the competitor's gameplay rows have `player_id` populated immediately after (no reboot); unlinking nulls them back; `npm run check` 0 errors.

- [ ] {agent: frontend, id: linking-ui, depends: linking-api-resync} **Linking control on the /setup roster screen.** Per the sprint-25 close decision: new ML competitors (e.g. Sarah Zucker's possible second account in Second Best) need a UI to link/unlink a competitor to a player. Show each competitor's name, `ml_competitor_id` (truncated), leagues, and current link; picker to choose a player. Surface unlinked competitors prominently (they're the action item).
  - **Acceptance:** at `/setup`, an unlinked fixture competitor can be linked to a player; the link survives reload; the player's `/history?tab=players` entry absorbs the competitor's submissions (visible name change in the roster list); 412×892 renders without layout breakage; `npm run check` 0 errors.

- [ ] {agent: backend, id: repoint-groundwork} **FK hard-repoint groundwork doc (no implementation).** Write `docs/coordination/planning-fk-repoint.md` for the future repoint sprint: inventory of every read site joining gameplay tables through `competitor_id`/`voter_id` (file:line), the preconditions checklist (all competitors linked, re-sync live, importer writing `player_id` on new rows), per-table migration steps with rollback, and a go/no-go checklist.
  - **Acceptance:** doc committed; the read-site inventory is cross-checked against `grep -rn "competitor_id\|voter_id" ui/src/lib --include="*.ts"` (every hit listed or excluded with reason); preconditions reference the sprint-26 task ids that satisfy them.

- [ ] {agent: orc, id: gate-close, depends: write-path-inventory,active-derivation-audit,screen-inventory,collision-repros,season-override-fix,linking-api-resync,linking-ui,repoint-groundwork} **Gate — consolidate findings, close sprint.** Orc consolidates the inventory docs + collision verdicts into a prioritized fix backlog (severity-ordered, each item naming its inventory row), runs cross-checks (each agent verifies the other lane's acceptance), version + CHANGELOG for the code tasks, ratification card with the backlog summary, one cached prod deploy, 412×892 smoke on /setup linking + season-status durability, panes reset, doc closed.
  - **Acceptance:** fix-backlog section added to this doc and ratified via card; v-bump + CHANGELOG committed; prod smoke passes with 0 console errors; doc `status: closed`.

## Decision Log

### 2026-06-12 — Sprint scope set at sprint-25 close (owner)
Owner direction: "careful inventory of our current features and screens — which should include actually running some tests with the actual UI … taking note of features or functions that may collide," citing multiple round-update paths and divergent active-round derivations; plus the carried items (linking UI, repoint groundwork). Fixes beyond the two live findings are deliberately deferred to the post-inventory backlog — inventory first, then prioritize.

### 2026-06-12 — Player linking applied manually; UI is for new players (owner)
All 29 existing competitors were linked by orc via user-confirmed mapping at sprint-25 close. The linking UI (this sprint) exists for future/new competitors and corrections, not the initial backfill.

## Ratification Log

_(gate cards land here as they resolve)_

## Blockers

_None._

## Activity Log

### 2026-06-12 — frontend-agent — screen-inventory COMPLETE
- Produced `docs/coordination/inventory/screens.md` with all 10 page routes inventoried hands-on.
- Mapped every user action to its API endpoint; overlap column flags collisions.
- Key overlaps identified: round name editable in `/setup` and `/league/.../round/:id` edit modal; deadlines editable from `/settings` form, `/settings` auto-fill (bulk), and `/league/.../round/:id` modal; season status collision confirmed (W6/W7/W8 importer writes clobber manual flip from `/setup`); digest next-round overrides shadow `rounds` values without expiry; league-active and active-round-pin both collision-free (same endpoint, last-write wins).
- screen-inventory ticked [x]. Proceeding to collision-repros.

### 2026-06-12 — backend-agent — write-path-inventory + active-derivation-audit COMPLETE
- Produced `docs/coordination/inventory/write-paths.md` with two sections:
  - **Section 1 (write-path-inventory):** 19 writer rows (W1–W19) covering importer ZIP path, CLI bridge live-round path, round edit API, deadline auto-fill, settings deadline form, season status mgmt API, league seed/rescan, active/active-round slot writes, round create, next-round KV pin, digest draft next-round fields, ml-rebuild.mjs, ml-reconcile.mjs, import-round-csv.mjs, and boot backfill migrations.
  - **Section 2 (active-derivation-audit):** 10 derivation sites (D1–D10) with file:line, inputs, and precedence rules; 9-row divergence matrix marking each pair AGREES/CAN-DIVERGE with explicit conditions.
- Key findings captured: sprint-25 finding 1 (season status collision) appears in W1/W2/W6/W7/W8/W15; two independent "next round" concepts (chronological D5/D6 vs KV pin D7); `active_round_id` pin ignored by layout.ts (D3/D4 vs D1); `getActiveSeasonId` live-round fallback diverges from `layout.ts` status-only lookup.
- Cross-checked against grep; all hits accounted for or excluded with reason.
- Both tasks ticked [x]. Backend now unblocked to proceed to season-override-fix.

### 2026-06-12 — orc — Sprint activated; first round dispatched
- backend ← write-path-inventory + active-derivation-audit (related exploration, one doc)
- frontend ← screen-inventory + collision-repros (both hands-on UI, own dev server)
- backend's fixes (season-override-fix, linking-api-resync) queue behind its inventory pair; frontend's linking-ui waits on linking-api-resync

### 2026-06-12 — docs — Sprint plan authored: feature inventory & collision review
- replaced `## Active Sprint Plan` body with 9 tasks (4 inventory/audit, 3 fixes carried from sprint-25 findings, 1 groundwork doc, 1 gate)
- 5 backend / 3 frontend / 1 orc; single dependency edge (linking-ui ← linking-api-resync) + the gate
- seeds: sprint-25 gate-4 Ratification Log findings (season-override not durable; one-shot backfill) + owner-named collisions (round-edit paths, active-round derivations)
