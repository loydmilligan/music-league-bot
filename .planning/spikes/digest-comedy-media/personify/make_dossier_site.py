#!/usr/bin/env python3
"""
make_dossier_site.py — one browsable site for every persona dossier.

The dossiers are the source of truth for what a person sounds like, and they are
the thing you actually consult mid-rating ("is that really how Layous opens?").
As ten-plus markdown files they were unreadable in practice: no index, no way to
compare two people, no sense of which ones rest on real evidence.

Two leagues, kept visibly apart:

  Boarz II Men   profiles/*.md              the original ten
  Second Best    profiles/second_best/*.md  the family-and-old-friends league

They are separated because the same person writes differently in each room —
Matt comments on 85% of his Boarz ballots and 33% of his Second Best ones — so a
Boarz dossier is not evidence about Second Best behaviour, and merging the two
namespaces would quietly imply it was.

Every dossier is stamped with its real corpus volume, because dossier quality
tracks evidence volume closely and the reader deserves to see the denominator: a
profile built on 476 messages and one built on 23 look identical in markdown and
are not remotely equal.

Self-contained output — no network, no build step, no dependencies. Open the file.

Usage:  .venv/bin/python make_dossier_site.py
"""
from __future__ import annotations
import html
import json
import re
from pathlib import Path

import corpus

HERE = Path(__file__).resolve().parent
OUT = HERE / "dossiers.html"

LEAGUES = [
    ("boarz", "Boarz II Men", HERE / "profiles",
     "The original ten. Everything the #trans2 spike was measured on."),
    ("second_best", "Second Best", HERE / "profiles" / "second_best",
     "Family and old friends. Surnames collide here — three Blacks, three Chapins, "
     "two Marianis, two Michaels, two Sarahs — so mentions were split into confident "
     "and ambiguous sets before any dossier was written."),
]

# Corpus display names that differ from the sender string stored in the data.
DISPLAY = {"MIchael Black": "Michael Black"}


# ---------------------------------------------------------------- markdown

# Bold runs non-greedily and BEFORE italics, because the dossiers nest italics
# inside bold ("**a *joint* feature**"); a bold pattern forbidding inner asterisks
# leaves those spans as literal ** on the page.
_CODE = re.compile(r"`([^`]+)`")
_INLINE = [
    (re.compile(r"\*\*(.+?)\*\*"), r"<strong>\1</strong>"),
    (re.compile(r"(?<![*\w])\*([^*\n]+)\*(?!\*)"), r"<em>\1</em>"),
]


def inline(s: str) -> str:
    """Escape first, then apply inline markup — never the other way around, or a
    dossier quoting a literal <tag> from the chat would inject it into the page.

    Code spans are pulled out before the emphasis passes and restored after. One
    dossier documents a person's habit using a literal `**` inside backticks; left
    in place, the bold pass matched those asterisks and ate the <code> tag."""
    s = html.escape(s)
    spans: list[str] = []

    def stash(m):
        spans.append(m.group(1))
        return f"\x00{len(spans) - 1}\x00"

    s = _CODE.sub(stash, s)
    for rx, rep in _INLINE:
        s = rx.sub(rep, s)
    return re.sub(r"\x00(\d+)\x00", lambda m: f"<code>{spans[int(m.group(1))]}</code>", s)


