# Findings — Historical Digest Comedy / Media Lab

Run 2026-08-30. Text-only; no media generated, no paid API used, nothing wired to
production. Every factual claim is re-checkable via `evidence.sh`.

---

## What we tested

One league (Second Best), one incident, ten short treatments plus one deliberate `NO BIT`,
and one controlled memory experiment. The incident was chosen from an evidence sweep of the
whole corpus (115 rounds, 10,543 votes, 20,740 chat messages) *before* any comedy was
written, per Phase 3.

Formats: Breaking News · Court of Musical Appeals · Previously On… · Receipts · Dramatic
Reading · Attack Ad · Official Correction · Educational Film · Song Autopsy (music) ·
Player Scouting Report (music).

## Historical material used

**Incident 01 — "The Ska Rule."** Five beats, 26 days, three rounds, four sources
(`votes`, `ml_submissions`, `chat_messages`, plus round standings):

1. **2026-08-02, R137** — Mashew downvotes Sarah Zucker's Buck-O-Nine "My Town": *"Ska rule -1, sorry."* The round's only downvote on it.
2. **2026-08-02, chat** — She asks what the rule is, and in the same message names her runner-up: *No Use For A Name*. Four minutes later: *"Dang I didn't know how intensely you disliked ska! Noted."*
3. **R139** — Mashew submits **No Use For A Name** and **wins the round** (15). Sarah Zucker gives it 0: *"I wish I had a point for this song."* Tj gives it 3: *"I am glad punk is still allowed."*
4. **R140** — Tj submits NOFX. Michael Layous votes 1: *"Will Mariani view this as too Ska."* Mashew gives it **3** — tied-highest on his ballot — and says nothing about ska.
5. **2026-08-28, chat** — Chasing a late submission: *"no pressure michael" / "i will even accept ska."*

Secondary: Incident 02 (the Nottingham Tribute, 23 monthly listeners). Calibration:
Incident 03 (`NO BIT`).

## Best examples

1. **Receipts** — the strongest thing in the spike, and the treatment that does the least.
   Four real artefacts in date order, no framing device, no invented line. The setup is in
   chat, the turn is in submissions, the punchline is in a ballot. `"I wish I had a point
   for this song"` is the best line the corpus produced and nobody wrote it as a joke.
2. **Previously On…** — same mechanism, tighter, 14s, and **100% archive** — it contains no
   current-round content at all.
3. **Song Autopsy** — best music-specific result, arrived at by the format *failing*
   (below).
4. **Official Correction** — the most reusable container: it needs an error, not a villain.

## Weak examples

- **Breaking News** — has to explain the situation before it can land. Highest slop risk;
  the most-imitated register in AI comedy.
- **Educational Film** — one great narration line, 27 slow seconds, and a costume that
  would wear out by its third use.
- **Court** — works, but its closing joke is *written* rather than retrieved, which is the
  boundary this spike is trying to stay on the right side of.
- **Dramatic Reading** — funny and the riskiest thing here (a real person's real message,
  read for laughs). Only survives because she comes off well and Matt is the butt.

## What made the best ones funny

**Juxtaposition of two real artefacts across a time gap.** That is the whole mechanism.
Every top-rated treatment is two or more stored rows placed next to each other, and the
distance between them — 21 days, 26 days, two rounds — *is* the joke. The formats that
scored worst are the ones that added the most voice.

The three highest-value retrievals were all **cross-source**: chat→submission,
ballot→ballot, ballot→standings. Nothing good came from a single table.

## What felt like AI slop

Two things, and one of them nearly shipped:

1. **The near-miss stat.** The Scouting Report's first draft opened on *"sixteen rounds,
   sixteen downvotes — he has never once declined to use it."* Devastating-sounding,
   arithmetically true, and completely empty: **every player in the league is n-for-n**,
   because the downvote is compulsory. It described the rules of Music League as a
   personality trait and would have passed a casual read by anyone in the league.
   → **Any stat used as characterisation needs a base-rate gate**: compute it for every
   other player first; if the spread is flat, discard it.
