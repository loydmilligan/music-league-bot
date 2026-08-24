#!/usr/bin/env python3
"""Shared league/round/identity resolution for the digest-qa Python tools.

Extracted from chat_participation.py so that every tool answering "who was
active in round N" answers identically by construction. This is the same
property that makes mention_matrix reconcile with mention_inventory for free.

Everything here is scoped to one league. Nothing pools across groups.
"""
import json
import re
import sqlite3
from datetime import datetime, timedelta
from typing import Callable, NamedTuple


def iso(ts: str) -> str:
    """Normalise an offset-suffixed timestamp to the Z form."""
    return ts.replace("+00:00", "Z")


def norm_sender(s: str) -> str:
    """"~ Name" / "~ Name" WhatsApp push-name prefixes -> bare name."""
    return re.sub(r"^~[\s ]*", "", s).strip()


def league_id_for(db: sqlite3.Connection, slug: str) -> int:
    row = db.execute("SELECT id FROM leagues WHERE slug=?", (slug,)).fetchone()
    if not row:
        raise KeyError(f"unknown league slug {slug!r}")
    return row[0]


def current_season(db: sqlite3.Connection, league_id: int) -> int:
    row = db.execute("SELECT MAX(id) FROM seasons WHERE league_id=?", (league_id,)).fetchone()
    if not row or row[0] is None:
        raise KeyError(f"no seasons for league {league_id}")
    return row[0]


def chat_group_for(db: sqlite3.Connection, slug: str) -> str:
    row = db.execute("SELECT value FROM settings WHERE key='chat_league_group_map'").fetchone()
    if not row:
        raise KeyError("settings.chat_league_group_map is missing")
    group = json.loads(row[0]).get(slug)
    if not group:
        raise KeyError(f"no chat group mapped for {slug!r}")
    return group


def identity_resolver(db: sqlite3.Connection, league_id: int) -> Callable[[str], str]:
    """sender string -> player name, via player_identities for THIS league."""
    ident: dict[str, str] = {}
    for identifier, pname in db.execute(
        """SELECT pi.identifier, p.name FROM player_identities pi
           JOIN players p ON pi.player_id = p.id
           WHERE pi.identity_type='whatsapp' AND (pi.league_id=? OR pi.league_id IS NULL)""",
        (league_id,),
    ):
        ident[identifier] = pname
        ident[norm_sender(identifier)] = pname

    def resolve(sender: str) -> str:
        return ident.get(sender) or ident.get(norm_sender(sender)) or norm_sender(sender)

    return resolve


def deduped_messages(db: sqlite3.Connection, group: str) -> list[tuple[str, str, str]]:
    """(ts, raw_sender, text) for one group, relay truncation removed.

    The relay sometimes delivers a truncated copy of a message it already sent.
    Keyed on (sender, ts), the longest text wins.
    """
    best: dict[tuple[str, str], str] = {}
    for ts, sender, text in db.execute(
        "SELECT ts, sender, text FROM chat_messages WHERE group_name=?", (group,)
    ):
        k = (sender, iso(ts))
        if k not in best or len(text) > len(best[k]):
            best[k] = text
    return sorted((ts, sender, text) for (sender, ts), text in best.items())


class RoundWindow(NamedTuple):
    round_id: int
    name: str
    start: str
    end: str


def round_windows(db: sqlite3.Connection, season_id: int) -> list[RoundWindow]:
    """Chat window per round: previous round's voting deadline -> this one's.

    The first round of a season has no predecessor, so it falls back to seven
    days before its own deadline.
    """
    out: list[RoundWindow] = []
    prev: str | None = None
    for rid, name, vote_dl in db.execute(
        """SELECT id, name, voting_deadline FROM rounds
           WHERE season_id=? AND voting_deadline IS NOT NULL
           ORDER BY voting_deadline""",
        (season_id,),
    ):
        end = iso(vote_dl)
        if prev is None:
            start = (datetime.fromisoformat(end.rstrip("Z")) - timedelta(days=7)).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        else:
            start = prev
        out.append(RoundWindow(rid, name, start, end))
        prev = end
    return out
