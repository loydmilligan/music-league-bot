#!/usr/bin/env python3
"""
ingest_covers.py — build a structured, recreation-level description of each
album cover in examples/ (the subjects, setting, composition, color, film look,
and typography), detailed enough to recreate the cover with DIFFERENT people.

Usage:
    python scripts/cover-gen/ingest_covers.py                 # all covers in examples/
    python scripts/cover-gen/ingest_covers.py path/to/dir
    python scripts/cover-gen/ingest_covers.py zep.jpg queen.jpg
    python scripts/cover-gen/ingest_covers.py --model anthropic/claude-sonnet-4.5

Output: scripts/cover-gen/out/covers.json  (+ a human-readable covers.md)
"""
import sys, json, argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _or  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / "examples"
OUT = Path(__file__).resolve().parent / "out" / "covers.json"
OUT_MD = Path(__file__).resolve().parent / "out" / "covers.md"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}

VISION_SYS = (
    "You are an art director who reverse-engineers album covers into precise "
    "recreation recipes. Identify the album if you recognize it, then describe "
    "everything a photographer/illustrator would need to restage the exact same "
    "cover with a different cast: composition, camera, setting, wardrobe era, "
    "color grade, film/print look, typography, and mood. Be concrete."
)

SCHEMA_HINT = (
    '{"album": "best guess of album + year, or \\"unknown\\"", '
    '"artist": "best guess or \\"unknown\\"", '
    '"people_count": 0, '
    '"subjects_arrangement": "how many subjects and exactly how they are posed/placed", '
    '"composition": "layout, symmetry, focal point, rule-of-thirds notes", '
    '"camera_framing": "shot type, angle, distance, lens feel", '
    '"setting": "location/background in detail", '
    '"wardrobe_era": "clothing style + era to dress a new cast in", '
    '"color_grade": "palette + grade (warm/cool, saturated/muted)", '
    '"film_look": "film stock / print / grain / lighting quality", '
    '"typography": "title + artist text: placement, font style, color, treatment", '
    '"notable_objects": ["key props/elements"], '
    '"mood": "the feeling to reproduce", '
    '"recreation_recipe": "ONE dense paragraph: how to recreate this exact cover '
    'with a new cast, preserving everything identifying"}'
)


def slug(name: str) -> str:
    return Path(name).stem


def rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(p)


def collect(args_paths):
    if not args_paths:
        return sorted(p for p in DEFAULT_DIR.iterdir() if p.suffix.lower() in IMG_EXT and p.is_file())
    out = []
    for a in args_paths:
        p = Path(a)
        if p.is_dir():
            out.extend(sorted(q for q in p.iterdir() if q.suffix.lower() in IMG_EXT))
        elif p.suffix.lower() in IMG_EXT:
            out.append(p)
    return out


def describe_cover(img: Path, model):
    prompt = (
        "Analyze this album cover as a recreation recipe. If you recognize the "
        "album, name it. Count the people/subjects on the cover.\n\n"
        f"Return JSON: {SCHEMA_HINT}"
    )
    return _or.vision_json(VISION_SYS, prompt, image_paths=[img], model=model)


def main():
    ap = argparse.ArgumentParser(description="Describe album covers for recreation.")
    ap.add_argument("paths", nargs="*", help="image files or dirs (default: examples/)")
    ap.add_argument("--model", help="OpenRouter vision model")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    images = collect(args.paths)
    if not images:
        raise SystemExit("no cover images found")

    print(f"[covers] {len(images)} image(s)")
    covers = {}
    for img in images:
        key = slug(img.name)
        print(f"  {img.name}")
        try:
            rec = describe_cover(img, args.model)
        except Exception as e:
            print(f"    ! failed: {e}")
            continue
        rec["file"] = rel(img)
        rec["key"] = key
        covers[key] = rec

    out = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "model": args.model or _or.default_model(),
            "cover_count": len(covers),
        },
        "covers": covers,
    }
    outp = Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    # human-readable mirror
    lines = ["# Album covers — recreation recipes\n"]
    for key, c in covers.items():
        lines.append(f"## {c.get('album', key)}  ·  `{c['file']}`")
        lines.append(f"- **People:** {c.get('people_count', '?')} — {c.get('subjects_arrangement','')}")
        lines.append(f"- **Setting:** {c.get('setting','')}")
        lines.append(f"- **Wardrobe era:** {c.get('wardrobe_era','')}")
        lines.append(f"- **Color / film:** {c.get('color_grade','')} · {c.get('film_look','')}")
        lines.append(f"- **Typography:** {c.get('typography','')}")
        lines.append(f"- **Recreation:** {c.get('recreation_recipe','')}\n")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    print(f"[done] {len(covers)} covers → {rel(outp)}  (+ {rel(OUT_MD)})")


if __name__ == "__main__":
    main()
