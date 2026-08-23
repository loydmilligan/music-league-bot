#!/usr/bin/env python3
"""Render a round's digest as a marked-up review page (WS6.1 step 5, human half).

`dedupe_scan.py` catches verbatim n-gram collisions. It cannot catch the same
BEAT told twice in different words, which is most of what a punch-up actually
has to fix. Those findings are a judgement call, so this tool doesn't try to
detect them — it takes findings as data and renders the digest with them marked
in place, in plain language, so the decisions can be made by looking rather than
by holding eight section names in your head.

Findings live in FINDINGS below: each one names the text span it attaches to and
whether the recommendation is to cut it, keep it, or decide.

Usage: python3 scripts/digest-qa/dupe_review_page.py <round-id> [--db …] [--out …]
"""
import argparse, collections, html, json, os, re, sqlite3, sys

# Plain-English names, because "the consensus section" means nothing to a reader
# who didn't build the schema.
SECTION_LABELS = {
    "podium": ("Podium", "the top three songs"),
    "villain": ("Villain", "last place"),
    "flow": ("Flow", "how the round went overall"),
    "consensus": ("Consensus", "where the league agreed, song by song"),
    "quotes": ("Quotes", "voter commentary pulled out"),
    "chat": ("Chat", "off-mic — what happened in WhatsApp"),
    "storylines": ("The Usual Suspects", "the recurring-character cards"),
    "stats": ("Coinage", "word of the round"),
    "guesser": ("The Guesser", "submitter-guessing leaderboard"),
}

# id, verdict, one-line claim, where else it lives, recommendation, and the exact
# substrings to highlight (section -> list of spans).
FINDINGS = [
    {"id": 1, "verdict": "cut", "title": "The auto-harp trial is told twice, in full",
     "detail": "Flow spends a paragraph on Jon Black demanding evidence for the auto-harp and calls it "
               "“the only downvote in league history to arrive with an appeals process attached.” "
               "The Litigator card then makes the same argument with the same quotes.",
     "fix": "Flow hands the auto-harp and mandolin beats to The Litigator and keeps only the part the "
            "card can't carry: that Jon's own entry was a harmonica that finished ninth.",
     "spans": {
        "flow": ["and he opened formal proceedings against Michael Layous's Mitski submission, demanding documentary evidence that the instrument named in Layous's submission comment is audible in the recording at all, and posting a +2 bounty next round if it can be produced. It is the only downvote in league history to arrive with an appeals process attached."],
        "storylines": ["He attached an appeals process to a downvote, conceded a point while denying its premise"],
     }},
    {"id": 2, "verdict": "cut", "title": "The mandolin concession, twice",
     "detail": "Flow paraphrases Jon conceding the point he was always going to award. The Litigator "
               "card carries the verbatim line right underneath.",
     "fix": "Drop the paraphrase from Flow; the card's quote is better.",
     "spans": {
        "flow": ["he informed Philip Chapin that a mandolin is \"unique for Led Zeppelin, but not necessarily for the folk-style genre this song would fall into\" — while conceding, in the same breath, that the objection changed nothing about the point he was always going to award —"],
        "storylines": ["I say this only to be annoying.  I was always going to give it +1."],
     }},
    {"id": 3, "verdict": "cut", "title": "The three podium blurbs just restate the podium paragraph",
     "detail": "Each song's one-line blurb repeats a sentence from the paragraph below it — the clean "
               "sheet, Tj's +6, and Some Cut being the most-discussed. Nothing renders them today, so "
               "this is invisible on the page, but it is live data if the layout ever changes.",
     "fix": "Blank the three blurbs, or shorten them to something the paragraph doesn't say.",
     "spans": {"podium": ["Nine upvoters, no downvotes, in a week where every voter was required to knife something.",
                          "Tj Cook spent the full +6 cap on it — the largest single vote of the round — then announced it in the chat.",
                          "A bedspring. Third place, and comfortably the most-discussed song of the week."]}},
    {"id": 4, "verdict": "cut", "title": "Both Sarahs knifing Philip's Zeppelin, stated twice",
     "detail": "Flow says Sarah Zucker apologised for her downvote and then watched Sarah Black spend "
               "hers on the same song. Consensus says the same thing two hundred words later.",
     "fix": "Keep it in Flow, where the apology quote lives; cut the restatement from Consensus.",
     "spans": {
        "flow": ["to Philip Chapin, who then watched Sarah Black spend hers on the same song."],
        "consensus": ["and both of the league's Sarahs spent their mandatory knife on it"],
     }},
    {"id": 5, "verdict": "cut", "title": "Michael Black's rubric described three ways",
     "detail": "Flow opens on it, the Coinage card's origin line explains it, and the Cat Lobby card "
               "uses it as the trigger. The last two have their own angle. Flow's is filler.",
     "fix": "Cut Flow's opening clause and start on the instrument roll call.",
     "spans": {
        "flow": ["Michael Black spent the week trying to impose a scoring rubric on a round that did not need one; everyone else simply named their instrument and got on with it."],
        "stats": ["while attempting to legislate a Prominence-and-Unusualness rubric onto a round about cowbells"],
        "storylines": ["A theme about unusual instruments produced, unprompted, a scoring scale with a cat at one end"],
     }},
    {"id": 6, "verdict": "cut", "title": "Michael Black downvoting Rasputin, twice",
     "detail": "Consensus reports it flatly. The chat's Downvote Market ends on it as the punchline.",
     "fix": "The punchline wins. Drop the attribution from Consensus.",
     "spans": {
        "consensus": ["and one downvote from Michael Black"],
        "chat": ["Michael Black downvoted Sarah Black's Rasputin instead."],
     }},
    {"id": 7, "verdict": "decide", "title": "Guttermilk's clean sheet in three places",
     "detail": "The 9-up/0-down stat appears in the podium blurb, the podium paragraph, and again in "
               "Consensus. And “clean sheet” is used as a phrase in both Podium and Consensus.",
     "fix": "Podium keeps the number, Consensus keeps the breakdown of who paid what. Or leave it — "
            "the second “clean sheet” reads as a deliberate callback.",
     "spans": {
        "podium": ["one of only two clean sheets in a week where all thirteen voters were obliged to spend a downvote"],
        "consensus": ["Nine upvoters, zero downvotes.", "The round's other clean sheet:"],
     }},
    {"id": 8, "verdict": "decide", "title": "Sarah Zucker apologises three times, and we never name it",
     "detail": "Three sections, three different apologies, no acknowledgement that it's a pattern. She "
               "apologised for a downvote the rules forced her to cast, apologised for running out of "
               "points, and apologised on a song she liked.",
     "fix": "Not really duplication — an un-named running bit. Promote it to a third Regulars card, "
            "The Apologist. Also fixes her thin spread across sections.",
     "spans": {
        "flow": ["Sarah Zucker apologised for hers in writing — *\"I'm so sorry you didn't deserve the downvote\"*"],
        "villain": ["Sarah Zucker filed a nothing and an apology"],
        "quotes": ["A surprise kazoo was a good choice. I'm sorry I ran out points."],
     }},
]

