---
title: "b-side: Season Awareness — campaign + Season-Update section design"
type: spec
doc_type: design
project: music-league-bot
campaign: bside-season-awareness
scope: bside-read-model + digest-pipeline
status: draft
created: 2026-06-16
related:
  - "[[round-phase-and-action-center-spec]]"
  - "[[2026-06-14-bside-campaign-design]]"
  - "[[digest-round-aware-context]]"
tags:
  - music-league-bot
  - bside
  - spec
  - season-awareness
  - season-update
  - digest
  - read-model
  - campaign
parent:
  - - music-league-bot
---

# b-side: Season Awareness — campaign + Season-Update section

## 1. Summary

A new **Season-Update** block on the b-side: a regenerated-wholesale "season pulse"
that reads *what stands out about the season right now* — surging/falling players,
behavior shifts, rivalries, and the tension heading into the next round — refreshed
every time the b-side updates with a new digest. It is the headline deliverable of a
newly-carved campaign, **b-side: Season Awareness**.

The load-bearing design principle: **almost every signal is deterministic and computed
in code**; the LLM only *narrates* a structured `SeasonSignals` object. This guarantees
the standings/trend/rivalry claims are accurate (no hallucinated "surging") — the same
discipline as the digest's cross-round factual bundle ([[digest-round-aware-context]]).

## 2. Campaign framing

`the-b-side-polish` (~24 cards) is too wide to be one campaign — it shares a *surface*,
not a coherence thread. It is **demoted to a theme/label**. The high-leverage thread is
promoted to a real campaign:

**b-side: Season Awareness** — *the b-side knows its season's shape and narrates its
evolution.* Two sprints:

| Sprint | Scope | Effort | Benefit |
|---|---|---|---|
| **S1 — Awareness Backbone** | temporal read-model + deterministic season-signals engine + lean digest→read-model channel | L | High (reusable foundation; unblocks temporal generation site-wide) |
| **S2 — The Living Season** (capstone) | the Season-Update section: narration + voice + guardrails + snark dial; regeneration wiring; "what's new this round" folded into the lede; placement + empty states | M–L | High (the headline feature) |

Cards consumed/satisfied: `bside-season-round-truth` (the slice needed for round
order/current), `bside-digest-context-channel` (lean version), `bside-temporal-aware-generation`,
`bside-returning-visitor-diff` (folded in), and a **new card** for the Season-Update
section itself. Other Season-Awareness-adjacent cards (`bside-read-model-provenance`,
`bside-season-lens`) are an optional S3, out of scope here.

