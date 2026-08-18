#!/usr/bin/env python3
"""
ingest_players.py — build a structured, image-gen-ready description of each
person from the player photos.

Filenames encode who's in the shot, left→right, hyphen-separated, e.g.
    davesteingart-clements-jonblack-mattm-maram-shanefarkas.jpeg
A NUMBER token (1, 2, 3 …) marks a NON-member extra at that left-to-right
position — someone in the photo who isn't a player. These are kept as skipped
slots (NOT dropped) so the left-to-right alignment stays correct, e.g.
    1-2-clementsj-conorj-mattm-shanef-3.jpeg
is 7 people: [extra][extra] Clements Conor Matt Shane [extra] — 4 members to
describe at positions 3–6. Aliases (mattm → Matt Mariani) are in PEOPLE_ALIASES.

For each photo the vision model is told the full headcount and which positions
are members, describes the members left→right (ignoring the extras), and we zip
those descriptions to the member names. People are described AS THEY APPEAR in
the photo (no aging up/down). When a person appears in several photos, a merge
pass consolidates them.

Usage:
    python scripts/cover-gen/ingest_players.py                 # all of examples/players
    python scripts/cover-gen/ingest_players.py path/to/dir     # a different dir
    python scripts/cover-gen/ingest_players.py a.jpg b.jpg     # specific files
    python scripts/cover-gen/ingest_players.py --model anthropic/claude-sonnet-4.5
    python scripts/cover-gen/ingest_players.py --dry-run       # parse names only, no LLM

Output: scripts/cover-gen/out/people.json
"""
import sys, json, argparse, re
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _or  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / "examples" / "players"
OUT = Path(__file__).resolve().parent / "out" / "people.json"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
AGE_NOW = "as-photographed"  # no aging: render people as they appear in the source photos

# filename token → canonical display name. Extend as new people appear.
PEOPLE_ALIASES = {
    "clements": "Clements Johnson", "clementsj": "Clements Johnson",
    "clementsjohnson": "Clements Johnson",
    "conorj": "Conor Johnston", "conorjohnston": "Conor Johnston", "conor": "Conor Johnston",
    "mattm": "Matt Mariani", "mattmariani": "Matt Mariani",
    "maram": "Mara Mariani", "maramariani": "Mara Mariani",
    "shanef": "Shane Farkas", "shanefarkas": "Shane Farkas",
    "jonblack": "Jon Black", "jonathanblack": "Jon Black", "jb": "Jon Black",
    "davesteingart": "Dave Steingart", "steiny": "Dave Steingart",
    "davejensen": "Dave Jensen", "djensen": "Dave Jensen",
    "sarahblack": "Sarah Black",
    "tjcook": "TJ Cook",
    "grantkoziol": "Grant Koziol",
    "darrenpaletz": "Darren Paletz", "paletz": "Darren Paletz",
}

VISION_SYS = (
    "You are a casting director and forensic-portrait analyst. You describe the "
    "distinctive, identifying visual traits of real people from photos so an "
    "image model can recognizably recreate them. Be specific and concrete; avoid "
    "flattery and vague adjectives."
)

MERGE_SYS = (
    "You consolidate several independent observations of the SAME person "
    "(from different photos) into one accurate, non-contradictory description. "
    "Prefer traits that recur; note uncertainty where observations disagree."
)

PERSON_SCHEMA_HINT = (
    '{"gender": "", "apparent_age": "how old they look in THIS photo", '
    '"build": "", "face_shape": "", "complexion": "", '
    '"hair": "color, length, style", "facial_hair": "", "eyes": "", '
    '"glasses": "", "distinctive_features": ["..."], '
    '"typical_expression": "", "casting_note": "one vivid paragraph an image '
    'model can use to recreate this specific person AS THEY APPEAR in this photo"}'
)


# Tokens that mark a NON-member extra at a left-to-right position. A pure number
# (your convention) or any of these words all work, so "extra" never becomes a
# phantom player named "Extra".
SKIP_TOKENS = {"extra", "extras", "x", "guest", "unknown", "other"}


def is_skip(t: str) -> bool:
    return t.isdigit() or t in SKIP_TOKENS


def parse_slots(stem: str):
    """Ordered left→right slots. A slot is a canonical player name, or None for a
    non-member extra (a number — your convention — or a SKIP_TOKENS word). Keeping
    the None slots preserves alignment so the model's left-to-right descriptions
    map to the right member positions."""
    slots = []
    for t in re.split(r"[-_]+", stem):
        t = t.strip().lower()
        if not t:
            continue
        slots.append(None if is_skip(t) else PEOPLE_ALIASES.get(t, t.title()))
    return slots


