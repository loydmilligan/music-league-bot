"""R179 (Second Best S3 R1) — punched-up copy for the Digest 2.0 "How It Played"
cards + Ballot Grid. Writes the 1.0 draft's flow + consensus rows, which the 2.0
ballot sections read. Original rows: r179_flow_consensus.pre-ballot.json.

No-repeat rules vs the rest of the 2.0 page: nothing about the constitution, the
honor-system audit, Layous praising his own song, Phil's neighbor, UCLA, Latvia,
Jon's Tell, the cat lobby, the Villain's Sphere story, or the fine print. Card
notes don't quote vote comments (those render as bubbles right under the note);
they lean on the submitters' own pitch notes, which appear nowhere else.

Usage: python3 scripts/digest-qa/punchup_r179_ballot.py data/league.db
"""
import json, sqlite3, sys

DRAFT = "draft-179-0d32e8ca"

FLOW = {
    "title": "How It Played",
    "body": (
        "The theme asked everyone to bring a memory, so the round played out like a support "
        "group with a Spotify login. Pizza basements. A synagogue full of spinning speakers. "
        "A Bakersfield club that may or may not have been called Oz. A Rose Bowl tailgate. "
        "Below, every song gets its receipt: who paid for it, who knifed it, and what they "
        "muttered on the way out."
    ),
    "note": (
        "New this season: the zero-point comment, where you review a song with real tenderness "
        "and then pay it nothing. Look for the dashed boxes above. Five of them came from one "
        "man, and I think you know which man."
    ),
    "grid": (
        "Every ballot, laid bare. Read across for a person, down for a song. A dot means they "
        "left a comment, stripes are their own song, and a red ≠ means the ballot wasn't 3·2·1 "
        "plus two knives. You've already heard who. Here's the paperwork."
    ),
}

NOTES = [
    ("Rock n Roll",
     "Mara's pitch had everything: a Rose Bowl upset, a tailgate, the Wiltern, a best friend "
     "named Sarah Z, and a confession that she wanted to be the lead singer. Six people paid. "
     "Nobody pulled a knife, which in this league is basically a ticker-tape parade."),
    ("My Right",
     "BP's pitch involved the Jerrys Pizza basement, a Fat Chance cover, a cigarette, and the "
     "claim that only punk rock has ever truly moved him. The league agreed politely: everyone "
     "chipped in, nobody gave it a 3. Punk rock, rated like a nice casserole."),
    ("Why",
     "Spinning gramophone speakers in a San Francisco synagogue, December 2013. Jon reports he "
     "has also seen Andrew Bird in a synagogue in SF, so either they were at the same show or "
     "Andrew Bird only plays synagogues. Both are good outcomes."),
    ("Guided By Angels",
     "Tommy arrived with two KEXP sessions of homework and a sociological theory about "
     "Australia. The room split cleanly: Mara spent her 3 here, and two people spent their "
     "knives. Amy Taylor would want it that way."),
    ("The Sunshine Underground",
     "Michael's pitch, in full: danced his ass off, waited for this song, made his whole group "
     "stay for the encore, danced more of his ass off. The most honest live-music review of the "
     "round, and it isn't close."),
    ("What Are We Waiting For",
     "Front-row seats, a surprise wife, a four-year-old in something sparkly, and a closing "
     "anthropological note on what ladies do when they get together. Sarah B paid full price "
     "anyway. Marriage is a contract."),
    ("Four Walls",
     "Matt's pitch: an over-18 night at a Bakersfield club he's fairly sure was called Oz, which "
     "he remembers as both 'a sad place' and better than the Troubadour. Both of those can be "
     "true. That's Bakersfield."),
    ("Streets of Bakersfield",
     "Jac saw Dwight and Buck at the Crystal Palace more than a few times and admits it got "
     "'cringy' as Buck got older. Three voters went with the cringy part."),
    ("Revival",
     "Sarah Z promised a live closer where the band fake-faints and the whole room sings its "
     "demons out. Three voters kept their demons to themselves."),
    ("She's Gone",
     "Layous's entire pitch was 'Uh oh. Did I leave my comment box checked by mistake.' The "
     "league read it as a request and filled the order."),
]


def main(db_path: str) -> None:
    db = sqlite3.connect(db_path)
    consensus = {
        "title": "The Room Agreed",
        "items": [{"song": f'"{title}"', "note": note} for title, note in NOTES],
    }
    with db:
        for kind, content in (("flow", FLOW), ("consensus", consensus)):
            n = db.execute(
                "UPDATE digest_sections SET content_json = ? WHERE draft_id = ? AND kind = ?",
                (json.dumps(content, ensure_ascii=False), DRAFT, kind),
            ).rowcount
            print(kind, "rows updated:", n)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/league.db")
