---
project: music-league-bot
type: design-spec
milestone: music-league-producer
sprint: producer-sprint-1
title: Player Prediction Tools — Sprint 1 (Dossier + Harness + Fingerprint + Vote Probe)
status: draft
created: 2026-06-13
author: orc (brainstorm with owner)
---

# Player Prediction Tools — Sprint 1 Design

## 1. Context & milestone framing

The **"Music League Producer"** is a longer-term vision: a system that predicts each
player's behavior (submissions, votes, comments), measures its own accuracy against
real outcomes, and improves round over round. That system is too large for one spec —
it is the **parent milestone**, decomposed into sprints. This document specs **Sprint 1
only**.

The Player Research screen is the on-ramp: each tool here is a hand-cranked,
single-player version of something the engine will later automate. Build the research
tools, learn what works, and the engine's design follows.

**Milestone decomposition (owner-sequenced, 2026-06-13):**
- **Sprint 1 (this doc):** Player Dossier · Auto Taste-Fingerprint (③) · Vote Probe / SAS (②) — all on a reusable prediction harness.
- **Sprint 2:** "What would they submit?" predictor (④) — a new task on the same harness.
- **Sprint 3:** Vote-prediction backtest (⑤) — adds the scoring/accuracy loop; runs on historical rounds (every past round is a labeled test case).
- **Later / parent milestone:** full whole-round predictor (consumes SAS as an input), chat-group signal integration, comment-generation, "whose taste must I win" (⑥), comment/chat-style profile (⑦).

**Architecture decision: Approach A — harness-first.** Sprint 1 front-loads a small,
reusable prediction substrate so Sprints 2–3 are "new task definitions," not new
plumbing. This directly serves the owner's requirement: *clearly defined, accurate,
structured I/O; modular; documented; templatable; model/parameter tuning.*

## 2. Goals / Non-goals

**Goals**
- A persisted, editable **Player Dossier** (manual notes/tags + AI taste-fingerprint, kept strictly separate).
- A reusable **Prediction Harness**: structured input → templated prompt → model call → validated structured output → logged cost/provenance.
- Two harness tasks: **`taste-fingerprint`** (③) and **`vote-probe` / SAS** (②).
- Extend the existing **Player Research tab** — no new top-level screen.
- Log every prediction run from day 1 so the Sprint-3 accuracy loop has a corpus.

**Non-goals (explicitly out of Sprint 1)**
- Whole-round vote allocation / round simulation (Sprint 3 + the later round predictor).
- Accuracy scoring / backtest (Sprint 3 — but the run-log table is built now).
- Chat-group signal integration and comment generation (later milestone).
- Submission prediction (Sprint 2).
- Any model fine-tuning — "tuning" here means swapping models/params and comparing logged cost (and later score), nothing more.

## 3. The SAS primitive (and its future role)

The **Standalone Affinity Score (SAS)** is the vote-probe's output: *how much would this
**player** like this **song** for this **theme**, given their history* — independent of
who else is in the round. Inputs are exactly: **player (+ dossier/history) + song + theme.**

Music League voting is a *budget split* (each voter spreads a fixed point pool across a
whole round), so a true vote count is round-relative. SAS deliberately does **not** model
the round — it measures standalone affinity. The future **whole-round predictor** (later
feature) will **consume SAS as a per-song input** and layer the competitive allocation on
top. Keeping SAS standalone is what makes it reusable.

## 4. Architecture — the Prediction Harness

Four small, single-purpose modules, all wrapping the existing
`callOpenRouter(messages, { model, jsonMode })` (OpenRouter; default
`anthropic/claude-sonnet-4-5`; env-swappable model; JSON mode; per-call USD cost).

**4.1 Context Pack builder** — `ui/src/lib/predict/playerContext.ts`
`buildPlayerContext(playerId, opts) → PlayerContext`. Assembles one player's **dossier +
history slice** (submissions w/ comments + points, votes they cast w/ points, taste
overlap) into a **structured, token-bounded** object. One documented shape, reused by
every task. Reuses existing `playerHistory.ts` / `seasonData.ts` queries; keys on stable
`player_id`.

**4.2 PredictionTask contract** — the templatable unit. Each tool is just:
```ts
PredictionTask<TIn, TOut> = {
  id: string;                 // "taste-fingerprint" | "vote-probe"
  inputSchema: ZodType<TIn>;  // validates input
  buildMessages: (input: TIn) => OpenRouterMessage[];  // prompt template
  model: string;              // default; overridable per-run / env
  params?: Record<string, unknown>;  // temperature etc. — the tuning knob
  outputSchema: ZodType<TOut>;       // validates the structured result
  scorer?: (prediction: TOut, actual: unknown) => Score;  // Sprint 3 fills this
};
```

**4.3 Runner** — `ui/src/lib/predict/predict.ts`
`runPrediction(task, input) → { output: TOut, meta }`. Validates input, renders the
template, calls `callOpenRouter` in **JSON mode** with the task's model/params, validates
the output against `outputSchema` (one retry on malformed JSON/schema miss), captures
`{ model, costUsd, latencyMs }`, and writes a `prediction_runs` row.

**4.4 Run log** — `prediction_runs` table (see §5). Every run logged from Sprint 1;
scoring columns sit empty until Sprint 3.

**Why this meets the requirement:** swapping a task's `model`/`params` and comparing
logged **cost** (now) + **score** (Sprint 3) *is* the model-tuning loop. Sprint 2/3 tools
= new `PredictionTask` definitions; runner/context/logging already exist.

