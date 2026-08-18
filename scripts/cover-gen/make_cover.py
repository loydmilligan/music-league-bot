#!/usr/bin/env python3
"""
make_cover.py — assemble an image-generation prompt (for Gemini / ChatGPT) that
recreates an album cover with the league's people ("a cover cover"), in any of
several art styles. Reads the two ingest outputs (covers.json, people.json).

Pick explicitly, by count, or at random:
    # specific cover + specific people
    python scripts/cover-gen/make_cover.py --cover Crosbystillsandnash \
        --people "Matt Mariani,Jon Black,Dave Steingart"

    # a cover that naturally holds 4 people, cast filled randomly
    python scripts/cover-gen/make_cover.py --count 4

    # surprise me — random cover, random people, random style
    python scripts/cover-gen/make_cover.py --random --style random

    # same cover, Simpsons style, custom band name
    python scripts/cover-gen/make_cover.py --cover zep --style simpsons --title "BOARZ II MEN"

    # see what's available
    python scripts/cover-gen/make_cover.py --list covers
    python scripts/cover-gen/make_cover.py --list people
    python scripts/cover-gen/make_cover.py --list styles

The prompt is printed and written to scripts/cover-gen/out/prompts/. It also
prints the exact image files to ATTACH (the cover + one photo per person) — the
model gets both the text descriptions and the real reference images.
"""
import sys, json, argparse, random, re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _or  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
GEN_DIR = HERE / "out" / "generated"
COVERS_JSON = HERE / "out" / "covers.json"
PEOPLE_JSON = HERE / "out" / "people.json"
PROMPT_DIR = HERE / "out" / "prompts"

# ── Art styles ────────────────────────────────────────────────────────────────
# Each modifier is appended to the prompt; all preserve likeness + composition.
STYLES = {
    "photoreal": "Photorealistic. Render as a real photograph faithful to the "
        "original cover's film look and grade. Preserve each person's real face.",
    "simpsons": "In the art style of The Simpsons: flat 2D cartoon, bold black "
        "outlines, yellow skin, overbite, big round eyes, four fingers — but keep "
        "each person recognizable via hair, build, and signature features.",
    "disney-pixar": "As a Pixar/Disney 3D animated film still: soft rounded "
        "features, expressive big eyes, warm cinematic lighting, subsurface skin — "
        "caricatured but recognizably each person.",
    "ghibli": "In Studio Ghibli hand-painted anime style: soft watercolor "
        "backgrounds, gentle linework, warm nostalgic light, expressive but simple "
        "faces that still read as each person.",
    "vangogh": "As a Vincent van Gogh oil painting: thick swirling impasto "
        "brushstrokes, vivid post-impressionist color, visible texture — the "
        "composition and each person's likeness preserved through the strokes.",
    "futuristic": "Sleek sci-fi / cyberpunk: neon rim-lighting, holographic "
        "accents, chrome and dark tech surfaces, near-future wardrobe — keep the "
        "original composition and each real face.",
    "claymation": "As Aardman-style claymation / stop-motion: sculpted plasticine "
        "figures, visible fingerprints, tiny imperfections, practical set lighting.",
    "lego": "As LEGO minifigures in a real LEGO diorama: blocky yellow minifig "
        "bodies, printed faces, stud texture — each person hinted via hair piece "
        "and accessories.",
    "popart": "As a Roy Lichtenstein / comic pop-art panel: bold Ben-Day dots, "
        "thick black outlines, primary colors, halftone shading, a punchy caption box.",
    "pixel": "As 16-bit pixel art: limited palette, crisp pixels, dithering, a "
        "retro-game cover feel — each person a recognizable sprite portrait.",
    "watercolor": "As a loose watercolor illustration: wet bleeding washes, soft "
        "edges, paper texture, gentle palette; likeness kept in the drawing.",
    "renaissance": "As a Renaissance oil painting: chiaroscuro lighting, rich dark "
        "background, ornate period dress, museum varnish — faces in old-master style.",
    "synthwave": "1980s synthwave / vaporwave: magenta-and-cyan neon gradient, grid "
        "horizon, chrome sunset, VHS glow and scanlines.",
    "noir": "As 1940s film-noir black & white: hard low-key lighting, deep shadows, "
        "venetian-blind slats, cigarette smoke, high-contrast grain.",
    "southpark": "In South Park construction-paper cutout style: simple flat shapes, "
        "round heads, tiny bodies, beady eyes — each person via hair and clothing.",
}


def load(path, what):
    if not path.exists():
        raise SystemExit(f"missing {what}: {path}\n  run the ingest script first.")
    return json.loads(path.read_text(encoding="utf-8"))


