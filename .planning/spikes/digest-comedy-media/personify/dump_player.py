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


def mention_re(name: str) -> re.Pattern:
    keys = sorted(ALIASES.get(name, [name.split()[0].lower()]), key=len, reverse=True)
    return re.compile(r"\b(" + "|".join(re.escape(k) for k in keys) + r")\b", re.I)


def dump(name: str, msgs: list) -> tuple[int, int]:
    CORPORA.mkdir(exist_ok=True)
    own = [m for m in msgs if m.player == name]
    lines = []
    for m in own:
        tag = f"[{m.kind}"
        if m.kind == "ballot" and m.points is not None:
            tag += f" {m.points:+d}"
        lines.append(f"{tag} {m.ts}]\n{m.text}\n")
    (CORPORA / f"{_stem(name)}.txt").write_text("\n".join(lines), encoding="utf-8")

    rx = mention_re(name)
    ment = [m for m in msgs if m.player != name and rx.search(m.text)]
    mlines = [f"[{m.player} · {m.kind} · {m.ts}]\n{m.text}\n" for m in ment]
    (CORPORA / f"{_stem(name)}__mentions.txt").write_text("\n".join(mlines), encoding="utf-8")
    return len(own), len(ment)


def _stem(name: str) -> str:
    return name.replace(" ", "_")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("player", nargs="?")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()

    msgs = corpus.load()
    names = list(ALIASES) if a.all else [a.player]
    if not names or names == [None]:
        sys.exit("give a player name or --all")
    print(f"{'player':18s}{'own':>6s}{'own chars':>11s}{'mentions':>10s}{'ment chars':>12s}")
    for n in names:
        own, ment = dump(n, msgs)
        oc = (CORPORA / f"{_stem(n)}.txt").stat().st_size
        mc = (CORPORA / f"{_stem(n)}__mentions.txt").stat().st_size
        print(f"{n:18s}{own:6d}{oc:11,d}{ment:10d}{mc:12,d}")
