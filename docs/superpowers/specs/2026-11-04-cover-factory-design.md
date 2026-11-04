# Cover Factory — design

Date: 2026-11-04 · Status: draft for Matt's approval

## Intent

Each round's digest podium shows the winning songs' album covers with the
submitter "slipped into" the cover, rendered as a wipe GIF between the real
cover and the doctored one. Today Matt makes these by hand in ChatGPT/Gemini.
Difficulty varies wildly per cover: a drawn rat matched first try; a funhouse
face took several attempts; a blurry "us" cover needed explicit placement,
gaze direction and multiple blur passes. Covers with no person (a flesh cube,
a man's butt) need a creative plan before anything can be generated, and
sometimes the answer is an alternate cover (NOFX: Jon as Fat Mike's father;
Scissor Sisters: Matt as the leashed tiger).

The Cover Factory makes this fast, repeatable and automatic, and doubles as a
**model-experimentation bench**: every generation is logged and rated so we
can later compare image models for this job.

**The core quality bar:** at first glance the result looks like the original
album cover — same art style, composition, lighting, grain, clothing — just
with a different person (or other content) in it, as seamlessly as possible.
Every generation prompt states this goal explicitly; we do not rely on the
model inferring it.

**Taste bar:** the gag must be funny for that player. Cheap/literal mashups
(face pasted onto butt cheeks) are a failure even if technically clean.

## Goals

- Two-step pipeline: **read the cover** (vision model → structured breakdown)
  then **generate** from a prompt assembled from the breakdown + per-subject
  instructions.
- Fast iteration: edit the breakdown / subject instructions, regenerate,
  compare versions, mark a keeper.
- **Subjects** as first-class: every person/animal on a cover is identified,
  labeled (A, B, C…), and classed main / secondary / background. Covers with
  no main subject (e.g. The Bravery, 5–7 band members) are handled: each
  subject gets its own treatment.
- **No-person path:** system pitches concrete one-line concepts using four
  moves — *morph* (object becomes the face; fallback), *signature item*
  (player's known joke, e.g. Berto's jean shorts), *alternate cover*,
  *recast* (person takes an unexpected role, e.g. the tiger).
- **Alternate covers are a top-level option on every cover**, not just the
  no-person ones.
- Jokes fed from player profiles.
- **Automatic run at round end** for podium songs, writing straight into the
  digest draft.
- **Manual/standalone use** for one-off sharing, independent of any round.
- **Model management** (extend existing screen) + per-generation logging +
  star ratings, to compare models later.

## Non-goals (for now)

- Sending one prompt to several models side by side. Matt switches models
  between tries; that's enough.
- A model comparison/leaderboard view. We only *collect* the data now.
- Publishing or sending anything to WhatsApp groups (never without asking).
- Making new headshots / fixing low-res headshots.

## Anti-goals

- Output that reads as "a face pasted on a cover" rather than the cover itself.
- An automatic run that silently ships a broken/blank image into a draft.
- Losing the human's notes between retries (the reason chat-based iteration
  was painful).

## Pieces, in build order

Each ships independently.

### 1. Model inventory upgrade

Existing: `ui/src/routes/settings/models` → `ui/src/lib/models/ModelsScreen.svelte`,
table `ai_models` (`ui/src/lib/db/aiModels.ts`), OpenRouter slug lookup
(`api/models/lookup`), favorites, model_type, pricing, capability flags.

Port the companelist admin pattern (`~/Projects/companelist/src/admin/models.ts`,
`views.ts` "Model inventory"):
- Accept a pasted OpenRouter id **or** openrouter.ai URL (`parseModelId`).
- **Cost rating 1–3 `$`**, computed from price (companelist `dollarSigns`
  formula is the default), user-overridable.
- **Type** derived from OpenRouter architecture modalities (companelist
  `kindFrom`: image / vision / embed / text), extended so Matt can tag
  more: multimodal, image, video, embedding, classification, text. A model
  may carry more than one.
