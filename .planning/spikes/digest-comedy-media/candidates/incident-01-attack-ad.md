---
format: attack_ad
incident: incident-01
beats_used: [1, 4, 5]
beats_dropped: [2, 3]
source_facts:
  - "R137 ballot: 'Ska rule -1, sorry' (exact) — the round's only downvote on that song"
  - "R140 ballot: NOFX, 3 points, tied-highest on his card"
  - "2026-08-28T04:02:30Z chat, Matt Mariani: 'i will even accept ska' (exact), sent while chasing a late submission from Michael Layous"
  - "'My Town' finished on 12, level with Mashew's own 'Norf Norf' (12). Without his -1 it finishes 13."
callback: "beat 1 → beat 5, twenty-six days"
estimated_duration_seconds: 24
specificity: 3
---

# Attack Ad

> Player quotes **verbatim**. The disclaimer at the end is parody and is labelled as such
> in the render.

```
[GRAINY BLACK AND WHITE. SLOW ZOOM ON AN ALBUM COVER.]

VO:  Mashew says he has standards.

     [VERBATIM]  "Ska rule -1, sorry"

VO:  One downvote. The only one that song got.
     It finished the round tied with his own submission.
     Without him, it beats him.

[COLOUR SNAPS IN]

VO:  Three weeks later — NOFX. Horns and all.
     Mashew gave it three points.
     Tied for the most he gave anybody that night.

[BEAT]

VO:  And on August twenty-eighth, chasing a submission he needed,
     Mashew wrote:

     [VERBATIM]  "i will even accept ska"

[HARD CUT TO BLACK]

VO:  Mashew. He'll take ska.
     When it's for him.

[SMALL TYPE, HELD ONE SECOND]
     Not actually paid for by Sarah Zucker, who is still down one point.
```

## Why this format fits
Attack ads run on hypocrisy, and this is the only incident in the corpus with a
documented, dated, three-point hypocrisy chain. The format's native move — "he says X,
but the record shows Y" — is *exactly* the retrieval the database is good at. The
disclaimer gag also solves the attribution problem honestly: it names the injured party
without putting words in her mouth.

The strongest line is the vote-math one ("without him, it beats him"), and that line is
not comedy writing at all — it is a `sum(points)` with the downvote removed.

## Reservations
Highest tone risk in the set. Attack-ad voice is one notch away from the generic "roast"
register the brief warns about, and it only stays on the right side of the line because
every accusation is a citation. The moment one beat is invented, this becomes mean and
unfounded at the same time. Rule: **this format may only ever be assembled from exact
quotes.** If a beat can't be quoted, cut the beat, not the citation.
