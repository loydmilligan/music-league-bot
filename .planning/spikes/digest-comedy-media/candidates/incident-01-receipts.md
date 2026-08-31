---
format: receipts
incident: incident-01
beats_used: [1, 2, 3]
beats_dropped: [4, 5]
source_facts:
  - "2026-08-02T04:49:47Z, chat, Sarah Zucker: 'Mash what is the ska rule!? Automatic downvote?' … 'My runner ups were No Use For A Name's Fairytale of New York or Frank Sinatra's Chicago.' (exact, one message)"
  - "2026-08-02T04:53:18Z, chat, Sarah Zucker: 'Dang I didn't know how intensely you disliked ska! Noted.' (exact)"
  - "R139 'They Dead': Mashew submits No Use For A Name — 'Not Your Savior' — and wins the round with 15 points"
  - "Sarah Zucker's ballot on it: 0 points, 'I wish I had a point for this song.' (exact)"
callback: "Two rounds and fourteen days. The band is named by the victim before the perpetrator uses it."
estimated_duration_seconds: 21
specificity: 3
---

# Receipts

> Every line of player text below is **verbatim from the database**. There is no invented
> dialogue in this treatment at all — the narration only supplies dates.

```
[NO MUSIC. TEXT ON BLACK, ONE CARD AT A TIME.]

August second.
Sarah Zucker, in the chat, asking what the Ska Rule is.
In the same message, unprompted, she lists what she almost submitted instead:

    "My runner ups were No Use For A Name's Fairytale of New York
     or Frank Sinatra's Chicago."

Four minutes later:

    "Dang I didn't know how intensely you disliked ska! Noted."

[BEAT]

Two rounds later, Mashew submits No Use For A Name.

He wins the round.

[BEAT]

Sarah Zucker gave it zero points.

    "I wish I had a point for this song."
```

## Why this format fits
This is the strongest candidate in the spike and the format is doing the least work of
any of them. There is no premise, no voice, no framing device — four real artefacts in
date order, and the joke assembles itself in the viewer's head. It cannot be written
without cross-source retrieval: the setup is in `chat_messages`, the turn is in
`ml_submissions`, the punchline is in `votes`. No generic comedy engine has access to
this and no player in the league has noticed it, because noticing it requires reading a
three-week-old chat message against a later ballot.

`"I wish I had a point for this song"` is the best line the corpus produced and nobody
wrote it as a joke.

## Reservations
Genuinely none about the writing. Two about the mechanism:
- It depends on a coincidence this good existing, which is the open question the next
  spike has to answer (how often?).
- It is at Sarah Zucker's expense as much as Matt's, and she is the one person in the
  incident who did nothing wrong. Punching-down check before this ever ships.
