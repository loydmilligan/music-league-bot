---
project: music-league-bot
sprint: sprint-28
title: Player Prediction Tools — Sprint 1 (Dossier + Harness + SAS)
status: active
created: 2026-06-13T04:20:00Z
activated: 2026-06-13
updated: 2026-06-13T04:30:00Z
---

# music-league-bot — coordination doc (sprint-28)

> **The first Producer sprint.** Builds the on-ramp to the "Music League
> Producer" prediction engine: a per-player dossier, a reusable prediction
> harness over the existing `callOpenRouter`, and the first two harness tasks —
> an AI taste-fingerprint and a vote-probe that yields a **Standalone Affinity
> Score (SAS)**. Harness-first (Approach A): the substrate is built once so
> Sprint 2 ("what would they submit?") and Sprint 3 (vote backtest) are new task
> definitions, not new plumbing. Full design contract:
> `docs/superpowers/specs/2026-06-13-player-prediction-sprint1-design.md`.
> Origin: owner brainstorm 2026-06-13.

## Sprint Goals

- Turn player history into a taste predictor
  Dossier + AI fingerprint per player; score any song's standalone affinity.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | DB schema + migrations, `$lib/db/*` + `$lib/predict/*` services, `/api/*` routes, LLM harness | Svelte components, page routes |
| frontend | Svelte components + routes, hands-on UI verification | DB schema, services, API route internals |
| orc | sprint gate: cross-checks, version + CHANGELOG, ratification card, prod deploy, context resets | project code (orc manages; project agents work) |

## Working agreements (sprint-28)

- The spec (`docs/superpowers/specs/2026-06-13-player-prediction-sprint1-design.md`)
  is the map: every task names its spec section; consult it before touching code.
- Reuse the existing LLM client `callOpenRouter` (`ui/src/lib/digest/llm.ts`) —
  OpenRouter, JSON mode, per-call cost. Do NOT add a second LLM client.
- Manual/auto separation is sacred (sprint-27 FB-1 lesson): regenerating an AI
  fingerprint must NEVER overwrite the owner's dossier notes/tags.
- Hands-on means hands-on: UI claims require driving the real dev UI
  (`npm run dev`, port 5173 — NEVER 4444) at desktop and 412×892, and noting
  what was clicked. LLM-task tests stub `callOpenRouter` (no real spend);
  one cost-bounded live smoke per task is enough to prove real output parses.
- Mid-wave context discipline: past ~60-70% context, write a handoff entry and
  request a reset from orc.
- No prod deploy except by orc at the gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: dossier-schema} **Two new tables via idempotent boot migrations** (spec §5). In `ui/src/lib/db/client.ts` (house migration pattern), create `player_profiles` (1:1 with players: `player_id` PK → `players(id)`, `notes TEXT`, `tags TEXT NOT NULL DEFAULT '[]'`, `taste_fingerprint TEXT`, `fingerprint_model TEXT`, `fingerprint_cost_usd REAL`, `fingerprint_generated_at TEXT`, `updated_at TEXT`) and `prediction_runs` (`id` PK uuid, `task_id TEXT`, `player_id INTEGER`, `round_id INTEGER` NULL, `input_json TEXT`, `output_json TEXT`, `model TEXT`, `cost_usd REAL`, `latency_ms INTEGER`, `created_at TEXT`, `actual_json TEXT` NULL, `score_json TEXT` NULL — last two reserved for Sprint 3).
  - **Acceptance:** a fresh DB boot creates both tables; re-running boot is a no-op (idempotent guard); `PRAGMA table_info` shows every column above; a vitest confirms boot + both schemas; `npm run check` 0 errors.

