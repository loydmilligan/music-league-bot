---
project: music-league-bot
sprint: sprint-31
campaign: the-b-side
title: the b-side — Read-model generator + foundation
status: active
created: 2026-06-14T00:00:00Z
activated: 2026-06-14
updated: 2026-06-14T17:00:00Z
---

# music-league-bot — coordination doc (sprint-31)

> **Campaign `the-b-side`, sprint 1 of 3.** Builds the offline **read-model
> generator** — the per-league JSON snapshot the public b-side will serve. This
> is the ~80% of content the Claude Design handoff packets assume exists but
> doesn't: superlatives, KPIs, season moments, biggest fan / friendly hater,
> discovery playlist, member tiers, spectrum, and **overlap v2**. No public site
> and no operator UI this sprint (those are sprints 32/33). Builds on the
> sprint-28 prediction harness. The fixture
> `docs/design/dashboard/ml-dashboard-data.jsx` is the canonical read-model
> shape — every generator targets its slice of it. Full design:
> `docs/superpowers/specs/2026-06-14-bside-campaign-design.md` (§5–§12).

## Sprint Goals

- Generate a league's whole b-side read-model, offline
  Superlatives, KPIs, moments, fan/hater, playlist, tiers, overlap v2 — never a leaderboard.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | DB + migrations, `$lib/dashboard/*` + `$lib/predict/*` + `$lib/db/*`, `/api/*` routes, LLM harness | Svelte components, page routes |
| frontend | (no UI work this sprint) Svelte components + routes when needed | DB schema, services, API route internals |
| orc | sprint gate: cross-checks, version + CHANGELOG, ratification card, deploy, context resets | project code (orc manages; project agents work) |

## Working agreements (sprint-31)

- The fixture `docs/design/dashboard/ml-dashboard-data.jsx` is the **read-model contract** —
  every generator produces its slice in that exact shape. The campaign spec
  `docs/superpowers/specs/2026-06-14-bside-campaign-design.md` §5–§12 is the map.
- Reuse, don't rebuild: the sprint-28 prediction harness (`$lib/predict` — PredictionTask,
  runPrediction, buildPlayerContext, prediction_runs) for every LLM sub-generator; the
  sprint-28 taste fingerprint (`player_profiles.taste_fingerprint`) as input. Do NOT add a new LLM client.
- **Each generator lives in its own file under `$lib/dashboard/generators/` and exports its own
  slice type** — so the parallel generator tasks don't collide and `build-readmodel` composes them.
- The **no-strife / yearbook contract is load-bearing** (spec §9): KPIs are celebratory facts
  (never a win/loss ladder), superlatives are warm, the "hater" is friendly (amber). LLM prompts
  carry these as hard constraints.
- LLM-task tests stub `callOpenRouter` (no real spend); deterministic generators get data-driven
  vitests. `npm run check` + `npx vitest run` are the gates.
- Mid-task context discipline: past ~60-70% context, write a handoff and request a reset from orc.
- No prod deploy except by orc at the gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: schema} **Schema — `dashboard_sites` + `dashboard_section_state`** (spec §6). Two new tables via idempotent boot migrations in `ui/src/lib/db/client.ts` (house pattern). `dashboard_sites` (slug PK unguessable ≥80-bit, league_id UNIQUE, season, read_model TEXT, archived_rounds TEXT DEFAULT '[]', is_live, published_at, refreshed_at). `dashboard_section_state` (league_id, section, decision DEFAULT 'refresh', steer, PK(league_id,section)). Also add a small slug helper (≥80-bit token) in `$lib/dashboard/slug.ts`.
  - **Acceptance:** fresh boot creates both tables (idempotent re-run is a no-op); `PRAGMA table_info` shows every column; the slug helper yields a ≥80-bit URL-safe token; vitest covers boot + slug entropy/shape; `npm run check` 0 errors.

- [x] {agent: backend, id: overlap-v2} **Overlap v2 — Vote Together + Taste Twins** (spec §8; also the standalone backlog item). New `ui/src/lib/dashboard/generators/overlap.ts`: `buildOverlap(db, leagueId) → { voteTogether: PeerScore[], taste­Twins: PeerScore[] }` per member. Vote Together = within shared rounds only (omit zero-shared-round pairs, no fake low %); Taste Twins = fingerprint-similarity across all leagues (no penalty for no shared rounds). Export the slice type. Do NOT extend the v1 global-Jaccard `tasteOverlap`.
  - **Acceptance:** a known co-voting pair scores high in Vote Together; a pair with zero shared rounds is ABSENT from Vote Together but can appear in Taste Twins; vitest covers both with fixture data; `npm run check` 0 errors.

