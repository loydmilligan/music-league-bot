#!/usr/bin/env python3
"""quote_audit.py — verify every quoted span in a draft against the real corpus.

`verify_facts.py` checks the quotes section, the podium, standings and the
villain's subject. It does not look inside the prose of the other sections, and
that is where quotations actually accumulate: the chat write-up alone carries
dozens. This walks every section (plus the Coinage and the Regulars), pulls out
anything sitting inside quotation marks, and checks it against chat messages,
vote comments and submission notes.

Matching is deliberately forgiving about the things a writer legitimately does
to a quote and strict about the words themselves: curly and straight quotes are
folded together, whitespace is collapsed, and a trailing ellipsis marks an
intentional condensation. Anything else that does not appear verbatim in the
corpus is reported.

Usage: python3 scripts/digest-qa/quote_audit.py <round-id> [--db data/league.db]
"""
from __future__ import annotations
import argparse
import json
import re
import sqlite3
import unicodedata

# Quoted spans worth checking. Short fragments are skipped: a two-word span is
# almost always a phrase the writer is using, not a quotation being attributed.
MIN_LEN = 12
QUOTE_RE = re.compile(r'[“"]([^“”"]{%d,}?)[”"]' % MIN_LEN)


def fold(s: str) -> str:
    """Normalise the differences that are not the writer's fault.

    Includes stripping Unicode format characters: WhatsApp wraps @-mentions in
    U+2068/U+2069 isolates, so a quote copied faithfully out of a mention still
    fails a naive comparison.
    """
    s = unicodedata.normalize("NFKC", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Cf")
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = s.replace("—", "-").replace("–", "-")
    return re.sub(r"\s+", " ", s).strip().lower()


def walk(node, out: list[str]) -> None:
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        for v in node.values():
            walk(v, out)
    elif isinstance(node, list):
        for v in node:
            walk(v, out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("round_id", type=int)
    ap.add_argument("--db", default="data/league.db")
    a = ap.parse_args()
    db = sqlite3.connect(a.db)

    draft = db.execute(
        "SELECT id FROM digest_drafts WHERE round_id=? ORDER BY generated_at DESC LIMIT 1",
        (a.round_id,),
    ).fetchone()
    if not draft:
        raise SystemExit(f"no draft for round {a.round_id}")
    draft_id = draft[0]

    corpus = [fold(t) for (t,) in db.execute("SELECT text FROM chat_messages")]
    corpus += [fold(t) for (t,) in db.execute(
        "SELECT comment FROM votes WHERE comment IS NOT NULL AND TRIM(comment)<>''")]
    corpus += [fold(t) for (t,) in db.execute(
        "SELECT comment FROM ml_submissions WHERE comment IS NOT NULL AND TRIM(comment)<>''")]

    blocks: list[tuple[str, str]] = []
    for kind, js in db.execute(
        "SELECT kind, content_json FROM digest_sections WHERE draft_id=? ORDER BY position", (draft_id,)
    ):
        strings: list[str] = []
        walk(json.loads(js), strings)
        blocks += [(kind, s) for s in strings]
    for col, label in (("stats_content_json", "coinage"), ("guesser_content_json", "guesser")):
        row = db.execute(f"SELECT {col} FROM digest_drafts WHERE id=?", (draft_id,)).fetchone()
        if row and row[0]:
            strings = []
            walk(json.loads(row[0]), strings)
            blocks += [(label, s) for s in strings]

    titles = {t for (t,) in db.execute(
        "SELECT title FROM ml_submissions WHERE round_id=? AND title IS NOT NULL", (a.round_id,))}
    titles |= {t.rstrip("?!.") for t in list(titles)}

    seen: set[tuple[str, str]] = set()
    bad = 0
    total = 0
    for kind, text in blocks:
        for q in QUOTE_RE.findall(text):
            key = (kind, q)
            if key in seen:
                continue
            seen.add(key)
            # Prose captured between two real quotes: an unbalanced quote count
            # in a paragraph makes the regex pair the wrong marks. Such a span
            # opens on punctuation or closes on a colon, never both ends clean.
            if q[0] in ' .,;:—-\n' or q.rstrip().endswith((':', '—')):
                continue
            # Song and section titles are quoted but are not quotations.
            if q in titles:
                continue
            total += 1
            needle = fold(q)
            condensed = needle.endswith("...") or needle.endswith("…")
            if condensed:
                needle = needle.rstrip(".… ")
            if any(needle in hay for hay in corpus):
                continue
            bad += 1
            print(f"  [UNVERIFIED] {kind}: “{q[:100]}”")

    print(f"— quote_audit · round {a.round_id} · {total} quoted spans checked —")
    print(f"  => {bad} unverified" if bad else "  => all quoted spans verbatim in chat / votes / submissions")


if __name__ == "__main__":
    main()
