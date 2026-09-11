# R150 — QA findings, Coinage, Regulars

## 1. QA pass on draft-150-7f53f825

Ran `verify_facts.py`, `dedupe_scan.py`, `quote_audit.py`. Verified every numeric
claim by hand against `votes` because the facts tool has a blind spot (see F0).

### F0 — verify_facts cannot see the podium points at all (tool bug, not a digest bug)
`check_podium` reads `item.get("points")`; the draft's podium items use
`vote_total`. Every podium points check therefore compares `None` to the truth
and reports FAIL. The three "draft says None" FAILs are noise — but so is the
tool's *pass* on podium points for every round since the key drifted. Worth
fixing in `scripts/digest-qa/verify_facts.py`.

### F1 — PODIUM ORDER IS WRONG ⚠️ the real one
Bad Habit (Clements) and Bellevue (Matt) both scored 13. League-universal
tiebreak cascade is points → more upvoters → fewer downvoters → weight sequence.

| song | pts | upvoters | downvoters |
|---|---|---|---|
| Bad Habit (Clements) | 13 | **9** | 0 |
| Bellevue (Mashew) | 13 | **7** | 0 |

**Clements is #2. Matt is #3.** The draft has them swapped, which puts Matt on
the podium above Clements in his own digest.

Three pieces of copy inherit the error:
- podium #3 color: *"Tied at 13 with Bellevue, fell to third on tiebreak"* — it
  **won** the tiebreak.
- podium #2 color: *"Mashew takes second on pure anonymity"* — he's third.
- flow: *"tied at 13 and split on breadth"* — right criterion, backwards
  conclusion. Breadth favours Clements 9–7.

### F2 — consensus has the wrong upvote count for Bad Habit
Draft: *"Bad Habit — Seven upvotes, zero downvotes."* Actual: **nine** upvotes,
zero downvotes. Bellevue's seven was copied onto the wrong song — the same
confusion that produced F1.

### F3 — podium #2 miscounts the big votes
Draft: *"three voters throwing 3s and 2s."* Actual: **four** (djensen37 3,
Paletz 3, Grant 2, Jimmy 2).

### F4 — villain section misquotes Jimmy, removing its own evidence
Draft: *"a 'ballsey move, but I upvote this time.'"*
Actual: *"Ballsey move, but I like the song so I upvote (this time)"*.
The condensation drops "I like the song" — and the same sentence asserts Jimmy
"upvoted it 1 point purely because he liked the song." The section makes the
claim and then prints the quote with the proof cut out.

### F5 — two verbatim runs shared between podium and consensus
`dedupe_scan`: `"the bobby lees bellevue mashew seven upvotes"` and
`"pennywise bro hymn 2005 remaster jimmy troy"`. Consensus is restating podium
rather than adding to it.

### F6 — zero-point comments: the draft is actually clean here
12 of the round's comments carry 0 points. Checked every claim that counts
voters:
- Bro Hymn: *"Eight of nine eligible voters went positive. The one holdout
  (djensen37)…"* — correct. 8 up, 1 zero-point comment, 9 eligible.
- Little Paws: *"Seven voters spent downvotes"* / *"one charity upvote"* —
  correct. 1 up, 7 down, 1 zero.
- Nothing in the draft describes a 0-point comment as a vote *for* or *against*
  anything.

One thing to decide as house rule, since it recurs: **CJ Wookie left a 0-point
comment on his own song** ("Kitty" on Little Paws). `verify_facts` only flags
self-votes with non-zero points, so it passes silently. Harmless here, but if a
self-comment ever gets counted in a voter denominator it'll be wrong.

### Verified correct (no action)
Bro Hymn 14 on 8 positive ballots · JB gave it 2 · Movement 6 · Close Your Eyes
−1 · Du hast 1 · Little Paws −6 with 7 downvoters · villain = actual last place ·
all 10 stored standings totals match a raw recompute · 5 of 6 quotes-section
quotes verbatim (the 6th differs only in punctuation).

---

## 2. The Coinage — NOT present on this digest; term = Tacomanger

`digest_drafts.stats_content_json` for `draft-150-7f53f825` is `{}`. The Coinage
card renders only when `statsContent.phrase.term` exists, and it is hand-authored
during punch-up — see `design/r147-regulars-coinage.yaml` and
`design/r148-regulars-coinage.yaml`.

**Decided: Tacomanger**, on the strength of the art slot and the fact that the
bit travelled even though the word didn't.

### Two corrections to the reasoning

