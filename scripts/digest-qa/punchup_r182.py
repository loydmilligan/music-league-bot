"""R182 (Second Best S3 R4, "That New New Shit", theme by Phil Chapin) punch-up.

Rewrites the auto draft's podium/villain/flow/consensus/chat, adds the Regulars
(storylines) section and the Coinage (stats_content_json.phrase), and excludes the
auto 'quotes' section. The auto draft had wrong facts: "post-2022" (the theme is
songs released SINCE January 1st, 2022, so 2022 counts), "seven of nine eligible
voters" (nine ballots touched Pink Pony Club), "Sarah" for Sarah Zucker.

Theme text: "Songs released since January 1st, 2022."  Ballot shape observed in the
data: every voter spent exactly 6 points up and 2 downvotes; no row below -1, so
nobody double-downvoted this round.

Handles: Tommy = Tommy Chapin, jac = Jac Chapin, Sarah = Sarah Zucker,
Queen0Reno = Sarah Black, monicac1217 = Michael Black (MB), missmara = Mara Mariani,
Mashew = Matt, Voltron's YoungLion = Brian Pascoe (BP), JohnPaul = JP.
BP did not submit or vote. Everyone else did.

No-repeat split (defaults): the Pink Pony vote story is in Villain, its eligibility
fight in the consensus card; Highs/Lows, lookisms, birthday, JP tech support,
Cayucos, Zuckerberg are chat-only; Mara and Tommy ballot habits are Regulars-only;
Bakersfield Social Day is Coinage-only. The alternates live in OPTIONS.

Every quote and vote fact is asserted against the DB before anything is written.

Usage: python3 scripts/digest-qa/punchup_r182.py data/league.db [--options-md PATH]
"""
import json, os, re, sqlite3, sys, uuid

DRAFT = "draft-182-50a99b5d"
ROUND = 182
G = "Music League chat for Second Best and Friends"
WINDOW = ("2026-10-27T04:00", "2026-11-04")

PODIUM = {
    "title": "Final Standings",
    "body": (
        "Tommy Chapin wins with 13 points, seven upvoters and one knife, for his first win of the "
        "season. Jon Black is second with 11 and no knives. Mara Mariani is third with 9 and no "
        "knives. That is four rounds and four different winners: Mara, Layous, Sarah Black, and now "
        "Tommy. Mara still leads the season at 28, Sarah Black is at 25, and Jon and Tommy are tied "
        "at 22. All eleven players who submitted also voted. The twelfth, Brian Pascoe, did neither."
    ),
    "items": [
        {"place": 1, "artist": "The Rat Utopia Experiment", "title": "Lobotomize Me", "submitter": "Tommy",
         "points": 13,
         "color": "Tommy's pitch opened \"This song fucking rules!\" and the room agreed in points. Phil paid "
                  "the maximum 3, five voters paid 2, Jac paid 1, and only JohnPaul brought a knife. Tommy found "
                  "the band on his YouTube feed \"a couple months ago,\" which in this league counts as research. "
                  "For the occasion we redrew the cover with him as the screamer.",
         "coverUrl": "https://digest.mattmariani.com/_media/r182/lobotomize-tommy-wipe.gif"},
        {"place": 2, "artist": "Noname", "title": "namesake", "submitter": "Jonathan Black", "points": 11,
         "color": "Jon's pitch spends one sentence on the IBTC and the Kendrick Lamar NFL deal. Five voters "
                  "paid and nobody knifed it. Sarah Black and Sarah Zucker both paid the maximum. "
                  "On the cover he has taken over the portrait, hoops and all.",
         "coverUrl": "https://digest.mattmariani.com/_media/r182/namesake-jon-wipe.gif"},
        {"place": 3, "artist": "Us", "title": "Yo-Yo Revolution", "submitter": "missmara", "points": 9,
         "color": "Mara's pitch was one line of Finnish, \"Suoraan Helsingistä toukokuussa 2026,\" which means "
                  "straight from Helsinki, May 2026. Six voters paid and nobody knifed it. Matt's 3 came with a "
                  "witness statement: \"Mara as she has been playing this a lot this week.\" "
                  "Cabaret cover, now with a yo-yo and two Maras.",
         "coverUrl": "https://digest.mattmariani.com/_media/r182/yoyo-mara-wipe.gif"},
    ],
}

VILLAIN = {
    "title": "Seven Knives and a Birthday",
    "body": (
        "Michael Black's \"Pink Pony Club\" finished at −7, the only song in the round with no upvotes at all. "
        "Seven of the nine people who voted on it spent a knife: Matt, Phil, Sarah Black, Tommy, Jac, Mara and "
        "Layous. Jon and Sarah Zucker gave it a 0, and JohnPaul skipped it. He submitted it without a pitch, "
        "so the ballots wrote the review. Layous apologized in advance: \"Don't mind the song. Just very well "
        "known and had to downvote somewhere. I am sorry.\" Tommy's whole verdict was \"2020.\" Jon announced "
        "in the chat that Sunday, November 1 was Michael's birthday. Phil's knife was filed at 8:00 that morning."
    ),
}

FLOW = {
    "title": "How It Played",
    "body": (
        "Phil's theme was songs released since January 1st, 2022. The league mostly honored it, then spent "
        "a Friday afternoon litigating one 2020 single. The round itself went to the people who showed up with "
        "evidence: Tommy found a band on his YouTube feed, Jon found a Noname track with a built-in alibi, and "
        "Mara found a Finnish band and wrote the pitch in Finnish. Every ballot spent exactly six points up and "
        "two knives, and nobody double-downvoted. The one player who told the chat he supports double "
        "downvotes, Brian Pascoe, cast no ballot at all."
    ),
    "note": (
        "Matt guessed the submitter of all ten songs he voted on and got six: Jac, Phil, Tommy, Jon, Mara and "
        "Sarah Zucker. His four misses form a circle. He gave JohnPaul's song to Michael Black, Michael Black's "
        "song to Sarah Black, Sarah Black's song to Layous, and Layous's song to JohnPaul. Everyone was "
        "wrongly credited with exactly one other person's work."
    ),
    "grid": (
        "Eleven ballots, ten songs apiece. Read across for a voter, down for a song. Nine ballots were a clean "
        "3-2-1. Layous paid six songs 1 point each, and Jac paid 2-1-1-1-1. Jon and Matt wrote a comment on "
        "every song they voted on, ten each. Sarah Black, Michael Black, JohnPaul and Jac wrote none."
    ),
}

