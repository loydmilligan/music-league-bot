#!/usr/bin/env python3
"""Story-lede generator for the Digest Quality Program HiL loop (WS10 step 2).

Runs right after a round ends, BEFORE punch-up. Gathers the round's raw
material — league rulecard, per-song ballot results, all vote + submission
comments, the round's chat window, and the previous round's bridge (if the
bridge table exists yet) — and asks headless Claude (`claude -p`) for 5–8
candidate story ledes: the angles the digest could focus on, each with
verbatim evidence from the supplied material.

Ledes are stored in `digest_ledes` (additive table; ratings_json is filled
later by the /hil page). With --notify, a ntfy push announces the HiL review
page; without it, the script prints what WOULD be sent.

Round window = (previous round's voting_deadline, this round's voting_deadline]
within the same season. Relay truncation artifacts (same sender+timestamp,
shorter text) are deduped; chat capped at the most recent ~700 messages.

Usage: python3 scripts/digest-qa/generate_ledes.py <round_id>
         [--db data/league.db] [--print] [--force] [--notify]
"""
import argparse, json, re, sqlite3, subprocess, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
CHAT_CAP = 700
CLAUDE_TIMEOUT = 240

def iso(ts: str) -> str:
    return ts.replace("+00:00", "Z")

def norm_sender(s: str) -> str:
    # "~ Name" / "~ Name" push-name prefixes → bare name (space may be U+202F).
    return re.sub(r"^~[\s ]*", "", s).strip()

