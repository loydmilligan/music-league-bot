#!/usr/bin/env python3
"""R140 rewrite v2 — Matt's calls of 2026-08-23.

- Coinage moves farkas -> "feline assassin gang" (media to follow).
- Chat keeps options 2, 3, 4, 6, 7, 9 (1 promoted to Coinage; 8 dropped, one
  Matt/JB story is enough and the tiff is the better one).
- The tiff leans on the wives curtailing both men.
- Regulars: same two cards, plus the married-couple line and an on-the-bubble
  note for Sarah Zucker and Jac.
- Length: trimmed throughout, hardest where the section was longest; bold runs
  carry the beats.
- Resolves duplicate findings 1,2,3,4,6,7,8 from the review page.
"""
import json, sqlite3, sys

DB = sys.argv[1] if len(sys.argv) > 1 else "data/league.db"
P = "draft-140-1cfdd14a-"

# ── podium ───────────────────────────────────────────────────────────────────
# Blurbs blanked (finding 3 — they restated the paragraph). Body trimmed; the
# clean-sheet stat now lives once, in Consensus (finding 7).
podium = {
    "title": "The Mariani Household Takes the Top Two",
    "items": [
        {"artist": "The Bobby Lees", "title": "Guttermilk", "submitter": "missmara", "points": 19,
         "color": "", "coverUrl": "https://i.scdn.co/image/ab67616d0000b273c1bb1f706d32303b28b96db4"},
        {"artist": "Superorganism", "title": "Something For Your M.I.N.D.", "submitter": "Mashew", "points": 18,
         "color": "", "coverUrl": "https://i.scdn.co/image/ab67616d0000b273f130e117ff4a567a4c8adc88"},
        {"artist": "Trillville", "title": "Some Cut", "submitter": "Sarah", "points": 15,
         "color": "", "coverUrl": "https://i.scdn.co/image/ab67616d0000b273ff96cb80f7b3c5a161689e38"},
    ],
    "body": "**Mara Mariani won this round twice.**\n\nHer own pick — The Bobby Lees' \"Guttermilk,\" a *\"synthetic idiophone… kinda like a triangle which is pretty unusual in a song that goes this hard\"* — took **19 points**, the most of the week. Then second place, where Mashew's Superorganism landed on 18 and the sourcing came out in the chat with the results already up: **\"I must give Mara credit for my pick this week.\"**\n\nSo: **37 of this round's points, and both songs at the top of the table.** First place under her own name, second under her husband's.\n\nTj Cook supplied most of the silver medal himself — the full **+6 cap**, the largest single vote anyone cast, half his budget on one song — and then said so out loud: \"I was referring to your song. Got my votes this week.\"\n\nSarah Zucker's Trillville pick took third on 15 off a two-word comment, **\"More bedspring.\"**, and went on to run the week's conversation.",
}

# ── villain ──────────────────────────────────────────────────────────────────
# Trimmed ~40%. Sarah's apology dropped here (finding 8 — the chat now names the
# pattern outright).
villain = {
    "title": "Pascoe Hears Everything, Submits a Kazoo",
    "body": "**Nobody listened harder this week than Brian Pascoe.** Handed a round about unusual instruments, he filed the most attentive ballot in it — a technical finding on \"Some Cut\" (*\"The squeak more prominent than any other unusual instrument… Their poor mothers. Our poor culture\"*), field testimony on \"In the Summertime\" (*\"I was witness to this song causing two cougars to strip tease around a campfire in remote Baja\"*), and a Halloween vision of \"Sarah in a chest protector and Jonathan in shoulder pads.\"\n\nThe man has an ear. It is tuned to one frequency.\n\nAnd then his own submission: Eric Clapton's \"San Francisco Bay Blues,\" **2 points — six clear of anything else all round.** Mashew and Michael Layous both spent their mandatory downvote on it; only monicac1217's +2 and Philip Chapin's +1 kept it off the floor. It wasn't ignored, either. Tommy Chapin drew the line exactly where you'd expect — *\"I like this song up until the kazoos come in\"* — and Joe Quinto's verdict ran to three words: **\"vanilla as hell.\"**\n\nThe most sensitive instrument detector in the league brought a kazoo to a cowbell fight.",
}