NOTES = [
    ("The Rat Utopia Experiment — \"Lobotomize Me\"",
     "Matt guessed Tommy from the sound alone: \"the song reminds me of the bobby lees which we all know Tommy "
     "was enamored with.\" He was right and paid it 2. Jon paid 2 as well, but he ranked it below another song "
     "in the round: \"Not quite Chinchilla level.\""),
    ("Noname — \"namesake\"",
     "Sarah Black and Jon traded maximum 3s this round: she paid his song a 3, and he paid hers (Little Girl "
     "Gone) a 3. Matt also got this one right, \"JB - He has been into lady artists lately and also kind into "
     "rap too,\" and then paid it 0."),
    ("Us — \"Yo-Yo Revolution\"",
     "Jon paid 1 and credited the wrong Sarah: \"Good pick, Sarah Z!\" Sarah Zucker was not the submitter, "
     "and she paid it nothing herself: \"Wish I had more points.\""),
    ("CHINCHILLA — \"Little Girl Gone\"",
     "Six of its nine upvote points came from her husband and her brother-in-law, Jon (3) and Michael Black "
     "(3). Jon's review: \"fuck with the ladies at your own peril.\" Phil and Sarah Zucker knifed it. Matt "
     "guessed Layous: \"This sounds like a layous jam to me.\""),
    ("Ceebo — \"Parable Of A Skinnyman\"",
     "Matt's own pick came with no pitch, and the room answered in kind. Tommy paid the only 3 it got. "
     "Jon's review: \"Not horrible, but not deserving of any points either.\" Michael Black knifed it."),
    ("Megan Thee Stallion — \"Thin Ice\"",
     "Sarah Zucker's pitch was a datestamp, which for this theme is the best evidence available: \"Hot off "
     "the press freestyle! 10/20/26.\" Matt named her with \"Zuck cause...obviously zuck\" and paid 1. Jon, "
     "who \"liked Ms. Stallion ever since she stole the show from Cardi B. on WAP,\" paid 0. Phil wrote "
     "\"This song is great! I'd give it votes if it wasn't for the new vote system,\" and then spent his six "
     "points on Tommy (3), JohnPaul (2) and Mara (1)."),
    ("Jojo Dodge — \"Leave The Party\"",
     "Phil's pitch: \"Just doing my due diligence to support family and I was impressed by this song by a "
     "third cousin of mine, or is it first cousin once removed?\" Matt guessed Phil on that alone: \"he has "
     "family, right?\" JohnPaul paid it a 3. Jac, a Chapin, knifed it. Jon: \"Your cousin has a nice voice, "
     "but this song is a bit lacking.\""),
    ("The Smile — \"The Smoke\"",
     "JohnPaul's pitch was one word: \"Enjoy.\" Matt guessed Michael Black because \"he tends to be brief but "
     "profound,\" paid it 0, and scored himself \"1 of 2.\" Jon knifed it: \"Oh? Is this song over? "
     "Apologies, but I fell asleep listening to it. Did it ever get good?\" Sarah Zucker knifed it too, with "
     "no comment."),
    ("Jack Johnson & Hermanos Gutiérrez — \"Hold On To The Light\"",
     "Matt knifed it on a guess: \"Jac because I think he mostly won't know the other ones.\" It was Jac's. "
     "This is the same Matt whose own Jack Johnson song, \"Bubble Toes,\" scored 11 in Remember When with "
     "no knives. Jon had paid that one 0 and now called the artist \"as anodyne and uninteresting as ever.\" "
     "Layous was its only payer."),
    ("Sleep Token — \"The Summoning\"",
     "Jon: \"Starts poorly, gets worse, and doesn't let up for over 6.5 minutes. Definitely deserving of its "
     "downvote.\" Four knives, from Jon, Mara, Sarah Black and Michael Black, against two payers, JohnPaul "
     "and Jac. Phil: \"I liked this a lot too.\" He paid it 0. Matt guessed \"JP because I don't have anyone "
     "else left.\" It was Layous."),
    ("Chappell Roan — \"Pink Pony Club\"",
     "The hearing ran Friday afternoon. Sarah Black: \"Ah hem, pink pony club was released in 2020. Just "
     "sayin.\" Jon: \"Looks like it was released in 2020, but then rereleased on her 2023 album.\" The theme "
     "is songs released since January 1st, 2022, so a 2020 single and a 2023 album sit on opposite sides of "
     "the line, and the league never ruled on which one counts. Jon had settled his own view the day before "
     "in a different dispute: \"The league required an actual boat, not a shitty boat metaphor.\" On his "
     "ballot he paid this one 0 with \"Giving you the benefit of the doubt and acknowledging the 2023 album "
     "release date.\" Phil, who wrote the theme, called it \"a great fun song but wasn't new enough for "
     "me,\" and knifed it. Matt knifed it on a guess: \"Sarah B - I think she liked...them when they were "
     "submitted before.\" No Chappell Roan appears in the Second Best archive before this round, and Sarah "
     "Black was not the submitter."),
]

