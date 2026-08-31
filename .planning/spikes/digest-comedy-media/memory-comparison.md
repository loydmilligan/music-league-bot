# Phase 6 — The Memory Experiment

**Hypothesis under test:** league-specific historical memory and callbacks create more
durable humour than generic generation.

**Design.** Fix the round, fix the format, vary only the retrieval window. Round **140**
("More Cowbell!", voting closed 2026-08-23) is the target because its most quotable
artefact — Michael Layous's ballot comment — sits in that round, so a local-context
generator has full access to it. Format is held at `breaking_news` for both versions.

- **Version A** — R140 only: its 13 submissions, its 123 votes and comments, and chat from
  the round's own voting window.
- **Version B** — the same, plus prior rounds, prior ballots, and chat back to R137.

---

## Version A — local context only

Everything below is available in R140 and nothing else was used.

```
[STING]

ANCHOR:
Tj submitted NOFX. It finished fourth of thirteen with thirteen points
and took no downvotes at all.

Michael Layous gave it one point and wrote:
    "Will Mariani view this as too Ska"

Mashew gave it three.
```

**Assessment: this is not a bit. There is no joke in it.**

That is the finding, and it is stronger than "Version A is weaker." The funniest sentence
in the round — Layous nervously checking a genre rule with the man who invented it — is
sitting right there in the local context, fully quotable, and it **cannot be used**,
because in-round it is a non-sequitur. Who is Mariani to have a view? What ska? Why is a
voter asking permission?

A local-context generator has three options, all bad:
1. Quote it and leave it dangling (above — inert).
2. Drop it and report the standings (no comedy at all).
3. **Invent a reason it's funny** — and this is the real hazard. The line *reads* as
   though it should be a joke, which is exactly the pressure that makes a model
   confabulate a running gag that never happened. Local context doesn't just lose the
   joke; it actively baits fabrication.

## Version B — historical context enabled

```
[NO STING. TEXT CARDS.]

August 2. Mashew downvotes a Buck-O-Nine song:
    "Ska rule -1, sorry"

August 23. NOFX. Horns. Michael Layous votes, and hedges:
    "Will Mariani view this as too Ska"

Mashew gives it three points. Tied for the most he gave anyone that night.
He says nothing about ska.

[BEAT]

Layous was obeying a law that had already been repealed.
He was not informed.
```

**Assessment: this works, and it is the same twelve words of Layous.** Nothing was added
to the round. One 21-day-old ballot line was retrieved, and the inert quote became the
punchline.

---

## Result

**Hypothesis supported, with a sharper conclusion than expected.**

The expected result was a *quality* difference — B funnier than A. The actual result is a
*feasibility* difference: **B has a bit and A does not.** The material in R140 is not
mildly improved by history; it is unreadable without it. The joke was never in R140. It
was in the 21-day gap.

Three consequences:

1. **Retrieval is not an enhancement layer, it is the generator.** In this incident AI
   supplied only sequencing and one line of narration. Every load-bearing element —
   setup, turn, punchline — is a stored row. This is the brief's "the league supplies the
   joke" principle showing up as an engineering fact rather than an aesthetic preference.

2. **The best signal for "there is a bit here" is a quote that is inert in its own round.**
   Layous's comment is a dangling reference: it presupposes context the round doesn't
   contain. That is a *detectable* property, and a cheap one — a comment referencing a
   named rule, a player, or a prior event that has no antecedent in the current round is a
   strong candidate for retrieval. Worth testing as an incident-selection heuristic in the
   next spike.

3. **Local-only generation is a fabrication risk, not just a quality floor.** See option 3
   above. This argues against ever running a comedy format on a round-scoped context
   window, even for cheapness.

## Caveat

n = 1. This is one incident in one league, deliberately chosen because it was the richest
in the corpus. It demonstrates that retrieval-dependent comedy *exists* and is *much*
better; it says nothing yet about how often such material occurs. That frequency question
is the whole subject of the recommended next spike.
