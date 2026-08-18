#!/usr/bin/env python3
"""
cover-gen — one entry point for the cover-cover toolkit.

Commands:
  cover-gen ingest            describe covers + players, then crop solo faces
  cover-gen covers  [...]     describe album covers → out/covers.json
  cover-gen players [...]     describe player photos → out/people.json
  cover-gen faces   [...]     crop a clean solo face per person → faces/
  cover-gen make    [...]     assemble a prompt (add --generate to make the image)
  cover-gen menu              interactive, menu-driven mode
  cover-gen list  covers|people|styles

Each command takes --help for its own options, e.g.:
  cover-gen make --help

All LLM/image calls go through OpenRouter (OPENROUTER_API_KEY in the repo .env).
Image generation defaults to Gemini 2.5 Flash Image ("Nano Banana").
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _or  # noqa: E402
import ingest_players, ingest_covers, make_cover, crop_faces  # noqa: E402

HELP = __doc__

EXAMPLES = """\
Examples:
  cover-gen ingest                              # first run: describe everything
  cover-gen make --count 4                      # a 4-person cover, random cast
  cover-gen make --cover zep --style vangogh --title "BOARZ II MEN"
  cover-gen make --random --style random --generate     # make an actual image
  cover-gen menu                                # walk through it interactively
"""


def _run(module, rest, prog):
    sys.argv = [prog] + rest
    module.main()


# ── interactive menu ──────────────────────────────────────────────────────────
def _ask(prompt, default=""):
    try:
        v = input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)
    return v or default


def _pick_from(label, items, allow_random=True):
    """Show a numbered list; return the chosen item (or 'RANDOM')."""
    print(f"\n{label}:")
    for i, it in enumerate(items, 1):
        print(f"  {i:>2}. {it}")
    if allow_random:
        print("   r. random")
    while True:
        sel = _ask("> ")
        if allow_random and sel.lower() in ("r", "random", ""):
            return "RANDOM"
        if sel.isdigit() and 1 <= int(sel) <= len(items):
            return items[int(sel) - 1]
        print("  (enter a number" + (" or 'r'" if allow_random else "") + ")")


def interactive():
    import random
    rng = random.Random()

    covers_data = HERE / "out" / "covers.json"
    people_data = HERE / "out" / "people.json"
    if not covers_data.exists() or not people_data.exists():
        print("Covers or people not described yet.")
        if _ask("Run the ingest now? [Y/n] ", "y").lower().startswith("y"):
            _run(ingest_covers, [], "ingest_covers.py")
            _run(ingest_players, [], "ingest_players.py")
        else:
            return

    covers = make_cover.load(covers_data, "covers.json")["covers"]
    people = make_cover.load(people_data, "people.json")["people"]

    print("\n=== cover-gen · interactive ===")

    # 1) cover
    cover_keys = [f"{k}  (people={c.get('people_count','?')}, {c.get('album','')})" for k, c in covers.items()]
    keys = list(covers.keys())
    print("\nChoose a COVER — a number, 'r' for random, or 'c' to pick by headcount:")
    for i, ck in enumerate(cover_keys, 1):
        print(f"  {i:>2}. {ck}")
    print("   r. random     c. by people-count")
    while True:
        sel = _ask("> ", "r")
        if sel.lower() in ("r", "random"):
            cover = rng.choice(list(covers.values())); break
        if sel.lower() == "c":
            n = int(_ask("  how many people? ", "4"))
            cover = make_cover.pick_cover_by_count(covers, n, rng); break
        if sel.isdigit() and 1 <= int(sel) <= len(keys):
            cover = covers[keys[int(sel) - 1]]; break
        print("  (number, 'r', or 'c')")
    print(f"  → {cover.get('album', cover.get('key'))}")

    # 2) people
    print("\nChoose PEOPLE — comma-separated names, 'r' for random, or blank to match the cover:")
    names_list = list(people.keys())
    for i, nm in enumerate(names_list, 1):
        print(f"  {i:>2}. {nm}")
    raw = _ask("> ", "")
    if raw.lower() in ("r", "random"):
        n = int(_ask("  how many? ", str(cover.get("people_count") or 3)))
        chosen_names = rng.sample(names_list, min(n, len(names_list)))
    elif not raw:
        n = cover.get("people_count") or 3
        chosen_names = rng.sample(names_list, min(n, len(names_list)))
    else:
        # accept numbers or names
        picks = []
        for tok in raw.split(","):
            tok = tok.strip()
            if tok.isdigit() and 1 <= int(tok) <= len(names_list):
                picks.append(names_list[int(tok) - 1])
            elif tok:
                picks.append(tok)
        chosen_names = make_cover.resolve_people(people, picks)
    print(f"  → {', '.join(chosen_names)}")

    # 3) style
    style = _pick_from("Choose a STYLE", list(make_cover.STYLES.keys()))
    if style == "RANDOM":
        style = rng.choice(list(make_cover.STYLES))
    print(f"  → {style}")

    # 4) title
    title = _ask("\nBand-name / title text (blank to keep it faithful): ", "")

    # 5) generate?
    gen = _ask("\nGenerate the actual image now via OpenRouter? [y/N] ", "n").lower().startswith("y")

    chosen = [people[n] for n in chosen_names]
    print()
    try:
        make_cover.emit(cover, chosen_names, chosen, style, title, generate=gen)
    except Exception as e:
        print(f"[error] {e}")


def main():
    argv = sys.argv[1:]
    cmd = argv[0] if argv else None
    rest = argv[1:]

    if cmd in (None, "-h", "--help", "help"):
        print(HELP)
        print(EXAMPLES)
        return
    if cmd == "players":
        _run(ingest_players, rest, "ingest_players.py")
    elif cmd == "covers":
        _run(ingest_covers, rest, "ingest_covers.py")
    elif cmd == "faces":
        _run(crop_faces, rest, "crop_faces.py")
    elif cmd == "make":
        _run(make_cover, rest, "make_cover.py")
    elif cmd == "list":
        _run(make_cover, ["--list"] + rest, "make_cover.py")
    elif cmd == "ingest":
        _run(ingest_covers, rest, "ingest_covers.py")
        _run(ingest_players, rest, "ingest_players.py")
        _run(crop_faces, [], "crop_faces.py")
    elif cmd in ("menu", "interactive", "i"):
        interactive()
    else:
        print(f"unknown command: {cmd}\n")
        print(HELP)
        sys.exit(2)


if __name__ == "__main__":
    main()
