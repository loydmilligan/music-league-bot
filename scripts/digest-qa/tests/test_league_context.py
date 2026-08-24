from conftest import add_msg, add_round
import league_context as lc


def test_norm_sender_strips_push_prefix():
    assert lc.norm_sender("~ Conor J") == "Conor J"
    assert lc.norm_sender("Matt Mariani") == "Matt Mariani"


def test_iso_normalises_offset_to_z():
    assert lc.iso("2026-05-06T22:17:00+00:00") == "2026-05-06T22:17:00Z"


def test_league_and_group_lookup(fixture_db):
    assert lc.league_id_for(fixture_db, "test-league") == 1
    assert lc.chat_group_for(fixture_db, "test-league") == "Test Group"


def test_identity_resolver_maps_push_name_to_player(fixture_db):
    fixture_db.execute("INSERT INTO players VALUES (5,'Sarah Black')")
    fixture_db.execute(
        "INSERT INTO player_identities (id,player_id,league_id,identity_type,identifier)"
        " VALUES (1,5,1,'whatsapp','~ Sarah')")
    resolve = lc.identity_resolver(fixture_db, 1)
    assert resolve("~ Sarah") == "Sarah Black"
    assert resolve("Sarah") == "Sarah Black"
    assert resolve("Nobody") == "Nobody"


def test_deduped_messages_keeps_longest_of_a_truncation_pair(fixture_db):
    add_msg(fixture_db, "Alice", "the full message text", "2026-01-02T19:00:00Z")
    add_msg(fixture_db, "Alice", "the full mess", "2026-01-02T19:00:00Z")
    msgs = lc.deduped_messages(fixture_db, "Test Group")
    assert len(msgs) == 1
    assert msgs[0][2] == "the full message text"


def test_round_windows_chain_deadline_to_deadline(fixture_db):
    add_round(fixture_db, 1, "2026-01-08T07:00:00Z")
    add_round(fixture_db, 2, "2026-01-15T07:00:00Z")
    w = lc.round_windows(fixture_db, 10)
    assert len(w) == 2
    assert w[1].start == "2026-01-08T07:00:00Z"
    assert w[1].end == "2026-01-15T07:00:00Z"


def test_first_round_window_falls_back_to_seven_days(fixture_db):
    add_round(fixture_db, 1, "2026-01-08T07:00:00Z")
    w = lc.round_windows(fixture_db, 10)
    assert w[0].start == "2026-01-01T07:00:00Z"


def test_deduped_messages_drops_mention_notification_rows(fixture_db):
    add_msg(fixture_db, "Mentioned all", "@everyone", "2026-01-02T19:00:00Z")
    add_msg(fixture_db, "Alice", "hi", "2026-01-02T19:01:00Z")
    msgs = lc.deduped_messages(fixture_db, "Test Group")
    assert [m[1] for m in msgs] == ["Alice"]


def test_deduped_messages_drops_corrupted_sender_twin(fixture_db):
    add_msg(fixture_db, "~ JB", "you get your vote in yet?", "2026-01-02T19:00:00Z")
    add_msg(fixture_db, "~���JB", "you get your vote in yet?", "2026-01-02T19:00:00Z")
    msgs = lc.deduped_messages(fixture_db, "Test Group")
    assert len(msgs) == 1
    assert msgs[0][1] == "~ JB"


def test_deduped_messages_keeps_corrupted_sender_without_twin(fixture_db):
    add_msg(fixture_db, "~���JB", "no clean copy exists", "2026-01-02T19:00:00Z")
    assert len(lc.deduped_messages(fixture_db, "Test Group")) == 1


def test_deduped_messages_drops_undelivered_placeholder_rows(fixture_db):
    add_msg(fixture_db, "Alice", "Waiting for this message. This may take a while.",
            "2026-01-02T19:00:00Z")
    add_msg(fixture_db, "Alice", "real content", "2026-01-02T19:01:00Z")
    msgs = lc.deduped_messages(fixture_db, "Test Group")
    assert [m[2] for m in msgs] == ["real content"]
