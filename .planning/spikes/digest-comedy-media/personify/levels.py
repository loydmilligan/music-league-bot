#!/usr/bin/env python3
"""
levels.py — five depths of persona context, built from the same dossiers.

The spike question is how much of a dossier a translation actually needs. These
are the arms:

  L1 fingerprint  ~150 tok   mechanical tells only, no character
  L2 kit          ~1.2k tok  the imitation kit (rules + 5 quotes)
  L3 situational  ~4k tok    kit + voice + humor + negative space
  L4 full         ~6.5k tok  the whole dossier
  L5 retrieved    ~1.5k tok  kit + real messages retrieved for THIS input

L5 is the interesting one: instead of the same five exemplars every time, it
pulls the messages this person actually wrote that are closest in subject to
the text being translated. Cheap lexical overlap, no embeddings.

Section numbers differ per profile (Jensen has an extra section, so his
imitation kit is 7 not 6) — match on title text, never the number.
"""
from __future__ import annotations
import re
from pathlib import Path

import corpus

PROFILES = Path(__file__).resolve().parent / "profiles"

# canonical name -> profile filename stem
FILESTEM = {
    "Matt Mariani": "Matt_Mariani",
    "Jon Black": "Jon_Black",
    "Conor Johnston": "Conor_Johnston",
    "Grant Koziol": "Grant_Koziol",
    "Dave Jensen": "Dave_Jensen",
}

LEVELS = ["L1_fingerprint", "L2_kit", "L3_situational", "L4_full", "L5_retrieved"]


def _sections(name: str) -> list[tuple[str, str]]:
    """[(title, body)] for each '## ' section, title lowercased and de-numbered."""
    raw = (PROFILES / f"{FILESTEM[name]}.md").read_text(encoding="utf-8")
    parts = re.split(r"^## +", raw, flags=re.M)[1:]
    out = []
    for p in parts:
        head, _, body = p.partition("\n")
        title = re.sub(r"^[0-9]+\.\s*", "", head).strip().lower()
        out.append((title, body.strip()))
    return out


def _find(name: str, *needles: str) -> str:
    for title, body in _sections(name):
        if any(n in title for n in needles):
            return body
    return ""


def full(name: str) -> str:
    return (PROFILES / f"{FILESTEM[name]}.md").read_text(encoding="utf-8").strip()


def kit(name: str) -> str:
    return _find(name, "imitation kit")


def fingerprint(name: str, max_rules: int = 6) -> str:
    """The mechanical tells only — the first numbered rules, stripped of examples.

    Deliberately lossy: this arm exists to show what a pure surface-level card
    buys you, so quotes and rationale are cut on purpose.
    """
    lines = []
    for ln in kit(name).splitlines():
        m = re.match(r"^\s*(\d+)\.\s+(.*)$", ln)
        if not m:
            continue
        text = m.group(2)
        # keep the rule, drop the illustrative quote that follows an em-dash/colon
        text = re.split(r"\s+[—–]\s+|:\s+\*", text)[0].strip()
        text = re.sub(r"\*+", "", text).rstrip(".")
        lines.append(f"- {text}.")
        if len(lines) >= max_rules:
            break
    return "\n".join(lines)


def situational(name: str) -> str:
    blocks = [
        ("IMITATION KIT", kit(name)),
        ("VOICE AND MECHANICS", _find(name, "voice and mechanics", "voice")),
        ("HUMOR STYLE", _find(name, "humor style", "humor")),
        ("NEGATIVE SPACE — never do these", _find(name, "negative space")),
    ]
    return "\n\n".join(f"### {h}\n{b}" for h, b in blocks if b)


_WORD = re.compile(r"[a-z']{4,}")
_STOP = set("""this that with have from they them then than were what when
which will would could should about there their been being just like only some
more most much very also into over your yours ours mine really actually because
gonna wanna sure yeah okay know think thing things good great""".split())


def _keys(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP}


def retrieved(name: str, source_text: str, k: int = 6,
              pool: dict | None = None) -> str:
    """Kit, plus the k real messages by this person closest in subject to the input.

    Scoring is Jaccard-ish overlap on content words. Crude on purpose — the point
    of the arm is whether TOPICAL exemplars beat generic ones, and if a bag of
    words is enough to show that, embeddings are not needed.
    """
    pool = pool if pool is not None else corpus.by_player()
    msgs = [m for kind in ("chat", "ballot") for m in pool[name][kind]
            if 60 <= len(m.text) <= 900]
    q = _keys(source_text)
    if not q or not msgs:
        return kit(name)
    scored = []
    for m in msgs:
        ks = _keys(m.text)
        if not ks:
            continue
        scored.append((len(q & ks) / (len(q | ks) ** 0.5), m.text))
    scored.sort(key=lambda s: -s[0])
    picks = [t for s, t in scored[:k] if s > 0]
    if not picks:
        return kit(name)
    quotes = "\n\n".join(f"> {t.strip()}" for t in picks)
    return (f"{kit(name)}\n\n### REAL MESSAGES BY THIS PERSON ON A SIMILAR SUBJECT\n"
            f"(retrieved for this specific input — match the register, not the content)\n\n{quotes}")


def build(level: str, name: str, source_text: str, pool: dict | None = None) -> str:
    if level == "L1_fingerprint":
        return fingerprint(name)
    if level == "L2_kit":
        return kit(name)
    if level == "L3_situational":
        return situational(name)
    if level == "L4_full":
        return full(name)
    if level == "L5_retrieved":
        return retrieved(name, source_text, pool=pool)
    raise ValueError(level)


if __name__ == "__main__":
    pool = corpus.by_player()
    sample = "I cannot believe this song won. It is four minutes of a guy whispering over a drum machine."
    print(f"{'level':18s}{'chars':>8s}{'~tok':>8s}   (Jon Black)")
    for lv in LEVELS:
        t = build(lv, "Jon Black", sample, pool)
        print(f"{lv:18s}{len(t):8d}{len(t)//4:8d}")
    print("\n--- L1 fingerprint ---\n" + build("L1_fingerprint", "Jon Black", sample, pool))
