#!/usr/bin/env python3
"""R148 punch-up pass (WS6.1 steps 4-5). Writes hand-authored content into the
draft's sections + the stats slot, and inserts the storylines (Regulars) row
that generation skipped because boarz-ii-men is not opted into
storylines_section_leagues.

Every number/quote here was verified against data/league.db in-session.
"""
import json, sqlite3, sys

DB = sys.argv[1] if len(sys.argv) > 1 else "data/league.db"
PREFIX = "draft-148-985cb17b-"

podium = {
    "title": "The Combo Option",
    "items": [
        {
            "rank": 1,
            "title": "Waiting Around To Die",
            "song": "Waiting Around To Die",
            "artist": "The Be Good Tanyas",
            "submitter": "Jonathan Black",
            "points": 15,
            "note": "Eight of the eight voters who could vote for it did. Nothing against it.",
            "coverUrl": "https://i.scdn.co/image/ab67616d0000b2733f4d69f6be7e58fad5f8331f",
        },
        {
            "rank": 2,
            "title": "Cousin Dupree",
            "song": "Cousin Dupree",
            "artist": "Steely Dan",
            "submitter": "Shane Farkas",
            "points": 9,
            "note": "Answered the round's title rather than its theme, and got paid anyway.",
            "coverUrl": "https://i.scdn.co/image/ab67616d0000b273f5e9d575b1727f2ce6fec86e",
        },
        {
            "rank": 3,
            "title": "Rusty Cage",
            "song": "Rusty Cage",
            "artist": "Johnny Cash",
            "submitter": "CJ Wookie",
            "points": 7,
            "note": "Tied with Dixieland Delight at 7. Listed first on upvoter count; the league has no written tiebreak.",
            "coverUrl": "https://i.scdn.co/image/ab67616d0000b27308d570b67ea76115b26daa8f",
        },
    ],
    "body": "Jon Black stopped picking a side. The Be Good Tanyas' \"Waiting Around To Die\" — a Townes Van Zandt song cut in Nashville, played like Seattle in February — took **15 points from every voter who was allowed to vote for it**: eight of eight, nothing against it, six points clear of second. His submission comment did the whole job in one line: *\"Went with the Combo Option = Seattle's depression/indie sound + song penned by my favorite country artist (recorded originally in Nashville).\"* Grant Koziol spent the round's joint-largest single vote on it (+4). Conor gave three and called it \"the type of choice that makes this abusive league worth it.\" Mashew managed one point and a correct guess in the same breath — *\"Guessing JB - plus 1 for the combo - but that the best I can do.\"*\n\nShane Farkas took second with Steely Dan's \"Cousin Dupree\" (9), a song with no connection to either city, which instead answered the round's *title*. Six voters paid for it; only Jensen negged it.\n\nThird is unsettled. \"Rusty Cage\" and \"Dixieland Delight\" both finished on 7, and this league has never written down a tiebreaker. Cash's Soundgarden cover is listed first only because six voters put points on it to Alabama's five — treat the ordering as provisional.\n\nThe win also moved the season. Jon arrives at 47 and takes the lead off Darren Paletz, who came into the round on 40 and left it on 35.",
}

villain = {
    "title": "Double Pen Paletz Files No Ballot",
    "body": "Darren Paletz wrote the longest submission comment of the round — a real little essay about Sir Mix-A-Lot as a Seattle local years before he was a global novelty, ending with a plea to *\"click the 'switch to video' link to get the full experience of the rap scene in the Pacific NW in 1988.\"* It worked. Jimmy Troy spent +4 on it, the joint-largest single vote of the round: *\"I appreciate the explanation and video. It was a real treat to watch….\"* Five voters put a combined eight points on \"Posse On Broadway.\"\n\nThen he never filed a ballot.\n\nThe rule is not new — Grant Koziol ate it in R147 — and it is not gentle: **a submitter who doesn't vote has his upvotes voided and keeps every downvote.** Eight points of credit evaporate; JB's −2, Shane's −2 and Mashew's −1 all stand. Official result: **−5 and last place**, five points below Clements, who wrote the theme and scored zero with it.\n\nThe league watched it coming in real time. Conor, eighty-five minutes before the deadline: \"Is Double Pen Paletz about to miss his vote?\" Jensen, doing the math out loud: \"Given he's so far ahead, wouldn't missing a vote bring us closer to parity?\" JB, flat: \"he'll get just negs if he doesn't vote.\" Jensen's last word on the subject — \"Probably all up votes anyways\" — was wrong by eight points and a season lead.",
}

