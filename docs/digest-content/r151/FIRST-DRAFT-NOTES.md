# R151 · "Plot so Thicc" (Boarz II Men) — first-draft package

Generated 2026-09-17. Draft id `draft-151-9992711c` (6 LLM sections, $0.28).
Theme: "Songs that tell a story." Theme submitted by **Mashew**.
Voting closed 2026-09-17T06:30Z. Import: 10 submissions / 67 votes / 43 comments.

---

## 0. STOP — the generated podium is wrong

**Grant Koziol and Shane Farkas filed no ballot.** Per
`docs/league-rulecards/boarz-ii-men.md` the no-vote penalty is *upvotes voided,
downvotes stand* (precedent R147). Verified against the live site — Music League
applies it and shows both scores struck through.

The digest generator summed raw `votes.points` and ignored the penalty, so the
draft crowns Grant with 9 points. He actually finished 9th at −1.

### Official board (use this one)

| # | Song | Submitter | Pts | Up | Dn | Note |
|---|---|---|---|---|---|---|
| 1 | The Snake — Al Wilson | Steiny | 7 | 5 | 1 | wins tiebreak on upvoters, 5 v 4 |
| 2 | Secret Wars I — The Last Emperor | Darren Paletz | 7 | 4 | 1 | Steiny's silent +3 was the beam |
| 3 | Date Rape — Sublime | djensen37 | 6 | 6 | 1 | broadest support in the round |
| 4 | Lake Pontchartrain — Ludo | Clements | 5 | 5 | 0 | **only song with zero downvotes** |
| 5 | Juicy — The Notorious B.I.G. | Jimmy Troy | 5 | 5 | 2 | loses 4th on downvoters |
| 6 | Children's Story — Slick Rick | CJ Wookie | 3 | 4 | 2 | |
| 7 | Poor Bannister — Getdown Services | Mashew | 2 | 4 | 3 | most-downvoted song of the round |
| 8 | Frankie's Gun! — The Felice Brothers | Jonathan Black | 2 | 3 | 2 | |
| 9 | Rocky Raccoon — The Beatles | Grant Koziol | **−1** | — | 1 | 9 raw, voided (no ballot) |
| 10 | The Kids Aren't Alright — The Offspring | Shane Farkas | **−2** | — | 2 | 2 raw, voided (no ballot) — **last** |

### Consequences for the draft
- **Podium section**: fully wrong. Grant does not win; Steiny does. Rewrite.
- **Villain section**: wrong target. It fingers Mashew's "Poor Bannister" as
  "dead last at 2 points." Shane is last at −2. Mashew is 7th, though he *is*
  the most-downvoted song (3 downvoters, −4 gross) — that is the defensible
  angle, and it lands harder because he wrote the theme.
- The real villain story is bigger: **two players skipped the ballot and both
  were annihilated for it.** That is the round.

---

## 1. Fact-check of the generated draft

Verified against `ml_submissions` / `votes` / `chat_messages`.

### Wrong
| Section | Claim | Actual |
|---|---|---|
| podium | Grant wins with 9 | −1, 9th (no-ballot penalty) |
| podium | Paletz 2nd, Steiny 3rd | Steiny 2nd… in fact Steiny **1st**, Paletz 2nd |
| podium | "Grant's second podium of the season and his first win" | his **third** podium (2nd R146, 2nd R153) — and not a win |
| podium / villain | Mashew "lands last" | 7th |
| flow | JB "eighth-place Frankie's Gun!" | 8th is right by raw sum, but the penalised board puts him 8th too — OK, keep |
| villain | "a soft two upvotes from Paletz and Jimmy" | **four** upvoters: Paletz +2, Jimmy +2, JB +1, CJ Wookie +1 |
| consensus | Rocky Raccoon "nine voters weighed in" | 8 ballots (6 up, 1 zero, 1 down) |
| consensus | The Snake "six upvotes, zero downvotes" | 5 up, 1 down (Mashew −1, "Koziol") |
| consensus | Date Rape "six upvotes against two downvotes" | 6 up, **1** down |
| consensus | Secret Wars I "five voters upvoted it" | **4** |
| chat | Conor needs "Jonathan Black and Jimmy Troy each take heavy negatives" | invented — he said "**Bako bobs**" |
| chat | "In a thread about Alanis Morissette" | the artist is never named in the record; inference only |
| chat | Grant quote "whose score is not threatened" | verbatim is "**who's**" |

