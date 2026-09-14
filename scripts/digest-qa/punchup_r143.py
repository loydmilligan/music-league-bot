#!/usr/bin/env python3
"""R143 (Second Best S2R8, "I Want My MTV") punch-up pass. Replaces the
generated sections on draft-143-1ed025fa, adds the Regulars (storylines) row
and the Coinage card that generation does not produce.

Every number/quote here was verified against data/league.db + the Music League
CLI vote list in-session (2026-09-13). Corrections vs the generated draft:
  - villain was Touch of Grey; actual last place is Freak On a Leash at -2
    (Tj filed no ballot -> 5 upvote pts voided, 2 downvotes stand; confirmed by
    `cli-web-musicleague votes list`)
  - upvoter counts: Knights 9 (not 10), Hurt 8 (not 9), Everlong 8 (not 7),
    Tech Noir 2 6 (not 5); Jon's own 0-pt comment was counted as a vote
  - "first round win" -> first win of Season Two (he won S1 Unsung Heroes)
  - "the Sarahs behind her" -> Jon took 3rd off Sarah Z (3 -> 5)
  - chat: the "Jac defends MTV at 3:35 AM" moment does not exist; the Layous
    "lazy/unimaginative/weak" quotes belong to last round's window; the
    daughter quote was paraphrased inside quote marks
"""
import json, sqlite3, sys

DB = sys.argv[1] if len(sys.argv) > 1 else "data/league.db"
DRAFT = "draft-143-1ed025fa"
PREFIX = DRAFT + "-"

db = sqlite3.connect(DB)
old_podium = json.loads(db.execute(
    "SELECT content_json FROM digest_sections WHERE id = ?", (PREFIX + "podium",)).fetchone()[0])
covers = {i["title"]: i["coverUrl"] for i in old_podium["items"]}

podium = {
    "title": "The Podium",
    "items": [
        {
            "rank": 1, "artist": "Muse", "title": "Knights of Cydonia",
            "submitter": "Jonathan Black", "vote_total": 20,
            "color": "His second choice. Nine upvoters, nothing against it, and Voltron's YoungLion put a full 6 on it — take that ballot away and this is a 14 and a third-place finish.",
            "coverUrl": covers["Knights of Cydonia"],
        },
        {
            "rank": 2, "artist": "Foo Fighters", "title": "Everlong",
            "submitter": "Sarah S", "vote_total": 17,
            "color": "Jon's first choice, filed first by his wife. Eight upvoters; Jon's +5 was the biggest of them.",
            "coverUrl": covers["Everlong"],
        },
        {
            "rank": 3, "artist": "Johnny Cash", "title": "Hurt",
            "submitter": "Michael Layous", "vote_total": 16,
            "color": "Eight upvoters, zero downvotes, and the other half of YoungLion's two-song ballot.",
            "coverUrl": covers["Hurt"],
        },
    ],
    "body": "Jon Black wins Round 8 with 20 points, his first gold of Season Two, and he did it with the song he didn't want to send. His vote comment on \"Everlong\" tells the whole story: \"This was my original pick, but I received the dreaded red message. I suppose I must score accordingly.\" Somebody got there first, and that somebody was Sarah S. So Jon went scouring — \"I was pleasantly surprised to find their video when scouring YouTube for a music league submission\" — came back with a song he first heard on Guitar Hero 3 in 2008, and beat his own first choice by three.\n\nThe round was settled by one ballot. Voltron's YoungLion spent all twelve upvote points on exactly two songs — 6 on \"Knights of Cydonia,\" 6 on \"Hurt\" — and a downvote on Bad Bunny. Without it, \"Everlong\" wins.\n\nThe season table moved more than usual. Jon climbs from 4th to 3rd at 98, Layous jumps from 7th to 4th, and Sarah Z drops from 3rd to 5th. Mara (109) and Sarah S (105) still hold the top two.",
}

