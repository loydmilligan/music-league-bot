#!/usr/bin/env python3
"""Snapshot Spotify metadata for Boarz Season 1 submitted track URIs.

This reads the voting evidence export and writes a separate catalog. It never
modifies the music-league-bot database or the per-player evidence files.
"""

import base64
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
VOTING = ROOT / "data/boarz-final-round-analysis/voting/players"
OUTPUT = ROOT / "data/boarz-final-round-analysis/voting/song-catalog.json"
CANDIDATE_IMPORT = ROOT / "data/boarz-final-round-analysis/candidate-import.json"
CANDIDATE_OUTPUT = ROOT / "data/boarz-final-round-analysis/candidate-song-catalog.json"


def credentials():
    found = {
        "SPOTIFY_CLIENT_ID": os.environ.get("SPOTIFY_CLIENT_ID"),
        "SPOTIFY_CLIENT_SECRET": os.environ.get("SPOTIFY_CLIENT_SECRET"),
    }
    if all(found.values()):
        return found
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith(("SPOTIFY_CLIENT_ID=", "SPOTIFY_CLIENT_SECRET=")):
            key, value = line.split("=", 1)
            found[key] = found[key] or value.strip().strip('"').strip("'")
    if not all(found.values()):
        raise RuntimeError("Spotify client credentials unavailable")
    return found