# ── flow ─────────────────────────────────────────────────────────────────────
# body_2 cut by two thirds: the auto-harp trial and the mandolin concession both
# belong to The Litigator now (findings 1 and 2). What's left is the one thing
# the card can't carry. Michael Black's rubric clause gone (finding 5).
flow = {
    "title": "Name the Instrument",
    "body": "Everyone named their instrument and got on with it: a **synthetic idiophone** (Mara), animal noises and straw slurping (Mashew), a **bedspring** (Sarah Zucker), a **theremin** (Joe Quinto, who supplied the 1920 invention date and the physicist's name), Benjamin Franklin's **glass harmonica** (Tommy Chapin), a **balalaika** (Sarah Black, submitting \"in honor of\" it), a **sitar** (Michael Black), a **mandolin** (Philip Chapin), a **jug** (jac, who named nothing and let Jonathan Black do it for him — \"Fine jug playing\"), a **harmonica** (Jonathan Black), an **auto-harp** (Michael Layous), a **kazoo** (Brian Pascoe) — and **Tj Cook**, who submitted NOFX with no explanation whatsoever and finished fourth anyway.\n\nEvery voter spent exactly one downvote and twelve upvote points, the budget up from eleven now the roster has reached thirteen. **The thirteen knives landed on eight different songs.** Sarah Zucker apologised for hers in writing — *\"I'm so sorry you didn't deserve the downvote\"* — to Philip Chapin, who then watched Sarah Black spend hers on the same song.",
    "body_2": "The league's chief instrument inspector spent the round auditing everyone else's paperwork and filing his own late. **Jonathan Black's entry was a harmonica** — in a hip-hop song, admittedly, but a harmonica, the least exotic object anyone named all week, credited to \"Andre 3000's step dad.\" It finished **ninth and collected three downvotes, more than any other song in the round.** His proceedings against everyone else's instruments are documented under The Usual Suspects.",
}

# ── consensus ────────────────────────────────────────────────────────────────
# Sarahs-on-Zeppelin restatement removed (finding 4); Michael Black's Rasputin
# downvote left to the chat punchline (finding 6). Six items -> five.
consensus = {
    "title": "Where the League Agreed",
    "items": [
        {"song": "Guttermilk (The Bobby Lees, submitted by missmara)",
         "agreement": "**Nine upvoters, zero downvotes** — one of only two clean sheets in a week when everyone had to knife something. Mashew, Philip Chapin, Joe Quinto and Tommy Chapin all went to +3. Brian Pascoe left a 0 (\"Sick video\") and monicac1217 never touched it, and it still won by a point."},
        {"song": "Philthy Phil Philanthropist (NOFX, submitted by Tj)",
         "agreement": "The other clean sheet: **nine upvoters, no downvotes, 13 points**, nobody above +3, and no submission comment at all. Jonathan Black's 0 was the entire review — *\"Not my favorite NOFX song, but mediocre NOFX is still good.\"*"},
        {"song": "Rasputin (Boney M., submitted by Sarah S)",
         "agreement": "Eight upvoters for the balalaika. Jonathan Black paid the most (+3) and made the quid pro quo explicit: *\"Did you not think the voter who submitted a Russian song in a non-¡No Entiendo, Cabron! week would not reward a song with a balalika? Пожалуйста.\"*"},
        {"song": "Some Cut (Trillville, submitted by Sarah)",
         "agreement": "Eight upvoters, one downvote from Philip Chapin, and a 0 from Jonathan Black that still found room to call it *\"a touch of class to this wholesome family song.\"*"},
        {"song": "Rosa Parks (Outkast, submitted by Jonathan Black)",
         "agreement": "**The round's most divided song**: six upvoters against three of the week's thirteen downvotes — jac, Joe Quinto and Tommy Chapin."},
    ],
}

