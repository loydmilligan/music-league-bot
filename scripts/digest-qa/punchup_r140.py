#!/usr/bin/env python3
"""R140 "More Cowbell!" punch-up (second-best), driven by the HiL ratings.

love: lede-2 (Some Cut conquers the chat), lede-6 (Layous + Matt caught talking shit)
keep: lede-1 (Guttermilk clean), lede-3 (auto-harp challenge), lede-4 (MB buys a downvote)
kill: lede-5 (farkas -> promoted to the Coinage card), lede-8 (Clapton -> villain reframed
      onto Brian Pascoe himself, per Matt's condition)
notes: trash JB's theme pickiness re Mitski; BP's squeak fixation + the '97 callback;
       credit Mara for Matt's pick; maximise roster mention coverage.

Every quote verbatim, every number recomputed from votes.
"""
import json, sqlite3, sys

DB = sys.argv[1] if len(sys.argv) > 1 else "data/league.db"
P = "draft-140-1cfdd14a-"

podium = {
    "title": "The Mariani Household Takes the Top Two",
    "items": [
        {"artist": "The Bobby Lees", "title": "Guttermilk", "submitter": "missmara", "points": 19,
         "color": "Nine upvoters, no downvotes, in a week where every voter was required to knife something.",
         "coverUrl": "https://i.scdn.co/image/ab67616d0000b273c1bb1f706d32303b28b96db4"},
        {"artist": "Superorganism", "title": "Something For Your M.I.N.D.", "submitter": "Mashew", "points": 18,
         "color": "Tj Cook spent the full +6 cap on it — the largest single vote of the round — then announced it in the chat.",
         "coverUrl": "https://i.scdn.co/image/ab67616d0000b273f130e117ff4a567a4c8adc88"},
        {"artist": "Trillville", "title": "Some Cut", "submitter": "Sarah", "points": 15,
         "color": "A bedspring. Third place, and comfortably the most-discussed song of the week.",
         "coverUrl": "https://i.scdn.co/image/ab67616d0000b273ff96cb80f7b3c5a161689e38"},
    ],
    "body": "Mara Mariani won this round twice. Her own pick — The Bobby Lees' \"Guttermilk,\" flagged in her comment as a *\"synthetic idiophone… kinda like a triangle which is pretty unusual in a song that goes this hard\"* — took **19 points from nine upvoters with nothing against it**, one of only two clean sheets in a week where all thirteen voters were obliged to spend a downvote. And then there is second place. Mashew put up Superorganism's \"Something For Your M.I.N.D.\" for 18 and confessed the sourcing in the chat with the results already in: **\"I must give Mara credit for my pick this week.\"**\n\nSo the arithmetic is not really in dispute. **Mara Mariani is responsible for 37 of this round's points and for both songs on the top of the table** — first place under her own name, second place under her husband's. Matt's contribution to the silver medal was typing.\n\nTj Cook did the rest of the work on it, spending the full +6 per-song cap — the largest single vote anyone cast all round, and half his entire budget — then saying so out loud: \"I was referring to your song. Got my votes this week.\" Michael Layous added +3, Mara another +2. Only Brian Pascoe voted against it.\n\nSarah Zucker's Trillville pick took third on 15 with a two-word submission comment — \"More bedspring.\" — and then went on to dominate the week's conversation more thoroughly than either song above it.",
}

villain = {
    "title": "Pascoe Hears Everything, Submits a Kazoo",
    "body": "Nobody in this league listened harder this week than Brian Pascoe. Handed a round about unusual instruments, he filed the single most attentive ballot in it: +3 on \"Some Cut\" with a full technical finding — *\"The squeak more prominent than any other unusual instrument. Lil Jon you crazy for this one. So nasty. Their poor mothers. Our poor culture\"* — plus +2 on \"In the Summertime,\" which he certified from field experience (*\"I was witness to this song causing two cougars to strip tease around a campfire in remote Baja. Their husbands were passed out already\"*), +2 on Mitski, and +2 on \"Rosa Parks,\" where he saw \"Sarah in a chest protector and Jonathan in shoulder pads, tooting his harmonica this All Hallows Eve.\"\n\nThe man has an ear. It is tuned to one frequency. Ask him about a Layous DUI and he surfaces, unprompted, a memory from roughly the first semester of college — \"I think we were leaving Chalet, cool girls in the whip\" — and when the Lil Jon explainer went around he tagged the three women in the league with \"This one for the ladies,\" a gesture they discuss below at some length and without gratitude.\n\nAnd then his own submission. Eric Clapton's \"San Francisco Bay Blues - Acoustic Live\" finished on **2 points, six clear of anything else in the round.** Mashew spent his mandatory downvote on it — \"Too jokey\" — and Michael Layous spent his the same way. Only monicac1217's +2 and Philip Chapin's +1 kept it off the floor entirely. It was not ignored: Jonathan Black paid a point purely on craft (\"I'll be gosh darned if I hear anyone say there's a finer kazoo player that Mr. Eric Clapton\"), Sarah Zucker filed a nothing and an apology, and Tommy Chapin drew the line exactly where you would expect — \"I like this song up until the kazoos come in.\" Joe Quinto's verdict ran to three words: \"vanilla as hell.\"\n\nThe most sensitive instrument detector in the league brought a kazoo to a cowbell fight.",
}