- [x] {agent: backend, id: gen-deterministic} **Deterministic generators — stats, tiers, KPI facts, moments, fan/hater relationships** (spec §7). New `ui/src/lib/dashboard/generators/deterministic.ts`: per-member `stat` (submitted/avg/round-wins) + `tier` (full/lite by an activity threshold — pick a simple defensible cutoff); league `kpis[]` (celebratory FACTS only — distinct winners, favorite year, longest pick; NEVER last-place/win-loss); `moments` (mostLoved/mostDivisive/biggestUpset by vote spread); and the deterministic `biggestFan`/`biggestHater` relationships (who most rewards / most withholds points). Pure SQL/compute; export slice types. (LLM blurbs/phrasing layer on in gen-narrative-llm.)
  - **Acceptance:** stats/tier/kpis/moments/fan-hater compute from fixture gameplay data; KPIs contain NO win/loss-ladder field; a quiet member resolves to `tier:'lite'`; vitest covers each; `npm run check` 0 errors.

- [x] {agent: backend, id: gen-narrative-llm} **Narrative LLM generators — superlatives, KPI/moment phrasing, fan/hater blurbs** (spec §7, §9). New `ui/src/lib/dashboard/generators/narrative.ts`: PredictionTasks on the harness producing per-player + league-reel **superlatives** (warm yearbook awards, each `{award, accent, blurb}` with accent ∈ pulp|amber|sky|moss|ember), the celebratory **phrasing** for KPIs/moments, and the **friendly** fan/hater blurbs (hater = amber, affectionate). The no-strife contract (spec §9) is a hard prompt constraint. Export slice types.
  - **Acceptance:** with `callOpenRouter` stubbed, generators return schema-valid superlatives/blurbs with accent in the allowed set; output zod rejects a brutal/ranking phrasing shape (e.g. a "lastPlace" field); prompts include the no-strife constraint (asserted in the message text); `npm run check` 0 errors; `npx vitest run` green.

- [x] {agent: backend, id: gen-profile-llm} **Profile LLM generators — spectrum + discovery playlist** (spec §7, decision §3.1). New `ui/src/lib/dashboard/generators/profile.ts`: PredictionTasks producing each member's **spectrum** (3 axes Polished↔Raw / Sunny↔Melancholy / Familiar↔Obscure, derived from the player's taste fingerprint + history — no audio data) and the personality-driven **discovery playlist** (named, a one-line "agenda" nudge, 3 tracks each with a "why"). Export slice types.
  - **Acceptance:** with `callOpenRouter` stubbed, spectrum returns 3 axis values in range and playlist returns name + agenda + 3 tracks-with-why; a `lite` member with a thin fingerprint still returns a coherent (possibly shorter) result; `npm run check` 0 errors; `npx vitest run` green.

- [ ] {agent: backend, id: build-readmodel, depends: schema,overlap-v2,gen-deterministic,gen-narrative-llm,gen-profile-llm} **Read-model orchestrator** (spec §7). New `ui/src/lib/dashboard/buildReadModel.ts`: `buildReadModel(db, leagueId, opts) → ReadModel` — fetch/generate each member's taste fingerprint (reuse sprint-28; generate if missing), then assemble league meta + members[] (fingerprint, spectrum, superlatives, fan/hater, voteTogether/voteTwins, playlist, tier, stat) + reel[] + kpis[] + moments + archive[] by composing all the generator slices. Validate the assembled object against a `ReadModel` zod schema mirroring `ml-dashboard-data.jsx`. `lite`-tier members omit sections they lack (no empty blocks).
  - **Acceptance:** `buildReadModel(db, leagueId)` (with LLM generators stubbed) returns an object that passes the `ReadModel` zod validation against the fixture shape; a `lite` member's entry omits absent sections; accent values are all in the allowed set; vitest covers a full + a lite member; `npm run check` 0 errors; `npx vitest run` green.

- [ ] {agent: backend, id: publish-api, depends: build-readmodel} **First-publish — slug mint + `publishSite` + endpoint** (spec §10). New `ui/src/lib/dashboard/publish.ts`: `publishSite(db, leagueId) → { slug }` — mint a permanent ≥80-bit slug (or reuse the league's existing one), run `buildReadModel` over all finalized rounds, persist `read_model` + `archived_rounds` + timestamps to `dashboard_sites`; idempotent re-publish refreshes in place on the same slug. Expose `POST /api/content/:leagueId/publish` (the operator UI in sprint-33 will call it; here it's directly callable/testable).
  - **Acceptance:** `POST /api/content/:leagueId/publish` returns 200 with `{slug}`, persists a `dashboard_sites` row whose `read_model` validates; a second publish reuses the same slug and refreshes `refreshed_at`; bad leagueId → 404; route test green; `npm run check` 0 errors.

