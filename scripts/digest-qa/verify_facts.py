#!/usr/bin/env python3
"""Deterministic facts pass for a round's digest draft (WS6.1 step 2 / WS8).

Recomputes ground truth from the votes table with the league's rulecard
applied, then checks the draft's claims against it. Targets the failure
classes F1-F4 from docs/plans/digest-quality-program.md:

  F1 fabricated ballot facts   -> ballot audit + numeric-claim checks
  F2 league rules not encoded  -> rules loaded as data (DB budget + RULES)
  F3 structural rules          -> no-vote penalty + per-league tiebreak cascade
  F4 wrong villain/last place  -> computed last place vs villain section

plus verbatim-quote verification (quotes/consensus sections vs votes,
submission comments, and chat).

Rule *data* comes from the DB where it exists (voting_lab_budget round
override, else season_vote_budget) and from RULES below, which mirrors
docs/league-rulecards/*.md. Leagues absent from RULES get budgets derived
from the ballots themselves (marked DERIVED) and no tiebreak resolution --
ties are reported, not resolved.

Usage: python3 scripts/digest-qa/verify_facts.py <round-id> [--db data/league.db] [--json]
Exit 1 if any FAIL finding.
"""
import argparse, json, re, sqlite3, sys
from collections import defaultdict

# Mirrors docs/league-rulecards/*.md (verified leagues only). Budget numbers
# still come from the DB; these are the rules the DB doesn't hold yet.
RULES = {
    "second-best": {
        "mandatory_downvote": True,
        "no_vote_penalty": "void_upvotes_keep_downvotes",
        "tiebreak": "sb_cascade",  # pts -> more upvoters -> fewer downvoters -> weight sequence
        # (named for where it was first derived; it is the rule in EVERY league)
        # ML display name -> digest name (rulecard "Voice / conventions").
        "aliases": {"monicac1217": "Michael Black", "Mashew": "Matt Mariani",
                    "Jonathan Black": "Jon Black", "missmara": "Mara Mariani"},
    },
    "fam-jam": {
        "mandatory_downvote": False,
        "no_vote_penalty": "void_upvotes",
        "tiebreak": "sb_cascade",  # league-universal cascade (Matt, 2026-08-20);
        # supersedes the "voter_count" inference from the R127 Lasagna precedent,
        # which is just step 2 of the same cascade. R127 ranking unchanged.
        "aliases": {"Jorbo": "Jordan Bekier", "missmara": "Mara Mariani",
                    "Mashew": "Matt Mariani", "Em": "Emily Freidman",
                    "Bri": "Brianna Bekier", "M g": "Marc Grey"},
    },
    "boarz-ii-men": {
        "mandatory_downvote": False,  # up to 2; mandatoriness UNRESOLVED
        "no_vote_penalty": "void_upvotes_keep_downvotes",  # R147 Grant Koziol precedent
        "tiebreak": "sb_cascade",  # league-universal cascade (Matt, 2026-08-20);
        # first applied R148 (Rusty Cage over Dixieland Delight, 6 upvoters to 5)
        "aliases": {"Mashew": "Matt Mariani", "Jonathan Black": "Jon Black",
                    "djensen37": "Jensen", "Grant Koziol": "Kozh",
                    "CJ Wookie": "Conor"},
    },
    "sssc": {
        "mandatory_downvote": False,
        "no_downvotes": True,  # zero negative points across all observed rounds
        "no_vote_penalty": None,  # UNKNOWN -- no precedent yet
        "tiebreak": "sb_cascade",  # league-universal cascade (Matt, 2026-08-20)
        "aliases": {"missmara": "Mara Mariani", "Boonie Dogsweat": "Dogsweat"},
    },
}


def norm_text(s):
    """Whitespace/typographic normalization for verbatim-quote comparison."""
    if s is None:
        return ""
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = s.replace("—", "-").replace("–", "-")
    s = s.replace(" ", " ").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


class Report:
    def __init__(self):
        self.findings = []  # (level, check, detail)

    def add(self, level, check, detail):
        self.findings.append({"level": level, "check": check, "detail": detail})

    def fail(self, check, detail):
        self.add("FAIL", check, detail)

    def warn(self, check, detail):
        self.add("WARN", check, detail)

    def ok(self, check, detail):
        self.add("OK", check, detail)

    @property
    def failed(self):
        return any(f["level"] == "FAIL" for f in self.findings)


