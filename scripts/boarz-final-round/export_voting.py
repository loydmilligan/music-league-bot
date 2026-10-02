#!/usr/bin/env python3
"""Read-only, source-faithful Boarz Season 1 voting evidence export."""

import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data/boarz-final-round-analysis/voting"
DB = ROOT / "data/league.db"
SEASON_ID = 10


def rows(db, query, params=()):
    return [dict(row) for row in db.execute(query, params)]


def save(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
db.row_factory = sqlite3.Row

rounds = rows(db, """
    SELECT id, ml_round_id, name, description, created_at,
           submission_deadline, voting_deadline
      FROM rounds WHERE season_id=? ORDER BY created_at, id
""", (SEASON_ID,))
round_by_id = {r["id"]: r for r in rounds}

submissions = rows(db, """
    SELECT s.id, s.round_id, s.competitor_id, c.ml_competitor_id,
           COALESCE(s.player_id,c.player_id) AS player_id,
           c.name AS competitor_name, p.name AS player_name,
           s.spotify_uri, s.title, s.artists, s.album, s.comment,
           s.created_at, s.visible_to_voters,
           pop.tags AS lastfm_tags_json, pop.popularity_source,
           af.duration_s, af.bpm, af.energy
      FROM ml_submissions s JOIN rounds r ON r.id=s.round_id
      LEFT JOIN competitors c ON c.id=s.competitor_id
      LEFT JOIN players p ON p.id=COALESCE(s.player_id,c.player_id)
      LEFT JOIN song_popularity pop ON pop.spotify_uri=s.spotify_uri
      LEFT JOIN song_audio_features af ON af.spotify_uri=s.spotify_uri
     WHERE r.season_id=? ORDER BY r.created_at,s.id
""", (SEASON_ID,))

song_by_key = {}
for s in submissions:
    s["round_name"] = round_by_id[s["round_id"]]["name"]
    try:
        s["lastfm_tags"] = json.loads(s.pop("lastfm_tags_json") or "[]")
    except json.JSONDecodeError:
        s["lastfm_tags"] = []
    s["release_date"] = None
    s["release_year"] = None
    s["votes_received"] = []
    song_by_key[(s["round_id"], s["spotify_uri"])] = s

votes = rows(db, """
    SELECT v.id, v.round_id, v.voter_id, c.ml_competitor_id AS voter_ml_competitor_id,
           COALESCE(v.player_id,c.player_id) AS voter_player_id,
           c.name AS voter_competitor_name, p.name AS voter_player_name,
           v.spotify_uri, v.points, v.comment, v.created_at
      FROM votes v JOIN rounds r ON r.id=v.round_id
      LEFT JOIN competitors c ON c.id=v.voter_id
      LEFT JOIN players p ON p.id=COALESCE(v.player_id,c.player_id)
     WHERE r.season_id=? ORDER BY r.created_at,v.id
""", (SEASON_ID,))
for v in votes:
    v["round_name"] = round_by_id[v["round_id"]]["name"]
    s = song_by_key.get((v["round_id"], v["spotify_uri"]))
    v["song"] = ({k: s[k] for k in (
        "id", "title", "artists", "album", "competitor_id", "competitor_name",
        "player_id", "player_name", "lastfm_tags", "duration_s", "release_date",
        "release_year")}) if s else None
    if s:
        s["votes_received"].append({k: v[k] for k in (
            "id", "voter_id", "voter_ml_competitor_id", "voter_player_id",
            "voter_player_name", "points", "comment", "created_at")})

player_ids = sorted({s["player_id"] for s in submissions if s["player_id"] is not None}
                    | {v["voter_player_id"] for v in votes if v["voter_player_id"] is not None})
players = {r["id"]: r for r in rows(db,
    "SELECT id,name FROM players WHERE id IN (" + ",".join("?" * len(player_ids)) + ")", player_ids)}
manifest = []
for player_id in player_ids:
    own_subs = [s for s in submissions if s["player_id"] == player_id]
    cast = [v for v in votes if v["voter_player_id"] == player_id]
    counts = Counter("downvote" if v["points"] < 0 else
                     "zero" if v["points"] == 0 else "positive" for v in cast)
    name = players[player_id]["name"]
    file = f"players/{player_id:03d}-{slug(name)}.json"
    obj = {
        "schema_version": 1,
        "source": {"database": str(DB), "tables": ["leagues", "seasons", "rounds",
            "players", "competitors", "ml_submissions", "votes", "song_popularity",
            "song_audio_features"], "season_id": SEASON_ID},
        "player": {"id": player_id, "name": name},
        "summary": {
            "submissions": len(own_subs), "votes_cast": len(cast),
            "positive_votes": counts["positive"], "downvotes": counts["downvote"],
            "explicit_zero_votes": counts["zero"],
            "points_given_net": sum(v["points"] for v in cast),
            "vote_comments_nonempty": sum(bool((v["comment"] or "").strip()) for v in cast),
            "submission_comments_nonempty": sum(bool((s["comment"] or "").strip()) for s in own_subs),
            "received_points_net": sum(v["points"] for s in own_subs for v in s["votes_received"]),
            "received_vote_records": sum(len(s["votes_received"]) for s in own_subs),
        },
        "submissions": own_subs,
        "votes_cast": cast,
    }
    save(OUT / file, obj)
    manifest.append({"player_id": player_id, "name": name, "file": file,
                     "summary": obj["summary"]})

save(OUT / "index.json", {
    "schema_version": 1, "season_id": SEASON_ID,
    "rounds": rounds,
    "players": manifest,
    "counts": {"rounds_with_votes": len({v["round_id"] for v in votes}),
               "rounds_total": len(rounds), "submissions": len(submissions),
               "vote_records": len(votes), "players": len(manifest)},
    "metadata_coverage": {
        "submissions_with_nonempty_tags": sum(bool(s["lastfm_tags"]) for s in submissions),
        "submissions_with_duration": sum(s["duration_s"] is not None for s in submissions),
        "submissions_with_release_date": 0,
    },
})
print(json.dumps({"players": len(manifest), "rounds": len(rounds),
                  "submissions": len(submissions), "votes": len(votes)}, indent=2))
