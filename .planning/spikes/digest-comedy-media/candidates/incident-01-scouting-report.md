---
format: player_scouting_report
incident: incident-01
music_specific: true
subject: Mashew (Matt Mariani)
source_facts:
  - "17 Second Best submissions; voted in 16 rounds"
  - "Has downvoted 11 different players. Has never downvoted missmara — the most-exposed player he has never downvoted (0 for 15)."
  - "Highest downvote rate against a regular: Sarah S, 3 of 15 (20%)"
  - "Both Sarahs in the league have been downvoted by him (Sarah S ×3, Sarah Zucker ×1)"
  - "Stated reasons are rarely musical: 'no thank you', 'Still don't appreciate', 'Nope', 'Too jokey', 'Ska rule -1, sorry' (all verbatim)"
  - "Twice he has stated in the comment that the choice was arbitrary: 'Flipped a tuna can and landed on edge' (R111) and 'Try and look at it like you won the downvote lottery' (R133)"
  - "Lowest average monthly-listener count of any 15+ submission regular: ~215k"
callback: "Frames beat 1 as a habit rather than an incident."
estimated_duration_seconds: 26
specificity: 2
---

# Scouting Report — Mashew

> Sports-desk register. All figures computed from `votes` / `ml_submissions` /
> `song_popularity`; all quoted ballot text verbatim.

```
[STUDIO. TWO ANALYSTS. FREEZE-FRAME ON A SPOTIFY SCREENSHOT.]

ANALYST 1:
    Seventeen submissions. Digs deeper than anyone who's played a full season —
    lowest average listener count of any regular in the league.

ANALYST 2:
    Sure. But look at the downvote.

    [GRAPHIC: 11 PLAYERS DOWNVOTED]

ANALYST 2:
    Eleven different players. Highest rate against Sarah Black — three of fifteen.
    He's downvoted both Sarahs in this league.

ANALYST 1:
    And the reasons?

ANALYST 2:
    Mostly not about music.

    [VERBATIM BALLOT COMMENTS, RAPID]
        "no thank you"
        "Still don't appreciate"
        "Nope"
        "Too jokey"
        "Ska rule -1, sorry"

ANALYST 1:
    Twice he's admitted on the ballot it was random. Quote —
        "Flipped a tuna can and landed on edge"

    [BEAT]

ANALYST 2:
    One player has never taken a downvote from him in fifteen chances.

ANALYST 1:
    Who?

ANALYST 2:
    His wife.

[FREEZE]
```

## Why this format fits
Player tendencies are the one thing the database is unambiguously better at than any
human in the league. Nobody has read all 10,543 ballots; the query has. The closing beat
(0 for 15 on missmara) confirms from data a thing the league already jokes about — the
dossier calls it the "conjugal vote pipeline" — which is the ideal shape: **the league
supplied the premise, the database supplied the proof.**

## Reservations — and one that nearly shipped a lie
The first draft of this bit led with: *"Sixteen rounds, sixteen downvotes — he has never
once declined to use it."* It reads as a devastating character stat. **It is meaningless.**
Every single player in Second Best has cast exactly one downvote in every round they voted
in — 16/16, 15/15, 14/14, all the way down to 1/1. The downvote is compulsory, so the
"stat" describes the game's rules, not the man.

It survived until it was checked against every other voter, and it would have survived a
casual read by anyone in the league. Logged here because it is the concrete form of the
brief's AI-slop warning: **a statistic that is structurally true of everyone, presented as
personal.** Any stat-driven format needs a base-rate check as a hard gate, not a
nice-to-have.

Rated specificity 2, not 3 — this is repeated-behaviour comedy, no archival callback.