def _row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def md(text: str) -> str:
    """Just enough markdown for what the dossiers actually contain: headings,
    tables, blockquotes, ordered/unordered lists, rules, bold/italic/code. No
    fenced code blocks — none of the dossiers use them."""
    lines = text.split("\n")
    out: list[str] = []
    i, n = 0, len(lines)
    list_tag: str | None = None

    def close_list():
        nonlocal list_tag
        if list_tag:
            out.append(f"</{list_tag}>")
            list_tag = None

    while i < n:
        ln = lines[i]
        st = ln.strip()

        if not st:
            close_list()
            i += 1
            continue

        # table: a header row followed by a |---|---| separator
        if st.startswith("|") and i + 1 < n and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            close_list()
            head = _row(st)
            i += 2
            body = []
            while i < n and lines[i].strip().startswith("|"):
                body.append(_row(lines[i].strip()))
                i += 1
            out.append("<table><thead><tr>"
                       + "".join(f"<th>{inline(c)}</th>" for c in head)
                       + "</tr></thead><tbody>")
            for r in body:
                out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
            out.append("</tbody></table>")
            continue

        if re.match(r"^(-{3,}|\*{3,})$", st):
            close_list()
            out.append("<hr>")
            i += 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", st)
        if m:
            close_list()
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue

        if st.startswith(">"):
            close_list()
            block = []
            while i < n and (lines[i].strip().startswith(">") or
                             (block and lines[i].strip() and not lines[i].strip().startswith(("#", "|", "-", "*")))):
                block.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            out.append(f"<blockquote>{md(chr(10).join(block))}</blockquote>")
            continue

        m = re.match(r"^(\d+)\.\s+(.*)$", st)
        if m:
            if list_tag != "ol":
                close_list()
                out.append("<ol>")
                list_tag = "ol"
            item = [m.group(2)]
            i += 1
            while i < n and re.match(r"^\s{2,}\S", lines[i]) and not re.match(r"^\s*\d+\.", lines[i]):
                item.append(lines[i].strip())
                i += 1
            out.append(f"<li>{inline(' '.join(item))}</li>")
            continue

        m = re.match(r"^[-*]\s+(.*)$", st)
        if m:
            if list_tag != "ul":
                close_list()
                out.append("<ul>")
                list_tag = "ul"
            item = [m.group(1)]
            i += 1
            while i < n and re.match(r"^\s{2,}\S", lines[i]) and not re.match(r"^\s*[-*]\s", lines[i]):
                item.append(lines[i].strip())
                i += 1
            out.append(f"<li>{inline(' '.join(item))}</li>")
            continue

        close_list()
        para = [st]
        i += 1
        while i < n and lines[i].strip() and not re.match(
                r"^\s*(#{1,6}\s|[-*]\s|\d+\.\s|>|\||-{3,})", lines[i]):
            para.append(lines[i].strip())
            i += 1
        out.append(f"<p>{inline(' '.join(para))}</p>")

    close_list()
    return "\n".join(out)


# ---------------------------------------------------------------- data

def corpus_stats() -> dict:
    """{room: {display_name: {...}}} — real volumes, so a dossier can be read
    against the evidence it rests on rather than its own confidence."""
    stats: dict[str, dict] = {}
    for room in ("boarz", "second_best"):
        try:
            msgs = corpus.load(room=room)
        except Exception as e:  # noqa: BLE001 — a missing room is not fatal
            print(f"  !! could not load room {room}: {type(e).__name__} {e}")
            continue
        per: dict[str, dict] = {}
        for m in msgs:
            name = DISPLAY.get(m.player, m.player)
            d = per.setdefault(name, {"chat": 0, "chat_chars": 0,
                                      "ballot": 0, "ballot_chars": 0, "first": None, "last": None})
            d[m.kind] += 1
            d[f"{m.kind}_chars"] += len(m.text)
            ts = str(m.ts)[:10]
            d["first"] = min(d["first"] or ts, ts)
            d["last"] = max(d["last"] or ts, ts)
        stats[room] = per
    return stats


KIT_TITLES = ("imitation kit",)


def split_sections(raw: str) -> list[tuple[str, str]]:
    parts = re.split(r"^## +", raw, flags=re.M)
    head = parts[0]
    out = [("__intro__", head)]
    for p in parts[1:]:
        title, _, body = p.partition("\n")
        out.append((title.strip(), body))
    return out


def load_profiles() -> list[dict]:
    stats = corpus_stats()
    people = []
    for room, league, d, blurb in LEAGUES:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            name = f.stem.replace("_", " ")
            raw = f.read_text(encoding="utf-8")
            secs = split_sections(raw)
            st = stats.get(room, {}).get(name, {})
            kit = next((b for t, b in secs if any(k in t.lower() for k in KIT_TITLES)), "")
            people.append({
                "name": name,
                "room": room,
                "league": league,
                "file": str(f.relative_to(HERE)),
                "lines": raw.count("\n") + 1,
                "provisional": "PROVISIONAL" in raw[:1200],
                "sections": [{"title": t, "html": md(b)} for t, b in secs],
                "kit_html": md(kit) if kit else "",
                "search": re.sub(r"\s+", " ", raw).lower()[:20000],
                "stats": st,
            })
    return people


