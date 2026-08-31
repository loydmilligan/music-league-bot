---
format: none
incident: incident-03
verdict: NO BIT
estimated_duration_seconds: 0
specificity: n/a
---

# NO BIT — "The Frank Black Embargo"

## Output

```
NO BIT.

Material: two chat messages, eight minutes apart, 2026-08-01.
No contradiction. No consequence. No recurrence. No callback.
The joke was already made, by a player, in one line.
```

## Why this is a result and not a gap

`design/second-best-player-dossier.md` lists **"The Frank Black Embargo"** under *Running
Jokes & Recurring Bits*, alongside the Ska Rule and the Babu Deposition. It has a name. It
is in the lore document. It looks exactly like the raw material this spike is hunting for.

The entire evidentiary record is:

```
2026-08-01T15:56:44Z  ~ bp   Frank Black didn’t make the playlist?
2026-08-01T16:04:57Z  ~ JB   Maybe a casualty of the trade war. Embargo on Frank Black.
```

That is all of it. It never recurs. Nobody references it again. It is not a running joke;
it is one good line that got written down in a summary and thereby acquired a title.

Any treatment — court, breaking news, documentary — would have to inflate eight minutes of
chat into twenty seconds of framing, which means the framing *is* the content. That is the
precise definition of the brief's slop signal: *"elaborate video whose only joke is that it
exists."*

## What it proves

Two things, both load-bearing for the next spike:

1. **A named-lore lookup is not an incident selector.** The dossier and
   `relationship_contexts` are LLM-written summaries; they promote lines to "bits" on
   vibes. Selection has to run on *evidence count* — number of distinct sources, span in
   days, number of players involved, presence of a contradiction — not on whether
   something has a label.
2. **The `NO BIT` verdict is cheap and reliable.** Deciding this took one query. The
   filter that would have caught it is embarrassingly simple: *fewer than three distinct
   evidence rows, or a span under one round → NO BIT.* Incident 01 clears that bar by an
   order of magnitude (11 evidence rows across 26 days, 3 rounds, 2 tables plus chat).
