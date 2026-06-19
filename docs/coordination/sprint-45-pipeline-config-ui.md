---
status: planned
campaign: generation-pipeline
sprint: sprint-45-pipeline-config-ui
version: v1.12.0
created: 2026-06-18
depends_on: sprint-44-covers-ab-review
---

# music-league-bot — coordination doc (sprint-45-pipeline-config-ui)

> **Sprint:** Generation Pipeline — Pipeline Config UI. Add a no-code screen
> (a new "Pipeline" tab on the Models & AI screen at `/settings/models`) that
> lets the operator view and edit the `pipeline_config` JSON without touching
> code. The design is owner-approved and locked; this doc is the build spec.
>
> Design packet: `docs/design/per-section-gen/_ui_unzip/pipeline-handoff/config-ui/`
> (`README.md` — locked Q1–Q5; `DESIGN-RATIONALE.md` — the three-facts problem;
> `IMPLEMENTATION.md` — code mapping + build order + paste-ready prompt).
> Depends on: sprint-44 (`llm_preference` table shipped; cover A/B review live;
> `resolvePipeline` exported from `pipeline.ts`).
>
> NOTE: the handoff ZIP contains no prototype HTML or JSX for the Pipeline tab.
> Lane B builds Option A from the DESIGN-RATIONALE description, the existing
> Models & AI panel patterns, and the sprint-41 per-section overrides panel as
> the closest structural analog.

## Sprint Goals

1. **Lane A (backend):** Add `GET /api/settings/pipeline-config` (return stored
   `Pipeline` JSON, falling back to `DEFAULT_PIPELINE` if unset) and
   `PUT /api/settings/pipeline-config` (validate + write; body must be a valid
   `Pipeline`). Small, file-contained, parallels the existing `debug-mode` and
   `openrouter-key` settings routes.

2. **Lane B (frontend):** Add a "Pipeline" tab to `ModelsScreen.svelte` (a new
   internal content section, not a new `SettingsTabs` route — see Pipeline Tab
   Placement below). Build the Option A flat-track-list editor wired to a
   working-copy `Pipeline`. Show merge-rail + skip dividers computed from the
   shipped `resolvePipeline` resolver. Add cover sub-rows (inline under their
   section). Drive the run preview (call count + relative cost band) from the
   resolver. Fold model-setting in per Q3 by making the sprint-41 per-section
   overrides panel read-only with a link to Pipeline tab. Responsive: Option A
   on mobile, Option C two-pane on desktop, Option B as read-only EP-card state.

3. **E2E confirm:** Save writes `pipeline_config` to DB; Reset restores
   `DEFAULT_PIPELINE`; resolver-driven preview updates on every edit; Q3
   read-only mirror is visible in the existing per-section overrides card.

## Pipeline Tab Placement (pinned decision)

**The Pipeline tab is implemented as a new internal section within
`ModelsScreen.svelte`, toggled by an in-page tab strip (not a new route in
`SettingsTabs.svelte`).**

Evidence:

- `ui/src/lib/components/SettingsTabs.svelte` (lines 14–19): the top-level
  settings tabs are `App Settings` (`/settings`), `Music League Setup`
  (`/settings/setup`), `Models & AI` (`/settings/models`), and `Debug`
  (`/settings/debug`). These are page-level navigation tabs. Adding a fifth
  top-level tab would require a new SvelteKit route at `/settings/pipeline`.

- `ui/src/routes/settings/models/+page.svelte` (lines 1–21): the Models & AI
  page is a thin wrapper that renders `SettingsTabs` then `ModelsScreen`. All
  content lives inside `ModelsScreen.svelte`.

- `ui/src/lib/models/ModelsScreen.svelte` (lines 396–869): the screen is a
  flat `div.mlm-screen` with four `<article>` cards stacked vertically.
  No in-page tab strip exists today.

- `README.md` Q4 (locked): "A new **'Pipeline' tab on the Models & AI screen**
  — not a separate page."