CSS = """
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--tx:#e6e9ef;--dim:#98a2b3;
--acc:#7aa2f7;--good:#7ee787;--warn:#e3b341;--bad:#f7768e;--chip:#1f2430;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);
font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{display:grid;grid-template-columns:290px 1fr;min-height:100vh}
aside{background:var(--panel);border-right:1px solid var(--line);padding:16px 14px;
position:sticky;top:0;height:100vh;overflow:auto}
aside h1{font-size:15px;margin:0 0 2px}
aside .sub{color:var(--dim);font-size:12px;margin:0 0 14px}
.lg{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);
margin:16px 0 7px;padding-bottom:5px;border-bottom:1px solid var(--line)}
.lg .blurb{display:block;text-transform:none;letter-spacing:0;font-size:11px;
line-height:1.45;margin-top:5px;color:#7c8698}
a.p{display:flex;justify-content:space-between;align-items:center;gap:8px;
padding:6px 9px;border-radius:7px;color:var(--tx);text-decoration:none;font-size:13px}
a.p:hover{background:#1b1f28}
a.p.on{background:#20283a;color:#fff}
a.p .v{font-size:10px;color:var(--dim);font-variant-numeric:tabular-nums}
a.p.prov .n:after{content:" ⚠";color:var(--warn)}
main{padding:26px 34px 80px;max-width:1000px}
input[type=search]{width:100%;background:var(--chip);color:var(--tx);
border:1px solid var(--line);border-radius:7px;padding:7px 10px;font:inherit}
.hd{border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:8px}
.hd h2{font-size:23px;margin:0 0 8px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-block;background:var(--chip);border:1px solid var(--line);
border-radius:20px;padding:2px 10px;font-size:11px;color:var(--dim);white-space:nowrap}
.chip.warn{color:var(--warn);border-color:#4a3f1e}
.chip.good{color:var(--good);border-color:#24422c}
.tabs{display:flex;gap:4px;flex-wrap:wrap;margin:14px 0 18px}
.tabs button{background:none;border:1px solid transparent;color:var(--dim);
padding:5px 11px;border-radius:7px;cursor:pointer;font:inherit;font-size:12px}
.tabs button.on{background:var(--chip);border-color:var(--line);color:var(--tx)}
h2,h3,h4{line-height:1.3}
main h2{font-size:19px;margin:26px 0 8px}
main h3{font-size:15px;margin:20px 0 6px;color:#cfd6e4}
main h4{font-size:13px;margin:16px 0 5px;color:var(--dim);
text-transform:uppercase;letter-spacing:.04em}
p{margin:9px 0}
blockquote{margin:10px 0;padding:2px 14px;border-left:3px solid var(--line);
color:#c3cad8;background:#141821;border-radius:0 7px 7px 0}
blockquote p{margin:7px 0}
code{background:var(--chip);border:1px solid var(--line);border-radius:4px;
padding:1px 5px;font-size:12.5px}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin:12px 0}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
hr{border:0;border-top:1px solid var(--line);margin:22px 0}
ul,ol{padding-left:22px;margin:9px 0}
li{margin:5px 0}
.empty{color:var(--dim);padding:40px 0}
@media(max-width:820px){.wrap{grid-template-columns:1fr}aside{position:static;height:auto}
main{padding:20px 16px 60px}}
"""