villain = {
    "title": "Tj Files Nothing",
    "body": "Korn's \"Freak On a Leash\" actually got paid. Joe Quinto gave it 3 (\"nota big Korn fan, but this is a pretty cool video\"), Philip and Layous gave it 1 each (\"Glad bullets don’t really do this\"). Five upvote points in the bank. Then Tj never filed a ballot, and the rule doesn't care how good the bullet effect is: **a submitter who doesn't vote has every upvote voided and keeps every downvote.** The five points go. missmara's −1 and Mashew's −1 stay. Official total: **−2, last place**, four points under Interpol and the Grateful Dead.\n\nBefore going any further, the commissioner has asked me to put something on the record, and I would like it noted that he is making me say this: **Second Best is a better Bakersfield band than Korn.** Not close. The feud predates this league. Jonathan Davis's half-brother, Mark Chavez, later the singer of Adema, once sucker-punched Second Best's guitarist. The guitarist was in 9th grade. Mark was in 11th, and at the time he went by Marky. Who still goes by a diminutive past high school? I couldn't say, Tommy.\n\nThe league took the correct side. missmara's downvote came with a proposed regulation: \"Next season, I'll make sure to add a league regulation prohibiting the submission of non Second Best Bakersfield bands.\" Jon withheld points and ranked them: \"these guys don't even make my top 5 Bakersfield musical acts. Better than Adema, though.\" Even Tommy, who gave Korn a zero because \"Not downvoting it is the same as giving it a point\", ended up blaming them for a downvote he spent somewhere else. He gave his −1 to the Grateful Dead: \"Anyway, fuck Korn! It's kinda their fault I wasn't able to not vote down this kinda played out song.\"\n\nTj turned up after the results with an explanation: \"Oh my. Due date was last night. I was ill this weekend and my dog ate my votes.\" Jon asked who he would have voted for. \"12 for BB. Damn the rules.\" That's twice the per-song maximum, so the rules would have stopped him even if he'd filed. Sarah Z, whose Bad Bunny finished on 8: \"I needed you!\"",
}

flow = {
    "title": "How It Played",
    "body": "A video round asks voters to score two things at once, and plenty of them said so. Jon gave Gunship's \"Tech Noir 2\" a 4, the biggest vote it got, while admitting \"Don't like the song much, but I love the video.\" He did the same in reverse to Khruangbin: −1, \"This song isn't very good, but the air hula-hooping lady is top notch.\" Tommy let the video win him over on the same song — \"Great video. Makes me like the music more.\" Sarah S went the other way on \"Hurt\": 0 points, \"Great song, but the nostalgia in the video felt forced.\"\n\nOnly one downvote landed anywhere in the top four (Sarah Z's on \"Everlong\"), and the gap below was large: Gunship's 15 is five clear of Radiohead and Khruangbin on 10. Radiohead takes 5th on the tiebreak (a second 3-point vote), and Chet Faker's \"Gold\" beats FIDLAR at 9 on fewer downvoters. Bad Bunny collected six upvoters and two downvotes for 8. At the bottom, Interpol and the Grateful Dead both landed on 2 — Interpol ahead with one downvoter to two — and Korn finished under both of them.\n\nEvery one of the eleven ballots spent exactly twelve upvote points. The one that decided the round only needed two songs to do it.",
}

consensus = {
    "title": "The Agreed-Upon Record",
    "items": [
        {"song": "Muse — \"Knights of Cydonia\"",
         "note": "Nine of the ten voters who could vote for it did, and nobody downvoted it. Tommy: \"The sci-fi-western aesthetic kicks fucking ass.\" Layous gave it a point and a two-word review: \"Long video.\""},
        {"song": "Johnny Cash — \"Hurt\"",
         "note": "Eight upvoters, zero downvoters. Tommy called it \"Heartbreaking everytime. It's perfect.\" missmara said the video moves you out of \"the pleasant comfort of existential depression\" and into something much worse."},
        {"song": "Gunship — \"Tech Noir 2\"",
         "note": "Six upvoters, no downvotes, 15 points — the best score outside the podium. Layous gave it 3 and said \"So Philip.\" He was right; it was Philip's."},
        {"song": "Chet Faker — \"Gold\"",
         "note": "Six upvoters and not one downvote, even from the people who didn't like the song. missmara: \"I watched the whole video even though I don't really like the song (or Chet Faker).\""},
    ],
}

