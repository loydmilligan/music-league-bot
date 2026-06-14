---
project: music-league-bot
sprint: sprint-29
title: Submission Predictor — Producer Sprint 2
status: active
created: 2026-06-13T21:45:00Z
activated: 2026-06-13
updated: 2026-06-13T22:00:00Z
---

# music-league-bot — coordination doc (sprint-29)

> **Producer Sprint 2 — the mirror of the Vote Probe.** Vote Probe answered "how
> would player X react to song Y?"; this answers "what would player X submit for
> theme Z?" It's a new `PredictionTask` on the sprint-28 harness (new template +
> schemas), so the sprint is lean — one task + a validator + an endpoint + a
> panel. Output is owner's three-part shape: a predicted property profile → a
> ranked candidate list with rationale → a final specific pick with detail and
> ties to the player's real past submissions. Candidates are Spotify-validated so
> they're real and pipe-able. Full design contract:
> `docs/superpowers/specs/2026-06-13-submission-predictor-sprint2-design.md`.
> Origin: owner brainstorm 2026-06-13.

## Sprint Goals

- Predict what a player would submit for a theme
  Property profile, ranked candidates, and a final pick tied to their history.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | DB + migrations, `$lib/db/*` + `$lib/predict/*` services, `/api/*` routes, LLM harness, Spotify search reuse | Svelte components, page routes |
| frontend | Svelte components + routes, hands-on UI verification | DB schema, services, API route internals |
| orc | sprint gate: cross-checks, version + CHANGELOG, ratification card, prod deploy, context resets | project code (orc manages; project agents work) |

## Working agreements (sprint-29)

- The spec (`docs/superpowers/specs/2026-06-13-submission-predictor-sprint2-design.md`)
  is the map: every task names its spec section; consult it before touching code.
- Reuse, don't rebuild: the sprint-28 prediction harness (`$lib/predict` — `PredictionTask`,
  `runPrediction`, `buildPlayerContext`, `prediction_runs`) and the existing `callOpenRouter`
  (`$lib/digest/llm.ts`). Reuse the app's existing **Spotify search** for candidate validation —
  do NOT add a new LLM client or a new Spotify auth path.
- Hands-on means hands-on: UI claims require driving the real dev UI (`npm run dev`, port
  5173 — NEVER 4444) at desktop and 412×892, noting what was clicked. LLM-task tests stub
  `callOpenRouter` (no real spend); one cost-bounded live smoke is enough to prove real output parses.
- Mid-wave context discipline: past ~60-70% context, write a handoff entry and request a reset from orc.
- No prod deploy except by orc at the gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: submission-task} **`submission-predict` task + run function** (spec §3, §5). New `ui/src/lib/predict/tasks/submissionPredict.ts`: define the `submission-predict` PredictionTask on the existing harness contract — input = `PlayerContext` (from `playerContext.ts`) + `{ theme:{name,description} }`; output zod = the three-part shape: `profile{genres[], artists_or_types[], era, mood_energy, obscurity_lean, comment_likely, rationale}`, `candidates[]{title, artist, why}` (4–6, ranked best-first), `prediction{title, artist, spotify_url?, detail, similar_past_picks[]{title, artist, round, similarity}, confidence:'low'|'medium'|'high'}`. Export `runSubmissionPredict(db, playerId, {theme})` that builds context, runs via `runPrediction`, and logs a `prediction_runs` row (`task_id='submission-predict'`, `round_id` when the theme is a real round). Default model = the capable model (Sonnet) via task config. Returns RAW candidates — Spotify validation is applied downstream by `api-submission`.
  - **Acceptance:** with `callOpenRouter` stubbed to fixture JSON, `runSubmissionPredict` returns the schema-valid three-part output and writes a `prediction_runs` row; output zod enforces the candidate count (4–6) and required fields on all three parts; `npm run check` 0 errors; `npx vitest run` green.

- [-] {agent: backend, id: spotify-validate} **Spotify candidate validator** (spec §4, option A). New helper `ui/src/lib/predict/spotifyValidate.ts`: `validateTracks(candidates: {title, artist}[]) → {title, artist, spotify_url?, resolved: boolean}[]` (carry through the canonical title/artist/uri/art on a match). Resolve each via the app's EXISTING Spotify search — find and reuse whatever powers the `/api/history` song search / the `spotify-oauth` token flow; do NOT add a new auth path. Order-preserving; `resolved:false` (never throw) when no match. This validates `candidates` + `prediction` before the API responds.
  - **Acceptance:** with the Spotify search stubbed, a known title/artist resolves to a track and a nonsense one returns `resolved:false`; output order matches input; no-match never throws; `npm run check` 0 errors; vitest covers both the resolved and unresolved paths.