- [x] {agent: backend, id: context-pack, depends: dossier-schema} **Player Context Pack builder** (spec §4.1). New `ui/src/lib/predict/playerContext.ts` — `buildPlayerContext(db, playerId, opts) → PlayerContext`: assembles the player's dossier (notes/tags) + a token-bounded history slice (their submissions w/ comments+points, votes they cast w/ points, taste overlap), keyed on stable `player_id`, reusing `playerHistory.ts`/`seasonData.ts` queries. One documented exported shape.
  - **Acceptance:** `buildPlayerContext` returns the documented `PlayerContext` shape; history is bounded (caps rows/tokens, not the entire corpus); vitest covers a player with dossier+history and one with neither; `npm run check` 0 errors.

- [x] {agent: backend, id: harness-runner, depends: dossier-schema} **Prediction harness — contract + runner** (spec §4.2–4.4). New `ui/src/lib/predict/predict.ts`: the `PredictionTask<TIn,TOut>` type (`id`, zod `inputSchema`, `buildMessages`, `model`, `params`, zod `outputSchema`, optional `scorer`) and `runPrediction(task, input) → { output, meta }` — validates input, renders the template, calls `callOpenRouter` in JSON mode with the task's `model`/`params`, validates output against `outputSchema` (one retry on schema miss), captures `{ model, costUsd, latencyMs }`, and writes one `prediction_runs` row. Reuse `callOpenRouter`; add no new LLM client.
  - **Acceptance:** with `callOpenRouter` stubbed to fixture JSON, `runPrediction` validates I/O and inserts one `prediction_runs` row carrying model+cost+latency; the malformed-output retry path is covered; `npm run check` 0 errors; `npx vitest run` green.

- [x] {agent: backend, id: task-fingerprint, depends: context-pack,harness-runner} **Task ③ `taste-fingerprint` + persistence** (spec §6.1). New `ui/src/lib/predict/tasks/tasteFingerprint.ts`: the PredictionTask (input = PlayerContext; output zod = `{ signature_artists[], genres[], eras[], rewards[], punishes[], summary, confidence: 'low'|'medium'|'high' }`) plus `generateFingerprint(db, playerId)` that runs it and persists the result + provenance (`fingerprint_model`/`_cost_usd`/`_generated_at`) to `player_profiles` — writing ONLY those columns, never `notes`/`tags`.
  - **Acceptance:** with stubbed `callOpenRouter`, `generateFingerprint` persists a schema-valid fingerprint + provenance; a vitest proves regenerating leaves pre-existing `notes`/`tags` byte-identical (manual/auto separation invariant); output zod rejects a malformed shape; `npm run check` 0 errors.

- [x] {agent: backend, id: task-vote-probe, depends: context-pack,harness-runner} **Task ② `vote-probe` / SAS** (spec §3, §6.2). New `ui/src/lib/predict/tasks/voteProbe.ts`: the PredictionTask (input = PlayerContext + `{ song:{title,artist,spotify_url?}, theme:{name,description} }`; output zod = `{ upvote_likelihood: 0..100, expected_points, confidence, reasoning, signals[] }`) plus `runVoteProbe(db, playerId, { song, theme })` that runs it and logs a `prediction_runs` row (`task_id='vote-probe'`, `round_id` set when the theme is a real round). `upvote_likelihood` IS the SAS — a standalone affinity lean, not a round allocation.
  - **Acceptance:** with stubbed `callOpenRouter`, `runVoteProbe` returns a schema-valid SAS result and writes a `prediction_runs` row; `reasoning` is non-empty; output zod enforces the 0–100 bound on `upvote_likelihood`; `npm run check` 0 errors; `npx vitest run` green.

- [x] {agent: backend, id: api-dossier, depends: dossier-schema} **Dossier CRUD endpoints** (spec §7). Following the existing `/api/players/:playerId` route pattern: `GET /api/players/:playerId/profile` (read dossier; return an empty default if none yet) and `PATCH /api/players/:playerId/profile` (persist `notes` + `tags` only, bump `updated_at`).
  - **Acceptance:** `GET` returns 200 with the profile shape; `PATCH {notes, tags}` persists and a follow-up `GET` reflects it; `PATCH` leaves `taste_fingerprint` untouched; a route test (house vitest pattern) covers both; `npm run check` 0 errors.

