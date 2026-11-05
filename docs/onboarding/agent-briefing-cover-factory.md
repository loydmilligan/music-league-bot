# Agent briefing: music-league-bot, and the Cover Factory

Written 2026-11-04 for an agent picking this project up cold. Part 1 is the project in general, part 2 is the Cover Factory in detail. Facts below were checked against the code and the live system on that date. Where something is a judgment call or unverified, it says so.

---

## Part 1: the project

### What it is

A private toolkit Matt (the owner, `loydmilligan` on this machine) runs for several friend-group [Music League](https://app.musicleague.com) leagues. Each round, players submit songs to a theme and vote. The bot ingests the results plus the group's WhatsApp chat and produces a "digest": a funny, fact-checked round recap page shared back to the group, with podium covers, villains, chat moments and running jokes.

Leagues (table `leagues`): `boarz-ii-men` (Boarz II Men), `second-best` (Second Best), `hip-jammers`, `fam-jam`, `sssc`, `nostalgia-pit`. Boarz and Second Best get the most attention.

Read first: `README.md` (architecture, repo layout, run/test/deploy, gotchas), then `PSI_INDEX.md` (project-specific items), `docs/agent-conventions.md`, `docs/dev-loop-playbook.md`.

### Architecture in one breath

One SQLite file, `data/league.db`, holds everything. `bot-ui` (SvelteKit 2 + Svelte 5 runes + Tailwind 4, `ui/`, port 3002) is the operator app where almost all the product lives. It is served privately at the app host (the subdomain rotates; read `PUBLIC_APP_BASE_URL` in `.env`, currently `https://mlb13.mattmariani.com`). `digest-static` (Caddy) serves `digests/` publicly at `digest.mattmariani.com` (via `digestBaseUrl()`). `bot` holds the single WhatsApp session; `api` does email/IMAP + chat relay ingestion. Four scheduled jobs run as host systemd user units (`deploy/`), not in Docker.

### Rules that matter more than code

- **Never send anything to any WhatsApp group (test groups included) without asking Matt first, every time.** No standing approval.
- **Git:** commit freely on `master`; **never push without Matt's explicit yes.** Mention it when local is 10+ commits ahead of `origin/master`.
- **Matt often has uncommitted work in the main checkout** (e.g. `docker-compose.yml`, scripts, `.planning/…`). Don't commit or revert it. When a merge touches one of those files, stash that file, merge, pop it.
- **CLAUDE.md is managed by ACM; don't edit it.** It requires GitNexus impact analysis before editing a function (`node .gitnexus/run.cjs impact "<symbol>" --direction upstream --repo .`) and `detect-changes` before committing. The index goes stale; refresh with `node .gitnexus/run.cjs analyze --index-only`. Warn Matt on HIGH/CRITICAL; treat UNKNOWN as unknown, not safe.
- **Deploying bot-ui** (the only service you'll usually touch):
  ```bash
  OV=~/.local/state/boarz-lanes/survey-sync-pause/docker-compose.survey-sync-off.yml
  docker compose -f docker-compose.yml -f $OV build bot-ui
  docker compose -f docker-compose.yml -f $OV up -d bot-ui
  ```
  The override keeps survey sync off. Then **verify the deploy actually landed** (hit the endpoint inside the container with `docker exec music-league-bot-bot-ui-1 node -e 'fetch(...)'`; the image has no wget/curl).
- **Never verify UI with `npm run dev`** (known hydration crash). Use `npm run build` + `node build` on a free `PORT`, against a **copy** of `data/league.db` (`DATA_DIR=<copy dir>`). `node build` ignores SIGTERM; kill it with `kill -9` and confirm it's gone. Leave the root-owned container process alone.
- **Tests:** `cd ui && npx vitest run <file>`; full `npm test`. About 15 tests in 11 files fail on master for unrelated reasons (hostLiterals, leagues seed, metadataQueue, guesserSeason, deduceInvariants, notifications config, queueWorker, song adapters, api/content, api/leagues, model-vars sections). Hold the count steady, don't fix them in passing. Tests must discriminate: fixtures where right and wrong answers differ; ideally show the test failing without the fix.
- **No hostname literals in code** (enforced by `hostLiterals.test.ts`): use `appBaseUrl()` / `digestBaseUrl()` from `ui/src/lib/config/urls.ts`.
- **Cloudflare caches public files about 24 h by filename.** New public media needs a new, unguessable filename.

### Gotchas that cost time

- `rounds.phase` is dead data; derive phase via `ui/src/lib/lifecycle.ts`.
- `rounds` has no league column: league is `rounds.season_id → seasons.league_id → leagues`.
- Music League display names (e.g. `queen0reno`) often don't match `players.name`. Resolve a submission's player via **`ml_submissions.player_id` first**.
- WhatsApp `~` sender names use U+202F, not a space; normalize whitespace before matching.
- **Spotify Web API currently returns 403 "Active premium subscription required"** for the app's credentials. Album-art lookups via the Web API fail; Cover Factory falls back to Spotify oEmbed. Other features that fetch art through the Web API may be broken. This is unresolved.
- Image generation goes through OpenRouter (`OPENROUTER_API_KEY` in `.env`, $8/day key limit). fal (`FAL_KEY`) and Runway keys are in `~/.local/state/boarz-lanes/avatar-factory/providers.env`, loaded by bot-ui via `env_file`.
- Player headshots: `~/Pictures/{boarz-players,second-best-players,hip-jammers-players}/<slug>/headshot.*`, mounted read-only in the container under `/app/avatar-sources/`. Six Second Best players have only 96 px headshots.
- Player "personify" profiles (writing-style + "how others see them" dossiers, joke material): `.planning/spikes/digest-comedy-media/personify/profiles/*.md` (Boarz) and `…/profiles/second_best/*.md`. Mounted read-only at `/app/profiles` (env `COVER_PROFILES_DIR`).

### How work has been run here

Features go brainstorm → written spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) → subagent-driven build in a git worktree (one implementer per task, a spec+quality review after each, fix loop, final whole-branch review) → merge to master → deploy → live check. Decisions made without Matt are recorded as "rulings" and reported back to him.

---

## Part 2: the Cover Factory

### What it's for

Every digest podium shows each winning song's album cover with the submitter "slipped into" it, as a wipe GIF between the real cover and the doctored one. Matt used to make these by hand in ChatGPT/Gemini. The Cover Factory makes them in-app, fast and repeatable, and doubles as a bench for comparing image models (every request is logged and outputs are rated).

**Quality bar (Matt's):** at first glance it must look like the original cover (same art style, composition, lighting, grain, clothing, text) with only the person changed, as if they'd always been there. **Taste bar:** the gag must be funny *for that player*. Cheap literal mashups (a face pasted on body parts) are a failure even when technically clean.

Live at `<app host>/cover-factory` (nav: "Cover Factory", after Avatar Factory).

### Source documents

| Doc | What |
|---|---|
| `docs/superpowers/specs/2026-11-04-cover-factory-design.md` | Approved spec: goals, anti-goals, five pieces, Matt's decisions |
| `docs/superpowers/plans/2026-11-04-cover-factory-1-model-inventory.md` | Piece 1 plan |
| `docs/superpowers/plans/2026-11-04-cover-factory-2-core.md` | Piece 2 plan |
| `docs/superpowers/plans/2026-11-04-cover-factory-3-markup-pitches.md` | Piece 3 plan |

### Status (2026-11-04)

| Piece | What | State |
|---|---|---|
| 1 | Model inventory: OpenRouter id/URL lookup, auto "kinds", $ tier override, per-job pinned models (reader / generator / pitch) | Live, pushed |
| 2 | Factory core: cover → read → treatments → prompt → generate → versions, ratings, keeper → still + wipe GIF + share link | Live, pushed |
| 3 | Subject box overlay, profile excerpts, concept pitches (morph/signature/recast, incl. covers with no people), idea chips | Live, **not pushed** at time of writing |
| 4 | Alternate covers (Cover Art Archive / other editions) as an option on every cover | Not started |
| 5 | Automatic round-end run into digest drafts | Not started |

### The user flow

1. **Cover**: pick a round song (league → round → song), paste a Spotify track link, or upload.
2. **Read**: the reader model writes an editable breakdown: style, composition, palette/lighting, text elements, and lettered subjects (person/animal/object; main/secondary/background; pose, gaze, clothing, focus; a box).
3. **Subjects**: boxes drawn on the cover; click to select, drag to add one. Each subject gets a treatment: `player` (with optional age/gender/clothing/pose/style/notes overrides), `keep`, or `remove`. Quick buttons: submitter replaces the main subject / all people.
4. **Pitch me concepts** (optional; prominent when a cover has no people): the pitch model returns about 6 one-line gags across morph / signature / recast from the chosen players' profiles. "Use this" applies one to the breakdown and treatments.
5. **Ideas from <player>'s profile**: short wearable/prop gags as clickable chips that append to notes.
6. **Generate**: pick the model (pinned default), optionally edit the prompt, generate. Each try is a new version. Rate it 1–5 on likeness / seamlessness / gag / followed instructions, and mark a keeper.
7. **Output**: wipe GIF preview, download still/GIF, or create a public share link.

### Code map

Server (`ui/src/lib/server/coverFactory/`):

| File | Role |
|---|---|
| `repo.ts` | Tables `cover_projects`, `cover_versions`, `cover_requests` (in `league.db`); create/list/update; `insertVersion` assigns `try_no` in a transaction; `projectStats` |
| `paths.ts` | `coverRoot()` = `$DATA_DIR/cover-factory` (covers/, versions/, uploads/) |
| `models.ts` | `getPinnedCoverModel(db, job)`, `isUsablePin`; settings keys `cover_factory_{reader,generator,pitch}_model` |
| `breakdown.ts` | `Breakdown`/`Subject` types, `READ_PROMPT`, `normalizeBreakdown` (robust to off-schema model JSON), `normalizeBox` (fractions 0–1), `parseModelJson` |
| `chat.ts` | `chatWithImages` (OpenRouter chat with image parts, cost + latency) |
| `reader.ts` | `readCover`, `describeIdentity` (headshot → identifying features), with logging |
| `prompt.ts` | `Treatment`, `SEAMLESS_GOAL` (verbatim goal statement in every prompt), `defaultTreatments`, `buildSwapPrompt`, `placementPhrase` |
| `generate.ts` | `generateVersion`: pause gate, model resolve, images (cover + headshots), provider call via Avatar Factory's `generateFactoryImage`; failed generations become `status:'failed'` versions, not throws |
| `wipe.ts` | `makeWipeGif` (456×456, 29 frames, [2000, 60×13, 2560, 60×14] ms, loop) and `makeStill`, via sharp |
| `inputs.ts` | Round songs (+ oEmbed art fallback), Spotify link resolve, hardened cover fetch (https only, redirects re-checked, 10 MB streamed cap), players + headshot lookup (lowRes < 256 px), uploads, `submitterOfSubmission` |
| `profiles.ts` | `loadProfileExcerpt`: "How the others see them" / "Humor style" / "Topics" sections, budgeted 45/35/20% within 6000 chars, plus `player_profiles` notes/tags |
| `pitch.ts` | `PITCH_PROMPT`, `pitchConcepts`, `cleanConcepts`/`cleanTreatments` (roster + label validation; repairs player swaps aimed at unlisted objects into added subjects; drops concepts with no player), `applyConcept` (idempotent via `Subject.conceptId`), `playerIdeas` (cached in `identities_json` under `ideas:<slug>`) |
| `share.ts` | `shareKeeper`: copies still + GIF to `digests/_media/covers/<24-hex>/`, reuses the dir while the keeper is unchanged |
| `service.ts` | JSON-action API handlers |

Routes: `ui/src/routes/api/cover-factory/+server.ts` (GET state/rounds/songs; POST actions `create`, `read`, `save`, `preview-prompt`, `generate`, `rate`, `keeper`, `share`, `pitch`, `apply-concept`, `ideas`, plus multipart `upload-cover` / `upload-headshot`), `…/media/[...path]` (path-guarded file serving, `?download=1`, `export/<versionId>.gif|.jpg`). Model pins: `/api/settings/cover-factory-models`, card on `/settings/models`.

UI: `ui/src/routes/cover-factory/+page.svelte`, components in `ui/src/lib/coverFactory/` (`CoverPicker`, `SubjectMarkup`, `SubjectCard`, `ConceptPitches`, `VersionCard`, `RatingStars`, `markup.ts`, `api.ts`). Client code imports server modules only as `import type`.

Reuses Avatar Factory (`ui/src/lib/server/avatarFactory/`): providers, `normalizeImage`, `ProviderError`, the pause gate (`assertGenerationAllowed`, env `AVATAR_FACTORY_OPENROUTER_PAUSED`), roster, `sourcesRoot`.

### Models and cost (observed)

- Reader and pitch: `anthropic/claude-sonnet-4.6` (auto-resolved; nothing pinned yet).
- Generator: `google/gemini-3.1-flash-image-preview`: about $0.07–0.08 and 8–16 s per image. It gave the most seamless results in the 2026-11-04 comparison; `gemini-3-pro-image-preview` looked more pasted-on at about $0.14.
- A full cover (read + identity + pitch + generate) costs about $0.10–0.20. Cover Factory spend to date is about $1.37, all logged in `cover_requests`.
- Cost guards: the pause gate on every paid call; generator `modelId` must be a roster model fitting the job; `promptOverride` ≤ 8000 chars; pitch ≤ 4 players; idea/pitch players must be on the project's roster.

### Prompt lessons (learned live, already applied)

- Describe the player's identifying features from the headshot first (`describeIdentity`) and quote them in the prompt; otherwise glasses and beards get lost.
- Name the cover subject's clothing explicitly and say the headshot is **only for the face and identity**. Without that, Gemini copied a player's plaid shirt from the headshot onto the cover subject.
- Covers with no people: the pitch model must put anything it uses (the sun, a building) into `addSubjects` and target it; the cleaner repairs it when the model doesn't.
- Gemini sometimes returns no image for abstract "face as a pattern/grid" concepts (logged `no_image`); reroll with another concept.
- On collage/typography covers Gemini sometimes rewrites cover text (Kino's "Герой" became "Last Hero"), which breaks the quality bar. Add a note or reroll.
- Applying several concepts **stacks** their added subjects (by design). Remove extras on the subject card if only one gag is wanted.

### Live test projects (in the live DB)

Projects 1–2 (Boarz R145: Shane/Juanes, Conor/Bocelli), 5–6 (Second Best R139: Sarah Black/IZ, Tommy/Blackalicious, v2 fixed the shirt), 9 (Matt/Polo & Pan "Matt is the sun", excellent), 10 (Jon/Kino). None rated or marked keeper; that's Matt's call.

### What's next (pieces 4–5) and Matt's decisions that bind them

- **Piece 4, alternate covers:** offered on every cover, not only no-person ones. Cover Art Archive (MusicBrainz) is the obvious free source. Example of why: on NOFX, the alternate cover with young Fat Mike and his father made the Jon gag easy.
- **Piece 5, automatic round-end run:** for podium songs in **Boarz, Second Best and Hip Jammers** only (per-league on/off setting). Writes straight into the digest draft's podium `coverUrl`; the unfinalized draft is the review step. Budget per round: up to **$1** spent freely; **$1–$2** needs approval via an ntfy message to topic `mlb-alert` on `https://ntfy.mattmariani.com` (reuse Avatar Factory's ntfy approve/deny, `avatarFactory/hil.ts`); **hard stop at $2**. On failure (no headshot, provider error, no image, over budget) keep the real cover and leave a visible note on the draft. Outputs stay private until the draft is finalized or shared. The factory keeper per podium slot is the source of truth and is re-applied after draft regeneration; punch-up scripts (`scripts/digest-qa/punchup_r18x.py`, which hardcode `_media` URLs today) should read it.
- Switching models between tries is enough; no side-by-side multi-model generation.

### Known open items

- Spotify Web API 403 (above): affects more than the Cover Factory.
- Deferred minor polish is listed in the plans' review notes. None of it blocks use.
- Low-res headshots for six Second Best players. The page flags them and accepts a per-project headshot upload.
