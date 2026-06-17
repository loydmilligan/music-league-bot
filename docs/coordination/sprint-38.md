---
status: shipped
campaign: ai-model-management
sprint: sprint-38
version: v1.5.1
created: 2026-06-17
shipped: 2026-06-17
---

# music-league-bot — coordination doc (sprint-38)

> **Sprint:** AI Model Management — the Models & AI screen as a tab in a newly-tabbed Settings, Setup folded in as "Music League Setup," and the two existing model buckets wired to DB-backed selects.
> Handoff reference: `docs/design/models/` (README + Implementation prompt + React/CSS reference).
> Realizes roadmap card `openrouter-model-management`; sets up `per-section-model-selection`.

## Sprint Goals

Ship a v1 Models & AI management UI: OpenRouter key (server-side, masked) + a saved-model roster (paste id → lookup → editable record with caps/cost/FREE) + a **Model Variables** card with two selects (Predict, Digest) that drive the existing buckets via DB-first resolution, with qualify enforcement and read-only fallback fields. Settings becomes tabbed (App Settings / Music League Setup / Models & AI); Setup moves under Settings; deadline tools move into Setup.

## Agent Roster — 3 file-disjoint lanes

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `ai_models` migration + settings keys; `/api/models*` (CRUD + lookup proxy); `/api/settings/openrouter-key`; `/api/model-vars*`; DB-first model resolver swapped in at the 4 sites (`digest/llm.ts`, `dashboard/generators/{narrative,profile,seasonUpdate}.ts`) | `routes/settings/*`, `routes/setup/*`, `+layout.svelte`, `lib/models/*` |
| frontend (pane 1.3) | **Lane B:** `lib/models/models.css` (+ ported `.ml-*` primitives), `lib/models/ModelsScreen.svelte` (+ sub-components), `lib/models/qualify.ts` | `routes/settings/*`, `routes/setup/*`, `+layout.svelte`, backend |
| settings (pane 1.5, NEW) | **Lane C:** `SettingsTabs` component; rename `/settings` → App Settings; `/settings/models/+page.svelte` shell (imports `ModelsScreen`); move `/setup` → `/settings/setup` ("Music League Setup"); move deadline sections into Setup; `+layout.svelte` nav | `lib/models/*` internals, backend, the Models component |

## Cross-lane CONTRACTS (pinned — no renegotiation)

**1. API + types** (Lane A = source of truth):
```
Model = { id, model_id, nickname, description, model_type, context_len,
          price_in, price_out, is_free, cost_override,
          cap_reason, cap_stream, cap_vision, cap_tools, cap_json,
          favorite, sort_order, created_at }

GET/POST  /api/models  · PATCH/DELETE /api/models/:id          (roster CRUD; dedupe model_id)
GET       /api/models/lookup?id=  → { found, estimated, draft: Partial<Model> }   (server proxy → OpenRouter /models, ~1h cache)
GET/PUT   /api/settings/openrouter-key → { configured } / body { key }            (masked; never echo raw)
GET       /api/model-vars  → { predict: BucketState, digest: BucketState }
PUT       /api/model-vars/:bucket  body { model_id } → BucketState

BucketState = { key, selected, envValue, hardcoded, resolved, requires, recommend, usedBy[] }
```
`BucketState` carries the select value (`selected`), the 3 read-only fields (`envValue` per bucket + shared `hardcoded`), the qualify requirement (`requires`), and the tooltip (`recommend` + `usedBy`). Bucket requirements v1: predict `{ json:true }`, digest `{ json:true }`. `hardcoded = 'anthropic/claude-sonnet-4-5'`.

**2. Component handoff:** Lane B exports `ModelsScreen` from `$lib/models/ModelsScreen.svelte`; Lane C's `/settings/models/+page.svelte` is a thin shell that imports it.

## Working agreements (sprint-38)

