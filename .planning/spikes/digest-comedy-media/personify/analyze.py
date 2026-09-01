#!/usr/bin/env python3
"""
analyze.py — three independent reads on the same corpus.

Three rather than one because they fail differently. Delta and char n-grams are
both black boxes that can agree for the wrong reason; the interpretable features
are the only ones that tell you *what* the difference is, and they're the ones
that become the persona card and the trait sliders.

  1. Burrows's Delta      — the canonical authorship measure. Function-word
                            frequencies, z-scored against the corpus. Answers
                            "who wrote this" using words nobody chooses on purpose.
  2. Char n-gram + LR     — the workhorse attributor, and the thing that becomes
                            the style JUDGE. Deliberately 5-way, not binary:
                            "which of the five" forces distinctiveness, where
                            "is this Matt y/n" can be won by writing like nobody.
  3. Interpretable feats  — the readable one. Becomes the persona card.

Run:  .venv/bin/python analyze.py [--kind chat|ballot|both]
"""
from __future__ import annotations
import argparse
import re
from collections import Counter

import numpy as np

import corpus

AP = argparse.ArgumentParser()
AP.add_argument("--kind", default="chat", choices=["chat", "ballot", "both"])
AP.add_argument("--min-chars", type=int, default=40, help="skip very short messages")
A = AP.parse_args()


def texts_for(player_msgs, kind):
    kinds = ["chat", "ballot"] if kind == "both" else [kind]
    return [m.text for k in kinds for m in player_msgs[k] if len(m.text) >= A.min_chars]


data = corpus.by_player()
FOCUS = [p for p in corpus.FOCUS if p in data]
docs = {p: texts_for(data[p], A.kind) for p in FOCUS}
docs = {p: t for p, t in docs.items() if len(t) >= 12}

print(f"=== corpus ({A.kind}, messages >= {A.min_chars} chars) ===")
for p, t in docs.items():
    print(f"  {p:18s} {len(t):5d} messages  {sum(map(len, t)):8,d} chars")
if len(docs) < 2:
    raise SystemExit("\nnot enough players have this content type to compare")

# ── 1. Burrows's Delta ───────────────────────────────────────────────────────
print("\n=== 1. Burrows's Delta — distance between authors ===")
print("    (function-word frequencies, z-scored; higher = more different)")
joined = {p: " ".join(t).lower() for p, t in docs.items()}
tok = {p: re.findall(r"[a-z']+", s) for p, s in joined.items()}
common = [w for w, _ in Counter(w for ws in tok.values() for w in ws).most_common(150)]
freq = np.array([[ws.count(w) / max(1, len(ws)) for w in common] for ws in tok.values()])
z = (freq - freq.mean(0)) / (freq.std(0) + 1e-12)
names = list(tok)
print("\n    " + "".join(f"{n.split()[0][:8]:>10s}" for n in names))
for i, a in enumerate(names):
    row = "".join(f"{np.abs(z[i] - z[j]).mean():10.2f}" if i != j else f"{'—':>10s}"
                  for j in range(len(names)))
    print(f"    {a.split()[0][:8]:8s}{row}")

# ── 2. char n-gram classifier — this becomes the judge ───────────────────────
print("\n=== 2. Char n-gram + logistic regression — the style judge ===")
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_predict
    from sklearn.pipeline import make_pipeline
    from sklearn.metrics import classification_report, confusion_matrix

    X = [t for p in docs for t in docs[p]]
    y = [p for p in docs for _ in docs[p]]
    # lowercase=False matters: capitalisation is a real signal here (Jensen
    # capitalises 99.2% of sentence starts, Matt frequently doesn't). Measured
    # +1.3 points overall. Raw `char` instead of `char_wb` was tried to preserve
    # double-spacing and made it WORSE (0.615) — the feature space explodes and
    # it overfits to topic. Explicit orthographic features are the better route;
    # see judge.py, which adds them for +1.5 more.
    pipe = make_pipeline(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=2,
                        sublinear_tf=True, lowercase=False),
        LogisticRegression(max_iter=2000, C=5, class_weight="balanced"),
    )
    pred = cross_val_predict(pipe, X, y, cv=5)
    print(classification_report(y, pred, digits=2, zero_division=0))
    labels = sorted(set(y))
    cm = confusion_matrix(y, pred, labels=labels)
    print("    confusion (row = truth):")
    print("    " + "".join(f"{l.split()[0][:8]:>10s}" for l in labels))
    for l, row in zip(labels, cm):
        print(f"    {l.split()[0][:8]:8s}" + "".join(f"{v:10d}" for v in row))
    print(f"\n    baseline if guessing the largest class: "
          f"{max(Counter(y).values())/len(y):.2f}")
except ImportError:
    print("    scikit-learn not installed — run .venv/bin/pip install scikit-learn")

# ── 3. interpretable features — the persona card ─────────────────────────────
print("\n=== 3. Interpretable features — z vs these players' average ===")


def feats(ts):
    txt = " ".join(ts)
    W = re.findall(r"[A-Za-z']+", txt) or ["x"]
    S = [x for x in re.split(r"(?<=[.!?])\s+", txt) if x.strip()] or ["x"]
    n = len(W)
    per_k = lambda c: 1000 * c / n
    return {
        "msg_len": sum(map(len, ts)) / len(ts),
        "sent_len": n / len(S),
        "commas": per_k(txt.count(",")),
        "big_words": 100 * sum(1 for w in W if len(w) >= 9) / n,
        "questions": per_k(txt.count("?")),
        "exclaim": per_k(txt.count("!")),
        "profanity": per_k(len(re.findall(r"\b(fuck\w*|shit\w*|ass|dick|cunt|bitch)\b", txt, re.I))),
        "i_me": per_k(len(re.findall(r"\b(I|me|my|mine)\b", txt))),
        "he_she": per_k(len(re.findall(r"\b(he|him|his|she|her|they|their)\b", txt, re.I))),
        "hedges": per_k(len(re.findall(r"\b(maybe|probably|I think|seems|kinda|sort of|I guess)\b", txt, re.I))),
        "links": per_k(len(re.findall(r"https?://|🔗", txt))),
        "allcaps": per_k(sum(1 for w in W if len(w) > 2 and w.isupper())),
        "dbl_space": per_k(len(re.findall(r"[.!?]  ", txt))),
        "ellipsis": per_k(txt.count("...")),
        "laughter": per_k(len(re.findall(r"\b(ha+h?a+|lol|heh)\b", txt, re.I))),
    }


F = {p: feats(t) for p, t in docs.items()}
keys = list(next(iter(F.values())))
mu = {k: np.mean([F[p][k] for p in F]) for k in keys}
sd = {k: (np.std([F[p][k] for p in F]) or 1) for k in keys}

print("\n    " + f"{'feature':12s}" + "".join(f"{p.split()[0][:9]:>10s}" for p in docs))
for k in keys:
    print(f"    {k:12s}" + "".join(f"{F[p][k]:10.1f}" for p in docs))

print("\n    strongest deviations (z vs this group's mean):")
for p in docs:
    top = sorted(((k, (F[p][k] - mu[k]) / sd[k]) for k in keys), key=lambda kv: -abs(kv[1]))[:5]
    print(f"    {p:18s} " + "  ".join(f"{k}{v:+.1f}" for k, v in top))
