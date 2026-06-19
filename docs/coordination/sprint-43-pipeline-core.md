---
status: shipped
shippedIn: v1.10.0
campaign: generation-pipeline
sprint: sprint-43-pipeline-core
version: v1.10.0
created: 2026-06-18
depends_on: sprint-42-usability-capture
---

# music-league-bot — coordination doc (sprint-43-pipeline-core)

> **Sprint:** Generation Pipeline — core backend. Introduce the `Pipeline` config
> type, `resolvePipeline`, and rewire `generateDraft` to run EPs. Ship the
> conservative one-skip default pipeline so that per-section model pins are honored
> on the initial digest draft — closing the production gap where a fresh digest
> always used the bucket default. Adds covers (auto-rerun into a later EP with
> context) but NOT the review UI (sprint-44). Backend-only sprint.
>
> Spec: `docs/design/per-section-gen/_unzip/pipeline-handoff/IMPLEMENTATION.md` §2–§6.
> Handoff package: `docs/design/per-section-gen/_unzip/pipeline-handoff/`.

## Sprint Goals

1. **Pipeline type + storage.** The `Pipeline` config type; one stored row
   (`settings` key `pipeline_config`, JSON value). `resolvePipeline` splits `order`
   into EPs at `skipAfter`, places covers, groups tracks by model within an EP.
2. **Rewire `generateDraft`.** Run the EP sequence; pass prior-EP output as context.
   **The regression guard is sacred:** a no-skip, single-model pipeline MUST reduce
   to exactly today's single `callOpenRouter` with the same cost/latency/output shape.
3. **Generalize the merge prompt.** The call can request any subset of sections via
   a parameterized section list and JSON schema — the general case between the current
   all-six draft and the existing single-section regen.
4. **Covers.** When the pipeline defines a cover, auto-fire it into the next EP using
   prior context. Persist BOTH the original and cover outputs; the review UI (sprint-44)
   needs both.
5. **Ship the one-skip default pipeline.** EP1: factual/extractive tracks (quotes,
   consensus, podium, chat) merged on the digest-bucket model. EP2: voice tracks
   (villain, flow) reading EP1's full output. Per-section model pins bind here on
   first draft.
6. **Scoped tests.** Regression guard test (degenerate → one call); pins-honored test
   (multi-model pipeline produces one call per unique model per EP); covers-persisted test.

## Agent Roster — 1 lane

One coherent backend unit; the tasks are strictly ordered because each depends on
the previous. No file-disjoint split needed.

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `ui/src/lib/digest/pipeline.ts` (new); `ui/src/lib/digest/llm.ts` (rewire `generateDraft`; generalize `buildUserPrompt` for subset sections); `ui/src/lib/db/client.ts` (guarded ALTER if needed); `ui/src/lib/db/schema.ts` (cover flag on `digest_regenerations` if separate column chosen — see Contract 3); scoped test files | `DigestSection.svelte`, any `.svelte`, `modelFor.ts` (read-only import OK), `settings.ts`, any route files other than those pipeline needs to call |

> No frontend changes in this sprint. Cover review UI ships in sprint-44.

## Cross-Lane CONTRACTS (pinned — no renegotiation)

### 1. Pipeline type (canonical definition in `pipeline.ts`)

```ts
// ui/src/lib/digest/pipeline.ts

export type Track = {
  section: SectionKind;
  model?: string;     // explicit override; absent = modelForSection(section, db)
};

export type Cover = {
  of: SectionKind;    // which track to re-run
  model: string;      // MUST be specified for a cover
};

export type Pipeline = {
  releaseKind: 'digest';          // v1: digest only
  order: SectionKind[];           // run order (must include all active sections)
  models: Partial<Record<SectionKind, string>>;  // per-section model overrides
  skipAfter: Partial<Record<SectionKind, true>>; // a skip sits after this section
  covers: Cover[];
};

// EP = one parallel phase (tracks between two skips)
export type EP = {
  groups: { model: string; sections: SectionKind[] }[]; // merged groups within this EP
  covers: Cover[];                                       // covers firing in this EP
};
```

### 2. `resolvePipeline` signature (exported from `pipeline.ts`)

```ts
export function resolvePipeline(
  pipeline: Pipeline,
  activeSections: SectionKind[],
  db: Database.Database,
): EP[];
```

