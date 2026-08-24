import participation as P


def test_vector_fields_are_the_agreed_contract():
    assert P.VECTOR_FIELDS == [
        "voted", "submitted", "vote_comments", "vote_comment_chars", "sub_comment_chars",
        "msgs", "chars", "days_active",
        "music_links", "media", "other_links",
        "bursts_joined", "group_discussions_joined", "elicited",
        "mentions_made", "mentions_received", "temporal_overlap",
        "rounds_in_league", "median_hour", "share_off_peak",
    ]


def test_store_and_load_roundtrip(fixture_db):
    P.ensure_schema(fixture_db)
    vec = {f: 0 for f in P.VECTOR_FIELDS}
    vec["msgs"] = 12
    vec["voted"] = 1
    P.store_vector(fixture_db, league_id=1, round_id=7, competitor_id=3, vec=vec)
    got = P.load_vectors(fixture_db, league_id=1, round_id=7)
    assert got[3]["msgs"] == 12
    assert got[3]["voted"] == 1


def test_store_is_idempotent(fixture_db):
    P.ensure_schema(fixture_db)
    vec = {f: 0 for f in P.VECTOR_FIELDS}
    vec["msgs"] = 5
    P.store_vector(fixture_db, 1, 7, 3, vec)
    vec["msgs"] = 9
    P.store_vector(fixture_db, 1, 7, 3, vec)
    got = P.load_vectors(fixture_db, 1, 7)
    assert len(got) == 1
    assert got[3]["msgs"] == 9


def test_two_leagues_keep_independent_rows(fixture_db):
    P.ensure_schema(fixture_db)
    vec = {f: 0 for f in P.VECTOR_FIELDS}
    vec["msgs"] = 100
    P.store_vector(fixture_db, league_id=1, round_id=7, competitor_id=3, vec=vec)
    vec["msgs"] = 4
    P.store_vector(fixture_db, league_id=2, round_id=7, competitor_id=3, vec=vec)
    assert P.load_vectors(fixture_db, 1, 7)[3]["msgs"] == 100
    assert P.load_vectors(fixture_db, 2, 7)[3]["msgs"] == 4
