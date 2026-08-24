#!/usr/bin/env python3
"""Participation vector: storage and CLI.

Spec: docs/superpowers/specs/2026-08-23-participation-metric-design.md

Stores FACTS per (league, round, player). The composite score is deliberately
NOT stored -- it is computed on read from a weight table, so re-weighting
corrects the whole history instead of leaving it a mix of old and new opinions.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The contract between the three parallel dimension modules. Order is canonical.
VECTOR_FIELDS = [
    # ballot
    "voted", "submitted", "vote_comments", "vote_comment_chars", "sub_comment_chars",
    # chat volume
    "msgs", "chars", "days_active",
    # chat kind
    "music_links", "media", "other_links",
    # conversation
    "bursts_joined", "group_discussions_joined", "elicited",
    "mentions_made", "mentions_received", "temporal_overlap",
    # context
    "rounds_in_league", "median_hour", "share_off_peak",
]

_COLS = ",\n  ".join(f"{f} REAL NOT NULL DEFAULT 0" for f in VECTOR_FIELDS)

DDL = f"""
CREATE TABLE IF NOT EXISTS player_participation (
  league_id     INTEGER NOT NULL,
  round_id      INTEGER NOT NULL,
  competitor_id INTEGER NOT NULL,
  {_COLS},
  computed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (league_id, round_id, competitor_id)
);
"""


def ensure_schema(db: sqlite3.Connection) -> None:
    db.executescript(DDL)


def store_vector(db, league_id: int, round_id: int, competitor_id: int, vec: dict) -> None:
    cols = ", ".join(VECTOR_FIELDS)
    marks = ", ".join("?" for _ in VECTOR_FIELDS)
    updates = ", ".join(f"{f}=excluded.{f}" for f in VECTOR_FIELDS)
    db.execute(
        f"""INSERT INTO player_participation (league_id, round_id, competitor_id, {cols})
            VALUES (?, ?, ?, {marks})
            ON CONFLICT(league_id, round_id, competitor_id) DO UPDATE SET
              {updates},
              computed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')""",
        [league_id, round_id, competitor_id] + [vec.get(f, 0) for f in VECTOR_FIELDS],
    )


def load_vectors(db, league_id: int, round_id: int) -> dict[int, dict]:
    rows = db.execute(
        "SELECT * FROM player_participation WHERE league_id=? AND round_id=?",
        (league_id, round_id),
    ).fetchall()
    out = {}
    for r in rows:
        d = dict(r)
        out[d["competitor_id"]] = {f: d[f] for f in VECTOR_FIELDS}
    return out
