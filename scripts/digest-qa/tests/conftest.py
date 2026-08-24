"""Fixture DB for the digest-qa Python tools.

Only the tables these tools read are created. Kept deliberately small: a test
that needs a column should add it here rather than reaching for the real
data/league.db, which is production data and must never be opened by a test.
"""
import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SCHEMA = """
CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, digest_mode TEXT);
CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT,
                     submission_deadline TEXT, voting_deadline TEXT);
CREATE TABLE competitors (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE player_identities (id INTEGER PRIMARY KEY, player_id INTEGER,
                     league_id INTEGER, identity_type TEXT, identifier TEXT);
CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER,
                     competitor_id INTEGER, spotify_uri TEXT, title TEXT,
                     artists TEXT, comment TEXT, created_at TEXT);
CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER, voter_id INTEGER,
                     spotify_uri TEXT, points INTEGER, comment TEXT);
CREATE TABLE chat_messages (id TEXT PRIMARY KEY, platform TEXT, group_name TEXT,
                     group_key TEXT, sender TEXT, text TEXT, ts TEXT,
                     msg_hash TEXT, captured_at TEXT, sender_handle TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
"""


@pytest.fixture
def fixture_db():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    db.execute("INSERT INTO leagues VALUES (1,'test-league','Test League','hil')")
    db.execute("INSERT INTO seasons VALUES (10,1,1)")
    db.execute(
        "INSERT INTO settings VALUES ('chat_league_group_map', ?)",
        ('{"test-league": "Test Group"}',),
    )
    yield db
    db.close()


def add_msg(db, sender, text, ts, group="Test Group"):
    """Insert one chat message. `ts` is an ISO string ending in Z."""
    n = db.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0]
    db.execute(
        "INSERT INTO chat_messages (id, platform, group_name, sender, text, ts, msg_hash, captured_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (f"m{n}", "whatsapp", group, sender, text, ts, f"h{n}", ts),
    )


def add_round(db, round_id, voting_deadline, season_id=10, name="R"):
    db.execute(
        "INSERT INTO rounds (id, season_id, name, submission_deadline, voting_deadline)"
        " VALUES (?,?,?,?,?)",
        (round_id, season_id, name, None, voting_deadline),
    )


def add_vote(db, round_id, voter_id, uri, points, comment=""):
    n = db.execute("SELECT COUNT(*) FROM votes").fetchone()[0]
    db.execute(
        "INSERT INTO votes (id, round_id, voter_id, spotify_uri, points, comment) VALUES (?,?,?,?,?,?)",
        (n, round_id, voter_id, uri, points, comment),
    )