def load_env(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

# ---------------------------------------------------------------- gathering

def gather(db: sqlite3.Connection, round_id: int) -> dict:
    row = db.execute(
        """SELECT r.name, r.description, r.season_id, r.voting_deadline, l.slug, l.name
           FROM rounds r JOIN seasons s ON r.season_id=s.id
           JOIN leagues l ON s.league_id=l.id WHERE r.id=?""", (round_id,)).fetchone()
    if not row:
        sys.exit(f"unknown round id {round_id}")
    rname, rdesc, season_id, vote_dl, slug, lname = row
    if not vote_dl:
        sys.exit(f"round {round_id} has no voting_deadline; cannot bound the chat window")
    vote_dl = iso(vote_dl)
    league_id = db.execute("SELECT league_id FROM seasons WHERE id=?", (season_id,)).fetchone()[0]

    # 1. rulecard, verbatim
    rc_path = REPO / "docs" / "league-rulecards" / f"{slug}.md"
    rulecard = rc_path.read_text() if rc_path.exists() else f"(no rulecard file for {slug})"

    # 2. per-song ballot results + non-voting submitters
    songs = db.execute(
        """SELECT s.spotify_uri, s.title, s.artists, p.name,
                  COALESCE(SUM(v.points),0),
                  COALESCE(SUM(CASE WHEN v.points>0 THEN 1 ELSE 0 END),0),
                  COALESCE(SUM(CASE WHEN v.points<0 THEN 1 ELSE 0 END),0)
           FROM ml_submissions s
           JOIN players p ON s.player_id=p.id
           LEFT JOIN votes v ON v.round_id=s.round_id AND v.spotify_uri=s.spotify_uri
           WHERE s.round_id=? GROUP BY s.spotify_uri
           ORDER BY COALESCE(SUM(v.points),0) DESC, s.title""",
        (round_id, )).fetchall()
    non_voters = [r[0] for r in db.execute(
        """SELECT p.name FROM ml_submissions s JOIN players p ON s.player_id=p.id
           WHERE s.round_id=? AND s.player_id NOT IN
             (SELECT DISTINCT player_id FROM votes WHERE round_id=? AND player_id IS NOT NULL)""",
        (round_id, round_id)).fetchall()]

    # 3. vote comments + submission comments
    song_by_uri = {u: (t, a, sub) for u, t, a, sub, *_ in songs}
    vote_comments = db.execute(
        """SELECT p.name, v.spotify_uri, v.points, v.comment
           FROM votes v JOIN players p ON v.player_id=p.id
           WHERE v.round_id=? AND v.comment IS NOT NULL AND v.comment!=''
           ORDER BY v.spotify_uri, v.points DESC""", (round_id,)).fetchall()
    sub_comments = db.execute(
        """SELECT p.name, s.title, s.comment FROM ml_submissions s
           JOIN players p ON s.player_id=p.id
           WHERE s.round_id=? AND s.comment IS NOT NULL AND s.comment!=''""",
        (round_id,)).fetchall()

    # 4. chat window
    prev = db.execute(
        """SELECT voting_deadline FROM rounds
           WHERE season_id=? AND voting_deadline IS NOT NULL AND voting_deadline<?
           ORDER BY voting_deadline DESC LIMIT 1""", (season_id, vote_dl)).fetchone()
    start = iso(prev[0]) if prev else "0000"
    group_map = json.loads(db.execute(
        "SELECT value FROM settings WHERE key='chat_league_group_map'").fetchone()[0])
    group = group_map.get(slug)
    chat = []
    if group:
        ident = {}
        for identifier, pname in db.execute(
            """SELECT pi.identifier, p.name FROM player_identities pi
               JOIN players p ON pi.player_id=p.id
               WHERE pi.identity_type IN ('whatsapp','google-chat')
                 AND (pi.league_id=? OR pi.league_id IS NULL)""", (league_id,)):
            ident[identifier] = pname
            ident[norm_sender(identifier)] = pname
        best = {}
        for ts, sender, text in db.execute(
            "SELECT ts, sender, text FROM chat_messages WHERE group_name=? AND ts>? AND ts<=?",
            (group, start, vote_dl)):
            k = (sender, iso(ts))
            if k not in best or len(text or "") > len(best[k][1] or ""):
                best[k] = (ts, text)
        for (sender, _), (ts, text) in sorted(best.items(), key=lambda kv: kv[1][0]):
            who = ident.get(sender) or ident.get(norm_sender(sender)) or norm_sender(sender)
            chat.append((iso(ts), who, text or ""))
        chat = chat[-CHAT_CAP:]

    # 5. previous round's bridge (table may not exist yet)
    bridge = None
    if prev:
        prev_id = db.execute(
            "SELECT id FROM rounds WHERE season_id=? AND voting_deadline=?",
            (season_id, prev[0])).fetchone()
        if prev_id:
            try:
                row = db.execute(
                    "SELECT content_json FROM digest_bridges WHERE round_id=?",
                    (prev_id[0],)).fetchone()
                bridge = row[0] if row else None
            except sqlite3.OperationalError:
                bridge = None

    # 6. early lede sheet (mid-round, provisional — see build_prompt's caveat)
    early = None
    try:
        row = db.execute(
            "SELECT content_json, ratings_json FROM digest_early_ledes WHERE round_id=?",
            (round_id,)).fetchone()
        if row:
            early = json.dumps({"ledes": json.loads(row[0]).get("ledes", []),
                                "ratings": json.loads(row[1]) if row[1] else None})
    except (sqlite3.OperationalError, ValueError):
        early = None

    # 7. editor notes targeted at the ledes, plus the general ones
    notes = []
    try:
        notes = [dict(body=r[0]) for r in db.execute(
            "SELECT body FROM round_notes WHERE round_id=? AND target IN ('ledes','general')"
            " ORDER BY created_at, id", (round_id,)).fetchall()]
    except sqlite3.OperationalError:
        notes = []

    return dict(round_id=round_id, round_name=rname, round_desc=rdesc or "",
                league_name=lname, slug=slug, window=(start, vote_dl),
                rulecard=rulecard, songs=songs, non_voters=non_voters,
                vote_comments=vote_comments, sub_comments=sub_comments,
                chat=chat, bridge=bridge, early=early, notes=notes,
                song_by_uri=song_by_uri)

# ------------------------------------------------------------------ prompt

def build_prompt(m: dict) -> str:
    p = []
    p.append(f"""You are the story editor for a weekly Music League digest. Round "{m['round_name']}" of league "{m['league_name']}" just ended. Below is ALL the raw material: the league rulecard (voting mechanics), per-song ballot totals, every vote comment, every submission comment, and the group-chat transcript for the round window. Your job: propose 5-8 candidate story LEDES — the angles the digest could lead with.

RULES:
- Every "evidence" entry must be a VERBATIM quote or hard fact copied exactly from the material below. Never paraphrase inside evidence; never invent facts.
- Mix ballot stories (results, ties, penalties, voting patterns) and chat stories (threads, bits, running jokes). At least 2 ledes must be sourced PRIMARILY from the chat transcript — off-ballot threads, arguments, and running bits that have nothing to do with the scores.
- Prefer angles involving under-featured or newer players when the material supports them.
- Apply the rulecard when reading results (penalties, tiebreakers) but do not compute final standings; flag facts, don't rank.
- Titles short and punchy; "angle" is 2-3 sentences on the story and why it lands.

OUTPUT: STRICT JSON ONLY — no prose, no markdown fences — matching exactly:
{{"round_id": {m['round_id']}, "ledes": [{{"id": "lede-1", "title": "...", "angle": "...", "evidence": ["...", "..."]}}]}}
Each lede has 2-4 evidence strings.

=== LEAGUE RULECARD ({m['slug']}) ===
{m['rulecard']}

=== ROUND ===
Name: {m['round_name']}
Description: {m['round_desc']}
Window (UTC): {m['window'][0]} -> {m['window'][1]}""")

    p.append("\n=== BALLOT RESULTS (raw totals from votes; penalties NOT applied) ===")
    for _, title, artists, sub, pts, up, down in m["songs"]:
        p.append(f'- "{title}" by {artists} (submitted by {sub}): {pts} points, {up} upvoters, {down} downvoters')
    if m["non_voters"]:
        p.append("\nFACT: these submitters cast ZERO votes this round (per the rulecard, "
                 "their song's upvotes are voided): " + ", ".join(m["non_voters"]))
    else:
        p.append("\nFACT: every submitter filed a ballot this round.")

    p.append("\n=== VOTE COMMENTS (voter -> song, points) ===")
    for voter, uri, pts, c in m["vote_comments"]:
        title = m["song_by_uri"].get(uri, ("?",))[0]
        p.append(f'{voter} on "{title}" ({pts:+d}): {c}')

    p.append("\n=== SUBMISSION COMMENTS (submitter on their own song) ===")
    for sub, title, c in m["sub_comments"]:
        p.append(f'{sub} on "{title}": {c}')

    p.append("\n=== PREVIOUS ROUND BRIDGE (continuity: last digest's stories) ===")
    p.append(m["bridge"] if m["bridge"] else "no bridge available")

    if m["early"]:
        p.append(
            "\n=== EARLY LEDE SHEET (provisional) ===\n"
            "These angles were drafted mid-round, WITHOUT votes, results, or the closing\n"
            "chat. They show what looked live early and which ones the editor liked.\n"
            "Treat them as steering, NOT as candidates to reproduce. The real evidence\n"
            "below supersedes them wherever they disagree.\n"
            + m["early"])
    else:
        p.append("\nno early lede sheet for this round")

    if m["notes"]:
        p.append(
            "\n=== EDITOR NOTES ===\n"
            "Editorial direction from the human editor. Treat it as true, but it is\n"
            "NOT a quotable source: do not attribute it to anyone, and do not present it as\n"
            "something said in the chat or in a comment.\n"
            + "\n".join(f"- {n['body'].strip()}" for n in m["notes"]))

    p.append(f"\n=== GROUP CHAT TRANSCRIPT ({len(m['chat'])} messages) ===")
    for ts, who, text in m["chat"]:
        p.append(f"[{ts[:16]}] {who}: {text}")

    p.append("\nNow output the strict JSON described above. JSON only.")
    return "\n".join(p)

# ----------------------------------------------------------------- claude

def strip_fences(s: str) -> str:
    s = s.strip()
    m = re.search(r"```(?:json)?\s*(.*?)\s*```", s, re.DOTALL)
    if m:
        s = m.group(1)
    # tolerate leading prose before the JSON object
    i = s.find("{")
    return s[i:] if i > 0 else s

def ask_claude(prompt: str) -> dict:
    last_err = None
    for attempt in range(2):
        try:
            r = subprocess.run(["claude", "-p"], input=prompt, capture_output=True,
                               text=True, timeout=CLAUDE_TIMEOUT)
            out = strip_fences(r.stdout)
            data = json.loads(out)
            if isinstance(data, dict) and data.get("ledes"):
                return data
            last_err = f"unexpected shape: {out[:200]}"
        except (json.JSONDecodeError, subprocess.TimeoutExpired) as e:
            last_err = f"{type(e).__name__}: {e}"
        if attempt == 0:
            print(f"  parse failed ({last_err}); retrying once...", file=sys.stderr)
            prompt += "\n\nREMINDER: output ONLY the raw JSON object. No fences, no prose."
    sys.exit(f"claude -p failed after retry: {last_err}")

# ------------------------------------------------------------------- ntfy

def ascii_header(v: str) -> str:
    """HTTP headers must be latin-1; ntfy titles with em dashes/emoji crash
    urllib. Body text is unaffected (sent as UTF-8 payload)."""
    return v.encode("ascii", "replace").decode()


def notify(m: dict, send: bool) -> None:
    env = {**load_env(REPO / ".env")}
    url, topic, token = env.get("NTFY_URL"), env.get("NTFY_TOPIC"), env.get("NTFY_TOKEN")
    body = f"Digest HiL ready — round {m['round_name']}"
    click = f"https://mlb37.mattmariani.com/digest/{m['round_id']}/hil"
    if not (url and topic):
        print("ntfy: NTFY_URL/NTFY_TOPIC not configured; skipping", file=sys.stderr)
        return
    if not send:
        print(f"ntfy (dry run — pass --notify to send): POST {url}/{topic}\n"
              f"  Title: {m['league_name']} — HiL review\n  Click: {click}\n  Body: {body}",
              file=sys.stderr)
        return
    req = urllib.request.Request(f"{url}/{topic}", data=body.encode(), method="POST",
                                 headers={"Title": ascii_header(f"{m['league_name']} - HiL review"),
                                          # ntfy sits behind Cloudflare, which 403s (code 1010)
                                          # the default Python-urllib user agent.
                                          "User-Agent": "mlbot-digest-qa/1.0",
                                          "Click": click,
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req, timeout=15) as resp:
        print(f"ntfy: sent ({resp.status})")

# ------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("round_id", type=int)
    ap.add_argument("--db", default="data/league.db")
    ap.add_argument("--print", dest="print_json", action="store_true",
                    help="print the lede JSON to stdout")
    ap.add_argument("--force", action="store_true", help="overwrite existing ledes row")
    ap.add_argument("--notify", action="store_true", help="actually send the ntfy push")
    args = ap.parse_args()

    db = sqlite3.connect(args.db)
    db.execute("""CREATE TABLE IF NOT EXISTS digest_ledes (
        round_id INTEGER PRIMARY KEY REFERENCES rounds(id),
        generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        content_json TEXT NOT NULL,
        ratings_json TEXT)""")
    db.commit()
    if not args.force and db.execute(
            "SELECT 1 FROM digest_ledes WHERE round_id=?", (args.round_id,)).fetchone():
        sys.exit(f"digest_ledes already has round {args.round_id}; use --force to regenerate")

    m = gather(db, args.round_id)
    prompt = build_prompt(m)
    print(f"round {args.round_id} '{m['round_name']}' ({m['slug']}): "
          f"{len(m['songs'])} songs, {len(m['vote_comments'])} vote comments, "
          f"{len(m['sub_comments'])} sub comments, {len(m['chat'])} chat msgs, "
          f"bridge={'yes' if m['bridge'] else 'no'}; "
          f"early={'yes' if m['early'] else 'no'}; notes={len(m['notes'])}; "
          f"prompt {len(prompt)} chars",
          file=sys.stderr)

    data = ask_claude(prompt)
    data["round_id"] = args.round_id
    db.execute("""INSERT INTO digest_ledes (round_id, content_json) VALUES (?,?)
                  ON CONFLICT(round_id) DO UPDATE SET
                    content_json=excluded.content_json,
                    generated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                    ratings_json=NULL""",
               (args.round_id, json.dumps(data, ensure_ascii=False)))
    db.commit()
    print(f"stored {len(data['ledes'])} ledes for round {args.round_id}", file=sys.stderr)

    if args.print_json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    notify(m, args.notify)

if __name__ == "__main__":
    main()