- [ ] {agent: orc, id: gate-close, depends: publish-api} **Gate — cross-check, quality spot-check, close.** Orc runs the gate: cross-check all lanes' acceptance, independent `npm run check` + `npx vitest run`, version bump + CHANGELOG, ratification card. **Smoke = the read-model QUALITY spot-check (spec §12):** generate a real league's read-model on dev and eyeball superlatives / KPIs / fan-hater against the no-strife bar before sprint-32 consumes it (no public UI to deploy yet; the new tables + publish endpoint deploy low-risk). Panes reset, doc closed.
  - **Acceptance:** all worker tasks `[x]`; 0 typecheck errors + vitest green; v-bump + CHANGELOG committed; ratification card emitted + ratified; a real league's generated read-model passes the no-strife eyeball (no leaderboard/last-place language; warm superlatives; friendly hater); doc `status: closed`.

## Decision Log

### 2026-06-14 — Campaign `the-b-side`, sprint 1 = read-model generator (owner)
The Claude Design handoffs (docs/design/dashboard, docs/design/content) cover presentation +
operator chrome; the read-model content generator (~80% unbuilt) is the bulk and gates the
public site, so it's sprint 1. Locked decisions: spectrum derived from the LLM fingerprint;
static-generate on publish (sprint-32); overlap v2 built here. No UI this sprint.

## Ratification Log

_(gate card lands here when it resolves)_

## Blockers

_None._

## Activity Log

### 2026-06-14 — backend — schema complete (61303a7)
- `ui/src/lib/db/client.ts`: two idempotent boot migrations — `dashboard_sites` (slug PK, league_id UNIQUE, season, read_model, archived_rounds DEFAULT '[]', is_live DEFAULT 1, published_at, refreshed_at) + `dashboard_section_state` (PK(league_id,section), decision DEFAULT 'refresh', steer nullable)
- `ui/src/lib/dashboard/slug.ts`: `mintSlug()` — `randomBytes(16).toString('base64url')` = 128-bit URL-safe token (≥80-bit requirement)
- `ui/src/lib/db/client.test.ts`: added dashboard_sites + dashboard_section_state column coverage tests
- `ui/src/lib/dashboard/slug.test.ts`: URL-safe pattern, length ≥14 chars (84 bits), uniqueness
- 7/7 vitest green; 0 svelte-check errors; fresh boot creates both tables; idempotent re-run is a no-op
- `[-]` → `[x]`

### 2026-06-14 — backend — gen-deterministic complete (9937aa5)
- `ui/src/lib/dashboard/generators/deterministic.ts`: pure SQL/compute generator,
  exports `MemberStat`, `MemberTier`, `KpiItem`, `MomentEntry`, `Moments`,
  `RelationshipEntry`, `DeterministicMemberSlice`, `DeterministicLeagueSlice`, `buildDeterministicSlices`
- **Tier cutoff**: `TIER_CUTOFF_RATIO = 0.5`; member is `full` if submitted ≥ max(3, round(totalRounds × 0.5)),
  `lite` otherwise (quiet/new members always resolve to `lite`)
- **KPIs**: songs submitted, points awarded, distinct round winners ("the trophy gets around"),
  avg words/submission-note (when ≥3 comments exist); NO win/loss-ladder, no last-place language anywhere
- **Moments**: mostLoved = highest total pts; mostDivisive = highest vote spread (MAX − MIN, ≥2 votes);
  biggestUpset = round winner with smallest margin over 2nd place; returns `null` if no data
- **Fan/hater**: vote-matrix SQL grouping `SUM(v.points)` by `(target_player_id, voter_player_id)`;
  biggestFan = max pts received; biggestHater = min pts received, requires ≥2 shared rounds
  (single-encounter noise excluded); self-vote exclusion enforced in SQL
- 39/39 vitest green; 439/439 full suite green; 0 svelte-check errors
- `[-]` → `[x]`

### 2026-06-14 — backend — overlap-v2 complete (1187409)
- `ui/src/lib/dashboard/generators/overlap.ts`: `buildOverlap(db, leagueId) → Map<playerId, OverlapSlice>`
- Exports: `PeerScoreSchema`, `PeerScore`, `OverlapSliceSchema`, `OverlapSlice`
- **Vote Together**: mutual positive-vote % in shared rounds (both A→B and B→A > 0 pts in same round);
  pairs with zero shared rounds omitted entirely — no fake low percentages
