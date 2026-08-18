#!/usr/bin/env python3
"""Round-end trigger for the HiL lede loop (WS10, final unchecked box).

The digest runner (bot-ui container) generates a draft at round close, but
`generate_ledes.py` shells out to `claude -p`, which exists only on the
host — so this host-side poller bridges the gap. Runs from a systemd user
timer (mlb-hil-ledes.timer); each pass:

  1. finds rounds whose league digest_mode = 'hil' with a digest draft
     generated in the last LOOKBACK days,
  2. skips any that already have a digest_ledes row (done or in flight),
  3. runs generate_ledes.py <round> --notify for the rest (ntfy push with
     the /hil review link; NTFY_* comes from the project .env).

Idempotent: generate_ledes writes its digest_ledes row, so the next pass
skips the round. A failed run leaves no row and retries next pass.

Usage: python3 scripts/digest-qa/hil_autorun.py [--db data/league.db]
           [--lookback-days 7] [--dry-run]
"""
import argparse, os, sqlite3, subprocess, sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))


def load_env(path):
    """Minimal .env reader — the systemd unit has no shell to source it."""
    if not os.path.exists(path):
        return
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(REPO, "data/league.db"))
    ap.add_argument("--lookback-days", type=int, default=7)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    load_env(os.path.join(REPO, ".env"))
    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row

    cutoff = (datetime.now(timezone.utc) - timedelta(days=args.lookback_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = db.execute(
        """SELECT d.round_id, r.name, l.slug
           FROM digest_drafts d
           JOIN rounds r ON r.id = d.round_id
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.digest_mode = 'hil'
             AND d.finalized_at IS NULL  -- already-sent digests don't need a HiL pass
             AND d.generated_at >= ?
             AND NOT EXISTS (SELECT 1 FROM digest_ledes dl WHERE dl.round_id = d.round_id)
           ORDER BY d.round_id""",
        (cutoff,)).fetchall()
    db.close()  # release before generate_ledes opens its own connection

    if not rows:
        print("hil_autorun: nothing to do")
        return

    failed = 0
    for row in rows:
        cmd = [sys.executable, os.path.join(HERE, "generate_ledes.py"),
               str(row["round_id"]), "--db", args.db, "--notify"]
        print(f"hil_autorun: round {row['round_id']} “{row['name']}” ({row['slug']})"
              + (" [dry-run]" if args.dry_run else ""))
        if args.dry_run:
            continue
        r = subprocess.run(cmd, cwd=REPO)
        if r.returncode != 0:
            failed += 1
            print(f"hil_autorun: round {row['round_id']} FAILED (exit {r.returncode}); will retry next pass",
                  file=sys.stderr)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
