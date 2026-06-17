---
status: planned
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

Ship `llm_cost_log` — a durable, append-only record of every OpenRouter call: model used, prompt/completion/total tokens, USD cost, category (`digest`/`archive`/`predict`), and a fine-grained label. Instrument all five active LLM call sites to write rows. Fix a bundled bug in `proposeRelContextUpdate` (drops cost, ignores DB model). Declare and implement the three read-API endpoints that sprint-40 will depend on. Fix the cost-tier display bug in the Models & AI roster so `$`/`$$`/`$$$` reflect actual pricing.

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
  league_id        INTEGER,
  round_id         INTEGER
)
```
No foreign-key constraints. Append-only; no deletes.

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
};
// opts.meta absent → no-op (zero behaviour change for un-migrated callers)
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

- [ ] {agent: backend, id: a1-schema} **`llm_cost_log` table.** Append `CREATE TABLE IF NOT EXISTS llm_cost_log (…)` to the `SCHEMA` const in `ui/src/lib/db/schema.ts` per the pinned contract. **Acceptance:** table auto-applies on boot (like `ai_models`); idempotent; schema test green.

- [ ] {agent: backend, id: a2-llmresult, depends: a1-schema} **Extend `LLMResult` + `callOpenRouter`.** Add `promptTokens`/`completionTokens`/`totalTokens`/`latencyMs` to `LLMResult`; read tokens from `json.usage.prompt_tokens`/`completion_tokens`/`total_tokens`; capture `latencyMs` by timing the fetch (`Date.now()` around the request). Add `LLMCallMeta` type and optional `meta` arg to `callOpenRouter`; implement `logLlmCall` (try/catch INSERT into `llm_cost_log`, including `latency_ms`). When `meta` is absent the function is a no-op extension. **Acceptance:** `llm.test.ts` + new unit test for `logLlmCall` (asserts latency_ms persisted); `meta`-absent path unchanged; `npm run check` 0 errors.

- [ ] {agent: backend, id: a3-digest-sites, depends: a2-llmresult} **Thread `meta` through digest call sites.** In `llm.ts`: thread `meta` through `generateDraft()` (`category: 'digest'`, `label: 'digest:full'`, leagueId + roundId from args) and `regenerateOneSection()` (`category: 'digest'`, `label: 'digest:<kind>'`, roundId from args; derive leagueId from round). **Acceptance:** each function writes a `llm_cost_log` row on a real or mock callOpenRouter call; existing digest tests still green.

- [ ] {agent: backend, id: a4-relctx-fix, depends: a2-llmresult} **`proposeRelContextUpdate` bug fix + ledger hook.** Add `db: Database.Database` param; change hard-coded env model to `modelFor('digest', db)`; destructure full `LLMResult`; pass `meta: { category: 'archive', label: 'archive:rel-context', db, leagueId, roundId }` to the call. **Acceptance:** function uses DB-resolved model; writes a `llm_cost_log` row; existing relContext tests green; `npm run check` 0 errors.

- [ ] {agent: backend, id: a5-predict-sites, depends: a2-llmresult} **Thread `meta` through `runPrediction`.** Add optional `category?: 'archive' | 'predict'` to `runPrediction` opts (default `'predict'`). Pass `meta: { category, label: \`${category}:${task.id}\`, db, leagueId: undefined, roundId: opts.roundId }` to each `callOpenRouter` call inside `runPrediction` (including the retry path). Update all `runPrediction` call sites that run archive tasks (`narrative-*`, `profile-*`, `season-update`) to pass `category: 'archive'`; predict tasks (`submission-predict`, `vote-probe`, `taste-fingerprint`) default to `'predict'` and require no change at their call sites. **Acceptance:** `predict.test.ts` + new test asserting ledger rows; category correct per task type; `npm run check` 0 errors.

- [ ] {agent: backend, id: a6-cost-api, depends: a1-schema} **Cost read API.** New route family `ui/src/routes/api/cost/`: `GET summary`, `GET daily` (zero-fill gaps), `GET calls`. Match the pinned response shapes. **Acceptance:** route tests (vitest) cover: today summary with rows; daily with gap day returning zero; calls paginates at 500; date param parses correctly; missing date defaults to today.

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

## Ratification Log

_None yet._

## Blockers

_None._

## Activity Log

### 2026-06-17 — orc — sprint-39-cost-ledger planned
- Campaign context from spike + sprint-38 handoff ingested.
- Codebase verified: `callOpenRouter` in `llm.ts:264` returns `{ content, costUsd }` from `json.usage?.cost`; `json.usage` already carries `prompt_tokens`/`completion_tokens`/`total_tokens` under the `usage:{include:true}` flag. `relContext.ts:133` confirmed to destructure only `content` (bug). Static-model predict tasks confirmed in `tasks/submissionPredict.ts:179`, `tasteFingerprint.ts:108`, `voteProbe.ts:146` — all use `process.env.OPENROUTER_PREDICT_MODEL` at module load. Tier bug confirmed: `qualify.ts:52` thresholds expect per-million but `ai_models` stores per-token.
- Spec written to vault; coord-doc written. 2 file-disjoint lanes (backend / frontend); 7 tasks (a1–a6 + b1 + gate).
- Next: dispatch both lanes (Sonnet); hold for finish hooks; gate incl. owner UAT.