- [x] {agent: backend, id: api-predict, depends: task-fingerprint,task-vote-probe} **Prediction endpoints** (spec §7). `POST /api/players/:playerId/fingerprint` → runs `generateFingerprint`, returns the stored fingerprint. `POST /api/players/:playerId/vote-probe` (body `{ song, theme }`) → runs `runVoteProbe`, returns the SAS result.
  - **Acceptance:** `POST .../fingerprint` returns 200 with the structured fingerprint and persists it; `POST .../vote-probe` with a valid body returns the SAS result and creates a `prediction_runs` row; a malformed body → 400; route tests green; `npm run check` 0 errors.

- [x] {agent: frontend, id: ui-dossier, depends: api-dossier} **Dossier editor on the Player Research tab** (spec §8). Extend the per-player panel in `ui/src/lib/components/PlayerResearchTab.svelte` with a collapsible **Dossier** subsection: a notes textarea + a tags editor, loaded via `GET /api/players/:id/profile` and saved via `PATCH`. Follow the existing Mash Co. tokens/patterns already in the tab.
  - **Acceptance:** selecting a player renders the Dossier subsection; editing notes/tags + Save persists (reload shows saved values); verified hands-on on dev (5173) at desktop and 412×892 with the clicks noted in the Activity Log; `npm run check` 0 errors.

- [x] {agent: frontend, id: ui-fingerprint, depends: api-predict} **Taste Fingerprint panel** (spec §8). Add a collapsible **Taste Fingerprint** subsection to the per-player panel: a Generate/Regenerate button calling `POST /api/players/:id/fingerprint`, rendering signature-artist/genre chips, rewards/punishes lists, the summary, and a model + cost + date provenance stamp.
  - **Acceptance:** Generate calls the endpoint and renders the structured fingerprint with provenance; Regenerate updates it without clearing the Dossier notes; verified hands-on on dev at desktop and 412×892 (noted in Activity Log); `npm run check` 0 errors.

- [ ] {agent: frontend, id: ui-probe, depends: api-predict} **Vote Probe panel** (spec §8). Add a collapsible **Vote Probe** subsection: a form (song title/artist + optional Spotify URL; theme = a dropdown of real past themes OR freeform) that calls `POST /api/players/:id/vote-probe` and renders the SAS likelihood gauge + expected points + reasoning + signal bullets.
  - **Acceptance:** submitting a song + theme renders a SAS result (gauge + expected points + reasoning + signals); the theme dropdown lists real themes and freeform also works; verified hands-on on dev at desktop and 412×892 (noted in Activity Log); `npm run check` 0 errors.

- [ ] {agent: orc, id: gate-close, depends: ui-dossier,ui-fingerprint,ui-probe} **Gate — cross-check, ship, close.** Orc runs the gate: cross-check both lanes' acceptance, version bump + CHANGELOG, ratification card summarizing the dossier + harness + fingerprint + SAS, one cached prod deploy, a 412×892 prod smoke (write a dossier note → persists; run one fingerprint and one vote-probe → both return), panes reset, doc closed.
  - **Acceptance:** all worker tasks `[x]`; v-bump + CHANGELOG committed; ratification card emitted + ratified; prod smoke passes (dossier persists, fingerprint + probe return) with 0 console errors; doc `status: closed`.

## Decision Log

### 2026-06-13 — Sprint scope = Producer Sprint 1, harness-first (owner brainstorm)
Owner brainstormed the "Music League Producer" milestone and sequenced it: Sprint 1
(this) = dossier + harness + taste-fingerprint + vote-probe/SAS; Sprint 2 = "what would
they submit?"; Sprint 3 = vote backtest. Chose **Approach A (harness-first)** so the
reusable `PredictionTask` substrate is built once. SAS is the standalone-affinity
primitive the future whole-round predictor will consume. Full contract in the spec.