def find_cover(covers, query):
    if query in covers:
        return covers[query]
    q = query.lower()
    for k, c in covers.items():
        if q in k.lower() or q in str(c.get("album", "")).lower():
            return c
    raise SystemExit(f"cover not found: {query}\n  try --list covers")


def resolve_people(people, names):
    keys = list(people.keys())
    picked = []
    for n in names:
        n = n.strip()
        if not n:
            continue
        if n in people:
            picked.append(n)
            continue
        matches = [k for k in keys if n.lower() in k.lower()]
        if len(matches) == 1:
            picked.append(matches[0])
        elif not matches:
            raise SystemExit(f"person not found: {n}\n  try --list people")
        else:
            raise SystemExit(f"ambiguous person '{n}': {matches}")
    return picked


def pick_cover_by_count(covers, count, rng):
    exact = [c for c in covers.values() if c.get("people_count") == count]
    if exact:
        return rng.choice(exact)
    # nearest by |people_count - count|
    ranked = sorted(covers.values(), key=lambda c: abs((c.get("people_count") or 0) - count))
    return ranked[0]


def person_block(rec):
    name = rec["name"]
    ap = rec.get("appearance") or {}
    note = ap.get("casting_note")
    if note:
        return f"- {name}: {note}"
    # dry-run / no appearance yet
    bits = [f"{k}: {v}" for k, v in ap.items() if v]
    return f"- {name}: " + ("; ".join(bits) if bits else "see attached photo")


def build_prompt(cover, chosen, style_key, title):
    style = STYLES[style_key]
    n = len(chosen)
    cast_lines = "\n".join(person_block(p) for p in chosen)

    recipe = cover.get("recreation_recipe", "")
    parts = [
        f"Create a square (1:1) album cover that recreates the attached album "
        f"cover \"{cover.get('album', cover.get('key'))}\" — same composition, "
        f"setting, framing, and typography — but starring the {n} real people "
        f"described below (also attached as photos).",
        "",
        "RECREATE THE COVER FAITHFULLY:",
        recipe or "(match the attached cover exactly: composition, setting, wardrobe era, color grade, film look, and title treatment.)",
        "",
        f"SETTING / COLOR / FILM: {cover.get('setting','')} — {cover.get('color_grade','')}; {cover.get('film_look','')}.",
        f"WARDROBE ERA: {cover.get('wardrobe_era','')}.",
        "",
        f"USE THESE {n} REAL PEOPLE — keep their real faces from the attached "
        f"reference photos (multiple angles per person). Render each person to "
        f"MATCH how they look in their reference photos, including their age there:",
        cast_lines,
        "",
        f"ARRANGEMENT: place them per the cover's composition ({cover.get('subjects_arrangement','')}). "
        f"If the headcount differs from the original, adapt the staging naturally while keeping the composition's feel.",
        "",
        f"TITLE TREATMENT: render the title text in the original cover's style and placement" +
        (f", reading: {title}." if title else " (keep it stylistically faithful; use a placeholder band name if none is given)."),
        "",
        f"STYLE: {style}",
        "",
        "Preserve each person's real likeness above all else. Output a single "
        "square image, album-cover framing, no border.",
    ]
    return "\n".join(parts)


def emit(cover, chosen_names, chosen, style_key, title, generate=False, gen_model=None, refs_per_person=3, refs_mode="both"):
    """Build the prompt, print it, save it, and (optionally) generate the image.
    Shared by the CLI and the interactive menu."""
    prompt = build_prompt(cover, chosen, style_key, title)

    # attachments: the cover + reference photos per person (deduped). Prefer the
    # curated/solo face refs (from `cover-gen faces`) over the group photo — clean
    # single faces are far better for likeness. Multiple angles of the same person
    # (a/b/c) sharpen identity, so attach up to `refs_per_person` each.
    def refs_for(p):
        if refs_mode == "manual":
            imgs = p.get("face_images_manual") or []
        elif refs_mode == "auto":
            imgs = p.get("face_images_auto") or []
        else:  # both
            imgs = p.get("face_images") or ([p["face_image"]] if p.get("face_image") else [])
        if not imgs:  # fall back so a person is never left with no reference
            imgs = p.get("face_images") or (p.get("source_images") or [])
        return imgs[:refs_per_person]

    attachments = []
    for f in [cover.get("file", "")] + [r for p in chosen for r in refs_for(p)]:
        if f and f not in attachments:
            attachments.append(f)

    print("=" * 74)
    print(f"COVER : {cover.get('album', cover.get('key'))}   ({cover.get('file')})")
    print(f"CAST  : {', '.join(chosen_names)}")
    print(f"STYLE : {style_key}")
    print("=" * 74)
    print(prompt)
    print("=" * 74)
    print("ATTACH THESE FILES:")
    for a in attachments:
        print(f"  - {a}")
    print("=" * 74)

    PROMPT_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^a-z0-9]+", "-", f"{cover.get('key','cover')}-{style_key}".lower()).strip("-")
    outp = PROMPT_DIR / f"{safe}.txt"
    outp.write_text(prompt + "\n\n--- ATTACH ---\n" + "\n".join(attachments), encoding="utf-8")
    print(f"saved prompt → {outp.relative_to(REPO_ROOT)}")

    if generate:
        abs_atts = [str((REPO_ROOT / a).resolve()) for a in attachments]
        img_out = GEN_DIR / f"{safe}.png"
        print(f"[generate] calling {gen_model or _or.image_model()} with {len(abs_atts)} reference image(s)…")
        saved = _or.generate_image(prompt, image_paths=abs_atts, model=gen_model, out_path=img_out)
        print(f"IMAGE → {saved.relative_to(REPO_ROOT)}")
        return outp, saved
    return outp, None


