#!/usr/bin/env python3
"""
evidence.py — one shared, append-only evidence index for every player.

Deliberately ONE index rather than one per person: the most valuable claims are
comparative ("Jensen's vocabulary is the plainest of the ten, Jon's the richest")
and a single observation routinely backs claims about several people at once.
Per-person files would force those to be duplicated and then drift apart — which
is exactly the failure that produced the Jensen error, where five isolated
descriptions could not be checked against one another.

Two append-only JSONL files:

  evidence/claims.jsonl   a checkable statement about one or more players
  evidence/items.jsonl    a piece of backing for one or more claims

Append-only matters: several agents write concurrently, and appends do not
conflict the way rewrites do.

A claim must be FALSIFIABLE. "He is the group's contrarian" is not a claim, it is
an impression. "He votes against the round winner more often than anyone else" is
a claim, because it can be wrong. `audit` flags claims with no backing.

Weights encode how much a kind of evidence is actually worth:

  owner     5  Matt said so — ground truth about his own friends
  measure   4  a counted property of the corpus
  quote     3  verbatim from the subject
  mention   2  another member describing them
  photo     2  appearance evidence
  inference 1  reasoned but unconfirmed

Usage:
  evidence.py add-claim  --subjects "Dave Jensen,Jon Black" --section voice \
                         --text "..." [--tags vocabulary,contrast]
  evidence.py add-item   --claim jensen-voice-03 --kind measure --detail "..." \
                         [--source corpus.py] [--quote "..."] [--n 514] [--weight 4]
  evidence.py audit                          claims with too little backing
  evidence.py pack --subject "Jon Black" --min-points 30
  evidence.py pack --subject "Jon Black" --min-items 3
"""
from __future__ import annotations
import argparse
import json
import re
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIR = HERE / "evidence"
CLAIMS = DIR / "claims.jsonl"
ITEMS = DIR / "items.jsonl"

WEIGHT = {"owner": 5, "measure": 4, "quote": 3, "mention": 2, "photo": 2, "inference": 1}
KINDS = list(WEIGHT)


def _read(p: Path) -> list[dict]:
    if not p.exists():
        return []
    out = []
    for ln in p.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if ln:
            out.append(json.loads(ln))
    return out