# ── quotes (unchanged shape, one swap to spread names) ───────────────────────
quotes = {
    "title": "Voter Commentary",
    "items": [
        {"voter": "Tommy Chapin", "quote": "This song is great. I'm just bitter that my Bombs Over Bagdad selection a few weeks back didn't get much love and I'm taking it out on you.  I'm a POS.  RP is a much better song than BOB and I'm SMH thinking, \"WTH am I doing voting this down?\" Anyway...Andre's step dad sounds like a super talented human being.  Also, SHOUT OUT to step-dads!  I love you."},
        {"voter": "Joe Quinto", "quote": "How much Outkast do we really need, here...?!?!"},
        {"voter": "missmara", "quote": "Something about Florence's voice in this song is reminiscent of Jeannine Pirro. I was waiting to hear \"He damaged the pool!\" halfway through the song but it never came."},
        {"voter": "Sarah", "quote": "A surprise kazoo was a good choice. I'm sorry I ran out points."},
        {"voter": "Michael Layous", "quote": "Will Mariani view this as too Ska"},
        {"voter": "Tommy Chapin", "quote": "Took the sitar for granted the previously 1000 listens.  Actively listening for the sitar-  it's like hitting refresh!  Amazing!"},
        {"voter": "Voltron’s YoungLion", "quote": "Mitski caressing her own hair and making out with her hand and fucking ripping this song. Best playlist yet and the videos are all sick"},
    ],
}

