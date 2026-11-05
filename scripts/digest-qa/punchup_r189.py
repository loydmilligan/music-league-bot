"""R189 (Hip Jammers S4 R1, "*I Want My MTV", theme by Matt Mariani) punch-up.

Rewrites the auto draft's podium/villain/flow/consensus/chat, adds the Regulars (storylines)
section and the Coinage (stats_content_json.phrase), and excludes the auto 'quotes' section.

Fixes in the auto draft:
- Drew (JellyDru) is she/her; the draft called her "he" twice and said she "talked his way
  into the league mid-chat" (she had already submitted; Matt apologised for the shade). She
  did not file a ballot.
- "Greg, the two-time champion": wrong. Lori won Season 2 (233) and Season 3 (129); Greg was
  5th in S2 and 3rd in S3. Matt won Season 1.
- "36 of 42 available points": nine ballots x 6 points = 54.
- Party Rock Anthem: five voters (not six), and Lori paid 1, not 3.
- Sledgehammer: six voters (Ron's 1 was missing).
- Villain: "40 points-to-2" and the Season 3 "Bow Down" floor claim are unverified; dropped.

Rules check (new 3-2-1 voting, "not enforced by the app"): all nine ballots are exactly 3/2/1.
All ten submissions carried a video link (Ron's is a google.com redirect).

Handles: Mashew = Matt Mariani, mmariani13 = Michael Mariani (Mike), missmara = Mara Mariani,
margs = Margaret Mariani, Ronm = Ron Mariani, lorimariani = Lori Mariani, gregamariani = Greg
Mariani, Kristin = Kristin Visser, Sasha Mariana = Sasha Mariani, jellydru = Drew Mariani.

Podium coverUrls and the _cover* keys are carried over from the current draft (Cover Factory
auto-run + Matt's manual Party Rock keeper), never re-typed.

Usage: python3 scripts/digest-qa/punchup_r189.py data/league.db [--options-md PATH] [--dry-run]
"""
import json, os, re, sqlite3, sys, uuid

DRAFT = "draft-189-50da7619"
ROUND = 189
G = "Hip jammers"
WINDOW = ("2026-10-26T00:00", "2026-11-06T00:00")