CHAT = {
    "title": "Meanwhile, in the Group Chat",
    "summary": (
        "From a Game of Thrones casting call on Wednesday to a Mark Zuckerberg playlist on Monday night, "
        "with a funeral-day itinerary, a lookism inquiry, a birthday, and a 2027 reunion plan in between."
    ),
    "moments": [
        {"label": "Casting Call",
         "detail": "Wednesday morning Jon answered last round's digest by casting everyone he could think of. "
                   "Mara became the nun with the bell who says \"Shame!\" Michael Black was \"definitely Hodor.\" "
                   "Sarah Zucker took a Buzzfeed quiz (\"It thinks I'm young\"), then called herself dim: "
                   "\"I am dim.\" Jon: \"That is a dastardly lie!\" Matt nominated himself as Jon Snow, "
                   "\"bastard cunning,\" and Jon replied \"You know nothing, Mashew.\""},
        {"label": "The Pascoe Archive",
         "detail": "That evening Jon dug up Brian Pascoe's 2013 directions to his house in Todos Santos and "
                   "read them as a labor of love: \"In my mind, BP spent a quiet afternoon by himself overlooking "
                   "the mighty Pacific - methodically laying out every single landmark that would help us locate "
                   "Casa Chocolate.\" Brian: \"I think i copy pasted that from the neighbors website. No way i "
                   "had the patience to write that.\" The thread moved on to a Pennywise show at Loyola, where "
                   "Matt remembers \"an impromptu mosh pit in the back of bps suburban.\" Brian: \"That concert "
                   "was brought to us by the Ford Motor Company.\" Jon: \"Even a declining American car "
                   "manufacturer gets it right once every couple of decades.\""},
        {"label": "Highs and Lows",
         "detail": "Friday's playlist post sorted the songs into \"Highs\" (Pink Pony Club, The Summoning) and "
                   "\"Lows\" (Lobotomize Me, Yo-Yo Revolution). Matt corrected it half an hour later: \"sorry - AI "
                   "got crazy and called some of the songs lows and some highs - t hey are all mediums in my "
                   "book.\" The final standings agreed with the correction in the harshest way available. The "
                   "\"highs\" finished tenth and eleventh. The \"lows\" finished first and third."},
        {"label": "Monitored for Lookisms",
         "detail": "Friday afternoon, minutes after the Chappell Roan hearing, Jon posted a photo of the Rat "
                   "Utopia Experiment's face paint and suggested she join them: \"With her face paint, she might "
                   "be able to team up with the Rat Utopia Experiment.\" Matt opened an inquiry: \"jon we dont "
                   "belittle peoples makeup in sb.\" Jon's defense: \"Dude, it's Nevada Day. Cut us some "
                   "slack.\" Matt: \"its more the tone.\" Matt again: \"you are being monitored for further "
                   "lookisms.\" Jon cited his pedigree, \"married to a master costumer who makes all my costumes "
                   "for me and reminds me what the event is several times ahead of time, and I still forget.\" "
                   "TJ Cook had his own Halloween plan: \"We are putting put a glow in the dark bowl at the "
                   "bottom of the stairs and saying go sizzler salad bar on it. First come first serve.\""},
        {"label": "Tech Support for JohnPaul",
         "detail": "On Wednesday Jon had filed JohnPaul under the periphery: \"JP must be a white walker - out "
                   "there on the periphery, coming closer each day, but still largely unknown and mysterious.\" "
                   "Friday night Phil reported that JP \"can't access the voting and he did submit.\" Matt "
                   "prescribed \"Clear his cache, or open a new tab in incognito mode,\" then offered to walk "
                   "him through it by email. Jon's Monday reminder ended with \"tell him we miss him on this "
                   "chat.\" JP's ballot arrived Monday at 7:09 p.m., about three days after Phil's first report."},
        {"label": "Sportsball Fashion",
         "detail": "Saturday, Brian asked Sarah Black whether she was rooting for the Wolf Pack or the Bruins. "
                   "Her method: \"Who has the better outfit? That's usually who I root for.\" Jon reported her "
                   "analysis as hoping \"UCLA gets more home runs than the Wolfpack,\" and got a \"HEY.\" Michael "
                   "Black produced evidence of his own, his youth team's Pac-Man jerseys: \"inky, blinky, pinky "
                   "and Clyde.\" Sarah Black: \"Ok that's probably the best sportsball fashion I've ever "
                   "seen.\" That afternoon Michael posted a Rob Zombie video with a review he edited twice, and "
                   "the final draft reads \"If there was a better Halloween video better than this I must have "
                   "missed it.\""},
        {"label": "A Gift of Two Hours",
         "detail": "Sunday was Michael Black's birthday, which Jon worked out from an old photo: \"means today - "
                   "November 1 - is his bday.\" Matt: \"it's never to late to learn "
                   "an instrument!\" Jon described the gift: Michael's daughter asked him to drive her to San "
                   "Jose for two water polo matches, \"a two-hour drive roundtrip without traffic.\" Matt: "
                   "\"lots of time with the SB playlist - what a gift?!?!\" Jon: \"Maybe if it was a different "
                   "week?\" The roast ran both ways. Matt, having just read last round's digest: \"I must say "
                   "that hurt to read, MB.\""},
        {"label": "Cayookie 2027",
         "detail": "Brian asked whether there would be an in-person Music League gathering and proposed the "
                   "format: \"squeeze into the largest vehicle with the best sound system, and just pump Nipsey "
                   "Hussle and other ML gems.\" Matt: \"cayookie!\" Jon dated the last one: \"2019 when we did that "
                   "little trip to Cayucous.\" Sarah Zucker supplied the logistics: \"To make all our schedules "
                   "work we'll need to start planning for 2029.\" Brian offered Seattle (\"Maybe we should go "
                   "there\"), Reno (\"Check in on Queeno & Reino\") and Mexico City. Sarah Zucker: \"I hope the "
                   "next places I go is Mexico City and Oaxaca. A dream.\""},
        {"label": "The Zuck Mix-Up",
         "detail": "Voting closed on a post-mortem. Layous revealed who he thought would like his Sleep Token "
                   "pick: \"Did not think the ladies would like it\" and \"JP still a mystery.\" Sarah Zucker, who "
                   "knows the band \"from TikTok unfortunately,\" reported a rough night: she \"stepped in dog "
                   "poop in my Ugg slipper and it got on the furry part.\" Matt asked \"how do you know sleep "
                   "token zuck.\" Layous jumped in, and Matt corrected him: \"sarah is Zuck - but I appreciate your "
                   "effort Michael.\" Layous later confessed: \"Embarrassing\" / \"Forgot someone's last "
                   "name\" / \"Got excited\" / \"And thought the question was for me.\" The detour ended with Mark Zuckerberg's imagined "
                   "playlist. Jon: \"I see him as a big Drake guy.\" Matt: \"I picture him liking only "
                   "classical music.\" Layous consulted Google: \"He is a big Daft Punk fan.\""},
    ],
}

