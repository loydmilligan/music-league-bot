#!/usr/bin/env python3
"""Extract music discussion outside previously captured song-link windows.

Reads the chat database and link incidents; writes a remaining-corpus JSONL
and one context-rich JSON file per remaining music-keyword hit. No LLM claims
or sentiment are inferred at this stage.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


GROUP = "Boarz II Men - Music Leagueing https way"
DEFAULT_DB = Path("data/league.db")
DEFAULT_ROOT = Path("data/boarz-final-round-analysis/whatsapp")

# Deliberately broad recall. Ambiguous words require a music companion phrase;
# reviewers can later reject false positives using the saved exact text/context.
TERMS = {
    "song": r"\bsongs?\b",
    "music": r"\bmusic(?:al)?\b",
    "album": r"\balbums?\b",
    "playlist": r"\bplaylists?\b",
    "genre": r"\bgenres?\b",
    "artist": r"\bartists?\b",
    "band": r"\bbands?\b",
    "singer": r"\bsingers?\b",
    "vocal": r"\bvocals?|vocalist\b",
    "lyrics": r"\blyrics?|lyrical\b",
    "chorus": r"\bchorus(?:es)?\b",
    "verse": r"\bverses?\b",
    "hook": r"\bhooks?\b",
    "melody": r"\bmelod(?:y|ies|ic)\b",
    "rhythm": r"\brhyth(?:m|mic)\b",
    "beat": r"\bbeats?\b",
    "instrument": r"\binstruments?|instrumental\b",
    "guitar": r"\bguitars?|guitarist\b",
    "drums": r"\bdrums?|drummer\b",
    "bass": r"\bbass(?:line|ist)?\b",
    "piano": r"\bpiano|pianist\b",
    "synth": r"\bsynth(?:s|esizer)?\b",
    "concert": r"\bconcerts?\b",
    "live_music": r"\blive (?:show|performance|set|music|gig)\b",
    "gig": r"\bgigs?\b",
    "record": r"\brecord(?:ing|ed|s)?\b",
    "single": r"\bsingles?\b",
    "cover_song": r"\bcovers? (?:song|version|of|by)\b",
    "remix": r"\bremix(?:es|ed)?\b",
    "sample": r"\bsampl(?:e|ed|ing)\b",
    "dj": r"\bDJs?\b",
    "spotify": r"\bspotify\b",
    "youtube_music": r"\byoutube music\b",
    "soundcloud": r"\bsoundcloud\b",
    "apple_music": r"\bapple music\b",
    "music_league": r"\bmusic league\b",
    "listen": r"\blisten(?:ing|ed|s)?\b",
    "stream": r"\bstream(?:ing|ed|s)?\b",
    "headphones": r"\bheadphones?|earbuds?\b",
    "radio": r"\bradio\b",
    "audiophile": r"\baudiophil(?:e|es)\b",
    "disco": r"\bdisco\b",
    "funk": r"\bfunk(?:y)?\b",
    "soul": r"\bsoul (?:music|song|track|singer|band|artist)\b",
    "jazz": r"\bjazz\b",
    "blues": r"\bblues\b",
    "rock": r"\brock (?:music|song|track|band|artist|album|and roll)\b",
    "punk": r"\bpunk\b",
    "metal": r"\bmetal (?:music|song|track|band|artist|album)\b",
    "hiphop": r"\bhip[ -]?hop\b",
    "rap": r"\brap(?:per|pers|ping)?\b",
    "country": r"\bcountry (?:music|song|track|band|artist|album)\b",
    "folk": r"\bfolk (?:music|song|track|band|artist|album)\b",
    "indie": r"\bindie\b",
    "pop_music": r"\bpop (?:music|song|track|band|artist|album)\b",
    "electronic": r"\belectronic (?:music|song|track|band|artist|album)\b",
    "edm": r"\bEDM\b",
    "reggae": r"\breggae\b",
    "classical": r"\bclassical (?:music|song|track|piece|composer)\b",
    "submission": r"\bsubmi(?:t|tted|ssion|ssions)\b",
    "voting": r"\bvotes?|voting|downvotes?\b",
    "round_theme": r"\bround(?:'s)? theme|theme (?:song|round|pick)\b",
    "track": r"\btracks?\b",
    "tune": r"\btunes?\b",
    "banger": r"\bbangers?\b",
    "jam": r"\bjams?\b",
    "bop": r"\bbops?\b",
}
PATTERNS = {name: re.compile(expr, re.IGNORECASE) for name, expr in TERMS.items()}


def read_messages(db_path: Path) -> list[dict]:
    connection = sqlite3.connect(f"file:{db_path.resolve()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            "SELECT * FROM chat_messages WHERE group_name = ?", (GROUP,)
        ).fetchall()
    finally:
        connection.close()
    rows = sorted(rows, key=lambda row: (
        datetime.fromisoformat(row["ts"].replace("Z", "+00:00")).astimezone(timezone.utc),
        row["id"],
    ))
    return [dict(row, message_id=row["id"], corpus_index=index)
            for index, row in enumerate(rows)]


def linked_message_ids(incident_dir: Path) -> tuple[set[str], int]:
    if not incident_dir.is_dir():
        raise FileNotFoundError(f"Link incidents are required first: {incident_dir}")
    ids: set[str] = set()
    files = sorted(incident_dir.glob("*.json"))
    if not files:
        raise ValueError(f"No link incident JSON files found: {incident_dir}")
    for path in files:
        incident = json.loads(path.read_text())
        for field in ("trigger_message", "context_before", "context_after"):
            value = incident.get(field, [])
            for message in value if isinstance(value, list) else [value]:
                if message:
                    ids.add(message["message_id"])
    return ids, len(files)


def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return result[:48] or "unknown"


def build(root: Path, db_path: Path) -> dict:
    messages = read_messages(db_path)
    excluded_ids, link_incident_count = linked_message_ids(root / "link-incidents")
    source_ids = {m["message_id"] for m in messages}
    unknown_ids = excluded_ids - source_ids
    if unknown_ids:
        raise ValueError(f"{len(unknown_ids)} link-window IDs absent from corpus")
    remaining = [m for m in messages if m["message_id"] not in excluded_ids]
    root.mkdir(parents=True, exist_ok=True)
    with (root / "remaining-corpus.jsonl").open("w") as handle:
        for message in remaining:
            handle.write(json.dumps(message, ensure_ascii=False) + "\n")

    output_dir = root / "nonlink-incidents"
    output_dir.mkdir(exist_ok=True)
    term_counts: Counter[str] = Counter()
    incidents = []
    for index, message in enumerate(remaining):
        matches = [name for name, pattern in PATTERNS.items()
                   if pattern.search(message["text"] or "")]
        if not matches:
            continue
        term_counts.update(matches)
        name = f"{message['ts'].replace(':', '').replace('-', '')[:15]}_{slug(message['sender'])}_{message['message_id'][:8]}.json"
        incident = {
            "schema_version": 1,
            "incident_id": f"nonlink:{message['message_id']}",
            "incident_type": "music_keyword",
            "source": {"database": str(db_path), "table": "chat_messages", "group_name": GROUP,
                       "order": "parsed_utc_ts,id", "remaining_corpus_index": index,
                       "exclusion_source": str(root / "link-incidents")},
            "matched_terms": matches,
            "trigger_message": message,
            "context_before": remaining[max(0, index - 10):index],
            "context_after": remaining[index + 1:index + 11],
            "analysis": None,
        }
        (output_dir / name).write_text(json.dumps(incident, ensure_ascii=False, indent=2) + "\n")
        incidents.append({"incident_id": incident["incident_id"], "path": str(output_dir / name),
                          "message_id": message["message_id"], "matched_terms": matches})
    manifest = {
        "schema_version": 1,
        "source_database": str(db_path),
        "group_name": GROUP,
        "total_corpus_messages": len(messages),
        "link_incident_files": link_incident_count,
        "unique_link_window_messages_excluded": len(excluded_ids),
        "remaining_corpus_messages": len(remaining),
        "nonlink_incident_count": len(incidents),
        "term_counts": dict(term_counts.most_common()),
        "incidents": incidents,
    }
    (root / "nonlink-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    result = build(args.root, args.db)
    print(json.dumps({key: result[key] for key in (
        "total_corpus_messages", "link_incident_files", "unique_link_window_messages_excluded",
        "remaining_corpus_messages", "nonlink_incident_count")}, indent=2))


if __name__ == "__main__":
    main()