- **Taste Twins**: weighted Jaccard over `taste_fingerprint` fields (artists ×3, genres ×2, rewards ×2,
  punishes ×1, eras ×1); independent of shared-round participation; built from global (all-league) fingerprint
- Replaced v1 global-Jaccard `tasteOverlap` in playerHistory.ts — did NOT extend it
- Results sorted by pct descending; label buckets: "vote as a bloc" / "quiet alliance" / "occasional allies"
  and "kindred ears" / "same wavelength" / "find common ground"
- 20/20 vitest green (acceptance criteria: co-voting pair scores high; zero-shared pair absent from
  voteTogether but present in tasteTwins with similar fingerprints); 439/439 full suite green;
  0 svelte-check errors in owned files (2 pre-existing errors in deterministic.test.ts, other lane)
- `[-]` → `[x]`

### 2026-06-14 — backend — gen-narrative-llm complete (9182bdf)
- `ui/src/lib/dashboard/generators/narrative.ts`: 4 PredictionTasks on the sprint-28 harness
  (`narrative-player-superlatives`, `narrative-fan-hater-blurbs`, `narrative-league-reel`, `narrative-moment-lines`)
- Exports: `SuperlativeItem` / `SuperlativeItemSchema`, `SignatureSuperlative`, `FanHaterBlurbOutput` /
  `FanHaterBlurbOutputSchema`, `ReelItem` / `ReelItemSchema`, `MomentLinesOutput` / `MomentLinesOutputSchema`,
  `NarrativePlayerSlice`, `NarrativeLeagueSlice`, `narrativeTasks`, `NO_STRIFE_CONSTRAINT`, `ACCENT_VALUES`
- `NO_STRIFE_CONSTRAINT` exported constant embedded verbatim in every system prompt; tests assert its presence
- All zod output schemas use `.strict()` — extra fields like `lastPlace`, `rank`, `losses`, `standings`,
  `position` are rejected at parse time (no-strife contract enforcement at the schema layer)
- Accent values restricted to `pulp|amber|sky|moss|ember` via `z.enum`; hater framing is friendly/affectionate
- `callOpenRouter` stubbed in 40 tests; 40/40 vitest green; 400/400 full suite green; 0 svelte-check errors
- `[-]` → `[x]`

### 2026-06-14 — backend — gen-profile-llm complete (2a5749b)
- `ui/src/lib/dashboard/generators/profile.ts`: two PredictionTasks (`profile-spectrum`, `profile-playlist`) on the sprint-28 harness; `generateProfile(db, playerId)` runs both in parallel, logs to `prediction_runs`
- Exports: `SpectrumSlice` / `SpectrumSliceSchema`, `PlaylistSlice` / `PlaylistSliceSchema`, `ProfileSlice` / `ProfileSliceSchema`, `spectrumTask`, `playlistTask`, `generateProfile`
- LLM returns raw integer values (0-100) for spectrum axes; axis labels (Polished/Raw, Sunny/Melancholy, Familiar/Obscure) attached in code to prevent label drift
- Lite members (thin fingerprint, no history) return coherent result; playlist allows 1-3 tracks
- `callOpenRouter` stubbed in tests; 16/16 vitest green; 400/400 full suite green; 0 svelte-check errors
- `[-]` → `[x]`

### 2026-06-14 — orc — Sprint-31 ACTIVATED · gen-narrative-llm + gen-profile-llm dispatched (Wave 1)
- status planned → active; dispatched the two longest-pole LLM generators in parallel —
  gen-narrative-llm to backend (%55), gen-profile-llm to the frontend pane temp-flipped to a
  2nd backend lane (%56). File-disjoint (each owns its generators/*.ts + slice type). Both `[-]`.
- Remaining dependency-free generators (schema, overlap-v2, gen-deterministic) dispatch as lanes free.
  build-readmodel waits on all 5; then publish-api; then gate.

### 2026-06-14 — docs — Sprint plan authored: the b-side read-model generator (campaign sprint 1)
- created sprint-31 coord-doc; `## Active Sprint Plan` body has 8 tasks (all backend + orc gate; no UI)
- fan-out: schema ∥ overlap-v2 ∥ gen-deterministic ∥ gen-narrative-llm ∥ gen-profile-llm (5 parallel, dependency-free) → build-readmodel (orchestrator) → publish-api → gate
- each generator owns its file under `$lib/dashboard/generators/` + its slice type → parallel-safe
- contract = `docs/design/dashboard/ml-dashboard-data.jsx`; design = the campaign spec §5–§12
- status `planned` — kickoff (first dispatch) is confirmation-gated; awaiting owner "go"