STORYLINES = {
    "title": "Character Witnesses",
    "note": "Two members of the league, entered into the record.",
    "cast": [
        {"name": "The Syllabus", "player": "Mara Mariani", "type": "homework assigner · deadline enforcer",
         "style": "quote-led", "motif": "grades on release date, assigns viewing",
         "note": "Mara's ballot reads like a course outline. Her 3 for Thin Ice came with an assignment "
                 "(\"Video viewing required\") and a ranking by release date: \"Newest song of my top 3,\" then "
                 "\"2nd newest of my top 3,\" then \"Oldest song of my top 3.\" She is the one voter who sorted her "
                 "own taste by freshness in a round about freshness. She did Jon's job for him, posting a "
                 "countdown for the one player who hadn't submitted: \"1 hr to submit.\" She turned a 0 for "
                 "Lobotomize Me into a field trip: \"They're playing with the Bobby Lees in LA next month. Who's "
                 "in?\" Her knife went to Pink Pony Club with a release year that matches neither date the chat "
                 "found: \"This song technically fits the theme since it came out in 2022.\" Then she took "
                 "the bronze.",
         "evidence": ["Video viewing required",
                      "Newest song of my top 3",
                      "2nd newest of my top 3",
                      "Oldest song of my top 3",
                      "1 hr to submit",
                      "They're playing with the Bobby Lees in LA next month. Who's in?",
                      "This song technically fits the theme since it came out in 2022"],
         "highlight": ["Video viewing required", "2nd newest of my top 3", "Who's in?"],
         "stats": [{"value": "9", "label": "points, bronze"},
                   {"value": "3", "label": "picks, ranked by release date"},
                   {"value": "1 hr", "label": "countdown posted for the missing player"}]},
        {"name": "The Hype Man", "player": "Tommy Chapin", "type": "round winner · compliments only",
         "style": "quote-led", "motif": "pays in praise, not points",
         "note": "Tommy won with 13 points and then spent his own ballot like a man who has no use for the "
                 "currency. Five songs got a compliment from him in writing and a 0 on the grid: \"This is cool.\" "
                 "(The Smoke), \"Yeah right Philip. It's good though\" (Leave The Party), \"Who picked this? It's "
                 "good.\" (The Summoning), \"Dig this a lot\" (Little Girl Gone), and \"This is great Ran of "
                 "points.\" (Yo-Yo Revolution). His 3 went to Matt's Parable Of A Skinnyman, which had no pitch "
                 "and was paid more than 1 by nobody else. The most points anyone has ever failed to receive from "
                 "a man who said \"Goddamnit! This rules!\"",
         "evidence": ["This is cool.",
                      "Yeah right Philip.   It's good though",
                      "An anonymous prog metal band.  Who picked this?  It's good.",
                      "Dig this a lot",
                      "This is great Ran of points.  Thanks for this though.",
                      "Goddamnit!  This rules!"],
         "highlight": ["Dig this a lot", "Ran of points", "Who picked this?"],
         "stats": [{"value": "13", "label": "points, round winner"},
                   {"value": "5", "label": "songs praised and paid 0"},
                   {"value": "3", "label": "points to Matt's pitchless pick"}]},
    ],
}

COINAGE = {
    "title": "The Coinage",
    "phrase": {
        "style": "dictionary",
        "term": "Bakersfield Social Day",
        "pronunciation": "/ˈbeɪkərzˌfiːld ˈsoʊʃəl deɪ/",
        "part_of_speech": "n. · one day, every obligation",
        "definition": (
            "A single day in which one person completes every social obligation in a mid-sized California "
            "city: a 5 a.m. coffee with the old boys, a funeral, the reception, an eighth-grade flag football "
            "final, a JV game, a parking-lot beer pickup, and dinner with his parents. Brian Pascoe ran the "
            "2026 edition on Thursday, October 29, with one omission. He got home and passed out before he "
            "could enter his Music League song."
        ),
        "coined": {"by": "Brian Pascoe", "date": "2026-10-30", "at": "the group chat",
                   "context": "posted the morning after, explaining a missing submission"},
        "stats": {"uses": 1, "speakers": 1, "prior_rounds": 0},
        "usages": [
            {"label": "original", "speaker": "Brian Pascoe",
             "text": "Damn, my day yesterday was loco. I almost mentioned music league 5 times to peeps I saw on my Bakersfield Social Day 2026"},
            {"label": "the excuse", "speaker": "Brian Pascoe",
             "text": "Got home passed out before I could enter ML app"},
            {"label": "the review", "speaker": "TJ Cook",
             "text": "Pascoe fit in about 5 years of bakersfield visits in one day."},
            {"label": "the cast list", "speaker": "Jonathan Black",
             "text": "\"Pascoe Clerou\" is a more Garces sounding name than \"Chapin Antongiovanni.\""},
            {"label": "the clerk", "speaker": "Mara Mariani",
             "text": "it's hard to keep the individual family members straight when dealing with those continuously replicating Bakersfield dynasty families."},
        ],
        "meta": "n. · coined by Brian Pascoe, Oct 30 · 1 speaker",
    },
}

