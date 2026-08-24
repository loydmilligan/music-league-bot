from participation_dims import chat_dims

W0, W1 = "2026-01-01T07:00:00Z", "2026-01-08T07:00:00Z"


def M(sender, text, ts):
    return (ts, sender, text)


def test_counts_messages_and_chars_in_window_only():
    msgs = [
        M("Alice", "hello", "2026-01-02T19:00:00Z"),
        M("Alice", "again", "2026-01-03T19:00:00Z"),
        M("Alice", "too early", "2025-12-30T19:00:00Z"),
    ]
    d = chat_dims(msgs, W0, W1)
    assert d["Alice"]["msgs"] == 2
    assert d["Alice"]["chars"] == 10


def test_days_active_counts_distinct_local_days():
    # 2026-01-02T04:00Z is 2026-01-01 21:00 local (UTC-7) -- a DIFFERENT local day
    msgs = [
        M("Bo", "a", "2026-01-02T04:00:00Z"),
        M("Bo", "b", "2026-01-02T19:00:00Z"),
    ]
    assert chat_dims(msgs, W0, W1)["Bo"]["days_active"] == 2


def test_kind_classification_is_mutually_exclusive():
    msgs = [
        M("Cy", "check https://open.spotify.com/track/x", "2026-01-02T19:00:00Z"),
        M("Cy", "\U0001F4F7 Photo", "2026-01-02T19:01:00Z"),
        M("Cy", "see https://example.com", "2026-01-02T19:02:00Z"),
        M("Cy", "just talking", "2026-01-02T19:03:00Z"),
    ]
    d = chat_dims(msgs, W0, W1)
    assert d["Cy"]["music_links"] == 1
    assert d["Cy"]["media"] == 1
    assert d["Cy"]["other_links"] == 1
    assert d["Cy"]["msgs"] == 4


def test_media_wins_over_link_when_both_present():
    msgs = [M("Dee", "\U0001F3A5 Video https://youtu.be/x", "2026-01-02T19:00:00Z")]
    d = chat_dims(msgs, W0, W1)
    assert d["Dee"]["media"] == 1
    assert d["Dee"]["music_links"] == 0


def test_median_hour_is_local():
    msgs = [M("Eve", "x", "2026-01-02T02:00:00Z")]  # 19:00 local
    assert chat_dims(msgs, W0, W1)["Eve"]["median_hour"] == 19
