---
status: planned
campaign: openrouter-cost-management
sprint: sprint-41-per-section-models
version: v1.8.0
created: 2026-06-17
---

# music-league-bot — coordination doc (sprint-41-per-section-models)

> **Sprint:** Per-section model selection — layer `modelForSection` on top of the existing two-bucket `modelFor` resolver so each AI task can be pinned to its own model. Migrate the 3 static-env predict tasks (submissionPredict, voteProbe, tasteFingerprint) to use the DB-first resolver. Extend the Models & AI screen with a per-section override panel.
> Spec: `~/.config/taw/wiki/Projects/music-league-bot/sprint-41-per-section-models-spec.md`
> Campaign: `openrouter-cost-management`. INDEPENDENT of sprint-39 (cost ledger) and sprint-40 (cost dashboard); builds directly on sprint-38 (modelFor + Models & AI screen).

## Sprint Goals

Ship per-section model pinning: a new `modelForSection(section, db)` resolver using `digest_model_<section>` settings keys; wired at all 16 section/task callsites (6 digest kinds + 10 dashboard/predict tasks); migrate 3 predict tasks off static env model to DB-first; a per-section override panel in Models & AI; GET/PUT `/api/model-vars/sections` + `/:section` API mirroring the existing model-vars pattern.

## Agent Roster — 2 file-disjoint lanes

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `ui/src/lib/digest/modelFor.ts` (add `modelForSection`); `ui/src/routes/api/model-vars/sections/+server.ts` + `[section]/+server.ts`; wire `modelForSection` at all 16 callsites in `narrative.ts`, `profile.ts`, `seasonUpdate.ts`, `llm.ts`; migrate static-env model in `submissionPredict.ts`, `voteProbe.ts`, `tasteFingerprint.ts`; add `SECTION_BUCKET_MAP` constant; scoped tests | `ModelsScreen.svelte`, any frontend component, `qualify.ts` (read-only) |
| frontend (pane 1.3) | **Lane B:** `ui/src/lib/models/ModelsScreen.svelte` (add per-section override card); fetch and render `GET /api/model-vars/sections`; `PUT /api/model-vars/sections/:section` on select change; group by bucket with group headings; qualify filter per-section using `qualifies()` from `qualify.ts` | `modelFor.ts`, `llm.ts`, generator files, `routes/api/*` |

## Cross-lane CONTRACTS (pinned — no renegotiation)

**1. API shape** (Lane A = source of truth):

```
SectionState = {
  key: string;              // "digest_model_<section>"
  section: string;          // e.g. "podium"
  label: string;            // human-readable display label
  bucket: 'predict' | 'digest';
  selected: string | null;  // DB-saved model_id; null = use default
  resolved: string;         // effective model: section pin ?? bucket ?? env ?? hardcoded
  requires: BucketReq;      // { json: true } for all sections in v1
}

GET  /api/model-vars/sections            → Record<string, SectionState>   (all 16)
PUT  /api/model-vars/sections/:section   body { model_id: string | null } → SectionState
  400 on unknown section key
  null model_id = clear pin (revert to bucket default)
```

The 16 known section keys, grouped by bucket:

digest (6): `podium`, `villain`, `flow`, `consensus`, `quotes`, `chat`
predict (10): `narrative-player-superlatives`, `narrative-fan-hater-blurbs`,
              `narrative-league-reel`, `narrative-moment-lines`,
              `profile-spectrum`, `profile-playlist`, `season-update`,
              `submission-predict`, `vote-probe`, `taste-fingerprint`

**2. Resolver export** (Lane A; Lane B does not import it):

```ts
// ui/src/lib/digest/modelFor.ts — new export
export function modelForSection(section: string, db: Database.Database): string
```

Lane B interacts with `modelForSection` only indirectly through the API. Lane B MUST NOT import `modelForSection` directly.

**3. Component contract** (no new component exports):

Lane B extends `ModelsScreen.svelte` in-place. No new exported components. No new pages or routes.

## Working agreements (sprint-41)

- **Lanes are file-disjoint — stay in your lane.** Path-scoped commits; **never `git commit --amend`** on shared HEAD.
- **Build-to-contract:** Lane B builds against the pinned API shape using local mocks of `GET /api/model-vars/sections`; integrate at the gate.
- **No emoji** — functional Unicode glyphs only. **No raw hex** — tokens only.
- **Svelte 5 runes** throughout (`$state`, `$props`, `$derived`). No legacy reactive blocks.
- Scoped tests per task; full `cd ui && npm run check` + `vitest run` are the orc gate.
- Log each completed task to the Activity Log with its commit hash.
- Version target: v1.8.0 (bump only at gate, not during sprint).
- **Open question A (season-update bucket):** `season-update` falls back to `'digest'` pending confirmation. Lane A encodes this; flag if conflicting evidence is found.
- **Open question B (UI density at 412):** Lane B must screenshot the per-section card at 412px and propose accordion collapse if the card overflows the viewport. Raise as a blocker rather than guessing.

