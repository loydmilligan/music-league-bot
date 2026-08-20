# Rulecard — SSSC (slug: sssc)

Derived 2026-08-17 from ballots R154–R166 (S5–S6) + R166 chat. Load this
before writing ANY digest content for this league. Numbers in digest copy
must be recomputed from `votes`, never inferred. Items marked UNRESOLVED
need Matt's confirmation.

## Voting mechanics
- Each voter files ONE ballot, all at once. Vocabulary: the league calls
  points **"updoots."**
- Budget: **S5 = 43 updoots** per voter (R154–R159). **S6 started at 30**
  (R160–R163), then **33 from R165 on** — the council "added exactly 3 more
  updoots as a treat" after missmara raised it (R166 chat; MrKlorox: "but
  that's socialism!"). Round overrides for R160–163 live in
  `voting_lab_budget`; every observed ballot spends the budget exactly.
- Downvotes: **NONE. This league has never cast a negative point** (0
  downvotes across all 12 observed rounds). NEVER write copy that says a
  song was "downvoted" — a low score here means it was not chosen, not
  that it was voted against. (The R166 draft's "a solitary downvote" line
  is exactly this error.)
- Per-song max: no cap evident — single votes up to 8 observed.
  UNRESOLVED: confirm no formal cap.
- A comment with no points is neutral commentary.

## No-vote penalty
UNKNOWN — no non-voting submitter observed yet in imported rounds.
UNRESOLVED: ask Matt / watch for the first occurrence.

## Tiebreakers (round), in order
Confirmed by Matt 2026-08-20: **this cascade is the same in every league** — it
was only ever written down for Second Best because that's where a tie first
forced the question.
1. Total points (upvotes + downvotes).
2. More upvoters wins.
3. Fewer downvoters wins.
4. Vote weight sequence, compared highest→lowest until a difference.
If still tied: shared rank, listed alphabetically.

NOTE: with no downvotes in this league, steps 3 and 4 do most of the work.
R166's ties at 35/30/29/28 predate this being encoded.

## Data / pipeline notes
- Rounds arrive by **zip import** (`data/sssc/season-N/export.zip`);
  imported rounds have NULL deadlines — backfill `voting_deadline` from
  MAX(vote ts) or the chat section can't window. Re-imports re-null and
  can duplicate an in-progress round on capitalization drift (R164
  "Time is a Shark" stub vs R165 "Time is a shark"; merged 2026-08-17).
- Chat: Discord, group "sssc".

## Voice / conventions
- Names: missmara=Mara Mariani, Boonie Dogsweat=Dogsweat, GoodGollyMiss,
  socalledbutton, Mouse Atreides, Tragically Skip, Timmywhatup, KarBen,
  antigravpjs, jirafa, nateoeb, bagimation, Aniss, Kelly Jean, MrKlorox.
- The Guesser section is ON for this league ONLY (Dogsweat guesses every
  song weekly; creative nicknames need LEAGUE_ALIASES).
- Regulars seeds: 8 SSSC seeds + KarBen (commits fe3bb42/adce96b).