# ── chat: options 6, 7, 2, 9, 3, 4 in day order ─────────────────────────────
chat = {
    "title": "Off-Mic",
    "summary": "Seven days: a harpsichord verdict, a bean burrito excavation, a commissioners' dispute settled by their wives, a peso ledger, a statement of conscience, and two of the quietest men in the league finally talking to each other.",
    "moments": [
        {"label": "Jac Transmits", "detail": "**aug 17–18.** He surfaced, ran a two-day broadcast, and narrated his own pattern without appearing to notice it: *\"I'm good for a day or two. Then go silent for a week.\"* On the theme — \"Is a Harper chord a thing they would apply?\", then \"Harpsichord\", then **\"Worst instrument ever.\"** On Good Vibrations: *\"Sending it so my brothers don't.\"* On Maxwell's Silver Hammer: *\"JV soccer songs. You wouldn't understand.\"* And, on this publication: *\"If you wait long enough, the AI sums up all the conversations.\"* He is right. This is that."},
        {"label": "Bean Burritos and Dr. Ladd", "detail": "**aug 18–19.** \"JV soccer songs\" cracked open a thirty-year-old cafeteria memory that ran across two days and pulled **Michael Black** back into the chat gently for once. Jac: *\"Mike Black pregame bean burrito's. You did miss out.\"* … *\"Dr. Ladd.\"* … *\"Porn mags. The Beatles. Winning!\"* Jonathan Black, who did not play JV soccer, worked the outside of the fence — *\"And here I thought I had missed something not playing jv soccer\"*, then **\"You had me at bean burritos\"**, and the next morning, still on it: *\"These bean burritos you mention. They the cafeteria ones?\"* Michael Black confirmed the whole record: *\"Doc Ladd was the shit! So were bean burritos. Feel like there were a lot of corn dogs before practices as well.\"*"},
        {"label": "The Commissioners' Tiff, Settled by Their Wives", "detail": "**aug 19.** Mashew brought a grievance about Jon's rules in the *other* league into this one and announced, in the group, **\"Yes we are having a tiff about it.\"** Jon's reply was a diagnosis: *\"The first sentence in this message reads like: 😭.\"*\n\nThen both wives arrived and the men were, briefly, managed. **Mara**, to her husband: *\"The productive way to say this is, 'when you write that, i feel ___'\"* — met with Jon's *\"I wasn't trying to be productive.\"* **Sarah Black**, to hers, filed the finding of the week: *\"I don't think JB is pulling his weight as commissioner in the other league. Pls report back. And also report how members of that league would complete the sentence 'when JB requires comments, I feel…'\"*\n\nMashew's closing argument — *\"I slave over a round all day and you come home and play the role of Mr. Fun commissioner\"* — went unanswered, which is roughly how these end."},
        {"label": "The Peso Ledger", "detail": "**aug 21.** It opened as a fitness proposal: **\"Mimick Bobby Farrels performance from the Rasputin video. Do that everyday and you will be able to dunk Cook.\"** Tj Cook countered with his own regime — *\"I put my bong down stairs so I atleast have to do a lil cardio to smoke\"* — and Brian Pascoe pivoted to an audit: *\"How many DUI's in this chat?\"* Tj disclosed one 7:45 a.m. DUI from 2003 and closed the file: *\"The cop was a shady one. I will speak no more about it.\"* Pascoe's own ledger ran longer — **roughly 7,000 pesos since 2010** across all traffic stops, one bicycle collision settled with a beach cruiser the victim then rejected on quality grounds (*\"He said beach cruisers suck anyways\"*), and one standing instruction: *\"No mobile cantinas, i was told.\"*"},
        {"label": "Sarah Zucker Would Like It Noted", "detail": "**aug 22.** She has posted **five messages all season**. Two of them are in this round, and the first is a statement of conscience filed before a single ballot went in: **\"I just want to say for the record that I don't want to downvote anyone.\"** Followed by: *\"Everybody did their part in the group project.\"*\n\nThen her ballot arrived carrying **three separate apologies** — to Philip Chapin (*\"I'm so sorry you didn't deserve the downvote\"*), to Brian Pascoe (*\"I'm sorry I ran out points\"*), and, back on aug 16, to a dead Hawaiian singer for having implied a machine could have made his record (*\"I'm sorry I said that!\"*). Jonathan Black, the same evening, caught it too: *\"I feel worse about awarding 0s and -1 than I did for the dead guys last week.\"* Last round it was Tj who couldn't stomach the mandatory knife. It travels."},
        {"label": "Layous and Chapin Discover Each Other", "detail": "**aug 23.** Two of the least visible men in the league spent an hour on Sacramento — trees, garlic wholesale, restaurants — in the only conversation all week with no bit in it. **Michael Layous:** \"What do you think of the trees us Sac?\" **Philip Chapin:** *\"Super gay and over rated…\"* and then, unprompted, *\"But sometimes… I like walking down the street and hearing the delta breeze make the leaves rub amongst each other.\"*\n\nLayous clocked it live: **\"There we go… Finally some honest communication… Instead of sarcasm and humor.\"** He also disclosed his actual profession — *\"We were visiting Raley's to talk garlic… Visited like 5 stores\"* — and got a warm, slightly wounded correction on his own identity: Philip, realising who he'd been talking to for an hour, *\"Oh Layous! I only saw Michael on the chat\"*; Layous, *\"All good. No need to rub it in.\"* Philip signed off with **\"PC is my outer name. Hello there…\"**"},
    ],
}

