---
status: shipped
shippedIn: v1.6.0
campaign: openrouter-cost-management
sprint: sprint-39-cost-ledger
version: v1.6.0
created: 2026-06-17
---

# music-league-bot — coordination doc (sprint-39-cost-ledger)

> **Sprint:** OpenRouter Cost Management — per-call cost ledger (data foundation) + cost-tier display bug fix.
> Spec: `~/.config/taw/wiki/Projects/music-league-bot/sprint-39-cost-ledger-spec.md`.
> Realizes the data layer of roadmap card `openrouter-cost-management`; sprint-40 (cost dashboard) consumes the read API declared here.

## Sprint Goals

Ship `llm_cost_log` — a durable, append-only record of every OpenRouter call: model used, prompt/completion/total tokens, USD cost, category (`digest`/`archive`/`predict`), and a fine-grained label. Federate with the existing `prediction_runs` ledger (contract #6). **Capture the impossible-to-backfill passive usability data at the same call sites** — `run_id` + artifact linkage, `prompt_version`, `output_hash`, `retry_count`, the `params` blob, and the technical `outcome` default — and create the `llm_health_event` / `llm_delight` side tables (contracts #1, #7). Instrument all five active LLM call sites to write rows. Fix a bundled bug in `proposeRelContextUpdate` (drops cost, ignores DB model). Declare and implement the three read-API endpoints (over the `llm_calls` union view) that sprint-40 will depend on. Fix the cost-tier display bug in the Models & AI roster so `$`/`$$`/`$$$` reflect actual pricing. **Backend-only; the human-action outcome finalizers + delight UI are the follow-on sprint.**

## Agent Roster — 2 file-disjoint lanes

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `ui/src/lib/db/schema.ts` (add `llm_cost_log`); `ui/src/lib/digest/llm.ts` (extend `LLMResult`, add `meta` arg + `logLlmCall`); `ui/src/lib/digest/relContext.ts` (bug fix: add `db` param, use `modelFor`, log call); `ui/src/lib/predict/predict.ts` (thread `category` + `meta` through `runPrediction`); `ui/src/routes/api/cost/` (new route family: summary / daily / calls) | `ui/src/lib/models/*`, `ModelsScreen.svelte`, `qualify.ts` |
| frontend (pane 1.3) | **Lane B:** `ui/src/lib/models/qualify.ts` (fix `tierFromPricing` call sites in `effCost`); `ui/src/lib/models/ModelsScreen.svelte` (fix `costTierOf` + draft bar tier + price label) | `ui/src/lib/db/schema.ts`, `llm.ts`, `relContext.ts`, `predict.ts`, `routes/api/cost/` |

## Cross-lane CONTRACTS (pinned — no renegotiation)

**1. `llm_cost_log` table shape** (Lane A = source of truth):
```sql
llm_cost_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  model            TEXT    NOT NULL,
  prompt_tokens    INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL    NOT NULL DEFAULT 0,
  latency_ms       INTEGER NOT NULL DEFAULT 0,  -- wall-clock of the callOpenRouter fetch (KPI #2: time-to-generate)
  category         TEXT    NOT NULL,   -- 'digest' | 'archive' | 'predict'
  label            TEXT    NOT NULL,   -- e.g. 'digest:full', 'predict:vote-probe'
  -- join keys (can't-backfill: tie a call to the exact generation it produced) --
  run_id           TEXT,              -- groups the calls of one generation (whole draft + its per-section regens)
  artifact_type    TEXT,              -- 'digest_draft' | 'digest_section'
  artifact_id      TEXT,              -- the draft/section id this call produced
  prompt_version   TEXT,              -- prompt id/hash the output is attributable to (quality = model × prompt)
  output_hash      TEXT,              -- sha256 of generated text (pointer, NOT the text)
  -- usability (3rd KPI) — passive fields set now; human-action outcomes finalized in the follow-on sprint --
  outcome          TEXT,              -- 'passed'|'healed'|'salvaged'|'rejected'|'unusable' (nullable until finalized)
  recovery_cost    REAL,              -- derived from outcome (0..1)
  retry_count      INTEGER NOT NULL DEFAULT 0,  -- auto-heal magnitude (wrapper owns retries)
  edit_distance    REAL,              -- salvage magnitude (% chars a human changed) — DIGEST only, set by follow-on
  regen_changed    TEXT,              -- on reject: 'none'|'params'|'model' — set by follow-on
  -- params (capture now, tune in stage 3) --
  params           TEXT,              -- JSON blob: temp/top_p/max_tokens/seed/response_format/…
  params_schema_version INTEGER,
  league_id        INTEGER,
  round_id         INTEGER
)
```
No foreign-key constraints. Append-only; no deletes. **Scope: the DIGEST path only** — predict/archive calls federate via `prediction_runs` (see contract #6). The wrapper sets the passive fields (`run_id`, `artifact_*`, `prompt_version`, `output_hash`, `retry_count`, `params`, and a technical `outcome` default) at generation time; the human-action outcome fields (`outcome` finalization, `edit_distance`, `regen_changed`) are populated by the follow-on usability-capture sprint (see Decision Log 2026-06-18 — usability scope).

**2. `LLMResult` (Lane A extends, Lane B does not touch):**
```ts
export interface LLMResult {
  content: string;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;   // callOpenRouter times its own fetch (Date.now() around the request)
}
```

**3. `LLMCallMeta` + `callOpenRouter` signature (Lane A, pinned):**
```ts
export type LLMCallMeta = {
  category: 'digest' | 'archive' | 'predict';
  label: string;
  db: Database.Database;
  leagueId?: number;
  roundId?: number;
  // passive capture (caller supplies what it knows; wrapper derives the rest) --
  runId?: string;          // groups one generation's calls
  artifactType?: string;   // 'digest_draft' | 'digest_section' | 'prediction_run' | 'bside_section'
  artifactId?: string;     // the row this call produced
  promptVersion?: string;  // prompt id/hash
};
// opts.meta absent → no-op (zero behaviour change for un-migrated callers)
// Wrapper derives from what it already sees: params (from the request body), output_hash
// (sha256 of content), retry_count, and the technical `outcome` default
// (finish_reason 'length'/'content_filter' or JSON-mode/schema failure → 'unusable', else null/'passed').
callOpenRouter(messages, opts: { model?, jsonMode?, meta?: LLMCallMeta })
```

**4. Read API (Lane A implements; sprint-40 consumes):**
```
GET /api/cost/summary?date=YYYY-MM-DD
  → { digest: number, archive: number, predict: number, total: number }

GET /api/cost/daily?days=N          (default 14, oldest-first, zero-fill gaps)
  → [{ date: string, digest: number, archive: number, predict: number }]

GET /api/cost/calls?date=YYYY-MM-DD (default today, newest-first, cap 500)
  → [{ ts, model, category, label, cost_usd, latency_ms, prompt_tokens, completion_tokens }]
```
> **latency_ms** is captured by `callOpenRouter` (wall-clock around the fetch) and logged on
> every row. It is the second real KPI (alongside cost) for the sprint-40 model-comparison
> visuals; quality is a future signal, not captured here. The aggregation endpoints may add
> avg-latency-per-(model,label) views in sprint-40 without a schema change.

**5. Cost-tier contract (Lane B, sprint-38 surfaces):**
`tierFromPricing(inPerM, outPerM)` expects per-million-token values. `ai_models.price_in`/`price_out` are stored per-token. All three call sites must multiply by `1e6` before passing.

**6. Federation with `prediction_runs` (owner-ratified 2026-06-18 — supersedes a5's original "log predict/archive into `llm_cost_log`").**
`prediction_runs` (created in `db/client.ts`) is ALREADY a per-call cost+latency ledger for the 10 predict/archive tasks, and live code reads it (predict caches `lookupVoteProbeCache`/`lookupSubmissionPredictCache` SELECT `cost_usd`/`latency_ms`; `actual_json`/`score_json` are reserved for future scoring). Do **NOT** unify, migrate, or break it. Federate instead:
- **Digest path → `llm_cost_log`** (the new table above): `digest:full` + per-section regens. This is the only path with no per-call ledger today.
- **Predict/archive path → extend `prediction_runs`** via guarded `ALTER TABLE` (PRAGMA `table_info` check, per the `client.ts` convention): add the cost-attribution columns `prompt_tokens`, `completion_tokens`, `total_tokens`, `category` (`'predict'|'archive'`), `label`, **and** the same passive capture columns as `llm_cost_log` — `run_id`, `artifact_type` (`'prediction_run'`/`'bside_section'`), `artifact_id`, `prompt_version`, `output_hash`, `outcome`, `recovery_cost`, `retry_count`, `params`, `params_schema_version`. (`edit_distance`/`regen_changed` are digest-only; predict/archive have no salvage rung — see CD SCHEMA §5, so they stay null here.) `runPrediction`'s existing INSERT populates the cost + passive fields. **No `llm_cost_log` rows for predict/archive** — no double-logging.
- **Read API reads a UNION** — create a `llm_calls` VIEW projecting the shared columns (`created_at`, `model`, `category`, `label`, `cost_usd`, `latency_ms`, `prompt_tokens`, `completion_tokens`) as `SELECT … FROM llm_cost_log UNION ALL SELECT … FROM prediction_runs`. All `/api/cost/*` endpoints query the view, never either table directly.

**7. Side tables (created now in sprint-39; populated by the follow-on usability sprint).**
```sql
llm_health_event (  -- QUARANTINED axis: availability/config, NOT quality (kept out of the usability denominator)
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  cost_log_id TEXT,                 -- nullable
  error_class TEXT,                 -- 'provider_error' | 'model_unavailable' | 'capability_mismatch'
  model TEXT, detail TEXT
)
llm_delight (       -- positive pole: sparse human ▲ thumbs-up on a standout line
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  cost_log_id TEXT,                 -- → llm_cost_log.id (or prediction_runs.id)
  span TEXT, subsection TEXT, note TEXT
)
```
`llm_eval` (the real quality score) is **deferred to stage 3** — `prediction_runs.actual_json`/`score_json` already reserve that slot; do not create it now.

## Working agreements (sprint-39)

- **Lanes are file-disjoint — stay in your lane.** Path-scoped commits (`git commit -m "…" -- <paths>`); **never `git commit --amend`** on shared HEAD.
- **Build-to-contract:** Lane B does not depend on Lane A and can proceed immediately. Lane A routes can be tested with unit/integration tests against an in-memory DB before Lane B touches the tier display.
- **`logLlmCall` is fire-and-forget.** Wrap the INSERT in try/catch; a ledger write failure must never abort the LLM call.
- **Retry rows.** `runPrediction` has a one-retry path; the retry call logs a separate row with the same `meta`. This is expected — each row = one OpenRouter API call.
- **Static-model predict tasks** (`submission-predict`, `vote-probe`, `taste-fingerprint`) use `process.env.OPENROUTER_PREDICT_MODEL` at module load. Log whatever model was actually resolved; do not migrate to `modelFor` — that is sprint-41.
- **No emoji** — functional Unicode glyphs only (`∴ ⇉ ◉ ƒ {} ★ ☆ ✎ ×`). **No raw hex** — tokens only.
- Svelte 5 runes (`$state/$props/$derived`) throughout.
- Scoped tests per task; full `cd ui && npm run check` (0 errors) + `npx vitest run` (green) are the orc gate.
- Sonnet workers. Log each task to the Activity Log with its commit hash.

## Active Sprint Plan

- [ ] {agent: backend, id: a1-schema} **`llm_cost_log` + side tables.** Append `CREATE TABLE IF NOT EXISTS llm_cost_log (…)` (full column set per contract #1, incl. the join-key / passive-usability / params columns) plus `llm_health_event` and `llm_delight` (contract #7) to the `SCHEMA` const in `ui/src/lib/db/schema.ts`. **Acceptance:** all three tables auto-apply on boot (like `ai_models`); idempotent; schema test green covering the new columns.

- [ ] {agent: backend, id: a2-llmresult, depends: a1-schema} **Extend `LLMResult` + `callOpenRouter` (cost + passive usability capture).** Add `promptTokens`/`completionTokens`/`totalTokens`/`latencyMs` to `LLMResult`; read tokens from `json.usage.*`; capture `latencyMs` by timing the fetch (`Date.now()` around the request). Add the `LLMCallMeta` type + optional `meta` arg (per contract #3). Implement `logLlmCall` (try/catch INSERT into `llm_cost_log`) writing the cost/latency/token fields **and the passive capture fields the wrapper can derive**: `output_hash` (sha256 of `content`), `retry_count`, `params` (the request body's temp/top_p/max_tokens/seed/response_format as a JSON blob + `params_schema_version=1`), `prompt_version`/`run_id`/`artifact_type`/`artifact_id` (passed through from `meta`), and the technical `outcome` default (`finish_reason` `length`/`content_filter` or JSON-mode/schema failure → `'unusable'`, else leave null for the follow-on to finalize). When `meta` is absent the function is a no-op extension. **Acceptance:** `llm.test.ts` + new unit test for `logLlmCall` asserting latency_ms, tokens, output_hash, params blob, and `outcome='unusable'` on a truncated/`length` finish; `meta`-absent path unchanged; `npm run check` 0 errors.

- [ ] {agent: backend, id: a3-digest-sites, depends: a2-llmresult} **Thread `meta` through digest call sites.** In `llm.ts`: thread `meta` through `generateDraft()` (`category: 'digest'`, `label: 'digest:full'`, leagueId + roundId from args) and `regenerateOneSection()` (`category: 'digest'`, `label: 'digest:<kind>'`, roundId from args; derive leagueId from round). **Also set the passive join keys:** `runId` (a per-generation uuid — `generateDraft` mints it; per-section regens of that draft REUSE the draft's runId so the dashboard rolls them up), `artifactType`/`artifactId` (`'digest_draft'`+draftId for the full draft, `'digest_section'`+sectionId for regens), `promptVersion` (a stable id/hash for the current digest prompt). **Acceptance:** each function writes a `llm_cost_log` row with runId + artifact linkage + promptVersion populated; existing digest tests still green.

- [ ] {agent: backend, id: a4-relctx-fix, depends: a2-llmresult} **`proposeRelContextUpdate` bug fix + ledger hook.** Add `db: Database.Database` param; change hard-coded env model to `modelFor('digest', db)`; destructure full `LLMResult`; pass `meta: { category: 'archive', label: 'archive:rel-context', db, leagueId, roundId }` to the call. **Acceptance:** function uses DB-resolved model; writes a `llm_cost_log` row; existing relContext tests green; `npm run check` 0 errors.

- [ ] {agent: backend, id: a5-predict-sites, depends: a2-llmresult} **Federate predict/archive cost into `prediction_runs`** (per contract #6 — owner-ratified federation; do NOT write `llm_cost_log` rows for these paths). Add the federation columns (`prompt_tokens`, `completion_tokens`, `total_tokens`, `category`, `label`) to `prediction_runs` via guarded `ALTER TABLE` in `db/client.ts` (PRAGMA `table_info` check). Add optional `category?: 'archive' | 'predict'` to `runPrediction` opts (default `'predict'`); extend `runPrediction`'s existing INSERT to populate the new columns (`label = \`${category}:${task.id}\``; tokens from the richer `LLMResult`). Update all `runPrediction` call sites that run archive tasks (`narrative-*`, `profile-*`, `season-update`) to pass `category: 'archive'`; predict tasks (`submission-predict`, `vote-probe`, `taste-fingerprint`) default to `'predict'` and require no call-site change. The retry path reuses the same category/label. **Also populate the passive columns** in the same INSERT: `run_id` (per-run uuid), `artifact_type` (`'prediction_run'` for predict, `'bside_section'` for archive), `artifact_id` (the `prediction_runs` row id), `prompt_version`, `output_hash` (from the richer `LLMResult`), `params`, `retry_count`, and the technical `outcome` (the schema-miss throw on the 2nd retry = `'unusable'`; otherwise leave null for the follow-on). **Acceptance:** `prediction_runs` has the new cost + passive columns (idempotent ALTER); `runPrediction` populates them; archive vs predict category correct; `outcome='unusable'` on a forced schema-miss; existing predict caches + `predict.test.ts` still green; `npm run check` 0 errors.

- [ ] {agent: backend, id: a6-cost-api, depends: a1-schema,a5-predict-sites} **Cost read API.** First create the `llm_calls` UNION view (contract #6) over `llm_cost_log` + `prediction_runs` — requires both a1 (digest table) and a5 (prediction_runs columns) to exist. New route family `ui/src/routes/api/cost/`: `GET summary`, `GET daily` (zero-fill gaps), `GET calls`, all querying the `llm_calls` view (never either base table directly). Match the pinned response shapes. **Acceptance:** view returns digest + predict + archive rows unioned; route tests (vitest) cover: today summary with rows from both sources; daily with gap day returning zero; calls paginates at 500; date param parses correctly; missing date defaults to today.

- [ ] {agent: frontend, id: b1-tier-fix} **Cost-tier × price-label fix.** In `qualify.ts`: multiply `m.price_in`/`m.price_out` by `1e6` before passing to `tierFromPricing` in `effCost()`. In `ModelsScreen.svelte`: same conversion in `costTierOf()` and the draft bar tier badge (line ~458); fix the draft bar price label to show per-million rates (`(draft.price_in * 1e6).toFixed(2)`). **Acceptance:** `qualify.test.ts` updated/extended — `tierFromPricing` called with per-token inputs produces correct tier (Opus → `$$$`, Sonnet → `$$`, Haiku → `$`); `npm run check` 0 errors; visual spot-check (screenshot the Models & AI roster showing correct tiers).

- [ ] {agent: orc, id: gate, depends: a2-llmresult,a3-digest-sites,a4-relctx-fix,a5-predict-sites,a6-cost-api,b1-tier-fix} **Gate.** Cross-check path-scoped commits (no lane overlap); `cd ui && npm run check` (0 errors); `cd ui && npx vitest run` (all green); owner UAT: trigger a digest regen + a vote-probe + verify `llm_cost_log` rows via `/api/cost/summary` (today), verify tier badges on roster; on sign-off → v1.6.0 bump + CHANGELOG + orc-gated cached deploy → :3002 + assert live; close sprint.

## v1 scope guardrails

- **Ledger is write-only for sprint-39.** No UI beyond the three read-API endpoints.
- **No cost budget alerts or capping.** Observability only; enforcement is future.
- **Static-model predict tasks stay static.** Migration to `modelFor` is sprint-41.
- **No historical backfill.** `llm_cost_log` starts from the moment of deployment.
- **No `llm_cost_log` retention policy.** Append forever in v1; pruning is future.
- **Cost dashboard UI = sprint-40.** Sprint-39 only ships the data + API contracts.

## Decision Log

### 2026-06-17 — campaign scoping ratified (owner)
Three-sprint campaign: sprint-39 = ledger foundation + tier bug fix; sprint-40 = debug mode + dashboard; sprint-41 = per-section model selection. Origin spike at `sessions/planning/2026-06-15-model-cost-management-spike.md`. Owner: "go."

### 2026-06-17 — `meta` opt-in design chosen over wrapper approach
Two options considered: (A) make `callOpenRouter` accept optional `meta` and log internally; (B) a thin `logLlmCall()` called at each site after the call. Chose (A) with the `meta` arg — keeps logging co-located with the call, reduces boilerplate at each site, and lets the function handle the retry case cleanly. `meta` absent = no-op; zero risk to callers not yet migrated.

### 2026-06-17 — `runPrediction` opts approach for category
Category cannot be a static field on `PredictionTask` without touching all task definitions (large diff, cross-lane). Adding `category` to `runPrediction`'s opts is the minimum-diff path: archive task call sites opt in, predict tasks get the default. Migration of task definitions deferred to sprint-41.

### 2026-06-18 — Federate the ledger with `prediction_runs` (amends a5/a6 + adds contract #6)
Surfaced by the CD cost-routing handoff re-derivation (`docs/design/cost-management/.../SCHEMA.md` §0–§1): `prediction_runs` is **already** a per-call cost+latency ledger for the 10 predict/archive tasks, and live caches/scoring read it. The original sprint-39 plan would have double-logged those calls into a fresh `llm_cost_log`. Two options weighed — **(A) Federate** (preserve `prediction_runs`, extend it with cost-attribution columns, `llm_cost_log` digest-only, union via a `llm_calls` view) vs **(B) Unify** (one table, rewrite the predict cache + scoring hot-path). Chose **(A)**: backwards-compatible (nothing that reads `prediction_runs` changes — columns are additive), no hot-path rewrite, same unified dashboard read via the view. (Original scope was lean cost-only; the usability columns were then folded in — see the next entry.)

### 2026-06-18 — Usability capture INCLUDED in the campaign (owner: "let's include them")
The CD handoff argues the usability-event + params + join-key data is impossible to backfill and should be captured from first deploy. Owner agreed. Split by capture cost so the cost ledger still ships clean:
- **Passive fields → sprint-39 (this sprint, backend-only).** Everything the wrapper / call sites can set for free at generation time: `run_id`, `artifact_type`/`artifact_id`, `prompt_version`, `output_hash`, `retry_count`, `params` (+version), and the **technical** `outcome` default (finish_reason / schema-fail → `unusable`). All schema columns (contract #1, #6) + both side tables `llm_health_event`/`llm_delight` (contract #7) are created now. Sprint-39 remains write-only with no new UI — the "ledger is write-only" guardrail holds.
- **Active fields → a follow-on usability-capture sprint (NEW, between 39 and 40).** The human-action outcomes that need UI wiring: digest inline-edit → `salvaged`+`edit_distance`; regenerate/skip → `rejected`+`regen_changed`; finalize untouched → `passed`; the **delight ▲ thumbs-up** control → `llm_delight` insert; `llm_health_event` logging on provider/availability failures; archive `dashboard_section_state` (`refresh`/steer) → `rejected`. Digest reaches the full ladder; predict/archive reach `passed/rejected/unusable` only (no salvage rung — CD SCHEMA §5).
Rationale for the split: the passive data is the irreplaceable part and rides for free on call sites we're already editing; the active part is a distinct UI-instrumentation effort that shouldn't bloat the cost-ledger sprint or share its frontend lane (the tier bug fix).

## Ratification Log

### 2026-06-18 — Federate (option A) ratified (owner)
Owner ratified the federated ledger approach: backwards-compatible, preserve `prediction_runs`. "federated … please." Encoded in contract #6 + tasks a5/a6.

### 2026-06-18 — predict-task DB routing confirmed for sprint-41 (owner)
Owner confirmed the 3 static-env predict tasks WILL be migrated to DB-first routing (resolves the CD handoff flag that Q5 per-section pinning assumes DB-routability). Scope lives in sprint-41 `a4-migrate`; sprint-39's "static predict tasks stay static" guardrail remains correct (migration is sprint-41, not here).

### 2026-06-18 — Usability capture included (owner)
Owner: "let's include them." Passive usability/params/join-key capture folded into sprint-39 (schema + wrapper + call-site population, backend-only); active human-action outcomes + delight + health logging carved into a NEW follow-on usability-capture sprint between 39 and 40. See Decision Log 2026-06-18 (usability scope) for the full split.

## Blockers

_None._

## Activity Log

### 2026-06-18 — orc — sprint-39 SHIPPED v1.6.0
- Dispatched 2 file-disjoint Sonnet lane agents. Backend (a1–a6): `1f857f7` schema (llm_cost_log + health/delight side tables), `685a42a` LLMResult+tokens/latency+LLMCallMeta+logLlmCall, `68db673` digest sites, `c2f44d2` relContext fix, `ea1e184` predict/archive federation into prediction_runs, `6f8c18a` llm_calls view + /api/cost/{summary,daily,calls}. Frontend (b1): `3b545f2` tier ×1e6 fix.
- Gate (orc-run, independent): `npm run check` 854 files 0 errors; `vitest run` 636/636 pass; commits path-scoped, no cross-lane overlap.
- Release `b96fdf4` v1.6.0 + CHANGELOG. Deployed via `docker compose build bot-ui && up -d --force-recreate` on 192.168.4.217. Footer asserts v1.6.0.
- Read-only prod verify: `/api/cost/daily` surfaces real historical predict spend via the federated `llm_calls` view (06-16 $0.245, 06-17 $0.361); digest/archive zero (accrue from new calls). No mutating verification on the live surface.

### 2026-06-17 — orc — sprint-39-cost-ledger planned
- Campaign context from spike + sprint-38 handoff ingested.
- Codebase verified: `callOpenRouter` in `llm.ts:264` returns `{ content, costUsd }` from `json.usage?.cost`; `json.usage` already carries `prompt_tokens`/`completion_tokens`/`total_tokens` under the `usage:{include:true}` flag. `relContext.ts:133` confirmed to destructure only `content` (bug). Static-model predict tasks confirmed in `tasks/submissionPredict.ts:179`, `tasteFingerprint.ts:108`, `voteProbe.ts:146` — all use `process.env.OPENROUTER_PREDICT_MODEL` at module load. Tier bug confirmed: `qualify.ts:52` thresholds expect per-million but `ai_models` stores per-token.
- Spec written to vault; coord-doc written. 2 file-disjoint lanes (backend / frontend); 7 tasks (a1–a6 + b1 + gate).
- Next: dispatch both lanes (Sonnet); hold for finish hooks; gate incl. owner UAT.
