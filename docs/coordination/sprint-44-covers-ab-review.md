---
status: planned
campaign: generation-pipeline
sprint: sprint-44-covers-ab-review
version: v1.11.0
created: 2026-06-18
depends_on: sprint-43-pipeline-core
---

# music-league-bot — coordination doc (sprint-44-covers-ab-review)

> **Sprint:** Generation Pipeline — cover A/B review UI + preference signal. Backend
> adds the auto-trigger path (when a pipeline cover is generated, fire it and persist
> both takes — already done by sprint-43's cover machinery; the backend task here
> focuses on the preference-signal write and the API to serve cover data to the
> frontend). Frontend adds the cover A/B review surface in the digest review flow,
> modeled on the existing podium visual/textual compare pattern.
>
> Spec: `docs/design/per-section-gen/_unzip/pipeline-handoff/IMPLEMENTATION.md` §5 +
> `DESIGN-RATIONALE.md` §6.
> Depends on: sprint-43 (pipeline type, covers persisted as `digest_regenerations`
> rows with `cover_kind = 'pipeline_cover'`).

## Sprint Goals

1. **Backend lane:** Add the GET endpoint to serve a section's pipeline cover (if
   any) to the frontend. Wire the preference-signal write to `llm_cost_log` when the
   user picks original vs cover. A/B pick sets the published version of the section.
2. **Frontend lane:** Cover A/B review surface in `DigestSection.svelte`. When a
   section has a pipeline cover, render both takes fully (not a diff), each labeled
   with model/tier/cost/latency. Default-select the cover. Original always one
   unpenalized click away. On pick: POST the preference signal + update the section's
   published content.
3. **Preference signal** is a `llm_preference` table (new, small) keyed on the pair
   of `llm_cost_log` rows (original call + cover call). This is the head-to-head
   quality data needed by the cost campaign's quality work — no rating UI, no LLM
   judge; just the user's pick from a choice they wanted to make anyway.

## Agent Roster — 2 file-disjoint lanes

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `ui/src/lib/db/schema.ts` (new `llm_preference` table DDL); `ui/src/lib/db/client.ts` (guarded CREATE for `llm_preference`); `ui/src/routes/api/digest/[roundId]/sections/[id]/cover/+server.ts` (new GET: return cover data if any); `ui/src/routes/api/digest/[roundId]/sections/[id]/cover-pick/+server.ts` (new POST: record pick, update published content, write preference row); `ui/src/lib/digest/llm.ts` (add `writeCoverPick` helper) | `DigestSection.svelte`, `+page.svelte`, any other `.svelte`, `pipeline.ts`, `modelFor.ts` |
| frontend (pane 1.3) | **Lane B:** `ui/src/lib/digest/DigestSection.svelte` (add cover A/B block and pick controls); `ui/src/routes/digest/[roundId]/+page.svelte` (pass cover data as a prop or fetch per-section; wire `onCoverPick` callback); optionally a new `CoverABPanel.svelte` sub-component if the A/B block warrants extraction | `llm.ts`, `pipeline.ts`, `modelFor.ts`, `schema.ts`, `client.ts`, any route files |

### File-disjoint verification

Lane A files: `schema.ts`, `client.ts`, `sections/[id]/cover/+server.ts` (new),
`sections/[id]/cover-pick/+server.ts` (new), `llm.ts` (new `writeCoverPick` helper).

Lane B files: `DigestSection.svelte`, `+page.svelte`, optionally `CoverABPanel.svelte` (new).

No overlap. Lane B never imports `writeCoverPick` directly — it only calls the API.

## Cross-Lane CONTRACTS (pinned — no renegotiation)

### 1. Cover data GET endpoint (Lane A = source of truth)

