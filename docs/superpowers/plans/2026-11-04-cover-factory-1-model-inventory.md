# Cover Factory — Piece 1: Model Inventory Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing model roster so models can be added by OpenRouter id *or* URL, carry auto-derived multi-valued kinds, have a working manual `$` override, and be pinned to the three Cover Factory jobs (reader / generator / pitch).

**Architecture:** Pure helpers in `ui/src/lib/models/` (id parsing, kind derivation, per-job filtering), one new nullable JSON column `ai_models.kinds`, the existing lookup/create/patch routes updated to use them, and a new settings route + card in `ModelsScreen.svelte` mirroring the existing "Image generation" card (`api/settings/avatar-image`).

**Tech Stack:** SvelteKit 2, Svelte 5 runes, better-sqlite3, vitest (`cd ui && npx vitest run <path>`).

**Spec:** `docs/superpowers/specs/2026-11-04-cover-factory-design.md` (section "1. Model inventory upgrade" and "Default models").

## Global Constraints

- Work in `ui/`. Tests: `npx vitest run <file>`; full suite `npm test`.
- Run GitNexus impact analysis (`node .gitnexus/run.cjs impact "<symbol>" --direction upstream --repo .` from repo root) before editing any existing function; warn on HIGH/CRITICAL; `UNKNOWN` means confirm with grep.
- Schema changes are idempotent `ALTER TABLE … ADD COLUMN` guarded by `PRAGMA table_info`, placed next to the existing `cap_image_gen` migration in `ui/src/lib/db/client.ts` (~line 621). Also add the column to the `CREATE TABLE ai_models` in `ui/src/lib/db/schema.ts`.
- Cost tier stays the app's existing `tierFromPricing` (`ui/src/lib/models/qualify.ts`) — it already drives `$/$$/$$$` display; do NOT port companelist's formula (my call: one formula app-wide).
- Kind vocabulary (exact strings): `text`, `multimodal`, `vision`, `image`, `video`, `audio`, `embedding`, `classification`.
- Settings keys (exact): `cover_factory_reader_model`, `cover_factory_generator_model`, `cover_factory_pitch_model`.
- Commit after each task; never push.

## Review Focus

1. Pasted URL variants — `https://openrouter.ai/google/gemini-2.5-flash`, `https://openrouter.ai/models/google/gemini-2.5-flash?tab=api`, trailing slash, surrounding whitespace — all resolve to `google/gemini-2.5-flash`. (Task 1 test.)
2. Legacy rows with `kinds = NULL` and only `model_type = 'image'` (e.g. live `google/gemini-3.1-flash-image-preview`) must still appear in the generator picker. (Task 3 test.)
3. A pinned job model that was later deleted from the roster: GET returns the stored id with `missing: true`; the card shows it as missing instead of silently showing "Auto". (Task 4 test.)
4. Manual `$` override round-trips: saving `cost_override: '$$$'` via POST and PATCH persists `'$$$'` (today both routes require a number and silently null it). (Task 2 test.)
5. Model not in OpenRouter's list (estimated draft) gets `kinds: []`, not a crash, and can still be saved and tagged manually. (Task 2 test.)

---

### Task 1: Id parsing and kind derivation helpers

**Files:**
- Create: `ui/src/lib/models/kinds.ts`
- Test: `ui/src/lib/models/kinds.test.ts`

**Interfaces:**
- Produces:
  - `export const MODEL_KINDS = ['text','multimodal','vision','image','video','audio','embedding','classification'] as const;`
  - `export type ModelKind = (typeof MODEL_KINDS)[number];`
  - `export function parseModelId(raw: string): string | null` — accepts `author/slug` or an openrouter.ai URL (with or without `/models/`, query string, trailing slash); returns null when the result doesn't match `/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+~-]*$/i`. Also accept the leading `~` variant seen in the live roster (`~google/gemini-pro-latest`) — keep the `~` in the returned id.
  - `export function kindsFromArchitecture(arch: { modality?: string; input_modalities?: string[]; output_modalities?: string[] } | undefined): ModelKind[]`
  - `export function parseKinds(raw: string | null | undefined): ModelKind[]` — JSON array text → filtered to known kinds; null/invalid → `[]`.

