from participation_convo import bursts, convo_dims, peak_hours_for

W0, W1 = "2026-01-01T00:00:00Z", "2026-01-09T00:00:00Z"


def M(sender, text, ts):
    return (ts, sender, text)


def test_gap_over_thirty_minutes_splits_a_burst():
    msgs = [
        M("A", "x", "2026-01-02T19:00:00Z"),
        M("B", "y", "2026-01-02T19:10:00Z"),
        M("A", "z", "2026-01-02T20:00:00Z"),
    ]
    assert len(bursts(msgs)) == 2


def test_exactly_thirty_minutes_stays_in_one_burst():
    msgs = [
        M("A", "x", "2026-01-02T19:00:00Z"),
        M("B", "y", "2026-01-02T19:30:00Z"),
    ]
    assert len(bursts(msgs)) == 1


def test_single_sender_run_is_not_a_conversation():
    msgs = [M("A", "x", "2026-01-02T19:00:00Z"), M("A", "y", "2026-01-02T19:05:00Z")]
    d = convo_dims(msgs, W0, W1, peak_hours={19})
    assert d["A"]["bursts_joined"] == 0


def test_two_senders_make_a_conversation_three_make_a_discussion():
    two = [M("A", "x", "2026-01-02T19:00:00Z"), M("B", "y", "2026-01-02T19:05:00Z")]
    d = convo_dims(two, W0, W1, peak_hours={19})
    assert d["A"]["bursts_joined"] == 1
    assert d["A"]["group_discussions_joined"] == 0

    three = two + [M("C", "z", "2026-01-02T19:07:00Z")]
    d = convo_dims(three, W0, W1, peak_hours={19})
    assert d["A"]["group_discussions_joined"] == 1


def test_elicited_counts_drawing_in_someone_who_was_quiet():
    msgs = [
        M("A", "anyone about?", "2026-01-02T19:00:00Z"),
        M("B", "here", "2026-01-02T19:05:00Z"),
    ]
    d = convo_dims(msgs, W0, W1, peak_hours={19})
    assert d["A"]["elicited"] == 1


def test_elicited_ignores_someone_already_talking():
    msgs = [
        M("B", "chatting", "2026-01-02T18:50:00Z"),
        M("A", "hi", "2026-01-02T19:00:00Z"),
        M("B", "still here", "2026-01-02T19:05:00Z"),
    ]
    d = convo_dims(msgs, W0, W1, peak_hours={19})
    assert d["A"]["elicited"] == 0


def test_at_mentions_are_counted_both_directions():
    msgs = [M("A", "⁨@⁩Bob nice pick", "2026-01-02T19:00:00Z")]
    d = convo_dims(msgs, W0, W1, peak_hours={19}, roster=["A", "Bob"])
    assert d["A"]["mentions_made"] == 1
    assert d["Bob"]["mentions_received"] == 1


def test_temporal_overlap_is_share_of_messages_in_peak_hours():
    msgs = [
        M("A", "x", "2026-01-02T02:00:00Z"),  # 19:00 local -- peak
        M("A", "y", "2026-01-02T16:00:00Z"),  # 09:00 local -- off peak
    ]
    d = convo_dims(msgs, W0, W1, peak_hours={19})
    assert d["A"]["temporal_overlap"] == 0.5
    assert d["A"]["share_off_peak"] == 0.5


def test_peak_hours_covers_the_requested_share():
    msgs = [M("A", "x", f"2026-01-02T{h:02d}:00:00Z") for h in (2, 2, 2, 3, 16)]
    peaks = peak_hours_for(msgs, coverage=0.75)
    assert 19 in peaks  # 02:00Z == 19:00 local


def test_bursts_never_span_groups_when_called_per_group():
    # INVARIANT (spec section 3): a burst must never span chat groups. These
    # functions receive ONE group's messages; the caller iterates per group.
    # Pooling would fabricate a two-sender "conversation" from two people who
    # were never in the same room. Processed correctly -- per group -- each run
    # has a single sender and nobody gets burst credit.
    group1 = [M("A", "x", "2026-01-02T19:00:00Z")]
    group2 = [M("B", "y", "2026-01-02T19:05:00Z")]

    pooled = convo_dims(group1 + group2, W0, W1, peak_hours={19})
    assert pooled["A"]["bursts_joined"] == 1  # the lie pooling would tell

    for grp in (group1, group2):
        d = convo_dims(grp, W0, W1, peak_hours={19})
        assert all(v["bursts_joined"] == 0 for v in d.values())
        assert all(v["elicited"] == 0 for v in d.values())
