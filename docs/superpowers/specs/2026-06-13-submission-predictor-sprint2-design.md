---
project: music-league-bot
type: design-spec
milestone: music-league-producer
sprint: producer-sprint-2
title: Submission Predictor — Sprint 2 ("what would they submit?")
status: draft
created: 2026-06-13
author: orc (brainstorm with owner)
---

# Submission Predictor — Sprint 2 Design

## 1. Context

Producer Sprint 2 — the **mirror of the sprint-1 Vote Probe**:
- **Vote Probe** (shipped): *"how would player X react to song Y?"* → SAS.
- **Submission Predictor** (this): *"what would player X submit for theme Z?"*

Built as a new `PredictionTask` on the **existing sprint-1 harness** (`$lib/predict`) — a
new prompt template + I/O schemas, reusing the context-pack, runner, and `prediction_runs`
logging untouched. This is the harness-first payoff: Sprint 2 is "one task + one UI panel,"
not new plumbing. Harness contract:
`docs/superpowers/specs/2026-06-13-player-prediction-sprint1-design.md`.

## 2. Goals / Non-goals

**Goals**
- A new `submission-predict` task: **player + theme → a three-part structured prediction**
  (owner-specified shape, §3): (a) a predicted *property profile*, (b) a ranked *candidate
  list* with per-item rationale, (c) a single *final predicted pick* with detail + explicit
  similarities to the player's real past submissions.
- A **Submission Predictor** panel on the Player Research tab (mirror of the Vote Probe panel).
- Reuse the harness; log every run to `prediction_runs`.

**Non-goals (S2)**
- Predicting *all* players for one theme at once (Theme-Research batch view) — follow-on.
- Predicting how the predicted pick would *fare* in the group (running SAS on it) — separate
  backlog item; the output is *designed to pipe into* the Vote Probe/H2H, but wiring it is out
  of scope here (§9).
- The whole-round predictor.

## 3. Output shape (owner-specified — three parts)

```
{
  profile: {                 // (a) what attributes their pick likely has
    genres: string[],
    artists_or_types: string[],   // specific artists and/or "type of artist"
    era: string,
    mood_energy: string,
    obscurity_lean: string,       // e.g. "leans deep-cut" (themes reward discovery)
    comment_likely: boolean,      // does the theme/player suggest a comment?
    rationale: string             // why this profile — grounded in history + theme
  },
  candidates: [              // (b) several potentials, each with a short why
    { title, artist, why }        // 4–6, ranked best-first
  ],
  prediction: {              // (c) the single most-likely pick, with detail
    title, artist, spotify_url?,
    detail,                       // why THIS one over the candidates
    similar_past_picks: [         // ties to the player's REAL past submissions
      { title, artist, round, similarity }
    ],
    confidence: 'low' | 'medium' | 'high'
  }
}
```

`prediction.{title, artist, spotify_url}` is a clean handle so it can later be piped into the
Vote Probe / H2H ("how would this predicted pick fare?") — see §9.

## 4. Candidate grounding (the one real design decision)

The LLM proposes candidate songs from its own knowledge — risk: it may invent or mis-attribute
songs. Two options:

- **A — Spotify-validate (recommended).** After the LLM returns candidates + the final pick,
  validate each via the app's **existing Spotify search**; keep the canonical track (real
  title/artist/uri/art), drop or flag any that don't resolve. The final pick gets a real
  `spotify_url` (also makes it pipe-able to SAS). Cost: N Spotify lookups (cheap, no extra LLM).
- **B — LLM-only.** Label results "AI-suggested, unverified." Faster, but may surface songs
  that don't exist.

**Recommend A** — the app already has Spotify search, real songs make the tool trustworthy and
pipe-able, and the cost is negligible. (Captured as an open question in case owner prefers B for v1.)

## 5. The task (harness)

New `ui/src/lib/predict/tasks/submissionPredict.ts`:
- `PredictionTask` — input = `PlayerContext` + `{ theme: { name, description } }`; output = the
  §3 schema (zod-validated; the runner retries on schema miss).
- `runSubmissionPredict(db, playerId, { theme })` — builds context, runs via `runPrediction`,
  (option A) Spotify-validates `candidates` + `prediction`, logs a `prediction_runs` row
  (`task_id='submission-predict'`, `round_id` set when the theme is a real round).
- **Model:** default the capable model (Sonnet) — this is generative reasoning, quality matters —
  swappable via the harness's per-task model knob.

## 6. API + UI

- `POST /api/players/:playerId/submission-predict`, body `{ theme }` → returns the three-part result.
- **UI:** a new collapsible **Submission Predictor** panel on `PlayerResearchTab.svelte` (mirror of
  the Vote Probe panel): theme picker (real-themes dropdown + freeform) → **Predict** →
  renders (a) the profile as chips/labels, (b) the ranked candidate list each with its *why*,
  (c) the highlighted final pick with its detail and "similar to your past picks" links.

## 7. Testing / success

- **Tests:** with `callOpenRouter` stubbed to fixture JSON (and Spotify search stubbed),
  `runSubmissionPredict` returns the schema-valid three-part output and logs one `prediction_runs`
  row; the Spotify-validation path is covered (resolved vs. unresolved candidate); `npm run check`
  0 errors; `npx vitest run` green.
- **Success:** pick a player + theme → get a property profile, a ranked candidate list with
  rationales, and a final pick that cites the player's *real* past submissions and carries a real
  Spotify handle.

## 8. Open questions

- Candidate grounding **A vs B** (recommend A — Spotify-validate).
- Candidate count (default **4–6**?).
- Theme input: real-themes dropdown + freeform (same pattern as the Vote Probe).

## 9. Follow-ons (to backlog)

- **"Predict how the predicted pick will fare"** — pipe `prediction` into the Vote Probe / H2H to
  project the group's reception of the predicted song. Owner flagged this; the output schema is
  built to make it a clean hand-off. (Backlog item.)
- **Theme-Research batch view** — predict *every* player's submission for one theme at once
  (uses cheap-model + fingerprint-context + batching, same cost discipline as the H2H tool).
