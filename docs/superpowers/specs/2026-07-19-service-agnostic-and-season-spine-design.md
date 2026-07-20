# Service-Agnostic Companion App & the Season Spine — Strategy Design

**Date:** 2026-07-19
**Status:** Approved strategy / north-star. Each workstream below gets its own spec → plan → build when scheduled.
**Related:** `docs/ml-competitors.md` (platform research), `scripts/ml-rebuild.mjs`, `scripts/ml-reconcile.mjs`, `scripts/ml-auth-trigger.mjs`

---

## 1. Why this document exists

Two requests converged into one design:

1. **"I've wanted to track seasons properly for a long time."** The season↔upstream-league mapping is currently fragile: it relies on name-substring matching plus hardcoded pin tables duplicated across three scripts (the source of a data-loss landmine fixed in commit `861f05b`).
2. **"Music-League-style competition suddenly has real competitors; we'll almost certainly try another platform."** Timeline: near-certain, but not until the current Fam Jam season ends (~6 weeks out at weekly cadence). See `docs/ml-competitors.md`.

Investigating both surfaced a third, connected problem the owner named directly: **the b-side / archive content has never been released to players because it "doesn't feel accurate."** The root cause is the same fragile season model.

**The core insight of this document:** these are not separate projects. Make the **season the authoritative spine** and season-tracking, cross-season features, a trustworthy archive, and multi-platform support all fall out of it.

---

## 2. The competitors research, in one paragraph

`docs/ml-competitors.md` (ChatGPT-generated, reviewed and endorsed) already did the hard conceptual work. Its canonical model (Community / Competition / Round / CanonicalMedia / Vote / SocialEvent / GameEvent) and adapter architecture (§8–§9) are sound and we adopt them as the north star. Its ranking: **Mixtape Hero** is the best first adapter (documented bearer-token API exposing individual votes and completed results), **Music League** stays the stable batch baseline, **CutClub** is a promising second (bracket/survivor/teams formats, export unverified), **BandJam/YapZap** are partnership-only (rich data, no supported access). We do **not** redesign that model; we sequence *how much of it to build, and when*.

---

## 3. Current schema reality (what we're actually starting from)

The good news — we are closer to the canonical model than the research assumes:

- **`competitors → players` is already a cross-source identity map.** Per-league source identity (`competitors.ml_competitor_id`) → canonical person (`players`), linked by `players.id` FK. This is the hardest part of the canonical model and it exists. ML competitor ids are stable across leagues, which is what makes cross-league player totals work.
- **Bracket infrastructure exists** (`head_to_head_matches`, `research_songs`) — relevant to CutClub Bracket/Survivor formats.
- **Concepts already line up:** `leagues` ≈ Community, `seasons` ≈ Competition instance, `rounds` ≈ Round, `ml_submissions` ≈ Submission, `votes` ≈ Vote.

The three real couplings to unwind:

1. **No source dimension at all.** Nothing in `leagues`/`seasons`/`rounds` records *which upstream service* the data came from — everything is implicitly Music League. **This is the gap behind the season-tracking problem.**
2. **Source-id naming is baked into columns:** `rounds.ml_round_id`, `competitors.ml_competitor_id`, `players.ml_competitor_id`, the `ml_submissions` table, `rounds.spotify_playlist_url`. Mostly cosmetic, but signals there was never a source abstraction.
3. **Spotify is the song identity *and* the join key** — the deepest lock-in. `spotify_uri TEXT NOT NULL` in both `ml_submissions` and `votes`, and **votes join to songs by the `spotify_uri` string, not a submission FK.** Cross-DSP breaks precisely here.

> **Design principle:** coupling #3 has *zero* functional payoff to unwind while Music League (Spotify-only) is our only source. It belongs to Phase 2, where a real second source forces it and lets us design it correctly. Phase 1 must not make it *harder*, but must not do it early.

---

## 4. Why the archive "doesn't feel accurate" (grounded findings)

The b-side archive read-model (`ui/src/lib/dashboard/buildReadModel.ts`) is **league-lifetime-scoped**: it concatenates every season and draws season boundaries from just two weak signals — the `season_number` label and the **deadline-derived** `phase='complete'` gate. There is **no authoritative "this round is done / this season is complete" flag** driving archive membership.

