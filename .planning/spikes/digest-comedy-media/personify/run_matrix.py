#!/usr/bin/env python3
"""
run_matrix.py — the context-depth spike.

Question: how much dossier does a translation need, and does a cheaper model
close the gap when you give it more context?

Two axes crossed:
  context level  L1..L5  (levels.py)
  model          4 models from ~$0.4/M to $5/M input

Two command types, because they are different jokes:
  to_person   X -> Y   incongruity   ("#trans2jb")
  to_english  X -> plain  deflation  ("#trans2english")

Everything is recorded — prompt sizes, real USD from OpenRouter's usage
accounting, latency, and the raw output — so the report can weigh quality
against what the quality cost.

HARD BUDGET. The run aborts before any call that could take cumulative spend
past BUDGET_USD. Results are written after every call, so an abort still leaves
a usable (partial) dataset.

Usage:  .venv/bin/python run_matrix.py [--dry-run] [--budget 1.85]
"""
from __future__ import annotations
import argparse
import json
import os
import random
import re
import time
from pathlib import Path

import urllib.request
import urllib.error

import corpus
import levels

HERE = Path(__file__).resolve().parent
OUT = HERE / "matrix_results.json"
URL = "https://openrouter.ai/api/v1/chat/completions"

MODELS = [
    ("anthropic/claude-opus-5", "Claude Opus 5"),
    ("google/gemini-3.7-flash", "Gemini 3.7 Flash"),
    ("openai/gpt-5.1", "GPT-5.1"),
    ("z-ai/glm-4.7", "GLM 4.7"),
]

# Sources are chosen from the real corpus (see pick_sources). Targets are fixed
# so every one of the five personas appears as a target at least twice.
TARGETS_FOR = {
    "Matt Mariani": ["Jon Black", "Grant Koziol"],
    "Jon Black": ["Conor Johnston", "Dave Jensen"],
    "Conor Johnston": ["Jon Black", "Grant Koziol"],
    "Grant Koziol": ["Dave Jensen", "Matt Mariani"],
    "Dave Jensen": ["Conor Johnston", "Matt Mariani"],
}

# to_english is run at two levels only — deflation should not need a deep
# dossier, and this arm exists to confirm that rather than to be optimised.
ENGLISH_LEVELS = ["L2_kit", "L4_full"]


def pick_sources(pool, n_authors=4, seed=11):
    """One representative message from each of n_authors, deterministic.

    Wants messages that are translatable: long enough to have style, short
    enough to keep output cheap, and not a bare link or a one-word reply.
    """
    rng = random.Random(seed)
    out = []
    for who in ["Matt Mariani", "Jon Black", "Conor Johnston", "Grant Koziol"][:n_authors]:
        cands = []
        for kind in ("chat", "ballot"):
            for m in pool[who][kind]:
                t = m.text.strip()
                if not (140 <= len(t) <= 420):
                    continue
                if "http" in t or t.count("\n") > 6:
                    continue
                if len(re.findall(r"[A-Za-z']+", t)) < 25:
                    continue
                cands.append((kind, t))
        if not cands:
            continue
        kind, text = rng.choice(cands)
        out.append({"author": who, "kind": kind, "text": text})
    return out


SYS = (
    "You rewrite messages in the voice of a specific person from a private "
    "friends' group chat about music. You are producing a comedic impression: "
    "it must be recognisably them AND funny. Preserve the original's meaning "
    "and intent; change the voice, and let the voice pull the subject toward "
    "what that person actually cares about. Output ONLY the rewritten message "
    "— no preamble, no explanation, no quotation marks around the whole thing."
)

SYS_EN = (
    "You strip a message down to plain, neutral English. Keep every bit of the "
    "meaning; remove all voice, style, jokes, formatting habits and personality. "
    "The result should read like a flat summary written by nobody in particular. "
    "Output ONLY the plain version — no preamble, no explanation."
)


def prompt_to_person(ctx, target, source_text):
    return (
        f"# Voice profile: {target}\n\n{ctx}\n\n"
        f"# Message to rewrite\n\n{source_text}\n\n"
        f"# Task\n\nRewrite that message as {target} would have written it. "
        f"Same underlying point; their voice, their habits, their preoccupations."
    )


def prompt_to_english(ctx, author, source_text):
    return (
        f"# Voice profile of the original author: {author}\n\n{ctx}\n\n"
        f"# Message\n\n{source_text}\n\n"
        f"# Task\n\nRewrite that message in plain neutral English, stripped of "
        f"all of {author}'s style."
    )