## Ratification Log

_(gate card lands here when it resolves)_

## Blockers

_None._

## Activity Log

### 2026-06-13 — frontend — ui-fingerprint COMPLETE (commit ac300ec)
- extended `ui/src/lib/components/PlayerResearchTab.svelte` — no other files touched
- added `FingerprintOutput` + `FingerprintResult` types to `<script module>`
- new fingerprint state vars: `fingerprintOpen`, `fingerprintLoading`, `fingerprintError`, `fingerprintData`, `fingerprintProvenance`
- `selectPlayer`: resets fingerprint state on every player change/deselect; populates `fingerprintData` + `fingerprintProvenance` from `dossier.taste_fingerprint` when dossier loads (existing stored fingerprint shows immediately)
- `generateFingerprint()`: POSTs to `/api/players/:id/fingerprint`; on success updates `fingerprintData` + `fingerprintProvenance`; on error shows inline error message; never touches draftNotes/draftTags
- Taste Fingerprint subsection: collapsible toggle (aria-expanded), Generate/Regenerate button label driven by `fingerprintData` presence, signature-artist chips (accent/10), genre + era chips (border-muted), rewards/punishes two-column list with ↑/↓ icons, summary paragraph, provenance stamp (model · $cost · date + confidence badge)
- `npm run check`: 0 errors (761 files; 39 warnings, all pre-existing)
- Verified hands-on at desktop (1280×800) and mobile (412×892) via Puppeteer:
  - navigated History → clicked "◑ Player research" tab
  - clicked Matt Mariani → Taste Fingerprint section appeared below Dossier (aria-expanded="true")
  - Generate button rendered; clicked → called `/api/players/:id/fingerprint`; error message rendered inline (expected — no OpenRouter API key in dev)
  - Dossier notes and tags unchanged after Generate click (manual/auto separation confirmed)
  - 0 console errors at both viewports (500 from API is server-side, not a JS error)

### 2026-06-13 — frontend — ui-dossier COMPLETE (commit 6318fea)
- extended `ui/src/lib/components/PlayerResearchTab.svelte` — no other files touched
- on mount, co-fetches `/api/players` alongside `/api/history/players` to build a
  `Map<name, player_id>` (only players in the `players` table get a dossier section)
- `selectPlayer` now parallel-fetches history detail + `/api/players/:id/profile`; seeds
  `draftNotes` / `draftTags` from the profile; deselect clears dossier state
- `saveDossier` PATCHes `/api/players/:id/profile`; "Saved ✓" flash 2 s + last-saved
  date stamp on success; inline error surface on failure
- Dossier subsection: collapsible toggle (aria-expanded), notes `<textarea>`, comma-
  separated tags `<input>` with saved-tag chip row, Save button — all Mash Co. tokens
- `DossierProfile` type added to `<script module>`; 0 new TS errors
- `npm run check`: 0 errors (755→761 files; 39 warnings, all pre-existing)
- Verified hands-on at desktop (1280×800) and mobile (412×892) via Puppeteer:
  - navigated History → clicked "◑ Player research" tab
  - clicked Matt Mariani → Dossier section appeared (aria-expanded="true")
  - notes textarea + tags input rendered (correct placeholders)
  - typed note + "indie, 80s" in tags → clicked Save → "Saved ✓" + last saved date
  - reloaded page → re-selected player → notes and tags persisted correctly
  - clicked Dossier toggle → form hidden; clicked again → re-expanded
  - 0 console errors at both viewports