flow = {
    "title": "Name the Instrument",
    "body": "Michael Black spent the week trying to impose a scoring rubric on a round that did not need one; everyone else simply named their instrument and got on with it. The roll call: a synthetic idiophone (Mara), animal noises and straw slurping and apple biting (Mashew), a bedspring (Sarah Zucker), a theremin (Joe Quinto, who supplied a 1920 invention date and a physicist's name), Benjamin Franklin's glass harmonica (Tommy Chapin), a balalaika (Sarah Black, submitting \"in honor of\" it), a sitar (Michael Black), a mandolin (Philip Chapin), a jug (jac, who named nothing and let Jonathan Black do it for him — \"Fine jug playing\"), a harmonica (Jonathan Black), an auto-harp (Michael Layous), a kazoo (Brian Pascoe) — and Tj Cook, who submitted NOFX and no explanation whatsoever and finished fourth anyway.\n\nEvery voter had to spend exactly one downvote and twelve upvote points, the budget having risen from eleven this week as the roster reached thirteen. The thirteen knives landed on eight different songs. Sarah Zucker apologised for hers in writing — *\"I'm so sorry you didn't deserve the downvote\"* — to Philip Chapin, who then watched Sarah Black spend hers on the same song.",
    "body_2": "Which brings us to the league's chief instrument inspector. Jonathan Black spent the round auditing everyone else's paperwork: he could not identify the noise in Mara's winner (\"I'm not sure what's making the pinging sound\"), he informed Philip that a mandolin is \"unique for Led Zeppelin, but not necessarily for the folk-style genre this song would fall into. I say this only to be annoying. I was always going to give it +1,\" and he opened formal proceedings against Michael Layous's Mitski submission, demanding documentary evidence that a \"heavily distorted acoustic auto-harp\" exists in the recording and posting a +2 bounty next round if it can be produced. It is the only downvote in league history to arrive with an appeals process attached.\n\nHis own entry was a harmonica. In a hip-hop song, admittedly — but a harmonica, the single least exotic object anyone named all week, credited in his comment to \"Andre 3000's step dad.\" It finished **ninth, and collected three downvotes, more than any other song in the round.** The auditor should perhaps file his own returns first. Mashew, for what it's worth, was persuaded: \"Jb forced me to dive deep in this one, which turned me around\" — a +1 to Mitski, on Jonathan's evidence, against Jonathan's vote.",
}

consensus = {
    "title": "Where the League Agreed",
    "items": [
        {"song": "Guttermilk (The Bobby Lees, submitted by missmara)",
         "agreement": "Nine upvoters, zero downvotes. Mashew, Philip Chapin, Joe Quinto and Tommy Chapin all went to +3; Sarah Black and Michael Layous to +2. Brian Pascoe left a 0 (\"Sick video\") and monicac1217 never touched it — and it still won by a point."},
        {"song": "Philthy Phil Philanthropist (NOFX, submitted by Tj)",
         "agreement": "The round's other clean sheet: nine upvoters, no downvotes, 13 points, nobody above Mashew's +3, and no submission comment at all. Jonathan Black's 0 was the entire review — \"Not my favorite NOFX song, but mediocre NOFX is still good.\""},
        {"song": "Rasputin (Boney M., submitted by Sarah S)",
         "agreement": "Eight upvoters for the balalaika, and one downvote from Michael Black. Jonathan Black paid the most (+3) and made the quid pro quo explicit: \"Did you not think the voter who submitted a Russian song in a non-¡No Entiendo, Cabron! week would not reward a song with a balalika? Пожалуйста.\""},
        {"song": "Some Cut (Trillville, submitted by Sarah)",
         "agreement": "Eight upvoters, one downvote (Philip Chapin), one 0 from Jonathan Black — who still found room to call it \"a touch of class to this wholesome family song.\" Joe Quinto paid up against his own expectations: \"surprisingly, I really like this song.\""},
        {"song": "Rosa Parks (Outkast, submitted by Jonathan Black)",
         "agreement": "The round's most divided song: six upvoters against three of the week's thirteen downvotes — jac, Joe Quinto and Tommy Chapin. Its submitter voted 0 on it, which was the only vote available to him."},
        {"song": "The Battle of Evermore (Led Zeppelin, submitted by Philip Chapin)",
         "agreement": "Eight upvoters, none above +2, and both of the league's Sarahs spent their mandatory knife on it. Tommy Chapin's verdict was the shortest defence of the week: \"Correct mandolin song to choose from IV.\""},
    ],
}

