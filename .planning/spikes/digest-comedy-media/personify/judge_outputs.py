#!/usr/bin/env python3
"""
judge_outputs.py — score every translation with the N-way style judge.

The judge is the char n-gram + logistic regression classifier from analyze.py,
trained on the real Boarz corpus. For each generated translation it reports the
probability mass assigned to the INTENDED target.

  to_person   higher p(target) is better — the impression is recognisable
  to_english  LOWER p(original author) is better — deflation means the style is
              gone, so the classifier should no longer see its author

Two honest caveats, both stated in the report:

1. The judge is trained on real human messages and asked to score LLM output.
   That is out-of-distribution, so absolute probabilities mean little. Compared
   ACROSS arms on identical inputs, which is the only way it is used here, the
   relative ordering is still informative.
2. Recognisable is not the same as funny. This measures the first only. Funny is
   what the human rating pass in the HTML report is for.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import cross_val_predict
from sklearn.metrics import accuracy_score

import corpus
import levels

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "matrix_results.json"
MIN_CHARS = 40


def train():
    data = corpus.by_player()
    # Every persona with a profile, not just the focus five. A 10-way judge is a
    # harder problem — chance falls 0.20 -> 0.10 and the spike measured ~8% of
    # accuracy lost — but a 5-way judge cannot score a translation aimed at Jimmy
    # at all, and scoring half the matrix is worse than scoring all of it slightly
    # less sharply. Absolute probabilities were never comparable across judges
    # anyway; rescoring every run together keeps the arms comparable to each other.
    people = [p for p in levels.FILESTEM if p in data]
    docs = {p: [m.text for k in ("chat", "ballot") for m in data[p][k]
                if len(m.text) >= MIN_CHARS] for p in people}
    docs = {p: t for p, t in docs.items() if len(t) >= 12}
    X = [t for p in docs for t in docs[p]]
    y = [p for p in docs for _ in docs[p]]
    # Same configuration as analyze.py §2 — lowercase=False because
    # capitalisation is real signal here.
    pipe = make_pipeline(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=2,
                        sublinear_tf=True, lowercase=False),
        LogisticRegression(max_iter=2000, C=5, class_weight="balanced"),
    )
    cv = cross_val_predict(pipe, X, y, cv=5)
    holdout = accuracy_score(y, cv)
    pipe.fit(X, y)
    return pipe, holdout, len(X)


def main():
    d = json.loads(RESULTS.read_text())
    pipe, holdout, n = train()
    classes = list(pipe.classes_)
    print(f"judge trained on {n} real messages; {len(classes)}-way cross-val accuracy "
          f"{holdout:.3f} (chance ~{1/len(classes):.2f})")
    thin = [p for p in levels.FILESTEM if p not in classes]
    if thin:
        print(f"  !! no classifier class (too few messages): {', '.join(thin)}")

    scored = 0
    for r in d["runs"]:
        text = (r.get("text") or "").strip()
        if len(text) < 15:
            r["judge"] = None
            continue
        proba = pipe.predict_proba([text])[0]
        by_class = dict(zip(classes, proba))
        ranked = sorted(zip(classes, proba), key=lambda kv: -kv[1])
        if r["type"] == "to_person":
            subject = r["target"]
            direction = "higher_better"
        else:
            subject = r["source_author"]
            direction = "lower_better"
        if subject not in by_class:
            # A target the judge has no class for: score nothing rather than
            # something wrong. The human rating pass still covers these rows.
            r["judge"] = None
            continue
        r["judge"] = {
            "p_subject": float(by_class[subject]),
            "subject": subject,
            "direction": direction,
            "top_label": ranked[0][0],
            "top_p": float(ranked[0][1]),
            "hit": bool(ranked[0][0] == subject),
        }
        scored += 1

    d["judge_meta"] = {"holdout_accuracy": holdout, "train_n": n, "classes": classes,
                       "n_classes": len(classes), "chance": 1.0 / len(classes)}
    json.dump(d, RESULTS.open("w"), indent=1)
    print(f"scored {scored} of {len(d['runs'])} runs -> {RESULTS.name}")

    # quick console read of the headline: mean p(target) by level, to_person only
    per = {}
    for r in d["runs"]:
        if r["type"] != "to_person" or not r.get("judge"):
            continue
        per.setdefault((r["model_label"], r["level"]), []).append(r["judge"]["p_subject"])
    if per:
        models = sorted({k[0] for k in per})
        lvls = [l for l in ["L1_fingerprint", "L2_kit", "L3_situational",
                            "L4_full", "L5_retrieved"] if any(k[1] == l for k in per)]
        print("\nmean p(target)  (to_person)")
        print(f"{'model':20s}" + "".join(f"{l.split('_')[0]:>8s}" for l in lvls))
        for m in models:
            row = "".join(f"{np.mean(per[(m,l)]):8.2f}" if (m, l) in per else f"{'—':>8s}"
                          for l in lvls)
            print(f"{m:20s}{row}")


if __name__ == "__main__":
    main()
