#!/usr/bin/env python3
"""Pure dimension functions for the participation vector: ballot and chat.

Each returns competitor_id -> partial vector. None of them touch the DB beyond
reading, and none of them decide anything about weighting -- these are facts.

Spec: docs/superpowers/specs/2026-08-23-participation-metric-design.md
"""
import os
import re
import sqlite3
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def ballot_dims(db: sqlite3.Connection, round_id: int) -> dict[int, dict]:
    """Spec 5.1. Anyone who voted or submitted in this round appears."""
    out: dict[int, dict] = defaultdict(
        lambda: {"voted": 0, "submitted": 0, "vote_comments": 0,
                 "vote_comment_chars": 0, "sub_comment_chars": 0})

    for cid, comment in db.execute(
        "SELECT voter_id, COALESCE(comment,'') FROM votes WHERE round_id=?", (round_id,)
    ):
        d = out[cid]
        d["voted"] = 1
        if comment.strip():
            d["vote_comments"] += 1
            d["vote_comment_chars"] += len(comment)

    for cid, comment in db.execute(
        "SELECT competitor_id, COALESCE(comment,'') FROM ml_submissions"
        " WHERE round_id=? AND competitor_id IS NOT NULL", (round_id,)
    ):
        d = out[cid]
        d["submitted"] = 1
        d["sub_comment_chars"] += len(comment)

    return dict(out)


LOCAL_OFFSET_HOURS = 7  # PDT. See spec 4: all data is within PDT.

MEDIA_MARKERS = ("\U0001F4F7", "\U0001F3A5", "\U0001F47E", "\U0001F4CA")  # photo, video, GIF, poll
MUSIC_HOSTS = ("open.spotify.com", "music.youtube.com", "youtu.be", "youtube.com")


def _local_dt(ts: str):
    from datetime import datetime, timedelta
    return datetime.fromisoformat(ts.replace("Z", "")[:19]) - timedelta(hours=LOCAL_OFFSET_HOURS)


def _kind(text: str) -> str:
    """One kind per message. Media wins, then music link, then other link."""
    if any(m in text for m in MEDIA_MARKERS):
        return "media"
    if any(h in text for h in MUSIC_HOSTS):
        return "music_links"
    if "http" in text:
        return "other_links"
    return "text"


def chat_dims(msgs, window_start: str, window_end: str) -> dict[str, dict]:
    """Spec 5.2 and 5.3. msgs is (ts, resolved_sender, text), keyed out by name."""
    out: dict[str, dict] = defaultdict(
        lambda: {"msgs": 0, "chars": 0, "days_active": 0, "music_links": 0,
                 "media": 0, "other_links": 0, "median_hour": 0, "share_off_peak": 0.0})
    days: dict[str, set] = defaultdict(set)
    hours: dict[str, list] = defaultdict(list)

    for ts, sender, text in msgs:
        if not (window_start <= ts < window_end):
            continue
        d = out[sender]
        d["msgs"] += 1
        d["chars"] += len(text)
        k = _kind(text)
        if k != "text":
            d[k] += 1
        local = _local_dt(ts)
        days[sender].add(local.date())
        hours[sender].append(local.hour)

    for sender, d in out.items():
        d["days_active"] = len(days[sender])
        hs = sorted(hours[sender])
        d["median_hour"] = hs[len(hs) // 2] if hs else 0
    return dict(out)