- [ ] **Step 1: Write failing tests** in `kinds.test.ts`:
  - `parseModelId('google/gemini-2.5-flash')` → `'google/gemini-2.5-flash'`
  - `parseModelId('  https://openrouter.ai/google/gemini-2.5-flash  ')` → same
  - `parseModelId('https://openrouter.ai/models/google/gemini-2.5-flash?tab=api')` → same
  - `parseModelId('https://openrouter.ai/google/gemini-2.5-flash/')` → same
  - `parseModelId('~google/gemini-pro-latest')` → `'~google/gemini-pro-latest'`
  - `parseModelId('not a model')` → `null`; `parseModelId('')` → `null`
  - `kindsFromArchitecture({ input_modalities: ['text','image'], output_modalities: ['text','image'] })` → contains `image`, `multimodal`, `vision`
  - `kindsFromArchitecture({ input_modalities: ['text','image'], output_modalities: ['text'] })` → `['vision','multimodal','text']` in any order (assert with `toEqual(expect.arrayContaining(...))` and length 3)
  - `kindsFromArchitecture({ input_modalities: ['text'], output_modalities: ['embeddings'] })` → `['embedding']`
  - `kindsFromArchitecture({ modality: 'text+image->image' })` (no arrays) → contains `image`
  - `kindsFromArchitecture(undefined)` → `[]`
  - `parseKinds('["image","bogus"]')` → `['image']`; `parseKinds(null)` → `[]`; `parseKinds('nope')` → `[]`

- [ ] **Step 2: Run** `npx vitest run src/lib/models/kinds.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `kinds.ts`. Derivation rules (fall back to parsing `modality` string `"<in>-><out>"` split on `+` when the arrays are absent):
  - output has `image` → `image`; `video` → `video`; `audio` → `audio`; `embeddings` → `embedding`; `text` → `text`
  - input has `image` and output has `text` → `vision`
  - input has ≥2 distinct modalities → `multimodal`
  - `classification` is never derived (manual only). Dedupe.

- [ ] **Step 4: Run** the same command — Expected: PASS.

- [ ] **Step 5: Commit** `git add ui/src/lib/models/kinds.ts ui/src/lib/models/kinds.test.ts && git commit -m "models: id/url parsing + kind derivation helpers"`

---

### Task 2: `kinds` column, lookup by URL, and working `$` override

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (ai_models CREATE, add `kinds TEXT`)
- Modify: `ui/src/lib/db/client.ts` (~621, idempotent ALTER for `kinds`)
- Modify: `ui/src/lib/db/aiModels.ts` (`AiModelRow.kinds: string | null`, `cost_override: string | null`; insert/patch handle `kinds`)
- Modify: `ui/src/routes/api/models/lookup/+server.ts`
- Modify: `ui/src/routes/api/models/+server.ts` (POST), `ui/src/routes/api/models/[id]/+server.ts` (PATCH)
- Modify: `ui/src/lib/models/qualify.ts` (`Model.kinds: string | null`)
- Test: `ui/src/lib/db/aiModels.test.ts` (extend), create `ui/src/routes/api/models/lookup/server.test.ts`, create `ui/src/routes/api/models/server.test.ts`

**Interfaces:**
- Consumes: `parseModelId`, `kindsFromArchitecture`, `parseKinds` (Task 1).
- Produces: `ai_models.kinds` stored as JSON array text (e.g. `'["image","multimodal"]'`) or NULL; lookup GET `?id=<id-or-url>` returns `{ found, estimated, draft }` where `draft.model_id` is the parsed id and `draft.kinds` is a JSON string; 400 when `parseModelId` returns null. `cost_override` accepted as `'$' | '$$' | '$$$' | null` in POST and PATCH (anything else → null).

- [ ] **Step 1: Write failing tests:**
  - `aiModels.test.ts`: `insertModel(db, {...base, kinds: '["image"]'})` then `getModelById` → `kinds === '["image"]'`; `patchModel(db, id, { kinds: '["vision","text"]' })` persists.
  - `lookup/server.test.ts` (mock `fetch` with `vi.stubGlobal` returning `{ data: [{ id: 'google/gemini-2.5-flash-image', name: 'x', pricing: { prompt: '0.0000003', completion: '0.0000025' }, architecture: { modality: 'text+image->text+image', input_modalities: ['text','image'], output_modalities: ['text','image'] } }] }`):
    - `GET ?id=https://openrouter.ai/google/gemini-2.5-flash-image` → `found: true`, `draft.model_id === 'google/gemini-2.5-flash-image'`, `parseKinds(draft.kinds)` contains `image`, `draft.cap_vision === 1`
    - `GET ?id=acme/unknown` → `found: false`, `draft.kinds === '[]'`
    - `GET ?id=garbage text` → throws 400
    - Note the module-level 1-hour cache: reset modules between tests (`vi.resetModules()` + re-import) so the stub is used.
  - `models/server.test.ts`: POST `{ model_id: 'a/b', cost_override: '$$$', kinds: '["image"]' }` → row `cost_override === '$$$'`, `kinds === '["image"]'`; POST `cost_override: 'cheap'` → `null`. Extend `[id]/server.test.ts`: PATCH `{ cost_override: '$' }` → `'$'`.