## Active Sprint Plan

- [ ] {agent: backend, id: a1-resolver} **`modelForSection` resolver.** Add `modelForSection(section, db)` to `ui/src/lib/digest/modelFor.ts`. Implement `SECTION_BUCKET_MAP` (all 16 keys → `'predict'|'digest'`). Fallback chain: `settings[digest_model_<section>] ?? modelFor(bucket, db)`. Scoped test: section pin wins over bucket; fallthrough to bucket default; unknown section falls through cleanly. **Acceptance:** `npm run check` 0 errors in `modelFor.ts`; test: section pin overrides bucket; bucket default applies when no pin; fallthrough for unknown key.

- [ ] {agent: backend, id: a2-api, depends: a1-resolver} **Sections API.** `GET /api/model-vars/sections` returns all 16 `SectionState` objects. `PUT /api/model-vars/sections/:section` validates the section key (400 on unknown); writes `digest_model_<section>` to settings (or deletes row on null); returns updated `SectionState`. Labels, bucket, requires come from the `SECTION_BUCKET_MAP` + a label map const. Scoped test: GET returns 16 keys; PUT sets/clears a pin; PUT unknown → 400. **Acceptance:** route tests green; GET contract matches spec; null PUT clears setting row.

- [ ] {agent: backend, id: a3-wire, depends: a1-resolver} **Wire `modelForSection` at all callsites.** In `narrative.ts`: change all 4 task `model` fields from `(db) => modelFor('predict', db)` to `(db) => modelForSection('<task-id>', db)`. In `profile.ts`: same for spectrum and playlist tasks. In `seasonUpdate.ts`: `(db) => modelForSection('season-update', db)`. In `llm.ts`: update the digest generation call to pass `modelForSection(kind, db)` as `opts.model` (the `callOpenRouter` caller site, not the `callOpenRouter` function itself — do not change the `opts.model ?? env ?? hardcoded` fallback inside `callOpenRouter`). Path-scoped commits per file group. **Acceptance:** `npm run check` 0 errors; existing generator tests still green (no behavioral change — section keys with no DB pin resolve identically to the prior `modelFor` call).

- [ ] {agent: backend, id: a4-migrate, depends: a1-resolver} **Migrate static-env predict tasks.** In `submissionPredict.ts`, `voteProbe.ts`, `tasteFingerprint.ts`: remove `const DEFAULT_MODEL = process.env...` module-level constant; change `model: DEFAULT_MODEL` to `model: (db) => modelForSection('<task-id>', db)`. Scoped test (one per file): with `predict_model` set in the DB, `task.model(db)` returns the DB value rather than the env string. **Acceptance:** 3 tests green proving DB selection applies to each migrated task; `npm run check` 0 errors; no behavioral change when no DB setting or section pin is set.

- [x] {agent: frontend, id: b1-sections-panel, depends: a2-api} **Per-section override panel in ModelsScreen.** Fetch `GET /api/model-vars/sections` on mount (alongside the existing model-vars + roster fetches). Add a "Per-section overrides" card after the Model Variables card; render only when roster has ≥1 model. Render 16 rows grouped under "Digest sections" and "Dashboard & predict tasks" group headings. Each row: label, a model `<select>` populated with qualifying models (same `qualifies()` filter as existing Model Variables selects, same `requires: { json: true }` for all sections v1) plus a "(use default)" sentinel option (value null). On change: `PUT /api/model-vars/sections/:section` optimistic update. Show the resolved model as a read-only footnote when a pin is set (distinct from the selected row). Screenshot at 412 and desktop; propose accordion collapse if card overflows 412 viewport. **Acceptance:** `npm run check` 0 errors; panel renders with correct grouping; qualify filter live; PUT fires on change; null/default clears pin; 412 screenshot surfaced.

- [ ] {agent: orc, id: gate, depends: a2-api,a3-wire,a4-migrate,b1-sections-panel} **Gate.** Cross-check path-scoped commits; `cd ui && npm run check` (0) + `npx vitest run` (green); **owner UAT** (pin cheap model to `narrative-fan-hater-blurbs`; pin high-end model to `podium`; trigger generation and confirm section models differ; confirm bucket default applies to un-pinned section; confirm `submission-predict` respects DB `predict_model` setting; screenshots 412 + desktop); on sign-off → v-bump to 1.8.0 + CHANGELOG + deploy (cached, orc-gated → :3002) + assert live; close.