# ---- alternates (not written to the draft; rendered to markdown) -------------------------------
OPTIONS = {
    "coinage": [
        {"id": "B", "term": "lookisms", "pos": "n. pl. · co-commissioner's ruling",
         "definition": "Remarks that mock an artist's makeup or outfit instead of their music, as defined by "
                       "Matt. Not tolerated in Second Best; offenders are monitored. The first offender was Jon "
                       "Black, caught comparing Chappell Roan's face paint to the Rat Utopia Experiment's, and "
                       "whose defense was a public holiday.",
         "coined": "Matt Mariani, Oct 30 · 1 literal use, 2 speakers in the case",
         "usages": [("Matt Mariani", "jon we dont belittle peoples makeup in sb"),
                    ("Jonathan Black", "Dude, it's Nevada Day.  Cut us some slack."),
                    ("Matt Mariani", "its more the tone"),
                    ("Matt Mariani", "im just saying  - you are being monitored for further lookisms"),
                    ("Matt Mariani", "whats next - mocking her gloves in summer"),
                    ("Jonathan Black", "More your own internal biases projecting.")],
         "swap": "If picked, delete the \"Monitored for Lookisms\" chat moment (keep TJ's glow bowl line somewhere "
                 "so TJ stays in the digest) and re-run."},
        {"id": "C", "term": "costume retread", "pos": "n. · Halloween economics",
         "definition": "Wearing a costume that has already been worn. Jon applied it to his older brother, "
                       "\"a well-known costume recycler,\" and Matt claimed it as a virtue, having worn the "
                       "seams out of a $40 beekeeper outfit. Michael Black's whoopie cushion is the "
                       "reference specimen.",
         "coined": "Matt Mariani, Nov 1 · 2 speakers (retread / recycler)",
         "usages": [("Jonathan Black", "MB was so proud of that whoopie cushion costume."),
                    ("Sarah Black", "Was or still is? I think he still rocks it"),
                    ("Jonathan Black", "I mean, he is a well-known costume recycler."),
                    ("Matt Mariani", "I appreciate a good costume retread."),
                    ("Matt Mariani", "I wore the seams out on that big ugly onesie")],
         "swap": "No overlap with the default sections."},
        {"id": "D (flag)", "term": "Hispanic James Harden", "pos": "n. · funeral-adjacent sighting",
         "definition": "Layous photographed a stranger at a funeral and filed him under a celebrity lookalike. "
                       "Matt: \"thanks for sharing the likeness mikey.\" Real usage (Layous x2, Nov 2), but it "
                       "labels a stranger by ethnicity and was shot at a funeral, so it is not in the "
                       "recommended set.",
         "coined": "Michael Layous, Nov 2",
         "usages": [("Michael Layous", "Despite his bulging eyes, Hispanic James Harden did not see me"),
                    ("Matt Mariani", "thanks for sharing the likeness mikey")],
         "swap": "Only if you want it. Needs your call on tone."},
    ],
    "regulars_slot1": [
        {"id": "B", "name": "The Reluctant Knife", "player": "Sarah Zucker", "type": "apologist · silent assassin",
         "note": "In August she told the chat, \"for the record,\" that she didn't want to downvote anyone, and "
                 "Mara answered \"Noted.\" Her ballots used to apologize in advance: \"I'm so sorry I don't like "
                 "them. I'm trying.\" This round she filed two knives, on The Smoke and Little Girl Gone, and "
                 "wrote nothing on either. Her 0 for Pink Pony Club came with \"Worthy of a point despite me "
                 "running out.\" And on Monday night she stepped in dog poop in an Ugg slipper and walked it "
                 "through the house.",
         "evidence": ["I just want to say for the record that I don't want to downvote anyone.",
                      "I'm so sorry I don't like them. I'm trying.",
                      "Worthy of a point despite me running out.",
                      "Wish I had more points.",
                      "stepped in dog poop in my Ugg slipper"],
         "swap": "Delete the \"no comment\" lines in the Smoke card, the Zucker mention in Little Girl Gone, "
                 "and the dog-poop line in Zuck Mix-Up."},
        {"id": "C", "name": "The Birthday Boy", "player": "Michael Black", "type": "birthday · seven knives",
         "note": "His birthday weekend produced the round's only song with no upvotes: Pink Pony Club, seven "
                 "knives, −7, no pitch. His own ballot wrote nothing, and he paid his sister-in-law a 3 and "
                 "Tommy a 2. In the chat he coached a Pac-Man-themed youth team to a title (\"as we took the "
                 "Chip\"), posted a Rob Zombie review three times, and received a two-hour drive to San Jose as "
                 "his present.",
         "evidence": ["Did JB not show you our PAC Man themed outfits we wore last week as we took the Chip?",
                      "Fun is winning",
                      "My algorithm went straight to Mother by Danzig. I was not disappointed"],
         "swap": "Drop the birthday sentences from Villain and the \"A Gift of Two Hours\" chat moment, "
                 "and the Pac-Man/Dragula lines in Sportsball Fashion."},
    ],
    "regulars_slot2": [
        {"id": "B", "name": "The Theme Author", "player": "Philip Chapin", "type": "rule-writer · rule-bender",
         "note": "Phil wrote the theme, then voted against the spirit of it. His knife for Pink Pony Club came "
                 "with \"It's a great fun song but wasn't new enough for me.\" He called Thin Ice great and said "
                 "the new vote system stopped him from paying it, then spent his six points on Tommy (3), "
                 "JohnPaul (2) and Mara (1). He liked The Summoning \"a lot\" and paid 0. A week earlier he "
                 "apologized for a downvote with \"Don't know if I was even thinking\", and this round he knifed Little "
                 "Girl Gone without a word.",
         "evidence": ["It’s a great fun song but wasn’t new enough for me",
                      "This song is great! I’d give it votes if it wasn’t for the new vote system",
                      "I liked this a lot too",
                      "Don’t know if I was even thinking when I even downvoted. Apologies!",
                      "Maybe I eeny meenyd it"],
         "swap": "Delete the Phil sentences in the Thin Ice, Summoning and Pink Pony cards, and the "
                 "\"Phil's knife was filed at 8:00\" line in Villain."},
        {"id": "C", "name": "The Absentee Advocate", "player": "Brian Pascoe", "type": "no ballot · pro double-downvote",
         "note": "On Oct 24 Brian told the chat he had \"not adhered to the agreed upon voting structure either "
                 "round\" and \"I like the possibility of double downvotes and I support its use.\" This round he "
                 "cast no ballot of any kind, so the possibility went unused. He got home and passed out before "
                 "he could enter his song, after a day that included a funeral and a flag football final.",
         "evidence": ["I’ve not adhered to the agreed upon voting structure either round this season.",
                      "I like the possibility of double downvotes and I support its use",
                      "Got home passed out before I could enter ML app"],
         "swap": "Pairs badly with the default Coinage (same man, same night). Use Coinage B or C with it, and "
                 "drop the double-downvote sentence from How It Played."},
    ],
}

# strings that are my paraphrase/translation or song titles, exempt from verbatim checks
EXEMPT = {
    "Lobotomize Me", "namesake", "Yo-Yo Revolution", "Little Girl Gone", "Parable Of A Skinnyman", "Thin Ice",
    "Leave The Party", "The Smoke", "Hold On To The Light", "The Summoning", "Pink Pony Club", "Bubble Toes",
    "Highs", "Lows", "highs", "lows", "Remember When", "Hurt",
    "Pascoe Clerou", "Chapin Antongiovanni", "Suoraan Helsingistä toukokuussa 2026",
    "Mooooovie", "a couple months ago", "1 of 2", "(5)",
}