Conclusion: Lane B adds a fifth `<article>` card with an in-page tab strip
(e.g. `Models | Pipeline` segmented control or tab row at the top of
`ModelsScreen.svelte`) that switches between the existing models content and
the new Pipeline content. The URL stays `/settings/models`. No new SvelteKit
route is needed; no change to `SettingsTabs.svelte`.

## Agent Roster — 2 file-disjoint lanes

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `ui/src/routes/api/settings/pipeline-config/+server.ts` (new: GET + PUT); `ui/src/lib/digest/pipeline.ts` (read-only import for `DEFAULT_PIPELINE`, `Pipeline` type — no edits to this file) | All `.svelte` files, `ModelsScreen.svelte`, `SettingsTabs.svelte`, `qualify.ts`, `modelFor.ts`, `llm.ts` |
| frontend (pane 1.3) | **Lane B:** `ui/src/lib/models/ModelsScreen.svelte` (add in-page tab strip + Pipeline tab content: editor, merge-rail, skip dividers, cover sub-rows, run preview, Q3 read-only relabel); optionally extract sub-components: `ui/src/lib/models/PipelineEditor.svelte`, `ui/src/lib/models/RunPreview.svelte` (new, if warranted). Imports `resolvePipeline`, `DEFAULT_PIPELINE`, `Pipeline`, `Cover` from `pipeline.ts` READ-ONLY (no edits to that file). | `+server.ts` route files, `pipeline.ts`, `llm.ts`, `modelFor.ts`, `schema.ts`, `client.ts` |

### File-disjoint verification

Lane A files: `ui/src/routes/api/settings/pipeline-config/+server.ts` (new).

Lane B files: `ui/src/lib/models/ModelsScreen.svelte` (edit); optionally
new `PipelineEditor.svelte`, `RunPreview.svelte` under `ui/src/lib/models/`.

`pipeline.ts` is READ-ONLY for Lane B (import only). Lane A does not import
`pipeline.ts` in its route file — it uses `DEFAULT_PIPELINE` for the reset
path and `Pipeline` for the type. Lane B never reads DB directly.

No file appears in both lanes' write sets.

## Cross-Lane CONTRACTS (pinned — no renegotiation)

### 1. Pipeline-config API shape (Lane A = source of truth)

```
GET /api/settings/pipeline-config
→ 200  { pipeline: Pipeline }
  Returns the stored JSON value for key 'pipeline_config'.
  If the key is unset or the value fails to parse, falls back to DEFAULT_PIPELINE.
  Never returns null or 404 — the endpoint always produces a valid Pipeline.

PUT /api/settings/pipeline-config
Body: { pipeline: Pipeline }
→ 200  { pipeline: Pipeline }   (the saved value, re-parsed from DB)
→ 400  { error: string }        (body missing, pipeline field absent, or
                                  JSON fails basic structural validation)
```

Validation on PUT (minimal — structural, not semantic):
- `body.pipeline` must be a plain object
- `body.pipeline.releaseKind === 'digest'`
- `body.pipeline.order` is a non-empty `string[]`
- `body.pipeline.models` is a plain object
- `body.pipeline.skipAfter` is a plain object
- `body.pipeline.covers` is an array; each element has `{ of: string, model: string }`
- No deeper validation (section names, model ID existence); the editor controls
  what the operator can construct, so invalid values are a UI concern.

Reset path: frontend sends `PUT { pipeline: DEFAULT_PIPELINE }` (imports
`DEFAULT_PIPELINE` from `pipeline.ts` client-side). No dedicated DELETE/reset
endpoint; reset is a write of the known default.

Storage: `INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', JSON.stringify(pipeline))` — mirrors the `debug-mode` + `openrouter-key` pattern exactly. Key is `'pipeline_config'` (confirmed seeded in `client.ts` line 142).

### 2. Working-copy editing model (Lane B internal, pinned shape)

