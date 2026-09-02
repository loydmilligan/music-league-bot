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

# Every persona in profiles/, ordered by corpus volume. Index order matters: the
# target rotation below is defined as offsets in this list.
ALL_AUTHORS = [
    "Matt Mariani", "Jon Black", "Conor Johnston", "Grant Koziol", "Dave Jensen",
    "Shane Farkas", "Jimmy", "Clements Johnson", "Dave Steingart", "Darren Paletz",
]

# The original four sources ran against these fixed targets. Kept verbatim so the
# 192 existing runs still dedupe by key and their ratings stay attached.
TARGETS_FOR = {
    "Matt Mariani": ["Jon Black", "Grant Koziol"],
    "Jon Black": ["Conor Johnston", "Dave Jensen"],
    "Conor Johnston": ["Jon Black", "Grant Koziol"],
    "Grant Koziol": ["Dave Jensen", "Matt Mariani"],
    "Dave Jensen": ["Conor Johnston", "Matt Mariani"],
}

# Rotation for the expanded sweep: target = author index + offset, mod 10. Two
# coprime-ish offsets mean every persona is a target exactly twice per sweep and
# nobody translates themselves. Chosen over "nearest pair" because the spike's
# delta matrix says distance is what is funny — and over random because the pair
# list has to be reproducible. Neither offset yields Matt<->Jon, the pair the
# matrix scored least funny (1.17, reads as unchanged).
ROTATION_OFFSETS = (3, 7)


def targets_for(author: str) -> list[str]:
    i = ALL_AUTHORS.index(author)
    return [ALL_AUTHORS[(i + off) % len(ALL_AUTHORS)] for off in ROTATION_OFFSETS]


ENGLISH_LEVELS = ["L2_kit", "L4_full"]


def pick_sources(pool, authors=None, per_author=1, seed=11, exclude=()):
    """Representative messages per author, deterministic, skipping `exclude` texts.

    Wants messages that are translatable: long enough to have style, short enough
    to keep output cheap, and not a bare link or a one-word reply. The band is
    wider than the original sweep (100-520 rather than 140-420) because the thin
    corpora — Darren has 70 chat messages — do not clear the tighter bar often
    enough to fill a rotation.
    """
    rng = random.Random(seed)
    authors = authors if authors is not None else ALL_AUTHORS
    out = []
    for who in authors:
        if who not in pool:
            continue
        cands = []
        for kind in ("chat", "ballot"):
            for m in pool[who][kind]:
                t = m.text.strip()
                if not (100 <= len(t) <= 520):
                    continue
                if "http" in t or t.count("\n") > 6:
                    continue
                if len(re.findall(r"[A-Za-z']+", t)) < 20:
                    continue
                if t in exclude:
                    continue
                cands.append((kind, t))
        if not cands:
            print(f"  !! no usable source messages for {who}")
            continue
        # Sample without replacement so one author never contributes the same
        # message twice, and sort for a stable order independent of dict order.
        cands.sort()
        picks = rng.sample(cands, min(per_author, len(cands)))
        for kind, text in picks:
            out.append({"author": who, "kind": kind, "text": text})
    return out


def balanced_cells(n_slots: int, grid: list, seed: int = 17):
    """Deal `n_slots` (model, level) cells off a repeatedly-shuffled grid.

    A full 4x5 cross per source is the honest design but costs 20 calls an item;
    at 20 new sources that is a $7 run of mostly redundant content. Dealing from
    a shuffled deck instead keeps every cell within one of every other cell's
    count, so the model/level comparison stays balanced while the ratings pool
    fills with DIFFERENT source texts rather than the same four seen 48 times.
    """
    rng = random.Random(seed)
    out, deck = [], []
    while len(out) < n_slots:
        if not deck:
            deck = list(grid)
            rng.shuffle(deck)
        out.append(deck.pop())
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


def anchor_order(models):
    """Opus first, then descending price. If the budget bites it must bite the
    cheap arms — losing a $0.08 arm is recoverable, losing half the reference arm
    invalidates every comparison read against it."""
    return sorted(models, key=lambda m: 0 if "opus" in m[0] else 1 if "openai" in m[0]
                  else 2 if "gemini" in m[0] else 3)


