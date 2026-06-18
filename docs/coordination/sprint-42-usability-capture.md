---
status: planned
campaign: openrouter-cost-management
sprint: sprint-42-usability-capture
version: v1.9.0
created: 2026-06-18
---

# music-league-bot — coordination doc (sprint-42-usability-capture)

> **Sprint:** OpenRouter Cost Management — active usability capture. Wire real UI
> actions (inline-edit, regen, finalize, skip, ▲ delight, archive section decision)
> to populate the `outcome`/`recovery_cost`/`edit_distance`/`regen_changed` columns
> in `llm_cost_log` and `prediction_runs`, and insert rows into the `llm_delight`
> and `llm_health_event` side tables created in sprint-39.
>
> **This is the LAST campaign sprint.** Sprints 39 (cost ledger + passive capture),
> 40 (dashboard), and 41 (per-section models) are all shipped. Sprint-42 delivers
> the human-action outcome layer the sprint-39 Decision Log (2026-06-18 — Usability
> capture INCLUDED) reserved for this follow-on.

## Sprint Goals

1. **Digest outcome finalization.** Wire the three outcome paths: inline-edit →
   `outcome='salvaged'` + `edit_distance`; section regenerate (prior row) →
   `outcome='rejected'` + `regen_changed`; finalize with no edit or regen →
   `outcome='passed'`. `recovery_cost` is derived from outcome per the map below.
2. **▲ Delight control.** Add a thumbs-up control on content sections in the
   pre-finalize digest view that inserts a row into `llm_delight`.
3. **Archive usability.** When `dashboard_section_state.decision='refresh'` (a
   steer or explicit refresh choice) wire the prior-run `prediction_runs` row to
   `outcome='rejected'`; when published untouched → `outcome='passed'`.
4. **Health events.** Log `llm_health_event` rows on `callOpenRouter` HTTP errors
   and schema/parse failures (quarantined axis — NOT in usability score).

## Agent Roster — 2 file-disjoint lanes

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `ui/src/lib/digest/llm.ts` (add `finalizeOutcomes` + `updateLlmOutcome` helpers); `ui/src/routes/api/digest/[roundId]/finalize/+server.ts` (call `finalizeOutcomes` on first finalize); `ui/src/routes/api/digest/[roundId]/sections/[id]/+server.ts` (PATCH content → stamp `salvaged`+`edit_distance`); `ui/src/routes/api/digest/[roundId]/sections/[id]/regenerate/+server.ts` (stamp prior row `rejected`+`regen_changed`); `ui/src/routes/api/digest/[roundId]/delight/+server.ts` (new: POST insert `llm_delight`); `ui/src/lib/digest/llm.ts` (health-event insert on `callOpenRouter` HTTP-error path); `ui/src/routes/api/content/[leagueId]/update/+server.ts` (stamp `prediction_runs.outcome` for refresh vs hold/lock sections) | `ui/src/lib/models/*`, `ModelsScreen.svelte`, `DigestSection.svelte`, any other `.svelte` |
| frontend (pane 1.3) | **Lane B:** `ui/src/lib/digest/DigestSection.svelte` (▲ delight button + modal wiring; POST `/api/digest/:roundId/delight`); any digest page `.svelte` files that render the inline editor or regen button (ensure edit + regen calls pass the required body fields already; no new routes) | `llm.ts`, `predict.ts`, `routes/api/digest/*/finalize`, `routes/api/content/*`, `schema.ts`, `client.ts` |

### File-disjoint verification

Lane A files: `llm.ts`, `finalize/+server.ts`, `sections/[id]/+server.ts`,
`sections/[id]/regenerate/+server.ts`, `sections/[id]/delight/+server.ts` (new),
`content/[leagueId]/update/+server.ts`, `predict/predict.ts` (OQ-1 rowId addition).

**Verified correct file paths (coord-doc initial had two wrong routes):**
- digest section edit route: `ui/src/routes/api/digest/[roundId]/sections/[id]/+server.ts`
- digest section regenerate: `ui/src/routes/api/digest/[roundId]/sections/[id]/regenerate/+server.ts`
- digest finalize: `ui/src/routes/api/digest/[roundId]/finalize/+server.ts`
- archive/b-side content update: `ui/src/routes/api/content/[leagueId]/update/+server.ts`
- **delight route (new):** `ui/src/routes/api/digest/[roundId]/sections/[id]/delight/+server.ts`
  (coord-doc initially listed as `[roundId]/delight/` — corrected to `[roundId]/sections/[id]/delight/`)