def request_json(url, token=None, body=None, auth=None):
    headers = {"Content-Type": "application/x-www-form-urlencoded"} if body else {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if auth:
        headers["Authorization"] = "Basic " + auth
    for attempt in range(4):
        try:
            with urlopen(Request(url, data=body, headers=headers), timeout=30) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code != 429 or attempt == 3:
                raise
            time.sleep(min(int(exc.headers.get("Retry-After", "2")), 30))


def batches(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def main():
    source = {}
    for path in sorted(VOTING.glob("*.json")):
        player = json.loads(path.read_text())
        for song in player["submissions"]:
            source[song["spotify_uri"]] = {
                "submission_id": song["id"],
                "source_title": song["title"],
                "source_artists": song["artists"],
                "source_album": song["album"],
                "source_duration_seconds": song["duration_s"],
                "lastfm_tags": song["lastfm_tags"],
            }
    candidates = json.loads(CANDIDATE_IMPORT.read_text())["songs"] if CANDIDATE_IMPORT.exists() else []
    all_uris = set(source) | {song["spotify_uri"] for song in candidates}
    with sqlite3.connect(f"file:{ROOT / 'data/league.db'}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        local_metadata = {}
        for uri in all_uris:
            row = db.execute("""
                SELECT sp.spotify_popularity, sp.listeners, sp.playcount,
                       sp.popularity_proxy, sp.tags AS lastfm_tags_json,
                       lm.has_lyrics, lm.word_count, lm.line_count,
                       af.bpm, af.energy, af.key AS musical_key, af.scale,
                       af.duration_s AS analyzed_duration_seconds,
                       cs.year AS chat_song_year, cs.duration_sec AS chat_song_duration_seconds,
                       ss.year AS shortlist_year, ss.duration_sec AS shortlist_duration_seconds
                  FROM (SELECT ? AS spotify_uri) song
                  LEFT JOIN song_popularity sp ON sp.spotify_uri = song.spotify_uri
                  LEFT JOIN song_lyrics_metrics lm ON lm.spotify_uri = song.spotify_uri
                  LEFT JOIN song_audio_features af ON af.spotify_uri = song.spotify_uri
                  LEFT JOIN chat_songs cs ON cs.spotify_uri = song.spotify_uri
                  LEFT JOIN shortlist_songs ss ON ss.spotify_uri = song.spotify_uri
            """, (uri,)).fetchone()
            local_metadata[uri] = dict(row)
    ids = sorted(uri.rsplit(":", 1)[-1] for uri in all_uris if uri.startswith("spotify:track:"))
    creds = credentials()
    auth = base64.b64encode((creds["SPOTIFY_CLIENT_ID"] + ":" + creds["SPOTIFY_CLIENT_SECRET"]).encode()).decode()
    token = request_json("https://accounts.spotify.com/api/token", body=urlencode({"grant_type": "client_credentials"}).encode(), auth=auth)["access_token"]
    tracks = {}
    artist_ids = set()
    for batch in batches(ids, 50):
        payload = request_json("https://api.spotify.com/v1/tracks?" + urlencode({"ids": ",".join(batch)}), token=token)
        for track in payload.get("tracks", []):
            if track:
                tracks[track["id"]] = track
                artist_ids.update(artist["id"] for artist in track["artists"] if artist.get("id"))
    artists = {}
    for batch in batches(sorted(artist_ids), 50):
        payload = request_json("https://api.spotify.com/v1/artists?" + urlencode({"ids": ",".join(batch)}), token=token)
        artists.update((artist["id"], artist) for artist in payload.get("artists", []) if artist)
    records = []
    for uri, original in sorted(source.items()):
        track = tracks.get(uri.rsplit(":", 1)[-1])
        album = track.get("album", {}) if track else {}
        records.append({
            "spotify_uri": uri,
            **original,
            "spotify_track_name": track.get("name") if track else None,
            "spotify_duration_seconds": round(track["duration_ms"] / 1000, 3) if track else None,
            "spotify_album_name": album.get("name"),
            "spotify_album_release_date": album.get("release_date"),
            "spotify_album_release_date_precision": album.get("release_date_precision"),
            "original_song_release_date": None,
            "spotify_artists": [
                {"id": artist["id"], "name": artist["name"],
                 "artist_genres": artists.get(artist["id"], {}).get("genres", [])}
                for artist in track["artists"]
            ] if track else [],
            "metadata_status": "matched" if track else "unmatched",
            "local_metadata": local_metadata[uri],
        })
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "schema_version": 1,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source": "Spotify Web API track and artist endpoints; voting/players/*.json",
        "date_warning": "Album release date is not necessarily the original song release date; artist genres are not track genres.",
        "track_count": len(records),
        "matched_count": sum(item["metadata_status"] == "matched" for item in records),
        "tracks": records,
    }, ensure_ascii=False, indent=2) + "\n")
    candidate_records = []
    for candidate in candidates:
        uri = candidate["spotify_uri"]
        track = tracks.get(uri.rsplit(":", 1)[-1])
        album = track.get("album", {}) if track else {}
        candidate_records.append({
            **candidate,
            "spotify_track_name": track.get("name") if track else None,
            "spotify_duration_seconds": round(track["duration_ms"] / 1000, 3) if track else None,
            "spotify_album_name": album.get("name"),
            "spotify_album_release_date": album.get("release_date"),
            "spotify_album_release_date_precision": album.get("release_date_precision"),
            "spotify_popularity": track.get("popularity") if track else None,
            "spotify_artists": [
                {"id": artist["id"], "name": artist["name"],
                 "artist_genres": artists.get(artist["id"], {}).get("genres", [])}
                for artist in track["artists"]
            ] if track else [],
            "local_metadata": local_metadata[uri],
            "metadata_status": "matched" if track else "unmatched",
        })
    if candidates:
        CANDIDATE_OUTPUT.write_text(json.dumps({
            "schema_version": 1,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "source": "candidate-import.json and Spotify Web API; local song metadata joined by URI",
            "date_warning": "Source-listed and Spotify album dates may not be original song release dates; artist genres are not track genres.",
            "track_count": len(candidate_records),
            "matched_count": sum(item["metadata_status"] == "matched" for item in candidate_records),
            "tracks": candidate_records,
        }, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(records)} historical and {len(candidate_records)} candidate tracks; wrote metadata catalogs")


if __name__ == "__main__":
    main()