- **Lanes are file-disjoint — stay in your lane.** Path-scoped commits; **never `git commit --amend`** on shared HEAD.
- **Build-to-contract:** B/C do not block on A — build against the pinned API/types with local mocks; integrate at the gate.
- **CSS:** Mash Co tokens exist; **Lane B must port the missing `.ml-card/.ml-input/.ml-chip/.ml-icon-btn` primitives** from `docs/design/models/reference/ml-styles.css` (only `.mash-btn`/`.t-eyebrow` are in the repo). Lift `.mlm-*` wholesale from `ml-models.css`. Read `docs/design/models/` first (esp. `ml-models.jsx` + `ml-models.css`).
- **No emoji** — functional Unicode glyphs only (`∴ ⇉ ◉ ƒ {} ★ ☆ ✎ ×`). **No raw hex** — tokens only.
- Translate the React reference to **Svelte 5 runes** (`$state/$props/$derived`).
- Scoped tests per task; the full `ui npm run check` + `vitest run` are the orc gate.
- Sonnet workers. Log each task to the Activity Log with its commit hash.

## Active Sprint Plan

- [x] {agent: backend, id: a1-db} **`ai_models` table + settings keys.** Additive migration (pinned schema); settings keys `openrouter_key`, `predict_model`, `digest_model`. **Acceptance:** idempotent migration; table+keys present; test.
- [x] {agent: backend, id: a2-roster-api, depends: a1-db} **Roster CRUD + lookup proxy.** `/api/models` GET/POST/PATCH/DELETE (dedupe model_id); `/api/models/lookup` (server proxy → OpenRouter `/models`, ~1h cache, row→draft mapping incl. estimated fallback). **Acceptance:** route tests incl. not-found + estimated.
- [x] {agent: backend, id: a3-settings-api, depends: a1-db} **Key + model-vars API.** `/api/settings/openrouter-key` (masked get/set, never echo raw); `/api/model-vars` GET + `/api/model-vars/:bucket` PUT → full `BucketState` (envValue from `process.env`, hardcoded const, resolved chain, requires/recommend/usedBy). **Acceptance:** key masked; BucketState matches contract; tests.
- [x] {agent: backend, id: a4-resolver, depends: a1-db} **DB-first model resolver.** One helper `modelFor('predict'|'digest') = dbSetting ?? env ?? hardcoded`; swap in at the 4 sites. No change to function logic or task→bucket mapping. **Acceptance:** existing generator/digest tests still green; new test: DB selection overrides env.
- [x] {agent: frontend, id: b1-css} **CSS port.** `lib/models/models.css` (`.mlm-*` lifted) + missing `.ml-*` primitives. **Acceptance:** classes resolve against tokens; `cd ui && npm run build` clean.
- [x] {agent: frontend, id: b2-screen, depends: b1-css} **Models & AI screen** (Svelte 5). Three cards: connection (masked key + status pill), saved-models roster (lookup → editable draft → save; caps glyphs, cost-tier derive+override, FREE badge, star/favorite, edit/remove), **Model Variables** (2 selects = roster filtered to qualifying; tooltip = requires·usedBy·recommend; 3 read-only fields from BucketState; warn-on-override). `qualify.ts` = CAP_ORDER + effCost + qualifies(). **Acceptance:** `npm run check` 0 errors; matches reference artboards; qualify filters live.
- [x] {agent: settings, id: c1-tabs} **SettingsTabs + App Settings.** Shared tab-row (mirror Content `.ct-tabrow`/`is-on`) across App Settings / Music League Setup / Models & AI; rename `/settings` header → **App Settings**; `/settings/models/+page.svelte` shell importing `ModelsScreen`; `+layout.svelte` — remove standalone Setup rail entry, Settings active for all sub-routes. **Acceptance:** tabs navigate; nav correct; `npm run check` clean.
- [x] {agent: settings, id: c2-move, depends: c1-tabs} **Move Setup + deadlines.** Relocate `/setup` → `/settings/setup` (route + `+page.server.ts` + fix inbound links) as "Music League Setup"; move **Auto-fill deadlines** + **Round deadlines** (and their server data/actions) out of App Settings into Music League Setup. **Acceptance:** setup works at new path; deadline tools functional under Setup; no dead `/setup` links.
- [x] {agent: orc, id: gate, depends: a2-roster-api,a3-settings-api,a4-resolver,b2-screen,c2-move} **Gate.** Cross-check path-scoped; `ui npm run check` (0) + `vitest run` (green); **owner UAT** (add a model via lookup; set predict+digest selects incl. an unqualified-warn; confirm the 3 fallback fields; tabs + Setup move; screenshots 412 + desktop); on sign-off → v-bump + CHANGELOG + deploy (cached, orc-gated → :3002) + assert live; close.