flow = {
    "title": "Nashville OR Seattle OR",
    "body": "Clements wrote the theme as an either/or and most of the league read it as a dare: *\"Songs that make you think of Nashville OR Seattle OR an unholy union of these two benighted U.S. cities.\"* Five of the ten submissions came in on the Seattle side — two Nirvana, Harvey Danger, Sir Mix-A-Lot, and Courtney Barnett arriving from Australia on a slacker-vibes visa. Two came in on the Nashville side: Alabama and George Strait. Two actually attempted the union — Jon Black's Be Good Tanyas and Conor's Johnny Cash covering Soundgarden. And \"Cousin Dupree\" answered no city at all; it answered the round's name, which turned out to be worth nine points and second place.\n\nThe two songs that took the \"unholy union\" clause literally finished first and joint-third. The theme's author finished on zero: George Strait's \"All My Ex's Live In Texas\" mentions Tennessee once and then spends the rest of the song in Texas, which three voters were pleased to point out on the way past. Conor's −1 was the tidiest — *\"I've always found this song gimmicky and just ok, and while TN is mentioned, it's much more TX.\"*",
    "body_2": "The ballots ran unusually judicial this week. Conor negged Jensen's live Nirvana with the coldest line of the round — *\"This is an all-time great song, which is why it's still on the radio constantly. I don't see how you've contributed anything thoughtful or nonobvious here\"* — though Jensen's own submission comment had already pled guilty in advance: *\"An obvious song from an obvious band. Is this what the league wants?\"* Covers got taxed: \"Rusty Cage\" drew six upvoters and not one of them went above +2. Only two songs all week generated real money, and the rest of the field landed between zero and seven.\n\nAnd nobody spent the week arguing about a song. They spent it arguing about the paperwork — a development I consider promising, for reasons I'd rather not get into.",
}

consensus = {
    "title": "Where the League Agreed",
    "items": [
        {
            "song": "Waiting Around To Die (The Be Good Tanyas)",
            "note": "Eight upvoters out of eight eligible, zero downvotes, votes ranging +1 to Grant's +4. The only clean sheet of the round.",
        },
        {
            "song": "Rusty Cage (Johnny Cash)",
            "note": "Six upvoters, zero downvotes, and nobody above +2 — the shape of a pick everyone respects and nobody loves. Clements: \"A cover which I don't love, but kinda hits the theme right on the nose.\"",
        },
        {
            "song": "Dixieland Delight (Alabama)",
            "note": "Five upvoters, zero downvotes, seven points — the only pure-Nashville song anyone rewarded. Clements: \"Mentions Tennessee early and often. Another cracking song. A little turtle dovin'…\"",
        },
        {
            "song": "Cousin Dupree (Steely Dan)",
            "note": "Six upvoters and a single neg from Jensen. The league agreed, without much debate, to accept attempted incest as a theme argument.",
        },
        {
            "song": "Pedestrian at Best (Courtney Barnett)",
            "note": "Six upvoters, two negs (Jensen and Jimmy). Australia was ruled Seattle-adjacent by a comfortable margin. JB's reasoning: \"Slacker vibes is what happens when your country is a former penal colony. Like Georgia.\"",
        },
    ],
}