def load_round(db, round_id):
    row = db.execute(
        """SELECT r.id, r.name, r.season_id, s.season_number, l.slug, l.name AS league_name
           FROM rounds r JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id WHERE r.id = ?""",
        (round_id,),
    ).fetchone()
    if not row:
        sys.exit(f"round {round_id} not found")
    return dict(row)


def load_budget(db, rnd, ballots, rpt):
    for src, q, key in (
        ("round override", "SELECT up_total, down_total, per_song_cap FROM voting_lab_budget WHERE round_id = ?", rnd["id"]),
        ("season budget", "SELECT up_total, down_total, per_song_cap FROM season_vote_budget WHERE season_id = ?", rnd["season_id"]),
    ):
        row = db.execute(q, (key,)).fetchone()
        if row:
            return {"up": row["up_total"], "down": row["down_total"], "cap": row["per_song_cap"], "src": src}
    # Derive from ballots: modal per-voter positive sum / negative count.
    ups = defaultdict(int)
    downs = defaultdict(int)
    for (voter, _uri), pts in ballots.items():
        if pts > 0:
            ups[voter] += pts
        elif pts < 0:
            downs[voter] += 1
    def mode(vals):
        return max(set(vals), key=list(vals).count) if vals else 0
    b = {"up": mode(list(ups.values())), "down": mode(list(downs.values())), "cap": None, "src": "DERIVED from ballots"}
    rpt.warn("budget", f"no stored budget for this round/season; derived {b['up']} up / {b['down']} down from ballot modes")
    return b


def ground_truth(db, rnd, rules, rpt):
    """Song totals, ballots, penalty application, ranking with tiebreaks."""
    subs = {r["spotify_uri"]: dict(r) for r in db.execute(
        """SELECT m.spotify_uri, m.title, m.artists, m.comment, m.competitor_id, c.name AS submitter
           FROM ml_submissions m LEFT JOIN competitors c ON c.id = m.competitor_id
           WHERE m.round_id = ?""", (rnd["id"],))}
    votes = [dict(r) for r in db.execute(
        """SELECT v.voter_id, c.name AS voter, v.spotify_uri, v.points, v.comment
           FROM votes v JOIN competitors c ON c.id = v.voter_id WHERE v.round_id = ?""", (rnd["id"],))]

    ballots = {(v["voter_id"], v["spotify_uri"]): v["points"] for v in votes}
    voters = {v["voter_id"]: v["voter"] for v in votes}
    submitters = {s["competitor_id"]: s["submitter"] for s in subs.values() if s["competitor_id"]}

    # No-vote penalty: submitters who never voted.
    non_voters = {cid: n for cid, n in submitters.items() if cid not in voters}
    penalty = rules.get("no_vote_penalty")
    songs = {}
    for uri, s in subs.items():
        sv = [v for v in votes if v["spotify_uri"] == uri]
        raw = sum(v["points"] for v in sv)
        up_pts = sum(v["points"] for v in sv if v["points"] > 0)
        down_pts = sum(v["points"] for v in sv if v["points"] < 0)
        official = raw
        voided = False
        if s["competitor_id"] in non_voters and penalty:
            voided = True
            official = down_pts if penalty == "void_upvotes_keep_downvotes" else 0
        songs[uri] = {
            **s, "raw": raw, "official": official, "voided": voided,
            "upvoters": sum(1 for v in sv if v["points"] > 0),
            "downvoters": sum(1 for v in sv if v["points"] < 0),
            "voter_count": sum(1 for v in sv if v["points"] != 0),
            "weights": sorted((v["points"] for v in sv if v["points"] > 0), reverse=True),
        }
    if non_voters:
        rpt.warn("no-vote penalty", f"submitters with no ballot: {', '.join(non_voters.values())}"
                 + (f" -> penalty '{penalty}' applied" if penalty else " -> league rules unknown, NO penalty applied"))

    # Ranking with the league's tiebreak cascade.
    tb = rules.get("tiebreak")
    def keyfn(x):
        s = songs[x]
        if tb == "sb_cascade":
            return (-s["official"], -s["upvoters"], s["downvoters"], [-w for w in s["weights"]])
        if tb == "voter_count":
            return (-s["official"], -s["voter_count"])
        return (-s["official"],)
    ranking = sorted(songs, key=keyfn)
    # Flag unresolved ties for leagues without a cascade.
    if not tb:
        by_pts = defaultdict(list)
        for uri in ranking:
            by_pts[songs[uri]["official"]].append(songs[uri]["title"])
        for pts, titles in by_pts.items():
            if len(titles) > 1:
                rpt.warn("tiebreak", f"unresolved tie at {pts} pts: {' / '.join(titles)} (league tiebreak rules not encoded)")
    return songs, ranking, votes, voters, ballots


