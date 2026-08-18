# cover-gen

Tooling to generate **"cover covers"** — album covers recreated with the league's
people, in any art style — for the record-crate archive concept. All LLM **and
image** calls go through **OpenRouter** (uses `OPENROUTER_API_KEY` from the
repo-root `.env`).

## Install / run

Installed as a `cover-gen` command on your PATH (symlink in `~/.local/bin`):

```bash
cover-gen --help            # overview + examples
cover-gen <cmd> --help      # help for any subcommand
```

Also runnable without the symlink:
```bash
python3 scripts/cover-gen/cli.py ...      # or: npm run cover-gen -- ...
```

Commands: `ingest` (all), `covers`, `players`, `faces`, `make`, `menu`, `list`.

## Quick start

```bash
cover-gen ingest        # first run: covers + players + solo face crops (OpenRouter)
cover-gen menu          # interactive — walks you through cover / cast / style
cover-gen make --count 4 --style vangogh --generate   # or one-shot + real image
```

Underlying steps: describe the covers → describe the people → crop a clean solo
face per person → assemble a prompt (and optionally generate the image).

## 1. Describe the people — `ingest_players.py`

Reads the player photos in `examples/players/`. The filename lists who's in the
shot, left→right (`davesteingart-clements-jonblack-...`); numbers are dropped and
aliases (`mattm` → Matt Mariani) are normalized in `PEOPLE_ALIASES`. A vision
model describes each person and **ages them up to 43–46** (even if they look
younger in the photo); when someone appears in several photos, a merge pass
consolidates the observations.

```bash
python scripts/cover-gen/ingest_players.py                 # all of examples/players
python scripts/cover-gen/ingest_players.py --dry-run       # parse names only, no LLM
python scripts/cover-gen/ingest_players.py --model anthropic/claude-sonnet-4.5
```
→ `out/people.json`

## 2. Describe the covers — `ingest_covers.py`

Reads the album covers in `examples/`. A vision model reverse-engineers each into
a **recreation recipe** (composition, setting, wardrobe era, color grade, film
look, typography) detailed enough to restage with a different cast, plus a
`people_count`.

```bash
python scripts/cover-gen/ingest_covers.py
```
→ `out/covers.json` (+ `out/covers.md`, human-readable)

## 2.5. Crop solo faces — `cover-gen faces`

The player photos are group shots, so a per-person reference sent to the image
model actually contains several faces. This step has the vision model return a
head-and-shoulders bounding box for each named member (same left-to-right slot
logic, extras skipped), then crops the person's **real pixels** with Pillow — a
clean solo face, not an AI approximation. Biggest lever on likeness fidelity.

```bash
cover-gen faces               # crop everyone in examples/players
cover-gen faces --pad 0.2     # more head-and-shoulders margin (default 0.12)
```

Writes `examples/players/faces/<name>.jpg` (primary — the biggest single-face
crop) plus per-source crops, and stamps `face_image` onto `people.json`. `make`
then attaches the solo crop instead of the group photo automatically.

## 3. Assemble a prompt (and generate) — `cover-gen make`

Combines a cover + a cast + a style into a ready-to-paste image-gen prompt, and
lists the exact files to attach (the cover + one photo per person). Add
`--generate` to actually render the image via OpenRouter (Gemini image model) —
the reference images are sent along, so the model sees the real faces.

```bash
# explicit cover + people
cover-gen make --cover Crosbystillsandnash --people "Matt Mariani,Jon Black,Dave Steingart"

# a cover that holds 4, cast filled at random
cover-gen make --count 4

# surprise me
cover-gen make --random --style random

# a style + band name
cover-gen make --cover zep --style vangogh --title "BOARZ II MEN"

# actually make the image (writes out/generated/<cover>-<style>.png)
cover-gen make --cover u2-josh --count 4 --style photoreal --generate

# what's available
cover-gen list covers|people|styles
```
→ prints the prompt + attachments, saves `out/prompts/<cover>-<style>.txt`, and
with `--generate` saves `out/generated/<cover>-<style>.png`.

## Interactive — `cover-gen menu`

Menu-driven: pick a cover (number / random / by headcount), a cast (names /
numbers / random), a style, a title, and whether to generate — no flags to
remember.

**Styles:** photoreal (default), simpsons, disney-pixar, ghibli, vangogh,
futuristic, claymation, lego, popart, pixel, watercolor, renaissance, synthwave,
noir, southpark. Add your own in the `STYLES` dict in `make_cover.py`.

## Notes

- **Vision model** (ingest): defaults to `OPENROUTER_VISION_MODEL` →
  `OPENROUTER_DIGEST_MODEL` (Haiku 4.5, vision-capable) → hard default. Pass
  `--model` for richer detail (e.g. `anthropic/claude-sonnet-4.5`).
- **Image model** (`--generate`): defaults to `OPENROUTER_IMAGE_MODEL` →
  `google/gemini-2.5-flash-image` ("Nano Banana"). Override with `--gen-model`
  (e.g. `google/gemini-3.1-flash-image`, `google/gemini-3-pro-image`,
  `openai/gpt-5-image`). Gemini tends to output a landscape frame; if you need a
  strict 1:1, crop after or nudge the prompt with an explicit aspect line.
- **Group photos** cover several people at once, so the attached reference may
  contain more than the target face — the text descriptions disambiguate. A clean
  solo portrait per person gives the best likeness fidelity.
- **`out/` is gitignored** — it contains descriptions of real people's faces.
  Delete it anytime and re-run.