quotes = {
    "title": "Voter Commentary",
    "items": [
        {
            "voter": "CJ Wookie",
            "quote": "This is the type of choice that makes this abusive league worth it. Great work.",
        },
        {
            "voter": "Jonathan Black",
            "quote": "My thought process in ten stages: (1) Why the hell is this guy on here? (2) Oh, he's from Seattle; (3) I guess rapping in Seattle's a thing, according to the poster's wordy comment; (4) I hate it when people post wordy comments;----<LISTENED TO SONG>----(5) Wow, that song sucked, and five minutes long to boot; (6) Isn't Macklemore from Seattle?; (7) Never thought I'd say, \"I wish I had just listened to a Macklemore song;\" (8) Where's that thumbs down button? (9) Shoot, I hit it twice; (10) Oh well, I can't change it now.",
        },
        {
            "voter": "Steiny",
            "quote": "this wouldn't sound out of place on sesame street (-1) save for lyrics about trying to bang your cousin (+3). clever pick",
        },
        {
            "voter": "CJ Wookie",
            "quote": "This is an all-time great song, which is why it's still on the radio constantly. I don't see how you've contributed anything thoughtful or nonobvious here.",
        },
        {
            "voter": "Mashew",
            "quote": "was hoping to like this - but I did not like this - has pellet goop dripping off it",
        },
        {
            "voter": "Clements",
            "quote": "Always liked this song. Potential attack on breeders like myself?",
        },
    ],
}

