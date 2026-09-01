#!/usr/bin/env python3
"""
behavior.py — the things you can measure about how someone occupies a chat,
as opposed to how they write.

Deliberately statistical. An LLM asked "who does the group defer to?" will
produce a confident answer from vibes; these numbers can disagree with it, and
when they do that disagreement is worth more than either alone.

  share            how much of the room's air they take
  hours            when they post (their local rhythm)
  burst            messages fired in a row without anyone else speaking
  reply_latency    median seconds before someone responds to them
  ignored          share of their messages nobody answers within 10 minutes
  killed           threads that die after they speak (nobody for 30+ min)
  starts           conversations they open after a long silence
  addressed_by     who says their name, and how often
  addresses        whose names they say
"""
from __future__ import annotations
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

import corpus

GAP_DEAD = 30 * 60      # silence that counts as a thread dying
GAP_START = 45 * 60     # silence before a message counts as opening one
IGNORED = 10 * 60

# what people actually call each other in this chat
NICKS = {
    "Matt Mariani":   ["mashew", "matt", "mariani", "mm"],
    "Jon Black":      ["jon", "jb", "black", "blackie"],
    "Conor Johnston": ["conor", "connor", "cjwookie", "wookie", "cj"],
    "Grant Koziol":   ["grant", "kozh", "koz", "koziol"],
    "Dave Jensen":    ["jensen", "dave", "djensen", "jensown"],
    "Shane Farkas":   ["shane", "farkas"],
    "Jimmy":          ["jimmy", "jimothy", "jt", "troy"],
    "Clements Johnson": ["clements", "clammy", "clem", "clem-clem"],
    "Dave Steingart": ["steiny", "steingart", "steinbonche"],
    "Darren Paletz":  ["darren", "paletz", "pallets"],
}


def ts(s: str) -> float:
    s = (s or "").replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return 0.0
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


def analyse():
    chat = sorted((m for m in corpus.load() if m.kind == "chat"), key=lambda m: ts(m.ts))
    t = [ts(m.ts) for m in chat]
    n = len(chat)
    total = Counter(m.player for m in chat)

    stats = {p: defaultdict(float) for p in total}
    for p in stats:
        stats[p]["hours"] = Counter()
        stats[p]["addressed_by"] = Counter()
        stats[p]["addresses"] = Counter()

    pat = {p: re.compile(r"\b(" + "|".join(map(re.escape, ns)) + r")\b", re.I)
           for p, ns in NICKS.items()}

    burst = 1
    for i, m in enumerate(chat):
        s = stats[m.player]
        s["n"] += 1
        s["hours"][datetime.fromtimestamp(t[i], timezone.utc).hour] += 1

        if i and chat[i - 1].player == m.player:
            burst += 1
        else:
            if i:
                stats[chat[i - 1].player]["burst_sum"] += burst
                stats[chat[i - 1].player]["burst_n"] += 1
            burst = 1

        if i and t[i] - t[i - 1] > GAP_START:
            s["starts"] += 1

        # who replies to them, how fast, and whether anyone does
        nxt = next((j for j in range(i + 1, n) if chat[j].player != m.player), None)
        if nxt is None or t[nxt] - t[i] > IGNORED:
            s["ignored"] += 1
        else:
            s["lat_sum"] += t[nxt] - t[i]
            s["lat_n"] += 1
        if i + 1 == n or t[i + 1] - t[i] > GAP_DEAD:
            s["killed"] += 1

        for other, rx in pat.items():
            if other != m.player and rx.search(m.text):
                s["addresses"][other] += 1
                stats[other]["addressed_by"][m.player] += 1

    out = {}
    for p, s in stats.items():
        if s["n"] < 50:
            continue
        out[p] = {
            "messages": int(s["n"]),
            "share_pct": round(100 * s["n"] / n, 1),
            "avg_burst": round(s["burst_sum"] / max(1, s["burst_n"]), 2),
            "median_reply_s": round(s["lat_sum"] / max(1, s["lat_n"])),
            "ignored_pct": round(100 * s["ignored"] / s["n"], 1),
            "killed_pct": round(100 * s["killed"] / s["n"], 1),
            "starts": int(s["starts"]),
            "peak_hours_utc": [h for h, _ in s["hours"].most_common(3)],
            "addressed_by": dict(s["addressed_by"].most_common(4)),
            "addresses": dict(s["addresses"].most_common(4)),
        }
    return out


if __name__ == "__main__":
    r = analyse()
    print(f"{'player':18s}{'msgs':>6s}{'share':>7s}{'burst':>7s}{'replyS':>8s}{'ignored':>9s}{'killed':>8s}{'starts':>8s}")
    for p, s in sorted(r.items(), key=lambda kv: -kv[1]["share_pct"]):
        print(f"{p:18s}{s['messages']:6d}{s['share_pct']:6.1f}%{s['avg_burst']:7.2f}"
              f"{s['median_reply_s']:8d}{s['ignored_pct']:8.1f}%{s['killed_pct']:7.1f}%{s['starts']:8d}")
    print("\nwho says whose name (top targets):")
    for p, s in sorted(r.items(), key=lambda kv: -kv[1]["share_pct"]):
        print(f"  {p:18s} says → {s['addresses']}")
    print("\nwho gets named by whom:")
    for p, s in sorted(r.items(), key=lambda kv: -kv[1]["share_pct"]):
        print(f"  {p:18s} named by ← {s['addressed_by']}")