### 2026-06-13 — backend — task-fingerprint COMPLETE (commit 0470f08)
- new `ui/src/lib/predict/tasks/tasteFingerprint.ts`
- `FingerprintOutputSchema` (zod): signature_artists[], genres[], eras[], rewards[], punishes[], summary, confidence enum
- `tasteFingerprintTask`: PredictionTask<PlayerContext, FingerprintOutput> with calibrated confidence guidance in system prompt
- `generateFingerprint(db, playerId)`: builds PlayerContext → runPrediction → INSERT OR IGNORE + targeted UPDATE of AI-only columns
- manual/auto separation: UPDATE touches ONLY taste_fingerprint + fingerprint_model/cost_usd/generated_at/updated_at; notes/tags never referenced
- 15 vitest assertions: happy path, profile row creation, JSON persistence, provenance, prediction_runs row, byte-identical notes/tags after 3 regenerations, fingerprint updated on regen, schema rejection (missing fields, bad confidence, non-array, non-string array items), empty-player edge case
- `npm run check`: 0 errors; 259 tests pass; task `[x]` ticked
- unlocks: api-predict (once task-vote-probe also lands)

### 2026-06-13 — backend — api-dossier COMPLETE (commit f2a009b)
- new `ui/src/routes/api/players/[playerId]/profile/+server.ts`: GET + PATCH handlers
- GET: reads player_profiles; returns empty-default shape when no row exists (notes null,
  tags [], taste_fingerprint null); 404 for unknown player
- PATCH: INSERT OR IGNORE + targeted UPDATE — taste_fingerprint structurally unreachable;
  bumps updated_at; creates row on first write; returns updated profile
- 13 vitest assertions (house pattern): empty-default GET, persisted-row GET, follow-up
  GET reflects PATCH, taste_fingerprint untouched, partial-field updates, null notes,
  404/400 guards; `npm run check`: 0 errors
- task `[x]` ticked; ui-dossier (frontend) is now unblocked

### 2026-06-13 — backend — harness-runner COMPLETE (commit 6ee7e8c)
- new `ui/src/lib/predict/predict.ts`: `PredictionTask<TIn,TOut>` type + `runPrediction(db, task, input, opts?)`
- `PredictionTask`: id, zod inputSchema, buildMessages, model, params, zod outputSchema, optional scorer
- `runPrediction`: validates input (zod), renders template via buildMessages, calls callOpenRouter in JSON mode, validates output (one retry on schema miss), captures model/costUsd/latencyMs, writes one prediction_runs row
- retry path: on outputSchema miss, re-calls with corrected prompt; accumulates cost across both calls
- zod v4.4.3 added as dependency; callOpenRouter reused unchanged from llm.ts
- 10 vitest assertions: happy path, DB row shape, UUID id, null player/round, input rejection, retry success, cost accumulation, double-fail throws, non-JSON throw, one-row guarantee
- `npm run check`: 0 errors; 231 tests pass; task `[x]` ticked
- unlocks: task-fingerprint + task-vote-probe (both already unblocked by context-pack)

### 2026-06-13 — backend — context-pack COMPLETE (commit c79017f)
- new `ui/src/lib/predict/playerContext.ts`: `PlayerContext` type + `buildPlayerContext(db, playerId, opts)`
- dossier: notes/tags/tasteFingerprint from player_profiles; manual and AI fields explicitly separated
- submissions via `getPlayer()` reuse (reversed to most-recent-first, capped); votes cast via direct SQL
  (competitorIds→votes join, only points>0, most-recent-first); tasteOverlap sorted + capped
- row caps: maxSubmissions=40, maxVotes=60, maxTasteOverlapEntries=10; boundingApplied flag on trim
- 7 vitest assertions: full dossier+history, empty player, sub bounding, vote bounding, unknown id,
  malformed tags, zero-point vote exclusion; `npm run check`: 0 errors
- task `[x]` ticked; unlocks task-fingerprint + task-vote-probe (once harness-runner also lands)

### 2026-06-13 — backend — dossier-schema COMPLETE (commit 1b8321b)
- added `player_profiles` + `prediction_runs` boot migrations to `ui/src/lib/db/client.ts`
- idempotent: guarded by `tableNames` check (computed once at boot start); `CREATE TABLE IF NOT EXISTS`
- 12 vitest assertions in `ui/src/lib/db/predict.schema.test.ts` — all pass
- `npm run check`: 0 errors; task `[x]` ticked
- unlocks: context-pack, harness-runner, api-dossier (parallel Wave 2)