- [ ] **Step 2: Run** `npx vitest run src/lib/db/aiModels.test.ts src/routes/api/models` — Expected: FAIL.

- [ ] **Step 3: Implement.** Column + migration; `insertModel`/`patchModel` carry `kinds`; lookup parses id via `parseModelId` (400 on null), extends `OpenRouterModel.architecture` with `input_modalities?/output_modalities?`, sets `kinds: JSON.stringify(kindsFromArchitecture(m.architecture))`, and sets `cap_vision` from derived `vision`/`multimodal`; POST/PATCH validate `cost_override` against `['$','$$','$$$']` and accept `kinds` as a string (re-serialized through `parseKinds` so only known kinds persist).

- [ ] **Step 4: Run** the same command, then `npm test` — Expected: PASS, no regressions.

- [ ] **Step 5: Commit** `git commit -am "models: kinds column, URL lookup, fix \$ override persistence"` (add the new test files first).

---

### Task 3: Per-job model filtering + kind chips in the roster

**Files:**
- Create: `ui/src/lib/models/jobs.ts`
- Test: `ui/src/lib/models/jobs.test.ts`
- Modify: `ui/src/lib/models/ModelsScreen.svelte` (draft editor: kind toggle chips; roster cards: kind chips; Type dropdown unchanged)

**Interfaces:**
- Consumes: `parseKinds`, `MODEL_KINDS` (Task 1); `Model` with `kinds` (Task 2); `effCost`, `tierFromPricing` (existing `qualify.ts`).
- Produces:
  - `export type CoverJob = 'reader' | 'generator' | 'pitch';`
  - `export function modelFitsJob(m: Model, job: CoverJob): boolean`
  - `export function modelsForJob(models: Model[], job: CoverJob): Model[]` — filtered, favorites first, then by `nickname || model_id`.
  - `export function jobOptionLabel(m: Model): string` — `"★ "` if favorite + `nickname || model_id` + `" "` + tier string (`'$'`…`'$$$'`, or `'free'` when `is_free`).

Rules (`kinds` via `parseKinds`, plus legacy fallbacks):
- `generator`: kinds has `image`, OR `model_type === 'image'`, OR `/->.*image/.test(model_type)`.
- `reader`: kinds has `vision` or `multimodal`, OR `cap_vision === 1`.
- `pitch`: kinds has `text`, OR (kinds empty AND `model_type` is not `'image'`). Image models that also output text (kinds includes `text`) qualify.

- [ ] **Step 1: Write failing tests** in `jobs.test.ts` (reuse the `makeModel` pattern from `qualify.test.ts`, adding `kinds`):
  - legacy `{ kinds: null, model_type: 'image' }` fits `generator`, not `pitch`
  - `{ kinds: '["vision","text","multimodal"]' }` fits `reader` and `pitch`, not `generator`
  - `{ kinds: null, cap_vision: 1, model_type: 'general' }` fits `reader` and `pitch`
  - `{ kinds: '["embedding"]' }` fits none
  - `modelsForJob` puts a favorite after-alphabetically model first
  - `jobOptionLabel({ favorite: 1, nickname: 'Nano', price_in: 0.0000003, price_out: 0.0000025 })` → `'★ Nano $'`