CSS = """
:root{--bg:#14161a;--fg:#e8e6e3;--muted:#9aa0a6;--line:#2c3138;--cut:#ff6b6b;--keep:#5ec98a;--dec:#e8b64c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 120px}
h1{font-size:26px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 26px}
.legend{position:sticky;top:0;background:#181b20;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:26px;z-index:5}
.legend b{display:block;margin-bottom:8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.key{display:flex;gap:18px;flex-wrap:wrap;font-size:14px}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:6px}
section.sec{border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:0 0 20px;background:#181b20}
section.sec>h2{margin:0 0 2px;font-size:19px}
section.sec>h2 small{font-weight:400;color:var(--muted);font-size:14px;margin-left:8px}
.kind{color:var(--muted);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-bottom:12px}
p.body{margin:0 0 12px;white-space:pre-wrap}
.item{border-left:2px solid var(--line);padding:6px 0 6px 14px;margin:0 0 10px}
.item .h{font-weight:600}
.lbl{color:var(--muted);font-size:13px}
mark{border-radius:3px;padding:1px 3px;color:#fff}
mark.cut{background:rgba(255,107,107,.22);box-shadow:inset 0 -2px 0 var(--cut);color:#ffd9d9}
mark.decide{background:rgba(232,182,76,.18);box-shadow:inset 0 -2px 0 var(--dec);color:#ffeec4}
.badge{display:inline-block;min-width:18px;height:18px;line-height:18px;text-align:center;border-radius:9px;
  font-size:11px;font-weight:700;margin:0 4px;vertical-align:1px;color:#14161a}
.badge.cut{background:var(--cut)}.badge.decide{background:var(--dec)}
.findings{margin:0 0 30px}
.f{border:1px solid var(--line);border-left-width:4px;border-radius:8px;padding:12px 14px;margin:0 0 10px;background:#181b20}
.f.cut{border-left-color:var(--cut)}.f.decide{border-left-color:var(--dec)}
.f h3{margin:0 0 6px;font-size:16px}
.f p{margin:0 0 6px}
.f .fix{color:var(--keep)}
.f .where{color:var(--muted);font-size:13px;font-family:ui-monospace,Menlo,monospace}
.verdict{font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;padding:2px 7px;border-radius:4px;margin-right:8px}
.verdict.cut{background:var(--cut);color:#14161a}.verdict.decide{background:var(--dec);color:#14161a}
"""


def mark_text(text, section_kind, spans_by_id):
    """Wrap each finding's span in a <mark>, longest-first so nesting can't happen."""
    out = html.escape(text)
    hits = []
    for fid, verdict, span in spans_by_id.get(section_kind, []):
        hits.append((len(span), fid, verdict, html.escape(span)))
    for _, fid, verdict, esc in sorted(hits, reverse=True):
        if esc in out:
            out = out.replace(
                esc, f'<mark class="{verdict}">{esc}<span class="badge {verdict}">{fid}</span></mark>', 1)
    return out