Editor state is a `Pipeline` working copy initialized from the GET response.
Controls map 1:1 to `Pipeline` fields:

| Control | Pipeline field mutation |
|---|---|
| Reorder section (▲▼) | Splice within `order` |
| Per-section model select | `models[sec] = id`; "Use default" = `delete models[sec]` |
| Toggle skip divider | `skipAfter[sec] = true`; remove = `delete skipAfter[sec]` |
| Add cover to a section | Push `{ of: sec, model: coverModel }` to `covers` |
| Remove cover | Filter `covers` by `of !== sec` |

Working copy is local `$state`. Resolver is called on every mutation to update
the run preview. Nothing writes to DB until the user clicks Save.

### 3. Merge-rail — display-only (pinned constraint)

Merge is computed, never set. The left merge-rail and `merge xN` badge are
derived from `resolvePipeline` output: sections that share a `group` within
an EP are consecutive same-model tracks not split by a skip. They render a
colored left spine joining the rows. There is NO toggle for merge.

Implication for Lane B: call `resolvePipeline(workingCopy, allSections, db)`
— but `resolvePipeline` requires a `db` parameter. On the frontend, Lane B
cannot call the real resolver with a live DB handle. Two options:

**Chosen approach (pinned):** Lane B drives the preview by calling
`GET /api/settings/pipeline-config` with a preview body, OR computes a
client-side resolver that mirrors the grouping logic without the DB — because
the editor always has the working-copy `models` map (overrides are known) and
can display "Use default · <bucket>" as the effective model for the merge
computation when no override is set. The bucket default comes from the already-
loaded `digestBucket.resolved` value in `ModelsScreen.svelte`. Lane B
implements a thin client-side EP solver (split at `skipAfter`; group by
resolved model; covers into trailing EP) using the working-copy Pipeline +
the already-loaded bucket/section data — this is pure functional logic (no DB)
and mirrors `resolvePipeline` exactly. Do NOT re-derive EP logic that contradicts
the resolver; mirror it structurally.

The resolved EP array is the input to both the merge-rail renderer and the
run preview (call count = sum of groups across EPs + cover count).

### 4. Q3 model precedence (unchanged)

The resolver's precedence chain is NOT changed: `pipeline.models[sec]` override
→ `modelForSection(section, db)` (DB pin → bucket default). The editor's
"Use default" option writes NO override (`delete models[sec]`), so a section
with no override still follows its DB pin / bucket default exactly as today.

The sprint-41 per-section overrides panel (the `mlm-sections-card` article in
`ModelsScreen.svelte` lines 748–868) is kept but rendered read-only:
- All `<select>` elements get `disabled` permanently (regardless of `sectionsMocked`).
- The card subtitle changes to: "Per-section models are now set in the Pipeline tab. These
  values show the currently effective model per section."
- A link or note pointing to the Pipeline tab is added below the subtitle.
- The `setSectionModel` function and the PUT call to `/api/model-vars/sections/:section`
  remain in the file but are never called (selects are disabled). No data deletion.

No data migration. Existing `pipeline_config` rows keep working. Existing
`digest_model_<section>` settings rows are untouched — the DB pin is still
consulted by the resolver's `modelForSection` fallback.

### 5. Run preview output shape (for Lane B rendering)

The client-side EP solver returns:

```ts
type ClientEP = {
  groups: { model: string; sections: string[] }[];
  covers: { of: string; model: string }[];
};
```

From this, the preview computes:
- `callCount` = `eps.reduce((n, ep) => n + ep.groups.length + ep.covers.length, 0)`
- `costBand`: coarse relative tier based on resolved models' `cost_override` /
  `tierFromPricing` from `qualify.ts` (already loaded in `ModelsScreen`). A
  `$` model in every group = `$`; any `$$$` model = `$$$`; else `$$`. Or if
  models are unresolvable (no roster loaded), omit cost and show call count only.

