#!/usr/bin/env python3
"""Public Cover Factory podium covers for a round, for punch-up scripts.

Punch-up scripts that set a podium item's ``coverUrl`` should call this instead of
hardcoding ``<digest host>/_media/...`` URLs, so they pick up the factory keeper
(and never undo it):

    python3 scripts/digest-qa/cover_keepers.py --round 182
    {"1": "<PUBLIC_DIGEST_BASE_URL>/_media/covers/<24hex>/wipe.gif", "2": null}

or from Python:

    import json, subprocess
    covers = json.loads(subprocess.check_output(
        ["python3", "scripts/digest-qa/cover_keepers.py", "--round", "182"]))
    url = covers.get("1")  # None -> keep whatever the podium already has

Output: a JSON object ``{rank: public_url or null}`` built from ``cover_podium_slots``.
A rank is ``null`` when its slot has no public URL yet (not done, failed, skipped, or
not promoted -- promotion happens at finalize / d2 publish). With tied ranks the first
slot that has a public URL wins. A round with no slots prints ``{}``.

The database is opened read-only (``file:...?mode=ro``); this script never writes.
Stdlib only.
"""
import argparse
import json
import os
import sqlite3
import sys

DEFAULT_DB = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "league.db"))


def cover_keepers(db_path: str, round_id: int) -> dict:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT rank, public_url FROM cover_podium_slots WHERE round_id = ? ORDER BY rank, id",
            (round_id,),
        ).fetchall()
    except sqlite3.OperationalError as e:
        if "no such table" in str(e):
            return {}  # DB predates the Cover Factory podium slots
        raise
    finally:
        conn.close()
    out: dict = {}
    for rank, url in rows:
        key = str(rank)
        if out.get(key) is None:
            out[key] = url or None
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--round", type=int, required=True, help="round id")
    ap.add_argument("--db", default=DEFAULT_DB, help=f"league.db path (default {DEFAULT_DB})")
    args = ap.parse_args(argv)
    if not os.path.exists(args.db):
        print(f"db not found: {args.db}", file=sys.stderr)
        return 2
    print(json.dumps(cover_keepers(args.db, args.round), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