def ballot_audit(votes, voters, submitters_by_cid, budget, rules, rpt):
    per_voter = defaultdict(lambda: {"up": 0, "down": 0, "cap_hits": []})
    for v in votes:
        pv = per_voter[v["voter_id"]]
        if v["points"] > 0:
            pv["up"] += v["points"]
            if budget["cap"] and v["points"] > budget["cap"]:
                pv["cap_hits"].append((v["spotify_uri"], v["points"]))
        elif v["points"] < 0:
            pv["down"] += 1
        if v["voter_id"] in submitters_by_cid and v["spotify_uri"] == submitters_by_cid[v["voter_id"]] and v["points"] != 0:
            rpt.fail("self-vote", f"{voters[v['voter_id']]} put {v['points']} pts on their own song")
    for vid, pv in per_voter.items():
        name = voters[vid]
        if budget["up"] and pv["up"] != budget["up"]:
            rpt.warn("budget", f"{name} spent {pv['up']} upvote pts (budget {budget['up']}, {budget['src']})")
        if rules.get("mandatory_downvote") and pv["down"] < budget["down"]:
            rpt.warn("budget", f"{name} filed {pv['down']} downvotes (mandatory {budget['down']})")
        for uri, pts in pv["cap_hits"]:
            rpt.fail("per-song cap", f"{name} gave {pts} pts to one song (cap {budget['cap']})")


def load_draft_sections(db, round_id):
    draft = db.execute(
        "SELECT * FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1", (round_id,)).fetchone()
    if not draft:
        return None, []
    secs = db.execute("SELECT kind, content_json FROM digest_sections WHERE draft_id = ?", (draft["id"],)).fetchall()
    out = []
    for s in secs:
        try:
            out.append((s["kind"], json.loads(s["content_json"])))
        except (json.JSONDecodeError, TypeError):
            out.append((s["kind"], {}))
    return dict(draft), out


def same_person(a, b, aliases):
    """Names match directly or through the league's alias map (either way)."""
    na, nb = norm_text(a or "").lower(), norm_text(b or "").lower()
    if na == nb:
        return True
    amap = {norm_text(k).lower(): norm_text(v).lower() for k, v in aliases.items()}
    return amap.get(na) == nb or amap.get(nb) == na


def check_podium(content, songs, ranking, rules, rpt):
    aliases = rules.get("aliases", {})
    items = content.get("items") or []
    top = ranking[: len(items)]
    for i, item in enumerate(items):
        if i >= len(top):
            break
        truth = songs[top[i]]
        want = f"#{i+1} {truth['title']} ({truth['submitter']}, {truth['official']} pts)"
        got = f"{item.get('title')} ({item.get('submitter')}, {item.get('points')} pts)"
        t_title = norm_text(truth["title"]).lower()
        i_title = norm_text(item.get("title", "")).lower()
        if t_title not in i_title and i_title not in t_title:
            # Point-tied slots in a league without an encoded tiebreak are an
            # ordering coin flip, not a factual error.
            draft_pts = item.get("points")
            if draft_pts == truth["official"] and not rules.get("tiebreak"):
                rpt.warn("podium tie order", f"slot {i+1}: draft has {got}, computed {want} -- "
                         "tied points, league tiebreak not encoded")
            else:
                rpt.fail("podium order", f"slot {i+1}: draft has {got}, computed {want}")
        elif item.get("points") != truth["official"]:
            rpt.fail("podium points", f"{item.get('title')}: draft says {item.get('points')}, votes say {truth['official']}")
        elif not same_person(item.get("submitter", ""), truth["submitter"], aliases):
            rpt.fail("podium submitter", f"{item.get('title')}: draft credits {item.get('submitter')}, actual {truth['submitter']}")
        else:
            rpt.ok("podium", f"slot {i+1}: {want}")


def check_villain(content, songs, ranking, rpt):
    if not ranking:
        return
    last = songs[ranking[-1]]
    body = norm_text(json.dumps(content)).lower()
    hits = [norm_text(x or "").lower() in body for x in (last["title"], last["submitter"])]
    if not any(hits):
        rpt.fail("villain", f"computed last place is '{last['title']}' ({last['submitter']}, {last['official']} pts"
                 + (", upvotes voided" if last["voided"] else "") + ") but villain section mentions neither song nor submitter")
    else:
        rpt.ok("villain", f"last place '{last['title']}' ({last['official']} pts) is the villain section's subject")


