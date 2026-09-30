"""Build provisional, source-linked player taste summaries from local exports."""
from __future__ import annotations

import collections
import glob
import json
import re
import sqlite3
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / "data" / "boarz-final-round-analysis" / "profiles"
VOTING = HERE.parent / "voting" / "players"
DB = ROOT / "data" / "league.db"
LINKS = HERE.parent / "whatsapp" / "link-incidents"
CATALOG = HERE.parent / "voting" / "song-catalog.json"

MUSIC = re.compile(r"\b(song|music|album|artist|band|concert|listen|genre|punk|rap|hip.?hop|rock|metal|country|jazz|singer|guitar|drums|vocals|bass|track|tune|spotify|youtube|melody|lyrics|sound|playlist|cover|ska|pop|riff)\b", re.I)

def normalize_sender(sender: str) -> str:
    """Match WhatsApp's narrow no-break spaces to saved identity strings."""
    return " ".join(sender.split())

NOTES = {
    1: ("Leans toward energetic alternative, punk and inventive rap, and explicitly rewards discovering a song or artist. Song quality leads his ballot; familiarity and weak impact can cost points.", ["ab176959-58f0-455e-8e5b-462c0aa676bb", "d3f2b5b9-911a-4828-ac53-314da2e1b90e", "fb701f98-aa43-4a3b-a457-ac9daa41e0d8"]),
    4: ("Broad taste spanning punk, folk, soul and dance rock. He values strong vocals, instrumental details and lyrics, and can penalize weak theme fit or low replay value even when he likes the song.", ["85702061-e1d4-47be-b292-3695a2d07a17", "23d495b6-cd04-409f-b4d2-134e82bdede7", "a8c9ab5b-4c2a-4002-b579-071d85c2922b"]),
    30: ("Nirvana and Dylan are stated staples, and he reports a long established listening base with more jazz lately. Votes also reward folk, soul and some groove driven discoveries. Sparse vote comments make specific dislikes harder to explain.", ["e4656ffc-f76a-45ac-bce3-aafcf228319f", "40300c5b-aa6e-4a7a-8d8d-480a6ff212e9", "500d4634-2a80-48f3-af97-e2d9617fa05e", "20597bd6-970c-488a-b3f6-c5b9b4b0ef33"]),
    31: ("Eclectic submissions across rap, classic rock, pop and metal. The ballot favors forceful, catchy songs, but very few comments explain the criteria; avoid treating any single genre vote as a stable rule.", ["8cd90de2-b91f-42c8-9ae1-866a49180a2c", "b39a4ad3-e65b-4024-bff2-79a693dab941"]),
    32: ("Explicitly favors bluegrass over pop country and dislikes frantic, screamed punk. Strong ballots favor melodic storytelling, older sounding vocals and songs with a clear emotional point; some punk wins when melody survives.", ["48387ad8-3976-49de-ab2d-16310121fa46", "32d760a8-0e5f-479d-a6bb-86c873abe99d", "47cca415-f18e-4fc0-a302-fbf324b537f8"]),
    33: ("Submissions range from dance rock and electronic R&B to Dylan, metal and rap. He describes his Rapture pick as dance with punk attitude and recommends post punk; the ballot shows broad openness without a hard genre boundary.", ["54cf5970-514e-406f-9ef9-ce28578a40ea", "5f6e69c1-b96a-4fa3-93c0-704d4e8cf4df", "96bc4494-48ea-4e45-84ed-caa1a69149fc"]),
    34: ("A self described jazz band kid who moved into punk and metal. Strong votes reward technical or surprising playing as well as fast punk; novelty alone often fails him.", ["7dff930a-b1a4-4c73-b83c-06ae3106a03e"]),
    35: ("Rewards energetic, memorable punk and discovery, while showing room for rap and pop. He states a Rush favorite and a Rapture favorite, but dislikes particular slow or irritating tracks rather than an entire genre.", ["0cc65db2-5958-4e6b-9930-5c7e06265c6e", "af568804-d70f-4c0f-aff9-a28c38b606d7"]),
    36: ("Wide submission and vote range, from blues and soul to rap, industrial metal and indie rock. His written reactions often prize performance and replay value and reject novelty that fails as a song.", []),
    38: ("Punk and skate punk recur in submissions, while high votes also reach story rap and eclectic tracks. His comments give some reasons, but his chat links need separate identification and response attribution before broader claims.", ["243cf229-370d-4b79-a717-f0ccd1ce0f12"]),
}
CONFIDENCE = {
    1: "higher: 9 voting rounds, many explanatory comments, direct chat criteria",
    4: "higher: 9 voting rounds, explanatory comments on every recorded vote, direct chat",
    30: "limited: 7 voting rounds and only 8 explanatory vote comments, despite clear direct chat anchors",
    31: "limited: 8 voting rounds and only 2 explanatory vote comments",
    32: "higher: 9 voting rounds, 70 explanatory vote comments, direct chat criteria",
    33: "moderate: 9 voting rounds, 11 vote comments, several attributable music chat statements",
    34: "moderate: 9 voting rounds, 36 vote comments, direct background statement",
    35: "moderate: 9 voting rounds, 43 vote comments, direct artist statements",
    36: "moderate: 8 voting rounds and 50 vote comments, sparse direct chat taste statements",
    38: "moderate: 8 voting rounds and 35 vote comments, limited direct chat taste statements",
}