Mobile: sticky footer band `approx N calls · cost <band>` above the Save button.
Desktop (two-pane): vertical EP list — each EP as a labeled block listing its
groups and covers; skips shown as `── skip ──` dividers between EP blocks.
No chart; flex/grid only; Mash Co tokens; no charting lib.

## Working Agreements

- **Path-scoped commits:** each commit names its files explicitly
  (`git commit -m "..." -- <paths>`); never `git add .` or `git add -A`.
- **No amend on shared HEAD.** Always new commits; never `--amend`.
- **No emoji** in code, UI strings, or commit messages.
- **No charting library.** Flex/grid only for the run preview.
- **Mash Co tokens only.** Use `var(--fg)`, `var(--surface-2)`, `var(--line)`,
  `var(--mash-btn)`, etc. — do not hardcode colors.
- **Svelte 5 runes.** Use `$state`, `$derived`, `$effect`; no `$:` reactive
  statements; no writable stores.
- **Scoped tests** for Lane A: at minimum, test GET returns `DEFAULT_PIPELINE`
  on first call, PUT validates and persists, invalid body returns 400.
- **Orc gate** before merging each lane: screenshot at 412px (mobile) and 1280px
  (desktop) confirming the Pipeline tab renders and the editor is functional.
- Cover A/B review (`llm_preference`) is shipped and confirmed in sprint-44 —
  the build CONFIRMS it end-to-end, does NOT rebuild it.

## Active Sprint Plan

Tasks are ordered by dependency within each lane. Lanes A and B start in
parallel; B.2 can start as soon as A.1 is mergeable (or mock the GET 200 shape
and unblock immediately).

### Lane A — Backend

- [ ] {backend, A.1, no deps} **Add `GET /api/settings/pipeline-config`
  + `PUT /api/settings/pipeline-config`.** Create
  `ui/src/routes/api/settings/pipeline-config/+server.ts`. GET: read key
  `pipeline_config` from settings table; if missing or unparseable, return
  `DEFAULT_PIPELINE`. PUT: parse body, validate structural constraints (Contract 1),
  write `INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', ...)`,
  return the written value. Key `pipeline_config` is already seeded by `client.ts:142`.
  **Acceptance:** `GET` returns a valid `Pipeline` JSON; `PUT` with a valid pipeline
  persists and echoes it back; `PUT` with `{}` or missing `releaseKind` returns 400.
  Scoped test file: `ui/src/routes/api/settings/pipeline-config/server.test.ts`.
  Files: `ui/src/routes/api/settings/pipeline-config/+server.ts` (new),
  `ui/src/routes/api/settings/pipeline-config/server.test.ts` (new).

### Lane B — Frontend

- [ ] {frontend, B.1, no deps} **Add in-page tab strip to `ModelsScreen.svelte`.**
  Add a `$state activeTab: 'models' | 'pipeline'` variable. Add a two-option
  segmented tab control at the top of the screen body (below the header, above the
  first article card): `Models` and `Pipeline`. Wrap existing article cards in an
  `{#if activeTab === 'models'}` block. Add an `{#if activeTab === 'pipeline'}` block
  (empty skeleton initially — just a `<div>` with a heading). Verify no layout
  regression on the Models tab. **Acceptance:** tab strip renders; clicking Pipeline
  shows an empty panel; clicking Models shows existing content unchanged. Mash Co
  tokens; no new CSS variables.
  Files: `ui/src/lib/models/ModelsScreen.svelte` (edit).

- [ ] {frontend, B.2, depends: B.1} **Load/save `pipeline_config` + initialize
  working copy.** Add `loadPipeline()` (fetches `GET /api/settings/pipeline-config`,
  sets `workingCopy = $state<Pipeline>`) and `savePipeline()` (PUT to endpoint; shows
  a "Saved" transient). `resetPipeline()` sends `DEFAULT_PIPELINE`. Call `loadPipeline`
  in `onMount`. Display a Save + Reset button row in the Pipeline panel footer.
  **Acceptance:** on mount, the working copy loads the stored pipeline; Save persists a
  mutation; Reset restores `DEFAULT_PIPELINE` (confirm via a second GET).
  Files: `ui/src/lib/models/ModelsScreen.svelte` (edit).

