#!/usr/bin/env python3
"""
corpus.py — the Boarz corpus, cleaned and attributed. Everything else reads this.

Scope is Boarz II Men only. Nothing from Second Best, Fam Jam or sssc enters here.

Four cleaning steps, each of which was a real bug found in the data:

1. IDENTITY NORMALISATION. player_identities stores "~ Conor J" with U+0020;
   the chat contains U+202F (narrow no-break space), and a few rows are mojibake
   ("~��JB"). Same glyph, different bytes. Left unhandled, 53% of the
   corpus goes unattributed and Conor resolves to 3k characters instead of 99k.

2. RELAY PLACEHOLDERS. "Waiting for this message. This may take a while." is
   WhatsApp's undecryptable-message notice, not something a person typed.

3. "Mentioned all". When a message @-mentions everyone the relay records the
   notification title as the sender and buries the real one in the body
   ("Jonathan Black: @all ..."). Recoverable by parsing the prefix.

4. EDIT PAIRS. A WhatsApp edit arrives as a second row with the same timestamp
   (Matt 261, Jon 91 of them). Keep the last version or the model learns to send
   everything twice with a typo.

Content types are kept apart on purpose — people write differently in a ballot
than in the chat, and the volumes are wildly different (Grant: 57k chat, 153
characters of ballots).
"""
from __future__ import annotations
import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from pathlib import Path

DB = Path(__file__).resolve().parents[4] / "data" / "league.db"
BOARZ_LEAGUE_ID = 5
BOARZ_GROUP = "Boarz II Men - Music Leagueing https way"

PLACEHOLDER = "Waiting for this message"
# "~" then any run of space-ish or replacement characters
_PREFIX = re.compile(r"^~[\s � ]*")
_MENTIONED_ALL = re.compile(r"^([^:\n]{1,40}):\s*(.+)$", re.S)


def norm_sender(s: str | None) -> str:
    """Collapse every spelling of a sender to one comparable key."""
    return _PREFIX.sub("", unicodedata.normalize("NFKC", s or "")).strip()


@dataclass
class Message:
    player: str
    kind: str          # 'chat' | 'ballot'
    ts: str
    text: str
    round_id: int | None = None
    points: int | None = None


def _alias_map(db: sqlite3.Connection) -> dict[str, str]:
    """Every known spelling of a name -> canonical players.name."""
    m: dict[str, str] = {}
    for player, ident in db.execute(
        "SELECT p.name, i.identifier FROM player_identities i "
        "JOIN players p ON p.id = i.player_id WHERE i.identity_type = 'whatsapp'"
    ):
        m[norm_sender(ident)] = player
    # ML display names double as aliases, and are how ballots attribute
    for ml, player in db.execute(
        "SELECT c.name, p.name FROM competitors c JOIN players p ON p.id = c.player_id"
    ):
        m.setdefault(norm_sender(ml), player)
    return m


def load(db_path: Path | str = DB) -> list[Message]:
    db = sqlite3.connect(str(db_path))
    alias = _alias_map(db)
    out: list[Message] = []

    rows = db.execute(
        "SELECT sender, ts, text FROM chat_messages WHERE group_name = ? ORDER BY ts",
        (BOARZ_GROUP,),
    ).fetchall()

    for sender, ts, text in rows:
        if not text or text.startswith(PLACEHOLDER):
            continue
        who = alias.get(norm_sender(sender))
        if who is None and norm_sender(sender) == "Mentioned all":
            # the real sender is the prefix of the body
            m = _MENTIONED_ALL.match(text)
            if m:
                who = alias.get(norm_sender(m.group(1)))
                text = m.group(2)
        if who is None:
            continue
        out.append(Message(player=who, kind="chat", ts=ts, text=text))

    for player, ts, text, rid, pts in db.execute(
        "SELECT p.name, v.created_at, v.comment, v.round_id, v.points FROM votes v "
        "JOIN competitors c ON c.id = v.voter_id JOIN players p ON p.id = c.player_id "
        "JOIN rounds r ON r.id = v.round_id JOIN seasons s ON s.id = r.season_id "
        "WHERE s.league_id = ? AND v.comment IS NOT NULL AND v.comment <> '' ORDER BY v.created_at",
        (BOARZ_LEAGUE_ID,),
    ):
        out.append(Message(player=player, kind="ballot", ts=ts, text=text,
                           round_id=rid, points=pts))

    db.close()
    return _drop_edit_pairs(out)


def _drop_edit_pairs(msgs: list[Message]) -> list[Message]:
    """A WhatsApp edit lands as a second row at the same timestamp. Keep the last."""
    seen: dict[tuple[str, str, str], int] = {}
    keep: list[Message] = []
    for m in msgs:
        key = (m.player, m.kind, m.ts)
        if m.kind == "chat" and key in seen:
            keep[seen[key]] = m            # later row supersedes
            continue
        seen[key] = len(keep)
        keep.append(m)
    return keep


def by_player(msgs: list[Message] | None = None) -> dict[str, dict[str, list[Message]]]:
    """{player: {'chat': [...], 'ballot': [...]}}"""
    msgs = msgs if msgs is not None else load()
    out: dict[str, dict[str, list[Message]]] = {}
    for m in msgs:
        out.setdefault(m.player, {"chat": [], "ballot": []})[m.kind].append(m)
    return out


FOCUS = ["Matt Mariani", "Jon Black", "Conor Johnston", "Grant Koziol", "Dave Jensen"]


if __name__ == "__main__":
    d = by_player()
    print(f"{'player':18s}{'chat msgs':>10s}{'chat chars':>12s}{'ballots':>9s}{'ballot chars':>14s}")
    for p, k in sorted(d.items(), key=lambda kv: -sum(len(m.text) for v in kv[1].values() for m in v)):
        c, b = k["chat"], k["ballot"]
        star = " *" if p in FOCUS else ""
        print(f"{p:18s}{len(c):10d}{sum(len(m.text) for m in c):12,d}"
              f"{len(b):9d}{sum(len(m.text) for m in b):14,d}{star}")
    tot = sum(len(m.text) for v in d.values() for l in v.values() for m in l)
    print(f"\n{len(d)} players, {tot:,} characters attributed  (* = focus five)")
