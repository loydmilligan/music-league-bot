# Voting Replay — design

**Status:** design approved, not yet planned or built
**Date:** 2026-09-07
**Surface:** a fourth panel in the `/history` League Research tab

## Purpose

Step through a round's voting phase one ballot at a time and see three things at
each step: what actually happened, what the Music League results page showed at
that moment, and what a given observer could have *deduced* from watching it.

This exists to answer a structural question about the game — **how much is
knowable by someone who watches the board?** — not to accuse anyone. Every
output is phrased as capability ("Jon could have known Shabop Shalom was 12th"),
never as intent or action. With real named people and a real marriage in frame,
that distinction is the ethics of the whole feature and it is enforced in the
engine, not left to the templates.

## The mechanic being modelled

Music League leaks information in two ways that combine:

1. During voting, the league page shows **running vote totals**.
2. It also shows **who has and has not voted**.

So an observer who refreshes learns *the identity of everyone who voted since
their last look* and *the exact change in every song's total*. When exactly one
person voted in between, the delta **is** that person's entire ballot — every
song, every point, including their downvote.

## Findings that shaped this design

All measured against `data/league.db` before any code was written. They are
recorded here because several of them contradict the intuitions the feature
started from, and a future reader should not re-derive them.

### Ballot recovery is the real payload

Glance severity (GS) is ballot-indexed, not clock-indexed, because the app shows
who has voted. With `N` ballots between the observer and their partner, a
checkpoint at fraction `f` lands after ballot `myPos + ceil(f × N)`.

| GS | checkpoints | recovered, pooled | recovered, windows > 2 ballots |
| --- | --- | --- | --- |
| 1GS | 0, 100 | 3.8% | **0.0%** |
| 2GS | 0, 50, 100 | 13.6% | 7.0% |
| 3GS | 0, 25, 50, 75, 100 | 40.3% | 52.8% |
| 4GS | after every voter | 100% | 100% |

**Read the denominator.** "Pooled" is total ballots recovered over total ballots
in-window, across every observer pair with a window of at least one ballot. An
earlier draft of this document published 18 / 39 / 69 / 100, which was an
unweighted mean of per-scenario ratios — 34% of observer pairs have a window of
two ballots or fewer, and those score 53–100% at every severity because a
one-ballot window is trivially recoverable, so they dominated the average. That
table overstated what an observer learns across a window that matters. Corrected
2026-09-07 after Workstream D could not reproduce it.

The rightmost column is the one to reason from: over a window wider than two
ballots, a 1GS observer recovers **nothing**. It bears directly on the case this
feature exists to examine — Sarah Black and Jon Black have a window of N = 11.

### Submitter identification does not work

Even at 4GS — complete knowledge of every ballot in the round — an observer
identifies **under 1%** of other people's submissions, and the mean candidate
pool only falls from 12.4 to 9.5.

| GS | others' submitters identified | mean pool |
| --- | --- | --- |
| 1GS | 0.0% | 12.4 |
| 2GS | 0.0% | 12.1 |
| 3GS | 0.1% | 11.4 |
| 4GS | 0.9% | 9.5 |

A ballot's only submitter signal is "I did not score my own song," and since
people spread 12 points over 7–9 songs, each ballot leaves 3–5 songs untouched.
Twelve such constraints still do not resolve.

This does not weaken the collusion scenario, it relocates it: an observer does
not need to know who submitted anything to say "don't spend points there, it is
already clear."

### Pooled observers buy a finer partition, not shared secrets

A single observer's checkpoints **partition** the timeline into disjoint
consecutive intervals. Disjoint equations share no unknowns, so cross-interval
solving adds exactly nothing (measured: +0.0 points at every GS). Do not add a
solver.

Two observers refreshing on the same cadence but offset produce a finer
partition. On a matched sample (windows ≥3 ballots):

| GS | one observer | two observers |
| --- | --- | --- |
| 1GS | 0.0% | 7.0% |
| 2GS | 7.0% | 52.8% |
| 3GS | 52.8% | 87.8% |

A second pair of eyes is worth roughly a full GS level. That is the mechanical
benefit of partnership.

### The window caps everything

`N` — ballots between the two observers — bounds all of it. In Second Best S2,
Sarah Black votes first in 7 of 7 rounds with a median 42.5h gap before Jon
(N = 11 in R142). Matt and Mara vote a median 18 minutes apart, both last, with
N = 0 or 1: structurally incapable of exploiting the mechanic at any GS. The UI
must show `N` prominently so an empty result reads as "no window" rather than
"tool broken".

### Machine taste inference is not available

Genre tags cover 41 of 200 Second Best songs (20%); only 5 of 195 player-artist
pairs repeat. There is no basis for an automatic taste prior. Human priors
("that is not a Mara song") are how real deduction closes, so they are supplied
manually — see the hunch layer.

## Architecture

Mirrors the existing League Research split: DB service, pure math module,
endpoint, panel.

