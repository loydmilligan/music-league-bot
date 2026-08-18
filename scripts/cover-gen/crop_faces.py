#!/usr/bin/env python3
"""
crop_faces.py — make a clean SOLO reference image per person by cropping their
face (head + shoulders) out of the group photos.

Why: the player photos are group shots, so a per-person reference sent to the
image model actually contains several faces — the model has to guess which is
whom. A solo crop (the person's REAL pixels, just isolated) is the single biggest
lever on likeness fidelity. The generator prefers these crops over group photos.

How: for each group photo the vision model returns a head-and-shoulders bounding
box for each named member (left-to-right, using the same slot logic as
ingest_players — numbered extras are skipped). We crop the real pixels with
Pillow. For a person in several photos, the largest crop becomes their primary.

Usage:
    python scripts/cover-gen/crop_faces.py                 # all of examples/players
    python scripts/cover-gen/crop_faces.py a.jpg b.jpg     # specific files
    python scripts/cover-gen/crop_faces.py --pad 0.35      # more head-and-shoulders margin
    python scripts/cover-gen/crop_faces.py --model qwen/qwen3-vl-32b-instruct

Writes: examples/players/faces/<name>__<source>.jpg (+ <name>.jpg primary),
faces/index.json, and stamps face_image/face_crops onto out/people.json.
"""
import sys, json, argparse, re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _or  # noqa: E402
import ingest_players as ip  # reuse parse_slots / players_in / aliases  # noqa: E402
from PIL import Image  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / "examples" / "players"
FACES_DIR = DEFAULT_DIR / "faces"          # your curated manual solos live here (root)
AUTO_DIR = FACES_DIR / "auto"              # auto-cropped-from-group-photos live here
PEOPLE_JSON = Path(__file__).resolve().parent / "out" / "people.json"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}

# A manual solo file is <namekey>[_<variant>].<ext>, e.g. mattmariani_a.jpg,
# jonathanblack_b.jpg, or plain mattmariani.jpg. Strip the variant, map via alias.
VARIANT_RE = re.compile(r"_[a-z0-9]{1,3}$")

BBOX_SYS = (
    "You are a precise object grounder. You return tight bounding boxes for "
    "requested subjects in an image. Output only JSON."
)


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(p)


def collect(paths):
    if not paths:
        return sorted(p for p in DEFAULT_DIR.iterdir() if p.suffix.lower() in IMG_EXT and p.is_file())
    out = []
    for a in paths:
        p = Path(a)
        if p.is_dir():
            out.extend(sorted(q for q in p.iterdir() if q.suffix.lower() in IMG_EXT))
        elif p.suffix.lower() in IMG_EXT:
            out.append(p)
    return out


# A box is 4 numbers. Grounding models emit them inconsistently (arrays, or
# broken pseudo-objects like {"x0":1,2,3,4}); pull quadruples out of the raw text.
_NUM4 = re.compile(r"(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)")


def get_boxes(img: Path, slots, model):
    """Return boxes (4-number lists), one per named member, left-to-right."""
    total = len(slots)
    players = ip.players_in(slots)
    roster = ", ".join((f"#{i} {nm}" if nm else f"#{i} (non-member — skip)") for i, nm in enumerate(slots, 1))
    prompt = (
        f"This photo has {total} people, left to right: {roster}.\n\n"
        f"For each of the {len(players)} named members (in left-to-right order, "
        f"skipping non-members), give a tight bounding box around their HEAD AND "
        f"SHOULDERS as [x0, y0, x1, y1], coordinates normalized 0-1000 "
        f"(top-left origin).\n\n"
        f'Return JSON: {{"boxes": [[x0,y0,x1,y1], ...]}} with exactly '
        f"{len(players)} boxes in that order. Each box is a 4-number array."
    )
    text = _or.vision(BBOX_SYS, prompt, image_paths=[img], model=model, temperature=0.1)
    # 1) try clean JSON
    try:
        data = _or._extract_json(text)
        boxes = data.get("boxes") if isinstance(data, dict) else data
        if boxes and all(len(_coords(b)) == 4 for b in boxes):
            return boxes
    except Exception:
        pass
    # 2) fall back to pulling every 4-number group out of the raw text
    return [[float(x) for x in m] for m in _NUM4.findall(text)]


def _coords(box):
    if isinstance(box, dict):
        return [box.get(k, 0) for k in ("x0", "y0", "x1", "y1")]
    return list(box)[:4]


def to_fraction(box, w=None, h=None):
    """Normalize a box to 0..1 fractions regardless of the model's scale:
    already-fractions (≤1.5), percent (≤100), Qwen 0-1000, or raw pixels (opus &
    others emit these — needs the real w/h, and x/y use different divisors)."""
    x0, y0, x1, y1 = _coords(box)
    m = max(x0, y0, x1, y1)
    if m <= 1.5:
        return [x0, y0, x1, y1]
    if w and h and m > 1000:  # raw pixel coordinates
        return [x0 / w, y0 / h, x1 / w, y1 / h]
    div = 100.0 if m <= 100 else 1000.0
    return [x0 / div, y0 / div, x1 / div, y1 / div]


def crop_person(img_path: Path, box, pad, out_path: Path):
    im = Image.open(img_path).convert("RGB")
    W, H = im.size
    x0, y0, x1, y1 = to_fraction(box, W, H)  # pixel-aware, needs real W/H
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    bw, bh = (x1 - x0) * W, (y1 - y0) * H
    px0 = max(0, int((x0 * W) - bw * pad))
    py0 = max(0, int((y0 * H) - bh * pad))
    px1 = min(W, int((x1 * W) + bw * pad))
    py1 = min(H, int((y1 * H) + bh * pad))
    w, h = px1 - px0, py1 - py0
    if w < 24 or h < 24:
        return None  # degenerate box
    crop = im.crop((px0, py0, px1, py1))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    crop.save(out_path, quality=92)
    return {"area": w * h, "w": w, "h": h, "aspect": w / h}