def norm(s):
    s = (s or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[​-‏‪- ⁠⁦-⁩️]", "", s)
    s = s.replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


def build_blob(db):
    texts = [r[0] for r in db.execute("SELECT text FROM chat_messages WHERE group_name=?", (G,))]
    texts += [r[0] for r in db.execute(
        """SELECT v.comment FROM votes v JOIN rounds r ON r.id=v.round_id JOIN seasons s ON s.id=r.season_id
           WHERE s.league_id=3 AND v.comment IS NOT NULL""")]
    texts += [r[0] for r in db.execute(
        """SELECT m.comment FROM ml_submissions m JOIN rounds r ON r.id=m.round_id JOIN seasons s ON s.id=r.season_id
           WHERE s.league_id=3 AND m.comment IS NOT NULL""")]
    return "\n".join(norm(t) for t in texts)


def strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for k, v in o.items():
            if k in ("coverUrl", "crest", "style", "color_hex"):
                continue
            yield from strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)


def quoted(text):
    out = [m.strip().rstrip(",.!?;:").strip() for m in re.findall(r'"([^"]+)"', text)]
    return [q for q in out if len(q) >= 6]


def check_quotes(blob):
    """Every double-quoted snippet in the default sections must be verbatim in the chat/votes/pitches."""
    sections = {"podium": PODIUM, "villain": VILLAIN, "flow": FLOW, "consensus": {"items": NOTES},
                "chat": CHAT, "storylines": STORYLINES}
    seen = {}
    missing = []
    for name, sec in sections.items():
        for s in strings(sec):
            for q in quoted(s):
                key = norm(q)
                if q in EXEMPT:
                    continue
                parts = [p for p in re.split(r"\s*/\s*", key) if len(p) > 5] if " / " in q else [key]
                for p in parts:
                    if p.rstrip(",.!?;:") not in blob:
                        missing.append((name, q))
                if len(key) >= 14:
                    seen.setdefault(key, []).append(name)
    # evidence/usages are bare strings (no quote marks)
    for sec_name, container in (("storylines", STORYLINES["cast"]), ):
        for c in container:
            for e in c["evidence"]:
                if norm(e).rstrip(",.!?;:") not in blob:
                    missing.append((sec_name + ".evidence", e))
                seen.setdefault(norm(e).rstrip(",.!?;:"), []).append("storylines")
            for h in c["highlight"]:
                if not any(norm(h) in norm(e) for e in c["evidence"] + [c["note"]]):
                    missing.append((sec_name + ".highlight", h))
    for u in COINAGE["phrase"]["usages"]:
        t = u["text"]
        if norm(t).rstrip(",.!?;:").strip('"') not in blob:
            missing.append(("coinage.usage", t))
    for opt in OPTIONS["coinage"]:
        for _, t in opt["usages"]:
            if norm(t).rstrip(",.!?;:") not in blob:
                missing.append(("option.usage", t))
    for slot in ("regulars_slot1", "regulars_slot2"):
        for opt in OPTIONS[slot]:
            for e in opt["evidence"]:
                if norm(e).rstrip(",.!?;:") not in blob:
                    missing.append(("option.evidence", e))
            for q in quoted(opt["note"]):
                if q not in EXEMPT and norm(q).rstrip(",.!?;:") not in blob:
                    missing.append(("option.note", q))
    dups = {k: v for k, v in seen.items() if len(set(v)) > 1 or v.count("chat") > 1}
    return missing, dups


