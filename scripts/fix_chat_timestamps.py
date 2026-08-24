#!/usr/bin/env python3
"""One-shot migration: normalise chat_messages.ts to true UTC.

Two ingest paths disagreed. Live relay rows (…Z) were always true UTC. Pixel 9
export backfill rows (…+00:00) had the PDT correction applied on the Boarz pass
and NOT on the Second Best / Hip Jammers passes, so those store local time
wearing a UTC label.

Established from three messages Matt dated on 2026-08-23 and confirmed against
per-group hour distributions: correcting Second Best takes its share of messages
posted 2-8am local from 47% to 3%.

All affected rows fall in 2026-05-06..2026-07-23, entirely within PDT (UTC-7),
so a flat 7h shift is correct and there is no DST edge case.

Usage: python scripts/fix_chat_timestamps.py [--db data/league.db] [--apply]
Without --apply it reports what it would change and touches nothing.
"""
import argparse
import sqlite3
import sys
from datetime import datetime, timedelta

PDT_OFFSET_HOURS = 7

# Groups whose EXPORT-path rows stored local time labelled UTC.
NEEDS_SHIFT = {
    "Music League chat for Second Best and Friends",
    "Hip jammers",
}


def classify_row(group_name: str, ts: str) -> str:
    if ts.endswith("Z"):
        return "relay"
    return "export_needs_shift" if group_name in NEEDS_SHIFT else "export_correct"


def corrected_ts(ts: str, kind: str) -> str:
    base = ts.replace("+00:00", "").replace("Z", "")[:19]
    dt = datetime.fromisoformat(base)
    if kind == "export_needs_shift":
        dt += timedelta(hours=PDT_OFFSET_HOURS)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row

    cols = {r["name"] for r in db.execute("PRAGMA table_info(chat_messages)")}
    if "source_path" not in cols:
        if args.apply:
            db.execute("ALTER TABLE chat_messages ADD COLUMN source_path TEXT")
        print("source_path column: " + ("added" if args.apply else "MISSING (would add)"))

    rows = db.execute("SELECT id, group_name, ts FROM chat_messages").fetchall()
    counts = {"relay": 0, "export_needs_shift": 0, "export_correct": 0}
    updates = []
    for r in rows:
        kind = classify_row(r["group_name"], r["ts"])
        counts[kind] += 1
        new_ts = corrected_ts(r["ts"], kind)
        source = "relay" if kind == "relay" else "export"
        if new_ts != r["ts"] or not args.apply:
            updates.append((new_ts, source, r["id"]))

    for kind, n in counts.items():
        print(f"  {kind:20} {n:6}")

    if not args.apply:
        print(f"\ndry run — {len(updates)} rows would be rewritten. Re-run with --apply.")
        return

    db.executemany("UPDATE chat_messages SET ts=?, source_path=? WHERE id=?", updates)
    db.commit()
    print(f"\napplied to {len(updates)} rows.")


if __name__ == "__main__":
    main()