2. **Format costumes.** Breaking News and Educational Film both hit the brief's warning
   about "elaborate framing whose only joke is that it exists." The tell is simple and
   worth encoding: *if the narration is longer than the quoted evidence, the bit is slop.*
   Receipts is ~30% narration; Breaking News is ~70%.

## Effect of historical memory

**The hypothesis is supported, and more strongly than expected — the difference is
feasibility, not quality.** (Full write-up: `memory-comparison.md`.)

Holding round and format fixed and varying only the retrieval window: the local-context
version **has no bit at all**. The funniest artefact in R140 — Layous's *"Will Mariani view
this as too Ska"* — is fully available in local context and is *unusable* there, because
in-round it is a non-sequitur. One 21-day-old ballot line turns it into a punchline.

Two consequences worth carrying forward:

- **Retrieval is the generator, not an enhancement layer.** In the best bits the model
  supplied sequencing and one line of narration. Everything load-bearing was a stored row.
- **Local-only generation is a fabrication risk, not just a quality floor.** A dangling
  quote that *reads* like it should be funny is exactly the pressure that makes a model
  invent the running gag it seems to reference.

And a detection heuristic falls out of it: **a comment that references a rule, a player or
an event with no antecedent in its own round is a strong retrieval signal.** Cheap to
compute, worth testing next.

## Music-specific findings

Detail in `music-specific.md`. The split is clean:

| Source | Yield |
|---|---|
| Vote totals / **counterfactual ballots** | **High** — the best music-only comedy found |
| Vote comments (as text) | High — but that is chat comedy stored in a music table |
| Downvote targeting patterns | Medium — needs the base-rate gate |
| `song_popularity` (listeners) | Medium — occasional single-number bits (23 listeners) |
| `song_audio_features` (bpm/energy/duration) | **None** — inert, patchy, invites over-reading |
| **Genre** | **Does not exist in the schema** |

The headline: **"My Town" finished on 12 points, level with Mashew's own submission. His
was the only downvote it received. Remove it and she finishes above him.** That is comedy
reachable only by arithmetic on the vote table — no chat message contains it and nobody in
the league has noticed it. Generalisable as **the counterfactual ballot**: "what would the
standings be without this one vote."

Also worth stating plainly: **the best incident in the corpus is a dispute about genre, and
genre is the one music attribute the database does not store.** The Ska Rule is legible
only because a human typed the word "ska" into a comment box.

## Data / architecture discoveries

1. **Vote comments are the richest and most underused source in the database.** Four of
   Incident 01's five beats live in them. 35–62 commented ballots per Second Best S2 round.
2. **The existing Storylines section is structurally incapable of this bit.**
   `ui/src/lib/digest/storylineEvidence.ts` already does deterministic, LLM-free evidence
   gathering over chat *and* vote comments, attributed by `player_id` — exactly the right
   substrate. But its window is `chatWindowFor(roundEnd, previousRoundEnd)`
   (`chatSection.ts:35`): **previous round's end → this round's end.** Incident 01 spans
   R137→R140. The mechanism that makes the joke work is the one thing that window excludes.
   Its seeds are also hand-written regex, and `STORYLINE_SEEDS` currently has **one** league
   (`sssc`).
   → **This is the minimally invasive next implementation: widen the window, not build a
   new system.**
3. **No genre data anywhere** (`ml_submissions`, `song_popularity`, `song_audio_features`).
4. **No reply/quote/reaction structure on `chat_messages`**; threading is inferred from
   timestamp adjacency. It worked here (two messages, four minutes apart) and will fail in
   the 11,807-message Boarz group.
5. **No chat↔round linkage** — association is by time window only.
6. **`round_notes` is empty (0 rows).** The obvious home for a persisted named incident
   already exists and has never been written to.
7. **No lore/callback registry**, so nothing prevents reusing a joke. `digest_sections`
   (346 rows) at least makes shipped text searchable for accidental repeats.