### Correct (verified)
Jensen's −2 on Poor Bannister is the round's only −2 · Mashew is the theme
captain · all six `quotes` items are verbatim · the Juicy split (JB+Clements up,
CJ down, Paletz down while calling it an all-time favourite) · the buttnix69
exchange, word for word · Grant's Alanis points petition and JB's approval.

### Missed, and better than what's in there
- **Grant scored 0 in R150 and won… no. Grant scored 0 in R150 and was
  *penalised to −1* here.** Two zero-or-worse rounds back to back, while
  petitioning in chat to have 5 points restored and saying "I just want to place
  above steiny and maybe Shane." He then failed to vote. Steiny beat him by 8.
- **Lake Pontchartrain is the only clean song in the round** — 5 up, 0 down —
  and Clements spent the week in chat workshopping Rush's "2112" out loud before
  submitting it. The draft gives it one line.
- **Conor's confession**: "Full disclosure: I was 100% trolling with the cat song
  b/c everyone shit on my 'Who's Gonna Build Your Wall' the week before." That
  retroactively explains R150's villain. Not used.

---

## 2. Chat section — suggestions

### ✅ Gap closed — full window recovered
The `api` container (relay webhook + email poller) died ~2026-09-12 and Boarz chat
stopped at 2026-09-11T23:02Z. Container restarted, and the Sep 12–17 gap was
backfilled from Matt's WhatsApp export (**270 messages, 0 duplicates**).
The round window now holds **329 messages over all 7 days**. See §7 for the
superseded moment list — the recovered days changed the section substantially.

### Keep (already in the draft, accurate)
1. **buttnix69** — Jensen surfaces a Reddit post about Conor nine minutes after
   it went up; Conor's first question is not "how" but "Are you buttnix69??";
   Jensen: "Are you coming on to me?"; Conor: "Which is odd since my profile says
   I'm 16." Best-formed exchange in the window. Keep verbatim.
2. **Grant's points petition** — "Can I add back my 5 deducted from alanis?" /
   "Or an asterisk of some sort" → JB "Sure, no problem." → "Spoken like a man
   who's score is not threatened" → "I just want to place above steiny and maybe
   Shane." Fix the quote to "who's". Keep "maybe" — it's the joke.
3. **Sext archaeology** — Grant "Did wiener invent the sext btw ?" → Shane "No he
   was way late to the party" / "There were pony express sexts in the olden days"
   / "Telegram sexts!" → Grant "A primitive dick pic, if you will."

### Replace
4. **Conor's math** — cut the invented names. Verbatim: "It is still
   mathematically possible for me to win the season." / "I need 4s from everybody
   for both rounds." / "And −3 and −2 for **Bako bobs**." Matt: "I gotta say -
   Conor, your score is sort of impressive." Conor: "Thank you, thank you."
5. **Lisa Loeb** — keep the shape, drop "Alanis Morissette" (unverified). The
   payoff is Jimmy's verbatim, which the draft paraphrases away:
   Clements "I think she is permanently paralyzed and in a wheelchair." → Matt
   "Lazy" → Jimmy "**That is false and not true!**" + photo → "Sorry I see Clem
   was not talking about Lisa Loeb" → Clements "Haha. Thank goodness."

### Add — these are the real misses
6. **Clements Workshops a Rush Song For Four Hours.** "Hard to decide which Rush
   song to submit this week" → pitches 2112 with a full plot synopsis ("I think
   this song would appeal to everyone in ML") → Jensen: "You'll get at least one
   upvote, still a better choice than American Pie" → Clements: "Ugly kid Joe
   would fit here too. Maybe pinball wizard? El Paso by Marty Robbins. So many
   options." He submitted none of them, submitted Ludo instead, and it was the
   only song in the round nobody downvoted. **This is the strongest unused
   moment** — it is on-theme, it pays off in the results, and it is the round's
   one piece of visible preparation.
