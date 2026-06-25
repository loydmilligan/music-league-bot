# Metadata Queue Panel Redesign — Campaign Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **campaign** of two phases; build brick-by-brick, lowest dependency first, and stop at each ⛯ GATE to verify with real tests + a live app run before continuing.

**Goal:** Rebuild the Song Metadata Queue panel (App Settings tab) per CD's high-fidelity handoff — a monotonic status-color language, a drill-down league→season→round→song→element hierarchy navigator, metrics-as-filters, structured triage, and (Phase 2) per-element "learn by doing" enrichment.

**Architecture:** Backend gains scope-aware aggregation + new enqueue/fill endpoints in the existing `metadataQueue.ts` data layer and `api/metadata-queue/*` routes. The panel is decomposed from one monolithic `+page.svelte` block into focused components under `ui/src/lib/metadata-queue/`, all driven by a shared status-ladder util. Build up: foundation (tokens + data layer) → comprehension UI (tiles, rollups, navigator) → action (enrich) → Phase 2 deep views (song cards, heatmap, triage).

**Tech Stack:** SvelteKit (adapter-node, Svelte 5 runes), better-sqlite3, Vitest, Tailwind `@theme` tokens + `colors_and_type.css`.

**Source of truth:** CD handoff — `docs/design_handoff/metadata-queue-redesign/` (README.md = spec, prototypes/*.dc.html = behavior, design-tokens.css = ladder tokens). Where it conflicts with older handoffs, this redesign wins.

## Global Constraints
- **Status colors are monotonic:** `missing(grey) → queued(dim-sky) → running(sky+shimmer) → done(green)`. Amber/ember = real failures ONLY, never *between* queued and done. **The orange `--accent` is action-only** (primary buttons, selected scope) — never a status.
- **Numbers say what they count:** a "job" = one `(song × job_type)` row (≤5/song). Label jobs-vs-songs; keep the 24h "done today" metric separate from lifetime counts.
- **Drop** the "retries used" counter entirely. Surface failure *reason* (rate-limited / no-data / transient), never retry count.
- **No emoji**; functional Unicode glyphs only (`▸ ▾ ◐ ✓ ⟳ ✕ ○ ♫ ▦ ↻ ·`). Mono eyebrows, sentence case, dry technical voice.
- **Motion:** 120ms state / 200ms layout, `--ease-out`; running = `mq-flow` shimmer; live-update = 200ms sky border flash. No bouncing, no >1s spinners.
- **Token reality:** CD's `design-tokens.css` references raw vars (`--fg-dim`, `--bg-elevated`, `--surface-strong`, `--border-muted`, `--fg-faint`) that in THIS app are Tailwind `@theme` tokens used as classes (`text-fg-dim`, `bg-bg-elevated`, …). Map to the real tokens; do not paste CD's vars verbatim.
- TDD always; commit per task; reuse `SectionLabel.svelte` + `StatusChip.svelte`.

---

## File Structure

**Backend / data (Phase 1 unless noted):**
- `ui/src/lib/db/metadataQueue.ts` — extend: scope-aware aggregation, hierarchy tree, failure-reason classifier, lifetime `done`.
- `ui/src/lib/db/schema.ts` — add covering indexes for the aggregation/join paths (perf).
- `ui/src/routes/api/metadata-queue/status/+server.ts` — accept `scope` (level+id), not just `roundId`.
- `ui/src/routes/api/metadata-queue/fill-gaps/+server.ts` — accept any scope (all/league/season/round).
- `ui/src/routes/api/metadata-queue/enqueue/+server.ts` — **NEW (Phase 2)**: single `(uri, job_type)` enqueue.
- `ui/src/routes/api/metadata-queue/retry/+server.ts` — extend for **bulk/group** retry+dismiss (Phase 2 triage).
- `ui/src/routes/settings/+page.server.ts` — provide the league→season→round hierarchy tree (replaces `recentRounds`).

**Frontend — new module `ui/src/lib/metadata-queue/`:**
- `ladder.ts` — `ElementState` + `LADDER` map + `rollupChip(counts)` (replaces `jobChipTone`/`jobChipLabel`).
- `MetricTiles.svelte` · `JobTypeRollups.svelte` · `HierarchyNavigator.svelte` · `EnrichControl.svelte` (Phase 1)
- `QueueSongCard.svelte` · `HeatmapView.svelte` · `Triage.svelte` (Phase 2)  *(note: `QueueSongCard` — avoid colliding with the universal `lib/song/SongCard.svelte`)*
- `ui/src/lib/components/StatusChip.svelte` — add `sky` + `ember` tones.
- `ui/src/lib/shortlist/colors_and_type.css` (+ `ui/src/app.css` `@theme`) — ladder tokens + `mq-flow`/`mq-pulse` keyframes.
- `ui/src/routes/settings/+page.svelte` — composes the above; the old inline panel block is removed.

---

# PHASE 1 — Legible & navigable (foundation + comprehension)

*Outcome: the panel reads correctly (the core color-bug fix), you can drill the full hierarchy, metrics filter, and enrich works at any scope. No per-element runs yet.*

### Task 1: Status ladder foundation (tokens + util + StatusChip)
**Files:** Modify `ui/src/lib/shortlist/colors_and_type.css` (+ `ui/src/app.css` @theme as needed), `ui/src/lib/components/StatusChip.svelte`; Create `ui/src/lib/metadata-queue/ladder.ts`; Test `ui/src/lib/metadata-queue/ladder.test.ts`.
**Interfaces — Produces:** `type ElementState = 'missing'|'queued'|'running'|'done'|'failedRetry'|'failedHard'`; `LADDER: Record<ElementState,{glyph,fg,soft,border,pulse?}>`; `rollupChip(c: JobCounts): { label: string; tone: 'sky'|'amber'|'health'|'muted' }` (priority: running→sky, failed→amber, queued/missing→dim-sky "N to go", else done); `StatusChip` tones extended with `sky` + `ember`.
**Tests to write:** `rollupChip` returns sky/"running" when processing>0; amber/"N failed" when failed>0 and none running; "N to go" when only pending/missing; "done" otherwise — and **never** returns `accent`. `LADDER.running.pulse === true`.
**⛯ Gate:** `vitest run ladder.test.ts` green; StatusChip story renders sky/ember; grep confirms no `accent` tone used for status anywhere.

### Task 2: Data layer — scope-aware aggregation + hierarchy + reason classifier
**Files:** Modify `ui/src/lib/db/metadataQueue.ts`, `ui/src/lib/db/schema.ts` (indexes); Test `ui/src/lib/db/metadataQueue.test.ts`.
**Interfaces — Produces:**
- `type Scope = { level:'all'|'league'|'season'|'round'; id?: number }`
- `getQueueStatus(db, scope?)` → `{ byJobType: Record<job,{total,done,pending,processing,failed,done24h}>, totals, failures }` where `done = total−pending−processing−failed` (lifetime).
- `getHierarchy(db)` → `League[] { id,name, seasons: Season[] { id,name, rounds: Round[] { id,name, songCount } } }` with per-node roll-up counts.
- `getScopeRollup(db, scope)` → per-status + per-job-type counts for one node (powers bars/heatmap).
- `classifyFailure(error: string)` → `'rate_limited'|'no_data'|'transient'|'config'` (map: `/not found/i`→no_data, `/HTTP 4|rate/i`→rate_limited, `/HTTP 5|ECONN|timeout/i`→transient, `/not set|not configured/i`→config).
**Tests:** seed an in-memory DB with 2 leagues→seasons→rounds→songs and mixed job rows; assert `getQueueStatus` counts per scope level; `getHierarchy` tree shape + songCount; `classifyFailure('Track not found')==='no_data'`, `'HTTP 503'==='transient'`.
**⛯ Gate:** `vitest run metadataQueue.test.ts` green; `EXPLAIN QUERY PLAN` on the league/season aggregation uses the new indexes (no full scans).

### Task 3: Wire data to the panel — status endpoint scope + settings load
**Files:** Modify `ui/src/routes/api/metadata-queue/status/+server.ts`, `ui/src/routes/settings/+page.server.ts`; Test `ui/src/routes/api/metadata-queue/status/server.test.ts`.
**Interfaces — Consumes:** Task 2. **Produces:** `GET /api/metadata-queue/status?level=&id=` → scope-aware payload; `+page.server.ts` returns `{ hierarchy }` (full tree) replacing `recentRounds`.
**Tests:** endpoint returns 400 on bad level; returns league-scoped counts matching `getQueueStatus`.
**⛯ Gate:** `npm run check` 0 errors; endpoint test green; dev server loads the hierarchy.

### Task 4: Metric tiles (counts that say what they count + filters)
**Files:** Create `ui/src/lib/metadata-queue/MetricTiles.svelte`; Modify `ui/src/routes/settings/+page.svelte` (mount it); Test component logic via a small `.test.ts` for the count/label helper.
**Interfaces — Consumes:** scope-aware status (Task 3), ladder (Task 1). **Produces:** `filter` state `'all'|'done'|'running'|'queued'|'failed'`; emits filter changes; `Failed` tile click sets `filter='failed'` + `triageOpen=true` (triage lands Phase 2; wire the flag now).
**Tests:** label helper renders "Failed 441 · jobs across ~110 songs" given counts; "Done … · 60% of N in scope"; 24h shown separately.
**⛯ Gate:** tiles show correct numbers at all/league/round scope; clicking toggles filter (visible state change). Live app run.

### Task 5: Per-metadata-type rollups (with Last.fm bracket)
**Files:** Create `ui/src/lib/metadata-queue/JobTypeRollups.svelte`; Modify `+page.svelte`.
**Interfaces — Consumes:** status (Task 3), ladder (Task 1), StatusChip. **Produces:** 5 rows `[name+provider | segmented roll-up bar | done/total | chip]`; popularity+tags joined by an amber bracket (shared Last.fm rate-limit).
**Tests:** segment widths sum to 100% of total; running segment carries `.seg--running` shimmer class.
**⛯ Gate:** rows render at current scope; bracket present; running shimmer visible. Live run.

### Task 6: Hierarchy navigator (ladder view) + scope/controls bar
**Files:** Create `ui/src/lib/metadata-queue/HierarchyNavigator.svelte`; Modify `+page.svelte` (scope state, breadcrumb, search).
**Interfaces — Consumes:** `getHierarchy` + `getScopeRollup` (Task 2/3), ladder. **Produces:** `scope` state drives the whole panel; breadcrumb chips jump up; expand/collapse via caret; search filters rounds; selecting a node refetches status at that scope and resets `filter='all'`.
**Tests:** node→scope mapping; search filter predicate.
**⛯ Gate:** drill All→league→season→round visibly re-scopes tiles + rollups; breadcrumb + search work. Live run.

### Task 7: Always-present enrich control + all-scope fill-gaps
**Files:** Create `ui/src/lib/metadata-queue/EnrichControl.svelte`; Modify `ui/src/routes/api/metadata-queue/fill-gaps/+server.ts`; Modify `+page.svelte`; Test `fill-gaps/server.test.ts`.
**Interfaces — Consumes:** current `scope`. **Produces:** `POST /api/metadata-queue/fill-gaps` accepts `{level,id}` (all/league/season/round); button always visible — "Fill gaps · enrich N" (scoped) / "Enrich everything missing · N" (all).
**Tests:** all-scope fill enqueues every missing+failed (uri×jobtype) in corpus; round-scope unchanged from today; returns `{queued}`.
**⛯ Gate:** fill at each scope enqueues the right count (assert via DB); button present on All scope. Live run.

### ⛯⛯ PHASE 1 VERIFICATION GATE (do not start Phase 2 until all pass)
- `vitest run` (full) green except known-pre-existing `getDigestReadiness` failures; `npm run check` 0 errors.
- Live app: status colors read monotonically (clear a failure → bar does NOT jump to a scarier color); drill the full hierarchy; tiles filter; enrich works at All + round scope.
- Commit + (optional) deploy to prod and smoke. Sanity-check with the operator before Phase 2.

---

# PHASE 2 — Learn by doing & deep views

*Outcome: per-element single runs (the transparency core), heatmap overview, structured triage. Builds on Phase 1's scope + status foundation.*

### Task 8: Single-job enqueue endpoint  *(precursor for per-element runs; also unblocks the universal SongCard analyze panel)*
**Files:** Create `ui/src/routes/api/metadata-queue/enqueue/+server.ts`; Test `enqueue/server.test.ts`.
**Interfaces — Produces:** `POST {uri, job_type}` → enqueues that one pair (resets to pending if it was failed); `{queued:1}`.
**Tests:** enqueues one (uri,jobtype); idempotent on already-pending; resets a failed row.
**⛯ Gate:** endpoint test green; manual: enqueue one lyrics job, watch the container worker complete it.

### Task 9: Queue song cards + per-element run (the "learn by doing" core)
**Files:** Create `ui/src/lib/metadata-queue/QueueSongCard.svelte`; Modify `+page.svelte` (round scope renders cards).
**Interfaces — Consumes:** `getCoverageMatrix(roundId)` (per-song×5 real states), single-job endpoint (Task 8), ladder. **Produces:** per song: "enrich all ↻", "run N missing", and **per-element `run ▸`** (each shows provider); state reflects **real** queue status (not a mock), live-updated on poll.
**Tests:** element-state→pill mapping; "run N missing" count excludes done/running.
**⛯ Gate:** clicking one element enqueues only that job and the pill goes running→done on the next poll (real state). Footer shows the Last.fm shared-rate-limit chip. Live run. *(This same wiring should be reused to fix the universal SongCard analyze panel's fake status — note for follow-up.)*

### Task 10: Heatmap view (toggle) + rows toggle  *(perf-sensitive)*
**Files:** Create `ui/src/lib/metadata-queue/HeatmapView.svelte`; Modify `+page.svelte` (view toggle).
**Interfaces — Consumes:** `getScopeRollup` children + coverage matrix. **Produces:** children-of-scope × 5 job columns; cell color on grey→green % scale; sky border=running, amber border=has-failures; `[songs|rounds]` rows toggle at round scope.
**Perf:** fetch children rollups **lazily for the current scope only**; do not aggregate the whole corpus per 10s tick. Add a request guard so toggling doesn't stack fetches.
**Tests:** %→heat-bucket mapping; border flags from running/failed counts.
**⛯ Gate:** heatmap renders at all/league/round; toggling is smooth; verify query count per poll is bounded. Live run.

### Task 11: Triage (grouped + bulk actions)
**Files:** Create `ui/src/lib/metadata-queue/Triage.svelte`; Modify `ui/src/routes/api/metadata-queue/retry/+server.ts` (bulk); Modify `+page.svelte`.
**Interfaces — Consumes:** `failures` + `classifyFailure` (Task 2). **Produces:** group-by `reason|job|round` (toggle); each group = semantic left border + glyph + count + plain "why" + bulk action; `POST retry {group:{...}}` bulk-retries/dismisses; opens when Failed tile clicked (Task 4 flag).
**Tests:** grouping by reason buckets correctly; bulk retry resets all rows in a group to pending.
**⛯ Gate:** triage opens from Failed tile; bulk "retry all rate-limited" flips them pending (assert via DB). Live run.

### Task 12: Auto-enrich footer + integration pass
**Files:** Modify `+page.svelte` (footer carryover: `auto_analyze_audio` toggle, provider chips); final composition cleanup (remove any dead old-panel code).
**⛯ Gate:** full panel integration: every region present, scope changes propagate everywhere, no console errors; `npm run check` 0 errors; full `vitest run`. Final live run + operator sanity-check.

---

## Cross-cutting notes for the implementer
- **Season migration:** the hierarchy is league→**season**→round (CD folded season into league; we are pulling it out). `getHierarchy` must emit real seasons from the `seasons` table; the navigator renders the season level.
- **Bug-B synergy:** Task 8's single-job endpoint + Task 9's real per-element status are exactly what the *universal* `lib/song/SongCard.svelte` analyze panel needs (it currently shows hardcoded fake status). After Phase 2, wire that card to the same endpoint/status — fast follow, not in this plan's gates.
- **Perf:** index `song_metadata_queue(status, job_type)` and the `ml_submissions(spotify_uri, round_id)` join path; scope queries by node, never aggregate the whole corpus on the poll except for the All-scope tiles.
- **Token mapping:** translate CD's `design-tokens.css` raw vars to this app's Tailwind `@theme` tokens (see Global Constraints).

## Self-review
- Spec coverage: README's 7 fixes → Tasks 1 (status), 2/3 (counts+scope), 4 (filters), 6 (navigator+search), 7 (always-present enrich), 9 (single-element), 11 (triage) + heatmap (10). ✓
- No placeholders: each task names files, interfaces, the test to write, and a concrete gate. (Bite-sized per-step TDD code is expanded at execution time by the subagent per task.)
- Type consistency: `Scope`, `ElementState`, `rollupChip`, `getQueueStatus/getHierarchy/getScopeRollup/classifyFailure` names used consistently across tasks.