def scan_auto_primaries():
    """Existing auto-crop primaries on disk (faces/auto/<slug>.jpg) → {name: path},
    so we can reuse them without re-running vision (e.g. in --manual-only mode)."""
    out = {}
    for nm in set(ip.PEOPLE_ALIASES.values()):
        f = AUTO_DIR / f"{slugify(nm)}.jpg"
        if f.exists():
            out[nm] = rel(f)
    return out


def person_from_manual(stem: str):
    """Map a manual solo filename (mattmariani_a / jonathanblack_b / mattmariani)
    to a canonical person name via the alias table, or None if unknown."""
    base = VARIANT_RE.sub("", stem.strip().lower())
    return ip.PEOPLE_ALIASES.get(base)


def resolve_manual(faces_dir: Path):
    """Scan the faces/ ROOT (not auto/) for curated solo photos → {name: [paths]}."""
    out = {}
    if not faces_dir.exists():
        return out
    for p in sorted(faces_dir.iterdir()):
        if not p.is_file() or p.suffix.lower() not in IMG_EXT:
            continue
        # ignore any legacy auto-crop outputs that may still sit in root
        if "__" in p.stem or "-" in p.stem:
            continue
        nm = person_from_manual(p.stem)
        if not nm:
            print(f"  ? unmapped manual solo: {p.name} — add its key to PEOPLE_ALIASES")
            continue
        out.setdefault(nm, []).append(rel(p))
    for nm in out:
        out[nm].sort()
    return out


def main():
    ap = argparse.ArgumentParser(description="Crop solo face references from group photos.")
    ap.add_argument("paths", nargs="*", help="image files or dirs (default: examples/players)")
    ap.add_argument("--model", help="OpenRouter vision model (grounding)")
    ap.add_argument("--pad", type=float, default=0.12, help="expand each box by this fraction (default 0.12)")
    ap.add_argument("--manual-only", action="store_true",
                    help="skip auto-cropping (free); just (re)register curated solos from faces/ root")
    ap.add_argument("--people-json", default=str(PEOPLE_JSON))
    args = ap.parse_args()

    # ── 1) auto-crop faces out of the group photos (into faces/auto/) ──
    # Seed from any crops already on disk so --manual-only keeps them as fallbacks.
    auto = scan_auto_primaries()
    if not args.manual_only:
        images = collect(args.paths)
        print(f"[faces] auto-crop: {len(images)} group photo(s)")
        crops = {}
        for img in images:
            slots = ip.parse_slots(img.stem)
            names = ip.players_in(slots)
            if not names:
                continue
            print(f"  {img.name}  ({len(names)} members)")
            try:
                boxes = get_boxes(img, slots, args.model)
            except Exception as e:
                print(f"    ! grounding failed: {e}")
                continue
            if len(boxes) != len(names):
                print(f"    ~ {len(boxes)} boxes for {len(names)} members; zipping by min length")
            for nm, box in zip(names, boxes):
                out = AUTO_DIR / f"{slugify(nm)}__{img.stem}.jpg"
                try:
                    meta = crop_person(img, box, args.pad, out)
                except Exception as e:
                    print(f"    ! crop {nm} failed: {e}")
                    continue
                if meta:
                    crops.setdefault(nm, []).append({**meta, "path": rel(out)})
                    print(f"    ✓ {nm}")
        # primary auto crop = biggest single-portrait (aspect ≤ 1.4)
        for nm, lst in crops.items():
            portraits = [c for c in lst if c["aspect"] <= 1.4]
            best = max(portraits or lst, key=lambda c: c["area"])
            primary_named = AUTO_DIR / f"{slugify(nm)}.jpg"
            Image.open(REPO_ROOT / best["path"]).save(primary_named, quality=92)
            auto[nm] = rel(primary_named)

    # ── 2) register your curated manual solos from faces/ root ──
    manual = resolve_manual(FACES_DIR)
    if manual:
        print(f"[faces] manual solos: {sum(len(v) for v in manual.values())} file(s) for {len(manual)} people")

    # ── 3) merge: manual first (curated, multiple angles), auto as fallback ──
    everyone = sorted(set(manual) | set(auto))
    index = {}
    for nm in everyone:
        refs = list(manual.get(nm, []))
        if nm in auto and auto[nm] not in refs:
            refs.append(auto[nm])          # keep an auto fallback last
        index[nm] = {"primary": refs[0], "face_images": refs,
                     "manual": manual.get(nm, []), "auto": auto.get(nm)}

    FACES_DIR.mkdir(parents=True, exist_ok=True)
    (FACES_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    # stamp people.json so the generator prefers these references
    pj = Path(args.people_json)
    if pj.exists():
        data = json.loads(pj.read_text(encoding="utf-8"))
        for nm, info in index.items():
            if nm in data.get("people", {}):
                data["people"][nm]["face_image"] = info["primary"]
                data["people"][nm]["face_images"] = info["face_images"]
                data["people"][nm]["face_images_manual"] = info["manual"]        # your curated (often recent)
                data["people"][nm]["face_images_auto"] = [info["auto"]] if info["auto"] else []  # college crops
        pj.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[faces] stamped {len(index)} people in {rel(pj)}")

    for nm, info in index.items():
        tag = f"{len(info['manual'])} manual" + (" + auto" if info["auto"] else "")
        print(f"  {nm:<20} {tag}")
    print(f"[done] references for {len(index)} people → {rel(FACES_DIR)}")


if __name__ == "__main__":
    main()