### 2026-06-13 — backend — api-predict COMPLETE (commit 975f5d5)
- new `ui/src/routes/api/players/[playerId]/fingerprint/+server.ts`: POST handler
  - validates playerId + 404 guard; calls `generateFingerprint(db, playerId)`; reads back persisted provenance; returns `{ fingerprint, model, cost_usd, generated_at }`
- new `ui/src/routes/api/players/[playerId]/vote-probe/+server.ts`: POST handler
  - validates playerId + 404 guard; parses + validates body (song.title, song.artist required, song.spotify_url optional string, theme.name + theme.description required); malformed JSON or missing fields → 400; calls `runVoteProbe`; returns SAS output + `{ model, cost_usd, latency_ms }`
- 5 vitest assertions for fingerprint route: 200 + fingerprint shape, persists to player_profiles, writes prediction_runs row (task_id='taste-fingerprint'), 404 unknown player, 400 invalid id
- 11 vitest assertions for vote-probe route: 200 SAS output, prediction_runs row (task_id='vote-probe'), provenance fields in response, spotify_url passthrough, 404 unknown, 400 invalid id, 400 missing song/theme/song.title/song.artist/theme.name, 400 bad JSON
- `npm run check`: 0 errors; 291 tests pass; task `[x]` ticked
- unlocks: ui-fingerprint + ui-probe (frontend lane)

### 2026-06-13 — backend — task-vote-probe COMPLETE (commit 2ead248)
- new `ui/src/lib/predict/tasks/voteProbe.ts`
- `VoteProbeOutputSchema` (zod): upvote_likelihood (min 0, max 100), expected_points, confidence enum, reasoning (min length 1), signals[]
- `voteProbeTask`: PredictionTask<VoteProbeInput, VoteProbeOutput> — system prompt enforces SAS framing (standalone affinity, not round allocation) with evidence-grounded reasoning requirement
- `runVoteProbe(db, playerId, { song, theme, roundId? })`: builds PlayerContext → runPrediction → returns { output, meta }; logs prediction_runs row with task_id='vote-probe', round_id nullable
- 15 vitest assertions: happy path (output shape, meta, reasoning non-empty), prediction_runs row (task_id, player_id, model, cost, latency), roundId passthrough, NULL round_id default, empty-player edge case, schema validation (0/100 boundaries, >100 rejected, <0 rejected, empty reasoning rejected, bad confidence, missing fields, non-array signals)
- `npm run check`: 0 errors; 15 tests pass; task `[x]` ticked
- unlocks: api-predict (both task-fingerprint and task-vote-probe now complete)

### 2026-06-13 — orc — Sprint-28 ACTIVATED · dossier-schema dispatched (Wave 1)
- status planned → active; dispatched `dossier-schema` to the backend pane (the sole
  NEXT-ready task — everything fans out from it). Marked `[-]` in-progress.
- On its landing, three lanes open in parallel: context-pack, harness-runner, api-dossier.

### 2026-06-13 — docs — Sprint plan authored: Producer Sprint 1 (dossier + harness + SAS)
- created sprint-28 coord-doc; `## Active Sprint Plan` body has 11 tasks
- 7 backend (schema, context pack, harness runner, 2 tasks, 2 API) / 3 frontend (dossier, fingerprint, probe panels) / 1 orc gate
- deps: context-pack + harness-runner + api-dossier ← dossier-schema; the two tasks ← context-pack + harness-runner; api-predict ← both tasks; ui-dossier ← api-dossier; ui-fingerprint + ui-probe ← api-predict; gate ← the three UI leaves
- harness-first per Approach A; source spec `docs/superpowers/specs/2026-06-13-player-prediction-sprint1-design.md`
- status `planned` — kickoff (first dispatch) is confirmation-gated; awaiting owner "go"