- Filters `pipeline.order` to `activeSections` (respects disabled/chat-unavailable).
- Splits into EPs at `skipAfter` boundaries.
- Appends a trailing EP for any covers whose original is in the last EP, if needed.
- Within each EP, groups tracks by resolved model (`pipeline.models[s] ?? modelForSection(s, db)`).
- Returns an ordered EP array; empty EPs are elided.
- **Degenerate case guarantee:** a pipeline with no `skipAfter` entries and a single
  resolved model for all sections returns `[{ groups: [{ model, sections: allActive }], covers: [] }]`
  — exactly one group, exactly one `callOpenRouter`.

### 3. Cover storage (pinned — sprint-44 frontend reads this)

Covers are stored as `digest_regenerations` rows with `cover_kind = 'pipeline_cover'`
(a new column on `digest_regenerations`). The column distinguishes automatic pipeline
covers from user-triggered regens. Schema migration: guarded ALTER in `client.ts`.

```sql
-- schema.ts: add to digest_regenerations DDL (new column)
cover_kind  TEXT  -- NULL = user regen; 'pipeline_cover' = auto pipeline cover

-- client.ts guarded ALTER
const regenCols = db.prepare("PRAGMA table_info(digest_regenerations)").all() as { name: string }[];
if (regenCols.length && !regenCols.some(c => c.name === 'cover_kind')) {
  db.exec("ALTER TABLE digest_regenerations ADD COLUMN cover_kind TEXT");
}
```

Sprint-44 frontend queries: `SELECT * FROM digest_regenerations WHERE section_id = ?
AND cover_kind = 'pipeline_cover' ORDER BY ran_at DESC LIMIT 1` to get the cover
to display in A/B review.

### 4. `generateDraft` output shape extension (sprint-44 must not break)

`DraftLLMOutput.sections` gains an optional `_covers` map for cover outputs:

```ts
interface DraftLLMOutput {
  sections: Record<SectionKind, unknown>;
  _covers?: Partial<Record<SectionKind, unknown>>; // cover output, keyed by section
  costUsd: number;
  draftId?: string;
  runId?: string;
}
```

The cover output in `_covers` is what gets written to `digest_regenerations` with
`cover_kind = 'pipeline_cover'`. The `sections` map always holds the original
(first-EP) output, even when a cover exists. `writeDraft` writes sections from
`sections`; a new `writePipelineCovers` helper writes the `_covers` map.

### 5. Regression guard (pinned contract + mandatory test)

**Contract:** A no-skip single-model pipeline — i.e., `skipAfter = {}`, `covers = []`,
and all active sections resolve to the same model — MUST produce exactly ONE
`callOpenRouter` call with the same JSON schema, cost, latency, and output shape as
today's `generateDraft`. This is a hard correctness invariant, not a performance
suggestion.

**Mandatory test** (`pipeline.test.ts`):
```ts
it('degenerate pipeline → single callOpenRouter', async () => {
  // Arrange: spy on callOpenRouter; single-model pipeline, no skips, no covers
  // Act: generateDraft with the degenerate pipeline
  // Assert: callOpenRouter called exactly once; sections contain all 6 kinds;
  //         the prompt includes all 6 section descriptions (same as today's build)
  //         the JSON schema is unchanged (same keys requested)
});
```

If this test cannot be written to pass, the implementation has regressed the common
path. Block the gate until it passes.

### 6. Default pipeline value (stored at first boot)

```ts
export const DEFAULT_PIPELINE: Pipeline = {
  releaseKind: 'digest',
  order: ['quotes', 'consensus', 'podium', 'chat', 'villain', 'flow'],
  models: {},          // all sections use per-section pin → bucket default
  skipAfter: { chat: true },  // one skip: EP1 = factual/extractive; EP2 = voice
  covers: [],          // no covers in the default; user adds via future settings UI
};
```

Serialized as `settings` key `pipeline_config`, value = `JSON.stringify(DEFAULT_PIPELINE)`.
Written at `openLeagueDb` time via `INSERT OR IGNORE INTO settings (key, value)`.

### 7. Per-call `callOpenRouter` meta for pipeline calls