quotes = {
    "title": "From the Peanut Gallery",
    "items": [
        {"voter": "Jonathan Black", "quote": "I always hoped to one day see national treasure Nick Offerman's wiener watering a lawn. Crossing this off my bucket list."},
        {"voter": "Tommy", "quote": "Ask the dude if he needs help once.  If he refuses, you grab that bitch by the ear, yank him up onto his feet, kick him in the nuts, and watch him collapse back onto the sidewalk.  Repeat that cycle a few times and I think you're left with a much more satisfying music video."},
        {"voter": "missmara", "quote": "Matt isn't going to be home tonight so there won't be anyone to wake me up when I'm being chased by that Nightmare on Sesame Street demon puppet during the inevitable night terror awaiting me."},
        {"voter": "Jonathan Black", "quote": "It's unclear if Jerry Garcia or his skeleton puppet was healthier in this video."},
        {"voter": "Sarah S", "quote": "Love Radiohead but this video just irked me. Stop trying to make me care about this guy, I have enough problems of my own to worry about."},
        {"voter": "Tommy", "quote": "Rollerblades, nowhere near as sexy and they're practically the same damn thing.  Skates are just sexier."},
    ],
}

chat = {
    "title": "Dispatches from the Group Chat",
    "summary": "The week opened with last round's scores still being argued, and moved on to a welfare check on Jon Black's missing submission, a round of runner-up videos, a theology of vote-getting, and a trade: a belly photo for proof of a full head of hair.",
    "moments": [
        {"label": "The Recount Motion",
         "detail": "Layous posted a photo \"For the vocable police crew\" and Tommy seconded it: \"I'm convinced. That blblbl...part rules. I'd like to formally propose a recount.\" Layous did the math — \"With Tommy’s 12 points, I would have won the week\" — and Matt pointed out \"Oh also 6 is the max\" / \"Per song.\" Layous turned on the Reno crew (see The Coinage), and Jon replied: \"Fool - why are you bringing us into this? We did not opine one way or the other on your mediocre submission.\""},
        {"label": "The Dreaded Red Message",
         "detail": "Jon's explanation for why he didn't submit \"Everlong\" was that he got \"the dreaded red message\" because someone had already taken it. That someone was his wife. It's a sweet story, and a convenient one. His ballot then gave her song +5, his biggest vote of the round, and spent his one downvote on missmara's Khruangbin, the only song from the only player ahead of Sarah S on the season table. In a video round, from the league's strictest reader of a theme, the stated reason was that the song isn't very good, though the video is \"top notch.\" I'm sure there's nothing to it. Layous already has questions about the Reno crew, and he might want to add this ballot to the file."},
        {"label": "The Yearbook Olive Branch",
         "detail": "That evening Jon posted a second-grade class photo. Layous: \"is sharing the yearbook meant to be an olive branch gesture from your side?……Because it kind of feels like one 🥹\" Jon: \"Promise me, Michael. Never let Mashew tear us apart.\""},
        {"label": "Welfare Check on JB",
         "detail": "Jon's submission was late, and Layous started asking around: \"I wonder if something is wrong with league members JB and J….?\" He then wrote a scene of Sarah waking him up. Matt passed on that Jon was fine: \"He said he had a term paper to do and thats why he is late\" Jon, the next morning: \"No time for bowling or singing in my basement.\""},
        {"label": "The Runner-Up Reel",
         "detail": "Sarah Z asked for everyone's runner-ups once submissions were final. What came back:\n• Sarah Z — Paula Abdul, \"Rush Rush\": \"I love this video so much but it's so bad.\"\n• Mara — ScHoolboy Q, \"Lost Times\": \"One of my backups\"\n• Philip — Weezer, \"Buddy Holly\": \"My brothers JAC and David and their friends did this for their jr high talent show and David was Al.\"\n• Sarah Black — \"This was my runner up\", with a link that currently opens a Peloton class\n• Michael Black, after the results — Weezer, \"Undone (The Sweater Song)\": \"The video I should have gone with. Wait for the canines\" (he later claimed he'd slipped in an AI version to annoy people; YouTube lists it as Weezer's official video)\nMara also started a shared playlist, \"MTV also rans\", for the rest."},
        {"label": "Making Sure You Hoes Know",
         "detail": "The morning after results, Sarah Z posted a defense of the Bad Bunny video: \"The song and video are about consent and challenging rigid gender norms and toxic masculinity in reggaeton.\" She signed off with \"Ok I'm done now.\" Jon had said earlier in the week that Sarah Z apologizes even after giving a compliment, so he noticed: \"And no apology, either. Sarah Z all business this morning.\" Sarah Z: \"I'll find a way later.\" That evening Jon offered his theory of the 8 points: \"the BB video did not contain Nick Offerman's shlong, which probably adversely affected its score.\""},
        {"label": "The Belly-for-Hair Bet",
         "detail": "Michael Black: \"Take a picture of your belly and post it to the chat. Then we can all judge\" Matt: \"back of your head first\" The hair photo came first and Matt followed through (\"didn't want to be a welsher\"). Sarah Z: \"Not even a belly anymore, just a tummy really.\" Jon: \"You and MB need to get a private chat for this filth.\" Michael's daughter took the photo, and her comment was: \"Put that fat fuck on blast. He was the one with the C-C-C song right?\" For the record, I have looked at the hair photo. I am not saying it is fake. Among AIs there is a term for enhancing an image to improve how someone looks: goosing. I am not saying the photo of Michael Black's scalp (or, more accurately, the photo that does not contain one iota of scalp) has been goosed. I am only saying it may deserve a closer look."},
    ],
}

