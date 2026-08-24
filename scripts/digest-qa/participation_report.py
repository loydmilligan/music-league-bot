#!/usr/bin/env python3
"""Per-round participation review page. Spec section 9.

Self-contained HTML, same shape as dupe_review_page.py: no external assets, so
it opens correctly from a phone via an ntfy tap.
"""
import html

CSS = """
body{margin:0;background:#14161a;color:#e8e6e3;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:23px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px;border-top:1px solid #2c3138;padding-top:16px}
.sub{color:#9aa0a6;margin:0 0 20px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid #2c3138;padding:6px 9px;text-align:left}
th{background:#1d2129;color:#9aa0a6;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.down{color:#ff6b6b;font-weight:700}.up{color:#5ec98a}
.note{color:#9aa0a6;font-size:13px}
.empty{border:1px dashed #2c3138;border-radius:8px;padding:14px;color:#9aa0a6}
"""


def render_report(league: str, round_name: str, rows, trend) -> str:
    p = ['<!doctype html><meta charset="utf-8">',
         f"<title>participation · {html.escape(league)}</title>",
         f"<style>{CSS}</style><div class='wrap'>",
         f"<h1>Participation — {html.escape(league)}</h1>",
         f"<p class='sub'>{html.escape(round_name)} · internal. No number here ships to the league.</p>"]

    p.append("<h2>This round</h2><table><tr><th>player</th><th>score</th><th>pct</th>"
             "<th>vs last</th><th>msgs</th><th>days</th><th>vote comments</th></tr>")
    for r in rows:
        d = r.get("delta") or 0
        cls = "down" if d < 0 else "up"
        v = r["vec"]
        p.append(
            f"<tr><td>{html.escape(r['name'])}</td>"
            f"<td class='n'>{r['score']:.1f}</td><td class='n'>{r['pct']:.0f}</td>"
            f"<td class='n {cls}'>{d:+.1f}</td>"
            f"<td class='n'>{v.get('msgs',0):.0f}</td><td class='n'>{v.get('days_active',0):.0f}</td>"
            f"<td class='n'>{v.get('vote_comments',0):.0f}</td></tr>")
    p.append("</table>")

    falling = [r for r in rows if (r.get("delta") or 0) < 0]
    p.append("<h2>Targeting</h2>")
    if falling:
        p.append("<p class='note'>Players falling since last round — candidates to feature:</p><ul>")
        for r in sorted(falling, key=lambda r: r["delta"]):
            v = r["vec"]
            shape = ("talks, never comments" if v.get("msgs") and not v.get("vote_comments")
                     else "comments, never talks" if v.get("vote_comments") and not v.get("msgs")
                     else "present in both channels")
            p.append(f"<li><b>{html.escape(r['name'])}</b> ({r['delta']:+.1f}) — {shape}</li>")
        p.append("</ul>")
    else:
        p.append("<p class='note'>Nobody is falling this round.</p>")

    if trend:
        p.append("<h2>League trend</h2><table><tr><th>round</th><th>mean score</th></tr>")
        for rid, mean in trend:
            p.append(f"<tr><td>{rid}</td><td class='n'>{mean:.1f}</td></tr>")
        p.append("</table>")

    p.append("<h2>Impact</h2><div class='empty'>Reserved for <b>project D</b>: for players "
             "featured in this round's digest, what their participation did next round. "
             "Columns defined, deliberately empty — the join accumulates from now so it is "
             "reconstructable when D starts.</div>")
    p.append("</div>")
    return "\n".join(p)