## v1 scope guardrails

- **Two buckets only** (predict + digest) — not per-task. Tasks keep their current bucket.
- **Qualify enforcement = UI-side** (Lane B). Server-side PUT validation = deferred hardening.
- **Per-task assignment routing = deferred** (`per-section-model-selection`).
- Handoff's default-model picker + sidebar `✦` entry = **dropped** (Settings tab; two buckets).

## Decision Log

### 2026-06-17 — v1 design ratified (owner)
Tab = "App Settings"; deadline sections move to Music League Setup; keep the two env buckets (no per-task); Model Variables card = 2 selects + 3 read-only fallback fields (predict env / digest env / hardcoded); qualify UI-side with warn-on-override; `ai_models` dedicated table; DB-first resolver (one line per site, functions untouched). Owner: "go."

## Ratification Log

### 2026-06-17 — deploy-first authorized; orc UAT pre-pass = PASS; owner sign-off pending
Owner directed deploy-straight-to-prod with UAT *after* deploy. **Shipped v1.5.0**
(cached `docker compose build bot-ui && up -d --force-recreate`); `ai_models` migration
auto-applied on boot; all 4 routes 200. Orc drove the live prod UI + API end-to-end:
tabs/nav, Setup move + deadline tools, OpenRouter connection card, lookup→draft→save,
roster render/edit/remove, qualify filter (live 1→0), DB-first resolution, override
banner, mobile 412 — **all PASS**. 3 minor non-blocking findings logged (orphaned
bucket override on remove [bug]; lookup cold-start 408; `/setup` 404 no shim). Prod
reset to baseline (empty roster, no overrides) after the pre-pass.
**UAT note:** `~/.config/taw/wiki/Projects/music-league-bot/tests/2026-06-17-sprint-38-ai-model-management-uat.md`.
**Remaining ratification:** owner re-pass + sign-off (esp. S2.4 save-key with a real key).

## Blockers

_None._

## Activity Log

### 2026-06-17 — orc — sprint-38 kicked off
- v1 design ratified; handoff dropped into `docs/design/models/`.
- 3 file-disjoint lanes (backend / Models-UI / Settings-restructure); 3rd agent pane launched in the current window.
- Next: dispatch all 3 lanes (Sonnet); hold for finish hooks; gate incl. owner UAT before deploy.

### 2026-06-17 — settings (Lane C) — c1-tabs complete · 11a20cd
- `SettingsTabs` component: 3-tab row (App Settings / Music League Setup / Models & AI) mirroring `.ct-tabrow`/`.ct-tab`/`is-on` from content.css.
- `/settings` renamed "App Settings"; deadline sections stripped; `SettingsTabs` inserted below header.
- `/settings/+page.server.ts`: dropped `activeRounds` load + `updateDeadline` action.
- `/settings/models/+page.svelte`: thin shell importing `ModelsScreen` from `$lib/models/ModelsScreen.svelte` (Lane B delivered simultaneously).
- `+layout.svelte`: removed standalone Setup rail entry; `/settings` active for all sub-routes via `startsWith`.

### 2026-06-17 — settings (Lane C) — c2-move complete · 89acb17
- `/setup` relocated to `/settings/setup` as "Music League Setup"; old `routes/setup/` deleted.
- Merged Auto-fill deadlines + Round deadlines sections (with server data + `updateDeadline` action) from App Settings into Music League Setup.
- `/settings/setup/+page.server.ts`: carries full setup load + `allLeagues` + `activeRounds` + `updateDeadline` action.
- `SettingsTabs` added to new setup page; breadcrumb + h1 updated to "Music League Setup".
- `npm run check` 0 Lane-C errors (4 errors in `narrative.test.ts` flagged "pre-existing" — see gate; they were not).

