# Design Brief — Mid-Round Shareable: Fan/Hater + Voting-Habits Piece

**For:** Claude Designer (CD) · **From:** CC / Matt · **Date:** 2026-08-29
**Task type:** exploratory small asset(s) for WhatsApp, not a UI screen. This is a
brainstorm-through-mockup pass — CD should propose several genuinely different concepts, not one
polished piece. The design system will be supplied separately in the CD session; this brief
deliberately contains no visual direction.

---

## 1. What this is

A short, shareable content piece (or small connected set) posted **mid-round**, between
submission close and results, into the "Boarz II Men" WhatsApp group (10 players, profane-comedy
register — see the group's actual round names in the data for tone calibration: "I Hope You Shit
Your Pants at Target", "Smells Like Teen Cousin Fuckers"). It's a stats/culture break, not a
functional UI — same spirit as the group's existing "Boarz Tape" recap page, but small, single-
image (or short set), built for a chat bubble.

It draws on **historical voting data across all completed rounds to date** — not the in-progress
round (those votes don't exist yet). Think of it as "here's what we already know about how this
league treats each other" dropped in as a mid-round teaser/palate-cleanser.

## 2. The three exploration threads (from Matt, verbatim intent)

1. **Fan/Hater per person** — some visual expression of "how likely is [Person] to be a fan vs. a
   hater" — of the league in general, or of specific people, or both. Open how this reads: a
   single score per person, a per-pair relationship, a spectrum, a leaderboard, a portrait-style
   card per player — CD's call.
2. **Voting-habits grid** — a matrix/grid of who-votes-for-whom, using **brightness/darkness** to
   encode the vote signal (Matt's own words). Read literally: light = positive, dark = negative,
   or some other brightness-based encoding — CD should interpret and can deviate if a better idea
   emerges.
3. **Downvotes need their own visual language** — Matt specifically flagged that upvotes and
   downvotes probably shouldn't share one visual channel (e.g. not just "less bright" for a
   downvote) — they may deserve a genuinely distinct treatment (color split, icon, texture,
   separate layer) so a downvote reads as qualitatively different, not just "a smaller upvote."
4. **Interpolating up/down votes against another data dimension.** Matt's answer to his own
   question: **a contrarian/consensus-opposition signal, computed per person per round.** For
   every ballot, we know that song's consensus (the average of everyone ELSE's votes on it that
   round) — so we can score how much a person's vote diverged from the room, per round. This is
   now precomputed in the data packet as `contrarianByRound` (see §3) — one row per person per
   round they voted in, both signed (systematically harsher/more generous than the room) and
   absolute (how much of an outlier, regardless of direction) versions, plus a season rollup.
   This is a strong, concrete candidate for the "second dimension" — at least one concept should
   use it. Other dimensions (round theme, chronology, comment sentiment/length) remain open if a
   different angle is more visually interesting.

These four threads can become **one unified piece, two, or several** — CD's structural call. They
share a data source so a "family" of related pieces (a fan/hater card AND a matrix, sharing style)
is reasonable if it's the strongest answer.

## 3. Data available (real, not mock) — see `voting-habits-data.json`

Every completed Boarz round to date, aggregated:
- `people[]` — the 10 real player names (their in-league display names).
- `pairwise[]` — all 90 directed voter→submitter relationships: `upvotePoints`, `downvotePoints`,
  `netPoints`, `ballotCount` (how many times that pair happened), `leanScorePerBallot` (net ÷
  count — a simple per-relationship "how they tend to treat this person" number).
- `perPersonSummary` — for each person, as **voter** (their personality: total ballots cast,
  points given, downvote vs upvote ballot counts, avg points per vote) and as **submitter**
  (how the league treats them: same shape, received side).
- `sampleComments` — optional flavor texture: the 6 harshest real downvote comments and 6 warmest
  real upvote comments, with who said what to whom. Not required for the core visual; useful if a
  concept wants a quote treatment.
- `contrarianByRound.rows[]` — **per person, per round they voted in**: `ballotsCompared`,
  `avgSignedDeviation` (positive = scored more generously than the room that round, negative =
  harsher), `avgAbsDeviation` (0 = always agreed with the room's consensus; high = frequent
  outlier regardless of direction — a "maverick" reading). Computed per-song consensus excludes
  the person's own ballot, so their vote can't dampen its own comparison point. Only songs with
  2+ ballots counted.
- `contrarianByRound.seasonRollup` — the same two numbers averaged across the whole season, per
  person, for a one-line "most contrarian all season" read.
- League context: `league.roundsCounted`, `league.totalBallots`.

**Honest data notes:**
- Music League scoring is weighted points (e.g. +3/+2/+1 style upvotes, negative penalty points),
  not simple thumbs — both point totals and raw ballot counts are provided so a concept can use
  whichever encodes better visually.
- A submitter can leave a 0-point comment on their own song during voting; those rows are
  excluded from the matrix (not a real preference signal).
- This data is NOT anonymous — round results and who-submitted-what are public once voting
  closes, unlike the in-progress-round submission anonymity the league otherwise protects. Safe
  to show real names throughout.
- No avatar images exist for this league yet (`player_avatars` table is unpopulated) — treat
  names/initials/a per-player color as the reliable identity signal. (assumption: text/initial
  treatment is fine; if CD wants avatars, flag it as a dependency, don't invent faces.)

## 4. Display context (hard facts)

- WhatsApp media message — image on top, short caption below, in an active group chat.
- Must read on a phone screen at chat-bubble size AND hold up if someone opens it full-screen.
- 1:1 is the safe default (matches the existing YTM-cover work in this repo) but is not mandated
  — a wider format is fine if the concept benefits (e.g. a genuine matrix/grid might want more
  width than a square gives it). State the aspect ratio chosen and why.
- One-off or occasional cadence — this is NOT a weekly automated asset like the YTM cover
  (different task, different repo location). No requirement that it regenerate untouched; a
  human (Matt, via CC) will trigger and review each time it's posted. Static/manual generation is
  fine; programmatic regeneration is a nice-to-have, not a constraint.

## 5. What we need back

Several distinct concepts (not incremental variations of one idea) covering the threads in §2,
each with:
1. Name + one-paragraph idea.
2. Which fields from §3 it consumes.
3. A worked mock using the REAL data in `voting-habits-data.json` (all 10 real Boarz names).
4. How it would extend/repeat for a future mid-round drop (does the layout still work with
   different relative numbers next time, or is this a one-off?).

## 6. Decision points

- **D1 [Proposed by CC]: One piece or a family?** A single hero image vs. 2–3 related pieces
  (e.g. fan/hater card + separate matrix) sent as one message or a short sequence. Affects scope
  and whether they need a shared visual system.
- **D2 [Required — from team]: Is "fan/hater" about how a person votes (their personality) or
  how the league treats them (their reception), or both?** The data supports either lens
  (`asVoter` vs `asSubmitter`) or a combined view (e.g. "biggest hater" = most downvote-heavy
  voter; "most hated" = most downvotes received). Genuinely ambiguous from Matt's framing — CD
  should pick a stance per concept and say which.
- **D3 [Proposed by CC]: Points or ballot counts (or both) as the primary signal?** Raw point
  totals reward big single swings; ballot counts reward consistency/frequency. Different concepts
  can make different choices; state which per concept.
- **D4 [Proposed by CC, largely resolved]: use `contrarianByRound` as the interpolation
  dimension for at least one concept** — but whether it renders as a per-round column/timeline
  (Matt's own framing: "a column for each person for each round"), a single season-long score, or
  something else is open.

## 7. Out of scope

- Any automation/regeneration pipeline (unlike the weekly YTM cover work) — this is a
  design/content exploration first; a build script comes later if a concept is adopted for
  recurring use.
- Redesigning the Boarz Tape digest page itself.