def render_value(v, kind, spans, indent=0):
    if isinstance(v, str):
        return f'<p class="body">{mark_text(v, kind, spans)}</p>'
    if isinstance(v, list):
        return "".join(f'<div class="item">{render_value(x, kind, spans)}</div>' for x in v)
    if isinstance(v, dict):
        parts = []
        for k, val in v.items():
            if k in ("coverUrl", "src", "poster", "alt", "style", "highlight"):
                continue
            if not val:
                continue
            if isinstance(val, str):
                parts.append(f'<div><span class="lbl">{html.escape(k)}:</span> '
                             f'{mark_text(val, kind, spans)}</div>')
            else:
                parts.append(f'<div class="lbl">{html.escape(k)}</div>{render_value(val, kind, spans)}')
        return "".join(parts)
    return f"<div>{html.escape(str(v))}</div>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("round_id", type=int)
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    rnd = db.execute("SELECT r.id, r.name, l.slug FROM rounds r JOIN seasons s ON s.id=r.season_id "
                     "JOIN leagues l ON l.id=s.league_id WHERE r.id=?", (args.round_id,)).fetchone()
    draft = db.execute("SELECT * FROM digest_drafts WHERE round_id=? ORDER BY generated_at DESC LIMIT 1",
                       (args.round_id,)).fetchone()
    if not rnd or not draft:
        sys.exit(f"no draft for round {args.round_id}")

    sections = [(r["kind"], json.loads(r["content_json"])) for r in db.execute(
        "SELECT kind, content_json FROM digest_sections WHERE draft_id=? ORDER BY position", (draft["id"],))]
    for label, col in (("stats", "stats_content_json"), ("guesser", "guesser_content_json")):
        body = draft[col] or ""
        if body.strip() not in ("", "{}"):
            sections.append((label, json.loads(body)))

    spans = {}
    for f in FINDINGS:
        for kind, ss in f["spans"].items():
            spans.setdefault(kind, []).extend((f["id"], f["verdict"], s) for s in ss)

    parts = [f'<!doctype html><meta charset="utf-8"><title>R{rnd["id"]} duplicate review</title>',
             f"<style>{CSS}</style>", '<div class="wrap">',
             f'<h1>Duplicate review — R{rnd["id"]} “{html.escape(rnd["name"])}”</h1>',
             f'<p class="sub">{html.escape(rnd["slug"])} · the digest as it stands, with repeated '
             f'material marked in place. Numbers link a highlight to a finding.</p>',
             '<div class="legend"><b>key</b><div class="key">'
             '<span><i class="sw" style="background:#ff6b6b"></i>recommend cutting this instance</span>'
             '<span><i class="sw" style="background:#e8b64c"></i>your call</span>'
             '<span>everything unmarked stays as-is</span></div></div>',
             '<div class="findings">']

    for f in FINDINGS:
        where = " · ".join(f'{SECTION_LABELS.get(k, (k, ""))[0]}' for k in f["spans"])
        parts.append(
            f'<div class="f {f["verdict"]}"><h3><span class="badge {f["verdict"]}">{f["id"]}</span> '
            f'{html.escape(f["title"])}</h3>'
            f'<p><span class="verdict {f["verdict"]}">{f["verdict"]}</span>{html.escape(f["detail"])}</p>'
            f'<p class="fix">→ {html.escape(f["fix"])}</p>'
            f'<p class="where">appears in: {html.escape(where)}</p></div>')
    parts.append("</div>")

    for kind, content in sections:
        name, gloss = SECTION_LABELS.get(kind, (kind.title(), ""))
        title = content.get("title") if isinstance(content, dict) else None
        parts.append(f'<section class="sec"><h2>{html.escape(name)}<small>{html.escape(gloss)}</small></h2>'
                     f'<div class="kind">section kind: <code>{html.escape(kind)}</code>'
                     + (f' · headline: “{html.escape(title)}”' if title else "") + "</div>")
        body = dict(content) if isinstance(content, dict) else content
        if isinstance(body, dict):
            body.pop("title", None)
        parts.append(render_value(body, kind, spans))
        parts.append("</section>")

    parts.append("</div>")
    out = args.out or os.path.join("out", f"r{rnd['id']}-duplicate-review.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as fh:
        fh.write("\n".join(parts))
    print(f"wrote {out}")
    page = "\n".join(parts)
    placed = collections.Counter(
        int(m) for m in re.findall(r'class="badge (?:cut|decide)">(\d+)</span></mark>', page))
    bad = [(f["id"], sum(len(v) for v in f["spans"].values()) - placed[f["id"]]) for f in FINDINGS
           if placed[f["id"]] != sum(len(v) for v in f["spans"].values())]
    if bad:
        for fid, missing in bad:
            print(f"WARNING: finding {fid}: {missing} span(s) matched no text", file=sys.stderr)
        sys.exit(1)
    print(f"all {sum(placed.values())} highlights placed")


if __name__ == "__main__":
    main()