# ── storylines ───────────────────────────────────────────────────────────────
storylines = {
    "title": "The Usual Suspects",
    "cast": [
        {"name": "The Cat Lobby", "player": "Sarah Black", "type": "single-issue advocate",
         "style": "spotlight", "motif": "one platform, zero concessions",
         "note": "Her biggest week since the lobby was founded. A round about unusual instruments produced a scale with a cat at one end, and the constituency was welcomed, expanded and purged inside a single hour.\n",
         "spotlight": {"text": "I was going to formally welcome you to the cat lobby but now you’re 86ed like JAC",
                       "caption": "membership revoked eleven minutes after it was offered · aug 20"},
         "evidence": ["Welcome to the constituency. The cat lobby thanks you.",
                      "Loving this energy. And especially the inclusion of space kitty",
                      "JB still hasn’t unpacked his suitcase from a trip that ended 2 weeks ago, because the cats like to sit in it."],
         "highlight": ["cat lobby", "constituency", "space kitty"]},
        {"name": "The Litigator", "player": "Jonathan Black", "type": "courtroom formalist",
         "style": "quote-led", "motif": "everything is a deposition",
         "note": "Off the bench, because this is the week the bit got its exhibit. He attached an appeals process to a downvote, conceded a point while denying its premise, and litigated a trailing comma to a draw.\n",
         "evidence": [
            "If the submitter can provide me evidence this song uses a “heavily distorted acoustic auto-harp,” I will give you an additional +2 in next week’s category as an apology.",
            "I say this only to be annoying.  I was always going to give it +1.",
            "I'll try “not confuse,” bonehead.",
            "I'm already talking to you on another chat.  That's how much I don't care about this one."],
         "highlight": ["evidence", "apology", "annoying", "not confuse"]},
    ],
    "note": "**Both of this week's regulars live at the same address.** One has spent the season lobbying for more cat coverage; the other attaches an appeals process to a downvote. Dinner at the Black house is presumably a hearing, with a cat on the table.\n\n**On the bubble** — two bits are one more sighting away from a card of their own. **Sarah Zucker**, who has now apologised on three separate ballots and once, pre-emptively, in the chat. And **Jac**, whose broadcast pattern he has himself described: silent for a week, then everything at once. **Michael Layous** keeps his card warm on the bench, and **Tommy Chapin** wrote 1,925 characters of vote commentary this round — the most in the league — which is a bit whether he means it as one or not.\n\nRegulars are recurring Second Best bits caught in the wild. One only appears when this round's chat or ballots back the bit with a real quote — every line above is verbatim.",
}

# ── coinage ──────────────────────────────────────────────────────────────────
# media block intentionally absent until Matt supplies the files; a poster path
# that 404s renders as a broken image inside the card.
stats = {
    "phrase": {
        "style": "dictionary",
        "term": "the feline assassin gang",
        "pronunciation": "/ˈfiːlaɪn əˈsæsɪn ɡæŋ/",
        "part_of_speech": "noun · proper · self-applied",
        "definition": "Jonathan Black's name for his own cats, deployed the moment they graduated from rodents. The household position is that they kill for sport and leave the evidence where it will be seen. Within hours the term had been to trial: Tommy Chapin reported the household to the authorities, Jac Chapin delivered an unsolicited doctrine on outdoor cats, and the thread arrived at whether a human can murder an animal — settled, on the record, by a judge's son.\n",
        "coined": {"by": "Jonathan Black", "date": "2026-08-16", "at": "the league",
                   "context": "posted with photographic evidence of the gang's first non-rodent kill"},
        "stats": {"uses": 2, "speakers": 2, "prior_rounds": 0},
        "usages": [
            {"label": "original", "speaker": "Jonathan Black",
             "text": "First confirmed non-rodent kill from our feline assassin gang. Would prefer they stick to mice and rats (or scrub jays because fuck those assholes)"},
            {"label": "the prosecution", "speaker": "Tommy Chapin",
             "text": "Tearing it open is probably a sign your cat is starving.  I'm calling CPS.  The other CPS."},
            {"label": "the ruling", "speaker": "Jac Chapin",
             "text": "A human can't \"murder\" an animal. We can just waste the meat."},
            {"label": "the dad joke", "speaker": "Jac Chapin", "text": "Meowing assassins."},
        ],
    }
}

SECTIONS = {"podium": podium, "villain": villain, "flow": flow,
            "consensus": consensus, "quotes": quotes, "chat": chat, "storylines": storylines}

db = sqlite3.connect(DB)
for kind, content in SECTIONS.items():
    cur = db.execute("UPDATE digest_sections SET content_json=?, "
                     "edited_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
                     (json.dumps(content, ensure_ascii=False), P + kind))
    print(f"{kind:11} rows={cur.rowcount}")
db.execute("UPDATE digest_drafts SET stats_content_json=? WHERE round_id=140",
           (json.dumps(stats, ensure_ascii=False),))
print("coinage      -> the feline assassin gang (media pending)")
db.commit(); db.close()