def check_facts(db):
    q = lambda sql, *a: db.execute(sql, a).fetchall()
    tot = dict(q("""SELECT s.title, coalesce(sum(v.points),0) FROM ml_submissions s LEFT JOIN votes v
                    ON v.round_id=s.round_id AND v.spotify_uri=s.spotify_uri WHERE s.round_id=? GROUP BY s.id""", ROUND))
    assert tot == {"Lobotomize Me": 13, "namesake": 11, "Yo-Yo Revolution": 9, "Little Girl Gone": 7,
                   "Parable Of A Skinnyman": 5, "Thin Ice": 4, "Leave The Party": 3, "The Smoke": 2,
                   "Hold On To The Light": -1, "The Summoning": -2, "Pink Pony Club": -7}, tot
    # ballot shape: everyone spent 6 up + 2 downs, nobody below -1 on a song
    for name, up, down, n in q("""SELECT c.name, sum(CASE WHEN points>0 THEN points ELSE 0 END),
                                        sum(CASE WHEN points<0 THEN -points ELSE 0 END), count(*)
                                  FROM votes v JOIN competitors c ON c.id=v.voter_id WHERE round_id=? GROUP BY 1""", ROUND):
        assert (up, down) == (6, 2), (name, up, down)
    assert q("SELECT min(points) FROM votes WHERE round_id=?", ROUND)[0][0] == -1
    voters = {r[0] for r in q("SELECT DISTINCT c.name FROM votes v JOIN competitors c ON c.id=v.voter_id WHERE round_id=?", ROUND)}
    assert len(voters) == 11 and "Voltron’s YoungLion" not in voters, voters
    assert not q("SELECT 1 FROM ml_submissions m JOIN competitors c ON c.id=m.competitor_id WHERE m.round_id=? AND c.name LIKE 'Voltron%'", ROUND)
    # ballot shapes: nine 3-2-1, Layous six 1s, jac 2-1-1-1-1
    shapes = {}
    for name, pts in q("SELECT c.name, group_concat(points) FROM votes v JOIN competitors c ON c.id=v.voter_id WHERE round_id=? AND points>0 GROUP BY 1", ROUND):
        shapes[name] = sorted(map(int, pts.split(",")), reverse=True)
    assert shapes["Michael Layous"] == [1] * 6 and shapes["jac"] == [2, 1, 1, 1, 1]
    assert sum(1 for v in shapes.values() if v == [3, 2, 1]) == 9, shapes
    # Pink Pony: 7 knives, 2 zeros, JP skipped, MB submitter, no upvotes
    pp = {r[0]: r[1] for r in q("""SELECT c.name, v.points FROM votes v JOIN competitors c ON c.id=v.voter_id
                                   WHERE v.round_id=? AND v.spotify_uri=(SELECT spotify_uri FROM ml_submissions WHERE round_id=? AND title='Pink Pony Club')""", ROUND, ROUND)}
    assert sorted(k for k, v in pp.items() if v == -1) == sorted(["Mashew", "Philip Chapin", "Queen0Reno", "Tommy", "jac", "missmara", "Michael Layous"]), pp
    assert sorted(k for k, v in pp.items() if v == 0) == ["Jonathan Black", "Sarah"] and "JohnPaul Rodriguez" not in pp and len(pp) == 9
    assert q("""SELECT c.name FROM ml_submissions m JOIN competitors c ON c.id=m.competitor_id WHERE m.round_id=? AND m.title='Pink Pony Club' AND m.comment IS NULL""", ROUND) == [("monicac1217",)] or \
        q("""SELECT c.name FROM ml_submissions m JOIN competitors c ON c.id=m.competitor_id WHERE m.round_id=? AND m.title='Pink Pony Club' AND m.comment=''""", ROUND) == [("monicac1217",)]
    ts = q("SELECT created_at FROM votes v JOIN competitors c ON c.id=v.voter_id WHERE round_id=? AND c.name='Philip Chapin' LIMIT 1", ROUND)[0][0]
    assert ts.startswith("2026-11-01T16:00"), ts          # 8:00 a.m. PST on Nov 1
    jp = q("SELECT min(created_at) FROM votes v JOIN competitors c ON c.id=v.voter_id WHERE round_id=? AND c.name='JohnPaul Rodriguez'", ROUND)[0][0]
    assert jp.startswith("2026-11-03T03:09"), jp          # 7:09 p.m. PST on Nov 2
    # Matt's guess cycle, via comments
    def comment(voter, title):
        r = q("""SELECT v.comment FROM votes v JOIN competitors c ON c.id=v.voter_id JOIN ml_submissions s ON s.round_id=v.round_id AND s.spotify_uri=v.spotify_uri
                 WHERE v.round_id=? AND c.name=? AND s.title=?""", ROUND, voter, title)
        return r[0][0] if r else None
    assert "Michael Black" in comment("Mashew", "The Smoke") and "Sarah B" in comment("Mashew", "Pink Pony Club")
    assert "layous" in comment("Mashew", "Little Girl Gone").lower() and comment("Mashew", "The Summoning").startswith("JP")
    who = dict(q("SELECT m.title, c.name FROM ml_submissions m JOIN competitors c ON c.id=m.competitor_id WHERE m.round_id=?", ROUND))
    assert who["The Smoke"] == "JohnPaul Rodriguez" and who["Pink Pony Club"] == "monicac1217"
    assert who["Little Girl Gone"] == "Queen0Reno" and who["The Summoning"] == "Michael Layous"
    # Matt's ballot: 3 songs paid, 5 zeros, 2 knives; Jon + Matt commented on all 10; four silent ballots
    for name in ("Mashew", "Jonathan Black"):
        assert q("SELECT count(*), sum(coalesce(comment,'')!='') FROM votes v JOIN competitors c ON c.id=v.voter_id WHERE round_id=? AND c.name=?", ROUND, name)[0] == (10, 10)
    for name in ("Queen0Reno", "monicac1217", "JohnPaul Rodriguez", "jac"):
        assert q("SELECT sum(coalesce(comment,'')!='') FROM votes v JOIN competitors c ON c.id=v.voter_id WHERE round_id=? AND c.name=?", ROUND, name)[0][0] == 0, name
    # Tommy: five praised songs paid 0; Parable 3, nobody else above 1
    assert all(q("""SELECT v.points FROM votes v JOIN competitors c ON c.id=v.voter_id JOIN ml_submissions s ON s.round_id=v.round_id AND s.spotify_uri=v.spotify_uri
                    WHERE v.round_id=? AND c.name='Tommy' AND s.title=?""", ROUND, t)[0][0] == 0
               for t in ("The Smoke", "Leave The Party", "The Summoning", "Little Girl Gone", "Yo-Yo Revolution"))
    par = sorted((r[0] for r in q("""SELECT v.points FROM votes v JOIN ml_submissions s ON s.round_id=v.round_id AND s.spotify_uri=v.spotify_uri
                                      WHERE v.round_id=? AND s.title='Parable Of A Skinnyman'""", ROUND)), reverse=True)
    assert par[0] == 3 and par[1] == 1, par
    # Little Girl Gone: 6 of 9 up points from Jon + MB
    lg = {r[0]: r[1] for r in q("""SELECT c.name, v.points FROM votes v JOIN competitors c ON c.id=v.voter_id JOIN ml_submissions s ON s.round_id=v.round_id AND s.spotify_uri=v.spotify_uri
                                   WHERE v.round_id=? AND s.title='Little Girl Gone'""", ROUND)}
    assert lg["Jonathan Black"] == 3 and lg["monicac1217"] == 3 and sum(p for p in lg.values() if p > 0) == 9
    # Jon <-> Sarah Black traded 3s
    assert q("""SELECT v.points FROM votes v JOIN competitors c ON c.id=v.voter_id JOIN ml_submissions s ON s.round_id=v.round_id AND s.spotify_uri=v.spotify_uri
                WHERE v.round_id=? AND c.name='Queen0Reno' AND s.title='namesake'""", ROUND)[0][0] == 3
    # Lobotomize: Phil 3, five 2s, jac 1, one knife (JP)
    lo = sorted(r[0] for r in q("""SELECT v.points FROM votes v JOIN ml_submissions s ON s.round_id=v.round_id AND s.spotify_uri=v.spotify_uri
                                   WHERE v.round_id=? AND s.title='Lobotomize Me'""", ROUND))
    assert lo == [-1, 0, 1, 2, 2, 2, 2, 2, 3], lo
    # Bubble Toes (Matt, R144 Remember When): 11 points, no negatives; Jon paid 0
    bt = q("""SELECT c.name, v.points FROM votes v JOIN competitors c ON c.id=v.voter_id JOIN ml_submissions s ON s.round_id=v.round_id AND s.spotify_uri=v.spotify_uri
              WHERE s.title='Bubble Toes' AND s.artists LIKE '%Jack Johnson%' AND v.round_id=144""")
    assert sum(p for _, p in bt) == 11 and min(p for _, p in bt) >= 0 and dict(bt)["Jonathan Black"] == 0, bt
    # Chappell Roan never in the Second Best archive before this round
    assert not q("""SELECT 1 FROM ml_submissions m JOIN rounds r ON r.id=m.round_id JOIN seasons s ON s.id=r.season_id
                    WHERE s.league_id=3 AND r.id<? AND m.artists LIKE '%Chappell%'""", ROUND)
    # highs/lows standing: Pink Pony + Summoning are 11th and 10th; Lobotomize 1st, Yo-Yo 3rd
    order = [t for t, _ in sorted(tot.items(), key=lambda kv: -kv[1])]
    assert order[0] == "Lobotomize Me" and order[2] == "Yo-Yo Revolution" and order[-1] == "Pink Pony Club" and order[-2] == "The Summoning"
    # season standings after R4
    st = dict(q("""SELECT c.name, sum((SELECT coalesce(sum(points),0) FROM votes v WHERE v.round_id=m.round_id AND v.spotify_uri=m.spotify_uri))
                   FROM ml_submissions m JOIN rounds r ON r.id=m.round_id JOIN competitors c ON c.id=m.competitor_id WHERE r.season_id=14 GROUP BY 1"""))
    assert st["missmara"] == 28 and st["Queen0Reno"] == 25 and st["Jonathan Black"] == 22 and st["Tommy"] == 22, st
    assert [r[0] for r in q("SELECT c.name FROM ml_submissions m JOIN competitors c ON c.id=m.competitor_id WHERE m.round_id IN (179,180,181) AND m.title IN ('Rock n Roll','These Days','No Love')")] != []
    # Matt's playlist post exists with the Highs/Lows wording
    assert q("SELECT 1 FROM chat_messages WHERE group_name=? AND sender='Matt Mariani' AND instr(text,'Highs:')>0 AND instr(text,'Lows:')>0 AND ts>=?", G, WINDOW[0])


