#!/usr/bin/env python3
"""
dump_player.py — write one player's own writing and everything said ABOUT them.

The focus five already have hand-built corpora/*.txt. This generalises it so the
remaining five are built from exactly the same cleaning path (see corpus.py) rather
than five separate ad-hoc extractions.

Two files per player:
  corpora/<Name>.txt            their own chat + ballots, chronological
  corpora/<Name>__mentions.txt  messages by OTHERS that name them, with speaker

For the thin players the mentions file is the more important of the two — Darren
writes 4.6k characters but is talked about in 128 messages.

Usage:  .venv/bin/python dump_player.py "Darren Paletz"
        .venv/bin/python dump_player.py --all
"""
from __future__ import annotations
import argparse
import re
import sys
from pathlib import Path

import corpus

HERE = Path(__file__).resolve().parent
CORPORA = HERE / "corpora"

# How each person is actually referred to. Nicknames matter more than names here:
# the group almost never uses full names, so a name-only search misses most of it.
ALIASES = {
    "Matt Mariani": ["matt", "mariani", "mashew", "matty"],
    "Jon Black": ["jon", "jonathan", "black", "jb"],
    "Conor Johnston": ["conor", "connor", "johnston", "cjwookie", "wookie"],
    "Grant Koziol": ["grant", "koziol", "kozh", "koz", "kozhleaze"],
    "Dave Jensen": ["jensen"],
    "Shane Farkas": ["shane", "farkas", "farkle", "fark"],
    "Jimmy": ["jimmy", "jimbo"],
    "Clements Johnson": ["clements", "clem", "clammy", "clemydia"],
    "Dave Steingart": ["steingart", "steiny"],
    "Darren Paletz": ["darren", "paletz", "palletz", "pallet"],
}

# Second Best is a family-and-old-friends league, so surnames collide in a way
# Boarz never did: three Blacks, three Chapins, two Marianis, two Michaels and
# two Sarahs. A bare surname search would hand four people the same mentions file.
# Every alias below was checked against the chat before being written down:
#   "bp"     -> Brian Pascoe   (64 uses, incl. the @~bp mention handle)
#   "layous" -> Michael Layous (72; he is never "Michael Black")
#   "mike"   -> Michael Black  ("Mike Black", "Mike's back!")
#   "sarah b"-> Sarah Black    (the group's own disambiguator)
# Tokens that genuinely point at more than one person go in AMBIGUOUS instead,
# which files them under a separate heading rather than asserting they belong.
SB_ALIASES = {
    # Keys are the EXACT sender string in the corpus. His WhatsApp display name is
    # "MIchael Black" with a capital I; spelling it correctly silently produced a
    # zero-message corpus. DISPLAY fixes the typo for filenames and titles only.
    "MIchael Black": ["mike black", "michael black", "mike"],
    "Michael Layous": ["layous"],
    "Brian Pascoe": ["bp", "brian", "pascoe"],
    "Jac Chapin": ["jac"],
    "Mara Mariani": ["mara"],
    "TJ Cook": ["tj", "tj cook"],
    "Tommy Chapin": ["tommy"],
    "Sarah Black": ["sarah b", "sarah black"],
    # "philip"/"phillip"/"philly" all verified as him in-corpus (19/7/2 uses; no
    # Philadelphia sense appears). A "phil"-only match missed ~15 real mentions.
    "Phil Chapin": ["phil", "philip", "phillip", "philly"],
    "Sarah Zucker": ["zucker", "sarah zucker"],
    "Joe Quinto": ["quinto", "joe"],
    "Susan Black": ["susan", "suz"],
    "Molly J": ["molly"],
    # Both also play Boarz and already have Boarz dossiers. Their Second Best
    # corpora are dumped anyway: they are the two highest-volume voices in this
    # room and every other dossier's cross-member comparison is drawn against
    # them, so omitting them silently made those numbers lower bounds.
    "Matt Mariani": ["matt", "mashew", "matty"],
    "Jon Black": ["jb", "jon", "jonathan"],
}

# token -> the people it could mean. Filed under "possibly about this person".
SB_AMBIGUOUS = {
    "michael": ["MIchael Black", "Michael Layous"],
    "sarah": ["Sarah Black", "Sarah Zucker"],
    "chapin": ["Jac Chapin", "Tommy Chapin", "Phil Chapin"],
    "black": ["MIchael Black", "Sarah Black", "Susan Black"],
    "cook": ["TJ Cook"],  # also the verb; kept out of the confident set
    "mariani": ["Matt Mariani", "Mara Mariani"],
}