def norm(s):
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("⁨", "").replace("⁩", "").replace(" ", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


PODIUM = {
    "title": "Final Standings: Round 1",
    "body": (
        "Season 4 opened on the new voting system: rank your top three, pay 3, 2 and 1. Matt's "
        "announcement admitted the app can't enforce it and that \"we are kind of counting on everyone "
        "to just follow the rules.\" Everyone did. All nine ballots came in exactly 3-2-1, which makes "
        "54 points on the table. The top three took 36 of them. The tenth ballot was never filed."
    ),
    "items": [
        {"rank": 1, "artist": "LMFAO", "title": "Party Rock Anthem", "submitter": "gregamariani", "vote_total": 13,
         "color": "Greg joined the league on the last day, after repeated invitations and a promise to be hounded "
                  "\"to the fullest extent of the law,\" then won the round. Kristin, Margaret, Ron and Sasha "
                  "each paid him their full 3, Lori added 1. Thirteen points from five voters for the Season 4 "
                  "opener, and nobody has to hound him for the next one."},
        {"rank": 2, "artist": "Peter Gabriel", "title": "Sledgehammer", "submitter": "Kristin", "vote_total": 12,
         "color": "The most-voted song of the round: six of nine ballots paid it. Mike called it his \"Favorite "
                  "song of the bunch\" and then gave his 3 to Thriller. Kristin, it turns out, had a more "
                  "adventurous answer in her pocket and decided not to use it (see the Regulars)."},
        {"rank": 3, "artist": "Michael Jackson", "title": "Thriller", "submitter": "margs", "vote_total": 11,
         "color": "Eleven points from four voters, three of them paying the full 3. Mike's 3 came with the "
                  "review \"Best video for sure. Maybe my 4th or 5th favorite song tho,\" which is the whole "
                  "round in one sentence: the video won, the song came along for the ride."},
    ],
}

VILLAIN = {
    "title": "The Cellar: Taste the Biscuit",
    "body": (
        "Two points for Matt's \"Taste the Biscuit,\" and both came from Mara, who explained them: \"This one "
        "gets stuck in my head and compels me to sing it at inopportune times.\" Mike passed with a note, "
        "\"This one almost got points for being insane.\" Matt filed his own defence in a vote comment: "
        "\"tell me for reals, if you gave it a real listen, did it not get deep into your dome slice?\" "
        "Eight of nine ballots gave the answer. This is the same commissioner who spent the week asking "
        "everyone to \"go for some new ones this season,\" and to his credit, he went. It's just that "
        "nobody followed him. Sasha's \"Bring Me To Life\" was the only song to finish lower: zero points, "
        "with Mike's \"Such a good song and video\" on the record and no points behind it."
    ),
}

FLOW = {
    "title": "How It Played: The Safest Round in Music Video History",
    "body": (
        "Matt's theme asked for a song with a killer music video. The family answered with the three most "
        "famous ones it could think of. Party Rock Anthem (13), Sledgehammer (12) and Thriller (11) took 36 "
        "of the 54 points, and the remaining seven songs split 18. Two of those seven scored one point or "
        "fewer. Nobody was surprised, because nobody tried to be surprising. Kristin admitted she had "
        "Skibidi in mind and \"was trying to pick a song anyone else would know besides me.\" Lori reported "
        "that \"You jerks already picked theee of my choices\" before the playlist was even out. When a "
        "two-time champion's shortlist is already on the board, the shortlist was not very long."
    ),
    "body2": (
        "Under the podium, the round paid for honesty. Drew's \"Somebody That I Used To Know\" came with "
        "\"I dunno if this is \\\"killer\\\" but I do have strong memories associated with this\" and earned "
        "4 points from three voters. Mike's \"Little Foot Big Foot\" got Mara's 3 and Matt's 1, and Matt's "
        "guess for it was \"I think Mike submitted this one - not sure why.\" Lori's \"No Rain\" also took 4, "
        "from Greg, Mike and Ron. Ron's \"Californication\" got Kristin's 1, after he posted the video to "
        "the family chat by mistake: \"Oops. Was trying to put that in music league.\" Every one of the ten "
        "submissions included a video link, as the theme required. Ron's arrived wrapped in a Google "
        "search redirect, which counts."
    ),
}

NOTES = [
    ("Party Rock Anthem, LMFAO (submitted by gregamariani)",
     "Five voters paid it. Kristin, Margaret, Ron and Sasha each gave it their full 3, and Lori gave it "
     "her 1. Mike's comment was \"Great video not my favorites song,\" and he left it off his ballot."),
    ("Sledgehammer, Peter Gabriel (submitted by Kristin)",
     "The widest support of the round: six voters. Matt paid 3; Lori, Margaret, Mike and Sasha paid 2; "
     "Ron paid 1. Mara's contribution was \"Harry Styles does a killer cover of this\" and no points."),
    ("Thriller, Michael Jackson (submitted by margs)",
     "Four voters: Greg, Lori and Mike paid 3, Kristin paid 2. Matt guessed the submitter correctly, and "
     "pictured it: \"i could see you doing the dance when nobody is around.\""),
]

CHAT = {
    "title": "Meanwhile, in the Group Chat",
    "summary": (
        "Season 4 opened with a recruitment drive, a new voting system, an Aerosmith tribute at the "
        "Hollywood Bowl, a cat that was not a stray, and Ron submitting his song to the wrong app."
    ),
    "moments": [
        {"label": "Drew Signs On (Already Signed)",
         "detail": "Drew opened the season with a question: \"Oh am I playing? I figured I should sit out since I "
                   "miss the deadlines so often :P\" Matt: \"You are in!\" Drew: \"Ok ok I'll join hehe.\" Three "
                   "days later Matt gave her a last chance to join for round 1, and Drew replied, \"Wait I think "
                   "I already submitted a song, no?\" She had. Matt: \"You are right, sorry for the shade drew!\" "
                   "Her song took 4 points. Her ballot is still out there somewhere."},
        {"label": "Gregama Tacos, Hounded",
         "detail": "Matt addressed Greg \"in your official capacity, gregama tacos\" and promised to hound him \"to "
                   "the finest extent of the law,\" then sent the message again the same minute with \"fullest\" in "
                   "place of \"finest.\" Lori, three days later: \"I think  Greg is the one missing.\" Matt: \"Greg "
                   "get it together and join and submit.\" Greg joined, submitted and won."},
        {"label": "The Wrong App",
         "detail": "Ron posted the Californication video to the family chat, then: \"Oops. Was trying to put that in "
                   "music league. Hahaha.\" Matt's vote comment later made the obvious guess: \"My guess for "
                   "submitter is Ron because he accidentally sent to our chat!\""},
        {"label": "Gums and Roses",
         "detail": "Lori, at the Aerosmith 50th anniversary show at the Hollywood Bowl: \"A lot of 80s rock bands are "
                   "here doing Aerosmith songs.\" The lineup: \"Black crowes. Sammy Hagar.  Heart gums and roses.\" "
                   "Matt: \"is gums and roses and \\\"old\\\" jab?\" Ron added \"Billy idol.\" The question was never "
                   "answered."},
        {"label": "A Small Adult",
         "detail": "Kristin's Halloween report: \"But I rudely mistook a small adult for a child last night.\" In her "
                   "defence: \"She was in a group of children that were maybe 4 inches shorter.\""},
        {"label": "Not Our Cat",
         "detail": "Matt and Mara tried to rescue an alley cat and asked the neighbors whether they'd seen \"a "
                   "'scrawny mangey' cat prowling around.\" The neighbors: \"It's ours.\" The dog food Matt and Mara "
                   "fed it made it barf everywhere. Matt's conclusion: \"Cats are not our specialty.\""},
    ],
}

SEASON_PREVIEW = (
    "Seven rounds to go. Sasha's Heroes Journey is next: the obvious pick is Five for Fighting, and the "
    "braver ones are Crash Test Dummies' \"Superman's Song\" or Donovan's \"Sunshine Superman.\" Ron's You Had "
    "To Be There (your first concert) is the one round where a safe pick is not a choice. Mike's Collin all "
    "Philistines will get \"In the Air Tonight\" at least twice; Phil Collins also played drums on Tears for "
    "Fears' \"Woman in Chains\" and sang \"Easy Lover\" with Philip Bailey. Then a place you love, Margaret's "
    "Wedding Bells, your favorite person, and finally the whoa-whoas and na-na-nas. If the first round is "
    "anything to go by, someone will submit \"Hey Jude.\""
)

STORYLINES = {
    "title": "Character Witnesses",
    "note": "Two members of the league, entered into the record.",
    "cast": [
        {"name": "The Threepeat", "player": "Lori Mariani", "type": "two-time defending champion",
         "style": "stat-led", "motif": "votes with the room, plans to win anyway",
         "note": "Lori won Season 2 with 233 points and Season 3 with 129. Nobody in this league has won three. "
                 "She opened the attempt with No Rain and 4 points, nine behind Greg, tied for fourth. Then she "
                 "filed the most agreeable ballot in the family: 3 to Thriller, 2 to Sledgehammer, 1 to Party "
                 "Rock Anthem, which is the podium in reverse order of finish but exactly the podium. A champion "
                 "who agrees with everyone is either very confident or running out of ideas, and she told us "
                 "which before the playlist dropped: \"You jerks already picked theee of my choices.\" She also "
                 "asked the rules question nobody else did: \"Isnt the whole point the music video ?\" "
                 + SEASON_PREVIEW,
         "evidence": ["You jerks already picked theee of my choices.",
                      "Isnt the whole point the music video ?",
                      "I think  Greg is the one missing"],
         "highlight": ["theee of my choices", "the whole point"],
         "stats": [{"value": "2", "label": "titles in a row (S2, S3)"},
                   {"value": "9", "label": "points behind after round 1"},
                   {"value": "3 for 3", "label": "ballot picks that made the podium"}]},
        {"name": "The Crowd Pleaser", "player": "Kristin Visser", "type": "runner-up · confessed",
         "style": "quote-led", "motif": "had the weird one, played the classic",
         "note": "Kristin finished second with Sledgehammer, the most-voted song of the round, and then told the "
                 "chat how she got there. Her real favorite music video is Skibidi. She didn't submit it: \"I was "
                 "trying to pick a song anyone else would know besides me.\" Then, after a pause, \"And I guess "
                 "Mike.\" Six ballots rewarded the decision. It is the clearest statement of the round's strategy "
                 "anyone made out loud, and it worked, which is the problem.",
         "evidence": ["Skibidi is definitely my favorite music video but I was trying to pick a song anyone else would know besides me",
                      "And I guess Mike"],
         "highlight": ["anyone else would know", "And I guess Mike"],
         "stats": [{"value": "12", "label": "points, second place"},
                   {"value": "6", "label": "voters, most of the round"},
                   {"value": "1", "label": "Skibidi left on the bench"}]},
    ],
}

COINAGE = {
    "title": "The Coinage",
    "phrase": {
        "style": "dictionary",
        "term": "gregama tacos",
        "pronunciation": "/ɡrɛˈɡɑːmə ˈtɑːkoʊz/",
        "part_of_speech": "n. · title, official capacity",
        "definition": (
            "Greg Mariani, when addressed in his official capacity. Conferred by Matt on October 29 while "
            "recruiting Greg into Season 4, alongside a promise to hound him to the fullest extent of the law. "
            "By the end of voting the title had shrunk to a single emoji. Greg won the round."
        ),
        "coined": {"by": "Matt Mariani", "date": "2026-10-29", "at": "the family chat",
                   "context": "an invitation, sent twice, one word apart"},
        "stats": {"uses": 2, "speakers": 1, "prior_rounds": 0},
        "usages": [
            {"label": "the conferral", "speaker": "Matt Mariani",
             "text": "or as we call you in your official capacity, gregama tacos"},
            {"label": "the correction", "speaker": "Matt Mariani",
             "text": "we will be hounding you to the fullest extent of the law"},
            {"label": "the roll call", "speaker": "Lori Mariani",
             "text": "I think  Greg is the one missing"},
            {"label": "the short form", "speaker": "Matt Mariani",
             "text": "we are still waiting on @~JellyDru and @~Greg 🌮"},
        ],
        "meta": "n. · coined by Matt Mariani, Oct 29 · 1 speaker",
    },
}

OPTIONS = {
    "coinage": [
        {"id": "B", "term": "his Ronliness", "pos": "n. · honorific",
         "definition": "Ron Mariani, as his subjects know him. Conferred by Matt on November 4 while thanking him for "
                       "voting early. His Ronliness had earlier submitted his song to the family chat.",
         "coined": "Matt Mariani, Nov 4", "usages": [("Matt Mariani", "or as his subjects know him, his Ronliness, for voting earlier")],
         "swap": "Pairs well with the default Regulars; Ron isn't in either card."},
        {"id": "C", "term": "dome slice", "pos": "n. · anatomy, informal",
         "definition": "The part of the head a song has to get deep into. Matt's term, from his own vote comment "
                       "defending Taste the Biscuit. Eight of nine ballots found theirs unaffected.",
         "coined": "Matt Mariani, R189 vote comment", "usages": [("Matt Mariani", "did it not get deep into your dome slice?")],
         "swap": "Repeats the Villain section's quote; if used, cut the quote from the Villain."},
    ],
    "regulars_slot1": [
        {"id": "B", "name": "The Late Signing", "player": "Drew Mariani", "type": "submitted · did not vote",
         "note": "Drew asked whether she was even playing, joined, was told she hadn't submitted, had submitted, got "
                 "4 points, and did not file a ballot. Funny, but it repeats the chat moment.",
         "evidence": ["Oh am I playing? I figured I should sit out since I miss the deadlines so often :P",
                      "Wait I think I already submitted a song, no?"],
         "swap": "If used, cut the 'Drew Signs On' chat moment. Lori's threepeat should stay in one of the slots."},
    ],
    "regulars_slot2": [
        {"id": "B", "name": "The Discovery Bonus", "player": "Matt Mariani", "type": "commissioner · cellar",
         "note": "Matt asked the league to \"go for some new ones this season,\" went for one, and finished ninth "
                 "with Taste the Biscuit. Overlaps the Villain section.",
         "evidence": ["I say go for some new ones this season! I'm defintiely upping my discovery bonus."],
         "swap": "If used, trim the Villain's last two sentences."},
    ],
}


def check_facts(db):
    def pts(title):
        return db.execute("SELECT coalesce(sum(v.points),0), sum(v.points>0) FROM votes v JOIN ml_submissions s "
                          "ON s.spotify_uri=v.spotify_uri AND s.round_id=v.round_id WHERE v.round_id=? AND s.title=?",
                          (ROUND, title)).fetchone()
    assert pts("Party Rock Anthem") == (13, 5)
    assert pts("Sledgehammer") == (12, 6)
    assert pts("Thriller") == (11, 4)
    assert pts("Taste the Biscuit") == (2, 1)
    assert pts("Bring Me To Life")[0] == 0
    assert pts("Somebody That I Used To Know") == (4, 3)
    assert pts("No Rain") == (4, 3)
    assert pts("Californication") == (1, 1)
    assert db.execute("SELECT sum(points) FROM votes WHERE round_id=?", (ROUND,)).fetchone()[0] == 54
    ballots = db.execute("SELECT player_id, group_concat(points) FROM (SELECT player_id, points FROM votes "
                         "WHERE round_id=? AND points>0 ORDER BY player_id, points DESC) GROUP BY player_id",
                         (ROUND,)).fetchall()
    assert len(ballots) == 9 and all(b[1] == "3,2,1" for b in ballots), ballots
    drew = db.execute("SELECT count(*) FROM votes v JOIN players p ON p.id=v.player_id WHERE v.round_id=? AND p.name='Drew Mariani'", (ROUND,)).fetchone()[0]
    assert drew == 0
    lori = db.execute("SELECT s.title, v.points FROM votes v JOIN players p ON p.id=v.player_id JOIN ml_submissions s "
                      "ON s.spotify_uri=v.spotify_uri AND s.round_id=v.round_id WHERE v.round_id=? AND p.name='Lori Mariani' "
                      "AND v.points>0 ORDER BY v.points DESC", (ROUND,)).fetchall()
    assert lori == [("Thriller", 3), ("Sledgehammer", 2), ("Party Rock Anthem", 1)], lori
    champs = db.execute("SELECT season_id, name, current_total FROM season_standings WHERE rank=1 AND round_id IN "
                        "(SELECT max(round_id) FROM season_standings WHERE season_id IN (4,5,6) GROUP BY season_id) ORDER BY season_id").fetchall()
    assert champs == [(4, "Mashew", 156), (5, "lorimariani", 233), (6, "lorimariani", 129)], champs
    links = db.execute("SELECT count(*) FROM ml_submissions WHERE round_id=? AND comment LIKE '%http%'", (ROUND,)).fetchone()[0]
    assert links == 10, links


def build_blob(db):
    rows = db.execute("SELECT text FROM chat_messages WHERE group_name=? AND ts BETWEEN ? AND ?", (G, *WINDOW)).fetchall()
    rows += db.execute("SELECT comment FROM votes WHERE round_id=? AND comment IS NOT NULL", (ROUND,)).fetchall()
    rows += db.execute("SELECT comment FROM ml_submissions WHERE round_id=? AND comment IS NOT NULL", (ROUND,)).fetchall()
    return " \n ".join(norm(r[0]) for r in rows if r[0])


def quotes_in(obj):
    out = []
    if isinstance(obj, dict):
        for v in obj.values():
            out += quotes_in(v)
    elif isinstance(obj, list):
        for v in obj:
            out += quotes_in(v)
    elif isinstance(obj, str):
        out += [q.replace('\\"', '"') for q in re.findall(r'"((?:[^"\\]|\\")+)"', obj)]
    return out


# quotes that are song titles, theme text or paraphrase labels, not chat/comment text
NOT_QUOTES = {"party rock anthem", "taste the biscuit", "bring me to life", "somebody that i used to know",
              "little foot big foot", "no rain", "californication", "superman's song", "sunshine superman",
              "in the air tonight", "woman in chains", "easy lover", "hey jude", "killer", "old",
              "go for some new ones this season,", "to the fullest extent of the law,", "fullest", "finest",
              "in your official capacity, gregama tacos", "to the finest extent of the law,"}


def check_quotes(blob):
    missing = []
    texts = quotes_in([PODIUM, VILLAIN, FLOW, NOTES, CHAT, STORYLINES])
    texts += [e for c in STORYLINES["cast"] for e in c["evidence"]]
    texts += [u["text"] for u in COINAGE["phrase"]["usages"]]
    for t in texts:
        n = norm(t).rstrip(".,!?:;").strip()
        if n in NOT_QUOTES or norm(t) in NOT_QUOTES:
            continue
        if n and n not in blob:
            missing.append(t)
    return missing


def render_options(path):
    L = ["# R189 options: Coinage and Regulars", ""]
    L += ["## Coinage", "", f"**A (installed): {COINAGE['phrase']['term']}.** {COINAGE['phrase']['definition']}", ""]
    for o in OPTIONS["coinage"]:
        L += [f"**{o['id']}: {o['term']}** ({o['pos']}). {o['definition']}", f"- Coined: {o['coined']}"]
        L += [f"- {s}: \"{t}\"" for s, t in o["usages"]] + [f"- Swap note: {o['swap']}", ""]
    for slot, title, default in (("regulars_slot1", "Regulars, slot 1", STORYLINES["cast"][0]),
                                 ("regulars_slot2", "Regulars, slot 2", STORYLINES["cast"][1])):
        L += [f"## {title}", "", f"**A (installed): {default['name']} ({default['player']}).** {default['note']}", ""]
        for o in OPTIONS[slot]:
            L += [f"**{o['id']}: {o['name']} ({o['player']}), {o['type']}.** {o['note']}"]
            L += [f"- \"{e}\"" for e in o["evidence"]] + [f"- Swap note: {o['swap']}", ""]
    with open(path, "w") as f:
        f.write("\n".join(L))


def main(db_path, options_md=None, dry=False):
    db = sqlite3.connect(db_path)
    check_facts(db)
    missing = check_quotes(build_blob(db))
    for m in missing:
        print("NOT VERBATIM:", m)
    assert not missing, f"{len(missing)} quotes not found"
    if options_md:
        render_options(options_md)
    rows = db.execute("SELECT kind, content_json FROM digest_sections WHERE draft_id=?", (DRAFT,)).fetchall()
    current = {k: json.loads(v) for k, v in rows}
    # carry the Cover Factory podium covers + operator keys over by rank
    old = {it.get("rank"): it for it in current["podium"].get("items", [])}
    podium = json.loads(json.dumps(PODIUM))
    for it in podium["items"]:
        url = old.get(it["rank"], {}).get("coverUrl")
        if url:
            it["coverUrl"] = url
    for k in ("_coverNotes", "_coverProjects"):
        if k in current["podium"]:
            podium[k] = current["podium"][k]
    if dry:
        print("dry run: facts + quotes verified; nothing written")
        return
    stats = db.execute("SELECT stats_content_json FROM digest_drafts WHERE id=?", (DRAFT,)).fetchone()[0]
    backup_dir = os.path.join(os.path.dirname(os.path.abspath(db_path)), "digest-section-backups")
    os.makedirs(backup_dir, exist_ok=True)
    backup = os.path.join(backup_dir, "r189.pre-punchup.json")
    if not os.path.exists(backup):
        with open(backup, "w") as f:
            json.dump({"sections": current, "stats_content_json": stats}, f, indent=1, ensure_ascii=False)
    consensus = {"title": "The Room Agreed", "items": [{"song": s, "detail": n} for s, n in NOTES]}
    now = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    with db:
        for kind, content in (("podium", podium), ("villain", VILLAIN), ("flow", FLOW), ("consensus", consensus), ("chat", CHAT)):
            db.execute(f"UPDATE digest_sections SET content_json=?, edited_at={now} WHERE draft_id=? AND kind=?",
                       (json.dumps(content, ensure_ascii=False), DRAFT, kind))
        db.execute("UPDATE digest_sections SET state='excluded' WHERE draft_id=? AND kind='quotes'", (DRAFT,))
        if "storylines" in current:
            db.execute(f"UPDATE digest_sections SET content_json=?, edited_at={now} WHERE draft_id=? AND kind='storylines'",
                       (json.dumps(STORYLINES, ensure_ascii=False), DRAFT))
        else:
            pos = db.execute("SELECT coalesce(max(position),-1)+1 FROM digest_sections WHERE draft_id=?", (DRAFT,)).fetchone()[0]
            db.execute(f"INSERT INTO digest_sections (id, draft_id, kind, position, content_json, edited_at) VALUES (?,?,?,?,?,{now})",
                       (f"sec-stl-{uuid.uuid4().hex[:8]}", DRAFT, "storylines", pos, json.dumps(STORYLINES, ensure_ascii=False)))
        merged = {**json.loads(stats or "{}"), **COINAGE}
        db.execute("UPDATE digest_drafts SET stats_content_json=? WHERE id=?", (json.dumps(merged, ensure_ascii=False), DRAFT))
    print(f"verified facts + quotes; wrote 5 sections + storylines + coinage to {DRAFT}; quotes excluded; originals at {backup}")


if __name__ == "__main__":
    opts = sys.argv[sys.argv.index("--options-md") + 1] if "--options-md" in sys.argv else None
    main(sys.argv[1], opts, "--dry-run" in sys.argv)
