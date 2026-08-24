from conftest import add_msg, add_round, add_vote
import participation as P


def _seed(db):
    # compute_round bridges chat names to ballots via competitors.player_id,
    # which the shared fixture schema predates -- add it here.
    db.execute("ALTER TABLE competitors ADD COLUMN player_id INTEGER")
    db.execute("INSERT INTO competitors (id, name, player_id) VALUES (1,'Alice',1)")
    db.execute("INSERT INTO players VALUES (1,'Alice')")
    db.execute("INSERT INTO player_identities (id,player_id,league_id,identity_type,identifier)"
               " VALUES (1,1,1,'whatsapp','Alice')")
    add_round(db, 1, "2026-01-08T07:00:00Z")
    add_round(db, 2, "2026-01-15T07:00:00Z")
    add_msg(db, "Alice", "hello", "2026-01-10T19:00:00Z")
    add_vote(db, 2, 1, "uri:a", 3, "nice")


def test_backfill_writes_a_row_per_round_with_activity(fixture_db):
    _seed(fixture_db)
    P.ensure_schema(fixture_db)
    n = P.backfill(fixture_db, "test-league")
    assert n >= 1
    assert P.load_vectors(fixture_db, 1, 2)[1]["vote_comments"] == 1


def test_backfill_is_idempotent(fixture_db):
    _seed(fixture_db)
    P.ensure_schema(fixture_db)
    first = P.backfill(fixture_db, "test-league")
    second = P.backfill(fixture_db, "test-league")
    assert first == second
    rows = fixture_db.execute("SELECT COUNT(*) FROM player_participation").fetchone()[0]
    assert rows == first