- [ ] **Step 2: Run** `npx vitest run src/lib/models/jobs.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `jobs.ts`. In `ModelsScreen.svelte`: add `kinds: string` to the `Draft` type, populated from lookup's `draft.kinds`; render one toggle chip per `MODEL_KINDS` entry in the draft editor (reuse the `.mlm-cap` chip styling used for capabilities); include `kinds` in the save/patch body; show the model's kinds as small chips next to `.mlm-type` on roster cards. Also make the existing `imageModels` derived use `modelsForJob(models, 'generator')` (impact-check first).

- [ ] **Step 4: Run** `npx vitest run src/lib/models` then `npm run build` — Expected: tests PASS, build succeeds.

- [ ] **Step 5: Commit** `git commit -m "models: per-job filters for cover factory + kind chips"`

---

### Task 4: Cover Factory model settings route + card

**Files:**
- Create: `ui/src/routes/api/settings/cover-factory-models/+server.ts`
- Test: `ui/src/routes/api/settings/cover-factory-models/server.test.ts`
- Create: `ui/src/lib/server/coverFactory/models.ts`
- Test: `ui/src/lib/server/coverFactory/models.test.ts`
- Modify: `ui/src/lib/models/ModelsScreen.svelte` (new "Cover Factory" card after the "Image generation" card)

**Interfaces:**
- Consumes: `modelsForJob`, `jobOptionLabel`, `CoverJob` (Task 3); `getModelByModelId` (existing).
- Produces (used by pieces 2 and 5):
  - `export const COVER_JOB_KEYS: Record<CoverJob, string>` = `{ reader: 'cover_factory_reader_model', generator: 'cover_factory_generator_model', pitch: 'cover_factory_pitch_model' }`
  - `export function getPinnedCoverModel(db: Database.Database, job: CoverJob): string | null` — the pinned id if it still exists in `ai_models`; otherwise the first of `modelsForJob(listModels(db), job)`; otherwise null.
  - `GET /api/settings/cover-factory-models` → `{ reader: Slot, generator: Slot, pitch: Slot }` where `Slot = { pinned: string | null, missing: boolean, resolved: string | null }`.
  - `PUT` body `{ job: CoverJob, model_id: string | null }` → 400 on unknown job or non-string; 400 when `model_id` is not in the roster or doesn't fit the job; null/empty clears. Returns the same shape as GET.

- [ ] **Step 1: Write failing tests** (in-memory DB pattern from `api/models/[id]/server.test.ts`):
  - `getPinnedCoverModel` returns the pinned id when present; when the pinned row is deleted it returns the favorite generator model instead; with an empty roster returns null.
  - GET after pinning a model, then deleting it → `generator: { pinned: '<id>', missing: true, resolved: <fallback or null> }`.
  - PUT `{ job: 'generator', model_id: '<text-only model>' }` → 400; PUT `{ job: 'bogus', model_id: null }` → 400; PUT `{ job: 'reader', model_id: null }` clears (GET → `pinned: null`).

- [ ] **Step 2: Run** `npx vitest run src/lib/server/coverFactory src/routes/api/settings/cover-factory-models` — Expected: FAIL.

- [ ] **Step 3: Implement** the helper and route. Add the card: three labeled selects ("Cover reader — reads the album cover", "Cover generator — makes the new cover", "Concept pitches — writes gag ideas"), options from `modelsForJob` labeled with `jobOptionLabel`, an "Auto (top model)" empty option, and a "⚠ pinned model no longer in roster" note when `missing`. Copy the "Image generation" card's markup and classes.

- [ ] **Step 4: Run** `npx vitest run src/lib/server/coverFactory src/routes/api/settings` then `npm test` and `npm run build` — Expected: PASS.

- [ ] **Step 5: Verify in the app** against a DB copy (`cp ../data/league.db <scratchpad>/league.db`, point the dev/preview server at it per the project's usual env), open `/settings/models`, paste `https://openrouter.ai/google/gemini-2.5-flash-image`, confirm kinds chips show `image`/`vision`/`multimodal`, pin it as generator, reload, confirm it sticks. Kill the server afterward.

- [ ] **Step 6: Run** `node .gitnexus/run.cjs detect-changes --scope all --repo .` from repo root and confirm only expected symbols changed; then commit `git commit -m "cover factory: pinned per-job model settings + card"`.