- Favorites (exists).
- **Per-job model pickers**: options sorted favorites first, labeled
  `★ Name $$`, filtered to the type the job needs. Cover Factory jobs:
  **cover reader** (vision-capable) and **cover generator** (image output).

### 2. Factory core (manual screen)

New page `ui/src/routes/cover-factory/` with APIs under `api/cover-factory/`.
Reuse Avatar Factory modules (`ui/src/lib/server/avatarFactory/`: provider
dispatch `providers.ts`, `openrouter.ts`, `fal.ts`, `runway.ts`, `cost.ts`,
headshot sources via `paths.ts` → `~/Pictures/<league>-players/<slug>/headshot.*`).

Flow: **choose cover → read & mark subjects → generate & iterate**.

- **Choose cover:** a song (from a round, or Spotify search) or an upload.
  Spotify art via existing `ensureAlbumArt()` / `ml_submissions.album_art_url`.
- **Cover read** (cover-reader model) produces a structured, editable
  breakdown: art style (photo / drawing / painting / degree of distortion),
  overall composition, color/lighting/grain, and a list of **subjects**, each
  with: label, kind (person/animal/other), role (main/secondary/background),
  approximate bounding box, pose, gaze direction, clothing, color treatment,
  focus/blur. Also flags "no subjects".
- **Per-subject treatment:** who it becomes (a player, keep original, remove),
  age, gender, clothing, pose/gaze (default keep original), style match,
  free notes. Quick gags: *submitter replaces ALL*, *submitter = main only*,
  *pitch me concepts*.
- **Prompt builder:** assembles the generation prompt from the seamless-swap
  goal statement + breakdown + subject treatments. The assembled prompt is
  visible and editable before sending.
- **Generate:** cover image + chosen headshot(s) to the cover-generator model.
- **Iterate:** each try is a version; Matt edits breakdown/treatments/prompt
  and/or switches model, regenerates; versions are browsable; one is marked
  **keeper**.
- **Output:** still image + **wipe GIF** (real ↔ keeper), downloadable and
  with a share URL.

**Wipe GIF** (no code for this exists in the repo — the R181/R182 GIFs were
made ad hoc; make it a reusable step). Match the current podium format
measured from `digests/_media/r182/namesake-jon-wipe-v2.gif`: 456×456,
loop forever, hold original 2000 ms → 13 wipe frames at 60 ms → hold
swapped 2560 ms → 13 wipe frames back. Wipe direction/style left to builder.

**Logging (every model request):** model, provider, step (read / pitch /
generate), latency, cost (estimated if not reported), outcome (image
returned / no image / error), and which version chain + try number it
belongs to. Derived per cover: **tries until keeper**, failure count.

**Ratings (per output version):** 1–5 stars in four categories —
*likeness* (looks like the player), *seamlessness* (looks like the original
cover), *gag* (funny), *followed instructions*. Optional. Data only; no
comparison view yet.

### 3. Subject markup UI + profile jokes + concept pitches

Wireframe accepted 2026-11-03 (`.superpowers/brainstorm/…/subject-markup.html`):
cover with lettered boxes colored by role; drag to add a box, click to edit;
subject table; per-subject edit panel (who / age / gender / clothing /
pose-gaze / style match / notes); quick-gag buttons.

- **Profile jokes:** suggestions in the subject panel and in concept pitches
  draw on player profiles — `.planning/spikes/digest-comedy-media/personify/profiles/*.md`
  (Boarz) and `profiles/second_best/` (Second Best), 24 players total, plus
  `player_profiles.tags` / notes in the DB. Humor guidance in
  `design/digest-flavor.md`.
- **Concept pitches** (no-person covers, or on request): one or two concrete
  one-line plans per move (morph / signature item / alternate cover / recast).
  Matt picks or rewrites one; it becomes the subject treatments + prompt.

### 4. Alternate covers