def build_corpus(db, rnd, votes, songs):
    corpus = []  # (normalized text, source label)
    for v in votes:
        if v["comment"]:
            corpus.append((norm_text(v["comment"]), f"vote comment by {v['voter']}"))
    for s in songs.values():
        if s["comment"]:
            corpus.append((norm_text(s["comment"]), f"submission comment on {s['title']}"))
    # League -> chat group mapping lives in settings JSON (exact group_name).
    row = db.execute("SELECT value FROM settings WHERE key = 'chat_league_group_map'").fetchone()
    group = (json.loads(row["value"]) if row else {}).get(rnd["slug"], "")
    if group:
        for r in db.execute("SELECT sender, text FROM chat_messages WHERE group_name = ?", (group,)):
            corpus.append((norm_text(r["text"]), f"chat ({r['sender']})"))
    return corpus


def check_quotes(sections, corpus, rpt):
    quoted = []  # (quote, where)
    for kind, content in sections:
        if kind == "quotes":
            for item in content.get("items") or []:
                if item.get("quote"):
                    q = item["quote"].strip()
                    # Editorial annotations aren't part of the quote:
                    # '"There's no excuse for this." [-2 on "You Oughta Know"]'
                    q = re.sub(r"\s*\[[^\]]*\]\s*$", "", q)
                    q = q.strip().strip('"“”').strip()
                    quoted.append((q, f"quotes section ({item.get('voter', '?')})"))
        elif kind == "consensus":
            for item in content.get("items") or []:
                # Double-quoted fragments only: single quotes collide with
                # apostrophes. Match ALL pairs non-greedily first, THEN filter
                # by length -- a length floor in the regex makes a short
                # quote's closing mark pair with the next quote's opening mark.
                for frag in re.findall(r'[\"“]([^\"”]+?)[\"”]', item.get("agreement", "")):
                    if len(frag) >= 15:
                        quoted.append((frag, f"consensus ({item.get('song', '?')})"))
    for quote, where in quoted:
        # A draft quote may be editorially condensed with ellipses; every
        # fragment must verify, and against the SAME source text.
        frags = [f for f in re.split(r"\.\.\.|…", norm_text(quote)) if f.strip()]
        # Punch-up routinely tidies terminal punctuation ("porn star" ->
        # "porn star.") -- compare fragments without their trailing marks.
        frags = [f.strip().rstrip(".!?,;:").strip() for f in frags]
        frags = [f for f in frags if f]
        full_hits = [src for c, src in corpus if all(f in c for f in frags)]
        if full_hits:
            note = " (condensed)" if len(frags) > 1 else ""
            rpt.ok("quote verbatim", f"{where}: verified{note}")
        elif all(any(f in c for c, _ in corpus) for f in frags):
            rpt.warn("quote spliced?", f"{where}: fragments verify but not from one source -- check: \"{quote[:70]}\"")
        elif any(_loose(norm_text(quote)) in _loose(c) for c, _ in corpus):
            rpt.warn("quote near-match", f"{where}: matches only after punctuation stripped -- check: \"{quote[:70]}\"")
        else:
            rpt.fail("quote fabricated?", f"{where}: not found in votes/submissions/chat: \"{quote[:70]}\"")


def _loose(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower())


def check_numeric_claims(sections, songs, standings_totals, budget, votes, rpt):
    known = {s["official"] for s in songs.values()} | {s["raw"] for s in songs.values()}
    known |= set(standings_totals) | {budget["up"], budget["down"], budget["cap"] or 0}
    known |= {len({v["voter_id"] for v in votes}), len(songs)}
    # Individual vote values ("gave it 3 pts") and per-song voter tallies.
    known |= {abs(v["points"]) for v in votes}
    known |= {s["upvoters"] for s in songs.values()} | {s["downvoters"] for s in songs.values()}
    text = " ".join(norm_text(json.dumps(c)) for _, c in sections)
    for m in re.finditer(r"\b(\d{1,3})[- ](?:point|pt)s?\b|\b(\d{1,3}) (?:points|pts)\b", text):
        n = int(m.group(1) or m.group(2))
        # "0 points / 0-point" describes comments-without-points; always legit.
        if n != 0 and n not in known:
            rpt.warn("numeric claim", f"'{m.group(0)}' matches no computed song total, standing, budget, or count")


