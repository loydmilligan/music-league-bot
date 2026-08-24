from conftest import add_msg, add_round


def test_fixture_db_has_league(fixture_db):
    row = fixture_db.execute("SELECT slug FROM leagues WHERE id=1").fetchone()
    assert row["slug"] == "test-league"


def test_helpers_insert_rows(fixture_db):
    add_round(fixture_db, 1, "2026-01-08T07:00:00Z")
    add_msg(fixture_db, "Alice", "hello", "2026-01-02T19:00:00Z")
    assert fixture_db.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0] == 1
    assert fixture_db.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 1