7. **The 83-Second Objection.** Conor, re: R150's winner: "We really gonna have a
   winner that's 83 seconds long?" … one hour later: "I just don't see an 82
   second song is legitimate." He lost a second while arguing. Jensen escalates:
   "I've got a great 19 minute song for next week" / "Just listening to an album
   that's 15 songs in 22 minutes" / "That should be a theme for season 2, songs
   under a minute."
8. **Nobody Here Can Rate Themselves.** Grant: "I used to think I had good taste
   in music until I joined this club." Conor, sitting in last place: "I've never
   been more confident in my taste." Jensen: "I definitely have a high level of
   confidence about your taste." Three lines, complete arc.
9. **Conor confesses the cat song** (see §1). Pairs with the R150 digest.

### ⛔ Dedupe — do NOT reuse
Conor's four-line rival recap ("We sent pictures of cats. Jon used the occasion
to talk about butt washing more…") and Grant's "That's so much better than AI
summary" both sit inside this window but were **already published in the R150
digest** as "The Competing Publication." Same for the Paletz/Koziol
misattribution beat if R150 covered it — the draft's "Du Hast Alibi" moment is
Shane reacting to *R150's* reveal, not to this round. Use it only if R150 didn't.

---

## 3. Coinage / Phrase of the Round — suggestions

The detector wants: coined in-window, **3+ uses by 3+ speakers**, absent from
prior rounds. **With 5 of 7 days missing, nothing in the window clears that bar.**
Honest options, strongest first:

**A. Hold the coinage for R151.** Ship the section empty rather than promote a
one-speaker phrase. Revisit after the chat backfill.

**B. "The Front Stab"** — the only candidate with a real call-and-response shape.
- Coined by **Matt**, at **Conor**, 2026-09-11, on learning Conor was working for
  a Weiner: "you might have to stand up and backstab another mentor" → "maybe
  backstab is not the right verb" → "**righteously front stab?**"
- Immediately contested by Conor: "What did Brutus do to Caeser? More of a side
  stab?"
- Three senses in four minutes (backstab / righteously front stab / side stab),
  two speakers. Fails the 3-speaker rule; has the best dictionary shape.

**C. "Bako bobs"** — Conor, once, as the unit of the negative points he needs
from his rivals to win the season. Extends the existing Bakersfield Ledger lore.
One speaker, one use: a callback, not a coinage.

**D. "Pony express sexts"** — Shane. Vivid, but it's a punchline, not a term the
group adopted, and §2 already spends the exchange as a chat moment.

**Recommendation: A, and if Matt wants something in the slot, B with a one-line
note that the window was short.**

---

## 4. The Regulars — suggestions

Two entries, quote-led, both proved from this round. Neither reuses an existing
profile (Grant has none; Conor's existing ones are "minimum viable profundity" /
"The Consul" / "Bomb Sponge" — this is a different behaviour).

### Primary 1 — **The Appellant** · Grant Koziol
*type:* claimant · *style:* quote-led · *motif:* litigates the score he refuses to
defend.

