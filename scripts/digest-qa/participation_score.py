#!/usr/bin/env python3
"""Composite score and within-round normalisation.

The scalar is NEVER stored. It is derived here from stored facts plus WEIGHTS,
so tuning a weight retroactively corrects the entire history rather than leaving
the series a mix of old and new opinions. Spec section 2 and 6.
"""

# Deliberately crude starting values (spec 6). Inputs are scaled to their
# within-(league, round) maximum first, so the units are commensurable.
WEIGHTS: dict[str, float] = {
    "voted": 15,
    "vote_comments": 10,
    "vote_comment_chars": 5,
    "sub_comment_chars": 5,
    "days_active": 15,
    "msgs": 8,
    "bursts_joined": 12,
    "group_discussions_joined": 15,
    "elicited": 10,
    "mentions_made": 3,
    # kind counts are character, not weight (spec 5.3)
    "music_links": 0,
    "media": 0,
    "other_links": 0,
}

# Terms whose opportunity depends on other people being present. Divided by
# temporal_overlap so an off-peak poster is not penalised for the league's
# absence (spec 5.4).
OPPORTUNITY_TERMS = {"bursts_joined", "group_discussions_joined", "elicited"}


def composite(vec: dict, maxima: dict) -> float:
    total = 0.0
    overlap = vec.get("temporal_overlap") or 0.0
    for field, weight in WEIGHTS.items():
        if not weight:
            continue
        hi = maxima.get(field) or 0
        if not hi:
            continue
        share = (vec.get(field) or 0) / hi
        if field in OPPORTUNITY_TERMS and overlap > 0:
            share = min(share / overlap, 1.0)
        total += share * weight
    return round(total, 3)


def percentile_among_active(scores: dict[int, float]) -> dict[int, float]:
    """Percentile within this round's active players. Spec 6."""
    if not scores:
        return {}
    ordered = sorted(scores.values())
    n = len(ordered)
    return {
        cid: round(sum(1 for v in ordered if v <= s) / n * 100, 2)
        for cid, s in scores.items()
    }