- [ ] {frontend, B.3, depends: B.2} **Build the Option A flat-track-list editor.**
  Render `workingCopy.order` as a vertical list of section rows. Each row:
  - Section name label (use `SECTION_LABELS` map already in `ModelsScreen.svelte`).
  - Reorder controls ▲▼ (splice `order`; disable ▲ on first row, ▼ on last).
  - Per-section model `<select>`: first option `Use default · <digestBucket.resolved>`,
    then `qualifying({ json: true })` models (reuses the `qualifying()` function already
    in scope). Selected = `workingCopy.models[sec] ?? '__default__'`. On change:
    `models[sec] = id` or `delete models[sec]` for `__default__`.
  - Skip toggle: if `workingCopy.skipAfter[sec]`, render an `── skip ──` divider row
    AFTER the section row. A small `+ skip` / `- skip` affordance toggles
    `skipAfter[sec]`.
  - Merge-rail: after computing client-side EP solver output (see Contract 3), draw a
    colored left spine for sections sharing a group. Add `merge x2` (or x3, etc.) badge
    on the first section of each merged group. Display-only; no control.
  **Acceptance:** reorder moves sections in `workingCopy.order`; model select updates
  `workingCopy.models`; skip toggle adds/removes from `workingCopy.skipAfter`;
  merge-rail appears when two adjacent sections share the same resolved model with no
  skip between them.
  Files: `ui/src/lib/models/ModelsScreen.svelte` (edit); optionally extract
  `ui/src/lib/models/PipelineEditor.svelte` (new) if it grows beyond ~200 lines.

- [ ] {frontend, B.4, depends: B.3} **Cover sub-rows (add/remove/model).** For each
  section, if `workingCopy.covers` contains a `{ of: sec }` entry, render a dashed
  cover sub-row indented below the section row. Cover sub-row shows: `cover of <section>`
  label, a model `<select>` (same `qualifying({ json: true })` list — covers MUST specify
  a model), and a `x` remove button (filter `covers`). At the bottom of each section
  row (or as a sub-row hint when no cover exists), show a `+ cover` affordance that
  pushes `{ of: sec, model: qualifying({ json: true })[0]?.model_id ?? '' }` to
  `covers`. Hint text: "produces two takes you'll pick between." **Acceptance:** adding
  a cover appends a cover sub-row; selecting a cover model updates `covers[i].model`;
  removing a cover filters it out; cover appears in the resolver output (cover count
  increments).
  Files: `ui/src/lib/models/ModelsScreen.svelte` (edit or `PipelineEditor.svelte`).

- [ ] {frontend, B.5, depends: B.3} **Run preview (call count + cost band).** Implement
  the client-side EP solver (Contract 3) as a `$derived` from `workingCopy` +
  `digestBucket.resolved`. Derive `callCount` and `costBand` per Contract 5. On mobile
  (< 640px or use `window.innerWidth`): render a sticky footer band above Save:
  `approx {callCount} calls · {costBand}`. On desktop (>= 640px): render a vertical EP
  timeline in a right-side column (Option C two-pane layout with `display: grid;
  grid-template-columns: 1fr 280px;`). The timeline lists EPs with their groups and
  covers; `── skip ──` dividers between EPs. No chart; Mash Co surface tokens for
  borders/backgrounds. **Acceptance:** editing a model or adding a skip instantly
  updates call count and cost band; mobile shows footer band; desktop shows the two-pane
  layout with EP timeline; no charting library import.
  Files: `ui/src/lib/models/ModelsScreen.svelte` (edit); optionally extract
  `ui/src/lib/models/RunPreview.svelte` (new).