Lane B files: `DigestSection.svelte` (and its page-level wrappers if needed).

No overlap. Lane B does not import or touch any Lane A route files.

## Cross-Lane Contracts (pinned — no renegotiation)

### 1. UI → ledger-row lookup key

**Digest sections (llm_cost_log):**
- Lookup key = `artifact_id = section.id` (the `digest_sections.id` string,
  e.g. `draft-42-abc123-podium`).
- Evidence: `llm.ts:778–780` — `regenerateOneSection` passes `artifactId:
  sectionMeta.sectionId`; `logLlmCall` writes it to `llm_cost_log.artifact_id`.
- UPDATE helper:
```ts
// ui/src/lib/digest/llm.ts — new export
export function updateLlmOutcome(
  db: Database.Database,
  artifactId: string,           // digest_sections.id
  outcome: 'passed' | 'healed' | 'salvaged' | 'rejected' | 'unusable',
  opts?: {
    editDistance?: number;      // salvage: % chars changed (0..1)
    regenChanged?: 'none' | 'params' | 'model';  // rejected by regen
  },
): void
// Fire-and-forget UPDATE on llm_cost_log WHERE artifact_id = ? ORDER BY id DESC LIMIT 1
// (most-recent row for that section). Sets outcome, recovery_cost (derived),
// and the optional edit_distance / regen_changed. Wraps in try/catch.
```

**Predict / archive (prediction_runs):**
- Lookup key = `task_id` + `player_id` (or `task_id` + latest `created_at` for
  league-level archive tasks).
- Evidence: `predict.ts:203–204` — `runPrediction` writes `artifact_type =
  'prediction_run'|'bside_section'`, `artifact_id = runRowId` (self). The most
  recent `prediction_runs` row for a task is always the one just run (archive
  update workflow is sequential per section). UPDATE on `prediction_runs` by `id`
  using the row id returned from `runPrediction` (thread through opts or return
  from `buildUpdatedReadModel`).

### 2. recovery_cost map (pinned)

| outcome   | recovery_cost |
|-----------|---------------|
| passed    | 0.0           |
| healed    | 0.1           |
| salvaged  | 0.4           |
| rejected  | 0.9           |
| unusable  | 1.0           |

Derive in the UPDATE helper: do not hardcode in routes.

```ts
const RECOVERY_COST: Record<string, number> = {
  passed: 0.0, healed: 0.1, salvaged: 0.4, rejected: 0.9, unusable: 1.0,
};
```

### 3. llm_delight insert shape (Lane A new route; Lane B consumes)

```
POST /api/digest/:roundId/delight
Body: {
  sectionId: string;       // digest_sections.id
  span: string;            // the highlighted sentence/phrase
  subsection?: string;     // e.g. 'headline', 'body', 'item-0'
  note?: string;           // optional operator note
}
Response: { ok: true, delightId: string }
```

Route (Lane A) derives `cost_log_id` by SELECT from `llm_cost_log WHERE
artifact_id = body.sectionId ORDER BY id DESC LIMIT 1`. Inserts into `llm_delight`.

### 4. llm_health_event insert shape (Lane A, inside callOpenRouter)

```ts
// On HTTP error (res.ok === false) or JSON-parse failure:
db.prepare(`
  INSERT INTO llm_health_event (id, cost_log_id, error_class, model, detail)
  VALUES (?, ?, ?, ?, ?)
`).run(
  randomUUID(),
  null,   // no cost_log_id (call failed before ledger write)
  'provider_error',      // or 'capability_mismatch' on schema fail
  model,
  text.slice(0, 500),
);
```

Health events are **quarantined** — they do not affect usability score. Lane B
does not read or render health events in sprint-42.

### 5. edit_distance calculation (digest inline-edit)