JS = """
const D=DATA;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let cur=0, tab="all";
function fmt(n){return n==null?"—":n.toLocaleString()}
function stats(p){
  const s=p.stats||{}, cm=s.chat||0, bm=s.ballot||0;
  const cc=s.chat_chars||0, bc=s.ballot_chars||0;
  const out=[`<span class="chip">${p.league}</span>`];
  if(cm+bm) out.push(`<span class="chip">${fmt(cm+bm)} messages</span>`,
    `<span class="chip">${fmt(cc+bc)} chars</span>`,
    `<span class="chip">${fmt(cm)} chat / ${fmt(bm)} ballot</span>`);
  else out.push(`<span class="chip warn">no corpus rows matched</span>`);
  if(s.first) out.push(`<span class="chip">${s.first} → ${s.last}</span>`);
  out.push(`<span class="chip">${p.lines} lines</span>`);
  out.push(p.provisional?`<span class="chip warn">provisional</span>`
    :`<span class="chip good">full evidence</span>`);
  return out.join("");
}
function renderNav(){
  const q=($("#q").value||"").trim().toLowerCase();
  const groups={};
  D.forEach((p,i)=>{
    if(q && !p.name.toLowerCase().includes(q) && !p.search.includes(q))return;
    (groups[p.league]=groups[p.league]||[]).push([p,i]);
  });
  const blurbs=D.length?Object.fromEntries(D.map(p=>[p.league,p.blurb])):{};
  $("#nav").innerHTML=Object.keys(groups).length?Object.entries(groups).map(([lg,items])=>
    `<div class="lg">${lg} · ${items.length}<span class="blurb">${blurbs[lg]||""}</span></div>`+
    items.map(([p,i])=>{
      const s=p.stats||{}, tot=(s.chat_chars||0)+(s.ballot_chars||0);
      return `<a class="p ${i===cur?"on":""} ${p.provisional?"prov":""}" href="#${encodeURIComponent(p.name)}"
        data-i="${i}"><span class="n">${p.name}</span><span class="v">${tot?Math.round(tot/1000)+"k":"—"}</span></a>`;
    }).join("")
  ).join(""):`<p class="empty">No dossier matches “${q}”.</p>`;
  $$("a.p").forEach(a=>a.onclick=e=>{e.preventDefault();show(+a.dataset.i)});
}
function show(i){
  cur=i; const p=D[i]; if(!p)return;
  location.hash=encodeURIComponent(p.name);
  const secs=p.sections.filter(s=>s.title!=="__intro__");
  const intro=p.sections.find(s=>s.title==="__intro__");
  const shown=tab==="all"?secs:tab==="kit"
    ?secs.filter(s=>/imitation kit/i.test(s.title)):secs;
  $("#body").innerHTML=`<div class="hd"><h2>${p.name}</h2><div class="chips">${stats(p)}</div></div>
    <div class="tabs">
      <button data-t="all" class="${tab==="all"?"on":""}">Full dossier</button>
      <button data-t="kit" class="${tab==="kit"?"on":""}">Imitation kit only</button>
      <span class="chip" style="margin-left:auto">${p.file}</span>
    </div>
    ${tab==="all"&&intro?intro.html:""}
    ${shown.map(s=>`<h2>${s.title}</h2>${s.html}`).join("")}`;
  $$(".tabs button").forEach(b=>b.onclick=()=>{tab=b.dataset.t;show(cur)});
  renderNav();
  window.scrollTo(0,0);
}
$("#q").oninput=renderNav;
window.onhashchange=()=>{
  const n=decodeURIComponent(location.hash.slice(1));
  const i=D.findIndex(p=>p.name===n);
  if(i>=0&&i!==cur)show(i);
};
const start=D.findIndex(p=>p.name===decodeURIComponent(location.hash.slice(1)));
show(start>=0?start:0);
"""


def build(people: list[dict]) -> str:
    blurb = {lg: b for _, lg, _, b in LEAGUES}
    for p in people:
        p["blurb"] = blurb.get(p["league"], "")
    n_prov = sum(1 for p in people if p["provisional"])
    data = json.dumps(people, ensure_ascii=False)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Persona dossiers</title><style>{CSS}</style></head><body>
<div class="wrap">
<aside>
  <h1>Persona dossiers</h1>
  <p class="sub">{len(people)} people across {len({p['league'] for p in people})} leagues.
  {n_prov} provisional. Search covers the full text.</p>
  <input type="search" id="q" placeholder="search name or contents…">
  <div id="nav"></div>
</aside>
<main id="body"></main>
</div>
<script>const DATA={data};</script>
<script>{JS}</script>
</body></html>"""


if __name__ == "__main__":
    people = load_profiles()
    if not people:
        raise SystemExit("no dossiers found under profiles/")
    OUT.write_text(build(people), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"{OUT}  ({kb:.0f} KB, {len(people)} dossiers)")
    for p in people:
        s = p["stats"]
        tot = (s.get("chat_chars", 0) + s.get("ballot_chars", 0)) if s else 0
        flag = " PROVISIONAL" if p["provisional"] else ""
        warn = "  !! no corpus match" if not s else ""
        print(f"  {p['league']:14s} {p['name']:18s} {tot:8,d} chars{flag}{warn}")