Each EP group call uses `LLMCallMeta` with:
- `category: 'digest'`
- `label: 'digest:ep{n}:{sections.join('+')}' ` — e.g. `'digest:ep0:quotes+consensus+podium'`
- `runId`, `artifactType: 'digest_draft'`, `artifactId: draftId` (same across the run)

Cover calls use `label: 'digest:cover:{section}'`, same `runId`.

## Working Agreements (sprint-43)

- **Backend only.** No `.svelte` files touched. No route files added.
- **Regression guard must pass before gate.** The degenerate-pipeline test is a
  mandatory gate condition, not optional coverage.
- **No emoji** — functional Unicode glyphs only. **No raw hex** — tokens only.
- **Svelte 5 runes** (not applicable — backend only). No reactive blocks in any
  touched `.svelte`.
- **SQLite only, no migration framework.** New columns via guarded ALTER in
  `client.ts` (PRAGMA table_info check before ALTER). New tables via
  `CREATE TABLE IF NOT EXISTS` in `schema.ts`.
- **Path-scoped commits.** `git commit -m "feat(pipeline): ..." -- <paths>`.
  Never `git commit --amend` on shared HEAD.
- **`callOpenRouter` meta on every EP call.** All calls log to `llm_cost_log` with
  the correct `label`, `runId`, and `artifactId`.
- **`modelForSection` is the resolver.** Never hard-code a model string in
  `resolvePipeline`. The pipeline's `models` map overrides per-section; if absent,
  `modelForSection(section, db)` is the truth.
- Scoped tests per task; full `cd ui && npm run check` (0 errors) + `npx vitest run`
  (all green) are the orc gate.
- Log each completed task to the Activity Log with its commit hash.
- Version target: v1.10.0 (bump only at gate).

## Active Sprint Plan

### Lane A — Backend

- [ ] {agent: backend, id: a1-pipeline-type} **`Pipeline` type + `resolvePipeline` + default config.**
  Create `ui/src/lib/digest/pipeline.ts`. Export `Track`, `Cover`, `Pipeline`, `EP`
  types per Contract 1. Export `resolvePipeline(pipeline, activeSections, db): EP[]`
  per Contract 2. Export `DEFAULT_PIPELINE` per Contract 6.
  In `client.ts` `openLeagueDb`: add `INSERT OR IGNORE INTO settings (key,value) VALUES
  ('pipeline_config', ?)` with `JSON.stringify(DEFAULT_PIPELINE)` to seed the default on
  first boot.
  Scoped unit tests (`pipeline.test.ts`):
  - degenerate pipeline (no skips, one model) → 1 EP, 1 group (**regression guard Contract 5**).
  - two-model no-skip pipeline → 1 EP, 2 groups.
  - one-skip pipeline → 2 EPs, factual tracks in EP0, voice in EP1.
  - cover placed into trailing EP.
  - `activeSections` filter: disabled section excluded from EPs.
  **Acceptance:** all tests green; `npm run check` 0 errors.

- [ ] {agent: backend, id: a2-merge-prompt, depends: a1-pipeline-type}
  **Generalize `buildUserPrompt` to accept any subset of sections.**
  In `ui/src/lib/digest/llm.ts`, extract the section-list portion of `buildUserPrompt`
  so it can be called with a `sections: SectionKind[]` parameter instead of always
  calling `activeKindsForDraft`. The JSON schema requested in the prompt must be
  parameterized to match the requested sections only.
  Current behavior (all sections requested, full schema) must remain the default when
  called without a `sections` override — no callers outside `generateDraft` are affected
  yet.
  Scoped test: prompt for `['villain', 'flow']` only contains those two section descriptions
  and requests only those two JSON keys.
  **Acceptance:** `npm run check` 0 errors; existing `buildUserPrompt` tests still green.