def check_downvote_language(sections, rules, rpt):
    """A league with no downvote mechanic must never be described as having
    one (F2). R166 sssc: 'a solitary downvote cutting through' -- fabricated."""
    if not rules.get("no_downvotes"):
        return
    pat = re.compile(r"downvot\w*|down-vot\w*|voted against", re.I)
    for kind, content in sections:
        for m in pat.finditer(norm_text(json.dumps(content))):
            ctx_start = max(0, m.start() - 40)
            ctx = norm_text(json.dumps(content))[ctx_start:m.end() + 20]
            rpt.fail("downvote language", f"{kind} section: league has NO downvote mechanic but draft says "
                     f"\"...{ctx}...\"")


def check_standings(db, rnd, rpt):
    stored = db.execute(
        "SELECT competitor_id, name, current_total, rank FROM season_standings WHERE round_id = ?",
        (rnd["id"],)).fetchall()
    if not stored:
        rpt.warn("standings", "no season_standings rows for this round (generation reconcile never ran?)")
        return []
    rounds = [r["id"] for r in db.execute(
        "SELECT id FROM rounds WHERE season_id = ? AND id <= ? ORDER BY id", (rnd["season_id"], rnd["id"]))]
    ph = ",".join("?" * len(rounds))
    computed = {r["cid"]: r["pts"] for r in db.execute(
        f"""SELECT m.competitor_id AS cid, COALESCE(SUM(v.points),0) AS pts
            FROM ml_submissions m LEFT JOIN votes v
              ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
            WHERE m.round_id IN ({ph}) AND m.competitor_id IS NOT NULL
            GROUP BY m.competitor_id""", rounds)}
    bad = 0
    for row in stored:
        c = computed.get(row["competitor_id"])
        if c is not None and c != row["current_total"]:
            # season_standings is human-verified gospel; a diff is a flag, not
            # automatically an error (penalties/edits are legitimate causes).
            rpt.warn("standings diff", f"{row['name']}: stored {row['current_total']} vs raw recompute {c} "
                     "(legit if a penalty/hand-edit applies -- confirm)")
            bad += 1
    if not bad:
        rpt.ok("standings", f"all {len(stored)} stored totals match raw recompute")
    return [row["current_total"] for row in stored]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("round_id", type=int)
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    rpt = Report()

    rnd = load_round(db, args.round_id)
    rules = RULES.get(rnd["slug"], {})
    if not rules:
        rpt.warn("rulecard", f"league '{rnd['slug']}' has no encoded rules (stub rulecard) -- "
                 "penalty/tiebreak checks limited")

    songs, ranking, votes, voters, ballots = ground_truth(db, rnd, rules, rpt)
    if not songs:
        sys.exit(f"round {args.round_id} has no submissions -- nothing to verify")
    budget = load_budget(db, rnd, ballots, rpt)
    submitters_by_cid = {s["competitor_id"]: uri for uri, s in songs.items() if s["competitor_id"]}
    ballot_audit(votes, voters, submitters_by_cid, budget, rules, rpt)

    draft, sections = load_draft_sections(db, args.round_id)
    if draft is None:
        rpt.warn("draft", "no digest draft for this round; ground-truth checks only")
    else:
        standings_totals = check_standings(db, rnd, rpt)
        corpus = build_corpus(db, rnd, votes, songs)
        for kind, content in sections:
            if kind == "podium":
                check_podium(content, songs, ranking, rules, rpt)
            elif kind == "villain":
                check_villain(content, songs, ranking, rpt)
        check_quotes(sections, corpus, rpt)
        check_numeric_claims(sections, songs, standings_totals, budget, votes, rpt)
        check_downvote_language(sections, rules, rpt)

    if args.json:
        print(json.dumps({"round": rnd["id"], "league": rnd["slug"], "findings": rpt.findings}, indent=2))
    else:
        print(f"— verify_facts · round {rnd['id']} “{rnd['name']}” · {rnd['slug']} S{rnd['season_number']} —")
        print(f"  budget: {budget['up']} up / {budget['down']} down / cap {budget['cap']} ({budget['src']})")
        for lvl in ("FAIL", "WARN", "OK"):
            for f in rpt.findings:
                if f["level"] == lvl:
                    print(f"  [{lvl}] {f['check']}: {f['detail']}")
        n_fail = sum(1 for f in rpt.findings if f["level"] == "FAIL")
        n_warn = sum(1 for f in rpt.findings if f["level"] == "WARN")
        print(f"  => {n_fail} FAIL · {n_warn} WARN · {len(rpt.findings) - n_fail - n_warn} OK")
    sys.exit(1 if rpt.failed else 0)


if __name__ == "__main__":
    main()