8. **Lore documents are unreliable as sources.**
   `design/second-best-player-dossier.md` conflates the two Sarahs — it credits *Sarah S*
   (Sarah Black) with what *Sarah* (Sarah Zucker) said and submitted. A generator trusting
   the dossier over the database would have attributed this entire incident to the wrong
   person. **Fix the dossier; treat lore docs as leads, never as evidence.**
9. **A named-lore lookup is not an incident selector.** "The Frank Black Embargo" is listed
   in the dossier as a running joke; the data shows two messages eight minutes apart. The
   filter that catches it is trivial — *fewer than three distinct evidence rows, or a span
   under one round → NO BIT.* Incident 01 clears that bar by an order of magnitude.

## Formats worth continuing

Ranked, with the caveat that these are **mechanisms wearing format names** — see the next
spike:

1. **Receipts** — cross-source contradiction, date-ordered, zero invented text.
2. **Previously On…** — same mechanism; better for video, worse for text. Ship one, not both.
3. **Official Correction** — most reusable; degrades gracefully; needs only an error.
4. **Counterfactual ballot** (currently living inside Song Autopsy) — the one genuinely
   music-native mechanism found. Should be promoted out of the autopsy framing and tested
   on its own.

## Formats not worth continuing

- **Breaking News** — needs setup, highest slop risk.
- **Educational Film** — one-off at best, costume by use three.
- **Attack Ad** — good here, but only survives because every beat is a citation; one
  invented beat makes it mean *and* unfounded. High-maintenance, narrow.
- **Voice cloning / player impressions** — recommend dropping entirely. The Dramatic
  Reading is better as a neutral archivist read than as an impression, and the neutral
  version has none of the risk. This answers the brief's persona question without needing
  a voice API at all.
- **Court** — enjoyable, but its punchline came from the model rather than the league.
  Park it.

## Success criteria — answers

- *Which formats deserve another experiment?* Receipts / Previously On…, Official
  Correction, and the counterfactual ballot.
- *Which should be abandoned?* Breaking News, Educational Film, voice cloning; park Court
  and Attack Ad.
- *Did historical retrieval materially improve jokes?* It didn't improve them — it was the
  precondition for them existing.
- *Did music/voting data yield comedy unavailable from chat alone?* Yes, once: the
  counterfactual ballot. Audio features yielded nothing.
- *Can an incident-selection step filter weak material?* Yes, and cheaply — the `NO BIT`
  call took one query.
- *Can output stay concise?* Yes. Best two are 21s and 14s. The weakest are the longest;
  duration correlated inversely with quality across all ten.
- *What data is missing?* Genre; chat reply/quote structure; chat↔round linkage; a callback
  registry.

## Recommended next spike

**Do not implement production features yet.** Per the brief's own guidance, the thing to
test next is whether the *mechanism* generalises — not whether "receipts are good."

**Spike 2 — "Does the contradiction exist at scale?"** Take the two mechanisms that
actually did the work (cross-source contradiction across a time gap; counterfactual
ballot) and run detection-only — **no comedy generation at all** — across every completed
round in Second Best, Boarz II Men and sssc. Output a ranked incident sheet and answer:

1. **How often does qualifying material occur?** The brief's own strong-result hypothesis
   ("only 20–40% of rounds") is the thing to measure. Incident 01 might be the best moment
   in three leagues of history, in which case none of this is a weekly feature.
2. **Can incidents be ranked before generation?** Test the proposed cheap filter (≥3
   distinct evidence rows, span ≥1 round, ≥2 sources, contradiction present) against a
   hand-rated sample.
3. **Does the dangling-reference heuristic work?** Detect comments referencing a rule /
   player / event with no antecedent in their own round; check the hit rate.
4. **How wide does the retrieval window need to be?** Incident 01 needed 26 days. Test
   30 / 60 / season.

Scope it as detection over existing tables — most likely a widened, seedless variant of
`storylineEvidence.ts` run offline — with a rated output sheet. If it finds fewer than
~5 qualifying incidents across three leagues, the honest recommendation is a
**hand-curated occasional bit during punch-up**, not an automated section.