- [ ] {agent: backend, id: a3-rewire-generatedraft, depends: a2-merge-prompt}
  **Rewire `generateDraft` to run the pipeline.**
  In `ui/src/lib/digest/llm.ts`:
  1. Load `pipeline_config` from the settings table (fall back to `DEFAULT_PIPELINE`).
  2. Call `resolvePipeline(pipeline, activeKinds, db)` to get the EP array.
  3. For each EP (in order), for each model-group in the EP: call `callOpenRouter`
     with the merged prompt requesting exactly the group's sections; parse the partial
     JSON; accumulate sections output.
  4. For each EP after EP0: include all prior EPs' combined section output as an
     assistant-turn context message (the prior context injection).
  5. Merge all sections output into one `sections` map (cover outputs into `_covers`
     per Contract 4).
  6. Return `DraftLLMOutput` with the same shape as before (cost = sum of all calls).
  **Regression guard:** the `resolvePipeline` degenerate test (a1) plus the mandatory
  `generateDraft` integration test (Contract 5) must both pass. If the degenerate
  pipeline does not reduce to a single `callOpenRouter` with the same prompt/schema as
  today, stop and raise a blocker — do not proceed to a4.
  **Acceptance:** regression-guard test green; `npm run check` 0 errors; existing
  `generateDraft` tests (if any) still green.

- [ ] {agent: backend, id: a4-covers, depends: a3-rewire-generatedraft}
  **Covers: auto-fire into next EP; persist both takes.**
  When a pipeline EP's `covers` array is non-empty, for each cover:
  1. The original section output (from an earlier EP) is already in `sections`.
  2. Build a cover call: same `buildUserPrompt` with the cover's section only +
     prior-EP context (the combined output of all EPs so far, including the original
     for this section).
  3. Call `callOpenRouter` with the cover model; parse the result.
  4. Store the cover output in `_covers[section]` on `DraftLLMOutput`.
  In `writeDraft` (or a new `writePipelineCovers` helper), after writing sections,
  for each key in `_covers`, insert a `digest_regenerations` row:
  - `section_id = draftId-{section}` (matches the `digest_sections.id` format at `llm.ts:900`)
  - `prior_content_json = JSON.stringify(sections[section])` (the original)
  - `new_content_json = JSON.stringify(_covers[section])` (the cover)
  - `cover_kind = 'pipeline_cover'`
  - `chips = '[]'`, `instructions = 'pipeline cover'`
  Schema migration: guarded ALTER in `client.ts` per Contract 3.
  Scoped test: pipeline with one cover → `digest_regenerations` row with `cover_kind =
  'pipeline_cover'`; original in `sections`; cover in `_covers` and in the regen row.
  **Acceptance:** test green; `npm run check` 0 errors.

- [ ] {agent: backend, id: a5-default-pipeline-smoke, depends: a4-covers}
  **Smoke test: default pipeline end-to-end.**
  Write an integration test using a real `resolvePipeline` call on `DEFAULT_PIPELINE`
  with all 6 active sections and a mocked `db` that returns distinct models for villain
  and flow (to verify they end up in EP1) and the bucket default for the other four
  (to verify they merge in EP0):
  - EP0 should have 1 group containing `['quotes','consensus','podium','chat']` (or
    whichever 4 use the same model).
  - EP1 should have 1 group containing `['villain','flow']` (or split if different
    models pinned).
  - Pins honored: if villain is pinned to a different model than flow, EP1 has 2 groups.
  This is the "pins honored on initial draft" acceptance check — the production gap is
  closed when this test passes.
  **Acceptance:** test green; `npm run check` 0 errors; `npx vitest run` all green.

### Gate

- [ ] {agent: orc, id: gate, depends: a1-pipeline-type,a2-merge-prompt,a3-rewire-generatedraft,a4-covers,a5-default-pipeline-smoke}
  **Gate.**
  1. Cross-check path-scoped commits (no lane overlap, no `--amend`).
  2. `cd ui && npm run check` (0 errors); `cd ui && npx vitest run` (all green, including
     regression guard test from a1 and degenerate integration test from a3).
  3. **Owner UAT:**
     (a) Generate a fresh digest for a live round; confirm `llm_cost_log` shows 2 rows
     (EP0 + EP1 calls) and both are labeled correctly (`digest:ep0:…`, `digest:ep1:…`);
     confirm each section's content is present.
     (b) Temporarily set villain and flow to the same model as the rest; regenerate;
     confirm a single `llm_cost_log` row (degenerate case in prod).
     (c) Confirm per-section pin: pin villain to a premium model via Settings → Models &
     AI; generate a fresh draft; confirm villain's EP call used the pinned model in
     `llm_cost_log.model`.
  4. On sign-off → v1.10.0 bump + CHANGELOG + deploy (orc-gated, cached → :3002).
  5. Close sprint; confirm sprint-44 is unblocked.