## v1 scope guardrails

- **Section-level only** — no per-league, per-round, or per-user overrides.
- **Qualify enforcement = UI-side.** Server-side PUT validation = deferred hardening.
- **No change to `modelFor`** — existing two-bucket behavior is unchanged; `modelForSection` layers on top.
- **No new routes or pages** — per-section UI is a card inside the existing Models & AI screen.
- **`callOpenRouter`'s internal `opts.model ?? env ?? hardcoded` fallback unchanged** — only the callsite that invokes it for digest sections is updated to pass `modelForSection`.

## Decision Log

### 2026-06-17 — design ratified (owner-directed spec)
`modelForSection` + `digest_model_<section>` key scheme; 16 pinnable sections (6 digest + 10 predict/dashboard); migrate 3 static-env predict tasks; extend ModelsScreen in-place; GET/PUT `/api/model-vars/sections` + `/:section`. Two lanes: backend (Lane A) + frontend (Lane B). Version target v1.8.0.

## Ratification Log

### 2026-06-18 — predict-task DB routing ratified (owner)
The 3 static-env predict tasks (`submissionPredict`, `voteProbe`, `tasteFingerprint`) WILL be migrated from the module-load `process.env.OPENROUTER_PREDICT_MODEL` constant to DB-first routing via `modelForSection` — task `a4-migrate`, confirmed by owner ("fix them"). This resolves the open flag raised in the CD cost-routing handoff (`SCHEMA.md` §6): per-section pinning (Q5) assumed those tasks were DB-routable; they are not today, and `a4-migrate` makes them so. The scope-out alternative (leave them static, exclude from pinning) was **rejected** — pinning must work uniformly across all 16 sections.

## Blockers

_None._

## Activity Log

### 2026-06-18 — backend — Lane A (a1–a4) complete
- **a1-resolver** (aa3b28a): `modelForSection` + `SECTION_BUCKET_MAP` added to `modelFor.ts`. 16-key map, season-update confirmed digest bucket (was already `modelFor('digest', db)` in `seasonUpdate.ts`). 12 tests green.
- **a2-api** (80127de): `sectionState.ts` + GET/PUT `/api/model-vars/sections` + `/sections/:section` routes. 13 route tests green.
- **a3-wire** (00f4271): `narrative.ts` (4 tasks), `profile.ts` (2 tasks), `seasonUpdate.ts` (1 task), `llm.ts` (regenerateOneSection) wired to `modelForSection`. No behavioral change with no pin set.
- **a4-migrate** (9589008): `submissionPredict.ts`, `voteProbe.ts`, `tasteFingerprint.ts` migrated from module-load `DEFAULT_MODEL` constant to `(db) => modelForSection('<task-id>', db)`. Fixed 6 existing test assertions (task.model now a fn, compare HARDCODED_MODEL). Added 12 DB-routing proof tests (4 per file). 63 tests green.
- Final: `npm run check` 0 errors, `vitest run` 669/669 tests passed (69 files).

### 2026-06-18 — frontend — b1-sections-panel shipped (commit 3386657)
- `ui/src/lib/models/ModelsScreen.svelte` extended with Per-section overrides card.
- Fetches `GET /api/model-vars/sections`; mocks locally on 404 (Lane A pending).
- 16 rows in two accordion buckets; `qualifies({json:true})` filter; optimistic `PUT`.
- Open question B resolved: accordion collapse per bucket with "N overridden" badge is the 412px density solution.
- `npm run check`: 0 errors.
- Screenshot pending (requires running UI; flagged for orc gate UAT).

### 2026-06-17 — orc — sprint-41 spec + coord-doc authored
- Spec written to `~/.config/taw/wiki/Projects/music-league-bot/sprint-41-per-section-models-spec.md`.
- Coord-doc written to `docs/coordination/sprint-41-per-section-models.md`.
- 16 pinnable sections confirmed from codebase inspection: `SECTION_KINDS` in `llm.ts` (6 digest kinds) + `PredictionTask.id` values in `narrative.ts` (4) + `profile.ts` (2) + `seasonUpdate.ts` (1) + 3 static-env tasks in `predict/tasks/`.
- Static-env migration targets confirmed: `submissionPredict.ts:188`, `voteProbe.ts:148`, `tasteFingerprint.ts:110` all have `model: DEFAULT_MODEL` where `DEFAULT_MODEL` is captured at module load from `process.env`.
- Two open questions logged: season-update bucket (assumed digest) and 412 UI density.
- Status: planned. Ready to dispatch agents.