**JB is not in the Tacomanger thread.** Verified message by message, 18:05–18:40
on Sep 8: the cast is **Conor, Shane, Jensen, and Matt** (Matt asks "whats hte
budget" at 18:07, two minutes before the coinage). Jon's car contribution is the
Acuruck shelving memo the *next* morning, a separate thread. So the card can say
four people, but not that one of them was Jon.

**⚠️ We do not have the photo.** `chat_messages.source_path` is a provenance
label ("relay", "export", "manual-backfill:…"), not a file path — the relay does
not capture media at all. All **46** photo messages in the R150 window store only
the literal text "📷 Photo", Shane's manger included. The last Boarz message with
any non-relay provenance is 2026-09-02.

To use the image, it has to be saved off WhatsApp by hand and dropped into
`digests/_media/` — the same way `chopped_unc.jpg` got there for R147. Suggested
name `tacomanger.jpg`. Until that file exists, `media:` stays out of the payload
(the renderer drops the slot rather than showing a broken frame, so a missing
file degrades quietly — but it also means no art).

### On the flag line

`phraseFlag` builds from `coined.date` + `stats.speakers` + `stats.prior_rounds`,
and `stats.speakers` is rendered as `${value} speakers` — so a literal "1
speakers" is the only honest number available, and it undersells a bit that four
people played with. **Omit the `stats` block entirely.** The flag line then reads
just "coined 9/8", the origin line carries the rest, and the spread shows itself
in `usages[]` without the card claiming a number it can't back.

### Payload

```yaml
stats:
  phrase:
    style: dictionary
    term: Tacomanger
    pronunciation: /təˈkoʊmeɪndʒər/
    part_of_speech: noun · portmanteau
    definition: >
      A Toyota Tacoma carrying a second bed behind the bed, in which the holy
      family is understood to be housed. Fourth and final entry in a vocabulary
      the league minted in eight days by welding one vehicle to another —
      after AcuRanger (Acura + Ranger), Acuruck (Acura + truck) and Outbrat
      (Outback + BRAT). It is the only one of the four that is also a nativity,
      and the only one anyone has attempted to price.
    coined:
      by: Conor
      at: Shane
      context: who had just named his fee for an AI campaign video — one donor
        Ranger, to put another bed behind the bed on his Tacoma
      date: '2026-09-08'
    usages:
    - label: the invoice
      speaker: Shane
      text: Gimme a donor ranger so I can put another bed behind the bed on my
        Tacoma and we're even
    - label: the coinage, nine seconds later
      speaker: Conor
      text: The Tacomanger!
    - label: and its significance
      speaker: Conor
      text: Which is where delicious Mexican Jesus was born.
    - label: the theology
      speaker: Shane
      text: If we're already talking about immaculate conception the ethnicity
        of the mother doesn't really matter for the story
    - label: settled
      speaker: Dave Jensen
      text: Jesus Claus, of course
    # media: fill in once tacomanger.jpg is in digests/_media/
    # media:
    #   src: https://<digest-static host>/_media/tacomanger.jpg
    #   poster: https://<digest-static host>/_media/tacomanger.jpg
    #   alt: A manger scene with a taco where the infant should be
    #   caption: Shane's evidence, 18:10
```

Note `src` and `poster` both point at the still: the clip slot was built for
video, and the PNG/PDF export path prints `poster` because video never captures.

**Knock-on:** the Coinage now owns the car *vocabulary*, so L2 "Immaculate
Conversion" must drop its closing coinage list (AcuRanger/Acuruck/Outbrat/
Tacomanger + "crèche-tested") or `dedupe_scan` will flag the overlap and the
joke will land twice. L2 keeps the business — the vendor, the $11, "Buy high;
sell low", "you are the truck in this scenario". The title still works, since
"conversion" is Jon's word about the car, not about the manger.

## 3. Regulars — also NOT present

No `storylines` section on this draft (kinds are podium/villain/flow/consensus/
quotes/chat), and `settings.storylines_section_leagues` = `{"sssc":true}`, so
**generation skips Regulars for Boarz by design**. Like the Coinage it is
hand-authored into `digest_sections.content_json` for a `storylines` row.

Not picked for this week. Prior cast, for continuity:
- **R148** — The Editor (Mashew, double-sends), The Consul (Conor, one-word rulings)

⚠️ **Operational note from the R148 file: a full regen DROPS hand-authored
Regulars and Coinage.** So the order has to be: regenerate the chat section
first, *then* author Coinage + Regulars — or re-apply them after.

Candidates this week, from the transcript:
- **The Vendor** (Conor) — direct continuation of The Consul. Sells cars, charges
  to unsell them, "Buy high; sell low," fired by memo, "I think of myself as more
  of an Acura."
- **The Prosecutor** (Jon) — his dossier calls theme nitpicking "his real
  specialty… practised relentlessly and to the visible exhaustion of the group."
  This week: the shelving memo, "you are the vendor," nagging Paletz to submit,
  "A downvote from Conor should count as +3."
- **The Late Arrival** (Grant) — reads nothing, reviews everything, owes the room
  an explanation of Key West.

---

## 4. Dossiers — found, but uneven

They live in `player_profiles.taste_fingerprint` (JSON: signature_artists,
genres, eras, rewards, punishes, summary, confidence). Not a `personify/`
directory — **that path from the old handoff does not exist in this repo**; if
the five deep profiles (Matt, Jon, Conor, Grant, Jensen) are somewhere else,
point me at them, because they'd be much better than what's in the DB.

What's in the DB:
- **Matt and Jon: rich, specific, high confidence.** Usable.
- **Grant, Shane, Conor, Steingart, Clements, Paletz, Jensen: thin stubs.** Four
  of them literally say "insufficient data" or "too little data to pin down a
  firm identity." Jokes built on these would be generic.

**The one dossier hit that matters this week:** Jon's profile already describes
"a platoon of murderous cats who leave trophies on the lawn." On Sep 5 Jon
wrote, unprompted: *"I was very proud of my cat platoon until I saw her."*
**Platoon is his own recurring word for his cats** — so the catfé moment can
call it that and be quoting him, not the digest. That's the kind of thing the
dossiers are for.

Two more usable lines:
- Jon's dossier: *"docking four separate Round 141 songs for insufficient
  boat"* — the theme-fit hardliner. Ties straight into the bomb-sponge moment
  and Jensen's "hard to take competition seriously if I'm upvoting songs that
  don't fit the theme."
- Jon's Reno shows up twice this week unprompted ("Next time you show up
  uninvited to Reno", "I'd get a lot of respect in the Reno area") and Reno is in
  his dossier as an off-ballot fixture.