# Phrases that contain an alias but are not the person. Built the way resolve.ts
# built its BLOCKED_TOKENS — from observed collisions, not imagination. A first
# name as common as "joe" collects famous strangers: 9 of Joe Quinto's 28 initial
# "mentions" were Joe Rogan, Joe Jackson, Billy Joe, a coach, and a Brooklyn 99
# character. Blocked text is blanked before matching, so a message that mentions
# BOTH Joe Rogan and the real Joe still counts.
SB_BLOCKED = {
    "Joe Quinto": ["joe rogan", "joe jackson", "billy joe", "joe beardsley",
                   "joe biden", "trader joe", "joe strummer", "joe walsh"],
    "MIchael Black": ["mike ness", "mike mariani", "mike tv", "mike nieto",
                      "mike tyson", "mike d"],
}

ROSTERS = {"boarz": ALIASES, "second_best": SB_ALIASES}


def blocked_re(name: str, room: str) -> re.Pattern | None:
    pats = SB_BLOCKED.get(name) if room == "second_best" else None
    return _rx(pats) if pats else None


def ambiguous_for(name: str, room: str) -> list[str]:
    if room != "second_best":
        return []
    return [tok for tok, people in SB_AMBIGUOUS.items() if name in people]


def _rx(keys: list[str]) -> re.Pattern:
    keys = sorted(keys, key=len, reverse=True)
    return re.compile(r"\b(" + "|".join(re.escape(k) for k in keys) + r")\b", re.I)


def mention_re(name: str, room: str = "boarz") -> re.Pattern:
    roster = ROSTERS.get(room, ALIASES)
    return _rx(roster.get(name, [name.split()[0].lower()]))


def dump(name: str, msgs: list, room: str = "boarz", out: Path | None = None) -> tuple[int, int]:
    out = out or CORPORA
    out.mkdir(parents=True, exist_ok=True)
    own = [m for m in msgs if m.player == name]
    lines = []
    for m in own:
        tag = f"[{m.kind}"
        if m.kind == "ballot" and m.points is not None:
            tag += f" {m.points:+d}"
        lines.append(f"{tag} {m.ts}]\n{m.text}\n")
    (out / f"{_stem(name)}.txt").write_text("\n".join(lines), encoding="utf-8")

    rx = mention_re(name, room)
    brx = blocked_re(name, room)
    def hit(t: str) -> bool:
        return bool(rx.search(brx.sub(" ", t) if brx else t))
    ment = [m for m in msgs if m.player != name and hit(m.text)]
    mlines = [f"[{m.player} · {m.kind} · {m.ts}]\n{m.text}\n" for m in ment]

    # Ambiguous tokens are kept, but under a heading that says what they are, so a
    # dossier written from this file can weigh them instead of trusting them.
    amb = ambiguous_for(name, room)
    others = []
    if amb:
        arx = _rx(amb)
        others[:] = [m for m in msgs if m.player != name and arx.search(m.text)
                     and not hit(m.text)]
        if others:
            who = ", ".join(f"{t!r} -> {'/'.join(SB_AMBIGUOUS[t])}" for t in amb)
            mlines.append(f"\n\n===== POSSIBLY ABOUT {name} — AMBIGUOUS ALIAS =====\n"
                          f"These matched only an ambiguous token ({who}).\n"
                          f"Do not treat them as confirmed.\n")
            mlines += [f"[{m.player} · {m.kind} · {m.ts}]\n{m.text}\n" for m in others]
    (out / f"{_stem(name)}__mentions.txt").write_text("\n".join(mlines), encoding="utf-8")
    return len(own), len(ment), len(others)


DISPLAY = {"MIchael Black": "Michael Black"}


def _stem(name: str) -> str:
    return DISPLAY.get(name, name).replace(" ", "_")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("player", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--room", default="boarz", choices=list(ROSTERS))
    a = ap.parse_args()

    msgs = corpus.load(room=a.room)
    roster = ROSTERS[a.room]
    # Second Best corpora live in their own directory: Jon and Matt appear in both
    # leagues and write differently in each, so one flat namespace would overwrite
    # one league's corpus with the other's.
    out = CORPORA if a.room == "boarz" else CORPORA / a.room
    names = list(roster) if a.all else [a.player]
    if not names or names == [None]:
        sys.exit("give a player name or --all")
    print(f"{'player':18s}{'own':>6s}{'own chars':>11s}{'ment':>7s}{'ambig':>7s}{'ment chars':>12s}")
    for n in names:
        own, ment, amb = dump(n, msgs, room=a.room, out=out)
        oc = (out / f"{_stem(n)}.txt").stat().st_size
        mc = (out / f"{_stem(n)}__mentions.txt").stat().st_size
        print(f"{DISPLAY.get(n, n):18s}{own:6d}{oc:11,d}{ment:7d}{amb:7d}{mc:12,d}")
