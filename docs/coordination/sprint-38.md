---
status: active
campaign: ai-model-management
sprint: sprint-38
created: 2026-06-17
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

- [ ] {agent: backend, id: a1-db} **`ai_models` table + settings keys.** Additive migration (pinned schema); settings keys `openrouter_key`, `predict_model`, `digest_model`. **Acceptance:** idempotent migration; table+keys present; test.
- [ ] {agent: backend, id: a2-roster-api, depends: a1-db} **Roster CRUD + lookup proxy.** `/api/models` GET/POST/PATCH/DELETE (dedupe model_id); `/api/models/lookup` (server proxy → OpenRouter `/models`, ~1h cache, row→draft mapping incl. estimated fallback). **Acceptance:** route tests incl. not-found + estimated.
- [ ] {agent: backend, id: a3-settings-api, depends: a1-db} **Key + model-vars API.** `/api/settings/openrouter-key` (masked get/set, never echo raw); `/api/model-vars` GET + `/api/model-vars/:bucket` PUT → full `BucketState` (envValue from `process.env`, hardcoded const, resolved chain, requires/recommend/usedBy). **Acceptance:** key masked; BucketState matches contract; tests.
- [ ] {agent: backend, id: a4-resolver, depends: a1-db} **DB-first model resolver.** One helper `modelFor('predict'|'digest') = dbSetting ?? env ?? hardcoded`; swap in at the 4 sites. No change to function logic or task→bucket mapping. **Acceptance:** existing generator/digest tests still green; new test: DB selection overrides env.
- [ ] {agent: frontend, id: b1-css} **CSS port.** `lib/models/models.css` (`.mlm-*` lifted) + missing `.ml-*` primitives. **Acceptance:** classes resolve against tokens; `cd ui && npm run build` clean.
- [ ] {agent: frontend, id: b2-screen, depends: b1-css} **Models & AI screen** (Svelte 5). Three cards: connection (masked key + status pill), saved-models roster (lookup → editable draft → save; caps glyphs, cost-tier derive+override, FREE badge, star/favorite, edit/remove), **Model Variables** (2 selects = roster filtered to qualifying; tooltip = requires·usedBy·recommend; 3 read-only fields from BucketState; warn-on-override). `qualify.ts` = CAP_ORDER + effCost + qualifies(). **Acceptance:** `npm run check` 0 errors; matches reference artboards; qualify filters live.
- [ ] {agent: settings, id: c1-tabs} **SettingsTabs + App Settings.** Shared tab-row (mirror Content `.ct-tabrow`/`is-on`) across App Settings / Music League Setup / Models & AI; rename `/settings` header → **App Settings**; `/settings/models/+page.svelte` shell importing `ModelsScreen`; `+layout.svelte` — remove standalone Setup rail entry, Settings active for all sub-routes. **Acceptance:** tabs navigate; nav correct; `npm run check` clean.
- [ ] {agent: settings, id: c2-move, depends: c1-tabs} **Move Setup + deadlines.** Relocate `/setup` → `/settings/setup` (route + `+page.server.ts` + fix inbound links) as "Music League Setup"; move **Auto-fill deadlines** + **Round deadlines** (and their server data/actions) out of App Settings into Music League Setup. **Acceptance:** setup works at new path; deadline tools functional under Setup; no dead `/setup` links.
- [ ] {agent: orc, id: gate, depends: a2-roster-api,a3-settings-api,a4-resolver,b2-screen,c2-move} **Gate.** Cross-check path-scoped; `ui npm run check` (0) + `vitest run` (green); **owner UAT** (add a model via lookup; set predict+digest selects incl. an unqualified-warn; confirm the 3 fallback fields; tabs + Setup move; screenshots 412 + desktop); on sign-off → v-bump + CHANGELOG + deploy (cached, orc-gated → :3002) + assert live; close.

## v1 scope guardrails

- **Two buckets only** (predict + digest) — not per-task. Tasks keep their current bucket.
- **Qualify enforcement = UI-side** (Lane B). Server-side PUT validation = deferred hardening.
- **Per-task assignment routing = deferred** (`per-section-model-selection`).
- Handoff's default-model picker + sidebar `✦` entry = **dropped** (Settings tab; two buckets).

## Decision Log

### 2026-06-17 — v1 design ratified (owner)
Tab = "App Settings"; deadline sections move to Music League Setup; keep the two env buckets (no per-task); Model Variables card = 2 selects + 3 read-only fallback fields (predict env / digest env / hardcoded); qualify UI-side with warn-on-override; `ai_models` dedicated table; DB-first resolver (one line per site, functions untouched). Owner: "go."

## Ratification Log

_Pending: owner UAT of the Models & AI tab + Settings restructure at the gate, before deploy._

## Blockers

_None._

## Activity Log

### 2026-06-17 — orc — sprint-38 kicked off
- v1 design ratified; handoff dropped into `docs/design/models/`.
- 3 file-disjoint lanes (backend / Models-UI / Settings-restructure); 3rd agent pane launched in the current window.
- Next: dispatch all 3 lanes (Sonnet); hold for finish hooks; gate incl. owner UAT before deploy.