```ts
function editDistanceRatio(original: string, edited: string): number {
  // % of characters changed — Levenshtein / simple char-diff
  // Sprint-42 uses the simple approximation:
  //   1 - (longestCommonSubsequence / max(original.length, edited.length))
  // Serialize both content objects to JSON strings before comparing.
  const a = JSON.stringify(original);
  const b = JSON.stringify(edited);
  if (!a.length && !b.length) return 0;
  const longer = Math.max(a.length, b.length);
  const common = [...a].filter((ch, i) => b[i] === ch).length; // cheap proxy
  return Math.max(0, Math.min(1, 1 - common / longer));
}
```

Store as a REAL 0..1 in `llm_cost_log.edit_distance`.

## Working Agreements (sprint-42)

- **Lanes are file-disjoint — stay in your lane.** Path-scoped commits
  (`git commit -m "…" -- <paths>`); **never `git commit --amend`** on shared HEAD.
- **All outcome writes are fire-and-forget.** Wrap every outcome UPDATE / INSERT
  in try/catch; a ledger write failure must never abort the user-facing operation.
- **No emoji** — functional Unicode glyphs only. **No raw hex** — tokens only.
- **Svelte 5 runes** throughout (`$state`, `$props`, `$derived`). No legacy
  reactive blocks in any touched .svelte file.
- Scoped tests per task; full `cd ui && npm run check` (0 errors) +
  `npx vitest run` (green) are the orc gate.
- Log each completed task to the Activity Log with its commit hash.
- Version target: v1.9.0 (bump only at gate, not during sprint).

## Active Sprint Plan

### Lane A — Backend

- [ ] {agent: backend, id: a1-outcome-helper} **`updateLlmOutcome` helper + recovery_cost const.**
  Add `RECOVERY_COST` map and `updateLlmOutcome(db, artifactId, outcome, opts?)` to
  `ui/src/lib/digest/llm.ts`. Fire-and-forget UPDATE on `llm_cost_log` WHERE
  `artifact_id = ?` ORDER BY id DESC LIMIT 1. Sets `outcome`, `recovery_cost`
  (from map), and optionally `edit_distance` / `regen_changed`. Scoped unit test:
  row updated correctly; unknown artifact_id is a no-op (try/catch); recovery_cost
  derived correctly per map. **Acceptance:** `npm run check` 0 errors; test green.

- [ ] {agent: backend, id: a2-edit-outcome, depends: a1-outcome-helper}
  **Inline-edit → `salvaged`+`edit_distance`.**
  In `PATCH /api/digest/:roundId/sections/:id/+server.ts`: when `content` is
  present in the body, after updating `digest_sections`, call `updateLlmOutcome`
  with `outcome='salvaged'` and `editDistance = editDistanceRatio(prior, new)` where
  prior is `section.content_json` (before the UPDATE) and new is the incoming
  content. Add `editDistanceRatio` helper to `llm.ts` (Lane A). Scoped test: PATCH
  with content diff stamps salvaged + edit_distance > 0; PATCH with identical content
  still stamps salvaged with edit_distance ≈ 0 (human touched it). **Acceptance:**
  `npm run check` 0 errors; test green.

- [ ] {agent: backend, id: a3-regen-outcome, depends: a1-outcome-helper}
  **Regen → prior row `rejected`+`regen_changed`.**
  In `POST /api/digest/:roundId/sections/:id/regenerate/+server.ts`: before calling
  `regenerateOneSection`, capture the prior `artifact_id` (= sectionId, which is
  stable). After `replaceSectionContent` succeeds, call `updateLlmOutcome` with
  `outcome='rejected'`, `regenChanged` determined by comparing the prior chips/model
  to the current call. Initial implementation: `regenChanged='none'` always (chips
  change is detectable but model change requires comparing resolved models — defer
  'params'/'model' discrimination to a follow-on; log 'none' as the safe default).
  **CONTROL GAP (minor):** `regen_changed='params'|'model'` discrimination requires
  comparing the current section's prior `llm_cost_log` params/model to the new call.
  This is possible but adds complexity; stub as `'none'` in v1, note in Decision Log.
  Scoped test: regen stamps the prior row `rejected`; new llm_cost_log row is null
  outcome (set by callOpenRouter technical default). **Acceptance:** test green;
  `npm run check` 0 errors.