def main():
    ap = argparse.ArgumentParser(description="Assemble a 'cover cover' image-gen prompt.")
    ap.add_argument("--cover", help="cover key or album substring, or 'random'")
    ap.add_argument("--people", help="comma-separated names, or 'random'")
    ap.add_argument("--count", type=int, help="number of people (random fill / cover match)")
    ap.add_argument("--style", default="photoreal", help="style key or 'random' (see --list styles)")
    ap.add_argument("--title", default="", help="band-name text for the title treatment")
    ap.add_argument("--random", action="store_true", help="random cover + random people + (keep --style)")
    ap.add_argument("--generate", action="store_true", help="actually generate the image via OpenRouter (Gemini image model)")
    ap.add_argument("--gen-model", help="OpenRouter image model (default: env OPENROUTER_IMAGE_MODEL / gemini-2.5-flash-image-preview)")
    ap.add_argument("--refs-per-person", type=int, default=3, help="max reference photos to attach per person (default 3)")
    ap.add_argument("--refs", choices=["both", "auto", "manual"], default="both",
                    help="which face refs to use: auto=college crops (young), manual=your curated solos (recent), both (default)")
    ap.add_argument("--seed", type=int, help="reproducible randomness")
    ap.add_argument("--list", choices=["covers", "people", "styles"], help="list available options and exit")
    ap.add_argument("--covers-json", default=str(COVERS_JSON))
    ap.add_argument("--people-json", default=str(PEOPLE_JSON))
    args = ap.parse_args()
    rng = random.Random(args.seed)

    if args.list == "styles":
        for k, v in STYLES.items():
            print(f"  {k:<14} {v[:70]}...")
        return

    covers = load(Path(args.covers_json), "covers.json").get("covers", {})
    people = load(Path(args.people_json), "people.json").get("people", {})

    if args.list == "covers":
        for k, c in covers.items():
            print(f"  {k:<28} people={c.get('people_count','?'):<3} {c.get('album','')}")
        return
    if args.list == "people":
        for k, p in people.items():
            print(f"  {k:<20} imgs={len(p.get('source_images',[]))} obs={p.get('observation_count','?')}")
        return

    if not covers:
        raise SystemExit("no covers ingested yet — run ingest_covers.py")
    if not people:
        raise SystemExit("no people ingested yet — run ingest_players.py")

    # ── style ──
    style_key = args.style
    if style_key == "random":
        style_key = rng.choice(list(STYLES))
    if style_key not in STYLES:
        raise SystemExit(f"unknown style '{style_key}'\n  try --list styles")

    # ── cover ──
    if args.random or (args.cover == "random"):
        cover = rng.choice(list(covers.values()))
    elif args.cover:
        cover = find_cover(covers, args.cover)
    elif args.count:
        cover = pick_cover_by_count(covers, args.count, rng)
    else:
        cover = rng.choice(list(covers.values()))

    # ── people ──
    target_n = args.count or cover.get("people_count") or 3
    if args.people and args.people != "random":
        chosen_names = resolve_people(people, args.people.split(","))
    else:
        pool = list(people.keys())
        k = min(target_n, len(pool))
        chosen_names = rng.sample(pool, k)
    chosen = [people[n] for n in chosen_names]

    try:
        emit(cover, chosen_names, chosen, style_key, args.title, args.generate, args.gen_model, args.refs_per_person, args.refs)
    except Exception as e:
        print(f"[generate] failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