He spent the week negotiating his position instead of occupying it. He opened by
admitting he hadn't read the chat ("Btw I've not read the last few days of banter
hope it was good"), took "lame pick" personally ("I am the go to for lame pick?"),
conceded the whole premise ("I used to think I had good taste in music until I
joined this club"), then filed a formal petition to have five points restored
from a round two months gone — "Can I add back my 5 deducted from alanis?" /
"Or an asterisk of some sort." The league leader granted it in nine words and
Grant immediately impeached him: "Spoken like a man who's score is not
threatened." He then stated his actual ambition — "I just want to place above
steiny and maybe Shane" — and, four days later, did not vote. Steiny finished
eight points ahead of him. Shane finished below him, which is the one clause of
the petition that was granted.

*evidence:* the six lines above.
*highlight:* "Or an asterisk of some sort" · "maybe Shane" · "I'm taking my 5 points back"
*stats:* `5` points formally petitioned for · `0` ballots filed

### Primary 2 — **The Dissent** · Conor Johnston / CJ Wookie
*type:* minority opinion · *style:* quote-led · *motif:* rules from last place,
without flinching.

Dead last in the season and he has never sounded more certain. He opened the
window litigating the length of someone else's winning song — "We really gonna
have a winner that's 83 seconds long?" — and re-filed an hour later having lost a
second off his own evidence: "I just don't see an 82 second song is legitimate."
He announced a title path requiring 4s from every voter and "−3 and −2 for Bako
bobs." He confessed the previous round's villainy as deliberate: "Full disclosure:
I was 100% trolling with the cat song." Told the room he has "never been more
confident in my taste." And on his ballot he graded a rival up out of pity —
"Really only deserves +1 but this is a weak week" — which is a man in last place
marking on a curve.

*evidence:* the five lines above.
*highlight:* "83 seconds" · "82 second" · "never been more confident"
*stats:* `1` second lost mid-argument · `10th` of 10, season

### Alternate — **The Corrections Desk** · Jimmy Troy
Fresh (his file says "The Wholesome One"), and fully evidenced in-round: the
photo refutation of Clements' wheelchair claim — "**That is false and not true!**"
— followed 90 seconds later by the retraction, "Sorry I see Clem was not talking
about Lisa Loeb." On the ballot he is the same man: "First Beatles track for the
Boarz ML!" (keeping records nobody asked for) and "Not as good as Tim Bootyman
Wilson, but good enough for 1 upvote" (citing his own most humiliating defeat as
a benchmark). Use if Matt wants a third or wants to swap out Conor.

---

## 5. Guess the Submitter — R151 results

Guesser: **Matt Mariani** (resolved via `guesserSection.ts` override; he names a
submitter on every song and publishes his own scorecard).

**2 of 9 — his worst round of the tracked season**, down from 5/9 in R150.

| # | Song | Guessed | Actual | |
|---|---|---|---|---|
| 1 | Lake Pontchartrain | Jensen ("Jensen cause it's kinda ska.") | Clements | ✗ |
| 3 | Frankie's Gun! | Jimmy ("I don't really think this is jimmy but he the one left.") | Jon Black | ✗ |
| 4 | Children's Story | Conor | Conor | ✓ |
| 5 | Rocky Raccoon | Jon Black ("Jb, I always forget about this one, me likey") | Grant Koziol | ✗ |
| 6 | The Kids Aren't Alright | Shane ("Maybe Shane?") | Shane Farkas | ✓ |
| 7 | Juicy | Paletz ("Pallets, you think he preferred sonic or Mario?") | Jimmy | ✗ |
| 8 | The Snake | Grant ("Koziol") | Steiny | ✗ |
| 9 | Secret Wars I | Steiny | Darren Paletz | ✗ |
| 10 | Date Rape | Clements ("Clammy") | Jensen | ✗ |

**Angles worth writing:**
- **He got Steiny and Koziol exactly backwards.** Guessed "Koziol" on The Snake
  (Steiny's) and "Steiny" on Secret Wars I (Paletz's). A clean swap.
- **By thirds: 1/3 · 1/3 · 0/3.** He hit nothing in the back third. The
  attention-expires-at-song-eight law applies to the guesser too.
- **Both hits were hedged.** "Conor" bare, and "Maybe Shane?" — the two he
  actually got were the two he was least committed to.
- **The by-elimination guess failed**: "I don't really think this is jimmy but he
  the one left" — he reasoned his way to the last name standing and was wrong.
- Season: **0.426 over 7 rounds** (148: 3/9 · 149: 3/9 · 153: 7/9 · 150: 5/9 ·
  151: 2/9). Best round was R153 at 7/9; this is the crash after it.
- Roster: he reads **Conor 4/5** and **Jimmy 4/5**, and **Shane 2/6**.