- [ ] {agent: backend, id: api-submission, depends: submission-task,spotify-validate} **Submission-predict endpoint** (spec §6). `POST /api/players/:playerId/submission-predict`, body `{ theme }` → runs `runSubmissionPredict`, then applies `validateTracks` to the `candidates` and the `prediction` (Spotify-validate, option A), and returns the enriched three-part result. Follow the existing `/api/players/:playerId/*` route pattern.
  - **Acceptance:** `POST` with a valid body returns 200 with the three-part result — `candidates`/`prediction` carrying resolved Spotify handles where found — and creates a `prediction_runs` row; a malformed body → 400; a route test (house vitest pattern) covers it; `npm run check` 0 errors.

- [ ] {agent: frontend, id: ui-submission, depends: api-submission} **Submission Predictor panel** (spec §6). Add a collapsible **Submission Predictor** subsection to the per-player panel in `ui/src/lib/components/PlayerResearchTab.svelte`, mirroring the Vote Probe panel: a theme picker (real-themes dropdown via `/api/history/themes` + freeform) → **Predict** → renders (a) the property profile as chips/labels, (b) the ranked candidate list each with its `why`, and (c) the highlighted final pick with `detail`, the "similar to your past picks" links, and confidence. Match the Mash Co. tokens + the sibling panel styles.
  - **Acceptance:** selecting a player + theme + clicking Predict renders all three parts (profile chips; candidate list with rationales; final pick with similar-past-picks links + confidence); the theme dropdown lists real themes and freeform works; verified hands-on on dev (5173) at desktop AND 412×892 with the clicks noted in the Activity Log; `npm run check` 0 errors.

- [ ] {agent: orc, id: gate-close, depends: ui-submission} **Gate — cross-check, ship, close.** Orc runs the gate: cross-check both lanes' acceptance, independent `npm run check` + `npx vitest run`, version bump + CHANGELOG, ratification card summarizing the submission predictor, one cached prod deploy, a 412×892 prod smoke (run a submission prediction for a real player + theme → the three-part result returns with Spotify-resolved picks), panes reset, doc closed.
  - **Acceptance:** all worker tasks `[x]`; 0 typecheck errors + vitest green; v-bump + CHANGELOG committed; ratification card emitted + ratified; prod smoke passes (submission prediction returns the three-part result) with 0 console errors; doc `status: closed`.

## Decision Log

### 2026-06-13 — Sprint scope = Producer Sprint 2, submission predictor (owner brainstorm)
Mirror of the sprint-1 Vote Probe. Owner-specified three-part output (profile → ranked
candidates w/ rationale → final pick w/ detail + similar past picks). Candidates
Spotify-validated (spec §4 option A) so they're real and pipe-able into the SAS tools.
New task on the existing harness — no new plumbing. The "predict how the pick will fare"
follow-on (pipe the prediction into the Vote Probe/H2H) is a separate backlog item.

## Ratification Log

_(gate card lands here when it resolves)_

## Blockers

_None._

## Activity Log

### 2026-06-13 — backend — submission-task DONE · 787b154
- Created `ui/src/lib/predict/tasks/submissionPredict.ts`: `submission-predict` PredictionTask on harness contract
- Three-part output zod: profile (7 fields) → candidates (4–6, ranked) → prediction (title/artist/spotify_url?/detail/similar_past_picks/confidence)
- `runSubmissionPredict(db, playerId, {theme, roundId?})` builds context via `buildPlayerContext`, runs via `runPrediction`, returns raw candidates (Spotify validation downstream)
- Default model: `anthropic/claude-sonnet-4-5` (env-overridable via OPENROUTER_PREDICT_MODEL)
- 21 vitest tests green; `npm run check` 0 errors
- Strictly within `ui/src/lib/predict/tasks/submissionPredict.ts` + test — no collision with spotify-validate lane

### 2026-06-13 — orc — Sprint-29 ACTIVATED · submission-task + spotify-validate dispatched (Wave 1)
- status planned → active; dispatched both independent backend tasks in parallel —
  submission-task to backend (%55), spotify-validate to the frontend pane temp-flipped to a
  2nd backend lane (%56). File-disjoint. Both marked `[-]`.
- api-submission opens when both land; then ui-submission; then gate.

### 2026-06-13 — docs — Sprint plan authored: Producer Sprint 2 (submission predictor)
- created sprint-29 coord-doc; `## Active Sprint Plan` body has 5 tasks
- 3 backend (submission-predict task, Spotify validator, endpoint) / 1 frontend (panel) / 1 orc gate
- deps: api-submission ← submission-task + spotify-validate; ui-submission ← api-submission; gate ← ui-submission
- lean sprint — reuses the sprint-28 harness; source spec `docs/superpowers/specs/2026-06-13-submission-predictor-sprint2-design.md`
- status `planned` — kickoff (first dispatch) is confirmation-gated; awaiting owner "go"