- [ ] {agent: backend, id: a4-finalize-outcomes, depends: a1-outcome-helper}
  **Finalize → `passed` for all un-finalized sections.**
  Add `finalizeOutcomes(db, draftId)` to `ui/src/lib/digest/llm.ts`. For each
  section in the draft where the `llm_cost_log` row for that `artifact_id` has
  `outcome IS NULL`, UPDATE outcome → `'passed'`, recovery_cost → 0.0. Fire-and-
  forget (wrapped in try/catch).
  In `POST /api/digest/:roundId/finalize/+server.ts`, after `firstFinalize` is
  confirmed true, call `finalizeOutcomes(db, draft.id)`.
  Scoped test: after finalizeOutcomes, all null-outcome rows for the draft's
  section ids are stamped `passed`; already-stamped rows (salvaged, rejected) are
  untouched. **Acceptance:** test green; existing finalize tests still green;
  `npm run check` 0 errors.

- [ ] {agent: backend, id: a5-delight-route, depends: a1-outcome-helper}
  **`POST /api/digest/:roundId/delight` — new route.**
  Create `ui/src/routes/api/digest/[roundId]/delight/+server.ts`.
  Body: `{ sectionId: string, span: string, subsection?: string, note?: string }`.
  Validate sectionId resolves to a section in this round's draft (JOIN
  `digest_sections` → `digest_drafts` WHERE `round_id = ?`). Derive `cost_log_id`
  from `llm_cost_log WHERE artifact_id = sectionId ORDER BY id DESC LIMIT 1`.
  Insert into `llm_delight`. Return `{ ok: true, delightId }`.
  Scoped test: valid POST inserts delight row with correct cost_log_id; unknown
  sectionId → 404; missing span → 400. **Acceptance:** 3 tests green; `npm run
  check` 0 errors.

- [ ] {agent: backend, id: a6-health-events}
  **Health-event logging on callOpenRouter failure.**
  In `ui/src/lib/digest/llm.ts`, `callOpenRouter`: on the `!res.ok` throw path,
  before throwing, attempt a fire-and-forget INSERT into `llm_health_event`. Requires
  `meta?.db` to be present (no-op when meta absent). `error_class='provider_error'`,
  `model` from the resolved model string, `detail` = `text.slice(0,500)`.
  On the JSON-parse / `!content` path: `error_class='capability_mismatch'` (OpenRouter
  returned 200 but content was missing/malformed).
  **CONTROL GAP:** `callOpenRouter` currently throws immediately on HTTP error; the
  health-event write must happen BEFORE the throw. This is a minor refactor of the
  existing error path. Scoped test: mock a non-ok response; verify `llm_health_event`
  row inserted with correct error_class. **Acceptance:** test green; existing
  `callOpenRouter` tests still green; `npm run check` 0 errors.

- [ ] {agent: backend, id: a7-archive-outcomes}
  **Archive section outcomes: refresh → `rejected`, hold/lock published → `passed`.**
  In `POST /api/content/:leagueId/update/+server.ts` (`buildUpdatedReadModel`):
  for each section that ran `runPrediction` (superlatives, fingerprints, reel,
  moments, season-update), the `runPrediction` call already returns
  `{ output, meta }`. The `meta` does NOT currently return the `prediction_runs.id`
  for the row just inserted. **CONTROL GAP (moderate):** `runPrediction` does not
  return its own row id, so we cannot do a direct UPDATE by id. Two approaches:
  (A) add `rowId` to `PredictionMeta` return type (Lane A owns `predict.ts` in this
  sprint — but `predict.ts` is NOT in the file list above). To avoid expanding lane
  scope, use approach (B): after each `runPrediction` call, do a SELECT on
  `prediction_runs WHERE task_id = ? AND (player_id = ? OR player_id IS NULL) ORDER
  BY created_at DESC LIMIT 1` to get the latest row id, then UPDATE.
  For 'hold'/'lock' sections (skipped LLM calls), do the same SELECT to locate the
  most-recent prior row and stamp it `passed`.
  Scoped test: after archive update with one 'refresh' and one 'hold' section, the
  refresh task's latest `prediction_runs` row has `outcome='rejected'`; the hold
  task's latest row has `outcome='passed'`. **Acceptance:** test green; existing
  archive tests green; `npm run check` 0 errors.
  **Open question for orc/owner:** should `predict.ts` be added to Lane A for this
  sprint so `runPrediction` can cleanly return `rowId`? That would eliminate the
  SELECT-after-INSERT approach. Recommend yes — see Open Questions below.