def call(model, system, user, key, timeout=180):
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "max_tokens": 1400,
        "usage": {"include": True},
    }
    # Reasoning models bill thinking as completion tokens and can silently eat
    # the whole max_tokens budget before writing a word. Measured: GLM 4.7 at
    # effort=low still burned all 700 tokens and returned an EMPTY string on
    # 21 of 21 calls — an empty output scores as a failure and would have
    # quietly dragged its whole arm down. Style transfer needs no reasoning at
    # all, so switch it off outright where the provider allows it.
    if model.startswith("z-ai/"):
        payload["reasoning"] = {"enabled": False}
    elif model.startswith("openai/"):
        payload["reasoning"] = {"effort": "low"}
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        URL, data=body,
        headers={"Authorization": f"Bearer {key}",
                 "Content-Type": "application/json",
                 "X-Title": "personify-context-spike"},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    ms = int((time.time() - t0) * 1000)
    usage = d.get("usage") or {}
    text = (d["choices"][0]["message"].get("content") or "").strip()
    return {
        "text": text,
        "latency_ms": ms,
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "cost_usd": float(usage.get("cost") or 0.0),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=1.85)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY")
    if not key and not a.dry_run:
        raise SystemExit("OPENROUTER_API_KEY not set")

    pool = corpus.by_player()
    sources = pick_sources(pool)

    # Build the full job list first so the dry run reports the true shape.
    jobs = []
    for si, s in enumerate(sources):
        for tgt in TARGETS_FOR[s["author"]]:
            for lv in levels.LEVELS:
                jobs.append({"type": "to_person", "source_i": si, "target": tgt, "level": lv})
        for lv in ENGLISH_LEVELS:
            jobs.append({"type": "to_english", "source_i": si, "target": "plain english", "level": lv})

    # Anchor first. Opus is the arm every other number is read against, so if the
    # budget bites it must bite the cheap models — losing a $0.08 arm is
    # recoverable, losing half the reference arm invalidates the comparison.
    order = sorted(MODELS, key=lambda m: 0 if "opus" in m[0] else 1 if "openai" in m[0]
                   else 2 if "gemini" in m[0] else 3)

    existing = json.loads(OUT.read_text()) if OUT.exists() else {"runs": [], "sources": sources}
    done = {(r["model"], r["type"], r["source_i"], r["target"], r["level"])
            for r in existing["runs"]}
    spent = sum(r.get("cost_usd", 0) for r in existing["runs"])

    print(f"sources: {len(sources)}  jobs/model: {len(jobs)}  models: {len(order)}  "
          f"total: {len(jobs)*len(order)}  already done: {len(done)}  spent so far: ${spent:.4f}")
    for i, s in enumerate(sources):
        print(f"  [{i}] {s['author']:16s} ({s['kind']:6s}) {s['text'][:70]!r}")
    if a.dry_run:
        return

    for model, label in order:
        for j in jobs:
            k = (model, j["type"], j["source_i"], j["target"], j["level"])
            if k in done:
                continue
            s = sources[j["source_i"]]
            who = j["target"] if j["type"] == "to_person" else s["author"]
            ctx = levels.build(j["level"], who, s["text"], pool)
            if j["type"] == "to_person":
                system, user = SYS, prompt_to_person(ctx, j["target"], s["text"])
            else:
                system, user = SYS_EN, prompt_to_english(ctx, s["author"], s["text"])

            # Guard BEFORE spending: assume this call costs like the priciest so far.
            if spent >= a.budget:
                print(f"\n!! budget reached (${spent:.4f} >= ${a.budget}) — stopping cleanly")
                json.dump(existing, OUT.open("w"), indent=1)
                return

            try:
                r = call(model, system, user, key)
            except urllib.error.HTTPError as e:
                print(f"  HTTP {e.code} {model} {j['level']} — {e.read()[:160]!r}")
                continue
            except Exception as e:  # noqa: BLE001 — a spike; log and carry on
                print(f"  FAIL {model} {j['level']}: {type(e).__name__} {e}")
                continue

            rec = {**j, "model": model, "model_label": label,
                   "ctx_chars": len(ctx), "source_author": s["author"], **r}
            existing["runs"].append(rec)
            existing["sources"] = sources
            done.add(k)
            spent += r["cost_usd"]
            json.dump(existing, OUT.open("w"), indent=1)
            print(f"  {label:18s} {j['type']:10s} src{j['source_i']} -> {j['target']:15s} "
                  f"{j['level']:15s} {r['latency_ms']:6d}ms  ${r['cost_usd']:.5f}  "
                  f"total ${spent:.4f}")

    print(f"\ndone. {len(existing['runs'])} runs, ${spent:.4f} spent -> {OUT.name}")


if __name__ == "__main__":
    main()