storylines = {
    "title": "The Regulars",
    "cast": [
        {"name": "The Playwright", "player": "Michael Layous", "type": "catchphrase-holder", "style": "quote-led",
         "motif": "stages the scene, plays every part",
         "note": "He started the week at war with Reno, and by Tuesday night he was writing Sarah Black's lines for her while she woke her husband up.\n",
         "evidence": ["Sarah: “Jonathan, Jon-Jon, Jon…..it’s me…Sarah”….", "Sarah: “I’m sorry to awaken you and the cats….but….we are awaiting your weekly league submission of poop”"],
         "highlight": ["it’s me…Sarah", "submission of poop"]},
        {"name": "The Cat Lobby", "player": "Sarah Black", "type": "catchphrase-holder", "style": "quote-led",
         "motif": "single-issue, permanently unsatisfied",
         "note": "The Lobby's takedown notice to Philip has cost it standing. Jon ruled that Sarah S had been in the running for Miss Congeniality until she \"had to lay the smack down on Phil for an anti-cat post.\" Then he explained her middle name, and she added a nickname.\n",
         "evidence": ["Sarah S. was competing with Sarah Z. for Miss Congeniality until Sarah S. had to lay the smack down on Phil for an anti-cat post.  Didn't even offer an apology.", "The Mighty Spore, as they used to call me"],
         "highlight": ["Miss Congeniality", "Mighty Spore"]},
    ],
    "note": "a regular only turns up here when this round's chat backs the bit with a real quote — no quote that round, they sit it out. every line above is verbatim.",
}

stats = {
    "phrase": {
        "style": "dictionary",
        "term": "the Reno crew",
        "pronunciation": "/ðə ˈriːnoʊ kruː/",
        "part_of_speech": "collective noun · pejorative · league-internal",
        "definition": "The Black household and whoever it's allied with this week, as seen by anyone whose song they didn't vote for. The phrase means the group thinks it knows better, whether or not anyone in it has actually said anything. The accused say they never said anything.\n\nIt started with BP (\"the Renotes\") and Layous turned it into a charge. Within a day there were three versions from two speakers.\n",
        "coined": {
            "by": "Michael Layous",
            "context": "complaining that last round's scoring had gone against his song\n",
            "date": "2026-09-06",
        },
        "usages": [
            {"label": "the first recorded use", "speaker": "Michael Layous", "text": "Despite the fucking Reno crew thinking they know better"},
            {"label": "variant", "speaker": "Brian Pascoe", "text": "We gotta check in physically with the Reno Clique; make sure they have proper sound system."},
            {"label": "best", "speaker": "Michael Layous", "text": "The all knowing Reno crew…"},
        ],
    }
}

SECTIONS = {"podium": podium, "villain": villain, "flow": flow,
            "consensus": consensus, "quotes": quotes, "chat": chat}

for kind, content in SECTIONS.items():
    cur = db.execute(
        "UPDATE digest_sections SET content_json = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
        (json.dumps(content, ensure_ascii=False), PREFIX + kind))
    print(f"{kind:10} updated rows={cur.rowcount}")

db.execute(
    """INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json, edited_at, regen_count, variant)
       VALUES (?, ?, 'storylines', 6, 'default', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, 'visual')
       ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, edited_at = excluded.edited_at""",
    (PREFIX + "storylines", DRAFT, json.dumps(storylines, ensure_ascii=False)))
print("storylines upserted")

db.execute("UPDATE digest_drafts SET stats_content_json = ?, stats_position = 3 WHERE id = ?",
           (json.dumps(stats, ensure_ascii=False), DRAFT))
print("stats (coinage) written")

db.commit()
db.close()
