#!/usr/bin/env python3
"""Export source-faithful Boarz WhatsApp music-link incidents from league.db."""

import argparse
import hashlib
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[2]
GROUP = "Boarz II Men - Music Leagueing https way"
URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
MUSIC_HOSTS = {"open.spotify.com", "spotify.link", "music.youtube.com", "youtu.be",
               "youtube.com", "www.youtube.com", "m.youtube.com", "www.soundcloud.com",
               "soundcloud.com", "bandcamp.com", "music.apple.com"}


def iso_sort_key(row):
    return (datetime.fromisoformat(row["ts"].replace("Z", "+00:00")), row["id"])


def message(row, index):
    return {"message_id": row["id"], "corpus_index": index,
            "timestamp": row["ts"], "sender": row["sender"],
            "sender_handle": row["sender_handle"], "group_key": row["group_key"],
            "text": row["text"],
            "source_path": row["source_path"], "captured_at": row["captured_at"],
            "message_hash": row["msg_hash"]}


def classify(url):
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host not in MUSIC_HOSTS:
        return None
    parts = [p for p in parsed.path.split("/") if p]
    if host == "open.spotify.com":
        if parts and parts[0].startswith("intl-"):
            parts = parts[1:]
        if not parts or parts[0] not in {"track", "album", "playlist", "episode", "show", "artist"}:
            return None
        if parts[0] in {"episode", "show", "artist"}:
            return None
        kind, identifier = parts[0], parts[1] if len(parts) > 1 else None
        return {"platform": "spotify", "resource_type": kind,
                "resource_id": identifier, "canonical_key": f"spotify:{kind}:{identifier}"}
    if host == "spotify.link":
        return {"platform": "spotify", "resource_type": "short_link_unresolved",
                "resource_id": None, "canonical_key": url}
    if host in {"youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if "playlist" in parsed.path or ("list" in parse_qs(parsed.query) and "v" not in parse_qs(parsed.query)):
            identifier = parse_qs(parsed.query).get("list", [None])[0]
            kind = "playlist"
        elif host == "youtu.be":
            identifier = parts[0] if parts else None
            kind = "video"
        elif parts and parts[0] in {"shorts", "live"}:
            identifier = parts[1] if len(parts) > 1 else None
            kind = "video"
        else:
            identifier = parse_qs(parsed.query).get("v", [None])[0]
            kind = "video"
        if not identifier:
            return None
        return {"platform": "youtube_music" if host == "music.youtube.com" else "youtube",
                "resource_type": kind, "resource_id": identifier,
                "canonical_key": f"youtube:{kind}:{identifier}"}
    return {"platform": host, "resource_type": "music_link_unresolved",
            "resource_id": None, "canonical_key": url}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:32] or "unknown"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=ROOT / "data/league.db")
    parser.add_argument("--out", type=Path, default=ROOT / "data/boarz-final-round-analysis/whatsapp")
    args = parser.parse_args()
    out = args.out / "link-incidents"
    out.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"file:{args.db}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute("""SELECT id, ts, sender, sender_handle, group_key, text, source_path,
                                  captured_at, msg_hash FROM chat_messages
                             WHERE platform='whatsapp' AND group_name=?""", (GROUP,)).fetchall()
        known_songs = {}
        for r in db.execute("SELECT spotify_uri,title,artist,album,year,duration_sec FROM chat_songs"):
            known_songs[r["spotify_uri"]] = {"title": r["title"], "artist": r["artist"],
                "album": r["album"], "release_year": r["year"], "duration_seconds": r["duration_sec"],
                "source_table": "chat_songs"}
        for r in db.execute("SELECT spotify_uri,title,artists,album FROM ml_submissions"):
            known_songs.setdefault(r["spotify_uri"], {"title": r["title"], "artist": r["artists"],
                "album": r["album"], "release_year": None, "duration_seconds": None,
                "source_table": "ml_submissions"})
    rows = sorted(rows, key=iso_sort_key)
    all_urls = 0
    incidents = []
    recent = {}
    for index, row in enumerate(rows):
        # Relay reaction text quotes the original message, including its URL.
        if row["text"].startswith("Reacted "):
            continue
        for raw_url in URL_RE.findall(row["text"]):
            all_urls += 1
            url = raw_url.rstrip(".,;:!?)]}’”")
            classification = classify(url)
            if not classification:
                continue
            key = classification["canonical_key"]
            digest = hashlib.sha256(f"{row['id']}|{url}".encode()).hexdigest()[:12]
            timestamp = iso_sort_key(row)[0].strftime("%Y%m%dT%H%M%SZ")
            filename = f"{timestamp}_{slug(row['sender'])}_{slug(classification['platform'])}_{slug(classification['resource_id'] or 'link')}_{digest}.json"
            preview = re.match(r"^🔗\s*(.*?)\s*\|", row["text"])
            possible_duplicate = None
            if key in recent:
                old_ts, old_id = recent[key]
                if (iso_sort_key(row)[0] - old_ts).total_seconds() <= 120:
                    possible_duplicate = old_id
            incident_id = f"wa-link-{digest}"
            recent[key] = (iso_sort_key(row)[0], incident_id)
            context_before = [message(rows[index - 1], index - 1)] if index else []
            context_after = [message(rows[j], j) for j in range(index + 1, min(len(rows), index + 11))]
            incident = {
                "schema_version": 1, "incident_id": incident_id,
                "incident_type": "music_link", "song_identity_status":
                    "track_link" if classification["resource_type"] == "track" else
                    "collection_link" if classification["resource_type"] == "playlist" else
                    "album_link" if classification["resource_type"] == "album" else
                    "video_music_unverified",
                "link": {"url": url, **classification, "preview_title": preview.group(1).strip() if preview else None,
                         "known_song_metadata": known_songs.get("spotify:track:" + classification["resource_id"])
                         if classification["platform"] == "spotify" and classification["resource_type"] == "track" else None},
                "trigger_message": message(row, index),
                "context_before": context_before, "context_after": context_after,
                "possible_duplicate_of": possible_duplicate,
                "provenance": {"database": str(args.db), "table": "chat_messages",
                               "group_name": GROUP, "sort": "timestamp instant, message ID",
                               "context_rule": "one preceding and ten following corpus messages"},
                "signal": None,
            }
            (out / filename).write_text(json.dumps(incident, ensure_ascii=False, indent=2) + "\n")
            incidents.append({"incident_id": incident_id, "file": f"link-incidents/{filename}",
                              "trigger_message_id": row["id"], "corpus_index": index,
                              "canonical_key": key, "possible_duplicate_of": possible_duplicate})
    manifest = {"schema_version": 1, "source_database": str(args.db), "group_name": GROUP,
                "message_count": len(rows), "first_timestamp": rows[0]["ts"] if rows else None,
                "last_timestamp": rows[-1]["ts"] if rows else None,
                "all_url_occurrences": all_urls, "link_incident_count": len(incidents),
                "resource_type_counts": dict(Counter(i["canonical_key"].split(":")[1] if ":" in i["canonical_key"] else "other" for i in incidents)),
                "incidents": incidents}
    (args.out / "link-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(rows)} messages; {all_urls} URLs; {len(incidents)} music link incidents; {sum(bool(i['possible_duplicate_of']) for i in incidents)} near duplicates")


if __name__ == "__main__":
    main()