def compact(text: str, limit: int = 145) -> str:
    text = " ".join((text or "").split()).replace("|", "\\|")
    return text if len(text) <= limit else text[: limit - 1] + "…"

def main() -> None:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = conn.execute("SELECT id,sender,text,ts FROM chat_messages WHERE group_name LIKE 'Boarz II Men%' ORDER BY ts,id").fetchall()
    by_id = {r[0]: r for r in rows}
    aliases = collections.defaultdict(set)
    for pid, identifier in conn.execute("SELECT player_id,identifier FROM player_identities WHERE league_id=5 AND identity_type='whatsapp'"):
        aliases[pid].add(normalize_sender(identifier))
    links = [json.loads(Path(p).read_text()) for p in glob.glob(str(LINKS / "*.json"))]
    catalog = {t["spotify_uri"]: t for t in json.loads(CATALOG.read_text())["tracks"]}
    completed_round_ids = {t["round_id"] for path in VOTING.glob("*.json") for t in json.loads(path.read_text())["submissions"]}
    season_track_count = len(catalog)
    for path in sorted(VOTING.glob("*.json")):
        data = json.loads(path.read_text())
        pid, name = data["player"]["id"], data["player"]["name"]
        # The exact player display name is safe to match even if not separately
        # entered in player_identities (Jimmy's short display name is one case).
        aliases[pid].add(normalize_sender(name))
        votes_all = data["votes_cast"]
        votes = [v for v in votes_all if v["song"]["player_id"] != pid]
        self_votes = len(votes_all) - len(votes)
        by_round = collections.defaultdict(list)
        for vote in votes:
            by_round[vote["round_id"]].append(vote)
        # Midrank maps a player's observed votes within each round to [0,1].
        # It is descriptive, not an independent preference event or prediction.
        for group in by_round.values():
            for v in group:
                points = v["points"]
                v["within_round_midrank"] = (sum(w["points"] < points for w in group) + .5 * sum(w["points"] == points for w in group)) / len(group)
        top = sorted(votes, key=lambda v: (-v["within_round_midrank"], -v["points"], v["id"]))[:6]
        bottom = sorted(votes, key=lambda v: (v["within_round_midrank"], v["points"], v["id"]))[:6]
        subs = data["submissions"]
        chat = [r for r in rows if normalize_sender(r[1]) in aliases[pid]]
        chat_music = [r for r in chat if MUSIC.search(r[2])]
        posted_links = [v for v in links if normalize_sender(v["trigger_message"]["sender"]) in aliases[pid]]
        summary, direct_ids = NOTES[pid]
        distinct_rounds = len(by_round)
        vote_comments = sum(bool(v["comment"].strip()) for v in votes)
        nonself_counts = {"negative": sum(v["points"] < 0 for v in votes), "zero": sum(v["points"] == 0 for v in votes), "positive": sum(v["points"] > 0 for v in votes)}
        unobserved_other_songs = season_track_count - len(subs) - len(votes)
        missing_rounds = sorted(completed_round_ids - set(by_round))
        positive_duration = [catalog[v["spotify_uri"]]["spotify_duration_seconds"] for v in votes if v["points"] > 0]
        negative_duration = [catalog[v["spotify_uri"]]["spotify_duration_seconds"] for v in votes if v["points"] < 0]
        positive_album_year = [int(catalog[v["spotify_uri"]]["spotify_album_release_date"][:4]) for v in votes if v["points"] > 0]
        negative_album_year = [int(catalog[v["spotify_uri"]]["spotify_album_release_date"][:4]) for v in votes if v["points"] < 0]
        artist_genre_coverage = sum(any(a["artist_genres"] for a in catalog[v["spotify_uri"]]["spotify_artists"]) for v in votes)
        def local_values(key: str, sign: str, *, lyrics_only: bool = False) -> list[float]:
            selected = [v for v in votes if (v["points"] > 0 if sign == "positive" else v["points"] < 0)]
            return [value for v in selected
                    if (not lyrics_only or catalog[v["spotify_uri"]]["local_metadata"]["has_lyrics"] == 1)
                    if (value := catalog[v["spotify_uri"]]["local_metadata"][key]) is not None]
        metrics = {}
        for key, lyrics_only in [("spotify_popularity", False), ("playcount", False), ("word_count", True), ("bpm", False), ("energy", False)]:
            pos, neg = local_values(key, "positive", lyrics_only=lyrics_only), local_values(key, "negative", lyrics_only=lyrics_only)
            metrics[key] = {"positive_n": len(pos), "negative_n": len(neg),
                            "positive_median": statistics.median(pos) if pos else None,
                            "negative_median": statistics.median(neg) if neg else None}
        def metric_text(key: str, label: str) -> str:
            m = metrics[key]
            def fmt(value: float | None) -> str:
                return "n/a" if value is None else f"{value:,.1f}".removesuffix(".0")
            return f"{label}: positive median {fmt(m['positive_median'])} (n={m['positive_n']}), negative median {fmt(m['negative_median'])} (n={m['negative_n']})"
        out = [f"# {name} — provisional Season 1 taste profile", "", summary, "", "## Measured evidence", "",
               f"- **Profile confidence:** {CONFIDENCE[pid]}. This grades the historical description, not a final-round prediction.",
               f"- **Votes cast on others:** {len(votes)} across {distinct_rounds} rounds; {nonself_counts['positive']} positive, {nonself_counts['zero']} recorded zero, {nonself_counts['negative']} negative. {self_votes} self-vote record(s) excluded from taste calculations.",
               f"- **Missingness:** {unobserved_other_songs} other players' season submissions have no vote row from this player; absent votes are not zeros or dislikes. Completed rounds without a recorded nonself vote: {', '.join(str(r) for r in missing_rounds) if missing_rounds else 'none'}.",
               f"- **Vote comments:** {vote_comments}/{len(votes)} nonempty. Comments explain their attached vote; they are not extra observations.",
               f"- **Submissions:** {len(subs)} across {len(set(s['round_id'] for s in subs))} themed rounds; {sum(bool(s['comment'].strip()) for s in subs)} have submission comments. Theme-constrained submissions are weaker genre evidence than voluntary music posts.",
               f"- **Catalog completeness among voted songs:** {sum(v['song']['duration_s'] is not None for v in votes)}/{len(votes)} have duration; {sum(v['song']['release_date'] is not None for v in votes)}/{len(votes)} have release date; {sum(bool(v['song']['lastfm_tags']) for v in votes)}/{len(votes)} have raw Last.fm tags. Tags are not verified genres.",
               f"- **Spotify metadata, descriptive only:** duration for {len(votes)}/{len(votes)} voted tracks; median duration {statistics.median(positive_duration):.0f} s among {len(positive_duration)} positive votes versus {statistics.median(negative_duration):.0f} s among {len(negative_duration)} negatives. Median **album** year {statistics.median(positive_album_year):.0f} positive versus {statistics.median(negative_album_year):.0f} negative. Artist-level genre labels exist for {artist_genre_coverage}/{len(votes)} vote records. Album dates do not establish original song release years, and these comparisons are confounded by round themes.",
               f"- **Other track descriptors:** {metric_text('word_count', 'Lyric words')} (only tracks with lyrics); {metric_text('bpm', 'BPM')}; {metric_text('energy', 'analyzed energy')}. BPM and energy cover only a subset, so they should not drive a prediction alone.",
               f"- **Familiarity proxies:** {metric_text('spotify_popularity', 'Spotify popularity')}; {metric_text('playcount', 'Last.fm playcount')}. These are track-level catalog measures, not evidence that the player knew a song or favored popularity itself.",
               f"- **WhatsApp participation audit:** {len(chat)} messages under mapped sender names in the Boarz chat; {len(chat_music)} have a broad music-word match, and {len(posted_links)} collected link incidents were posted by this player. The match count is a review queue, not a sentiment count. Chat aliases from `player_identities` (plus exact display name): {', '.join(sorted(aliases[pid]))}.",
               "", "## Recorded high preferences", "",
               "Ranked by within-player, within-round point midrank; ties then use raw points. A vote's context and comment can qualify its meaning.", "",
               "| Vote | Track | Round midrank | Comment |", "| --- | --- | ---: | --- |"]
        for v in top:
            out.append(f"| [{v['points']:+}](../voting/players/{path.name}) · ID {v['id']} | {compact(v['song']['artists'] + ' — ' + v['song']['title'], 75)} | {v['within_round_midrank']:.2f} | {compact(v['comment'])} |")
        out += ["", "## Recorded low preferences", "", "| Vote | Track | Round midrank | Comment |", "| --- | --- | ---: | --- |"]
        for v in bottom:
            out.append(f"| [{v['points']:+}](../voting/players/{path.name}) · ID {v['id']} | {compact(v['song']['artists'] + ' — ' + v['song']['title'], 75)} | {v['within_round_midrank']:.2f} | {compact(v['comment'])} |")
        out += ["", "## Submitted songs", ""]
        for s in subs:
            out.append(f"- {s['artists']} — {s['title']} (round {s['round_id']}; submission {s['id']})" + (f" — {compact(s['comment'], 120)}" if s['comment'].strip() else ""))
        out += ["", "## Direct WhatsApp statements reviewed", ""]
        if direct_ids:
            for mid in direct_ids:
                row = by_id.get(mid)
                if row and normalize_sender(row[1]) in aliases[pid]:
                    out.append(f"- {row[3]} · message `{mid}`: “{compact(row[2], 300)}”")
        else:
            out.append("- No unambiguous, specific genre or artist preference statement selected from the season chat in this provisional pass. The music-word audit and link incidents still require contextual review.")
        out += ["", "## Prediction status", "", "Provisional. A candidate-specific score needs confirmed candidate metadata, de-duplicated WhatsApp incident sentiment, and a comparison to these documented votes. No candidate ranking is asserted here.", ""]
        (HERE / path.with_suffix('.md').name).write_text("\n".join(out))
        structured = {
            "schema_version": 1, "status": "provisional", "player": data["player"],
            "taste_summary": summary,
            "profile_confidence": CONFIDENCE[pid],
            "vote_evidence": {"other_song_votes": len(votes), "rounds": distinct_rounds, "unobserved_other_song_votes": unobserved_other_songs, "completed_rounds_without_nonself_votes": missing_rounds, "self_votes_excluded": self_votes, "vote_counts": nonself_counts, "comments": vote_comments, "top_vote_ids": [v["id"] for v in top], "bottom_vote_ids": [v["id"] for v in bottom]},
            "submission_evidence": {"count": len(subs), "submission_ids": [s["id"] for s in subs]},
            "metadata_evidence": {"spotify_duration_coverage": len(votes), "positive_duration_median_s": statistics.median(positive_duration), "negative_duration_median_s": statistics.median(negative_duration), "positive_album_year_median": statistics.median(positive_album_year), "negative_album_year_median": statistics.median(negative_album_year), "artist_genre_vote_coverage": artist_genre_coverage, "original_song_year_coverage": 0, "descriptor_contrasts": metrics},
            "whatsapp_audit": {"alias_source": "player_identities: league_id=5, identity_type=whatsapp; exact player display name", "mapped_aliases": sorted(aliases[pid]), "messages": len(chat), "music_word_matches": len(chat_music), "link_incidents_posted": len(posted_links), "reviewed_direct_statement_ids": [mid for mid in direct_ids if mid in by_id]},
            "limitations": ["Chat reactions have not yet been assigned uniquely to incidents.", "Music-word matches are candidates, not sentiment.", "Theme-constrained choices and album dates do not establish stable genre or original-era preferences."],
        }
        (HERE / path.with_suffix('.json').name).write_text(json.dumps(structured, indent=2, ensure_ascii=False) + "\n")
    conn.close()

if __name__ == "__main__":
    main()
