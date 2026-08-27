#!/usr/bin/env python3
"""Host-side rollout executor.

The containers have neither python3 nor the claude CLI, so every script and
agent cut runs here. This poller is the generic replacement for
hil_autorun.py's hardcoded "find rounds, run generate_ledes, notify".

It talks to data/league.db directly, exactly as every scripts/digest-qa tool
does. SQLite transactions give the claim its atomicity; no HTTP API needed.

Division of labour: the host executor ONLY completes cuts. Advancing the EP,
parking at holds, and firing notifications belong to the app executor, which
already has the notification dispatch wired.

Usage: python3 scripts/rollout/host_executor.py [--db data/league.db]
           [--once] [--interval 60]
"""
import argparse
import json
import os
import shlex
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

CLAUDE_TIMEOUT = 900   # agent cuts are slow; 15 minutes before we call it hung
SCRIPT_TIMEOUT = 600


def load_env(path):
    """Minimal .env reader — the systemd unit has no shell to source it."""
    if not os.path.exists(path):
        return
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ----------------------------------------------------------------- claiming

def claimable_cuts(db, run_id, current_ep):
    """Pending host cuts in the run's current EP."""
    rows = db.execute(
        "SELECT cut_id, ep FROM rollout_cut_runs"
        "  WHERE run_id=? AND ep=? AND state='pending' AND runtime='host'"
        "  ORDER BY cut_id", (run_id, current_ep)).fetchall()
    return [dict(r) for r in rows]


def claim(db, run_id, cut_id, now):
    """Atomic claim. False means another executor got there first."""
    cur = db.execute(
        "UPDATE rollout_cut_runs"
        "   SET state='running', claimed_at=?, heartbeat_at=?,"
        "       started_at=COALESCE(started_at, ?)"
        " WHERE run_id=? AND cut_id=? AND state='pending'",
        (now, now, now, run_id, cut_id))
    db.commit()
    return cur.rowcount == 1


def heartbeat(db, run_id, cut_id, now):
    db.execute("UPDATE rollout_cut_runs SET heartbeat_at=?"
               " WHERE run_id=? AND cut_id=? AND state='running'", (now, run_id, cut_id))
    db.commit()


# ------------------------------------------------------------------ context

def build_context(db, run_id, cut_id):
    """The dossier slice: every cut in a STRICTLY earlier EP, never a sibling.

    Mirrors contextFor in ui/src/lib/rollout/context.ts. The two must agree —
    context visibility is declared by position, and a host cut and an app cut
    at the same position must see the same thing.
    """
    self_row = db.execute("SELECT ep FROM rollout_cut_runs WHERE run_id=? AND cut_id=?",
                          (run_id, cut_id)).fetchone()
    if self_row is None:
        raise KeyError(f'unknown cut "{cut_id}" in run {run_id}')
    rows = db.execute(
        "SELECT cut_id, ep, output_json FROM rollout_cut_runs"
        "  WHERE run_id=? AND ep < ? AND output_json IS NOT NULL"
        "  ORDER BY ep, cut_id", (run_id, self_row["ep"])).fetchall()
    return {
        "cut_id": cut_id,
        "ep": self_row["ep"],
        "upstream": [
            {"cut_id": r["cut_id"], "ep": r["ep"], "output_json": r["output_json"]}
            for r in rows
        ],
    }


# ------------------------------------------------------------------- cuts

def _substitute(argv, subs):
    out = []
    for arg in argv:
        for key, val in subs.items():
            arg = arg.replace("{" + key + "}", str(val))
        out.append(arg)
    return out


def run_script_cut(cut, subs, cwd):
    """Run a script cut. A missing binary or a timeout is TRANSIENT (`error`);
    a non-zero exit from a program that ran is a result, not an error."""
    argv = _substitute(cut["command"], subs)
    try:
        proc = subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                              timeout=SCRIPT_TIMEOUT)
    except FileNotFoundError as e:
        return {"exit_code": 127, "output_json": None, "stdout": "", "error": f"{argv[0]}: {e}"}
    except subprocess.TimeoutExpired:
        return {"exit_code": 124, "output_json": None, "stdout": "",
                "error": f"timed out after {SCRIPT_TIMEOUT}s: {shlex.join(argv)}"}

    stdout = proc.stdout or ""
    output_json = None
    try:
        json.loads(stdout)
        output_json = stdout
    except (ValueError, TypeError):
        # Not JSON — keep the tail as a plain record so the run page shows it.
        output_json = json.dumps({"stdout": stdout[-4000:], "stderr": (proc.stderr or "")[-2000:]})
    return {"exit_code": proc.returncode, "output_json": output_json,
            "stdout": stdout, "error": None}