def build_jobs(sources, legacy_n, cells_per_pair, english_cells, seed):
    """One flat job list, each job naming its own model.

    Sources below `legacy_n` keep the original full 4x5 cross: those runs already
    exist and their keys must still be generated or a re-run would redo them.
    Sources at or above it get balanced cells instead (see balanced_cells).
    """
    order = anchor_order(MODELS)
    jobs = []

    for si in range(min(legacy_n, len(sources))):
        author = sources[si]["author"]
        for model, label in order:
            for tgt in TARGETS_FOR.get(author, []):
                for lv in levels.LEVELS:
                    jobs.append({"type": "to_person", "source_i": si, "target": tgt,
                                 "level": lv, "model": model, "model_label": label})
            for lv in ENGLISH_LEVELS:
                jobs.append({"type": "to_english", "source_i": si, "target": "plain english",
                             "level": lv, "model": model, "model_label": label})

    new_idx = list(range(legacy_n, len(sources)))
    if not new_idx:
        return jobs

    label_of = dict(MODELS)
    grid = [(m, lv) for m, _ in order for lv in levels.LEVELS]
    en_grid = [(m, lv) for m, _ in order for lv in ENGLISH_LEVELS]

    pairs = [(si, tgt) for si in new_idx for tgt in targets_for(sources[si]["author"])]
    deal = balanced_cells(len(pairs) * cells_per_pair, grid, seed=seed)
    for i, (si, tgt) in enumerate(pairs):
        for model, lv in deal[i * cells_per_pair:(i + 1) * cells_per_pair]:
            jobs.append({"type": "to_person", "source_i": si, "target": tgt,
                         "level": lv, "model": model, "model_label": label_of[model]})

    en_deal = balanced_cells(len(new_idx) * english_cells, en_grid, seed=seed + 1)
    for i, si in enumerate(new_idx):
        for model, lv in en_deal[i * english_cells:(i + 1) * english_cells]:
            jobs.append({"type": "to_english", "source_i": si, "target": "plain english",
                         "level": lv, "model": model, "model_label": label_of[model]})

    # Opus-first again across the whole list, so a budget abort loses cheap arms.
    rank = {m: i for i, (m, _) in enumerate(order)}
    jobs.sort(key=lambda j: rank[j["model"]])
    return jobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=1.85)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--variety", action="store_true",
                    help="append new sources for every persona and deal balanced cells")
    ap.add_argument("--per-author", type=int, default=2, help="new sources per persona")
    ap.add_argument("--cells", type=int, default=5, help="model/level cells per new source+target")
    ap.add_argument("--english-cells", type=int, default=2, help="cells per new source, to_english")
    ap.add_argument("--seed", type=int, default=23)
    a = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY")
    if not key and not a.dry_run:
        raise SystemExit("OPENROUTER_API_KEY not set")

    pool = corpus.by_player()
    existing = json.loads(OUT.read_text()) if OUT.exists() else {"runs": [], "sources": []}

    # SOURCES ARE APPEND-ONLY. Human ratings live in browser localStorage keyed by
    # model|type|source_i|target|level, so reordering or replacing this list
    # silently reattaches every existing rating to the wrong translation.
    sources = list(existing.get("sources") or [])
    legacy_n = len(sources)
    if not sources:
        sources = pick_sources(pool, authors=ALL_AUTHORS[:4], per_author=1, seed=11)
        legacy_n = len(sources)
    if a.variety:
        seen = {s["text"] for s in sources}
        added = pick_sources(pool, per_author=a.per_author, seed=a.seed, exclude=seen)
        sources.extend(added)
        print(f"appended {len(added)} new sources after the {legacy_n} existing "
              f"(indices {legacy_n}..{len(sources)-1})")

    jobs = build_jobs(sources, legacy_n, a.cells, a.english_cells, a.seed)

    done = {(r["model"], r["type"], r["source_i"], r["target"], r["level"])
            for r in existing["runs"]}
    spent = sum(r.get("cost_usd", 0) for r in existing["runs"])
    todo = [j for j in jobs
            if (j["model"], j["type"], j["source_i"], j["target"], j["level"]) not in done]

    print(f"sources: {len(sources)}  jobs: {len(jobs)}  already done: {len(done)}  "
          f"to run: {len(todo)}  spent so far: ${spent:.4f}")
    per_target = {}
    for j in todo:
        if j["type"] == "to_person":
            per_target[j["target"]] = per_target.get(j["target"], 0) + 1
    if per_target:
        print("  new runs per target: " + ", ".join(f"{k}={v}" for k, v in sorted(per_target.items())))
    for i in range(legacy_n, len(sources)):
        s = sources[i]
        print(f"  [{i}] {s['author']:17s} ({s['kind']:6s}) -> {', '.join(targets_for(s['author']))}")
        print(f"       {s['text'][:100]!r}")
    if a.dry_run:
        return

    for j in todo:
        s = sources[j["source_i"]]
        who = j["target"] if j["type"] == "to_person" else s["author"]
        ctx = levels.build(j["level"], who, s["text"], pool)
        if j["type"] == "to_person":
            system, user = SYS, prompt_to_person(ctx, j["target"], s["text"])
        else:
            system, user = SYS_EN, prompt_to_english(ctx, s["author"], s["text"])

        # Guard BEFORE spending.
        if spent >= a.budget:
            print(f"\n!! budget reached (${spent:.4f} >= ${a.budget}) — stopping cleanly")
            break

        try:
            r = call(j["model"], system, user, key)
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code} {j['model']} {j['level']} — {e.read()[:160]!r}")
            continue
        except Exception as e:  # noqa: BLE001 — a spike; log and carry on
            print(f"  FAIL {j['model']} {j['level']}: {type(e).__name__} {e}")
            continue

        rec = {**j, "ctx_chars": len(ctx), "source_author": s["author"], **r}
        existing["runs"].append(rec)
        existing["sources"] = sources
        spent += r["cost_usd"]
        json.dump(existing, OUT.open("w"), indent=1)
        flag = "  EMPTY!" if not r["text"] else ""
        print(f"  {j['model_label']:18s} {j['type']:10s} src{j['source_i']:<3d} -> "
              f"{j['target']:17s} {j['level']:15s} {r['latency_ms']:6d}ms  "
              f"${r['cost_usd']:.5f}  total ${spent:.4f}{flag}")

    existing["sources"] = sources
    json.dump(existing, OUT.open("w"), indent=1)
    print(f"\ndone. {len(existing['runs'])} runs, ${spent:.4f} spent -> {OUT.name}")


if __name__ == "__main__":
    main()