Approach chosen: **C — Hybrid / right-sized** (deterministic signals on a temporal
read-model + a *lean* channel that captures only what structured data can't).

## 3. The Season-Update section

- **What:** one current Season-Update per (league, season), regenerated **wholesale**
  (replace, never append) whenever the b-side is (re)published/updated.
- **Character:** hybrid leaning narrative — an editorial "state of the season as of this
  digest," anchored in the standings movement a reader would notice, plus behavior/rivalry
  callouts and a forward look to the next round.
- **Placement:** **below the standings** on the b-side season view, so the narrative reads
  the numbers shown directly above it.
- **Persistence:** store the generated narrative **and a snapshot of the `SeasonSignals`**
  it was built from (provenance + future diffing).

## 4. The season-signals engine (deterministic, in code)

Pure functions compute a structured `SeasonSignals` object from temporal data. The LLM
narrates it; it never derives standings facts itself.

Signals:
- **bigMover** — largest positive rank/points jump round-over-round, weighted toward
  landing in/near the top (the "big red bar at the top" case).
- **faller** — largest drop, weighted toward the bottom (the "small orange bar at the
  bottom" case).
- **streaks** — players with ≥2 consecutive rounds of same-direction movement
  (surging / cooling); also "top player coasting on average weeks."
- **discoveryShift** — a player's tastemaker mix (obscure↔radio, from the existing
  tastemaker/discoverability labels) drifting from their season baseline.
- **rivalries** — reciprocal downvotes across rounds (deterministic in our data: we store
  `submitter_id` + `voter_id`, even though the public only guesses), frequent spot-trading
  between two adjacent players, and chat barbs (from chat data).
- **upcomingTension** — gaps going into the next round (who is within striking distance of
  whom) + the next round's theme.
- **punchingBagGuard** — recent "butt of the joke" tracking, to suppress repeat pile-on on
  non-safe-target players.

Each signal carries the underlying facts (names, points, deltas, round numbers) so the
narration cites real numbers.

## 5. Data backbone + lean channel

- **Temporal read-model:** extend `ui/src/lib/dashboard/buildReadModel.ts` to be
  sequence-aware — per-round standings (cumulative points + rank), per-round tastemaker
  labels, and vote-pair history across the season, ordered by round. Most of this is
  already computed per-round for the digest; here it is retained/recomputed across the
  whole season.
- **Round truth dependency:** consume just enough of `bside-season-round-truth` /
  `active-league-management` to know the season's rounds, order, and current/next with
  certainty (the section's "as of this digest" + "upcoming round" both need it).
- **Lean digest channel:** at digest-generation time, capture only what is **not**
  derivable from structured data — the operator's steer/intent for the round + a one-line
  "round dynamics" note (the digest gen may already produce a `flow` narrative to distill
  from) — stored **non-published**, alongside the digest. Consumed as optional enrichment
  to the narration; the section degrades gracefully without it.

## 6. Generation, voice & guardrails

- LLM narrates `SeasonSignals` + (optional) channel context.
- **Voice (no-strife principle removed, owner-confirmed 2026-06-16):** strife is welcome
  when it is **funny and fact-based**; never cruel or mean. Pattern-calling is allowed
  when the signals support it. **Safe targets** — Matt (Mashew), Mara, Jordan — are always
  fair game. The **punching-bag guard** prevents repeat dunking on the same non-safe-target.
- **Forward-look guardrail:** when referencing the upcoming round, **artists may be named,
  songs may NOT** — naming a song spoils its pickability.
- **Operator snark dial** (default: medium) tunes how pointed the voice is, per-update.
- **Factuality:** every competitive claim must trace to a signal; no invented movement.

## 7. Regeneration

- Triggered on every b-side (re)publish/update (new digest archived, or other b-side
  changes).
- Whole-section replace; previous narrative + signals snapshot retained for provenance.
- The "what's new this round" idea (`bside-returning-visitor-diff`) is folded into the
  section's lede rather than a separate banner for v1.

## 8. Empty / sparse states

- Round 1 / thin seasons: a graceful "the season's just getting started" treatment — no
  fabricated trends; signals that require ≥2 rounds simply don't fire.

## 9. Testing

- **Pure-function unit tests per signal** — synthetic multi-round fixtures → expected
  `SeasonSignals`. Keeps the load-bearing logic fully testable and sidesteps the b-side's
  thin component-test setup. Cover: bigMover, faller, streaks, discoveryShift, reciprocal
  rivalry detection, upcomingTension, and the punching-bag guard.
- **Golden-input check** on the narration prompt (stable signals → stable shape).
- **Final verification in the running b-side UI** (publish a b-side update, confirm the
  section renders below standings with accurate, signal-backed copy).

## 10. Out of scope (this campaign)

- Full heavyweight `bside-digest-context-channel` (only the lean slice here).
- `bside-read-model-provenance`, `bside-season-lens` (optional S3).
- The other ~18 `the-b-side-polish` theme cards (Content & Voice, Look & Feel, Share &
  Audio threads — separate future campaigns).

## 11. Decisions (owner-ratified 2026-06-16)

- Demote `the-b-side-polish` to a theme; promote **b-side: Season Awareness** as a 2-sprint
  campaign (S1 Backbone → S2 Living Season, Season-Update as the capstone).
- Architecture: **approach C** (deterministic signals + temporal read-model + lean channel).
- Section character: hybrid, narrative-leaning; **regenerated wholesale** per update.
- Placement: **below standings**.
- Voice: **no-strife removed** — funny/fact-based strife OK, never cruel; safe targets
  Matt/Mara/Jordan; punching-bag guard; **operator snark dial included** (default medium).
- Forward-look: **artists OK, songs forbidden**.

## 12. Open questions / risks

- **Chat-barb detection** is the fuzziest signal — chat is noisy and identities are guessed.
  May start LLM-assisted over `chat_mentions` rather than a hard deterministic rule; flagged
  for the plan to scope conservatively (better to under-call barbs than invent them).
- **Round-truth readiness:** the section depends on reliable round order/current/next; if
  `bside-season-round-truth` / `active-league-management` foundations are shakier than
  assumed, S1 absorbs more of that work.