quotes = {
    "title": "Voter Commentary",
    "items": [
        {"voter": "Tommy Chapin", "quote": "This song is great. I'm just bitter that my Bombs Over Bagdad selection a few weeks back didn't get much love and I'm taking it out on you.  I'm a POS.  RP is a much better song than BOB and I'm SMH thinking, \"WTH am I doing voting this down?\" Anyway...Andre's step dad sounds like a super talented human being.  Also, SHOUT OUT to step-dads!  I love you."},
        {"voter": "Jonathan Black", "quote": "If the submitter can provide me evidence this song uses a “heavily distorted acoustic auto-harp,” I will give you an additional +2 in next week’s category as an apology."},
        {"voter": "missmara", "quote": "Something about Florence's voice in this song is reminiscent of Jeannine Pirro. I was waiting to hear \"He damaged the pool!\" halfway through the song but it never came."},
        {"voter": "Sarah", "quote": "A surprise kazoo was a good choice. I'm sorry I ran out points."},
        {"voter": "Michael Layous", "quote": "Will Mariani view this as too Ska"},
        {"voter": "Tommy Chapin", "quote": "Took the sitar for granted the previously 1000 listens.  Actively listening for the sitar-  it's like hitting refresh!  Amazing!"},
        {"voter": "Voltron’s YoungLion", "quote": "Mitski caressing her own hair and making out with her hand and fucking ripping this song. Best playlist yet and the videos are all sick"},
    ],
}

chat = {
    "title": "Off-Mic",
    "summary": "A bedspring took over the group chat, two men were caught talking about a third at midnight, the new guy opened a market in downvotes, and jac tried to sing Led Zeppelin at four in the morning.",
    "moments": [
        {"label": "Some Cut Conquers the Chat",
         "detail": "Sarah Zucker submitted Trillville with two words — \"More bedspring.\" — and produced more conversation than the winner did. Sarah Black identified the genius before she knew whose it was: \"Whoever did Some Cut is brilliant 💀.\" Brian Pascoe circulated a Lil Jon explainer and tagged all three women in the league with \"This one for the ladies.\" The ladies declined the gift. Sarah Zucker: \"Yes I feel so heard and catered to with that song. ' Show your ass how to really catch a nut' and being followed in the mall.\" Tommy Chapin, meanwhile, filed the only unambiguously positive review — \"Awesome song. A true Backyard BBQ Banger. Hellurrrr!\" — and Joe Quinto conceded ground he clearly hadn't meant to give: \"surprisingly, I really like this song.\" Third place, first in volume."},
        {"label": "Caught Talking Shit at Midnight",
         "detail": "Michael Layous and Matt Mariani spent a late-night thread comparing Michael Black unfavourably to Tommy Chapin — Layous on the new guy's style (\"Those run on texts / It's like it's generic / TLDR 24/7\"), Mashew reducing the whole roster to \"yep - warm bodies.\" Michael Black woke up and read all of it. His reply was the best-played hand of the week: \"Not a competition between me and Tommy fellas. He was, and still is, funnier, wittier, and more handsome than I could ever be. And I can only stay up so late. I'm glad I got to wake up to the two of you talking shit about me though. That was nice. Garces game invite rescinded Layous.\" Jonathan Black arrived to arbitrate on a technicality: \"You guys both are and were funny, witty, and handsome. By Bakersfield standards.\""},
        {"label": "The Downvote Market",
         "detail": "Two weeks into his membership, Michael Black went shopping: \"If anyone wants to let me know what song they think mariani or layous submitted I will happily give either of them a -1.\" Mara Mariani, who had submitted the eventual winner and sourced the runner-up, asked the only sensible question — \"What are you offering?\" — and got a quote: \"4, maybe 5 points. Let's talk offline Mara.\" jac's objection was procedural rather than moral: \"Buying votes now? No Chapin has been in such cahoots!\" No transaction is recorded. Michael Black downvoted Sarah Black's Rasputin instead."},
        {"label": "jac's Four A.M. Zeppelin",
         "detail": "jac got stuck transmitting fragments of \"The Battle of Evermore\" in the small hours — \"For thought who stand long\" — and, when queried, offered the diagnosis \"mixing up streams.\" Mashew told him to stop. Philip Chapin and Mara Mariani told him to keep going. He had already given the song +2."},
        {"label": "The Peso Ledger",
         "detail": "Brian Pascoe opened an audit of the group's driving record (\"How many DUI's in this chat?\") and ended up disclosing his own: roughly 7,000 pesos since 2010 across all traffic stops, a bicycle collision settled with a beach cruiser the victim then rejected on quality grounds (\"He said beach cruisers suck anyways\"), and one roadside instruction he has evidently taken to heart — \"No mobile cantinas, i was told.\" Tj Cook contributed a single 7:45 a.m. DUI from 2003 and closed the subject: \"The cop was a shady one. I will speak no more about it.\""},
    ],
}

