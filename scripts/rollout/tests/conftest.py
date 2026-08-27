"""Fixture DB for the host executor.

Mirrors only the rollout tables plus the two lookup tables the executor reads.
Never opens data/league.db — that is production data.
"""
import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SCHEMA = """
CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT);
CREATE TABLE rollout_runs (
  id TEXT PRIMARY KEY, league_id INTEGER, round_id INTEGER, definition_json TEXT,
  state TEXT, current_ep INTEGER, resume_token TEXT, review_url TEXT, error TEXT,
  started_at TEXT, updated_at TEXT, finished_at TEXT);
CREATE TABLE rollout_cut_runs (
  run_id TEXT, cut_id TEXT, ep INTEGER, runtime TEXT, state TEXT,
  attempts INTEGER DEFAULT 0, remasters INTEGER DEFAULT 0, check_passed INTEGER,
  awaiting_classification INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT, heartbeat_at TEXT, output_json TEXT, error TEXT,
  started_at TEXT, finished_at TEXT, PRIMARY KEY (run_id, cut_id));
"""

ROLLOUT = {
    "order": ["a", "b", "agent"],
    "cuts": {
        "a": {"kind": "script", "runtime": "host", "label": "A",
              "command": ["echo", "{roundId}"], "check": {"rule": "exit-zero"}},
        "b": {"kind": "script", "runtime": "host", "label": "B", "command": ["true"]},
        "agent": {"kind": "agent", "runtime": "host", "label": "Agent", "job": "punchup"},
    },
    "skipAfter": {"b": True},
    "covers": [],
}


@pytest.fixture
def db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO leagues (id, slug, name) VALUES (1, 'sb', 'Second Best')")
    conn.execute("INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)")
    conn.execute("INSERT INTO rounds (id, season_id, name) VALUES (9, 1, 'R9')")
    conn.commit()
    return conn


@pytest.fixture
def run(db):
    import json
    db.execute(
        "INSERT INTO rollout_runs (id, league_id, round_id, definition_json, state,"
        " current_ep, started_at, updated_at) VALUES ('r1', 1, 9, ?, 'running', 0, 't', 't')",
        (json.dumps(ROLLOUT),))
    for cut_id, ep in [("a", 0), ("b", 0), ("agent", 1)]:
        db.execute(
            "INSERT INTO rollout_cut_runs (run_id, cut_id, ep, runtime, state)"
            " VALUES ('r1', ?, ?, 'host', 'pending')", (cut_id, ep))
    db.commit()
    return "r1"