def render_options(path):
    L = ["# R182 options: Coinage and Regulars", "",
         "Defaults are what `punchup_r182.py` wrote to the draft. Every quote was checked against the DB.", "",
         "## Coinage (1 slot)", "",
         f"**A (installed): {COINAGE['phrase']['term']}.** {COINAGE['phrase']['definition']}", ""]
    for o in OPTIONS["coinage"]:
        L += [f"**{o['id']}: {o['term']}** ({o['pos']}). {o['definition']}", f"- Coined: {o['coined']}"]
        L += [f"- {s}: \"{t}\"" for s, t in o["usages"]]
        L += [f"- Swap note: {o['swap']}", ""]
    for slot, title, default in (("regulars_slot1", "Regulars, slot 1", STORYLINES["cast"][0]),
                                 ("regulars_slot2", "Regulars, slot 2", STORYLINES["cast"][1])):
        L += [f"## {title}", "", f"**A (installed): {default['name']} ({default['player']}).** {default['note']}", ""]
        for o in OPTIONS[slot]:
            L += [f"**{o['id']}: {o['name']} ({o['player']}), {o['type']}.** {o['note']}"]
            L += [f"- \"{e}\"" for e in o["evidence"]]
            L += [f"- Swap note: {o['swap']}", ""]
    with open(path, "w") as f:
        f.write("\n".join(L))


def main(db_path, options_md=None):
    db = sqlite3.connect(db_path)
    check_facts(db)
    missing, dups = check_quotes(build_blob(db))
    for m in missing:
        print("NOT VERBATIM:", m)
    for k, v in dups.items():
        print("REPEATED:", k[:70], v)
    assert not missing, f"{len(missing)} quotes not found"
    assert not dups, f"{len(dups)} repeated quotes"
    if options_md:
        render_options(options_md)
    rows = db.execute("SELECT kind, content_json FROM digest_sections WHERE draft_id=?", (DRAFT,)).fetchall()
    stats = db.execute("SELECT stats_content_json FROM digest_drafts WHERE id=?", (DRAFT,)).fetchone()[0]
    backup_dir = os.path.join(os.path.dirname(os.path.abspath(db_path)), "digest-section-backups")
    os.makedirs(backup_dir, exist_ok=True)
    backup = os.path.join(backup_dir, "r182.pre-punchup.json")
    if not os.path.exists(backup):
        with open(backup, "w") as f:
            json.dump({"sections": {k: json.loads(v) for k, v in rows}, "stats_content_json": stats}, f, indent=1, ensure_ascii=False)
    consensus = {"title": "The Room Agreed", "items": [{"song": s, "detail": n} for s, n in NOTES]}
    now = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    with db:
        for kind, content in (("podium", PODIUM), ("villain", VILLAIN), ("flow", FLOW), ("consensus", consensus), ("chat", CHAT)):
            db.execute(f"UPDATE digest_sections SET content_json=?, edited_at={now} WHERE draft_id=? AND kind=?",
                       (json.dumps(content, ensure_ascii=False), DRAFT, kind))
        db.execute("UPDATE digest_sections SET state='excluded' WHERE draft_id=? AND kind='quotes'", (DRAFT,))
        if any(k == "storylines" for k, _ in rows):
            db.execute(f"UPDATE digest_sections SET content_json=?, edited_at={now} WHERE draft_id=? AND kind='storylines'",
                       (json.dumps(STORYLINES, ensure_ascii=False), DRAFT))
        else:
            pos = db.execute("SELECT coalesce(max(position),-1)+1 FROM digest_sections WHERE draft_id=?", (DRAFT,)).fetchone()[0]
            db.execute(f"INSERT INTO digest_sections (id, draft_id, kind, position, content_json, edited_at) VALUES (?,?,?,?,?,{now})",
                       (f"sec-stl-{uuid.uuid4().hex[:8]}", DRAFT, "storylines", pos, json.dumps(STORYLINES, ensure_ascii=False)))
        merged = {**json.loads(stats or "{}"), **COINAGE}
        db.execute("UPDATE digest_drafts SET stats_content_json=? WHERE id=?", (json.dumps(merged, ensure_ascii=False), DRAFT))
        g = json.loads(db.execute("SELECT value FROM settings WHERE key='guesser_section_leagues'").fetchone()[0])
        g["second-best"] = True
        db.execute("UPDATE settings SET value=? WHERE key='guesser_section_leagues'", (json.dumps(g),))
    print(f"verified facts + quotes; wrote 6 sections + coinage to {DRAFT}; quotes section excluded; originals at {backup}")


if __name__ == "__main__":
    opts = sys.argv[sys.argv.index("--options-md") + 1] if "--options-md" in sys.argv else None
    main(sys.argv[1], opts)
