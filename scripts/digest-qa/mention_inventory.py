#!/usr/bin/env python3
"""Per-player mention inventory for a round's digest draft (F7 / WS9 ledger).

Counts how many times each roster player is named anywhere in the draft
(sections + stats/guesser slots), so mention balance is visible before
send (R139: BP/Philip at 1 mention while the Blacks got 25+) and, with
--store, becomes a time series (WS9: join round-N mentions against
round-N+1 participation).

Names counted: competitor names, plus digest aliases from the league
rulecards (mirrored in verify_facts.RULES).

Usage:
  python3 scripts/digest-qa/mention_inventory.py <round-id> [--db data/league.db]
      [--floor 2] [--store] [--json]

--floor N  warn for active players (submitted or voted this round) below N.
--store    upsert into digest_mentions (round_id, competitor_id, mentions).
"""
import argparse, json, re, sqlite3, sys
from collections import defaultdict

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from verify_facts import RULES, norm_text  # noqa: E402


def draft_text(db, round_id):
    draft = db.execute(
        "SELECT id, stats_content_json, guesser_content_json FROM digest_drafts "
        "WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1", (round_id,)).fetchone()
    if not draft:
        sys.exit(f"no digest draft for round {round_id}")
    parts = [row["content_json"] or "" for row in db.execute(
        "SELECT content_json FROM digest_sections WHERE draft_id = ?", (draft["id"],))]
    parts += [draft["stats_content_json"] or "", draft["guesser_content_json"] or ""]
    return norm_text(" ".join(parts))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("round_id", type=int)
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--floor", type=int, default=2)
    ap.add_argument("--store", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    rnd = db.execute(
        """SELECT r.id, r.season_id, l.slug FROM rounds r
           JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
           WHERE r.id = ?""", (args.round_id,)).fetchone()
    if not rnd:
        sys.exit(f"round {args.round_id} not found")

    text = draft_text(db, args.round_id).lower()
    aliases = RULES.get(rnd["slug"], {}).get("aliases", {})

    # Roster = every competitor who submitted or voted anywhere this season.
    roster = {r["id"]: r["name"] for r in db.execute(
        """SELECT DISTINCT c.id, c.name FROM competitors c
           WHERE c.id IN (SELECT competitor_id FROM ml_submissions WHERE round_id IN
                            (SELECT id FROM rounds WHERE season_id = ?))
              OR c.id IN (SELECT voter_id FROM votes WHERE round_id IN
                            (SELECT id FROM rounds WHERE season_id = ?))""",
        (rnd["season_id"], rnd["season_id"]))}
    active = {r["competitor_id"] for r in db.execute(
        "SELECT competitor_id FROM ml_submissions WHERE round_id = ? AND competitor_id IS NOT NULL",
        (args.round_id,))}
    active |= {r["voter_id"] for r in db.execute(
        "SELECT voter_id FROM votes WHERE round_id = ?", (args.round_id,))}

    counts = {}
    for cid, name in roster.items():
        variants = {name} | {a for a, canon in aliases.items() if canon.lower() == name.lower()}
        variants |= {canon for a, canon in aliases.items() if a.lower() == name.lower()}
        # First names only when reasonably distinctive (>3 chars, unique in roster).
        first = name.split()[0]
        firsts = [n.split()[0].lower() for n in roster.values()]
        if len(first) > 3 and firsts.count(first.lower()) == 1:
            variants.add(first)
        n = 0
        for v in variants:
            # norm_text folds curly quotes/dashes so "Voltron’s YoungLion" (the
            # stored competitor name) matches "Voltron's YoungLion" in prose.
            n += len(re.findall(r"(?<![\w])" + re.escape(norm_text(v).lower()) + r"(?![\w])",
                                norm_text(text).lower()))
        counts[cid] = n

    rows = sorted(counts.items(), key=lambda kv: -kv[1])
    if args.json:
        print(json.dumps([{"competitorId": cid, "name": roster[cid], "mentions": n,
                           "active": cid in active} for cid, n in rows], indent=2))
    else:
        print(f"— mention_inventory · round {rnd['id']} · {rnd['slug']} · floor {args.floor} —")
        for cid, n in rows:
            flag = ""
            if cid in active and n < args.floor:
                flag = "  << UNDER FLOOR (active player)"
            elif cid not in active:
                flag = "  (inactive this round)"
            print(f"  {roster[cid]:24} {n:3}{flag}")
        low = [roster[c] for c, n in rows if c in active and n < args.floor]
        print(f"  => {len(low)} active player(s) under floor: {', '.join(low) if low else '—'}")

    if args.store:
        db.execute("""CREATE TABLE IF NOT EXISTS digest_mentions (
            round_id INTEGER NOT NULL REFERENCES rounds(id),
            competitor_id INTEGER NOT NULL REFERENCES competitors(id),
            mentions INTEGER NOT NULL,
            computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
            PRIMARY KEY (round_id, competitor_id))""")
        for cid, n in counts.items():
            db.execute("""INSERT INTO digest_mentions (round_id, competitor_id, mentions)
                          VALUES (?,?,?) ON CONFLICT(round_id, competitor_id)
                          DO UPDATE SET mentions=excluded.mentions,
                                        computed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')""",
                       (args.round_id, cid, n))
        db.commit()
        print(f"  stored {len(counts)} rows in digest_mentions")


if __name__ == "__main__":
    main()
