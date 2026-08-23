#!/usr/bin/env python3
"""Per-section mention matrix for a round's digest draft (WS9 / WS6.1 step 5).

`mention_inventory.py` answers "is anyone under-mentioned?"; this answers
"where is each player mentioned?" — the same counts, broken out by section, so a
player sitting on 12 mentions that are all inside one chat moment is visible as
the imbalance it is.

Name resolution is deliberately identical to mention_inventory (same roster
query, same alias expansion, same distinctive-first-name rule, same norm_text
folding), so the row totals here reconcile with that tool exactly.

Usage: python3 scripts/digest-qa/mention_matrix.py <round-id> [--db data/league.db]
           [--md] [--json]
"""
import argparse, json, os, re, sqlite3, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_facts import RULES, norm_text  # noqa: E402

# Draft-level slots live on digest_drafts, not digest_sections; they are sections
# to a reader, so they get columns too.
DRAFT_SLOTS = [("stats", "stats_content_json"), ("guesser", "guesser_content_json")]


def variants_for(name, roster_names, aliases):
    """Every string that counts as a mention of `name` (mention_inventory rules)."""
    out = {name} | {a for a, canon in aliases.items() if canon.lower() == name.lower()}
    out |= {canon for a, canon in aliases.items() if a.lower() == name.lower()}
    first = name.split()[0]
    firsts = [n.split()[0].lower() for n in roster_names]
    if len(first) > 3 and firsts.count(first.lower()) == 1:
        out.add(first)
    return out


def count_in(text, variants):
    n = 0
    folded = norm_text(text).lower()
    for v in variants:
        n += len(re.findall(r"(?<![\w])" + re.escape(norm_text(v).lower()) + r"(?![\w])", folded))
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("round_id", type=int)
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--md", action="store_true", help="emit a markdown table")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    rnd = db.execute(
        """SELECT r.id, r.name, r.season_id, l.slug FROM rounds r
           JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
           WHERE r.id = ?""", (args.round_id,)).fetchone()
    if not rnd:
        sys.exit(f"round {args.round_id} not found")

    draft = db.execute(
        "SELECT * FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1",
        (args.round_id,)).fetchone()
    if not draft:
        sys.exit(f"no digest draft for round {args.round_id}")

    sections = [(r["kind"], r["content_json"] or "") for r in db.execute(
        "SELECT kind, content_json FROM digest_sections WHERE draft_id = ? ORDER BY position",
        (draft["id"],))]
    for label, col in DRAFT_SLOTS:
        body = draft[col] or ""
        if body.strip() not in ("", "{}"):
            sections.append((label, body))

    aliases = RULES.get(rnd["slug"], {}).get("aliases", {})
    roster = {r["id"]: r["name"] for r in db.execute(
        """SELECT DISTINCT c.id, c.name FROM competitors c
           WHERE c.id IN (SELECT competitor_id FROM ml_submissions WHERE round_id IN
                            (SELECT id FROM rounds WHERE season_id = ?))
              OR c.id IN (SELECT voter_id FROM votes WHERE round_id IN
                            (SELECT id FROM rounds WHERE season_id = ?))""",
        (rnd["season_id"], rnd["season_id"]))}
    active = {r["competitor_id"] for r in db.execute(
        "SELECT competitor_id FROM ml_submissions WHERE round_id = ? AND competitor_id IS NOT NULL",
        (args.round_id,))}
    active |= {r["voter_id"] for r in db.execute(
        "SELECT voter_id FROM votes WHERE round_id = ?", (args.round_id,))}

    names = list(roster.values())
    kinds = [k for k, _ in sections]
    rows = []
    for cid, name in roster.items():
        vs = variants_for(name, names, aliases)
        per = {k: count_in(body, vs) for k, body in sections}
        rows.append({"competitorId": cid, "name": name, "active": cid in active,
                     "sections": per, "total": sum(per.values()),
                     "sectionsPresent": sum(1 for v in per.values() if v)})
    rows.sort(key=lambda r: -r["total"])

    if args.json:
        print(json.dumps({"round": rnd["id"], "league": rnd["slug"],
                          "sectionKinds": kinds, "players": rows}, indent=2))
        return

    headers = ["player"] + kinds + ["TOTAL", "in N"]
    if args.md:
        print(f"### Mentions by section — round {rnd['id']} “{rnd['name']}” ({rnd['slug']})\n")
        print("| " + " | ".join(headers) + " |")
        print("|" + "|".join(["---"] * len(headers)) + "|")
        for r in rows:
            cells = [r["name"] + ("" if r["active"] else " *(inactive)*")]
            cells += [str(r["sections"][k] or "—") for k in kinds]
            cells += [f"**{r['total']}**", f"{r['sectionsPresent']}/{len(kinds)}"]
            print("| " + " | ".join(cells) + " |")
        tot = ["TOTAL"] + [str(sum(r["sections"][k] for r in rows)) for k in kinds]
        tot += [str(sum(r["total"] for r in rows)), ""]
        print("| " + " | ".join(f"**{c}**" for c in tot) + " |")
        return

    w = max(len(n) for n in names) + 1
    print(f"— mention_matrix · round {rnd['id']} “{rnd['name']}” · {rnd['slug']} —")
    print("  " + "player".ljust(w) + "".join(k[:9].rjust(10) for k in kinds)
          + "TOTAL".rjust(8) + "in N".rjust(7))
    for r in rows:
        line = "  " + r["name"].ljust(w)
        line += "".join((str(r["sections"][k]) if r["sections"][k] else "·").rjust(10) for k in kinds)
        line += str(r["total"]).rjust(8) + f"{r['sectionsPresent']}/{len(kinds)}".rjust(7)
        print(line + ("" if r["active"] else "  (inactive)"))
    print("  " + "TOTAL".ljust(w)
          + "".join(str(sum(r["sections"][k] for r in rows)).rjust(10) for k in kinds)
          + str(sum(r["total"] for r in rows)).rjust(8))


if __name__ == "__main__":
    main()
