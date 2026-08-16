#!/usr/bin/env python3
"""Round-bridge generator for the Digest Quality Program (WS10).

After a round's digest draft is finalized (post punch-up), this distills the
draft into a compact "bridge" artifact: the round's main story elements, a
1-2 sentence summary per section, running bits, planted callbacks, and a
handful of verbatim quotes. Stored in `digest_bridges` (additive table) so the
next round's lede generation and the season's continuity can consume it.

Summarization runs through headless Claude (`claude -p`) with strict-JSON
output; quotes are verified verbatim against the source sections and any
invented ones are dropped with a warning.

Usage: python3 scripts/digest-qa/generate_bridge.py <round_id> [--db data/league.db] [--print] [--force]
"""
import argparse, json, re, subprocess, sys

SCHEMA = """CREATE TABLE IF NOT EXISTS digest_bridges (
  round_id INTEGER PRIMARY KEY REFERENCES rounds(id),
  league_id INTEGER NOT NULL,
  draft_id TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  content_json TEXT NOT NULL
)"""

REQUIRED_KEYS = ("round", "headline_stories", "sections", "running_bits",
                 "callbacks_planted", "notable_quotes")

PROMPT = """You are building a "round bridge" for a music-league digest pipeline: a compact
machine-readable memory of one round's finalized digest, consumed by next
round's lede generation and by season-continuity tracking.

Round: {round_name!r} (id {round_id}, league {league_slug!r}).
Below is the digest content as JSON: one entry per section (kind => content),
plus an optional "phrase" dictionary card.

<digest_content>
{content}
</digest_content>

Return STRICT JSON only — no markdown fences, no commentary — exactly this shape:
{{
  "round": {{"id": {round_id}, "name": "{round_name}", "league_slug": "{league_slug}"}},
  "headline_stories": [3-6 items of {{"title": "...", "summary": "..."}} — the round's main
    narrative beats, written like recap notes a future writer could build on],
  "sections": {{"<kind>": "1-2 sentence summary of that section", ... one entry per section
    provided above, keyed by its kind (use "phrase" for the dictionary card if present)}},
  "running_bits": [strings — recurring bits/regulars that fired or were established this
    round: archetype cards, coinages, catchphrases, nicknames],
  "callbacks_planted": [strings — anything a future digest could pay off: promises, feuds,
    open questions, benched cards, unresolved threads],
  "notable_quotes": [up to 5 short verbatim quotes worth remembering, each formatted
    "Speaker: quote text"]
}}

Rules:
- Quotes (in notable_quotes and anywhere you quote someone) must be copied
  CHARACTER-FOR-CHARACTER from the provided content. Never paraphrase, trim words,
  fix punctuation, or invent a quote.
- Summaries are for a machine/writer consumer: concrete names, outcomes, and stakes;
  no filler.
- Output raw JSON only."""

RETRY_NUDGE = ("\n\nYour previous reply was not parseable JSON. Return ONLY the JSON "
               "object, with no fences or prose.")


def strings_of(obj, out):
    """Collect every string value inside a parsed-JSON structure."""
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            strings_of(v, out)
    elif isinstance(obj, list):
        for v in obj:
            strings_of(v, out)


def run_claude(prompt: str) -> str:
    proc = subprocess.run(["claude", "-p", prompt], capture_output=True,
                          text=True, timeout=180)
    if proc.returncode != 0:
        sys.exit(f"claude -p failed (rc={proc.returncode}): {proc.stderr.strip()[:500]}")
    return proc.stdout.strip()


def parse_json(text: str):
    # strip markdown fences defensively
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    # tolerate stray prose around a single top-level object
    if not text.startswith("{"):
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            text = m.group(0)
    return json.loads(text)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("round_id", type=int)
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--print", dest="print_json", action="store_true",
                    help="dump the bridge JSON to stdout")
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing bridge for this round")
    args = ap.parse_args()

    import sqlite3
    db = sqlite3.connect(args.db)
    db.execute(SCHEMA)

    row = db.execute(
        """SELECT r.name, se.league_id, l.slug FROM rounds r
           JOIN seasons se ON r.season_id=se.id JOIN leagues l ON se.league_id=l.id
           WHERE r.id=?""", (args.round_id,)).fetchone()
    if not row:
        sys.exit(f"unknown round id {args.round_id}")
    round_name, league_id, league_slug = row

    if not args.force and db.execute(
            "SELECT 1 FROM digest_bridges WHERE round_id=?", (args.round_id,)).fetchone():
        sys.exit(f"bridge for round {args.round_id} already exists (use --force to overwrite)")

    draft = db.execute(
        """SELECT id, stats_content_json FROM digest_drafts WHERE round_id=?
           ORDER BY finalized_at IS NULL, COALESCE(finalized_at, generated_at) DESC LIMIT 1""",
        (args.round_id,)).fetchone()
    if not draft:
        sys.exit(f"no digest draft for round {args.round_id}")
    draft_id, stats_json = draft

    content = {}
    for kind, cjson in db.execute(
            """SELECT kind, content_json FROM digest_sections
               WHERE draft_id=? AND state!='excluded' ORDER BY position""", (draft_id,)):
        content[kind] = json.loads(cjson)
    stats = json.loads(stats_json or "{}")
    if stats.get("phrase"):
        content["phrase"] = stats["phrase"]
    if not content:
        sys.exit(f"draft {draft_id} has no non-excluded sections")

    # verbatim-quote corpus: every string value in the source content
    corpus_parts = []
    strings_of(content, corpus_parts)
    corpus = "\n".join(corpus_parts)

    prompt = PROMPT.format(round_id=args.round_id, round_name=round_name,
                           league_slug=league_slug,
                           content=json.dumps(content, ensure_ascii=False, indent=1))

    bridge = None
    for attempt, p in enumerate((prompt, prompt + RETRY_NUDGE)):
        try:
            bridge = parse_json(run_claude(p))
            break
        except (json.JSONDecodeError, ValueError) as e:
            print(f"warning: attempt {attempt + 1} did not return valid JSON ({e})",
                  file=sys.stderr)
    if bridge is None:
        sys.exit("claude returned unparseable output twice; giving up")

    missing = [k for k in REQUIRED_KEYS if k not in bridge]
    if missing:
        sys.exit(f"bridge JSON missing keys: {missing}")
    bridge["round"] = {"id": args.round_id, "name": round_name, "league_slug": league_slug}

    # enforce verbatim quotes: the quoted text must appear in the source corpus
    kept = []
    for q in bridge.get("notable_quotes", [])[:5]:
        if not isinstance(q, str):
            continue
        body = q.split(":", 1)[1].strip().strip('"“”') if ":" in q else q
        if body in corpus:
            kept.append(q)
        else:
            print(f"warning: dropped non-verbatim quote: {q!r}", file=sys.stderr)
    bridge["notable_quotes"] = kept

    db.execute(
        """INSERT OR REPLACE INTO digest_bridges
           (round_id, league_id, draft_id, generated_at, content_json)
           VALUES (?,?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'),?)""",
        (args.round_id, league_id, draft_id, json.dumps(bridge, ensure_ascii=False)))
    db.commit()

    print(f"bridge stored for round {args.round_id} ({round_name!r}, {league_slug}) "
          f"from draft {draft_id}: {len(bridge['headline_stories'])} stories, "
          f"{len(bridge['sections'])} section summaries, "
          f"{len(bridge['notable_quotes'])} quotes")
    if args.print_json:
        print(json.dumps(bridge, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