**⚠ Grid ordering bug (pre-existing).** `seasonHitRates` orders by round *id*, so
it renders 148 → 149 → 150 → 151 → **153**. By voting deadline the true order is
148 → 149 → **153** → 150 → 151: R153 "Stranger Danger" closed 2026-09-03, before
R150. The panel currently shows his 7/9 peak as happening *after* this round.
Fix the sort to `voting_deadline` before publishing.

---

## 6. Dedupe + rules checks

### Rules (`docs/league-rulecards/boarz-ii-men.md`) — R151
| Rule | Result |
|---|---|
| 8 upvote points per ballot, spent exactly | ✅ all 8 ballots spent exactly 8 |
| ≤2 downvotes per ballot | ✅ 7 filed 2, djensen filed 1 (as a single −2) |
| Per-song max 4 from one voter | ✅ max observed 3 |
| Every submitter files a ballot | ❌ **Grant Koziol and Shane Farkas did not** |
| No-vote penalty applied | ❌ **not applied by the generator** (ML applies it) |
| Tiebreak cascade | ❌ **not applied** — Steiny/Paletz both on 7, Steiny takes it at step 2 (5 upvoters v 4); the draft has them reversed |
| Comment with no points ≠ downvote | ✅ 4 zero-point comments correctly neutral (JB×2, Mashew, CJ Wookie, Clements) |

**Rulecard is stale in one place:** it says *"Guesser OFF (SSSC only)"*. The
guesser has been on for `boarz-ii-men` since 2026-09-05 and shipped in R150.
Update that line.

### Dedupe
- ⛔ **Conor's rival recap + Grant's "better than AI summary"** — published in
  R150. In-window here; do not reuse.
- ⚠ **"The Du Hast Alibi"** — Shane/Conor reacting to R150's reveal. Check R150's
  chat section before keeping.
- ⚠ **"Bomb sponge" / "Buy high; sell low" / Acura-truck** — all R150 lore and
  all present in `rel_context`. The LLM leans on `rel_context` for colour; watch
  for these resurfacing in the rewritten podium/flow.
- ✅ Section titles are all new: "Final Standings", "The Villain: A Guy by the
  Campfire…", "How It Played: The Erudition Club Votes for the Beatles", "Where
  the Room Agreed", "Lines of the Round", "Dispatches from the Group Chat" — none
  collide with `docs/digest-sections.md`'s used-names list. Note "How It Played"
  and the Beatles subtitle both die with the podium rewrite.

### Standings divergence (separate bug, flagged not fixed)
The app's computed season totals do not match Music League's official standings:

| | ML official | app computed |
|---|---|---|
| Mashew | 73 | 56 |
| Jonathan Black | 72 | 64 |
| Clements | 62 | 53 |
| Darren Paletz | 56 | 59 |
| djensen37 | 56 | 50 |
| Jimmy Troy | 51 | 44 |
| Steiny | 37 | 31 |
| Shane Farkas | 35 | 41 |
| Grant Koziol | 32 | 34 |
| CJ Wookie | 0 | 9 |

Different totals *and* different order — the app has JB leading, ML has Mashew.
The stored standings also reconcile as `mismatch` with `roundPoints: 0` for
everyone. Do not publish a standings chart until this is resolved.

---
---

# UPDATE — full chat recovered, draft regenerated

Added 2026-09-17 after the WhatsApp export backfill. **Supersedes §2's moment
list and §3's coinage recommendation.** Current draft: `draft-151-f854219f`.

## 7. The lede changed

**Steiny won "Plot so Thicc" — a round themed *songs that tell a story* —
without typing a single word.**

- **0** chat messages in the round window (Sep 10 06:30 → Sep 17 06:30)
- **0**-character submission note
- **0** ballot comments — all eight of his vote rows are blank

It is also **his first win**. Prior best: 7 points / 4th, R146. He has finished
5th–9th every other round of the season.

Against that, the room's own reaction on results morning:

> **Jensen, 06:34:** "Submitter of winning song doesn't vote, fascinating"
> **JB, 06:45:** "Congrats, Kozh, on your first win! . . . Oh, uh, never mind."
> **Grant, 11:14:** "Oh fk I missed the vote - normally it sends me an alert !!"