Nothing exists. Add a lookup (MusicBrainz / Cover Art Archive is the obvious
free source; others at builder's discretion) offering alternate/edition art
for the song's release. Available in the "choose cover" step for every cover.

### 5. Automatic round-end run

When a round's digest draft is built, for each podium song: read cover →
choose plan → generate → wipe GIF → set the podium item's `coverUrl` in the
draft. **No approval gate** — the unfinalized draft is the review surface.

- Plan selection (my call): main subject exists → submitter replaces it;
  several subjects, no main → submitter replaces all; no subjects → top
  concept pitch, considering alternate covers.
- Failure (my call): no usable headshot, provider error, or no image
  returned → keep the real cover in that slot and record a visible note on
  the draft so Matt knows what to redo manually. Always logged.
- Opening a podium item in the factory loads the auto run's state (breakdown,
  treatments, versions) so manual rework continues from it.

### Decisions from the builder check (calls marked)

- **Source of truth (my call):** the factory keeper per (round, podium song)
  wins. It is stored in the factory and re-applied to the podium `coverUrl`
  after any draft regeneration; punch-up scripts read it instead of
  hardcoding `_media` URLs. A manual re-pick in the factory updates the draft.
- **Leagues (Matt):** the auto run is a per-league on/off setting, ON for
  Boarz (boarz-ii-men), Second Best and Hip Jammers; off elsewhere.
- **Spend (Matt):** per round, the auto run spends up to **$1** freely.
  Between $1 and **$2** each further spend needs approval via an ntfy
  message to topic `mlb-alert` on `https://ntfy.mattmariani.com` (reuse
  Avatar Factory's ntfy approve/deny, `avatarFactory/hil.ts`). Hard stop at
  $2. Unapproved or capped items fall back to the real cover with a note.
- **Default models (my call):** each job (reader / generator / pitch) has a
  pinned default in settings, chosen with the per-job picker; the auto run
  uses the pinned defaults.
- **Retries (my call):** auto run tries the generator up to 2 times per
  podium item on "no image" / error, then falls back to fal
  (`nano-banana/edit`) once if `FAL_KEY` is set; then the real-cover-plus-note
  fallback. Out-of-budget counts as a failure with a visible note.
- **Where it runs / pitch model (my call):** inside the bot-ui container as
  part of the draft build (background, non-blocking). Concept pitches use an
  OpenRouter text/multimodal model from the picker (a third job, "pitch"),
  so humor quality is part of the model experiment. Player profiles are
  copied/mounted into a path the container can read.
- **Privacy (my call):** auto-run outputs are staged privately (not under the
  public `digests/_media/`) and promoted to `_media` with an unguessable
  versioned filename when the draft is finalized/shared. Manual "share link"
  outputs are public by intent, also with unguessable filenames.

## Constraints / facts

- Podium rendered by `ui/src/lib/digest/AlbumPodium.svelte`; each item has
  `coverUrl`. Today punch-up scripts (`scripts/digest-qa/punchup_r18x.py`)
  hardcode it to `https://digest.mattmariani.com/_media/<rNNN>/<file>`.
- `digests/_media/*` is served by Caddy (`Caddyfile.digest` `/_media/*`)
  behind **Cloudflare, which caches the same filename ~24 h** — every new
  output needs a unique/versioned filename.
- Headshots: 13 Boarz, 12 Second Best; six Second Best players have only
  96 px thumbnails and jp-rodriguez's is generated — expect weak likeness
  there. Docker needs a compose volume per headshot folder (Avatar Factory
  precedent).
- OpenRouter key from env `OPENROUTER_API_KEY`; balance is currently < $1,
  so live testing may need a top-up or the fal provider (`FAL_KEY`).
- bot-ui (`ui/`) is SvelteKit 2 / Svelte 5 / Tailwind 4; deploys use the
  survey-sync-off compose override; verify deploys actually landed.

## Left to the builder

- Storage model (DB tables vs files) for covers, breakdowns, versions,
  run log, ratings — reuse Avatar Factory's store pattern if it fits.
- Breakdown JSON schema details and the exact prompt wording (must include
  the seamless-swap goal statement).
- Where in the digest-draft build the auto run hooks in, sync vs background.
- Share URL mechanics.
- Wipe animation style.
- Alternate-cover source(s) beyond Cover Art Archive.
