#!/usr/bin/env python3
"""Cross-section repetition scan for a round's digest draft (F6 / WS8).

Every quote or fact gets ONE home; cross-references are fine, verbatim
reuse is not (R139: same quote in podium + consensus + quotes; R147:
cat-lobby complaint in chat + regulars). Finds word n-gram runs shared
between different sections of the same draft.

Usage: python3 scripts/digest-qa/dedupe_scan.py <round-id> [--db data/league.db] [--min-words 6]
Exit 1 if any shared run is found.
"""
import argparse, json, re, sqlite3, sys
from collections import defaultdict

STOP_RUNS = {"points and the", "in the round", "of the round"}  # trivial connectors


def norm(s):
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", s).strip()


def texts_by_section(db, round_id):
    draft = db.execute(
        "SELECT id, stats_content_json, guesser_content_json FROM digest_drafts "
        "WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1", (round_id,)).fetchone()
    if not draft:
        sys.exit(f"no digest draft for round {round_id}")
    out = {}

    def strings(node, acc):
        if isinstance(node, str):
            acc.append(node)
        elif isinstance(node, dict):
            for v in node.values():
                strings(v, acc)
        elif isinstance(node, list):
            for v in node:
                strings(v, acc)

    for row in db.execute("SELECT kind, content_json FROM digest_sections WHERE draft_id = ?", (draft["id"],)):
        acc = []
        try:
            strings(json.loads(row["content_json"]), acc)
        except (json.JSONDecodeError, TypeError):
            continue
        out[row["kind"]] = norm(" ".join(acc))
    for slot in ("stats_content_json", "guesser_content_json"):
        try:
            acc = []
            strings(json.loads(draft[slot] or "{}"), acc)
            if acc:
                out[slot.replace("_content_json", "")] = norm(" ".join(acc))
        except (json.JSONDecodeError, TypeError):
            pass
    return out


def words_of(text):
    return re.findall(r"[\w'']+", text.lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("round_id", type=int)
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--min-words", type=int, default=6)
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    sections = texts_by_section(db, args.round_id)

    n = args.min_words

    # Maximal shared word runs per section pair (SequenceMatcher matching
    # blocks over word lists — no overlapping sub-run fragments).
    from difflib import SequenceMatcher
    kinds = sorted(sections)
    found = defaultdict(set)  # run -> {"a+b", ...}
    for i, a in enumerate(kinds):
        wa = words_of(sections[a])
        for b in kinds[i + 1:]:
            wb = words_of(sections[b])
            sm = SequenceMatcher(a=wa, b=wb, autojunk=False)
            for blk in sm.get_matching_blocks():
                if blk.size >= n:
                    run = " ".join(wa[blk.a:blk.a + blk.size])
                    if run not in STOP_RUNS:
                        found[run].add(f"{a}+{b}")

    # Naming a song (artist + title) in two sections is identification, not
    # duplication -- only flag runs that go beyond the song's own name.
    song_names = set()
    for r in db.execute("SELECT title, artists FROM ml_submissions WHERE round_id = ?", (args.round_id,)):
        for combo in (f"{r['artists']} {r['title']}", f"{r['title']} {r['artists']}", r["title"], r["artists"]):
            song_names.add(" ".join(words_of(combo)))

    # Drop runs that are substrings of a longer reported run.
    merged = []
    for run, pairs in sorted(found.items(), key=lambda r: -len(r[0])):
        if any(run in s for s in song_names):
            continue
        if not any(run in longer for longer, _ in merged):
            merged.append((run, pairs))

    print(f"— dedupe_scan · round {args.round_id} · {len(sections)} sections · ≥{n}-word runs —")
    if not merged:
        print("  clean: no verbatim runs shared between sections")
        sys.exit(0)
    for run, kinds in merged:
        print(f"  [DUP] {'+'.join(sorted(kinds))}: \"{run}\"")
    print(f"  => {len(merged)} shared run(s) — every quote/fact needs ONE home")
    sys.exit(1)


if __name__ == "__main__":
    main()
