import pytest
from participation_score import WEIGHTS, composite, percentile_among_active


def _vec(**kw):
    from participation import VECTOR_FIELDS
    v = {f: 0 for f in VECTOR_FIELDS}
    v["temporal_overlap"] = 1.0
    v.update(kw)
    return v


def test_weights_cover_only_known_fields():
    from participation import VECTOR_FIELDS
    assert set(WEIGHTS) <= set(VECTOR_FIELDS)


def test_kind_counts_carry_no_weight():
    for f in ("music_links", "media", "other_links"):
        assert WEIGHTS.get(f, 0) == 0


def test_composite_scales_each_input_to_the_round_max():
    maxima = {"msgs": 100, "days_active": 7}
    hi = composite(_vec(msgs=100, days_active=7), maxima)
    lo = composite(_vec(msgs=50, days_active=7), maxima)
    assert hi > lo


def test_zero_vector_scores_zero():
    assert composite(_vec(), {"msgs": 10}) == 0


def test_off_peak_poster_is_not_penalised_on_burst_terms():
    maxima = {"bursts_joined": 4}
    on_peak = _vec(bursts_joined=2, temporal_overlap=1.0)
    off_peak = _vec(bursts_joined=1, temporal_overlap=0.5)
    # half the presence, half the opportunity -> same credit
    assert composite(on_peak, maxima) == pytest.approx(composite(off_peak, maxima))


def test_percentile_among_active_ranks_within_the_round():
    p = percentile_among_active({1: 10.0, 2: 20.0, 3: 30.0})
    assert p[3] == 100.0
    assert p[1] == pytest.approx(33.33, abs=0.1)


def test_percentile_handles_a_single_player():
    assert percentile_among_active({1: 5.0}) == {1: 100.0}