Worse, **three different definitions of "which rounds count" coexist:**

| Definition | Where | Problem |
|---|---|---|
| `rounds.phase = 'complete'` | `buildReadModel.ts:371`, `deterministic.ts:127` | `phase` is backfilled from deadlines (`client.ts:451`); a round becomes "complete" the instant its `voting_deadline` passes — no results, no digest |
| `digest_drafts.finalized_at IS NOT NULL` | `publish.ts:25`, `api/content/leagues/+server.ts:73` | The "archive-ready" badge uses this — a *different* set than what the archive actually renders |
| `EXISTS(votes)` | `seasonTimeline.ts:38` | Yet a third rule for the season timeline |

Consequences (all cited in the b-side audit): global round renumbering across all seasons (`buildReadModel.ts:378`), member stats blended across a player's entire league lifetime with no per-season scoping (`buildReadModel.ts:453`, `deterministic.ts:158`), "active season" inferred heuristically (`activeRound.ts:70`), and an artifact that mixes "this season" and "all-time" framing in one page (`buildReadModel.ts:551` vs `:601`). `seasons.status` exists but `buildArchive` never reads it.

**Bottom line:** the archive trusts deadlines and season numbering instead of an authoritative signal. That is the accuracy problem, and it is a *season-model* problem.

---

## 5. The design — one spine, four pillars, two phases

```
                    ┌──────────────────────────────────────────┐
   SPINE ──────────▶│  Source-aware seasons                     │
                    │  seasons.source + source_competition_id   │
                    │  one resolver replaces 3 pin maps         │
                    └───────────────┬──────────────────────────┘
                                    │ everything below depends on it
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                            ▼
  P2 Authoritative           P3 Per-season               P4 Archive pipeline
     lifecycle                  archive                     parity
  archive-ready =           each season = its own       archive LLM pipeline
  results imported +        persistent-URL archive      gains digest pipeline's
  digest finalized;         of that season's digests    config (per-piece models,
  collapse the 3 "which     + season content;           grouping, selective
  rounds count" defs        season-accurate stats       context, auto-redo,
  into one                  & round numbering           cost/quality tracking)

        ═══════════════════════ PHASE 2 (at Fam Jam's end) ═══════════════════════
        CompetitionSourceAdapter interface; ML/CLI path becomes the first adapter;
        cross-DSP song identity (canonical media + provider links; votes keyed by
        submission FK, not spotify_uri); Mixtape Hero read-only importer.
```

### Locked decisions

- **Phasing:** Approach A — small source-aware foundation now; the real adapter + cross-DSP song identity built at Fam Jam's end, against a *real* second source (Mixtape Hero) rather than a guess.
- **Accuracy gate (P2):** a round is *archive-ready* only when its results are imported **and** its digest draft is finalized (`finalized_at` set). The **trigger already exists** (the "new digest → archive-ready" badge is this signal). The work is *downstream* of that moment, not detecting it.
- **Archive scope (P3):** the **season** is the archive unit. Each season has its own archive at a **persistent URL**, understood partly as *literally an archive of that season's finalized digests*, plus season-level content. Not one league-lifetime blob.
- **Season completeness:** authoritative via `seasons.status` + explicit resolution, **never** deadline drift.

---

## 6. Pillar 1 — Source-aware seasons (the spine) · **do first, small**

**Goal:** make "which upstream league instance is this season" a first-class, authoritative DB fact, and retire the duplicated pin maps.

**Schema:**
- `ALTER TABLE seasons ADD COLUMN source TEXT NOT NULL DEFAULT 'music_league';`
- `ALTER TABLE seasons ADD COLUMN source_competition_id TEXT;` — the upstream league/game id for this season (Music League league id today; Mixtape Hero game id later).
- Unique index on `(source, source_competition_id)` (partial, where `source_competition_id IS NOT NULL`).