def _append(p: Path, rec: dict) -> None:
    DIR.mkdir(exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def claim_id(subjects: list[str], section: str, existing: list[dict]) -> str:
    """Stable, readable ids: <surname-or-first>-<section>-NN."""
    base = _slug(subjects[0].split()[-1] if subjects else "group") + "-" + _slug(section)
    n = sum(1 for c in existing if c["id"].rsplit("-", 1)[0] == base) + 1
    return f"{base}-{n:02d}"


def add_claim(a) -> None:
    claims = _read(CLAIMS)
    subs = [s.strip() for s in (a.subjects or "").split(",") if s.strip()]
    # A directed claim ("Jon needles Conor") is evidence about BOTH people and about
    # the relationship: what Jon does to others, what Conor attracts, and how the two
    # of them talk. Both ends are therefore subjects, so the claim surfaces in either
    # person's pack rather than being filed under one of them and lost to the other.
    if a.frm:
        subs = [a.frm] + [s for s in subs if s != a.frm]
    if a.to and a.to not in subs:
        subs.append(a.to)
    if not subs:
        raise SystemExit("give --subjects, or --from/--to for a directed claim")
    rec = {
        "id": a.id or claim_id(subs, a.section, claims),
        "subjects": subs,
        "section": a.section,
        "text": a.text.strip(),
        "tags": [t.strip() for t in (a.tags or "").split(",") if t.strip()],
        "added": str(date.today()),
    }
    if a.frm and a.to:
        rec["relation"] = {"from": a.frm, "to": a.to}
    if any(c["id"] == rec["id"] for c in claims):
        raise SystemExit(f"claim id already exists: {rec['id']}")
    _append(CLAIMS, rec)
    print(rec["id"])


def add_item(a) -> None:
    claims = {c["id"] for c in _read(CLAIMS)}
    cl = [c.strip() for c in a.claim.split(",") if c.strip()]
    unknown = [c for c in cl if c not in claims]
    if unknown:
        raise SystemExit(f"unknown claim id(s): {unknown}")
    if a.kind not in WEIGHT:
        raise SystemExit(f"kind must be one of {KINDS}")
    items = _read(ITEMS)
    rec = {
        "id": f"e-{len(items)+1:04d}",
        "claims": cl,
        "kind": a.kind,
        "weight": a.weight if a.weight is not None else WEIGHT[a.kind],
        "detail": a.detail.strip(),
        "added": str(date.today()),
    }
    for k in ("source", "quote", "n", "speaker"):
        v = getattr(a, k, None)
        if v:
            rec[k] = v
    _append(ITEMS, rec)
    print(rec["id"])


def _by_claim(items: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for it in items:
        for c in it["claims"]:
            out.setdefault(c, []).append(it)
    return out


def audit(a) -> None:
    claims, items = _read(CLAIMS), _read(ITEMS)
    idx = _by_claim(items)
    print(f"{len(claims)} claims, {len(items)} evidence items\n")
    weak = []
    for c in claims:
        its = idx.get(c["id"], [])
        pts = sum(i["weight"] for i in its)
        if len(its) < a.min_items or pts < a.min_points:
            weak.append((c, len(its), pts))
    if not weak:
        print(f"every claim has >= {a.min_items} items and >= {a.min_points} points.")
        return
    print(f"UNDER-EVIDENCED ({len(weak)} of {len(claims)}) — "
          f"below {a.min_items} items or {a.min_points} points:\n")
    for c, n, p in sorted(weak, key=lambda x: x[2]):
        print(f"  [{n} items / {p:2d} pts] {c['id']:26s} {', '.join(c['subjects'])}")
        print(f"      {c['text'][:110]}")
    # a claim with zero backing is not weak, it is unsupported — call that out
    zero = [c for c, n, _ in weak if n == 0]
    if zero:
        print(f"\n  {len(zero)} claim(s) have NO evidence at all. These are assertions, "
              f"not findings — resolve or delete them.")


def pack(a) -> None:
    """Emit the best-attested material about a subject, under a threshold.

    This is what makes context depth a dial instead of five fixed levels: ask for
    N points of evidence and get the strongest claims that fit, rather than a
    section of a document chosen by hand.
    """
    claims, items = _read(CLAIMS), _read(ITEMS)
    idx = _by_claim(items)
    mine = [c for c in claims if a.subject in c["subjects"]]
    scored = []
    for c in mine:
        its = idx.get(c["id"], [])
        scored.append((sum(i["weight"] for i in its), len(its), c, its))
    scored.sort(key=lambda s: (-s[0], -s[1]))

    kept, total = [], 0
    for pts, n, c, its in scored:
        if n < a.min_items:
            continue
        if a.min_points and total >= a.min_points:
            break
        kept.append((pts, n, c, its))
        total += pts

    print(f"# {a.subject} — {len(kept)} claims, {total} evidence points\n")
    for section in dict.fromkeys(c["section"] for _, _, c, _ in kept):
        print(f"## {section}")
        for pts, n, c, its in kept:
            if c["section"] != section:
                continue
            rel = c.get("relation")
            mark = ""
            if rel:
                mark = (f"  [→ toward {rel['to']}]" if rel["from"] == a.subject
                        else f"  [← from {rel['from']}]" if rel["to"] == a.subject
                        else f"  [{rel['from']} → {rel['to']}]")
            print(f"- {c['text']}{mark}  [^{c['id']}]")
            if a.show_evidence:
                for i in its:
                    q = f' "{i["quote"][:90]}"' if i.get("quote") else ""
                    print(f"    - ({i['kind']}, w{i['weight']}) {i['detail']}{q}")
        print()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("add-claim")
    c.add_argument("--subjects", help="comma-separated; multi-subject is normal")
    c.add_argument("--from", dest="frm", help="directed claim: who is acting/feeling")
    c.add_argument("--to", help="directed claim: who it is about. Both ends become subjects.")
    c.add_argument("--section", required=True,
                   help="topics|voice|humor|standing|negative-space|biography|appearance")
    c.add_argument("--text", required=True, help="must be falsifiable")
    c.add_argument("--tags"); c.add_argument("--id")
    c.set_defaults(func=add_claim)

    i = sub.add_parser("add-item")
    i.add_argument("--claim", required=True, help="comma-separated claim ids")
    i.add_argument("--kind", required=True, choices=KINDS)
    i.add_argument("--detail", required=True)
    i.add_argument("--source"); i.add_argument("--quote")
    i.add_argument("--speaker", help="who said it — for a mention this is evidence "
                                     "about the speaker as much as about the subject")
    i.add_argument("--n", type=int); i.add_argument("--weight", type=int)
    i.set_defaults(func=add_item)

    a_ = sub.add_parser("audit")
    a_.add_argument("--min-items", type=int, default=2)
    a_.add_argument("--min-points", type=int, default=5)
    a_.set_defaults(func=audit)

    p = sub.add_parser("pack")
    p.add_argument("--subject", required=True)
    p.add_argument("--min-items", type=int, default=1)
    p.add_argument("--min-points", type=int, default=0, help="0 = no budget, emit all")
    p.add_argument("--show-evidence", action="store_true")
    p.set_defaults(func=pack)

    args = ap.parse_args()
    args.func(args)