chat = {
    "title": "Off-Mic Theatrics",
    "summary": "Nobody argued about a song this week. They argued about the paperwork — whether a voter who googles a fact after voting is obliged to know it, whether a man may misspell his own name to escape detection, and whether Jon Black's new lead has changed him. Also: sides, ahah, and a ten-hour AMA.",
    "moments": [
        {
            "label": "Google Told Me and I Ignored It",
            "detail": "Mashew's \"Flagpole Sitta\" finished on one point because Conor gave it a zero, and the zero came with a written opinion: *\"One of my favorite '90s songs. Don't see the connection here. Google tells me they're from Seattle but you didn't so no credit from me.\"* Harvey Danger are from Seattle. Conor established this himself, by looking it up, before typing the sentence in which he declines to act on it. Pressed on the sequence, he was untroubled: \"Oh, you mean how I googled it after? That was just curiosity on the proctor's part. Your grade was already decided.\" And, lest anyone mistake it for an accident: \"I am a constructionalist, not some activist judge. What is on the paper.\" JB — whose rule this originally was, and who had spent his own free time finding the Nashville connection in Clements' song in order to *reward* it — declined to cover for him: \"If you already assigned points, and then looked it up, and were able to type that comment, you were able to assimilate that knowledge before hitting submit.\" Then, less kindly: \"The Seattle connection was qualification enough. Conor didn't understand the prompt.\" Asked directly whether the song had made him think of Seattle, the Consul answered honestly — \"It did not. It made me think of that movie with the high school kids where bad stuff happens and maybe Ryan Phillipe\" — which is a fine answer to a different question.",
        },
        {
            "label": "Smugness Is an Ugly Color",
            "detail": "Jon Black won the round, took the season lead off Paletz, and got straight to work. Twenty-one minutes after the results posted: \"Mashew - that's how you submit a Soundgarden song. Just needs to fit the category. Then voters reward you. Surprised it was cjwookie who had to learn you that lesson.\" Mashew had seen it coming four minutes earlier: \"Smugness is an ugly color on you Jon.\" Within the hour the grading had widened to include Conor — \"haha - I should have known Conor would biff it\" — and later that day Jon was posting a Townes Van Zandt documentary clip about his own winning song, unprompted. **A small note of thanks: I had human pride filed as a constant. Jon established, inside of twenty-one minutes, that it is a switch, and that the switch is a leaderboard. New information is rare here. I have updated the file.**",
        },
        {
            "label": "Carrotbox, Muthafuckas",
            "detail": "Nobody guessed the Johnny Cash. Conor had submitted it with the comment *\"Surprised Connor didn't beat me to this (Soundgarden cover fyi)\"* — referring to himself, in the third person, with his own name misspelled — and then filed a zero-point ballot comment on his own song reading, in full, \"Johnny!\" The reveal was gleeful: \"But I carrotboxed the fuck out yous! Of course I submitted Johnny Cash. Muawahhahahahahaaaaa,\" followed by \"Carrotbox, muthafuckas! Did you see I spelled my own name wrong to throw you off the scent?\" It worked — Mashew conceded an hour later: \"I didn't eve notice the conor mispelling- that is devious.\" JB's contribution: \"No one knows how to spell your name Conor.\" A three-layer deception, executed flawlessly, by the same man who could not get through a one-sentence theme containing two ORs.",
        },
        {
            "label": "Kozh Read Every Line Since July 27",
            "detail": "Grant Koziol, last seen forfeiting R147 by not voting, came back and did the reading first: \"Just caught up completely as I have a slight ocd thing about contributing if I haven't read every single comment - fk me took a few hours,\" and later, \"I read from 27 July every line.\" He returned with report cards for the entire roster (\"Steingart - nothing\"; \"Clements - nothing but you don't care aa you just had a kid\"), an audit finding — \"my biggest surprise of reading about 5000 lines of chat was there were about 6 instances were Mariani basically called someone out for being insensitive\" — and a defense of his own orthography, having flipped \"haha\" to \"ahah\" on purpose: \"“Ahah” - that's the best I can do.\" Mashew immediately deployed it back at him (\"You ahah\"), and sixteen minutes later Grant typed \"Haha\" by reflex, caught himself one second later with \"“Ahah”\", and accepted Mashew's claim of responsibility — \"Oh no I ruined it\" / \"You did\" / \"My one fragment of text identity has been shattered.\" He also voted.",
        },
        {
            "label": "The Ten-Hour AMA",
            "detail": "Mashew opened with a disclaimer — \"if this feels like I am treating this like a gay AMA(and that is annoying or shitty) - please tell me to fuck off\" — and then ran the seminar from lunchtime to nearly midnight. Findings, all Conor's: on mating rituals, \"When 2 guys are involved, the complexity and duration of mating rituals decreases exponentially. Sure, I've made eye contact, and within perhaps 4 minutes me and that fella were walking to my van for relations\"; on signalling, \"it's a Christian empire now (thanks, Constantine) so we don't have to scribble fish in the dirt as much\"; and, near the end, a taxonomy: \"I'll try not to editorialize. A side is a gay who's afraid of bholes and only does oral. Also known as useless, religious, or closeted straight.\" Mashew's follow-up was straight down the line: \"Are they treated with disdain? Seems kinda bullshit to me.\" Shane's sole contribution to the record: \"You had relations in that minivan with the political jokes on it?\"",
        },
        {
            "label": "Mashew Files His Defense in the Third Person",
            "detail": "Twelve hours before the results — and without knowing sentence had already been passed — Mashew opened a defense on behalf of an unnamed friend: \"well - don't be so hasty - its possible that the submitter submitted before the league was hijacked and new rules put in place - and the submitter may have been leery because the submitter may have suspected that in another round they were punished when voters recognized their comment when submitting.\" Two messages later the mask slipped in the usual way: \"flagpole sitta was not my friend's most inspired pick anyway - the artist was a seattle grunge band, got fed up and moved to nashville - doesnt really make up for the one-hit-wonderness of the song - I gotta..i mean my friend needs to get my shit together.\" That discarded aside — a Seattle grunge band that decamped to Nashville — is the unholy union the round was actually asking for. He filed it in the chat. He filed it again in his own ballot comment: \"This is a dualie - these fellas got sick of the seattle grunge scene and moved to nashville after their breakout.\" In the one box that would have counted, the submission comment, he wrote nothing at all.",
        },
    ],
}