def players_in(slots):
    return [nm for nm in slots if nm]


def collect_images(args_paths):
    if not args_paths:
        base = DEFAULT_DIR
        return sorted(p for p in base.iterdir() if p.suffix.lower() in IMG_EXT)
    out = []
    for a in args_paths:
        p = Path(a)
        if p.is_dir():
            out.extend(sorted(q for q in p.iterdir() if q.suffix.lower() in IMG_EXT))
        elif p.suffix.lower() in IMG_EXT:
            out.append(p)
    return out


def rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(p)


def describe_photo(img: Path, slots, model):
    total = len(slots)
    players = players_in(slots)
    roster = ", ".join(
        (f"#{i} {nm}" if nm else f"#{i} (someone else — not a member)")
        for i, nm in enumerate(slots, 1)
    )
    prompt = (
        f"This photo contains {total} people, left to right. Who is at each "
        f"position: {roster}.\n\n"
        f"Only the {len(players)} named people are league members to describe. The "
        f"'someone else' positions are non-members — account for them when reading "
        f"left to right, but DO NOT describe them.\n\n"
        f"For EACH member, in left-to-right order (skipping non-members), describe "
        f"their key identifying visual traits EXACTLY AS THEY APPEAR in this photo "
        f"— their apparent age here, hair, build, features. Do NOT age them up or "
        f"down; capture how they actually look in the image.\n\n"
        f'Return JSON: {{"people": [ {PERSON_SCHEMA_HINT}, ... ]}} with exactly '
        f"{len(players)} entries, in that member order. No names in the objects."
    )
    data = _or.vision_json(VISION_SYS, prompt, image_paths=[img], model=model)
    people = data.get("people", data if isinstance(data, list) else [])
    return people


def merge_person(name, observations, model):
    prompt = (
        f"Person: {name}. Here are {len(observations)} independent "
        f"observations of them from different photos:\n\n"
        + json.dumps(observations, ensure_ascii=False, indent=2)
        + f"\n\nConsolidate into ONE description. Return JSON with this shape: "
        f"{PERSON_SCHEMA_HINT}"
    )
    return _or.vision_json(MERGE_SYS, prompt, model=model)


def main():
    ap = argparse.ArgumentParser(description="Describe player photos for cover generation.")
    ap.add_argument("paths", nargs="*", help="image files or dirs (default: examples/players)")
    ap.add_argument("--model", help="OpenRouter vision model (default: env OPENROUTER_VISION_MODEL / digest model)")
    ap.add_argument("--out", default=str(OUT), help="output JSON path")
    ap.add_argument("--dry-run", action="store_true", help="parse names from filenames only; no LLM calls")
    args = ap.parse_args()

    images = collect_images(args.paths)
    if not images:
        raise SystemExit("no images found")

    print(f"[players] {len(images)} image(s)")
    observations = {}  # name -> list of per-photo dicts
    sources = {}       # name -> set of image rels

    for img in images:
        slots = parse_slots(img.stem)
        names = players_in(slots)
        layout = " ".join(nm if nm else "·extra" for nm in slots)
        print(f"  {img.name}  →  {layout or '(no names parsed)'}")
        if args.dry_run or not names:
            for nm in names:
                sources.setdefault(nm, set()).add(rel(img))
            continue
        try:
            descs = describe_photo(img, slots, args.model)
        except Exception as e:
            print(f"    ! vision failed: {e}")
            continue
        if len(descs) != len(names):
            print(f"    ~ model returned {len(descs)} descriptions for {len(names)} members; zipping by min length")
        for nm, d in zip(names, descs):
            observations.setdefault(nm, []).append({"source": rel(img), **d})
            sources.setdefault(nm, set()).add(rel(img))

    people = {}
    for nm in sorted(sources):
        obs = observations.get(nm, [])
        record = {"name": nm, "source_images": sorted(sources[nm]), "observation_count": len(obs)}
        if args.dry_run or not obs:
            people[nm] = record
            continue
        if len(obs) == 1:
            merged = {k: v for k, v in obs[0].items() if k != "source"}
        else:
            print(f"[merge] {nm} ({len(obs)} observations)")
            try:
                merged = merge_person(nm, [{k: v for k, v in o.items() if k != "source"} for o in obs], args.model)
            except Exception as e:
                print(f"    ! merge failed, using first observation: {e}")
                merged = {k: v for k, v in obs[0].items() if k != "source"}
        record["appearance"] = merged
        people[nm] = record

    out = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": args.model or _or.default_model(),
            "person_count": len(people),
            "dry_run": args.dry_run,
        },
        "people": people,
    }
    outp = Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[done] {len(people)} people → {rel(outp)}")


if __name__ == "__main__":
    main()
