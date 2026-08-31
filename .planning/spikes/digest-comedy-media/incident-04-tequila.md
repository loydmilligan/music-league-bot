# Incident 04 — The Tequila Affair

**League:** Boarz II Men · **Round 145, "¡No Entiendo, Cabrón!"** (theme: *songs must
contain vocals entirely or mostly in a language other than English*) · voting closed
2026-08-01.

Selected as the second test incident because it is structurally different from Incident 01
(the Ska Rule): the contradiction is **inside a single round** rather than across three,
and the aggrieved party is a newcomer rather than a regular. Every quote below is verbatim
from `data/league.db`; re-check with `evidence.sh --incident 04`.

---

## The spine

Jimmy Troy — new to the league — submitted **The Champs, "Tequila"**, comment:
*"Big Pee Wee Herman fan here."* It is an instrumental whose only vocal is the word
*tequila*. It finished on **0 points** with four downvotes.

Conor Johnston (`CJ Wookie`) downvoted it with a 45-word sermon about effort. **In the same
round, on the same ballot sheet, he submitted a song he cannot identify**, and finished
last — two points below the man he had called ignorant.

### The two quotes that make the bit

| | |
|---|---|
| **His downvote on Jimmy** | *"This competition is one big joke to you, eh? A gag for you to poop on? The rest of us put thought into this, effort. And you come here why? To mock us for caring? To flaunt your ignorance?"* |
| **His own submission comment, same round** | *"I have no idea to this day what those 2 Italian ladies were signing about. Truth is, I don't want to know. Some things are best left unsaid."* |

The theme was *lyrics not in English*. He is boasting about not knowing the lyrics.

### He also submitted the wrong song

`Con Te Partirò` is a Bocelli solo. The duet with two voices is a different recording.
Dave Jensen caught it on his ballot:

> *"Which one of ladies was supposed to be Andrea bocelli? Feels a lot more like the fuckin
> Catalina wine mixer to me. I would have upvoted this to the max with the correct song to
> go with the description"*

### The scoreboard punchline

| Song | Submitter | Points |
|---|---|---|
| Tequila — The Champs | Jimmy Troy | **0** |
| Con Te Partirò — Andrea Bocelli | **Conor Johnston** | **−2** — last of 10 |

Grant Koziol's entire review of Conor's song: *"Fuck you"* (−2).
Jonathan Black's: *"Andrea Bocelli is the Appleby's of opera singers."*
**Jimmy Troy gave Conor's song +1.**

### He sentences himself

Chat, 2026-08-01T04:53:16Z, Conor:

> *"I went pretty hard after Tequila. Then it beat me. Soooo...I should keep my lard ass
> mouth closed."*

And Jimmy, 24 minutes earlier:

> *"Tequila was a strong entry for that round. I feel like I was hazed as a rookie with some
> of those downvotes. It's cool tho I get it…."*

---

## The bylaws thread (source for the Official Correction bit)

The league spent days litigating whether the submission was even legal:

| When | Who | Text |
|---|---|---|
| 2026-07-29T01:34:57Z | Matt Mariani | *"Jb brought up an interesting question, is tequila an English word"* |
| 2026-07-29T01:41:14Z | Dave | *"I did check with chatgtp on the origins of tequila - he said it it not english"* |
| 2026-07-29T01:42:25Z | Dave | *"I thought tequila is top pick but everyone appears to be bagging it"* |
| 2026-07-29T01:42:34Z | Jimmy | *"Definitely is an English word. Else what do you call tequila in English?"* |
| 2026-07-29T01:45:25Z | JB | *"I guess the question is - is tequila a non-English word?"* |

**The submitter argued the position that disqualifies his own song, and nobody ever ruled.**

Jonathan Black's ballot is itself a written judgment — an itemised rubric netting to zero:

> *"+3 because Pee Herman was a comedy genius. -1 because this song may or may not be
> non-English, -1 because it is too well known, and -1 because it only has one word. Still,
> assuming this was Conor's pick, a vast improvement over his Week 1 selection."*

(He misattributes it to Conor. Conor's Week 1 pick — Alan Jackson, *"Where Were You"* —
finished **−4, last of 9**. Conor has now finished last twice.)

---

## Why this incident is better source material than the Ska Rule

1. **The contradiction is same-round.** No 26-day retrieval needed — two fields on one
   ballot sheet. Much cheaper to detect, and it answers a real doubt from spike 1 about
   whether the mechanism needs a wide window. It doesn't always.
2. **It has a victim and a villain, and they are different people.** Your rating note on
   the attack ad said the thing that works is *"a specific player doing something bad or
   embarrassing or dishonest, especially against another specific player."* This is that,
   exactly.
3. **The subject convicts himself in the chat log**, so the bit doesn't have to land the
   verdict — it can quote him landing it.
4. **The numbers are the punchline again** (0 vs −2), consistent with the counterfactual-ballot
   finding from spike 1.

## Risk / handling notes

- Conor comes off badly. He is also the one who wrote the self-own, which is the only
  reason this is fair game rather than a pile-on. **Any version of this must end on his own
  quote, not on the AI's verdict.** The court bit does; keep that rule.
- Jimmy is the sympathetic party and stays sympathetic — he upvoted Conor.
- `gpt-audio-mini` refuses to voice both *"Fuck you"* and *"lard ass"*. Handled two ways:
  the Koziol line is a **silent card** (funnier — the announcer declines to read it) and
  the self-own uses the full `openai/gpt-audio` model with retries. See `media/README.md`.
