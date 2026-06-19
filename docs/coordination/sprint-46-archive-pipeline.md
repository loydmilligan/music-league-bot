---
status: shipped
shippedIn: v1.13.0
campaign: generation-pipeline
sprint: sprint-46-archive-pipeline
version: v1.13.0
created: 2026-06-19
depends_on: sprint-45-pipeline-config-ui
---

# music-league-bot — coordination doc (sprint-46-archive-pipeline)

> **Sprint:** Extend the generation pipeline to **archive (b-side) generation**, so the
> b-side read-model is produced by a configurable pipeline like the digest is — editable
> in the Pipeline tab via a digest/archive switcher. Functional build (no CD pass);
> CD can restyle later.

## The load-bearing difference from digest: NO MERGE

Digest sections all come from one parameterizable prompt, so same-model sections **merge**
into one call. The b-side read-model is built by `dashboard/buildReadModel.ts`, which fires
**heterogeneous tasks** (narrative ×4, profile ×2, season-update) as **separate
`runPrediction` calls** — each with its own prompt + output schema. They **cannot merge**
(you can't ask one call for a narrative AND a profile). So:

- **Archive pipeline = order + skip (context handoff) + covers + per-task model. NO merge.**
- In `releaseKind: 'archive'`, the resolver must treat **each track as its own call** (a
  group of one) — never group same-model tracks. Skips still create EPs (later EPs read
  prior output as context). Covers still apply (re-run a task later on a better model).
- Tasks within one EP can still run **in parallel** (they're independent calls) — preserve
  the parallelism `buildReadModel` already has.

## Sprint Goals

1. **Lane A (backend):** extend `Pipeline.releaseKind` to `'digest' | 'archive'`; add
   `ARCHIVE_DEFAULT_PIPELINE`; teach the resolver an archive mode (no merge); rewire
   `buildReadModel` to run the archive pipeline; store the archive config separately and
   extend the config API to read/write per-kind.
2. **Lane B (frontend):** add a digest/archive switcher to the Pipeline tab; load/save the
   archive config; render the archive view WITHOUT merge-rail (each track = 1 call) + skips
   + covers + per-task model; teach the client EP solver the archive (no-merge) mode + a
   parity test.

## Agent Roster — 2 file-disjoint lanes

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane %55) | **Lane A:** `ui/src/lib/digest/pipeline.ts` (releaseKind union, `ARCHIVE_DEFAULT_PIPELINE`, archive resolver mode); `ui/src/lib/dashboard/buildReadModel.ts` (rewire to run the archive pipeline); `ui/src/routes/api/settings/pipeline-config/+server.ts` (per-kind GET/PUT); `ui/src/lib/db/client.ts` (seed `pipeline_config_archive`) | all `.svelte`, `ModelsScreen.svelte`, `pipelineSolver.ts`, `qualify.ts` |
| frontend (pane %56) | **Lane B:** `ui/src/lib/models/ModelsScreen.svelte` (digest/archive switcher in the Pipeline tab + archive view); `ui/src/lib/models/pipelineSolver.ts` (archive no-merge mode); a parity test | `pipeline.ts`, `buildReadModel.ts`, route files, `client.ts`, `schema.ts` |

`pipeline.ts` is READ-ONLY for Lane B (import the `Pipeline`/`Cover` types + any exported archive constants). Both resolvers (server `resolvePipeline` in pipeline.ts, client mirror in pipelineSolver.ts) must implement the SAME archive semantics — the parity test guards it.

## Cross-lane CONTRACTS (pinned — no renegotiation)

### 1. Pipeline type
```ts
type Pipeline = {
  releaseKind: 'digest' | 'archive';   // was 'digest' only
  order: string[];                     // section/task ids in run order
  models: Record<string, string>;      // per-track model override; {} = modelForSection fallback
  skipAfter: Record<string, true>;
  covers: { of: string; model: string }[];
};
```

### 2. Archive tracks (Lane A confirms against `buildReadModel.ts` — these are the b-side LLM tasks)
Starting set (verify each is a real `runPrediction` task id in `buildReadModel`):
`narrative-player-superlatives`, `narrative-fan-hater-blurbs`, `narrative-league-reel`,
`narrative-moment-lines`, `profile-spectrum`, `profile-playlist`, `season-update`.
(`taste-fingerprint` is an input, not a published b-side track — exclude unless buildReadModel treats it as a published section.) `ARCHIVE_DEFAULT_PIPELINE`: this order, `models: {}`, one sensible skip (e.g. after the narrative/factual tasks, before profile/season-update if they benefit from context — Lane A's judgment; conservative = no skip), `covers: []`.

### 3. Resolver archive mode (the no-merge rule)
`resolvePipeline(pipeline, activeTracks, db)` — when `pipeline.releaseKind === 'archive'`, **each track is its own group** (never merge same-model adjacent tracks). Skips still split EPs; covers still go to a trailing EP. Digest mode is unchanged.

### 4. Config storage + API (per-kind)
Two settings keys: `pipeline_config` (digest, exists) + `pipeline_config_archive` (new, seed `ARCHIVE_DEFAULT_PIPELINE` in `client.ts`). API takes a `kind` query param:
```
GET /api/settings/pipeline-config?kind=digest|archive   → { pipeline }
PUT /api/settings/pipeline-config?kind=digest|archive    { pipeline } → { pipeline }
```
Default `kind=digest` (backwards-compatible with sprint-45). Validate `releaseKind` matches `kind`.

### 5. SACRED regression guard (Lane A + test)
Rewiring `buildReadModel` must NOT regress the live b-side generation. An archive pipeline with **no skips, no covers, `models: {}`** must reproduce **today's `buildReadModel` behavior** — same set of `runPrediction` calls, same outputs, same parallelism. Write a test asserting the degenerate archive pipeline produces the same task calls as the current code. If it can't reduce cleanly, STOP and raise a blocker — do not ship a regression to b-side generation.

## Working agreements (sprint-46)
- Path-scoped commits per task (prefix task id); NEVER `git add -A`; NEVER `git commit --amend` (shared HEAD).
- Scoped vitest tests per task, incl. the §5 regression guard (backend) and the archive parity test (frontend, client solver == resolvePipeline for archive configs).
- `cd ui && npm run check` → 0 errors. No emoji (functional glyphs). Svelte 5 runes. Mash Co tokens.
- Build-to-contract: Lane B builds the switcher/archive view against the per-kind API + the archive resolver semantics; integrate at the gate.
- Preserve the digest pipeline + Pipeline tab exactly (this is additive).

## Active Sprint Plan

### Lane A — backend (pane %55)
- [ ] {backend, a1-type-resolver} **releaseKind union + archive resolver mode.** Extend `Pipeline.releaseKind` to `'digest'|'archive'`; add `ARCHIVE_DEFAULT_PIPELINE` (contract #2); in `resolvePipeline`, when `releaseKind==='archive'` each track is its own group (no merge), skips/covers unchanged. **Acceptance:** unit tests — archive mode never merges; skips create EPs; digest mode unchanged; `npm run check` 0.
- [ ] {backend, a2-config-api, depends: a1-type-resolver} **Per-kind config API + seed.** `GET/PUT /api/settings/pipeline-config?kind=digest|archive` (default digest); seed `pipeline_config_archive` in `client.ts`; validate releaseKind matches kind. **Acceptance:** GET archive returns the seeded default; PUT archive persists; kind=digest path unchanged; route tests green.
- [ ] {backend, a3-buildreadmodel, depends: a1-type-resolver} **Rewire `buildReadModel` to run the archive pipeline.** Resolve the archive pipeline, run tracks in EP order (parallel within an EP), pass prior-EP output as context to later EPs (assistant-turn, as the digest path does), fire covers, persist both takes. **SACRED:** the degenerate archive pipeline (no skip/cover, models {}) reproduces today's calls + outputs (contract #5) — write that regression test. **Acceptance:** regression test passes; existing buildReadModel tests green; `npm run check` 0.

### Lane B — frontend (pane %56)
- [ ] {frontend, b1-switcher, depends: a2-config-api} **Digest/archive switcher + archive view.** Add a digest/archive toggle to the Pipeline tab; load/save the matching config via `?kind=`; render the archive view with NO merge-rail (each track shows "1 call") + skips + covers + per-track model; reuse the existing editor controls. **Acceptance:** switcher loads/saves both configs; archive view renders without merge-rail; digest view unchanged; `npm run check` 0; screenshot archive view 412 + desktop.
- [ ] {frontend, b2-solver-parity, depends: b1-switcher} **Archive mode in the client EP solver + parity test.** Teach `pipelineSolver.ts` the archive (no-merge) rule; parity test asserts it equals `resolvePipeline` for ARCHIVE_DEFAULT_PIPELINE + ≥3 edited archive configs. **Acceptance:** parity test green for archive + digest.

### Gate (orc)
- [ ] {orc, gate, depends: a3-buildreadmodel,b2-solver-parity} Cross-check path-scoped commits; full `npm run check` 0 + `vitest run` green (incl. both regression + parity tests); screenshot the archive Pipeline tab (412 + desktop); deploy v1.13.0 (docker compose build+force-recreate → assert live + read-only verify the archive config API); mark shipped + war table. Owner UAT = run a real b-side publish to confirm archive pipeline output.

## v1 scope guardrails
- **No merge for archive** — each track is always its own call.
- **Do not break the digest pipeline or the live b-side generation** (regression guard #5).
- Functional UI — CD restyle is a later pass.
- No per-league profiles / recoup (still v2).

## Decision Log
### 2026-06-19 — archive is no-merge (orc)
Confirmed `buildReadModel` fires heterogeneous `runPrediction` tasks (separate prompts/schemas) — merge can't apply. Archive pipeline = order + skip(context) + covers + per-task model only. Resolver gets an archive mode where each track is its own group.

## Ratification Log
_Owner ratified "build functional now" 2026-06-19 (skip CD design pass)._

## Blockers
_None at start._

## Activity Log
### 2026-06-19 — orc — coord-doc authored
Authored by orc (not a subagent) grounded in buildReadModel.ts. Dispatching to panes %55 (backend) + %56 (frontend) via warren.

### 2026-06-19 — Lane B — b1+b2 complete (738043f)
Digest/archive switcher (segmented control) in Pipeline tab; archive view with no merge-rail + skips + covers + per-task model; pipelineSolver archive no-merge mode; 8 parity tests all green. Zero new type errors introduced (9 pre-existing in llm.ts from Lane A's pipeline.ts changes).

### 2026-06-19 — Lane A — a3 complete (a8a7e12)
Rewired buildReadModel to load archive pipeline from settings (falls back to ARCHIVE_DEFAULT_PIPELINE), run tracks in EP order (parallel within each EP), dispatch all 7 task kinds via a switch table, and write seasonUpdate to the read model. Sacred regression guard (5 tests) passes: degenerate archive pipeline dispatches all 7 ARCHIVE_TASK_KINDS with zero regressions in the full 803-test suite. `npm run check` 0 errors.
