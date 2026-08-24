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


def compute_round(db, slug: str, round_id: int) -> dict[int, dict]:
    """Assemble the full vector for one round of one league.

    Chat dimensions key on player NAME; ballot dimensions key on competitor_id.
    The join happens here, and only here.
    """
    import league_context as lc
    import participation_dims as dims
    import participation_convo as convo

    league_id = lc.league_id_for(db, slug)
    group = lc.chat_group_for(db, slug)
    resolve = lc.identity_resolver(db, league_id)
    raw = lc.deduped_messages(db, group)
    msgs = [(ts, resolve(sender), text) for ts, sender, text in raw]

    season = db.execute("SELECT season_id FROM rounds WHERE id=?", (round_id,)).fetchone()[0]
    window = next(w for w in lc.round_windows(db, season) if w.round_id == round_id)

    peaks = convo.peak_hours_for(msgs)
    names = {n for _t, n, _x in msgs}
    chat = dims.chat_dims(msgs, window.start, window.end)
    conv = convo.convo_dims(msgs, window.start, window.end, peaks, roster=sorted(names))
    ballot = dims.ballot_dims(db, round_id)

    # Chat keys are resolved PLAYER names; competitors.name is the ML display
    # name (e.g. "missmara"), so the bridge is competitors.player_id -> players.
    comp_name = {r["id"]: r["name"] for r in db.execute(
        "SELECT c.id, p.name FROM competitors c JOIN players p ON p.id = c.player_id")}
    name_comp = {v: k for k, v in comp_name.items()}
    # One player can own two competitor rows; make this round's ballot row win.
    for cid in ballot:
        if cid in comp_name:
            name_comp[comp_name[cid]] = cid

    out: dict[int, dict] = {}
    cids = set(ballot) | {name_comp[n] for n in chat if n in name_comp}
    for cid in cids:
        vec = {f: 0 for f in VECTOR_FIELDS}
        vec.update(ballot.get(cid, {}))
        nm = comp_name.get(cid)
        if nm:
            vec.update(chat.get(nm, {}))
            vec.update(conv.get(nm, {}))
        vec["rounds_in_league"] = db.execute(
            "SELECT COUNT(*) FROM rounds r JOIN seasons s ON s.id=r.season_id"
            " WHERE s.league_id=? AND r.voting_deadline IS NOT NULL"
            " AND r.voting_deadline <= (SELECT voting_deadline FROM rounds WHERE id=?)",
            (league_id, round_id)).fetchone()[0]
        out[cid] = vec
    return out
