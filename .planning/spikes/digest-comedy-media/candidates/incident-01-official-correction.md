---
format: official_correction
incident: incident-01
beats_used: [1, 4]
beats_dropped: [2, 3, 5]
source_facts:
  - "Second Best has no written rulebook containing a genre statute; the phrase 'Ska rule' appears in the corpus exactly twice, both times in vote comments (E1, E5)"
  - "Matt Mariani is the league commissioner (design/second-best-player-dossier.md; corroborated by him assigning themes and chasing submissions in chat)"
  - "The window between the two ballots is 2026-08-02 → 2026-08-23"
  - "Michael Layous, R140: 'Will Mariani view this as too Ska' (exact) — he did not vote on the original song"
callback: "beat 1 → beat 4"
estimated_duration_seconds: 19
specificity: 3
---

# Official Correction

> Institutional voice. **The document is parody**; the two facts it corrects are real,
> and the quoted ballot line is verbatim.

```
[NO MUSIC. ONE PAGE. LETTERHEAD.]

VO [FLAT, ADMINISTRATIVE]:

    A correction from the Office of the Commissioner.

    A ballot filed in Round 137 referred to "the Ska Rule."

    Second Best does not have a Ska Rule.
    Second Best has never had a Ska Rule.
    No such rule was proposed, discussed, ratified, or written down.

    [BEAT]

    The Office regrets that between August second and August twenty-third,
    at least one player altered his vote in anticipation of it.

    [VERBATIM, R140 BALLOT]
        "Will Mariani view this as too Ska"

    [BEAT]

    The Office notes that the Commissioner is also the voter who filed
    the original ballot.

    No further action will be taken.
```

## Why this format fits
The best institutional bits are the ones where the institution is investigating itself and
declining to do anything about it — and here that is literally true, because Matt is both
the commissioner and the defendant. That is a fact from the league, not a comic device
someone bolted on.

It is also the most **reusable** shape in the set. "The Office corrects the record" is a
container that takes any factual discrepancy the digest pipeline finds — a misremembered
score, a rule nobody agreed to, a stat a player got wrong in chat — and it degrades
gracefully: if the discrepancy is small, the bit is just short. Formats like `court` and
`attack_ad` need a villain; this one needs only an error.

## Reservations
Deadpan-institutional is very close to the established Chad register in
`design/digest-flavor.md`. Two dry authorities in one digest is one too many. If this
format ships, the relationship to Chad has to be decided first — is the Office *Chad's*
office, or a second voice? Left open deliberately; it is a house-voice decision, not a
spike finding.
