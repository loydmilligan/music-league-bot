from conftest import add_vote
from participation_dims import ballot_dims


def _seed(db):
    db.execute("INSERT INTO competitors VALUES (1,'Tommy')")
    db.execute("INSERT INTO competitors VALUES (2,'Sarah Z')")
    db.execute("INSERT INTO competitors VALUES (3,'Quiet Quinto')")
    db.execute(
        "INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, comment, created_at)"
        " VALUES (1, 7, 1, 'uri:a', 'A', 'X', 'a long submission comment', '2026-01-01')")
    add_vote(db, 7, 1, "uri:b", 3, "a" * 100)
    add_vote(db, 7, 1, "uri:c", 1, "b" * 25)
    add_vote(db, 7, 2, "uri:a", 2, "short")
    add_vote(db, 7, 2, "uri:c", 0, "")


def test_counts_comments_and_chars(fixture_db):
    _seed(fixture_db)
    d = ballot_dims(fixture_db, 7)
    assert d[1]["vote_comments"] == 2
    assert d[1]["vote_comment_chars"] == 125
    assert d[2]["vote_comments"] == 1


def test_empty_comment_is_not_counted(fixture_db):
    _seed(fixture_db)
    assert ballot_dims(fixture_db, 7)[2]["vote_comment_chars"] == 5


def test_voted_and_submitted_flags(fixture_db):
    _seed(fixture_db)
    d = ballot_dims(fixture_db, 7)
    assert d[1]["voted"] == 1 and d[1]["submitted"] == 1
    assert d[2]["voted"] == 1 and d[2]["submitted"] == 0


def test_submission_comment_chars(fixture_db):
    _seed(fixture_db)
    assert ballot_dims(fixture_db, 7)[1]["sub_comment_chars"] == len("a long submission comment")


def test_non_participant_absent_from_result(fixture_db):
    _seed(fixture_db)
    assert 3 not in ballot_dims(fixture_db, 7)