## v1 Scope Guardrails

- **Digest only.** The `Pipeline.releaseKind` field is `'digest'` in v1. Archive
  pipelines are a v2 concern; do not model archive EP logic in this sprint.
- **One shared pipeline.** No per-league profiles (ROADMAP). `pipeline_config` is a
  single `settings` row; there is no pipeline roster or assignment table.
- **No recoup / budgeting.** No budget evaluation at skips. Model assignment is
  static from the config + pins (ROADMAP).
- **No Feature / duets.** A `Cover` is a single re-run, not a dual-output (ROADMAP).
- **No UI.** No pipeline builder or settings screen in this sprint. The default
  pipeline is the only config; sprint-44 may expose the cover toggle but not the full
  pipeline editor.
- **No archive pipeline.** The predict-task `modelFor` bypass (noted in sprint-41
  per-section-models as a separate wiring task) is out of scope. `pipeline.ts` imports
  only `SECTION_KINDS` and `SectionKind` from `llm.ts`; it does not touch predict tasks.
- **`regenerateOneSection` unchanged.** Per-section user regens continue to use
  `regenerateOneSection` directly. The pipeline only runs on initial draft generation.
  Sprint-44 cover picks will reuse `regenerateOneSection` for the preference-capture
  write.

## Decision Log

### 2026-06-18 — Sprint-43 planned (orc)
Campaign `generation-pipeline` — sprint-43 is the backend-only core. Closes the
production gap (per-section pins ignored on initial draft) found in sprint-41's
known-limitation note. The handoff package (`pipeline-handoff/`) is the spec.
Single backend lane: the tasks are strictly ordered; the regression guard (Contract 5)
is the hardest constraint and is pinned as a mandatory gate condition.

### 2026-06-18 — Pipeline config stored in `settings` table (orc)
Decision: use `settings` key `pipeline_config` (JSON string) rather than a separate
`pipeline_config` table. Evidence: the `settings` table already stores all scalar
config via `INSERT OR REPLACE` (`db/settings.ts:18`); `predict_model` and `digest_model`
follow the same pattern. A single pipeline config is a single scalar value; no CRUD
UI or indexing needed in v1. A table would be premature until per-league profiles land.

### 2026-06-18 — Cover stored as `digest_regenerations` row with `cover_kind` column (orc)
Decision: persist covers as `digest_regenerations` rows flagged with a new
`cover_kind TEXT` column (NULL = user regen; `'pipeline_cover'` = auto pipeline cover),
rather than a `content_json.cover` slot on the section.
Evidence: `digest_regenerations` already stores `prior_content_json` / `new_content_json`
per regen (`schema.ts:182–191`); the cover fits this shape exactly (original = prior,
cover = new). A `content_json.cover` slot would require the page to parse section JSON
and mutate it — coupling the section content shape to pipeline internals. The regen
row is already the established pattern for "an alternative version of a section." Sprint-44
frontend queries it by `cover_kind = 'pipeline_cover'`.

### 2026-06-18 — `resolvePipeline` resolves models from DB pins (orc)
The `Pipeline.models` map provides explicit model overrides per section. When a section
is absent from `models`, `modelForSection(section, db)` is called (which falls back to
`modelFor(bucket, db)` → env → hardcoded). This means the pipeline config does NOT
duplicate what is already stored in per-section settings; it only carries explicit
experiment overrides. In the default pipeline, `models = {}` and all sections use their
current DB pins. Per-section pins flow through naturally on first draft — the production
gap is closed.

### 2026-06-18 — One-skip default pipeline shape (orc)
The default pipeline splits at `chat: true` (after the 4 factual/extractive tracks) per
DESIGN-RATIONALE §4: coherence dependency concentrates in villain and flow; the
factual/extractive tracks (quotes, consensus, podium, chat) are near-independent
(dep 0–1). One skip means one EP boundary and one latency barrier — the minimum to
get voice sections reading the full factual picture. Order within EP0:
`['quotes','consensus','podium','chat']`; within EP1: `['villain','flow']`. If chat is
disabled (no chat data), the EP0 group shrinks but the skip boundary is preserved at
the last EP0 section (podium in that case — `resolvePipeline` filters to active sections
before splitting).

## Ratification Log