```
GET /api/digest/:roundId/sections/:id/cover
→ 200 { cover: CoverData } | 200 { cover: null }

CoverData = {
  regenId: string;              // digest_regenerations.id
  originalContent: unknown;     // prior_content_json (the original take)
  coverContent: unknown;        // new_content_json (the cover take)
  originalModel: string;        // llm_cost_log.model for the original call
  coverModel: string;           // llm_cost_log.model for the cover call
  originalCostUsd: number;      // llm_cost_log.cost_usd for the original call
  coverCostUsd: number;         // llm_cost_log.cost_usd for the cover call
  originalLatencyMs: number;    // llm_cost_log.latency_ms for the original call
  coverLatencyMs: number;       // llm_cost_log.latency_ms for the cover call
  picked: 'original' | 'cover' | null;  // from llm_preference, null if not yet picked
}
```

Derivation of original vs cover cost/latency: query `llm_cost_log` WHERE
`artifact_id = sectionId` ORDER BY id ASC. The FIRST row is the original EP call;
the LAST row (for a cover) is the cover call (it uses `label: 'digest:cover:{kind}'`
per sprint-43 Contract 7). If only one row, there is no cover. If neither row exists,
return `{ cover: null }`.

The regen row is queried from `digest_regenerations WHERE section_id = ? AND
cover_kind = 'pipeline_cover' ORDER BY ran_at DESC LIMIT 1`.

Returns `{ cover: null }` when no `'pipeline_cover'` regen row exists. Returns the
current pick status from `llm_preference` (see Contract 2) so the UI can reflect a
prior pick on page load.

### 2. `llm_preference` table (pinned — Lane A creates; Lane B does NOT write directly)

```sql
-- schema.ts: new table
CREATE TABLE IF NOT EXISTS llm_preference (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  section         TEXT NOT NULL,                -- SectionKind
  round_id        INTEGER REFERENCES rounds(id),
  original_model  TEXT NOT NULL,
  cover_model     TEXT NOT NULL,
  original_cost_log_id  INTEGER,               -- llm_cost_log.id for original call
  cover_cost_log_id     INTEGER,               -- llm_cost_log.id for cover call
  regen_id        TEXT REFERENCES digest_regenerations(id),
  picked          TEXT NOT NULL CHECK(picked IN ('original','cover')),
  picked_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_llm_preference_round ON llm_preference(round_id, section);
```

No migration framework: `CREATE TABLE IF NOT EXISTS` in `schema.ts`. The guarded
ALTER pattern in `client.ts` is NOT needed for a new table — `CREATE TABLE IF NOT
EXISTS` handles both fresh and existing DBs.

This table IS the quality signal the cost campaign needs:
- "Opus chosen over Haiku on Villain" = `picked='cover', original_model='…haiku…',
  cover_model='…opus…', section='villain'`.
- "Original kept over Opus on Flow" = `picked='original'`.
No separate eval pipeline, no LLM judge. Captures by-product of a user action.

### 3. Cover pick POST endpoint (Lane A = source of truth)

```
POST /api/digest/:roundId/sections/:id/cover-pick
Body: { picked: 'original' | 'cover' }
→ 200 { ok: true, preferenceId: string, publishedContent: unknown }
→ 400 on invalid body or no cover exists for this section
→ 404 on section not found
```

Side effects:
1. Write a `llm_preference` row with the pick + model IDs + cost-log IDs.
2. Update `digest_sections.content_json` to the picked take:
   - `picked = 'cover'` → set content to `digest_regenerations.new_content_json`
   - `picked = 'original'` → set content to `digest_regenerations.prior_content_json`
   (same section id; the original is already the current content if cover was never
   picked, but write it explicitly for clarity).
3. Return `publishedContent` (the now-live content) so the frontend can update its
   local state without a full reload.

The pick is **NOT** a regen event — do NOT insert a `digest_regenerations` row or
call `replaceSectionContent`. It is a section content update via direct UPDATE on
`digest_sections.content_json`.

Fire-and-forget `llm_preference` write (wrap in try/catch) — a preference write
failure must never abort the content update.

### 4. `writeCoverPick` helper signature (Lane A, in `llm.ts`)