The league narrated the penalty live, four hours before Grant noticed. Use JB's
line as the podium lede — it is the whole round in eleven words.

## 8. Chat stats (recomputed on the full window)

329 messages · 8 speakers · 7 days.

| Player | Msgs | Share | Words | Words/msg | Days active |
|---|---|---|---|---|---|
| Conor Johnston | 87 | 26.4% | 825 | 9.5 | **7 / 7** |
| Matt Mariani | 60 | 18.2% | 638 | 10.6 | 5 |
| Jon Black | 48 | 14.6% | 804 | **16.8** | 5 |
| Grant Koziol | 42 | 12.8% | 408 | 9.7 | 3 |
| Dave Jensen | 38 | 11.6% | 467 | 12.3 | **7 / 7** |
| Shane Farkas | 33 | 10.0% | 311 | 9.4 | 6 |
| Jimmy Troy | 12 | 3.6% | 88 | 7.3 | 4 |
| Clements Johnson | 9 | 2.7% | 122 | 13.6 | 3 |
| **Darren Paletz** | **0** | — | — | — | 0 |
| **Steiny** | **0** | — | — | — | 0 |

By day: 9/10 = 9 · 9/11 = 96 · 9/12 = 16 · 9/13 = 36 · **9/14 = 0** · 9/15 = 60
· 9/16 = 56 · 9/17 = 56.

Stats worth putting on cards:
- **The two silent men finished 1st and 2nd.** Steiny (0 msgs) won; Paletz
  (0 msgs) took 2nd. The two loudest, Conor (87) and Matt (60), finished 6th and
  7th. Grant asked in chat on 9/10, *"How many days since a Paletz or steiny
  sighting on this chat? Feels like it may have been weeks"* — and then lost to
  both of them.
- **Conor posted every single day** and is last in the season.
- **JB writes longest** (16.8 words/msg, nearly double the room).

## 9. Coinage — settled, and it clears the bar

Ran the novelty/spread detector over the window against the entire prior Boarz
corpus. One candidate clears both tests:

### **"killed at the fair"**
- **4 uses · 3 speakers · 0 prior rounds** (the string appears nowhere in the
  Boarz chat history before this round)
- Extends the established **Bakersfield: A Ledger** lore with new material,
  which is the ideal shape for this card.

*part of speech:* phrase · unit of Bakersfield · **two senses in four minutes**

**Sense 1 — the honour.** The highest distinction available to a Bakersfield
band: to have gone over well at the county fair. Minted by Jensen as a
superlative, not a description.

**Sense 2 — the mortality.** Conor, twice, declining the idiom and reading the
sentence as written.

| label | speaker | text |
|---|---|---|
| the memory | Matt | "I still remember the disappointment learning it wasn't a smokin armadillo's original" |
| the citation | Matt | "they killed at the fair" |
| the unit is declared | Dave Jensen | "It doesn't get more Bakersfield than \"The smoking armadillos killed at the fair\"" |
| the first misreading | Conor | "The smoke from the fair killed some armadillos?" |
| the second, escalated | Conor | "The armadillos from the fair got killed by the smoke we breathe every day?" |
| the defence of the fair | Matt | "You didn't go to a jumped up carnival every year that smelled like cow manure in your youths" |

Runner-up, if you want something shorter: **"knifey carnie"** (Conor, on Jensen's
Zipper story) — perfect phrase, but 1 use / 1 speaker, so it fails the bar.

**This replaces §3's recommendation to hold the slot.** With the full week in,
the round has a real coinage.

## 10. Regulars — settled

Neither name has been used before in this league (used: The Consul, The Editor,
The Laconian, The Musical Adult Groomer, The Socratic Method).

### 1 — **The Appellant** · Grant Koziol
*type:* claimant · *style:* quote-led · *motif:* litigates the score he then
declines to defend

