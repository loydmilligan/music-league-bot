# Phase 5 — Music-Specific Experiments

The brief requires at least one experiment whose premise comes from music, voting,
submissions or theme behaviour rather than from chat personalities. Three were run. The
result is a clean split: **vote arithmetic produced comedy chat could not. Audio features
produced nothing.**

---

## 1. Song Autopsy — Buck-O-Nine, "My Town" → `candidates/incident-01-song-autopsy.md`

**Verdict: the strongest music-specific finding in the spike, arrived at by the format
failing.**

The premise assumes a dead song. Queried honestly, the song wasn't dead — it finished 4th
of 12. What the query *did* surface was the sharpest single fact in Incident 01:

> "My Town" finished on 12 points. Mashew's own submission that round finished on 12
> points. His was the only downvote "My Town" received. **Remove it and she finishes above
> him.**

This is comedy that is *only* reachable through arithmetic on the vote table — a
counterfactual sum. No chat message contains it. No player in the league has noticed it.
It cannot be produced by any generic comedy system, or by any system with access to the
transcript but not the ledger.

**Generalisable mechanism: the counterfactual ballot.** "What would the standings be
without this one vote" is cheap, exact, and reliably interesting because it converts a
petty act into a measurable consequence. Strong candidate to test across many rounds next.

### Audio features contributed nothing
`song_audio_features` gave bpm 85.2, energy 34.6, duration 224s. All true, all inert —
texture at best, and the format was tempted to over-read them ("low energy" is not why the
song scored what it did; it scored 4th). Coverage is also patchy (R137 complete, R140
absent entirely). **Recommendation: do not build comedy premises on audio features.**

---

## 2. Player Scouting Report — Mashew → `candidates/incident-01-scouting-report.md`

**Verdict: works, with a hard prerequisite.**

Genuine, checked findings:
- Has downvoted 11 different players across 16 rounds.
- Has **never** downvoted missmara — 0 for 15, the most-exposed player he has never hit.
  The dossier calls this the "conjugal vote pipeline"; this is the first time it has been
  confirmed rather than asserted.
- Highest rate against a regular: Sarah Black, 3 of 15.
- Lowest average monthly-listener count of any 15+-submission regular (~215k) — he digs
  deeper than anyone who has played a full season.

**The prerequisite — and the near-miss.** The first draft opened on *"sixteen rounds,
sixteen downvotes, he has never once declined."* It is arithmetically true and completely
empty: **every player in the league is n-for-n**, because the downvote is compulsory. It
described the rules of Music League as if it were a personality trait, and it would have
passed a casual read by anyone in the league.

> Any stat-driven comedy format needs a **base-rate gate**: before a number is used as
> characterisation, compute the same number for every other player. If the spread is flat,
> the stat is structural — discard it.

This is the most actionable engineering finding in the spike after retrieval itself.

---

## 3. Obscurity — "Not In Nottingham" (Incident 02)

**Verdict: real, and the smallest possible bit.**

`song_popularity` says Philip Chapin's R137 submission has **23 monthly listeners**. The
next-most-obscure song in that round has 484; the round's median is around 60,000. It is
the most obscure submission in the Second Best corpus.

That number is a complete joke on its own and needs no format — one card, one number.
Worth noting as a category: **single-number bits**, where the correct treatment is not a
20-second script but one line in the digest. A generator that reaches for a format here has
already lost.

Two caveats logged in `incidents.yaml`: the dedication ("For my brudder") has a genuinely
ambiguous target, and Jonathan Black misnames the submitter in chat. Preserve the
uncertainty; do not resolve it into a cleaner story.

---

## 4. "Who Submitted It?" / "Theme Court" — not built, on purpose

The brief lists these as candidates. **The Guesser already exists** in the shipped digest
(`ui/src/lib/digest/guessResolver.ts`, `guesserInsights.ts`, `guesserCaption.ts`), with
matching, insight generation and tests. Prototyping a second one would violate the
non-goals ("do not build a parallel representation") and would have taught this spike
nothing it doesn't already know.

---

## Summary

| Data source | Comedy yield |
|---|---|
| Vote **totals and counterfactuals** | **High** — the best music-specific material found |
| Vote **comments** (as text) | **High** — but that is chat comedy stored in a music table |
| Downvote **targeting patterns** | Medium — good, needs a base-rate gate |
| `song_popularity` (listeners) | Medium — occasional single-number bits |
| `song_audio_features` (bpm/energy/duration) | **None** — inert, patchy, invites over-reading |
| Genre | **Unavailable** — and it is what the best incident is *about* (see `source-audit.md`) |