- [ ] {frontend, B.6, depends: B.4, B.5} **Option B read-only EP-cards state.** When
  the Pipeline tab is loaded but the user has not yet made any edits (working copy
  equals the fetched value), OR when `activeTab === 'pipeline'` and a toggle switches
  between "Edit" and "Preview" mode, render the EP cards view (Option B): each EP as a
  labeled card listing its section groups and cover rows, rendered via the client-side
  EP solver. The flat editor (Option A) is the Edit mode. A small `Edit` / `Preview`
  toggle switches between them. **Acceptance:** Preview mode shows EP-card groupings
  that match the resolved run; Edit mode shows the flat track list; switching between
  them preserves working-copy state.
  Files: `ui/src/lib/models/ModelsScreen.svelte` (edit or extracted components).

- [ ] {frontend, B.7, depends: B.6} **Q3: relabel sprint-41 per-section overrides
  panel to read-only mirror.** In `ModelsScreen.svelte` at the `mlm-sections-card`
  article (lines 748–868): (a) update `ml-card-sub` text to "Per-section models are
  now set in the Pipeline tab. These values show the currently effective model per
  section." (b) Add a link/button: "Go to Pipeline tab" that sets `activeTab =
  'pipeline'`. (c) Add `disabled` to ALL `<select>` elements unconditionally (remove
  the `disabled={sectionsMocked}` condition; always disabled). (d) Remove or visually
  de-emphasize the overridden count badge since the panel is no longer actionable.
  `setSectionModel` function stays in file but is unreachable (no selects fire). Do NOT
  remove the selects or the resolved-model display — they remain informative.
  **Acceptance:** selects in per-section panel are permanently disabled; subtitle
  shows read-only language + link to Pipeline tab; clicking the link switches to the
  Pipeline tab. The data still loads and displays the effective model per section.
  Files: `ui/src/lib/models/ModelsScreen.svelte` (edit).

- [ ] {frontend, B.8, depends: B.7} **Responsive polish + 412/1280 screenshots.**
  Verify at 412px: single-column track list, footer band visible above Save, no
  overflow. Verify at 1280px: two-pane Option C layout, EP timeline in right pane.
  Check `mlm-section-row` grid (existing `@media (max-width:480px)` block at line 973)
  does not conflict with new Pipeline tab layout. Fix any token or layout issues.
  **Acceptance:** screenshots at 412px and 1280px show the Pipeline tab functional and
  the per-section mirror read-only; orc reviews both before merge gate.
  Files: `ui/src/lib/models/ModelsScreen.svelte` + any extracted sub-components.

## v1 Scope Guardrails

The following are explicitly OUT of scope for this sprint:

- **No per-league pipeline profiles.** One global `pipeline_config` row. A v2 "picker +
  save as" affordance above the editor is mentioned in ROADMAP.md; do not build it. If
  the layout makes the extension point obvious (a blank space above the editor), that is
  acceptable, but no code.
- **No recoup budgeting.** See cost campaign roadmap.
- **Merge is not editable.** The merge-rail and badge are display-only. A toggle that
  purports to set merge would contradict the resolver; do not add one.
- **Do not re-implement the resolver.** The client-side EP solver is a structural mirror
  of `resolvePipeline` for UI purposes; it follows the same grouping logic. It is not
  a fork — if the resolver logic changes in a future sprint, the UI mirror must be
  updated to match.
- **No data migration.** Existing `pipeline_config` rows work as-is. Existing
  `digest_model_<section>` DB pins continue to be honored by the resolver's
  `modelForSection` fallback.

## Decision Log

| Decision | Rationale | Settled |
|---|---|---|
| Pipeline tab is an in-page tab strip inside `ModelsScreen.svelte`, not a new `SettingsTabs` route | Q4 says "on the Models & AI screen — not a separate page." `SettingsTabs` tabs are page-level SvelteKit routes (`/settings`, `/settings/models`, etc.). An in-page tab (state-driven `activeTab`) is the correct implementation. Confirmed by reading `SettingsTabs.svelte:14-19` and `settings/models/+page.svelte:1-21`. | 2026-06-18 |
| Client-side EP solver (not a server roundtrip) for the run preview | `resolvePipeline` requires a `db: Database.Database` parameter — not available in the browser. The solver is pure functional logic (split at `skipAfter`; group by model; covers into trailing EP) and can be mirrored client-side using the working-copy `models` map + already-loaded `digestBucket.resolved`. A server roundtrip per keystroke would be too slow and unnecessary. | 2026-06-18 |
| `pipeline_config` key is already seeded in `client.ts` | `client.ts` line 142: `upsert.run('pipeline_config', JSON.stringify(DEFAULT_PIPELINE))`. The GET endpoint does not need a seed fallback path beyond handling parse failure — but should still gracefully return `DEFAULT_PIPELINE` if the value is somehow malformed. | 2026-06-18 |
| `Track` type is not part of `Pipeline` — `order` is `SectionKind[]` | `IMPLEMENTATION.md` §1 says "`Pipeline` / `Cover` types" and the spec references `Track`, but the actual `pipeline.ts` (confirmed at line 37) defines `Pipeline.order: SectionKind[]`, not `Track[]`. `Track` is a separate exported type (`pipeline.ts:23-27`) that is not used inside `Pipeline`. Lane B works directly with `SectionKind[]` (i.e. `string[]` in practice) for `order`. Cover sub-rows use the exported `Cover` type (`of: SectionKind; model: string`). | 2026-06-18 |
| `qualify.ts` does not export `listModels(db)` | `IMPLEMENTATION.md` §1 mentions "`listModels(db)` filtered by `qualifies(m,{json:true})`" but `qualify.ts` exports only `qualifies()`, `tierFromPricing()`, `effCost()`, and types. The model list is loaded via `GET /api/models` and stored in `models` state in `ModelsScreen.svelte`. The `qualifying({ json: true })` helper already in `ModelsScreen.svelte:137-139` is the correct reuse point for the per-section and cover model selects. No `listModels` import needed. | 2026-06-18 |
| **(orc)** Client EP solver MUST have a parity test vs the real `resolvePipeline` | The client mirror is acceptable only if it can't drift. Lane B acceptance includes a vitest asserting the client solver's EP/group/cover output equals `resolvePipeline(...)` for `DEFAULT_PIPELINE` + ≥3 edited configs (extra skip, a per-section override, a cover). This is the guard that lets us mirror instead of round-trip. | 2026-06-18 |
| **(orc, resolves OQ1)** Tab strip + editor use ModelsScreen's existing CSS-var + scoped `<style>` convention, NOT Tailwind | Consistency with the surrounding Models & AI screen, which already uses inline CSS vars + scoped styles. | 2026-06-18 |
| **(orc, resolves OQ2)** Cost band from real roster pricing; call count always shown | Compute the relative band from resolved models' `price_in`/`price_out` × a rough token estimate; always show the call count; if a model lacks pricing, show call count + an "approx" band. Coarse is fine — it only answers "did this change the order of magnitude." | 2026-06-18 |

## Ratification / Blockers

_No open ratification items. No blockers at sprint start._

## Activity Log

- **2026-06-18** — Coord-doc authored by planner agent. Read design packet
  (`README.md`, `DESIGN-RATIONALE.md`, `IMPLEMENTATION.md`), verified resolver
  export signature and `Pipeline` type shape against `pipeline.ts`, confirmed
  `pipeline_config` seeding in `client.ts:142`, confirmed SettingsTabs tab list
  and models page structure to pin the in-page tab placement decision, confirmed
  `qualifying()` helper reuse path. Noted four reality deltas from `IMPLEMENTATION.md`
  assumptions (see Decision Log). Sprint ready for parallel lane start.