**Backfill** existing seasons with `source='music_league'` and their real ML league ids. Known-good ids: fam-jam S4 = `d3d3b2046a2c4c639976ca2621a8afa3`, second-best S2 = `78b2e6400520468e8d726e8793127fb0`, boarz-ii-men S1 = `71598b6952064ca4afe4baf437495604`. Prior/complete seasons backfilled from the historical league list where resolvable; unresolved historical seasons may keep `source_competition_id = NULL` (they never re-import).

**Resolver refactor:** introduce one shared function `resolveSourceCompetition(db, leagueSlug, seasonNumber) → {source, sourceCompetitionId}` reading the column, and refactor all three consumers to use it:
- `scripts/ml-rebuild.mjs` (`TARGETS` pins → column lookup)
- `scripts/ml-reconcile.mjs` (`SLUG_TO_ML_ID` / `SLUG_TO_ML_NAME` → column lookup)
- `scripts/ml-auth-trigger.mjs` (`resolveLeagueId` name-matching → column lookup)

This *is* the season-tracking feature, and it deletes the pin-duplication landmine class entirely (the guards added in `861f05b` become a backstop rather than the primary defense).

**Out of scope for P1:** renaming `ml_round_id`/`ml_competitor_id` columns. Leave them; Phase 2 adds generic `source_*` aliases if needed. YAGNI.

---

## 7. Pillar 2 — Authoritative lifecycle · **do first**

**Goal:** one authoritative signal for "round is archive-ready" and "season is complete," replacing deadline-derived `phase='complete'` and collapsing the three competing definitions.

- **Archive-ready round** := results imported **AND** `digest_drafts.finalized_at IS NOT NULL`. Make `buildArchive` (`buildReadModel.ts:366`) gate on *this*, not `phase='complete'`.
- **Season complete** := `seasons.status='complete'` set by explicit resolution (the season-setup/lifecycle flow), never inferred from deadlines. `getActiveSeasonId` (`activeRound.ts:70`) already prefers `status`; make the archive path trust `status` too.
- **Collapse the three "which rounds count" definitions** into one shared predicate used by `buildArchive`, `deterministic.ts`, `seasonTimeline.ts`. Document it once.
- Reconcile the `lifecycle.ts` phase vocabulary (`upcoming|submission|voting|archive`) vs the DB CHECK (`not-started|submission|voting|complete`) — pick one, map explicitly, remove ad-hoc bridges (`client.ts:461`, `storedToRoundPhase`).

**Season lifecycle management** (the operator flow the owner also asked for) lands here: a clean open/close/next-season action that sets `status` authoritatively — the same season-setup logic used to seed second-best S2 and boarz, promoted to a first-class flow.

---

## 8. Pillar 3 — Per-season archive · **do first (depends on P1+P2)**

**Goal:** the archive becomes a trustworthy, releasable, **per-season** artifact.

