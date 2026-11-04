# Cover Factory — Piece 2: Factory Core (manual screen) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live `/cover-factory` page (nav entry "Cover Factory") where Matt picks a cover (round song, Spotify link, or upload) and a player, the app reads the cover into an editable breakdown, builds a seamless-swap prompt, generates versions with the pinned model, logs every request, lets him rate versions and mark a keeper, and outputs a still + wipe GIF as downloads and a public share link.

**Architecture:** Server modules in `ui/src/lib/server/coverFactory/` (DB repo, cover reader, prompt builder, generator, wipe GIF, inputs, share) reusing Avatar Factory's provider layer (`ui/src/lib/server/avatarFactory/generate.ts`, `providers.ts`, `normalize.ts`, `errors.ts`, `paths.ts`, `roster.ts`, `pause.ts`). Persistence in `league.db` tables (queryable for later model comparison) + image files under `$DATA_DIR/cover-factory/`. One JSON-action API (`/api/cover-factory`) like Avatar Factory's, a media route, and a Svelte 5 page styled with the app's Tailwind tokens like `/avatar-factory`.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4 tokens (`app.css`), better-sqlite3, sharp 0.35 (already a dependency), vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-cover-factory-design.md` — section "2. Factory core (manual screen)" plus Constraints. Piece 1 (model inventory) is live.

## Global Constraints

- Work in `ui/`. Tests `npx vitest run <file>`; full `npm test` (15 tests in 11 unrelated files fail on master already — count must not grow); `npm run build` must pass.
- GitNexus impact analysis before editing any existing function (`node ~/Projects/music-league-bot/.gitnexus/run.cjs impact "<sym>" --direction upstream --repo ~/Projects/music-league-bot`); warn on HIGH/CRITICAL.
- No hostname literals in code: public URLs come from `digestBaseUrl()` / `appBaseUrl()` in `ui/src/lib/config/urls.ts` (enforced by `hostLiterals.test.ts`).
- Models come from piece 1: `getPinnedCoverModel(db, 'reader' | 'generator')` in `ui/src/lib/server/coverFactory/models.ts`. Default generator in practice: `google/gemini-3.1-flash-image-preview` (validated 2026-11-04: ~$0.07, ~10 s, seamless + recognizable).
- Every generation prompt contains this goal statement verbatim (constant `SEAMLESS_GOAL`):
  `GOAL: at first glance this must look like the original album cover — same art style, composition, lighting, palette, grain/texture, clothing and text — with only the specified subjects changed, as seamlessly as if they were always part of the original artwork, never pasted on.`