## 5. Data model (two new tables, idempotent boot migrations per house pattern)

```
player_profiles                      -- 1:1 with players, manual + AI layers SEPARATE
  player_id              PK → players(id)
  notes                  TEXT         -- owner's freeform context (authoritative)
  tags                   TEXT (json)  -- ["indie","80s",...] owner-editable
  taste_fingerprint      TEXT (json)  -- AI structured profile (③); NEVER overwrites notes
  fingerprint_model      TEXT
  fingerprint_cost_usd   REAL
  fingerprint_generated_at TEXT
  updated_at             TEXT

prediction_runs                      -- every harness run; seeds Sprint-3 accuracy loop
  id                     PK (uuid)
  task_id                TEXT         -- "taste-fingerprint" | "vote-probe"
  player_id              INTEGER → players(id)
  round_id               INTEGER NULL -- when a real theme/round is referenced
  input_json             TEXT         -- snapshot of the structured input
  output_json            TEXT         -- validated structured output
  model                  TEXT
  cost_usd               REAL
  latency_ms             INTEGER
  created_at             TEXT
  actual_json            TEXT NULL    -- Sprint 3: real outcome
  score_json             TEXT NULL    -- Sprint 3: partial-credit score
```

**Manual/auto separation principle (from sprint-27 FB-1):** regenerating
`taste_fingerprint` must never touch `notes`/`tags`. Distinct fields; both fed to tasks.

## 6. The two Sprint-1 tasks

**6.1 `taste-fingerprint` (③)**
- Input: `PlayerContext` (no extra inputs).
- Output: `{ signature_artists[], genres[], eras[], rewards[], punishes[], summary, confidence: 'low'|'medium'|'high' }`.
- Persisted to `player_profiles.taste_fingerprint` + provenance. Regenerable.
- `confidence` reflects data volume (few submissions → low).

**6.2 `vote-probe` / SAS (②)**
- Input: `PlayerContext` + `{ song: { title, artist, spotify_url? }, theme: { name, description } }`.
- Output: `{ upvote_likelihood: 0..100, expected_points: number, confidence, reasoning, signals[] }`.
  - `upvote_likelihood` = the SAS lean. `expected_points` = a calibrated standalone estimate.
  - `reasoning` MUST cite real history ("gave 4pts to similar synth-pop in R12; never rewards country").
- Logged as a `prediction_runs` row (round_id set when the theme is a real round).

## 7. API endpoints (follow existing `/api/players/:playerId` pattern)

- `GET    /api/players/:playerId/profile` — read dossier.
- `PATCH  /api/players/:playerId/profile` — save notes/tags (manual layer only).
- `POST   /api/players/:playerId/fingerprint` — run task ③, persist + return fingerprint.
- `POST   /api/players/:playerId/vote-probe` — body `{ song, theme }`, run task ②, return SAS result.

## 8. UI — extend `PlayerResearchTab.svelte`

The per-player panel grows, stacked, with **collapsible subsections** (the panel gets tall):
1. *Songs + win rate + taste overlap* — unchanged (today's content).
2. **Dossier** — notes textarea + tags editor (save → PATCH).
3. **Taste Fingerprint** — *Generate/Regenerate* button; renders artist/genre chips,
   rewards/punishes lists, summary; shows model + cost + date stamp.
4. **Vote Probe** — form (song title/artist + optional Spotify URL; theme: dropdown of
   real past themes OR freeform) → *Probe* button → likelihood gauge + expected points +
   reasoning + signal bullets.

Follow existing Mash Co. design tokens / component patterns already in the tab.

## 9. Testing

- **Unit:** zod input/output schema validation; `prediction_runs` logging; the manual/auto
  separation invariant (regenerate fingerprint → `notes` unchanged); context-pack
  token-bounding.
- **Harness:** `runPrediction` with a stubbed `callOpenRouter` (deterministic fixture) —
  validates the template→call→validate→log path without real API cost.
- **One live smoke** per task against OpenRouter (cost-bounded) to confirm the real
  structured output parses.
- `npm run check` 0 errors; `npx vitest run` green.

## 10. Success criteria

- Pick a player → write dossier notes/tags → they persist (survive reload).
- Generate a taste-fingerprint → structured profile renders with cost/model stamp;
  regenerating does **not** alter manual notes.
- Run a vote-probe (real or hypothetical song + theme) → SAS result renders with
  history-grounded reasoning; the run appears in `prediction_runs`.
- Swapping `OPENROUTER_*` model env for a task changes the model used and the logged
  `model`/`cost_usd` — demonstrating the tuning knob.
- All on the existing Player Research tab; no new top-level screen.

## 11. Open questions (resolved unless noted)

- **Probe scope** → RESOLVED: standalone affinity (SAS), not round allocation. Round
  predictor is a later feature that consumes SAS.
- **Identity key** → RESOLVED: stable `player_id`.
- **Manual vs AI** → RESOLVED: separate fields, AI never overwrites manual.
- **Theme input** → real-theme dropdown + freeform (both).
- **OPEN (minor, defer to plan):** exact `expected_points` calibration scale (per-league
  point-pool aware vs. a normalized 0–N) — pick the simplest defensible scale at plan time.

## 12. Relationship to later work

- **Sprint 2** adds task `submission-guess` (same harness).
- **Sprint 3** adds `scorer`s + populates `prediction_runs.actual_json`/`score_json` by
  replaying historical rounds; the vote backtest reuses `vote-probe`.
- **Later:** whole-round predictor (consumes SAS), chat-group signal folded into
  `PlayerContext`, comment-generation/style tasks.