storylines = {
    "title": "The Usual Suspects",
    "cast": [
        {
            "name": "The Cat Lobby", "player": "Sarah Black", "type": "single-issue advocate",
            "style": "spotlight", "motif": "one platform, zero concessions",
            "note": "The lobby's biggest week since its founding. A theme about unusual instruments produced, unprompted, a scoring scale with a cat at one end — and the constituency was welcomed, expanded, and purged inside a single hour.\n",
            "spotlight": {
                "text": "I was going to formally welcome you to the cat lobby but now you’re 86ed like JAC",
                "caption": "membership revoked eleven minutes after it was offered · aug 20",
            },
            "evidence": [
                "Welcome to the constituency. The cat lobby thanks you.",
                "Loving this energy. And especially the inclusion of space kitty",
                "Before Jac began his cat violence ranting and raving",
            ],
            "highlight": ["cat lobby", "constituency", "space kitty"],
        },
        {
            "name": "The Litigator", "player": "Jonathan Black", "type": "courtroom formalist",
            "style": "quote-led", "motif": "everything is a deposition",
            "note": "Off the bench, because this was the week the bit finally got its exhibit. He attached an appeals process to a downvote, conceded a point while denying its premise, and litigated a trailing comma to a draw.\n",
            "evidence": [
                "If the submitter can provide me evidence this song uses a “heavily distorted acoustic auto-harp,” I will give you an additional +2 in next week’s category as an apology.",
                "I say this only to be annoying.  I was always going to give it +1.",
                "I'll try “not confuse,” bonehead.",
                "I'm already talking to you on another chat.  That's how much I don't care about this one.",
            ],
            "highlight": ["evidence", "apology", "annoying", "not confuse"],
        },
    ],
    "note": "the regulars are recurring second best bits caught in the wild. one only appears when this round's chat or ballots back the bit with a real quote — every line above is verbatim.",
}

stats = {
    "phrase": {
        "style": "dictionary",
        "term": "farkas",
        "pronunciation": "/ˈfɑːrkəs/",
        "part_of_speech": "noun · unit of measure",
        "definition": "The maximum value on Michael Black's proposed scale of unusualness. One farkas is a bilingual cat that has been to Mars, speaks Swahili and sign language, returns to Earth with news of life there, and then elects to only meow at us. A cat that has not been to Mars scores 1. Within two minutes of its introduction the word was also functioning as a mild expletive.\n",
        "coined": {
            "by": "Michael Black", "date": "2026-08-20", "at": "the whole league",
            "context": "while attempting to legislate a Prominence-and-Unusualness rubric onto a round about cowbells",
        },
        "stats": {"uses": 5, "speakers": 2, "prior_rounds": 0},
        "usages": [
            {"label": "original", "speaker": "Michael Black",
             "text": "1 is a cat. 10 is a bilingual cat that has been to mars. He comes back and tells us humans there's life on mars. You'll be surprised to know that neither language is English. His name is Farkas by the way."},
            {"label": "weaponised, two minutes later", "speaker": "Tj Cook",
             "text": "What the farkas are you talking about?"},
            {"label": "the etymology, self-supplied", "speaker": "Michael Black",
             "text": "Farkas was Kramer's bizarro character from this show I used to watch. That's how AstroCat got his name."},
        ],
    }
}

SECTIONS = {"podium": podium, "villain": villain, "flow": flow,
            "consensus": consensus, "quotes": quotes, "chat": chat}

db = sqlite3.connect(DB)
draft_id = db.execute("SELECT id FROM digest_drafts WHERE round_id = 140").fetchone()[0]
for kind, content in SECTIONS.items():
    cur = db.execute(
        "UPDATE digest_sections SET content_json = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
        (json.dumps(content, ensure_ascii=False), P + kind))
    print(f"{kind:10} rows={cur.rowcount}")

db.execute(
    """INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json, edited_at, regen_count, variant)
       VALUES (?, ?, 'storylines', 6, 'default', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, 'visual')
       ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, edited_at = excluded.edited_at""",
    (P + "storylines", draft_id, json.dumps(storylines, ensure_ascii=False)))
print("storylines inserted")

db.execute("UPDATE digest_drafts SET stats_content_json = ?, stats_position = 7 WHERE round_id = 140",
           (json.dumps(stats, ensure_ascii=False),))
print("coinage card written")
db.commit(); db.close()
