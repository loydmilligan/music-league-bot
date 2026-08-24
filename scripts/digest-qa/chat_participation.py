#!/usr/bin/env python3
"""Chat-participation metric for the Digest Quality Program (crude v1).

The digest's behavioral goal is nudging league engagement; the first tracked
metric is WhatsApp/chat participation per round window. This computes, per
completed round of a league's current season:

  - total chat messages in the round window
  - active chatters (roster players with >=1 message) / roster size
  - vote comments and submission comments (the other participation surfaces)

and a season per-player table (chat msgs, rounds active, vote comments,
submission comments) — the baseline against which "did mentioning Philip more
move Philip?" gets answered later.

Round window = (previous round's voting_deadline, this round's voting_deadline].
The first round's window opens at its submission_deadline minus 7 days.
Relay truncation artifacts (same sender+timestamp, shorter text) are deduped.

Usage: python3 scripts/digest-qa/chat_participation.py <league-slug> [--db data/league.db]
"""
import argparse, sqlite3
from collections import defaultdict
from datetime import datetime, timedelta

import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import league_context as lc

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("league_slug")
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--season", type=int, help="season id (default: current = max for league)")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    league_id = lc.league_id_for(db, args.league_slug)
    season = args.season or lc.current_season(db, league_id)
    group = lc.chat_group_for(db, args.league_slug)
    resolve = lc.identity_resolver(db, league_id)
    msgs = sorted((ts, resolve(sender)) for ts, sender, _ in lc.deduped_messages(db, group))

    rounds = db.execute(
        """SELECT id, name, submission_deadline, voting_deadline FROM rounds
           WHERE season_id=? AND voting_deadline IS NOT NULL ORDER BY voting_deadline""",
        (season,)).fetchall()
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"# Chat participation — {args.league_slug} (season {season})")
    print(f"group: {group} · messages mapped: {len(msgs)}\n")
    print("| round | window (UTC) | msgs | active/roster | rate | vote comments | sub comments |")
    print("|---|---|---|---|---|---|---|")

    season_player = defaultdict(lambda: [0, 0, 0, 0])  # msgs, rounds-active, vote comments, sub comments
    prev_deadline = None
    for rid, name, sub_dl, vote_dl in rounds:
        vote_dl = lc.iso(vote_dl)
        if vote_dl > now:
            break
        start = prev_deadline or (
            (datetime.fromisoformat(lc.iso(sub_dl).rstrip("Z")) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
            if sub_dl else vote_dl[:10] + "T00:00:00Z")
        window = [(ts, p) for ts, p in msgs if start < ts <= vote_dl]
        prev_deadline = vote_dl

        roster = {r[0] for r in db.execute(
            """SELECT DISTINCT p.name FROM votes v JOIN players p ON v.player_id=p.id WHERE v.round_id=?
               UNION SELECT p.name FROM ml_submissions s JOIN players p ON s.player_id=p.id WHERE s.round_id=?""",
            (rid, rid))}
        counts = defaultdict(int)
        for _, p in window:
            counts[p] += 1
        active = {p for p in counts if p in roster}
        vc = db.execute(
            "SELECT COUNT(*) FROM votes WHERE round_id=? AND comment IS NOT NULL AND comment!=''",
            (rid,)).fetchone()[0]
        sc = db.execute(
            "SELECT COUNT(*) FROM ml_submissions WHERE round_id=? AND comment IS NOT NULL AND comment!=''",
            (rid,)).fetchone()[0]
        rate = f"{len(active)/len(roster)*100:.0f}%" if roster else "—"
        print(f"| {name} | {start[:10]} → {vote_dl[:10]} | {len(window)} | {len(active)}/{len(roster)} | {rate} | {vc} | {sc} |")

        for p in roster:
            season_player[p][0] += counts.get(p, 0)
            season_player[p][1] += 1 if counts.get(p) else 0
        for (pname,) in db.execute(
            """SELECT p.name FROM votes v JOIN players p ON v.player_id=p.id
               WHERE v.round_id=? AND v.comment IS NOT NULL AND v.comment!=''""", (rid,)):
            season_player[pname][2] += 1
        for (pname,) in db.execute(
            """SELECT p.name FROM ml_submissions s JOIN players p ON s.player_id=p.id
               WHERE s.round_id=? AND s.comment IS NOT NULL AND s.comment!=''""", (rid,)):
            season_player[pname][3] += 1

    n_rounds = sum(1 for *_, v in rounds if lc.iso(v) <= now)
    print(f"\n## Per-player, season to date ({n_rounds} completed rounds)\n")
    print("| player | chat msgs | rounds active in chat | vote comments | sub comments |")
    print("|---|---|---|---|---|")
    for p, (m, ra, vc, sc) in sorted(season_player.items(), key=lambda x: -x[1][0]):
        print(f"| {p} | {m} | {ra}/{n_rounds} | {vc} | {sc} |")

if __name__ == "__main__":
    main()