_(Pending owner ratification before dispatch.)_

## Blockers

None known.

## Open Questions for Orc/Owner

**OQ-1 (context injection format): How to inject prior-EP output as context?**
The simplest approach is to append the prior EPs' combined section JSON as an
`assistant` message in the `callOpenRouter` messages array (a synthetic "I already
wrote these sections" turn). This matches how `regenerateOneSection` today passes
`currentContent`. An alternative is to embed the prior output in the user prompt.
The assistant-turn approach is cleaner for JSON-mode calls. Recommendation: assistant
turn injection. No user action needed — backend agent decides at a3; note approach
in Activity Log.

**OQ-2 (chat section edge case): skipAfter `chat: true` when chat is disabled.**
If chat is disabled (no chat data in the round), `chat` is not in `activeSections`.
`resolvePipeline` must handle the case where the `skipAfter` anchor (`chat`) is not
in the active section list: the skip should effectively move to the last section before
where `chat` would have been (i.e., `podium`). Recommend: after filtering to
`activeSections`, find the last section whose predecessor in `pipeline.order` had
`skipAfter = true`, and treat that as the EP boundary. Backend agent to document
the chosen rule in the Activity Log.

**OQ-3 (cover auto-generate in default pipeline): covers array is empty in DEFAULT_PIPELINE.**
The default pipeline ships with `covers: []`. Covers are only activated when the user
(or a future settings UI) adds a cover to the pipeline config. This means sprint-43
delivers cover MACHINERY but no production cover is auto-generated until the user
explicitly configures one. Is this the right default? The alternative is to add a
default cover of `flow` on a premium model. Recommendation: keep `covers: []` for now
— the machinery is the deliverable; cover configuration is a sprint-44 / settings-UI
concern. No user action needed; noting for awareness.

## Activity Log

### 2026-06-18 — orc — sprint-43 coord-doc authored
- Read `pipeline-handoff/` README, DESIGN-RATIONALE, IMPLEMENTATION, ROADMAP.
- Read `ui/src/lib/digest/llm.ts` (full): `generateDraft` at line 734 — one
  `callOpenRouter` with `model = modelFor('digest', db)` (line 735); `buildUserPrompt`
  at line 606 — section list built by `activeKindsForDraft` (line 705). `regenerateOneSection`
  at line 773 — calls `modelForSection(kind, db)` (line 784). `writeDraft` at line 863 —
  section ids formatted as `${draftId}-${kind}` (line 900). `replaceSectionContent` at
  line 910 — writes `digest_regenerations` with `prior_content_json` / `new_content_json`.
- Read `ui/src/lib/digest/modelFor.ts` (full): `modelForSection` at line 60 —
  fallback chain settings[digest_model_{section}] → modelFor(bucket, db) → env →
  hardcoded. `SECTION_BUCKET_MAP` at line 34 — 6 digest + 10 predict keys.
- Read `ui/src/lib/db/schema.ts` (full): `settings` table at line 92 (key TEXT PRIMARY
  KEY, value TEXT). `digest_regenerations` at line 182 — has `prior_content_json` and
  `new_content_json`, no `cover_kind` column. `llm_cost_log` at line 309 — has
  `outcome`, `label`, `run_id`, `artifact_id`.
- Read `ui/src/lib/db/settings.ts` (full): `getSettings` reads settings table; `updateWeights`
  uses `INSERT OR REPLACE`. Settings pattern: key/value, JSON.stringify for complex values.
- Read `ui/src/lib/db/client.ts` (lines 1–140): guarded ALTER pattern confirmed —
  PRAGMA table_info check before ALTER (lines 17–113). `INSERT OR IGNORE` for DEFAULT_SETTINGS
  seeding at line 138.
- Read sprint-41, sprint-42 coord-docs as structural template.
- Verified: `generateDraft` uses `model = modelFor('digest', db)` — the bucket default —
  NOT `modelForSection`, so per-section pins are indeed ignored on first draft. The
  production gap is real and confirmed.
- Verified: sprint-42 shipped v1.9.0 (2026-06-18); this sprint targets v1.10.0.
- Authored sprint-43-pipeline-core.md. Single backend lane; 5 ordered tasks + gate.
  Regression guard pinned as Contract 5 and mandatory gate condition.
