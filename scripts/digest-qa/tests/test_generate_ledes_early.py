"""Task 9: the real lede run consumes the early sheet and editor notes.

Both artifacts carry their caveats IN THE PROMPT (spec §5) — the risk being
managed is the model over-weighting a provisional artifact, and UI copy does
not manage that. gather() must also tolerate a DB predating the prep-panel
tables (digest_early_ledes / round_notes).
"""
import json
import sqlite3

import generate_ledes as gl


def base_material(**over):
    m = {"round_id": 149, "round_name": "R", "league_name": "L", "round_desc": "",
         "rulecard": "", "songs": [], "non_voters": [], "vote_comments": [],
         "sub_comments": [], "chat": [], "bridge": None, "early": None, "notes": [],
         "window": ("a", "b"), "slug": "bz", "song_by_uri": {}}
    m.update(over)
    return m


def test_build_prompt_says_no_early_sheet_when_absent():
    p = gl.build_prompt(base_material())
    assert "no early lede sheet" in p.lower()


def test_build_prompt_includes_early_sheet_with_its_caveat():
    early = json.dumps({"ledes": [{"title": "The Mandolin Question"}],
                        "ratings": {"a": "love"}})
    p = gl.build_prompt(base_material(early=early))
    assert "The Mandolin Question" in p
    assert "without votes" in p.lower()
    assert "supersede" in p.lower()


def test_build_prompt_wraps_notes_in_the_editorial_envelope():
    p = gl.build_prompt(base_material(notes=[{"body": "the mandolin thing"}]))
    assert "the mandolin thing" in p
    assert "not a quotable source" in p.lower()
    assert "do not attribute" in p.lower()


def test_gather_tolerates_missing_tables(tmp_path):
    """An old DB without digest_early_ledes or round_notes must still work."""
    # gather() also reads ml_submissions/players/votes/settings unconditionally,
    # so those exist here; only the two new prep-panel tables are absent.
    conn = sqlite3.connect(tmp_path / "x.db")
    conn.executescript(
        "CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);"
        "CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER);"
        "CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT,"
        "  description TEXT, voting_deadline TEXT);"
        "CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);"
        "CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER,"
        "  player_id INTEGER, spotify_uri TEXT, title TEXT, artists TEXT, comment TEXT);"
        "CREATE TABLE votes (id INTEGER PRIMARY KEY, round_id INTEGER,"
        "  player_id INTEGER, spotify_uri TEXT, points INTEGER, comment TEXT);"
        "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);"
        "INSERT INTO leagues VALUES (1,'bz','Boarz');"
        "INSERT INTO seasons VALUES (1,1);"
        "INSERT INTO rounds VALUES (149,1,'R','', '2026-08-27T06:30:00Z');"
        "INSERT INTO settings VALUES ('chat_league_group_map','{}');")
    conn.commit()
    m = gl.gather(conn, 149)
    assert m["early"] is None
    assert m["notes"] == []