- Generation respects the existing pause gate `assertGenerationAllowed()` (`avatarFactory/pause.ts`).
- Rating categories (exact keys): `likeness`, `seamlessness`, `gag`, `instructions`; integer 1–5 or null.
- Wipe GIF format (exact, measured from `digests/_media/r182/namesake-jon-wipe-v2.gif`): 456×456, loop forever, frame 0 = original held 2000 ms, 13 wipe frames × 60 ms, swapped held 2560 ms, 13 wipe frames back × 60 ms (29 frames total). Left-to-right wipe with a soft 8 px edge (my call).
- Public share files go under `digests/_media/covers/<24-hex random>/` (container path `/app/digests/_media/covers/…`, served at `${digestBaseUrl()}/_media/covers/…`); never sequential names (Cloudflare caches ~24 h and paths must be unguessable).
- Image files never overwrite: new version = new file.
- Commit after each task (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.

## Review Focus

1. Reader returns off-schema JSON (e.g. `text_elements` as objects, `subjects` missing, fenced ```json, trailing prose) → `normalizeBreakdown` still yields a valid `Breakdown` (observed live 2026-11-04). (Task 2 test.)
2. Generator returns no image (safety refusal / text-only) → version row with `status: 'failed'`, request logged with `outcome: 'no_image'` and any `failedCostUsd`; UI shows the reason, project stays usable. (Task 4 test.)
3. Player with only a 96 px headshot (6 Second Best players) or none → still selectable, flagged `lowRes: true` / `missing: true`, and a headshot upload replaces it for this project. (Task 6 test.)
4. Two rapid "generate" clicks → two distinct versions with distinct files, never one overwriting the other. (Task 4 test.)
5. Share link created twice for the same keeper → reuses the same random dir (idempotent), and a changed keeper gets a new dir. (Task 7 test.)

---

### Task 1: Tables, repo, paths

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (append CREATE TABLEs), `ui/src/lib/db/client.ts` only if schema.ts isn't applied to existing DBs (check how `CREATE TABLE IF NOT EXISTS` in schema.ts runs on startup and follow it)
- Create: `ui/src/lib/server/coverFactory/repo.ts`, `ui/src/lib/server/coverFactory/paths.ts`
- Test: `ui/src/lib/server/coverFactory/repo.test.ts`

**Interfaces — Produces:**
```ts
// paths.ts
export function coverRoot(): string            // join(DATA_DIR ?? '../data', 'cover-factory')  (mirror avatarFactory/paths.ts factoryRoot)
export function coverFile(rel: string): string // resolveUnderRoot(coverRoot(), rel) — path-guarded
// repo.ts  (all take db: Database.Database first)
export type CoverSource = 'round' | 'spotify' | 'upload';
export interface CoverProject { id: number; title: string; source: CoverSource; round_id: number|null; spotify_uri: string|null;
  league_slug: string|null; cover_rel: string; cover_url: string|null; breakdown_json: string|null;
  treatments_json: string|null; keeper_version_id: number|null; share_dir: string|null; share_version_id: number|null;
  created_at: string; updated_at: string }
export interface CoverVersion { id: number; project_id: number; try_no: number; model_id: string; provider: string;
  prompt: string; image_rel: string|null; status: 'ok'|'failed'; error_reason: string|null;
  rating_likeness: number|null; rating_seamlessness: number|null; rating_gag: number|null; rating_instructions: number|null;
  note: string|null; created_at: string }
export interface CoverRequest { id: number; project_id: number; version_id: number|null; step: 'read'|'identity'|'generate';
  model_id: string; provider: string; latency_ms: number; cost_usd: number|null; cost_estimated: number;
  outcome: 'ok'|'no_image'|'error'; error_reason: string|null; created_at: string }
createProject(db, p: Omit<CoverProject,'id'|'created_at'|'updated_at'|'keeper_version_id'|'share_dir'|'share_version_id'|'breakdown_json'|'treatments_json'>): CoverProject
getProject(db, id): CoverProject | null
listProjects(db, limit = 50): (CoverProject & { version_count: number; keeper_rel: string|null })[]   // newest first
updateProject(db, id, patch: Partial<Pick<CoverProject,'title'|'breakdown_json'|'treatments_json'|'keeper_version_id'|'share_dir'|'share_version_id'>>): CoverProject
insertVersion(db, v: Omit<CoverVersion,'id'|'try_no'|'created_at'|'rating_likeness'|'rating_seamlessness'|'rating_gag'|'rating_instructions'|'note'>): CoverVersion  // try_no = max+1 per project, assigned inside one transaction
listVersions(db, projectId): CoverVersion[]      // try_no ascending
rateVersion(db, id, r: Partial<Record<'likeness'|'seamlessness'|'gag'|'instructions', number|null>>, note?: string|null): CoverVersion  // throws on value outside 1–5
logRequest(db, r: Omit<CoverRequest,'id'|'created_at'>): CoverRequest
projectStats(db, projectId): { tries: number; failures: number; triesToKeeper: number|null; spendUsd: number }
```
Tables `cover_projects`, `cover_versions` (FK project_id ON DELETE CASCADE), `cover_requests` with exactly these columns.

- [ ] **Step 1: Failing tests** (`openLeagueDb(':memory:')`): create project → get; two `insertVersion` calls → try_no 1 and 2; `rateVersion(..., {likeness: 6})` throws; `rateVersion(..., {gag: 4})` persists only gag; `logRequest` ×3 (one `no_image` with cost 0.01, two ok with 0.07) → `projectStats` = `{tries: 2 (versions), failures: <failed versions>, spendUsd: 0.15}`; keeper set to version with try_no 2 → `triesToKeeper: 2`; `listProjects` returns newest first with `version_count`.
- [ ] **Step 2: Run** `npx vitest run src/lib/server/coverFactory/repo.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm test` count unchanged.
- [ ] **Step 5: Commit** `cover factory: tables + repo + paths`.

---

### Task 2: Breakdown schema, normalizer, cover + identity reader

**Files:**
- Create: `ui/src/lib/server/coverFactory/breakdown.ts`, `ui/src/lib/server/coverFactory/chat.ts`, `ui/src/lib/server/coverFactory/reader.ts`
- Test: `breakdown.test.ts`, `reader.test.ts` (same dir)

**Interfaces — Produces:**
```ts
// breakdown.ts (pure; importable by the client too — no node imports)
export type SubjectRole = 'main' | 'secondary' | 'background';
export interface Subject { label: string; kind: 'person'|'animal'|'object'; role: SubjectRole; position: string; pose: string;
  gaze: string; clothing: string; expression: string; color_treatment: string; focus: string; box?: [number,number,number,number] }
export interface Breakdown { style: string; composition: string; palette_lighting: string; text_elements: string[]; subjects: Subject[]; no_subjects: boolean }
export function normalizeBreakdown(raw: unknown): Breakdown
export function parseModelJson(text: string): unknown   // strips ``` fences / prose, takes outermost {...}; throws Error('unparseable') if none
export const READ_PROMPT: string
export const IDENTITY_PROMPT: string
// chat.ts
export interface ChatResult { text: string; costUsd: number|null; latencyMs: number }
export async function chatWithImages(o: { model: string; prompt: string; imageDataUrls: string[]; fetchImpl?: FetchLike; apiKey?: string; timeoutMs?: number }): Promise<ChatResult>
// reader.ts
export async function readCover(db, projectId: number, coverDataUrl: string, o?: { fetchImpl?: FetchLike }): Promise<Breakdown>          // logs step 'read'
export async function describeIdentity(db, projectId: number, headshotDataUrl: string, o?: { fetchImpl?: FetchLike }): Promise<string> // logs step 'identity'
```
`normalizeBreakdown` rules: missing strings → `''`; `text_elements` items that are objects → `"<text> (<position>)"` from their `text`/`content` and `position`/`location` fields, else `JSON.stringify`; subjects get labels A, B, C… when missing/duplicate; unknown role → `secondary`; unknown kind → `object`; `no_subjects = subjects.filter(kind !== 'object').length === 0`. `READ_PROMPT` asks for exactly the Breakdown JSON shape with subject fields (adapt the validated prompt in `/tmp/claude-1000/-home-loydmilligan-Projects-music-league-bot/daf69490-a17b-418f-aaba-fadeaadd2e39/scratchpad/cf-exp/exp.py` `READ_PROMPT`, adding role guidance: "main = the obvious focal person; if several people share focus, mark them all secondary"). `IDENTITY_PROMPT` = the validated one in `cf-exp/exp2.py` (`FEAT`). `chatWithImages` posts to OpenRouter chat completions with `usage: {include: true}` and the images as `image_url` parts; reader model from `getPinnedCoverModel(db,'reader')` (throw a clear Error when null). Errors → `ProviderError` via `avatarFactory/errors.ts` helpers, and the request is still logged with `outcome: 'error'`.

- [ ] **Step 1: Failing tests:** `normalizeBreakdown` on (a) the live-observed shape `{text_elements: [{text: 'DWIGHT YOAKAM', position: 'left, vertical'}], subjects: [{kind:'person', role:'hero'}]}` → `text_elements[0] === 'DWIGHT YOAKAM (left, vertical)'`, `subjects[0].role === 'secondary'`, `subjects[0].label === 'A'`; (b) `{}` → `no_subjects: true`, all strings `''`; `parseModelJson('Sure!\n```json\n{"a":1}\n```')` → `{a:1}`; `parseModelJson('no json')` throws. `readCover` with a fake `fetchImpl` returning `{choices:[{message:{content:'```json {...}```'}}], usage:{cost:0.002}}` → Breakdown + one `cover_requests` row `step 'read', outcome 'ok', cost_usd 0.002`; fake returning HTTP 402 → throws and logs `outcome 'error'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `cover factory: breakdown normalizer + cover/identity reader`.

---

### Task 3: Treatments + prompt builder

**Files:** Create `ui/src/lib/server/coverFactory/prompt.ts` (pure, no node imports); Test `prompt.test.ts`

**Interfaces — Produces:**
```ts
export interface Treatment { label: string; mode: 'player'|'keep'|'remove'; playerSlug?: string; playerName?: string;
  age?: string; gender?: string; clothing?: string; poseGaze?: string; styleMatch?: string; notes?: string }
export interface Identity { slug: string; name: string; features: string }   // features from describeIdentity
export const SEAMLESS_GOAL: string   // exact text in Global Constraints
export function defaultTreatments(b: Breakdown, submitter?: { slug: string; name: string }): Treatment[]
export function buildSwapPrompt(b: Breakdown, treatments: Treatment[], ids: Identity[]): { prompt: string; imageOrder: string[] }  // imageOrder = ['cover', ...player slugs in reference order]
```
`defaultTreatments`: if a `main` person/animal exists → that subject `player` (submitter), others `keep`; else if ≥2 person subjects and none main → all persons `player`; else all `keep`. Prompt structure (validated): "Recreate image 1 (an album cover) as faithfully as possible…", then `SEAMLESS_GOAL`, then the style/composition/palette/text lines from the breakdown, then one paragraph per non-`keep` subject: for `player` — "Subject X (<position>) becomes the person in image N (<name>): keep the original pose/gaze, clothing and headwear from the cover unless told otherwise (<overrides>); keep these identifying features exactly: <features>; render them in the cover's style." Explicit overrides (age, gender, clothing, poseGaze, styleMatch, notes) replace the "keep original" wording for that attribute. `remove` → "Remove subject X and fill naturally." Final line "Do not change anything else. Square output." Each distinct player appears once in `imageOrder`, image numbers start at 2.

- [ ] **Step 1: Failing tests:** prompt contains `SEAMLESS_GOAL` verbatim; one player treatment → contains "image 2", the features string, and "headwear from the cover"; treatment with `clothing: 'jean shorts'` → contains "jean shorts" and does not contain "keep the original clothing"; two subjects both mapped to the same slug → `imageOrder` `['cover','berto']` and both paragraphs say "image 2"; `keep`-only → no "becomes"; `defaultTreatments` on a breakdown with 5 secondary persons + submitter → 5 `player` treatments; with a main → exactly one `player`.
- [ ] **Step 2–4:** run FAIL → implement → PASS. **Step 5: Commit** `cover factory: treatments + seamless prompt builder`.

---

### Task 4: Generation service

**Files:** Create `ui/src/lib/server/coverFactory/generate.ts`; Test `generate.test.ts`

**Interfaces — Consumes:** Task 1 repo, Task 3 `buildSwapPrompt`, `generateFactoryImage` + `resolveProvider` (`avatarFactory/generate.ts`, `providers.ts`), `normalizeImage`, `ProviderError`, `assertGenerationAllowed`, `getPinnedCoverModel`.
**Produces:**
```ts
export interface GenerateInput { projectId: number; treatments: Treatment[]; identities: Identity[];
  headshots: Record<string, Buffer>;  // slug → image bytes
  modelId?: string; promptOverride?: string; fetchImpl?: FetchLike }
export async function generateVersion(db, input: GenerateInput): Promise<CoverVersion>
```
Behavior: resolve model (`modelId` ?? pinned generator; throw if none); provider `openrouter` (fal only if the model id starts with `fal-ai/` — my call); prompt = `promptOverride ?? buildSwapPrompt(...).prompt`; images = cover file + headshots in `imageOrder`, each through `normalizeImage`; call with `aspectRatio: '1:1'`; on success write bytes to `versions/<projectId>/<try>-<6 hex>.png` under `coverRoot()` (never overwrite), insert version `status 'ok'`, log request `outcome 'ok'` with latency/cost; on `ProviderError` insert version `status 'failed'`, `error_reason = reason`, log `outcome 'no_image'` when reason is `no_image`/`safety_refusal`, else `'error'`, with `failedCostUsd`; return the failed version (do not throw). Save treatments to the project (`treatments_json`).

- [ ] **Step 1: Failing tests** with a fake `fetchImpl` returning a 1×1 PNG data URI in `choices[0].message.images[0].image_url.url` and `usage.cost 0.07`: version ok, file exists, request row `cost_usd 0.07`; fake returning a message with no images → version `failed`, `error_reason 'no_image'`, request `outcome 'no_image'`; two concurrent `generateVersion` calls (`Promise.all`) → try_no 1 and 2 with different `image_rel`; with `promptOverride` the logged version prompt equals it.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `cover factory: generation service with request log`.

---

### Task 5: Wipe GIF

**Files:** Create `ui/src/lib/server/coverFactory/wipe.ts`; Test `wipe.test.ts`

**Produces:** `export async function makeWipeGif(original: Buffer, swapped: Buffer): Promise<Buffer>` and `export async function makeStill(swapped: Buffer): Promise<Buffer>` (456×456 JPEG q90).
Build 456×456 RGB frames with sharp (cover-fit both inputs), compose wipe frames by masking (linear left→right, 8 px soft edge, positions evenly spaced across 13 frames), assemble with `sharp(frames, { join: { animated: true } }).gif({ delay: [...], loop: 0 })`. If `join.animated` isn't supported by the installed sharp, report BLOCKED rather than adding a dependency.

- [ ] **Step 1: Failing test:** two solid-color 600×600 PNGs → result `sharp(gif).metadata()` has `pages 29`, `width 456`, `pageHeight 456`, `loop 0`, `delay[0] 2000`, `delay[14] 2560`, every other delay `60`; frame 7 (decoded via `sharp(gif, {page: 7})`) has the swapped color at x=10 and the original at x=446.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `cover factory: wipe GIF matching podium format`.

---

### Task 6: Inputs — covers and players

**Files:** Create `ui/src/lib/server/coverFactory/inputs.ts`; Test `inputs.test.ts`

**Produces:**
```ts
export interface RoundSong { submissionId: number; title: string; artists: string; playerName: string|null; playerSlug: string|null; artUrl: string|null }
export async function listRoundSongs(db, roundId: number): Promise<RoundSong[]>       // calls ensureAlbumArt(db, roundId) first
export async function resolveSpotifyCover(url: string): Promise<{ title: string; artists: string; artUrl: string; spotifyUri: string }>  // parseSpotifyUrl + fetchTrack; throws Error('not a Spotify track link')
export async function fetchCoverBytes(artUrl: string, fetchImpl?: FetchLike): Promise<Buffer>   // https only; reject >10 MB / non-image content-type
export interface PlayerOption { slug: string; name: string; leagueSlug: string; headshotRel: string|null; lowRes: boolean; missing: boolean }
export function listPlayers(leagueSlug: string): PlayerOption[]      // readRoster + headshot lookup under sourcesRoot()/<folder>/<slug>/headshot.{png,jpg,jpeg}; folder map: boarz-ii-men→boarz-players, second-best→second-best-players, hip-jammers→hip-jammers-players (same as avatarFactory/seed.ts — import its map if exported, else define once here); lowRes when min(width,height) < 256 (sharp metadata)
export async function loadHeadshot(projectId: number, p: PlayerOption): Promise<Buffer|null>   // project upload override first: coverRoot()/uploads/<projectId>/<slug>.*
export async function saveHeadshotUpload(projectId: number, slug: string, bytes: Buffer): Promise<string>  // normalizeImage then write; returns rel
export async function saveCoverUpload(bytes: Buffer): Promise<string>   // normalizeImage → covers/<random>.jpg; returns rel
```
Use `ensureAlbumArt` (`ui/src/lib/digest/albumArt.ts`), `parseSpotifyUrl`/`fetchTrack` (`ui/src/lib/spotify/client.ts`), `readRoster`/`listLeaguesReadonly` (`avatarFactory/roster.ts`), `sourcesRoot` (`avatarFactory/paths.ts`). Player slug for Boarz follows `roster.ts` (BOARZ_PLAYER_IDS); `RoundSong.playerSlug` uses the same mapping.

- [ ] **Step 1: Failing tests** (temp dir as `AVATAR_SOURCES_DIR`, in-memory DB with a league/round/players/submissions fixture, `vi.mock` for `ensureAlbumArt` and the Spotify client): `listPlayers` flags a 96×96 headshot `lowRes: true`, a missing one `missing: true`, a 512×512 one neither; `loadHeadshot` prefers the project upload; `resolveSpotifyCover('https://example.com')` throws; `fetchCoverBytes('http://…')` throws (https only); `listRoundSongs` maps player name + slug.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `cover factory: cover + player inputs`.

---

### Task 7: API + media + share

**Files:**
- Create: `ui/src/routes/api/cover-factory/+server.ts`, `ui/src/routes/api/cover-factory/media/[...path]/+server.ts`, `ui/src/lib/server/coverFactory/share.ts`, `ui/src/lib/server/coverFactory/service.ts`
- Test: `ui/src/routes/api/cover-factory/server.test.ts`, `ui/src/lib/server/coverFactory/share.test.ts`

**Produces:**
- `GET /api/cover-factory` → `{ projects: listProjects(), leagues: listLeaguesReadonly(), models: { reader, generator } }` (resolved ids).
- `GET /api/cover-factory?project=<id>` → `{ project, breakdown: Breakdown|null, treatments: Treatment[], versions, stats: projectStats, players: PlayerOption[] (project league or all three) }`.
- `GET /api/cover-factory?league=<slug>&round=<id>` → `{ songs: RoundSong[] }`; `?league=<slug>` → `{ players, rounds: [{id, name, number}] }` (rounds query via the existing rounds table, newest first).
- `POST /api/cover-factory` JSON `{action, ...}`; multipart for uploads (`action=upload-cover` with `file`, or `action=upload-headshot` with `projectId`, `slug`, `file`). Actions:
  - `create` `{source:'round', roundId, submissionId}` | `{source:'spotify', url}` → downloads cover via `fetchCoverBytes`, saves under `covers/`, creates project (title "Song — Artist", league from round) → `{ project }`
  - `read` `{projectId}` → `readCover` → saves `breakdown_json`, sets default treatments using the round submitter if any → `{ breakdown, treatments }`
  - `save` `{projectId, breakdown?, treatments?}` → validates via `normalizeBreakdown` → `{ project }`
  - `preview-prompt` `{projectId, treatments}` → `{ prompt }`
  - `generate` `{projectId, treatments, modelId?, promptOverride?}` → loads headshots for player treatments, `describeIdentity` per player (cache features per project+slug in `treatments_json` metadata `identities`), `generateVersion` → `{ version, stats }`
  - `rate` `{versionId, ratings, note?}`; `keeper` `{projectId, versionId}`; `share` `{projectId}` → `{ stillUrl, gifUrl }`
- `GET /api/cover-factory/media/<rel>` serves files under `coverRoot()` (path-guarded, `Cache-Control: private, max-age=60`, correct content-type); `?download=1` sets `Content-Disposition: attachment`; also `/api/cover-factory/media/export/<versionId>.gif|.jpg` streams `makeWipeGif`/`makeStill` built on the fly for downloads.
- `share.ts`: `export async function shareKeeper(db, projectId, digestsRoot = process.env.DIGESTS_DIR ?? '/app/digests'): Promise<{ stillUrl: string; gifUrl: string }>` → if `share_version_id === keeper_version_id` and files exist, reuse; else new `randomBytes(12).toString('hex')` dir under `<digestsRoot>/_media/covers/`, write `cover.jpg` + `wipe.gif`, update project; URLs `${digestBaseUrl()}/_media/covers/<dir>/…`. Throws if no keeper.
- Errors → JSON `{ error, reason? }` with 4xx for bad input, 502 for provider errors, 409 when generation is paused.

- [ ] **Step 1: Failing tests** (in-memory DB, temp `DATA_DIR`/`DIGESTS_DIR`, fetch fake): create(spotify) → project; read → breakdown saved; generate → version ok; rate out of range → 400; keeper then share twice → identical URLs; change keeper then share → different dir; share without keeper → 400; media route rejects `../` traversal (403/404).
- [ ] **Step 2–4:** FAIL → implement (`service.ts` holds action handlers; the route stays thin) → PASS. **Step 5: Commit** `cover factory: API, media and share`.

---

### Task 8: The page + nav entry

**Files:**
- Create: `ui/src/routes/cover-factory/+page.svelte`, `ui/src/routes/cover-factory/+page.server.ts` (load → same as `GET /api/cover-factory`), `ui/src/lib/coverFactory/` components as needed (e.g. `CoverPicker.svelte`, `BreakdownEditor.svelte`, `VersionStrip.svelte`, `RatingStars.svelte`)
- Modify: `ui/src/routes/+layout.svelte` nav array — add `{ href: '/cover-factory', label: 'Cover Factory', glyph: '▸' }` directly after Avatar Factory.

**Design (match `/avatar-factory`):** Tailwind token utilities (`bg-surface border border-border rounded-md`, `text-fg`, `font-display` headings, `--color-accent` for primary actions, ember/moss for failure/success), `max-w-6xl mx-auto px-4 py-8 space-y-6`. Load the frontend-design / impeccable skill guidance for polish. Layout:
1. Header: "Cover Factory" + short line ("Slip a player into an album cover. Reads the cover, swaps the subject, keeps the style."), current reader/generator model chips linking to `/settings/models`, project spend.
2. Left rail: recent projects (cover thumb, title, keeper badge, tries).
3. Step 1 **Cover**: tabs Round song (league → round → song grid with art + submitter) · Spotify link · Upload.
4. Step 2 **Read & subjects**: cover image beside the editable breakdown (style, composition, palette/lighting, text elements, subjects table with role); per subject treatment row: mode (player / keep / remove), player select (with low-res/missing warning + "upload headshot"), age, gender, clothing, pose/gaze, style match, notes. Quick buttons: "Submitter replaces main", "Submitter replaces ALL people". "Re-read cover" button.
5. Step 3 **Generate**: model select (generator models via `modelsForJob`, pinned default), collapsible editable prompt preview, Generate button with spinner + elapsed seconds; versions strip (newest first) with original/new toggle, status, cost, latency, four star rows (likeness, seamlessness, gag, followed instructions), note, "Keeper" toggle; failed versions show the reason (e.g. "Model returned no image (safety/likeness refusal)").
6. Output panel for the keeper: wipe GIF preview, Download still, Download GIF, Create share link (shows copyable URLs).
Empty/loading/error states everywhere; no layout shift while generating; keyboard-accessible controls with labels.

- [ ] **Step 1:** Implement the page against the Task 7 API.
- [ ] **Step 2: Run** `npm run build` → success; `npm test` count unchanged.
- [ ] **Step 3: Verify in a real browser** (production build on a DB copy in the scratchpad + temp `DATA_DIR`, Playwright/Chrome tools): nav shows "Cover Factory"; create from a Spotify link; read; generate once with real OpenRouter (≤ $0.15); rate; keeper; GIF renders; screenshot each step to the report. Kill the server after.
- [ ] **Step 4: Commit** `cover factory: page + nav`.

---

### Task 9: Deploy + live quality pass

- [ ] **Step 1:** From the main repo after merge: `docker compose -f docker-compose.yml -f ~/.local/state/boarz-lanes/survey-sync-pause/docker-compose.survey-sync-off.yml build bot-ui && … up -d bot-ui`; confirm `/cover-factory` responds 200 inside the container and the nav entry renders.
- [ ] **Step 2: Live quality pass** (budget ≤ $1.50 total): make covers for at least three real players across Boarz and Second Best (one person cover, one group cover, one stylized/illustrated cover) via the live API; inspect each result visually against original + headshot; if likeness or seamlessness is weak, tune `READ_PROMPT` / `buildSwapPrompt` wording (tests updated), redeploy, retry. Record model, cost, latency, ratings in the report.
- [ ] **Step 3:** Mark the best result keeper, create a share link, fetch the public `gifUrl` and confirm 200 + `image/gif`.
- [ ] **Step 4:** Commit any prompt tuning; run GitNexus detect-changes; push only per user instruction (user asked for push on 2026-11-04).