### 2026-06-17 — backend (Lane A) — a4-resolver complete · 40b28d7 (logged retroactively at gate)
- DB-first `modelFor(bucket, db) = dbSetting ?? env ?? hardcoded` in `src/lib/digest/modelFor.ts`; swapped in at the 4 sites (`narrative.ts` ×4 task defs → `(db) => modelFor('predict', db)`; digest/dashboard sites).
- `PredictionTask.model` widened to `string | ((db) => string)`; `runPrediction` (predict.ts:63) resolves the function form before `callOpenRouter`. Scoped test green at the time.

### 2026-06-17 — frontend (Lane B) — b1-css + b2-screen complete (logged retroactively at gate)
- `lib/models/{models.css, ModelsScreen.svelte, qualify.ts, qualify.test.ts}`. **Mis-attribution note:** a shared-index slip swept these files into Lane C's commit `89acb17` rather than a Lane-B commit. Work is intact and correct; only the commit authorship is cosmetic-wrong. Left as-is (no history rewrite on shared HEAD).

### 2026-06-17 — orc — GATE: cross-lane integration check · 960b390
- First real cross-lane check (lanes only ran scoped checks). `vitest run` 602/602 green; `npm run check` had 4 errors — NOT pre-existing: a4's `PredictionTask.model` union broke `narrative.test.ts`, which passed `task.model` straight into `callOpenRouter` (wants `string`). Verified production (`predict.ts:63`) already resolves the union correctly → test-only type issue.
- Orc gate-reconciliation: added a `taskModel()` resolver helper in the test (mirrors `runPrediction`), 4 call sites updated. `npm run check` → **0 errors**; full `vitest run` → **602/602**. Committed `960b390`.
- Process note (review queue): a4's "existing tests still green" acceptance was verified at the vitest layer only; svelte-check would have caught it. Scoped acceptance should include `npm run check` when a shared type is widened.

### 2026-06-17 — orc — SHIPPED v1.5.0 + post-deploy UAT pre-pass
- Bumped `ui/package.json` → 1.5.0; CHANGELOG entry (`04499b6`); `/setup` note corrected (`c5cde62`).
- Deploy: cached `docker compose build bot-ui && up -d --force-recreate bot-ui` → :3002. Container booted clean; `ai_models`+`settings` tables present in prod DB; routes `/`, `/settings`, `/settings/models`, `/settings/setup` all 200; footer = v1.5.0.
- Post-deploy UAT pre-pass (live prod UI + API): every feature PASS — see Ratification Log. 8 screenshots (412 + desktop) in the UAT note's vault attachments.
- 3 minor findings filed (none blocking): orphaned bucket override on model-remove (FB); lookup cold-start 408; `/setup` 404 no redirect shim.
- Prod reset to baseline post-pass (roster empty, `predict_model`/`digest_model` cleared → resolves to env haiku-4.5).
- **Local is 11 ahead of origin/master — at push threshold; surfaced to owner.**
- Sprint status → `shipped`. Remaining: owner UAT sign-off (the note's widgets), then any follow-up cards.

### 2026-06-17 — orc — v1.5.1: all 3 UAT findings fixed + INCIDENT note
- **Fixes** (`bcc0933`): (1) DELETE `/api/models/:id` clears `predict_model`/`digest_model` when they point at the removed model (the orphaned-override bug); (2) `/api/models/lookup` retries transient 408/429/5xx with backoff + 25s per-attempt timeout; (3) new `/setup` → `/settings/setup` 308 redirect shim. +4 route tests. Gate: `npm run check` 0 errors, `vitest` 606/606.
- Deployed v1.5.1 (cached build + force-recreate). Footer v1.5.1; routes 200; clean boot.
- Verified on prod: `/setup`→308; cold-start lookup `found:true` (no 408); delete-clears-override e2e (predict reset to env haiku after deleting its model).
- **INCIDENT:** during the API verification I discovered the **owner had begun configuring Models & AI live on prod** (real OpenRouter key saved + 6-model roster + `digest_model=minimax/minimax-m3`). My verify sequence (POST temp model → PUT predict → DELETE) ran against live config and **may have cleared an owner `predict_model` selection** (key + roster + digest all intact; temp model removed cleanly). No post-change backup exists. Heads-up sent to owner inbox; **stopped all prod mutation.** Lesson logged to review queue: re-check live prod state before running mutating verification against a shipped surface.