He spent the week negotiating his position instead of occupying it. He opened by
admitting he hadn't read it — "Btw I've not read the last few days of banter hope
it was good" — took "lame pick" personally, and conceded the premise outright: "I
used to think I had good taste in music until I joined this club." Then he filed
his petition, for five points from a round two months gone: "Can I add back my 5
deducted from alanis ?" / "Or an asterisk of some sort." The league leader granted
it in three words and Grant impeached him for it — "Spoken like a man who's score
is not threatened" — before stating the whole of his ambition: "I just want to
place above steiny and maybe Shane."

He was tagged to vote twice. He did not vote. His song led the round on raw
points and the no-vote penalty took it to −1. Steiny — the exact man named in the
petition — won. Shane finished below him, which is the one clause that was
granted. Grant's response arrived four and a half hours after JB had already
congratulated and un-congratulated him: "Oh fk I missed the vote - normally it
sends me an alert !!"

*evidence:* the seven quotes above
*highlight:* "Or an asterisk of some sort" · "maybe Shane" · "normally it sends me an alert"
*stats:* `5` points formally petitioned for · `0` ballots filed · `42` chat messages

### 2 — **The Corrections Desk** · Jimmy Troy
*type:* unsolicited fact-checker · *style:* quote-led · *motif:* files the
correction, then the correction to the correction

Nobody asks him for a ruling and he issues one anyway. When Clements said a
singer was "permanently paralyzed and in a wheelchair," Jimmy arrived with
photographic rebuttal — **"That is false and not true!"** — and then, ninety
seconds later, retracted the whole filing: "Sorry I see Clem was not talking about
Lisa Loeb." On the ballot he is the same man, keeping records no one requested
("First Beatles track for the Boarz ML!") and benchmarking against his own worst
humiliation ("Not as good as Tim Bootyman Wilson, but good enough for 1 upvote").

His masterwork came a day after voting closed, when the result could not be
changed: a motion to strike Paletz's ballot comment. "I think Paletz should have
to delete his comment about Juicy not being a story. It's clearly an
autobiographical rags to riches non-fiction story that evokes vivid images of
Biggie growing up in Brooklyn and reaching stardom through hard work and
dedication to an emerging art form shaping a very meaningful era in hip hop
history." Shane concurred. Clements concurred. Then Jimmy delivered the finding:
"Paletz must have been confused and thought the theme was about 'a single floor
level of a building'." Conor filed the dissent on Paletz's behalf, and Paletz —
who wrote nothing all week — was not present for any of it.

*evidence:* the six quotes above
*highlight:* "That is false and not true!" · "a single floor level of a building"
*stats:* `12` chat messages, `2` of them retractions · `1` motion to strike, filed post-verdict

### Alternate — **The Dissent** · Conor Johnston
Full arc if you want a third or want to swap one out: "I think I'm winning this
week" (9/12) → "I've chosen an obscure radio hit that's punk with a touch of
hip-hop grunge and a female singer who sounds like a man" (he submitted Slick
Rick) → "I am in the wrong league" / "Pretty consistently the voting is like the
opposite of what I think. Right now it's 100% that way." → "Mine is awesome but
getting shat upon." → "This is why I pout and submit cat songs." Finished 6th.
On the ballot, in last place for the season, he graded a rival up out of charity:
"Really only deserves +1 but this is a weak week."

## 11. Chat moments — revised list

The recovered days beat everything in §2. Recommended six:

1. **"Congrats, Kozh, on your first win! . . . Oh, uh, never mind."** — the whole
   penalty, live: Jensen spots it at 06:34, JB lands it at 06:45, Grant surfaces
   at 11:14. Lead with this.
2. **Jensen's Zipper Ride** — Clements asks about the Zipper; Jensen's deadpan:
   the bolt failed immediately, the operator was on meth, "the butterfly knives we
   recently purchased at the fair fell out of our pockets and started to fly
   around freely inside the cabin." Shane: "Damn talk about lots of fun." Jensen:
   "Lots of tiny knife wounds at least." Conor: "I see you've played knifey carnie
   before." *(In the current draft and accurate — keep as written.)*
