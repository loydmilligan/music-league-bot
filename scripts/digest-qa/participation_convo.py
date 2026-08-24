#!/usr/bin/env python3
"""Conversation dimensions: bursts, elicited response, temporal overlap.

WhatsApp quote-replies are NOT available to us -- GroupRelay reads Android
notifications, whose payload carries no reply-to. So "conversation" is inferred
from timing and sender interleaving. See spec section 3 and 5.4.

INVARIANT: callers pass one group's messages. A burst must never span groups.
"""
import re
from collections import defaultdict
from datetime import datetime, timedelta

LOCAL_OFFSET_HOURS = 7
ELICIT_WINDOW_MIN = 10   # they answered within this
ELICIT_QUIET_MIN = 30    # ...having been silent for this


def _dt(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "")[:19])


def _local_hour(ts: str) -> int:
    return (_dt(ts) - timedelta(hours=LOCAL_OFFSET_HOURS)).hour


def bursts(msgs, gap_minutes: int = 30) -> list[list[tuple]]:
    """Split a single group's messages into runs separated by group silence."""
    out: list[list[tuple]] = []
    cur: list[tuple] = []
    prev: datetime | None = None
    for m in sorted(msgs):
        t = _dt(m[0])
        if prev is not None and (t - prev) > timedelta(minutes=gap_minutes):
            out.append(cur)
            cur = []
        cur.append(m)
        prev = t
    if cur:
        out.append(cur)
    return out


def peak_hours_for(msgs, coverage: float = 0.75) -> set[int]:
    """Smallest set of local hours holding `coverage` of this league's traffic."""
    counts: dict[int, int] = defaultdict(int)
    for ts, _s, _t in msgs:
        counts[_local_hour(ts)] += 1
    total = sum(counts.values())
    if not total:
        return set()
    peaks: set[int] = set()
    acc = 0
    for h, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        peaks.add(h)
        acc += n
        if acc >= total * coverage:
            break
    return peaks


def _mention_targets(text: str, roster) -> list[str]:
    """@mentions use WhatsApp's FSI/PDI wrappers; fall back to bare names."""
    hits = []
    for name in roster or []:
        first = name.split()[0]
        if re.search(r"@[⁨\s]*" + re.escape(first), text):
            hits.append(name)
        elif re.search(r"(?<![\w])" + re.escape(first) + r"(?![\w])", text):
            hits.append(name)
    return hits


def convo_dims(msgs, window_start: str, window_end: str,
               peak_hours: set[int], roster=None) -> dict[str, dict]:
    """Spec 5.4. msgs is (ts, resolved_sender, text) for ONE group."""
    win = [m for m in sorted(msgs) if window_start <= m[0] < window_end]
    out: dict[str, dict] = defaultdict(
        lambda: {"bursts_joined": 0, "group_discussions_joined": 0, "elicited": 0,
                 "mentions_made": 0, "mentions_received": 0,
                 "temporal_overlap": 0.0, "share_off_peak": 0.0})

    for b in bursts(win):
        senders = {m[1] for m in b}
        if len(senders) < 2:
            continue
        for s in senders:
            out[s]["bursts_joined"] += 1
            if len(senders) >= 3:
                out[s]["group_discussions_joined"] += 1

    for i, (ts, sender, _text) in enumerate(win):
        t = _dt(ts)
        for ts2, sender2, _t2 in win[i + 1:]:
            t2 = _dt(ts2)
            if (t2 - t) > timedelta(minutes=ELICIT_WINDOW_MIN):
                break
            if sender2 == sender:
                continue
            was_quiet = not any(
                s3 == sender2 and timedelta(0) < (t - _dt(ts3)) <= timedelta(minutes=ELICIT_QUIET_MIN)
                for ts3, s3, _ in win[:i]
            )
            if was_quiet:
                out[sender]["elicited"] += 1
                break

    if roster:
        for _ts, sender, text in win:
            for target in _mention_targets(text, roster):
                if target == sender:
                    continue
                out[sender]["mentions_made"] += 1
                out[target]["mentions_received"] += 1

    per_sender: dict[str, list] = defaultdict(list)
    for ts, sender, _t in win:
        per_sender[sender].append(_local_hour(ts))
    for sender, hs in per_sender.items():
        inpeak = sum(1 for h in hs if h in peak_hours)
        out[sender]["temporal_overlap"] = round(inpeak / len(hs), 4)
        out[sender]["share_off_peak"] = round(1 - inpeak / len(hs), 4)

    return dict(out)
