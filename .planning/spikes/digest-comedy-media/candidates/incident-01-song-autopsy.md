---
format: song_autopsy
incident: incident-01
music_specific: true
beats_used: [1]
source_facts:
  - "Buck-O-Nine 'My Town', R137, submitted by Sarah Zucker"
  - "duration_s 224.14 | bpm 85.2 | energy 34.6 — second-lowest energy of the 12 songs in the round"
  - "44,883 monthly listeners, Spotify popularity 48 — mid-pack for the round"
  - "Finished 4th of 12 on 12 points, from 7 scoring voters (9 ballots cast: 7 positive, 1 zero, 1 downvote)"
  - "Exactly one downvote in the whole round: Mashew, 'Ska rule -1, sorry'"
  - "Mashew's own submission that round, 'Norf Norf', also finished on 12"
callback: "The autopsy's finding is only meaningful next to beat 4 (he later scores NOFX a 3)."
estimated_duration_seconds: 23
specificity: 3
---

# Song Autopsy — Buck-O-Nine, "My Town"

> Every number is read straight from `song_audio_features`, `song_popularity` and `votes`.
> The only quoted player text is the vote comment, verbatim.

```
[COLD ROOM. SINGLE OVERHEAD LIGHT. CLIPBOARD.]

CORONER:
    Subject: "My Town." Buck-O-Nine.
    Three minutes forty-four. Eighty-five beats per minute.
    Energy: thirty-four out of a hundred — second-lowest in the round.
    Forty-four thousand monthly listeners. Unremarkable.

    [BEAT]

    Cause of death.

    [LONGER BEAT]

CORONER:
    There isn't one.

    Seven voters scored it. It finished fourth of twelve on twelve points —
    level with the song submitted by the man who downvoted it.

    [VERBATIM, THE ONLY DOWNVOTE IN THE ROUND]
        "Ska rule -1, sorry"

CORONER:
    Remove that one point and it finishes above him.

    [BEAT]

    The subject was in good health.
    Somebody just didn't care for the genre.
```

## Why this format fits — and why it matters more than the joke
This is the music-specific test the brief asked for, and the interesting result is that
**the format failed and the failure was better than the success.** "Song Autopsy" assumes
a corpse. The data refused: the song did fine. What the numbers actually revealed, once
queried honestly, is the sharpest fact in the entire incident — *the downvote is the sole
reason Sarah Zucker finished level with Matt instead of ahead of him.*

No amount of chat reading produces that. It requires `sum(points)` with one row removed.
It is the clearest evidence in this spike that **music/voting data yields comedy that chat
alone cannot** — and specifically that the comedy is in *counterfactual arithmetic*, not
in audio features.

The audio features themselves (bpm, energy, duration) did almost no work here. They are
texture. The vote arithmetic is the joke.

## Reservations
Needs a generator willing to report "no finding" and pivot, which is the hardest behaviour
on this whole list to make reliable. A version that forced the autopsy premise to work
would have had to invent a cause of death — i.e. lie about the data — and would have been
both unfunny and wrong.