- **Scope the read-model to a season.** `buildReadModel` becomes season-scoped (or emits per-season read-models): member roster, per-member stats, superlatives, round numbering (`n`), and "joined" labels all computed **relative to that season**, not the league lifetime. Kills the cross-season blending (`buildReadModel.ts:453`, `:378`, `:507`).
- **Persistent per-season URL.** Each season's `dashboard_sites` slug is stable for the life of the season; regenerating on each new finalized digest updates the same URL. The season archive == the running collection of that season's finalized digests + season-level narrative.
- **Separate "this season" from "all-time"** cleanly (the audit flagged the current blur, `buildReadModel.ts:551` vs `:601`). An optional league-wide all-time roll-up can exist as a distinct top-level thing, but the season archive is the primary entity.
- **Season content into digests:** with authoritative season boundaries, per-round digests can reference accurate season standings/arc (season position, streaks, what's at stake).

**Definition of done:** a season archive shows only archive-ready rounds (P2 gate), with season-relative stats and numbering, at a stable URL — accurate enough to release to players.

---

## 9. Pillar 4 — Archive pipeline parity · **do-ish now / parallelizable**

**Problem:** the digest LLM pipeline (`ui/src/lib/digest/pipeline.ts`, `DEFAULT_PIPELINE`) is sophisticated — per-piece model assignment, grouping pieces onto one LLM call, selective (not always-on) context passing between sections, automatic re-do of individual sections, and cost/quality tracking. The **archive** pipeline (`ARCHIVE_DEFAULT_PIPELINE`, `pipeline.ts:107`) is the naive one: every piece generated serially, full preceding-section context always injected. It is the safest method — and the slowest and most token-expensive.

**Goal:** bring the archive pipeline up to the digest pipeline's configurability — reuse the same pipeline engine/config model so archive sections can be grouped, assigned per-piece models, passed context selectively, re-done individually, and tracked for cost/quality. This is "the hard part" that was deferred on the archive side.

This is largely independent of P1–P3 (it's a generation-quality/cost upgrade), so it can proceed in parallel once P3 defines the season-scoped inputs it operates on.

---

## 10. Phase 2 — Multi-source adapter · **at Fam Jam's end**

Triggered when a real second platform (Mixtape Hero first) is adopted. Built against a *real* source, per §9/§12 of `docs/ml-competitors.md`.

- **`CompetitionSourceAdapter` interface** (`listCommunities/listCompetitions/getCompetition/listRounds/getRoundData`) with an optional writable extension. Refactor today's ML/CLI export+import path into the *first* adapter behind it. `seasons.source` (P1) selects the adapter.
- **Capability discovery** per adapter (read/write/sync capabilities JSON) so the UI never promises features a source can't support.
- **Cross-DSP song identity** — the deep P1-deferred change: introduce canonical media + `provider_links`, prefer ISRC, and **re-key votes to a submission FK** instead of `spotify_uri`. Migrate ML data in place (Spotify link becomes one provider link).
- **Raw-source snapshot retention** before normalization (regenerate old digests, audit disputes, schema changes).
- **Mixtape Hero read-only importer:** groups/games/rounds discovery, anonymous submissions during voting, completed results/votes, local user-id map for opaque MH ids (the doc's biggest MH gap). Exit criteria: an MH round produces the same core digest sections as an ML round.

Later Phase-2+ candidates (unscheduled): CutClub export pilot (bracket/survivor/teams — bracket infra already exists), BandJam/YapZap partnership outreach, cross-platform career profiles.

---

## 11. Sequencing & decomposition

Each row is its own spec → plan → build. The spine is strictly first; P2 depends on P1; P3 depends on P1+P2; P4 depends on P3's scoped inputs; Phase 2 is gated on the Fam Jam trigger.

1. **SP1 — Source-aware seasons + resolver** (spine). Small. Unblocks everything.
2. **SP2 — Authoritative lifecycle + season lifecycle mgmt.** Medium.
3. **SP3 — Per-season archive read-model.** Medium/large.
4. **SP4 — Archive pipeline parity.** Medium; parallel after SP3 defines inputs.
5. **Phase 2 — Adapter + cross-DSP song identity + Mixtape Hero importer.** Large; at Fam Jam's end.

---

## 12. Risks & notes

- **Live-prod DB.** `data/league.db` is the production database (containers mount `data/` → `/app/data`). Every migration backs up first and runs dry-run/verification, per the season-setup precedent.
- **Backfill completeness.** Some historical seasons may not resolve to a live upstream id (completed ML leagues drop off the default `leagues list`). `source_competition_id = NULL` is acceptable for seasons that will never re-import; the resolver must tolerate it.
- **Don't over-build Phase 2 early.** The canonical model is validated against a real second source *only* at Fam Jam's end. Building `CanonicalMedia`/`SocialEvent`/`GameEvent`/adapter interfaces now risks the wrong seams (MH's opaque user ids, missing song-search, no display names are known unknowns). Hold the line.
- **`ml_*` column names stay** through Phase 1. Renaming is churn with no Phase-1 payoff.

---

## 13. Open questions (resolve at each sub-project's spec time)

- SP2: exact "results imported" predicate — is it `EXISTS(votes)` for the round, a `voting_ended_at` stamp, or an explicit import-log entry? Pick the one that can't be faked by a passed deadline.
- SP3: one season-scoped read-model per season vs. a single multi-season document the b-side app paginates. (Leaning: per-season artifact + stable slug.)
- SP3: what happens to the existing single league-wide sites already published — migrate or leave as legacy all-time roll-ups.
- Phase 2: adopt the doc's controlled cross-platform test league (§10) before writing the MH adapter.
