#!/usr/bin/env python3
"""Fetch submitter comments from a round's Music League voting page (spec §7.2).

  scripts/ml-vote-comments.py --league <lid> --round <rid>
  scripts/ml-vote-comments.py --round <rid>     # league auto-resolved

INTERPRETER: this needs BOTH `bs4` (for scripts/lib/ml_vote_parse.py) and the
editable-installed `cli_web` package. As of 2026-09-01 the only interpreter on
this machine with both is ~/Projects/ttstt/venv/bin/python3 (bs4 alone also
lives in the repo's .venv-digestqa, which has no cli_web). Run it as:

  ~/Projects/ttstt/venv/bin/python3 scripts/ml-vote-comments.py --round <rid>

Under any other interpreter the script still exits 0, reporting the missing
dependency as {"ok": false, "error": ...}.

Borrows the installed cli-web-musicleague client purely for its authenticated,
Cloudflare-impersonating session; adds no command to that (untracked) package.

SAFETY — read before editing:
  * GET ONLY. /vote/ autosaves via hx-post on interaction. A POST here, or any
    browser that renders and clicks this page, writes a REAL DRAFT BALLOT to the
    owner's account in a live league.
  * Use /vote/ and never /-/results. Post-close, /-/results carries the same
    comments but ATTRIBUTES them to named submitters. /vote/ is anonymous by
    construction, and that anonymity is what the guessing game rests on (§5).

Always exits 0. A failure is reported as {"ok": false, "error": ...} because a
failed scrape must not block the sitting (§7.2).
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _fail(msg: str) -> int:
    json.dump({"ok": False, "error": msg}, sys.stdout)
    print()
    return 0


def resolve_league_id(client, round_id: str) -> str | None:
    """Find the league whose rounds list contains this round.

    The round shell has no reference to voting at all; only /-/rounds emits the
    /vote/ href. See the spike, §5 of docs/research/2026-09-01-ml-voting-page.md.
    """
    for league in client.list_current_leagues():
        soup = client._get_html(f"/l/{league['id']}/-/rounds")
        if soup and soup.select_one(f'a[href*="{round_id}"]'):
            return league["id"]
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True, help="32-char ML round id")
    ap.add_argument("--league", help="32-char ML league id (auto-resolved if omitted)")
    args = ap.parse_args()

    # Imported here, not at module scope, so a missing dependency is reported as
    # data on stdout rather than crashing with a non-zero exit.
    try:
        from cli_web.musicleague.core import auth
        from cli_web.musicleague.core.client import MusicleagueClient

        from scripts.lib.ml_vote_parse import parse_ballot
    except Exception as e:  # not just ImportError: a module can raise at import time
        return _fail(f"cli-web-musicleague or bs4 is not importable: {type(e).__name__}: {e}")

    try:
        # Inside the try on purpose: is_authenticated() reads auth.json and can
        # *raise* (not just return False) on a malformed payload — e.g. a cookie
        # list whose entries have non-string fields escapes its internal
        # AuthError handling. That must degrade to ok:false, not a traceback.
        if not auth.is_authenticated():
            return _fail("Music League session expired. Run: cli-web-musicleague auth login")

        with MusicleagueClient(cookies=auth.get_cookies()) as client:
            lid = args.league or resolve_league_id(client, args.round)
            if not lid:
                return _fail(f"could not resolve a league containing round {args.round}")

            soup = client._get_html(f"/l/{lid}/{args.round}/vote/")
            if soup is None:
                return _fail(f"voting page fetch failed for {lid}/{args.round}")

            songs = parse_ballot(str(soup))
            if not songs:
                return _fail("voting page parsed to zero songs — markup may have changed")

            json.dump(
                {
                    "ok": True,
                    "league_id": lid,
                    "round_id": args.round,
                    "songs": songs,
                    "counts": {
                        "songs": len(songs),
                        "comments": sum(1 for s in songs if s["comment"]),
                    },
                },
                sys.stdout,
            )
            print()
            return 0
    except Exception as e:  # noqa: BLE001 — a failed scrape is data, not a crash
        return _fail(f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    raise SystemExit(main())