3. **The Roast Draft** — Conor pitches season 2: "songs that remind you of someone
   else in the league… if an entry is about you, you're capped at +2, to avoid
   bias." JB: "That sounds like homework." Then they do it anyway — "the Snake
   song for Mashew", "'Creep' for Kozh", "Anything by Macklemore for Darren",
   "David Allan Coe for MAGA Shane", "Hanukah Song for Steiny" — and Conor closes:
   "Breastfeeding Beats!"
4. **Clements' Theme Pitch** — "I have an entry ready to go" / "'Songs about
   people named Conor dying'" → Conor: "If I saw you in heaven?" → Clements:
   "Bingo" → JB: "That where you think you're going?"
5. **The Motion to Strike** — Jimmy's post-verdict Juicy brief and the "single
   floor level of a building" finding (see §10).
6. **The Bidet Travelogue** — Jensen live from the hot seat, JB coaching the
   poop-shoot water jet, Conor: "Humbling to know you'll never shit on his
   birthday as bad as Al Qaeda did." *(In the draft and accurate.)* ⚠ Sanitation
   lore is well-worn — cut this one first if the section runs long.

## 12. New problems in `draft-151-f854219f`

The regen fixed the podium order but introduced fresh number errors:

| Section | Claim | Actual |
|---|---|---|
| podium | The Snake "Seven voters, seven upvotes… the round's only unanimous positive result" | 6 voters, **5 up / 1 down** (Mashew −1, "Koziol"). Not unanimous. |
| podium | Rocky Raccoon "finished fourth" | **9th**, at −1 |
| villain | "The Editor … finished last" | Mashew is **7th**; **Shane is last** at −2 |
| villain | "Darren and Jimmy managed 2 apiece while three others actively bled it out" | four upvoters, not two — JB +1 and CJ Wookie +1 are omitted |
| consensus | The Snake "every single vote was positive" | one negative |
| consensus | The Snake "Clements and Darren both dropped 2-pointers" | Clements +2, **Darren +1** |
| consensus | Date Rape "Seven approvals" | **6** |
| chat | "spoken like a man whose score is not threatened" | verbatim is "**who's**", and he said it *to* JB, not about himself |
| chat | Conor needs "four 3-point rounds for himself" | he said "**I need 4s from everybody for both rounds**" |

⛔ **Dedupe violation:** the chat moment titled **"The Competing Digest, Filed"**
reuses R150's published "Competing Publication" bit. Cut it — moments 1–6 above
are all stronger.

✅ **No PII leak.** Shane posted his literal home street address on 9/15 (JB asked
for it to look up on Zillow). The steering held and it is absent from the draft.
**Keep that instruction on every regen of this round.**

## 13. Root cause of the scoring bug — found and reproduced

Neither the no-vote penalty nor chronological round ordering exists in the app.

1. **No penalty anywhere.** `ui/src/lib/db/standings.ts:73` `pointsByCompetitor()`
   and `ui/src/lib/db/seasonData.ts:171` `seasonSongs()` both do a raw
   `COALESCE(SUM(v.points), 0)`. The rule lives only in
   `scripts/digest-qa/verify_facts.py:33-67` and the rulecard — so generation is
   structurally incapable of producing a correct podium, and `verify_facts.py` is
   the only enforcement point in the system.
2. **Rounds ordered by `id`, not date.** `standings.ts:57` `seasonAndRounds()` does
   `ORDER BY id` then `slice(0, idx+1)`; `seasonData.ts:145` repeats it. Season 10's
   true chronological order is 135, 145, 146, 147, 148, 149, **153**, 150, 151 — so
   "as of R151" silently drops R153 entirely.

Applying both fixes reproduces Music League's official standings **exactly, for
all ten players**. The four penalties the app misses: Grant R147 0→−5, Paletz
R148 3→−5, Grant R151 9→−1, Shane R151 2→−2.

Also: `season_standings` rows for R151 have `round_points = 0` for all ten
players — R151 was never scored into the stored table at all, so the stored board
is a stale R150-era snapshot sitting on top of both bugs.

**Until these are fixed, every podium, villain and standings number in this
digest has to be hand-checked against `cli-web-musicleague votes list`.**