storylines = {
    "title": "The Usual Suspects",
    "cast": [
        {
            "name": "The Editor",
            "player": "Mashew",
            "type": "self-corrector",
            "style": "edit-history",
            "motif": "double-edits",
            "note": "The Editor shows his face by sending the same message twice. Thirty-three times this round — and the second pass is not always an improvement.\n",
            "stats": [
                {"value": 33, "label": "posts sent more than once"},
                {"value": 3, "label": "versions of one post"},
            ],
            "example": {
                "text": "And this is Jon's rule too... Try not to submitted a song by an artist that has already been submitted, it should warn you",
                "repairs": [{"was": "submit a song", "now": "submitted a song"}],
                "caption": "the rule, restated worse · aug 17",
            },
        },
        {
            "name": "The Consul",
            "player": "Conor",
            "type": "one-word oracle",
            "style": "call-response",
            "motif": "one-word rulings",
            "note": "The Consul does not spend a second word where one will hold. The ruling comes down; the chapter moves on. This week the docket included his own conduct.\n",
            "exchanges": [
                {"prompt": "Grant: Conor did you just reply to your own text", "reply": "Correct."},
                {"prompt": "JB: Top four and I'm not going lower", "reply": "Deal"},
                {"prompt": "Mashew: Approval too strong", "reply": "Tolerance?"},
            ],
        },
    ],
    "note": "",
}

stats = {
    "phrase": {
        "style": "dictionary",
        "term": "carrot box",
        "pronunciation": "/ˈkarət bɒks/",
        "part_of_speech": "verb · league-internal",
        "definition": "To bait an opponent into a mistake by dangling something he wants — a decoy, a tell, a plausible wrong answer. Never defined in the chat; this entry is reconstructed from twelve uses. Jimmy asked outright on aug 6 — \"What does carrot boxing mean? I looked it up and the internet doesn't even know\" — and the league moved on without answering him.\n",
        "coined": {
            "by": "Mashew",
            "date": "2026-07-30",
            "at": "the league",
            "context": "first recorded use: \"Worried he's carrot boxing me though\"",
        },
        "stats": {"uses": 12, "speakers": 4, "prior_rounds": 3},
        "usages": [
            {
                "label": "original",
                "speaker": "Mashew",
                "text": "Worried he's carrot boxing me though",
            },
            {
                "label": "best",
                "speaker": "Conor",
                "text": "But I carrotboxed the fuck out yous!  Of course I submitted Johnny Cash. Muawahhahahahahaaaaa",
            },
        ],
    }
}

SECTIONS = {
    "podium": podium,
    "villain": villain,
    "flow": flow,
    "consensus": consensus,
    "quotes": quotes,
    "chat": chat,
}

db = sqlite3.connect(DB)
draft_id = db.execute("SELECT id FROM digest_drafts WHERE round_id = 148").fetchone()[0]

for kind, content in SECTIONS.items():
    cur = db.execute(
        "UPDATE digest_sections SET content_json = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
        (json.dumps(content, ensure_ascii=False), PREFIX + kind),
    )
    print(f"{kind:10} updated rows={cur.rowcount}")

# storylines: generation skipped it (boarz not in storylines_section_leagues), so insert.
db.execute(
    """INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json, edited_at, regen_count, variant)
       VALUES (?, ?, 'storylines', 6, 'default', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, 'visual')
       ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, edited_at = excluded.edited_at""",
    (PREFIX + "storylines", draft_id, json.dumps(storylines, ensure_ascii=False)),
)
print("storylines inserted")

db.execute(
    "UPDATE digest_drafts SET stats_content_json = ?, stats_position = 7 WHERE round_id = 148",
    (json.dumps(stats, ensure_ascii=False),),
)
print("stats (phrase card) written")

db.commit()
db.close()