```
lib/db/votingReplay.ts                     one query -> ReplayPayload
lib/league-research/deduce.ts              pure engine (no DB, no Svelte)
lib/components/league/ReplayPanel.svelte   scrubber + scenario controls
  ReplayFullView.svelte
  ReplayPublicView.svelte
  ReplayDeducibleView.svelte
routes/api/history/round/[roundId]/replay/+server.ts
```

### Data contract

Per round, not per league. ~169 vote rows; everything recomputes client-side so
scenario changes are instant.

```ts
export interface ReplayPayload {
  round: {
    id: number; name: string; description: string;
    votingDeadline: string | null;
    windowOpensAfter: string | null;  // last submission: lower bound on when
                                      // voting opened. rounds.voting_started_at
                                      // is empty for every round; the weekly
                                      // Music League emails would pin it exactly.
  };
  songs: Array<{
    uri: string; title: string; artist: string;
    submitter: string;                // players.name, not the ML handle
    submitterComment: string | null;  // hidden by the public view
  }>;
  ballots: Array<{                    // one per voter, ordered by cast time
    voter: string; castAt: string;
    votes: Array<{ uri: string; points: number; comment: string | null }>;
  }>;
}
```

The payload carries the whole truth; the public view hides fields at render
time. That is a presentation choice, not a security boundary — acceptable
because the app is operator-only behind auth, and it must not be described as
enforcement.

A ballot is atomic: one timestamp per player per round, straight from the
`Created` column of `votes.csv` in the Music League export. A submitter's own
0-point comment rides along in their ballot and moves no total; the engine
treats it as a comment, never a vote.

### Engine

```ts
interface Scenario { observers: string[]; gs: 1 | 2 | 3 | 4; }
```

Each observer gets a checkpoint schedule anchored at their own vote; the
**union** of all observers' checkpoints forms the partition. Each interval is a
labelled equation — the app names who voted, so an interval always reads "these
K people account for this delta". K=1 yields an exact ballot; K>1 is retained
and displayed as partial knowledge ("Tommy, Brian and Jac together gave Bro
Hymn +4").

Submitter pools narrow by four sound rules: observers know their own songs;
every song a known ballot scored eliminates that voter; a known voter's own song
is among those they did not move; and each player submits exactly `k` songs per
round, `k` derived per round and propagated as a matching.

Pools are exposed as pools. The engine never returns a resolved name it has not
proven, so no view can print one.

### Hunch layer

A per-round set of manual `(song, player)` exclusions, applied *after* the sound
pass and persisted like `round_notes`. Pools recompute live, cascading through
the quota, so one hunch can resolve several songs.

Provenance is always rendered: "1 candidate — 4 ruled out by you", never as a
deduction. A leverage readout reports the exchange rate ("3 hunches → 4 songs
resolved"), which is the honest measure of how data and human knowledge combine.

### Views

A ballot-indexed scrubber, one notch per ballot, marking both observer
positions, shading the window between them, and showing `N`.

1. **Full** — every song with artist, submitter, points, and both comment types,
   submitter comments styled distinctly from voter comments.
2. **Public** — the results page as it stood: sorted by total, points and voter
   count only. No submitters, no comments.
3. **Deducible** — candidate pools with sizes; the ballot ledger (exactly known
   / known-as-part-of-a-sum / unknown); the hunch controls and leverage readout;
   and for coarse GS, the "who is top, who is bottom, who is safe to feed"
   summary, shown only when an observer's own song is contending.

Scenario controls sit above the views: observer multi-select, GS 1–4, and four
presets — Individual (1 observer), Partner (2, coarse), Partner plus (2, deep),
Partner double plus (3, deep).

### Separate detector

"Just enough votes to stay one below" is an outcome pattern over final
standings, not something an observer knows, so it is a flag computed outside the
engine: rounds where a song lands 1–2 points under a specific player's.

## Testing

The engine is pure and mostly fixture-tested. Four properties run against all
~40 real rounds in the database:

1. **Soundness** — mechanical rules never exclude the true submitter, at every
   GS, for every observer pair. Currently 0 failures in 24,628 scenarios. This
   invariant caught both modelling bugs below before any code existed.
2. **Quota** — submissions-per-player derived per round, never assumed to be 1.
3. **Partition** — a single observer's intervals never overlap; pooled
   observers' do.
4. **Recovery** — GS levels reproduce 18% / 39% / 69% / 100%.

Named regressions:

- **The Quinto case (R139)** — Joe Quinto submitted but never voted. Candidate
  pools must be seeded from *submitters*, not voters, or the true answer is
  excluded from the start. A player who never votes leaves no footprint and can
  never be eliminated; the panel says so.
- **The two-fer case (R97)** — six submitters, twelve songs. Pinning a player to
  one song must not evict them from their second.

## Out of scope

- Automatic taste inference (no data to support it).
- Cross-interval linear solving (proven to add nothing).
- Precomputed deduction states (would break arbitrary scenarios, and the data is
  far too small to need it).
- Season-spanning scrub: per-round only.