### Lane B — Frontend

- [ ] {agent: frontend, id: b1-delight-control, depends: a5-delight-route}
  **▲ delight control in DigestSection.svelte.**
  In `ui/src/lib/digest/DigestSection.svelte`: add a ▲ thumbs-up button in the
  section header action bar (alongside the existing edit/regen/lock controls).
  Clicking ▲ opens a bottom-sheet modal (same visual style as the cost-proto
  `DelightScreen` in `cost-flows.jsx`): shows section name + generated-by model;
  span-picker (clickable sentence highlights within the section's rendered text);
  optional note textarea; "✦ Save signal" CTA.
  On save: `POST /api/digest/:roundId/delight` with `{ sectionId, span, subsection,
  note }`. On success: show a brief "✦ marked" badge on the section header (transient
  state, not persisted to UI beyond session).
  The control is visible only when the section has a `llm_cost_log` entry (i.e.,
  was AI-generated — not manually-created). In v1, show it for all non-excluded
  AI-generated sections regardless of whether a delight was already logged.
  **CONTROL GAP:** The current `DigestSection.svelte` does not expose a per-section
  run-model display. Add a small read-only "Generated by {model}" label sourced from
  `llm_cost_log` via a new lightweight GET (or pass from the parent page as a prop).
  Simplest v1: add `generatedModel?: string` prop to DigestSection; parent page
  populates it from a GET `/api/cost/calls?date=today` filter by sectionId (or add
  a new focused endpoint). Flag this in the Activity Log if it requires a new
  backend endpoint — escalate to orc before adding routes.
  **Acceptance:** `npm run check` 0 errors; ▲ button present on AI sections;
  modal renders with span-picker; POST fires on save; "✦ marked" badge appears;
  412px screenshot shows control not overflowing; desktop screenshot shows it inline.

### Gate

- [ ] {agent: orc, id: gate, depends: a1-outcome-helper,a2-edit-outcome,a3-regen-outcome,a4-finalize-outcomes,a5-delight-route,a6-health-events,a7-archive-outcomes,b1-delight-control}
  **Gate.** Cross-check path-scoped commits (no lane overlap); `cd ui && npm run
  check` (0 errors); `cd ui && npx vitest run` (all green); **owner UAT**:
  (1) generate digest, inline-edit a section → verify `llm_cost_log.outcome='salvaged'`
  + `edit_distance > 0` via SQL; (2) regen a section → verify prior row
  `outcome='rejected'`; (3) finalize untouched sections → verify `outcome='passed'`
  on all null rows; (4) tap ▲ on a section, pick a span, save → verify `llm_delight`
  row in DB; (5) trigger archive update with one 'refresh' section → verify
  `prediction_runs.outcome='rejected'` for that task; (6) check
  `llm_health_event` by forcing a bad API key and verifying a row is inserted.
  On sign-off → v1.9.0 bump + CHANGELOG + deploy (orc-gated, cached → :3002) +
  assert live; close sprint and campaign.

## v1 Scope Guardrails

- **NO `llm_eval` / AI-judge / evaluator (stage 3).** Stage 3 is future. Do not
  create any eval table or scoring path in this sprint.
- **Health events quarantined.** `llm_health_event` rows are NOT included in any
  usability denominator or score. The health axis is rendered separately (if at all)
  and does not affect recovery_cost.
- **Reachable outcome rungs by surface:**
  - **Digest:** full ladder — `passed`, `healed` (auto-retry, already set by
    `callOpenRouter` technical default), `salvaged` (inline-edit), `rejected`
    (regen/skip), `unusable` (callOpenRouter finish_reason=length|content_filter,
    already set by sprint-39 wrapper).
  - **Predict / archive (`prediction_runs`):** `passed`, `rejected`, `unusable` only.
    No salvage rung (no inline-edit on dashboard sections). `healed` not reachable
    (no retry path that resolves successfully — the retry on schema-miss either
    succeeds → null/passed or fails → unusable).
- **`regen_changed` discrimination** (none/params/model) stubbed as `'none'` in v1.
  The data slot exists; the discrimination logic is deferred.
- **No b-side / archive section inline-edit.** Archive sections are full-replace on
  'refresh'; no granular edit surface. No salvage rung.
- **No delight UI on archive / predict sections.** Delight control is digest-only
  in this sprint; the `cost_log_id` linkage in `llm_delight` is nullable for predict
  rows.
- **Finalize trigger is first-finalize only.** `finalizeOutcomes` is called only
  when `firstFinalize === true` (i.e., `draft.finalized_at` was null). Re-finalize
  does not re-stamp already-set outcomes.

## Control Gap Summary

| # | Gap | Impact | Resolution |
|---|-----|--------|------------|
| CG-1 | `regen_changed` discrimination ('none'/'params'/'model') | Minor | Stub `'none'` in v1; data slot exists for stage-3 enrichment |
| CG-2 | `digest_regenerations` stores prior+new content but does NOT link back to `llm_cost_log.id` | Minor | Use `artifact_id = sectionId` as the lookup key (most-recent row). Unambiguous because each section regen produces exactly one new cost-log row. |
| CG-3 | `runPrediction` does not return its own row id (`prediction_runs.id`) | Moderate | Use SELECT-after-INSERT as the lookup for archive outcome stamps. OR (preferred) add `rowId` to `PredictionMeta` — see Open Questions. |
| CG-4 | `callOpenRouter` health-event write requires `meta?.db`; called without meta from `proposeRelContextUpdate` (relContext.ts) | Minor | Health events only logged when meta.db is present; relContext calls pass meta.db per sprint-39 a4 — already wired. |
| CG-5 | No clean "skip on finalize" event distinct from "untouched pass". Both produce `outcome='passed'`. | Minor | Intentional: finalize stamps null-outcome rows as passed. A section finalized without any human action IS a pass. No separate skip event needed. |
| CG-6 | DigestSection.svelte does not currently expose the per-section generating model to the delight modal | Minor | Add `generatedModel?: string` prop; parent page populates from cost log. If this requires a new endpoint, Lane B must escalate before adding routes. |

## Decision Log

### 2026-06-18 — Sprint-42 planned (orc)
Sprint-42 is the final campaign sprint (sprint-39 Decision Log: "active fields →
follow-on usability-capture sprint"). Scope is the six human-action outcome paths
enumerated in sprint-39's 2026-06-18 Usability capture INCLUDED decision.
Two file-disjoint lanes: backend (Lane A) + frontend (Lane B). Version target
v1.9.0 (sprint-40 took v1.8.0).

### 2026-06-18 — artifact_id = sectionId as the update key (orc)
The `llm_cost_log.artifact_id` column (written by `logLlmCall` at generation time)
holds the `digest_sections.id` string for section-level calls. This is the correct
lookup key for all outcome UPDATE operations. Evidence: `llm.ts:778–780` —
`artifactId: sectionMeta.sectionId`. The most-recent row for an artifactId is
always the most-recent generation of that section (regen replaces content; the
old cost-log row is what we're stamping rejected).

### 2026-06-18 — `regen_changed` discrimination deferred to stage 3 (orc)
Discriminating 'params'/'model'/'none' requires comparing the prior row's params
blob and model to the new call. The data exists (`llm_cost_log.params`,
`llm_cost_log.model`), but the comparison logic is non-trivial and adds surface to
an already-wide backend lane. Stub `'none'` in v1; stage-3 enrichment can fill this
retroactively since the params + model are already stored.

### 2026-06-18 — OQ-1 approved: predict.ts added to Lane A; rowId in PredictionMeta (backend)
`predict.ts` was added to Lane A scope. `PredictionMeta` now includes `rowId: string` — the
`prediction_runs.id` of the row just inserted. This enables `stampPredictionOutcome` in the
archive update route to do a direct UPDATE by id (no SELECT-after-INSERT needed for the new
row), and to stamp the PRIOR row by id-exclusion. Lane B acknowledged restriction on `predict.ts`.
Cache-hit paths in `submissionPredict.ts` and `voteProbe.ts` use `rowId: ''` (no row inserted
on cache hit).

### 2026-06-18 — CG-1 stub confirmed: regen_changed='none' in v1 (backend)
`regen_changed` is stubbed as `'none'` for all v1 regen outcomes as designed. A TODO comment
at the call site in `sections/[id]/regenerate/+server.ts` marks the stage-3 discrimination
point: `// TODO stage-3: discriminate params/model changes (OQ/CG-1)`.

### 2026-06-18 — Delight route placed at sections/[id]/delight not roundId/delight (backend)
The delight route was created at `[roundId]/sections/[id]/delight/+server.ts` (sectionId from
URL params) rather than the coord-doc's `[roundId]/delight/+server.ts` (sectionId in body).
Both approaches are valid; the URL-param form is more RESTful and consistent with sibling routes.
Frontend Lane B must POST to `/api/digest/:roundId/sections/:sectionId/delight` with body
`{ span, subsection?, note? }` (sectionId already in the URL path, no need in body).

### 2026-06-18 — Delight control is digest-only in sprint-42 (orc)
The `llm_delight` table supports a nullable `cost_log_id` link. The sprint-42
delight control is wired only to digest sections (where `llm_cost_log` rows exist).
Predict/archive delight signals are a future enhancement (cost-dashboard v2 or
campaign follow-on).

## Ratification Log

_(Pending owner ratification before dispatch.)_

## Blockers

None known.

## Open Questions for Orc/Owner

**OQ-1 (Lane A scope): Should `predict.ts` be added to Lane A?**
`runPrediction` returning `rowId: string` from `PredictionMeta` would let task a7
do a direct `UPDATE prediction_runs SET outcome=? WHERE id=?` rather than a
SELECT-after-INSERT. This is cleaner and testable without race conditions.
Downside: `predict.ts` is a shared dependency; adding it to Lane A means Lane B
must not touch it. In practice Lane B has never touched `predict.ts` — this is
safe. Recommendation: add `predict.ts` to Lane A for a7 only; Lane B acknowledged
restriction. **Awaiting owner decision before dispatch.**

**OQ-2 (delight model display): New endpoint or prop threading?**
The ▲ delight modal wants to show "Generated by {model}" for context. Options:
(A) Thread model as a prop from the digest page (page.server.ts enriches sections
with a JOIN on `llm_cost_log`). (B) New lightweight `GET /api/digest/:roundId/
sections/:id/cost-meta` endpoint returning `{model, costUsd, runId}`.
Option A avoids a new endpoint but touches page-level data fetching (which is
read-only). Option B is cleaner but adds surface. **Awaiting orc preference.**

**OQ-3 (sprint-40 overlap): Is sprint-40 shipped?**
Sprint-40-cost-dashboard.md exists in the docs/coordination/ directory but was
noted in sprint-41 as gated on CD design. If sprint-40 shipped ahead of this sprint
and its dashboard already reads usability columns, confirm no display changes are
needed in this sprint (sprint-42 writes to the columns; sprint-40 reads them — the
data will start flowing automatically). **No sprint-42 work needed if sprint-40 is
already live.**

## Activity Log

### 2026-06-18 — backend — tasks a1–a7 + OQ-1 implemented
- a1: `setLlmOutcome` + `RECOVERY_COST` + `editDistanceRatio` + `finalizeOutcomes` added to `llm.ts`.
  All outcome writes fire-and-forget (try/catch). npm check 0 errors.
- a2: `sections/[id]/+server.ts` PATCH — stamps salvaged + edit_distance after content edit.
  Prior content_json captured before UPDATE; editDistanceRatio computed server-side.
- a3: `sections/[id]/regenerate/+server.ts` — stamps prior row rejected + regen_changed='none'
  after replaceSectionContent succeeds. TODO CG-1 comment left at call site.
- a4: `finalize/+server.ts` — calls finalizeOutcomes(db, draft.id) on firstFinalize=true.
- a5: New route `sections/[id]/delight/+server.ts` created. POST validates section in round,
  resolves cost_log_id, inserts llm_delight row. Returns {ok, delightId}.
- a6: `callOpenRouter` in llm.ts — fire-and-forget llm_health_event INSERT on !res.ok
  (provider_error) and !content (capability_mismatch). No-op when opts.meta.db absent.
- a7: `content/[leagueId]/update/+server.ts` — stampPredictionOutcome helper added.
  Wired at all 5 runPrediction call sites: superlatives, fanHater, reel, moments, seasonUpdate.
  Refresh sections stamp prior row rejected (excluding new rowId); hold/lock stamp passed.
- OQ-1: `PredictionMeta.rowId` added to predict.ts. Cache-hit paths (submissionPredict,
  voteProbe) use rowId: ''. FK callers (submissionPredict.ts, voteProbe.ts) fixed.
- Tests: 3 test files, 29 tests green. Full suite: 74 files, 716 tests, 0 failures.
- npm check: 0 errors, 48 warnings (pre-existing).
- Coord-doc updated: OQ-1 + CG-1 Decision Log entries; delight route path correction noted.

### 2026-06-18 — orc — sprint-42 coord-doc authored
- Read sprint-39 (cost ledger decision log + schema contracts #1/#6/#7).
- Read sprint-40/41 coord-docs for structural template.
- Read `ui/src/lib/digest/llm.ts` (full): confirmed `logLlmCall` writes
  `artifact_id = sectionMeta.sectionId` (`llm.ts:778–780`); `regenerateOneSection`
  passes `runId + sectionId` as `sectionMeta` (`llm.ts:771`); `generateDraft`
  pre-mints `draftId` + `runId` and stores `run_id` on `digest_drafts`
  (`llm.ts:718–719`, `868`).
- Read `SectionInlineEditor.svelte`: pure client-side editor; emits rebuilt content
  via `onSave` callback. Does NOT compute or store edit_distance. Content comparison
  must happen server-side at the PATCH route (`sections/[id]/+server.ts:37–40`).
- Read `digest_regenerations` schema (`schema.ts:182–191`): table stores
  `prior_content_json` and `new_content_json` per regen — SUFFICIENT to compute
  edit_distance post-hoc, but sprint-42 computes it at PATCH time (inline-edit path)
  and stamps it immediately.
- Read `finalize/+server.ts`: `firstFinalize` flag available (`finalize.ts:47`).
  No current outcome-stamping code. Clean insertion point at line 50.
- Read `sections/[id]/+server.ts` (PATCH): content edit path at line 37–40.
  Prior content (`section.content_json`) is available before the UPDATE. Clean
  insertion point for `editDistanceRatio` + `updateLlmOutcome`.
- Read `sections/[id]/regenerate/+server.ts`: `sectionId` and prior content
  available; `replaceSectionContent` called at line 80. Clean insertion point.
- Read `content/[leagueId]/update/+server.ts`: `decision` per section at line 88–
  93; `runPrediction` calls at lines 349, 391, 425, 441, 575.
  `dashboard_section_state` written at lines 142–147. **CONTROL GAP CG-3** noted:
  `runPrediction` returns `{ output, meta }` where `meta` = `{ model, costUsd,
  latencyMs }` — no `rowId`. SELECT-after-INSERT is the fallback; preferred fix
  is to add `rowId` to `predict.ts` PredictionMeta (OQ-1 above).
- Read `predict.ts` (full): confirmed `runPrediction` inserts `runRowId` into
  `prediction_runs.id` at line 163 but does not return it. `outcome` is null for
  success path (line 86/206); `'unusable'` on retry failure (line 120).
- Read `schema.ts` (full): `llm_cost_log` (lines 309–337), `llm_health_event`
  (lines 340–347), `llm_delight` (lines 349–356) all exist from sprint-39.
  `digest_regenerations` (lines 182–191) has `prior_content_json` + `new_content_json`.
  `dashboard_section_state` (client.ts:359–369): `league_id`, `section`, `decision`,
  `steer` — no direct link to `prediction_runs.id`.
- Cost-proto and cost-flows JSX read: `DelightScreen` component (`cost-flows.jsx:
  405–484`) is the reference shape for the ▲ delight control; span-picker modal with
  optional note. CSS/shape to lift for `DigestSection.svelte` Lane B work.
- 2 file-disjoint lanes defined; 8 tasks (a1–a7 + b1 + gate); 6 control gaps
  documented; 3 open questions flagged for owner. Coord-doc written.