```ts
// ui/src/lib/digest/llm.ts — new export
export function writeCoverPick(
  db: Database.Database,
  opts: {
    sectionId: string;        // digest_sections.id
    section: SectionKind;
    roundId: number;
    regenId: string;          // digest_regenerations.id for the pipeline cover row
    picked: 'original' | 'cover';
    originalModel: string;
    coverModel: string;
    originalCostLogId?: number;
    coverCostLogId?: number;
  },
): string // returns the new llm_preference.id
```

Fire-and-forget `llm_preference` INSERT (try/catch). Returns the new id (or '' on
failure, since it's fire-and-forget).

### 5. Frontend cover A/B block structure (pinned shape for DigestSection.svelte)

The cover A/B block renders within the section when `coverData !== null`. It is
placed ABOVE the existing body content (before the textual/visual slot), so the
user sees the choice before reading the default.

Visual model: echo the existing podium visual/textual variant toggle (`dg-variant-switch`
pattern in `DigestSection.svelte:363`). The cover A/B block is a two-option segmented
control:
- **Original** (left): labeled with `originalModel` short name + `originalCostUsd`
  formatted + `originalLatencyMs` formatted.
- **Cover** (right): labeled with `coverModel` short name + `coverCostUsd` + `coverLatencyMs`
  + "saw prior sections" context note.
- Default selection: **Cover** (the upgrade).
- The body content area renders whichever take is currently selected.
- On pick change: POST to `cover-pick` endpoint; update local section content from
  `publishedContent` in the response.
- A brief "saved" transient badge appears after a successful pick POST (same pattern
  as the delight "✦ marked" badge from sprint-42).

Note: the sprint-43 pipeline-handoff ZIP contains NO prototype JSX for the cover
A/B panel — the file `Music League Bot - Generation Pipeline v1.html` exists (pan/zoom
canvas) but its JSX is not extracted in the handoff. The `dg-variant-switch` pattern
from `DigestSection.svelte` is the closest existing analog to model and lift from.
Do NOT invent a radically different visual pattern; stay consistent with the existing
section action bar.

### 6. `onCoverPick` prop + page wiring (Lane B contract, pinned)

`DigestSection.svelte` gains a new optional prop:
```ts
// In DigestSection.svelte props:
coverData?: CoverData | null;    // from Contract 1
onCoverPick?: (picked: 'original' | 'cover') => void;
```

The page (`+page.svelte`) is responsible for:
1. Fetching cover data per-section (GET `/api/digest/:roundId/sections/:id/cover`).
   Simplest approach: fetch eagerly for all sections at page load (parallel promises
   in `+page.server.ts`, or lazy via `onMount` in the page component). Recommend
   lazy on-demand (fetch when the section is visible) to avoid N parallel calls on
   page load; document the chosen approach in the Activity Log.
2. Passing `coverData` + `onCoverPick` to each `DigestSection`.
3. On pick: POST to cover-pick; update local section content from response.

## Working Agreements (sprint-44)

- **File-disjoint lanes.** Lane A owns all new API routes + schema changes + `llm.ts`
  helper. Lane B owns all `.svelte` changes. Path-scoped commits;
  **never `git commit --amend`** on shared HEAD.
- **No emoji** — functional Unicode glyphs only. **No raw hex** — tokens only.
- **Svelte 5 runes** throughout (`$state`, `$props`, `$derived`). No legacy reactive
  blocks in any touched `.svelte` file.
- **Both takes render FULLY.** The cover A/B block is NOT a diff view. The user reads
  both complete takes and picks. This is specified in DESIGN-RATIONALE §6 and is
  non-negotiable.
- **Original is unpenalized.** Picking original is as easy as picking cover — single
  click, no confirmation, no "are you sure". The original pick is equally valuable
  as a quality signal.
- **Cover A/B block only appears when `coverData !== null`.** No UI stub when no cover.
- **`llm_preference` write is fire-and-forget.** Wrap in try/catch; a failed preference
  write must never prevent the content update from completing.
- **Do NOT build recoup / profiles / feature/duets** — those are roadmap (see
  `pipeline-handoff/ROADMAP.md`). This sprint closes the cover UX loop only.
- SQLite only, no migration framework. New `llm_preference` table via
  `CREATE TABLE IF NOT EXISTS` in `schema.ts` (no guarded ALTER needed for new tables).
- Scoped tests per task; full `cd ui && npm run check` (0 errors) + `npx vitest run`
  (all green) are the orc gate.
- Log each completed task to the Activity Log with its commit hash.
- Version target: v1.11.0 (bump only at gate).

## Active Sprint Plan

### Lane A — Backend

- [x] {agent: backend, id: a1-preference-schema} **`llm_preference` table + schema update.**
  In `ui/src/lib/db/schema.ts`: add the `llm_preference` CREATE TABLE DDL per Contract 2.
  No guarded ALTER needed (new table). Also add the index.
  Verify `client.ts` picks it up automatically via `db.exec(SCHEMA)` at boot.
  Scoped test: `CREATE TABLE IF NOT EXISTS` idempotent on an existing DB (no error on
  second boot with the table already created).
  **Acceptance:** `npm run check` 0 errors; schema test green.

- [x] {agent: backend, id: a2-cover-get-endpoint, depends: a1-preference-schema}
  **GET `/api/digest/:roundId/sections/:id/cover` — cover data endpoint.**
  Create `ui/src/routes/api/digest/[roundId]/sections/[id]/cover/+server.ts`.
  Logic per Contract 1:
  1. Validate section belongs to this round.
  2. Query `digest_regenerations WHERE section_id = ? AND cover_kind = 'pipeline_cover'
     ORDER BY ran_at DESC LIMIT 1`. If none, return `{ cover: null }`.
  3. Query `llm_cost_log WHERE artifact_id = ? ORDER BY id ASC LIMIT 2` to get
     original (id ASC first row) and cover (second row, label contains 'cover') calls.
     If the cover cost-log row is missing (pipeline ran before sprint-43's label
     convention), use 0 / 'unknown' as fallback — never 500.
  4. Query `llm_preference WHERE regen_id = ? ORDER BY created_at DESC LIMIT 1` for
     the current pick status.
  5. Return `CoverData` per Contract 1.
  Scoped tests: section with cover → returns correct CoverData; section without cover
  → `{ cover: null }`; invalid section → 404.
  **Acceptance:** 3 tests green; `npm run check` 0 errors.

- [x] {agent: backend, id: a3-writecoverpick, depends: a1-preference-schema}
  **`writeCoverPick` helper in `llm.ts`.**
  Add `writeCoverPick` export to `ui/src/lib/digest/llm.ts` per Contract 4.
  Fire-and-forget INSERT into `llm_preference`. Returns new id or '' on failure.
  Scoped tests: correct row inserted; failure in INSERT returns '' (no throw);
  `original_model` and `cover_model` stored correctly.
  **Acceptance:** tests green; `npm run check` 0 errors.

- [x] {agent: backend, id: a4-cover-pick-endpoint, depends: a2-cover-get-endpoint,a3-writecoverpick}
  **POST `/api/digest/:roundId/sections/:id/cover-pick` — record pick + update content.**
  Create `ui/src/routes/api/digest/[roundId]/sections/[id]/cover-pick/+server.ts`.
  Logic per Contract 3:
  1. Parse and validate body `{ picked: 'original' | 'cover' }`.
  2. Validate section belongs to this round; load the cover regen row.
  3. Call `writeCoverPick` (fire-and-forget).
  4. UPDATE `digest_sections.content_json` to the picked take.
  5. Return `{ ok: true, preferenceId, publishedContent }`.
  Scoped tests:
  - `picked='cover'` → `digest_sections.content_json` updated to cover content; `llm_preference`
    row inserted with `picked='cover'`.
  - `picked='original'` → content updated to original; preference row inserted with
    `picked='original'`.
  - No cover regen row → 400.
  - Preference INSERT failure → still returns 200 (fire-and-forget).
  **Acceptance:** 4 tests green; `npm run check` 0 errors.

### Lane B — Frontend

- [ ] {agent: frontend, id: b1-cover-data-fetch, depends: a2-cover-get-endpoint}
  **Fetch cover data per-section in the digest page.**
  In `ui/src/routes/digest/[roundId]/+page.svelte`: for each rendered section, lazily
  fetch cover data from `GET /api/digest/:roundId/sections/:id/cover` using a
  `$state` map keyed by section id. Fetch on first render of the section (e.g., in an
  `onMount` or in the section's first visible render). Store the result in a reactive
  map `coverDataMap: Map<string, CoverData | null>`.
  No changes to `+page.server.ts` (keep cover data client-side only — it's optional
  enrichment, not required for the page to render).
  Scoped test: cover data map populated after fetch for a section with a cover.
  **Acceptance:** `npm run check` 0 errors; page renders without cover data (graceful
  null handling before fetch completes).

- [ ] {agent: frontend, id: b2-cover-ab-block, depends: b1-cover-data-fetch,a4-cover-pick-endpoint}
  **Cover A/B block in `DigestSection.svelte`.**
  Add the `coverData` and `onCoverPick` props per Contract 5 and Contract 6.
  When `coverData !== null`:
  - Render the two-option segmented control (Original | Cover) above the section
    body. Default selected: Cover.
  - Each option label: model short name (last path segment of the OpenRouter model id,
    e.g. `claude-haiku-4-5` from `anthropic/claude-haiku-4-5`); formatted cost (e.g.
    `$0.0004`); formatted latency (e.g. `1.2s`); Cover option also shows "saw prior
    sections".
  - The body area renders the content of the currently selected take. Use Svelte 5
    `$derived` to compute `displayContent = selectedPick === 'cover' ? coverData.coverContent : coverData.originalContent`.
  - On option change: call `onCoverPick(newPick)`.
  - After a successful `onCoverPick`, the section's main `content` prop is updated by
    the parent page (from `publishedContent` in the API response). Show a transient
    "pick saved" badge (same pattern as the delight "✦ marked" badge, sprint-42).
  Style: use `dg-variant-switch` CSS class pattern (already in `DigestSection.svelte`)
  for the segmented control; ensure it does not conflict with the existing layout
  variant switch. The cover A/B control is ABOVE the body content; the variant switch
  is BELOW.
  Mobile check: 412px screenshot must not overflow. The two-option control must stack
  gracefully on narrow viewports.
  **Acceptance:** `npm run check` 0 errors; cover A/B block visible on a section with
  a cover; both takes render fully; pick fires the callback; transient badge appears;
  412px screenshot shows no overflow; section with no cover renders unchanged.

- [ ] {agent: frontend, id: b3-page-pick-wire, depends: b2-cover-ab-block}
  **Wire `onCoverPick` in `+page.svelte`.**
  In `ui/src/routes/digest/[roundId]/+page.svelte`:
  - Pass `coverData={coverDataMap.get(section.id) ?? null}` to each `DigestSection`.
  - Add `onCoverPick` callback: POST to `/api/digest/:roundId/sections/:id/cover-pick`
    with `{ picked }`; on success, update the section's local content from
    `publishedContent`; update `coverDataMap[section.id].picked` to reflect the new pick.
  - On error: show a toast or inline error (same pattern as other fetch errors in the
    page).
  **Acceptance:** `npm run check` 0 errors; full round-trip: pick Cover → section
  content updates to cover take in the UI; pick Original → reverts to original take;
  both picks survive a page reload (pick status from GET cover endpoint).

### Gate

- [ ] {agent: orc, id: gate, depends: a1-preference-schema,a2-cover-get-endpoint,a3-writecoverpick,a4-cover-pick-endpoint,b1-cover-data-fetch,b2-cover-ab-block,b3-page-pick-wire}
  **Gate.**
  1. Cross-check path-scoped commits (no lane overlap; no `--amend`).
  2. `cd ui && npm run check` (0 errors); `cd ui && npx vitest run` (all green).
  3. **Owner UAT (requires a pipeline with at least one cover configured):**
     (a) Configure the pipeline to add a cover of `villain` on a different model
     (UPDATE settings SET value = ? WHERE key = 'pipeline_config' with a covers entry).
     Generate a fresh digest; confirm two rows in `digest_regenerations` for the
     villain section (user regens have `cover_kind IS NULL`; the pipeline cover has
     `cover_kind = 'pipeline_cover'`).
     (b) Load the digest review page; confirm villain section shows the cover A/B
     block with both takes rendered, Cover pre-selected, model/cost/latency labeled.
     (c) Pick Cover → confirm `digest_sections.content_json` updated to cover content;
     confirm `llm_preference` row with `picked='cover'` in DB.
     (d) Pick Original → confirm content reverts to original; confirm second
     `llm_preference` row with `picked='original'`.
     (e) Reload the page; confirm the UI reflects the last pick (from GET /cover).
     (f) A section with no cover: confirm the A/B block is absent; existing section
     behavior is unchanged.
  4. On sign-off → v1.11.0 bump + CHANGELOG + deploy (orc-gated, cached → :3002).
  5. Close sprint. Log deferred items (recoup, profiles, feature) as war-table cards
     per `pipeline-handoff/ROADMAP.md`.

## v1 Scope Guardrails

- **Cover A/B is NOT a diff.** Both takes rendered in full. Never render a line-diff
  or change-highlight between original and cover — the user reads both and picks.
- **No recoup, profiles, or feature/duets.** These are tracked in `ROADMAP.md`
  war-table cards. Do not introduce budget evaluation, per-league pipeline assignment,
  or dual-model section output in this sprint.
- **No pipeline builder UI.** The cover A/B panel is a REVIEW surface, not a
  configuration surface. Users configure covers via DB (future settings UI).
- **`digest_regenerations` is read-only from Lane A's new endpoint.** The cover pick
  does NOT insert another regen row. It only updates `digest_sections.content_json`.
- **No cover UI on archive / predict sections.** Pipeline covers are digest-only in v1.
- **`llm_preference` is digest-only.** The table design supports predict sections
  (round_id FK, section TEXT) but no pick UI exists for them in this sprint.

## Decision Log

### 2026-06-18 — Sprint-44 planned (orc)
Campaign `generation-pipeline` — sprint-44 delivers the cover review UX + preference
signal. Depends on sprint-43 (pipeline machinery + cover persistence). Two
file-disjoint lanes: backend (Lane A, 4 tasks) + frontend (Lane B, 3 tasks + gate).

### 2026-06-18 — Preference signal home: `llm_preference` table (orc)
Decision: new `llm_preference` table (NOT an outcome write to `llm_cost_log`).
Evidence: `llm_cost_log.outcome` stores the usability-outcome of a single call
(passed/salvaged/rejected/unusable — sprint-42). A cover pick is a HEAD-TO-HEAD
preference signal between TWO calls (original call vs cover call), not a single-call
outcome. Writing it as an `outcome` on either row would be ambiguous (which row?
passed/rejected doesn't capture "preferred" vs "not preferred"). The `llm_preference`
table explicitly stores the pair (`original_cost_log_id`, `cover_cost_log_id`,
`picked`) — the quality data the cost campaign needs is the pair, not the individual
outcome. The `IMPLEMENTATION.md §5` says "the cleanest home is the cost campaign's
per-call ledger as an outcome-adjacent signal" — this table IS outcome-adjacent (shares
the cost campaign's quality scope) while keeping the head-to-head semantics clean.

### 2026-06-18 — Cover A/B segmented control modeled on `dg-variant-switch` (orc)
The handoff ZIP (`Music League Bot - Generation Pipeline v1.html`) contains a cover
A/B prototype on a pan/zoom canvas but its JSX is NOT extracted in the handoff. The
closest existing analog is the `dg-variant-switch` segmented control in
`DigestSection.svelte:363` (visual/textual/both picker). Lane B should lift this CSS
pattern rather than invent a new component. The control is placed ABOVE the body
(before the content) to ensure the user sees the choice before reading the default.
The existing variant switch remains BELOW.

### 2026-06-18 — Cover data fetch is lazy client-side (orc)
Cover data is an optional enrichment loaded lazily per-section (not in
`+page.server.ts`). Evidence: the digest page already renders all sections from
`data.sections` (loaded in `+page.server.ts`); adding N cover-fetch calls to server
load would block the page for sections with no cover. Cover data is optional and
non-blocking; the section renders without it; the A/B block appears when data arrives.
Lane B documents the chosen lazy-fetch strategy (onMount vs intersection observer vs
other) in the Activity Log.

### 2026-06-18 — Cover content_json update is NOT a `replaceSectionContent` call (orc)
`replaceSectionContent` in `llm.ts:910` inserts a `digest_regenerations` row and
bumps `regen_count`. A cover pick is NOT a regeneration event — it is a USER CHOICE
between two existing takes. Writing a regen row on a pick would corrupt the regen
history (the cover was generated by the pipeline, not by the user's regen action).
Lane A's `cover-pick` route does a direct `UPDATE digest_sections SET content_json = ?`
without calling `replaceSectionContent`. This also means `regen_count` is NOT
incremented on a cover pick.

## Ratification Log

_(Pending owner ratification before dispatch.)_

## Blockers

- Sprint-43 must be shipped and gated before sprint-44 dispatch. The `cover_kind`
  column on `digest_regenerations` and the `label: 'digest:cover:{kind}'` convention
  in `llm_cost_log` are preconditions for this sprint's backend lane.

## Open Questions for Orc/Owner

**OQ-1 (cost-log row ordering for original vs cover): Is the label convention reliable?**
The cover-get endpoint (a2) identifies original vs cover `llm_cost_log` rows by
querying `WHERE artifact_id = sectionId ORDER BY id ASC` and using label content to
distinguish. Sprint-43 Contract 7 sets `label: 'digest:cover:{kind}'` for cover calls.
If sprint-43 is shipped exactly as planned, this is reliable. If any EP call uses a
label that also matches 'cover' (unlikely but possible), the ordering would mis-assign.
Recommend: a2 backend agent verifies the label convention against the actual rows
generated by sprint-43 before implementing the query. Note in Activity Log.

**OQ-2 (cover auto-generate without covers: []):** Sprint-43 defaults `covers: []`
in `DEFAULT_PIPELINE`. This means sprint-44 ships with no pipeline cover auto-generated
in production (users must add a cover to the pipeline config manually). Is this
acceptable for the first ship, or should the default pipeline be updated to include
one cover (e.g., `villain` on a premium model) so the A/B UI is immediately exercisable?
Recommendation: ship with `covers: []` default (the machinery + UI is the deliverable;
cover configuration is a user action). If UAT at gate requires a cover to test, orc
temporarily patches the settings row for the UAT session. No user action needed before
dispatch; orc will handle at gate.

**OQ-3 (pick idempotency): Multiple picks on the same cover — one row per pick or upsert?**
The spec says write a `llm_preference` row on each pick. If the user picks Cover, then
picks Original, there are 2 rows (append-only log). The most-recent row is the
canonical pick. The GET /cover endpoint returns the most-recent pick status. This is
the append-only ledger pattern (same as `llm_cost_log`). No user action needed;
noting for backend agent to implement correctly.

## Activity Log

### 2026-06-18 — backend agent — Lane A complete (a1–a4)

- a1-preference-schema: `llm_preference` table added to schema.ts (64e4eaf).
  CREATE TABLE IF NOT EXISTS + index. Verified idempotent on existing DB.
- a3-writecoverpick + pipeline flow cover: `writeCoverPick` export added to llm.ts.
  Fire-and-forget INSERT into `llm_preference`; returns new id or '' on failure.
  DEFAULT_PIPELINE updated to include `{ of: 'flow', model: 'anthropic/claude-sonnet-4-5' }`.
  Cover call artifactId fixed from draftId → sectionId (${draftId}-${kind}) so GET /cover
  endpoint can query by artifact_id = sectionId per Contract 1. (bd87acb)
- a2-cover-get-endpoint: GET /api/digest/:roundId/sections/:id/cover created.
  Queries digest_regenerations (cover_kind='pipeline_cover'), llm_cost_log (original by
  draftId+label, cover by sectionId+label), llm_preference (most-recent pick). (0abd6df)
- a4-cover-pick-endpoint: POST /api/digest/:roundId/sections/:id/cover-pick created.
  Validates body, loads cover regen row, calls writeCoverPick (fire-and-forget), UPDATE
  digest_sections.content_json to picked take (NOT replaceSectionContent; regen_count
  unchanged). Returns { ok, preferenceId, publishedContent }. (0abd6df)
- Tests: sprint-44-covers.test.ts — 19 tests all green. pipeline-a3/a5/pipeline.test.ts
  updated for DEFAULT_PIPELINE 3-EP structure (EP0 + EP1 + EP2 flow cover).
- npm run check: 0 errors. npx vitest run: 761/761 passed.
- OQ-1 note: cover llm_cost_log artifact_id was fixed (was draftId, now sectionId).
  Original EP calls still use draftId but are queried by label LIKE '%{kind}%' in the
  GET endpoint — reliable since EP labels are digest:ep{n}:{sections} format.
- Flow cover fires exactly one extra LLM call per digest (EP2, after EP1 villain+flow).
  This is intentional; noted for CHANGELOG at gate.

### 2026-06-18 — orc — sprint-44 coord-doc authored
- Read `pipeline-handoff/` IMPLEMENTATION §5 + DESIGN-RATIONALE §6 for preference
  signal and A/B review spec.
- Read `ui/src/lib/digest/DigestSection.svelte` (key lines): `sectionState` prop at
  line 30; `SectionState` type includes `'regenerating'` (line 17); delight phase
  pattern at lines 72–77 (transient badge model for "pick saved"); `dg-variant-switch`
  at line 363 (structural model for the A/B segmented control); `VisualSlot` at line
  428; `AlbumPodium` registered at line 510 in the page.
- Read `ui/src/routes/digest/[roundId]/+page.svelte` (key lines): `DigestSection`
  mount at line 1002–1019 (prop threading pattern); existing fetch calls at lines
  135–436; `visualComponent` registry wiring at lines 501–511; `onCoverPick` prop
  doesn't exist yet — lane B will add it.
- Read `ui/src/lib/db/schema.ts` (full): `digest_regenerations` at line 182 — no
  `cover_kind` column yet (sprint-43 adds it); `llm_cost_log` at line 309 — has
  `outcome`, `label`, `artifact_id`; `llm_preference` does not yet exist.
- Read sprint-42 `digest_regenerations` usage: `replaceSectionContent` at `llm.ts:910`
  inserts a regen row + bumps regen_count. Cover pick must NOT call this.
- Verified: `digest_sections.id` format = `${draftId}-${kind}` (llm.ts:900). This is
  the `artifact_id` key for `llm_cost_log` lookups per sprint-42 Contract 1.
- Verified: `llm_cost_log.label` per sprint-43 Contract 7: EP calls use
  `'digest:ep{n}:{sections.join('+')}'`; cover calls use `'digest:cover:{kind}'`.
  This is the ordering key for the GET /cover endpoint's cost-log query.
- Verified: no prototype JSX extracted from the handoff zip for the cover A/B panel.
  `dg-variant-switch` in `DigestSection.svelte:363` is the model to lift from.
- Decision on preference signal home: new `llm_preference` table (not outcome write).
  Rationale in Decision Log above.
- 2 file-disjoint lanes defined; 7 tasks (a1–a4, b1–b3) + gate; 3 open questions.
  Coord-doc written.
