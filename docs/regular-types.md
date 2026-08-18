# Types of "regular" — a taxonomy

For an agent mining a league's chat for recurring characters. Each type has a
one-line definition, the signal that proves it, and a real example from our
leagues. A candidate is only usable if it can be demonstrated with a quote.

Two families exist today: **form** types (how a person writes) come from
`scripts/mine_verbal_tics.py` in the sssc-chat-regulars repo; **content** types
(what a person keeps doing) come from hand-curated seeds in
`ui/src/lib/digest/storylineSeeds.ts`. Form types travel better across leagues —
they need no curation and they can't be faked by a busy week.

---

## A. Form — how they type

| Type | Definition | Signal | Example |
| --- | --- | --- | --- |
| Nickname-minter | Refuses to use anyone's actual name | Tokens that are near-misses of roster names, used by one author | JB: Palletz, Kozh, Kozoil, cjwookie, Mashew, Munkey |
| Sloppy-fast typist | Apostrophes and letters lost to speed | `dont`/`thats`/`hes` + transpositions, often with an edit trail | Matt: dont, jsut, rememebr, soemthing |
| One-word oracle | Answers with a single word carrying the weight of a ruling | Messages of length 1, used as complete turns | Conor: "Is" · "Correct" · "Damnit" |
| Catchphrase-holder | One phrase reached for in the same situation every time | High log-odds n-gram, spread across dates | Matt: "carrot box" · "fo sho" |
| Coiner | Invents or imports slang that the group then adopts | Term absent from prior rounds, then 3+ speakers | Steiny: "chopped unc" |
| Laugh-signature | Renders laughter their own way | Distinctive laugh token, near-exclusive to one author | Grant: "ahah" (never "haha") |
| Chronic misspeller | One word they get wrong the same way forever | Non-dictionary token, 1 edit from a common word | Jensen: "rember" · Clements: "Connor" |
| Self-corrector | Posts the fix underneath rather than editing | Consecutive near-identical messages from one author | Matt, three versions of one sentence |
| Formatter | Writes in structures — lists, ledgers, legal thresholds | Long messages with enumeration or citation | JB: Bakersfield pros/cons; the 87% evidentiary standard |
| Ritual opener | Starts messages the same way | Same first token far above group rate | Matt: "heh" · Conor: "Correct" |
| Phonetic/cutesy speller | Deliberate baby-talk or phonetic spelling | Recurring nonstandard renderings | SSSC: Kali |
| Punster | Compulsive wordplay regardless of welcome | Puns per message; group groaning as corroboration | SSSC: mrklorox |

## B. Obsession — what they always bring up

| Type | Definition | Signal | Example |
| --- | --- | --- | --- |
| Single-subject evangelist | One topic surfaces regardless of context | Topic regex hits across many unrelated rounds | PoetryinNoise: cats & big butts |
| Genre missionary | Preaches one genre, judges everything against it | Genre words in votes + submissions agree | Cherry: underground global electronic |
| Over-researcher | Cannot submit without a dossier | Long vote comments with sourcing | nateoeb |
| Hobby intruder | A non-music life keeps entering the chat | Off-topic domain vocabulary, recurring | Tj: golf · Voltron's YoungLion: World Cup |
| Hometown loyalist | Geography as identity | Place name recurring, defended | GoodGollyMiss: Idaho · Matt & JB: Bakersfield |
| Family reporter | Kids/pets/spouse as running material | Domestic nouns recurring, usually affectionate | Tragically Skip: proud dad · Clements: the incoming baby |
| Connoisseur | An adjacent expertise deployed as authority | Domain jargon (cocktails, gear, film) | socalledbutton: cocktails |
| Mood curator | Always steering to one emotional register | Sentiment-consistent picks + comments | Mouse Atreides: sad songs |
| Almost-submitted poster | Posts the songs they didn't pick, every round | "almost submitted / didn't pick" patterns | bagimation · missmara · Conor |

## C. Game behavior — how they play

| Type | Definition | Signal | Example |
| --- | --- | --- | --- |
| Deadline brinkman | Acts at the last possible minute, every time | Vote/submit timestamps clustered at the deadline | Paletz: votes at 11:25 |
| Ghost | Barely speaks; presence is felt anyway | Very low message count, high win rate or impact | Paletz: 65 messages a season |
| Rules lawyer | Litigates mechanics and precedent | Questions about scoring, eligibility, procedure | Jimmy: the Booty Man appeal |
| Collusion watchdog | Suspects coordination, says so | Accusation vocabulary aimed at other players | Second Best: Michael Layous |
| Vote critic | Believes the group voted wrong, publicly | Complaint aimed at ballots rather than songs | Conor, then Matt one week later |
| Retirement threatener | Quits, repeatedly, never | "quitting / done / my last round" + still present | Conor |
| Strategic voter | Openly plays the metagame | Self-described tactics — targeting, spreading, sniping | Steiny: "team scream" · Jimmy: aiming for zero |
| Penalty taker | Absorbs the no-vote penalty rather than vote | Missing ballots with submissions present | Koziol, round 147 |
| Explainer | Answers everyone's mechanics questions unasked | Repeated instructional messages | Matt · JB |

## D. Social role — how they relate

| Type | Definition | Signal | Example |
| --- | --- | --- | --- |
| Hype-man | Amplifies other people's picks | Praise directed outward, consistently | Second Best: Michael Layous |
| Heel | Cultivates being disliked, enjoys it | Insults given and received without escalation | Conor |
| Accommodator | Extensions, no-pressure reminders, peace | Deadline-softening language | KarBen |
| Self-deprecator | Pre-emptively rates themselves last | Self-directed negative comparisons | Tragically Skip · Sarah S |
| Apologizer | Retracts and self-corrects socially, not textually | "sorry / my bad / I take it back" clusters | Grant |
| Confessor | Overshares, unprompted | Personal disclosure well past the topic | JB: the Queen Bee physiology |
| Bit-committer | Keeps a joke alive past its natural death | Same running gag across weeks | The Booty Man standard |
| Absent legend | Discussed more than present | Name appears mostly in others' messages | Koziol |

## E. Meta — the league is aware it is being written about

| Type | Definition | Signal | Example |
| --- | --- | --- | --- |
| AI-baiter | Addresses, tests, or negotiates with the digest AI | Direct address to the bot, or theories about it | Conor: "I, for one, welcome our new AI overlords" |
| Stats-requester | Asks the bot for numbers about themselves | Requests for counts, graphs, rankings | Conor: character counts · Grant: "can we do another character count?" |
| Digest critic | Reviews the write-up itself | Commentary on last week's digest | Jimmy: "the AI agent can adjust for that in the write ups" |

---

## Rules for promoting a candidate

1. **Provable with a string.** If you can't quote it, it isn't a regular.
2. **3+ independent episodes across 2+ dates.** A burst in one evening is one episode.
3. **Distinctive.** If three other people do it too, it characterizes the group, not the person.
4. **Fired this round.** A true pattern with no evidence in the current window sits the round out.
5. **Form beats topic** when both are available — "renames everyone" is funnier and harder to fake than "asks about the rules."
6. **One type per person per round.** Pick their strongest; don't stack.