def run_agent_cut(cut, context, subs):
    """Hand headless Claude a job with its dossier slice.

    `claude -p` rather than the Agent SDK: generate_ledes.py and
    generate_bridge.py already prove this path in production. Swapping in the
    SDK later is a change to this function only.
    """
    prompt = json.dumps({
        "job": cut["job"],
        "label": cut.get("label"),
        "round_id": subs.get("roundId"),
        "league_slug": subs.get("leagueSlug"),
        "context": context,
        "instructions": (
            "You are one cut in a digest rollout. Do only this job. "
            "Reply with strict JSON: {\"ok\": bool, \"summary\": str, \"details\": object}."
        ),
    }, indent=2)
    argv = ["claude", "-p"]
    if cut.get("model"):
        argv += ["--model", cut["model"]]
    try:
        proc = subprocess.run(argv, input=prompt, capture_output=True, text=True,
                              timeout=CLAUDE_TIMEOUT)
    except FileNotFoundError as e:
        return {"exit_code": 127, "output_json": None, "error": f"claude: {e}"}
    except subprocess.TimeoutExpired:
        return {"exit_code": 124, "output_json": None,
                "error": f"claude -p timed out after {CLAUDE_TIMEOUT}s"}
    if proc.returncode != 0:
        return {"exit_code": proc.returncode, "output_json": None,
                "error": (proc.stderr or "claude -p failed")[-2000:]}
    return {"exit_code": 0,
            "output_json": json.dumps({"raw": (proc.stdout or "")[-8000:]}),
            "error": None}


# -------------------------------------------------------------------- tick

def _finish(db, run_id, cut_id, res, now):
    """Write a finished cut. State transitions (retry / remaster / park) are the
    app executor's engine — the host records `done` or `failed` plus output and
    lets the engine decide on its next pass."""
    state = "done" if res["exit_code"] == 0 and not res.get("error") else "failed"
    db.execute(
        "UPDATE rollout_cut_runs SET state=?, output_json=?, error=?, finished_at=?"
        " WHERE run_id=? AND cut_id=?",
        (state, res.get("output_json"), res.get("error"), now, run_id, cut_id))
    db.commit()


def tick(db, repo, now_fn=now_iso):
    """One pass. Returns the number of cuts run."""
    runs = db.execute(
        "SELECT id, round_id, current_ep, definition_json FROM rollout_runs"
        "  WHERE state='running' ORDER BY started_at").fetchall()
    ran = 0
    for run in runs:
        rollout = json.loads(run["definition_json"])
        slug_row = db.execute(
            "SELECT l.slug FROM rollout_runs rr JOIN leagues l ON l.id=rr.league_id"
            " WHERE rr.id=?", (run["id"],)).fetchone()
        subs = {"roundId": run["round_id"], "leagueSlug": slug_row["slug"] if slug_row else ""}

        for row in claimable_cuts(db, run["id"], run["current_ep"]):
            cut_id = row["cut_id"]
            now = now_fn()
            if not claim(db, run["id"], cut_id, now):
                continue
            cut = rollout["cuts"][cut_id]
            if cut["kind"] == "agent":
                res = run_agent_cut(cut, build_context(db, run["id"], cut_id), subs)
            else:
                res = run_script_cut(cut, subs, cwd=repo)
            _finish(db, run["id"], cut_id, res, now_fn())
            ran += 1
    return ran


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(REPO, "data/league.db"))
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=60)
    args = ap.parse_args()

    load_env(os.path.join(REPO, ".env"))
    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row

    if args.once:
        n = tick(db, REPO)
        print(f"host_executor: ran {n} cut(s)")
        return 0

    import time
    while True:
        try:
            n = tick(db, REPO)
            if n:
                print(f"host_executor: ran {n} cut(s)")
        except Exception as e:  # a bad run must not kill the poller
            print(f"host_executor: tick error: {e}", file=sys.stderr)
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main() or 0)
