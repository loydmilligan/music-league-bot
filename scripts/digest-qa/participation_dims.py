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
