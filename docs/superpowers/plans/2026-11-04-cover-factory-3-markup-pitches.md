# Cover Factory — Piece 3: Subject Markup, Profile Jokes, Concept Pitches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/cover-factory`, subjects are drawn as lettered boxes on the cover (click to select, drag to add a subject), each player's profile feeds joke suggestions, and a "Pitch me concepts" action turns any cover — including covers with no people — into concrete one-line gag plans (morph / signature item / recast) that apply straight into the subject treatments.

**Architecture:** The reader now returns normalized subject boxes. A new `profiles.ts` loads per-player profile excerpts from the personify profile markdown (mounted read-only into the container). A new `pitch.ts` calls the pinned **pitch** model (piece 1 job) with the cover image, breakdown and profile excerpts, returns validated concepts, and logs the request as step `pitch`. A concept is just new/updated subjects + treatments, so the existing prompt builder and generator are reused unchanged except for box-derived placement text. UI adds a `SubjectMarkup.svelte` overlay and a `ConceptPitches.svelte` panel; `SubjectCard` gains profile idea chips.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind 4 tokens, better-sqlite3, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-cover-factory-design.md` — section "3. Subject markup UI + profile jokes + concept pitches" (wireframe accepted 2026-11-03), plus the four moves in Goals. Pieces 1–2 are live.

## Global Constraints

- Work in `ui/`. Tests `npx vitest run <file>`; full `npm test` keeps exactly the 15 pre-existing failures in 11 unrelated files; `npm run build` passes.
- GitNexus impact analysis before editing an existing function (`node ~/Projects/music-league-bot/.gitnexus/run.cjs impact "<sym>" --direction upstream --repo ~/Projects/music-league-bot`; the index may be stale — then confirm callers with grep and say so).
- Boxes are `[x, y, w, h]` fractions of the cover in 0–1 (top-left origin), clamped so `x+w ≤ 1`, `y+h ≤ 1`, `w,h ≥ 0.02`.
- Concept moves (exact strings): `morph`, `signature`, `recast`. (Alternate covers are piece 4; pitches never suggest them.)
- Pitch model = `getPinnedCoverModel(db, 'pitch')`; request logged with `step: 'pitch'`. Pitch and read calls respect `assertGenerationAllowed()` (paid calls).
- Profile excerpts: at most 6000 characters per player, from these sections only: "Topics", "Humor style", "How the others see him/her" (match `## N. <title>` headings case-insensitively; include their `###` subsections), plus `player_profiles.notes`/`tags` when non-empty.
- Taste bar (spec): gags must be funny *for that player*; avoid cheap literal mashups (e.g. a face pasted on body parts). The pitch prompt states this, and lists "morph" as the fallback move.
- Svelte 5 runes; client code imports `$lib/server/*` only as `import type`; every keyed `{#each}` key is unique; no one-sided thick accent borders (impeccable `side-tab` rule); style matches the existing `/cover-factory` page.
- Commit after each task (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.

## Review Focus

1. Reader returns boxes in pixels (e.g. `[120, 40, 300, 500]`) or out-of-range → normalized to fractions when the values look like pixels (any value > 1 → divide by the cover's pixel size if known, else drop the box); never crash, never keep an invalid box. (Task 1 test.)
2. A player with no profile file (e.g. Hip Jammers, or a name with an apostrophe/accents) → pitches still work with an empty excerpt; no 500. (Task 2 test.)
3. Pitch model returns concepts referencing subject labels that don't exist, an unknown move, or a non-roster player slug → those concepts/treatments are dropped or repaired (unknown label on a "new subject" concept becomes an added subject); never applied blindly. (Task 3 test.)
4. Applying a concept twice must not duplicate added subjects (labels stay unique). (Task 4 test.)
5. Drawing a tiny/zero-size box or dragging outside the image → ignored or clamped; keyboard users can still add a subject via the existing "+ Add subject" button. (Task 5 check.)

---

### Task 1: Subject boxes from the reader + placement text in prompts

**Files:** Modify `ui/src/lib/server/coverFactory/breakdown.ts` (READ_PROMPT, box normalization), `ui/src/lib/server/coverFactory/prompt.ts` (placement phrase); Tests `breakdown.test.ts`, `prompt.test.ts`.

**Interfaces — Produces:**
- `READ_PROMPT` additionally asks, per subject, for `"box": [x, y, w, h]` as fractions 0–1 of the image (top-left origin), tight around the subject.
- `export function normalizeBox(raw: unknown, size?: { width: number; height: number }): [number, number, number, number] | undefined` — numbers only; if any value > 1 and `size` given → divide x,w by width and y,h by height; if > 1 and no size → undefined; then clamp per Global Constraints; round to 3 decimals.
- `normalizeBreakdown(raw, size?)` uses `normalizeBox` (new optional 2nd param; existing callers unchanged).
- `export function placementPhrase(box: [number,number,number,number]): string` (prompt.ts) → e.g. `"occupying roughly the left-center of the frame (x 10–45%, y 20–90%)"`; `playerParagraph` appends it after the position text when the subject has a box.

- [ ] **Step 1: Failing tests:** `normalizeBox([0.1,0.2,0.3,0.4])` → same; `normalizeBox([0.9,0.9,0.5,0.5])` → `[0.9,0.9,0.1,0.1]`; `normalizeBox([120,40,300,500],{width:600,height:600})` → `[0.2,0.067,0.5,0.833]`; `normalizeBox([120,40,300,500])` → undefined; `normalizeBox([0.5,0.5,0,0])` → w,h 0.02 clamped; `normalizeBox('x')` → undefined. `buildSwapPrompt` with a boxed player subject contains `x 10–40%`.
- [ ] **Step 2–4:** RED → implement → GREEN. `readCover` (reader.ts) passes the cover's pixel size (sharp metadata of the cover bytes it already has, or none) — impact-check `readCover` first.
- [ ] **Step 5: Commit** `cover factory: subject boxes from reader + placement in prompt`.

---

### Task 2: Player profile excerpts

**Files:** Create `ui/src/lib/server/coverFactory/profiles.ts`, test `profiles.test.ts`. Modify `docker-compose.yml` bot-ui `volumes` + `environment`.

**Interfaces — Produces:**
```ts
export function profilesRoot(): string   // process.env.COVER_PROFILES_DIR ?? join(process.cwd(), '..', '.planning/spikes/digest-comedy-media/personify/profiles')
export interface ProfileExcerpt { slug: string; name: string; text: string; source: 'file'|'db'|'both'|'none' }
export function loadProfileExcerpt(db: Database.Database, p: { slug: string; name: string }): ProfileExcerpt
```
File lookup: `<root>/<Name_With_Underscores>.md` or `<root>/second_best/<Name_With_Underscores>.md` (name from roster, spaces → `_`), case-insensitive match against the directory listing, also accepting a file whose stem slugifies to the player slug. Extract the three sections per Global Constraints; append `player_profiles` notes/tags for that player id/name when non-empty; cap 6000 chars (cut at a paragraph boundary). Missing everything → `{ text: '', source: 'none' }`.
Compose: add `- ./.planning/spikes/digest-comedy-media/personify/profiles:/app/profiles:ro` to bot-ui volumes and `- COVER_PROFILES_DIR=/app/profiles` to its environment. `docker-compose.yml` has the user's own uncommitted edits — **stage only your two added lines** (e.g. `git diff docker-compose.yml` → build a patch with just your hunk → `git apply --cached`), and verify with `git diff --cached docker-compose.yml` that nothing else is staged.

- [ ] **Step 1: Failing tests** (temp dir as `COVER_PROFILES_DIR` with `Shane_Farkas.md` containing sections 1–6 and `second_best/Tommy_Chapin.md`): excerpt contains the "How the others see him" body and "Humor style" body but not "Imitation kit"; Tommy found under `second_best/`; unknown player → `source 'none'`, `text ''`; a 20 000-char section is capped ≤ 6000.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** `cover factory: player profile excerpts (+ compose mount)`.

---

### Task 3: Concept pitch service + API action

**Files:** Create `ui/src/lib/server/coverFactory/pitch.ts`, test `pitch.test.ts`. Modify `ui/src/lib/db/schema.ts` + `ui/src/lib/db/client.ts` (allow `step='pitch'`), `ui/src/lib/server/coverFactory/repo.ts` (`CoverRequest.step` type), `ui/src/lib/server/coverFactory/service.ts` (+ API test).

**Schema:** `cover_requests.step` CHECK must allow `'pitch'`. SQLite can't alter a CHECK: in `client.ts`, if `sqlite_master.sql` for `cover_requests` lacks `'pitch'`, rebuild the table in a transaction (create `cover_requests_new` with the new CHECK, copy rows, drop, rename, recreate indexes) — follow the existing rebuild pattern in `client.ts` (search "Widen player_identities.identity_type"). Update `schema.ts` so fresh DBs get the new CHECK.

**Interfaces — Produces:**
```ts
export type ConceptMove = 'morph' | 'signature' | 'recast';
export interface Concept { id: string; move: ConceptMove; title: string; plan: string;   // plan = one concrete line
  addSubjects: Subject[];        // new subjects this concept introduces (labels assigned by applyConcept)
  treatments: Treatment[];       // keyed by existing labels or by the addSubjects' provisional labels 'N1','N2',…
}
export const PITCH_PROMPT: string
export async function pitchConcepts(db, projectId: number, o: { playerSlugs: string[]; count?: number; fetchImpl?: FetchLike }): Promise<Concept[]>
export function applyConcept(b: Breakdown, current: Treatment[], c: Concept): { breakdown: Breakdown; treatments: Treatment[] }
```
`pitchConcepts`: pause gate; model = pinned pitch (clear error if none); inputs = cover image (data URL via `normalizeImage`), the breakdown JSON, players (name + slug + `loadProfileExcerpt`); asks for `count` (default 6) concepts as JSON spread across the three moves (≥1 each when possible), each with a one-line `plan` in Matt's examples' style ("Shane's face as the mound on the flesh cube", "Matt as the leashed tiger on all fours, leash from the woman's hand to his neck", "Berto's butt in jean shorts"), `treatments` for existing subjects, and `addSubjects` (with box when it can place them) for things that must be introduced. `PITCH_PROMPT` includes the taste bar from Global Constraints, the four Matt examples above as style anchors, says "morph" is the fallback, and forbids alternate-cover suggestions. Validation: drop unknown moves; drop treatments whose `playerSlug` isn't one of `playerSlugs`; drop treatments for labels that are neither existing nor provisional; normalize `addSubjects` through `normalizeBreakdown` subject rules (+ `normalizeBox`). Logs `step 'pitch'` (ok/error, cost).
`applyConcept`: appends `addSubjects` with the next free letters (A…Z, AA…), remaps provisional labels in treatments, merges treatments over `current` by label; idempotent — applying the same concept (same `id`) twice doesn't add subjects twice (track applied concept id on added subjects via a `conceptId` field on `Subject`, optional, ignored by the prompt).
API: `POST {action:'pitch', projectId, playerSlugs?, count?}` → `{ concepts }` (default playerSlugs = submitter if known, else 400 "choose a player"); `POST {action:'apply-concept', projectId, concept}` → saves breakdown + treatments → `{ breakdown, treatments }`. Cache the last pitch result on the project? No — return it; the page holds it (YAGNI).

- [ ] **Step 1: Failing tests** (fake fetch): valid response → 3 concepts across 3 moves, request row `step 'pitch'`; response with move `'alternate'`, a treatment for slug `'stranger'`, and a treatment for label `'Q'` → those dropped; pause → 409, zero fetch; `applyConcept` on a no-subjects breakdown with one `addSubjects` (provisional `N1`) → subject labeled `A`, treatment label `A`; applying the same concept again → still one added subject; migration: a DB created with the old CHECK gets rebuilt and accepts a `'pitch'` row with prior rows preserved.
- [ ] **Step 2–4:** RED → implement → GREEN; `npm run build`.
- [ ] **Step 5: Commit** `cover factory: concept pitches (morph/signature/recast) + apply`.

---

### Task 4: Profile idea chips per player

**Files:** Modify `pitch.ts` (or new `ideas.ts`), `service.ts`; tests.

**Interfaces — Produces:** `export async function playerIdeas(db, projectId: number, slug: string, o?: { fetchImpl?: FetchLike }): Promise<string[]>` → up to 6 short (≤ 8 words) wearable/prop/pose ideas from that player's profile excerpt (e.g. "jean shorts", "holding a pocket bidet"); uses the pitch model, `step 'pitch'`, pause gate; cached per project+slug in `cover_projects.identities_json` under key `ideas:<slug>` (keep the existing identity entries intact — read-modify-write the JSON object); empty profile → `[]` without a model call. API `POST {action:'ideas', projectId, slug}` → `{ ideas }`.

- [ ] **Step 1: Failing tests:** returns ≤ 6 items each ≤ 8 words (longer items trimmed or dropped); second call uses the cache (fetch called once); empty profile → `[]`, zero fetch; existing `identities_json` identity entries survive.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** `cover factory: profile idea chips`.

---

### Task 5: UI — markup overlay, pitch panel, idea chips

**Files:** Create `ui/src/lib/coverFactory/SubjectMarkup.svelte`, `ui/src/lib/coverFactory/ConceptPitches.svelte`; modify `ui/src/routes/cover-factory/+page.svelte`, `ui/src/lib/coverFactory/SubjectCard.svelte`, `ui/src/lib/coverFactory/api.ts`.

Behavior (matches the accepted 2026-11-03 wireframe):
- **SubjectMarkup** replaces the plain "Original" cover image in step 2: the cover with absolutely-positioned boxes from `subject.box` (percent units), each with its letter tag; colors by role — main = accent, secondary = amber, background = sky (dashed); selected subject = thicker ring. Click a box → select that subject (SubjectCard scrolls into view and highlights). Pointer-drag on empty image area draws a new box (live rectangle while dragging; ignore if < 2% either side) → appends a subject `{ kind:'person', role:'secondary', label: next free letter, box, position: placementPhrase(box) }` + a `keep` treatment, then selects it. Selected subject has a "Redraw box" button (next drag replaces its box) and the card's existing remove. Legend under the image. Boxless subjects listed as chips under the image ("C — no box").
- **ConceptPitches** panel in step 2, above the subject cards: "Pitch me concepts" button (shown prominently with a hint "No people on this cover — pitch a gag" when `breakdown.no_subjects`); player multi-select defaulting to the submitter; results as cards (move tag morph/signature/recast, title, one-line plan, "Use this" → `apply-concept` → refresh breakdown/treatments, then the user can generate). Loading state with elapsed seconds; errors inline; spend shown via the existing project stats refresh.
- **SubjectCard**: when the treatment is `player`, an "Ideas from <name>'s profile" button → `ideas` action → chips; clicking a chip fills `clothing` if it reads as wearable, otherwise appends to `notes` (simple rule: chips from the model are tagged by the server? — keep it simple: always append to notes; user can move it).
- Keyboard: boxes are buttons (focusable, Enter selects); drawing is pointer-only, "+ Add subject" remains the keyboard path.

- [ ] **Step 1:** Implement; `npm run build`; `npm test` count unchanged.
- [ ] **Step 2: Browser check** (production build + DB copy in the scratchpad, Playwright MCP tools, same method as piece 2 Task 8): boxes render on a person cover; draw a box; pitch concepts on a no-person cover (one real pitch call, ≤ $0.05) → apply one → prompt preview shows it; idea chips for a Boarz player with a profile (one call). Screenshots to the scratchpad. Kill the server.
- [ ] **Step 3: Commit** `cover factory: markup overlay, concept pitches, idea chips`.

---

### Task 6: Deploy + live gag pass

- [ ] **Step 1:** Merge, deploy with the survey-sync-off override, confirm `/app/profiles` is mounted in the container (`ls /app/profiles`) and `/cover-factory` is 200.
- [ ] **Step 2: Live pass** (≤ $1.00): via the live API — (a) Boarz R145 Matt Mariani "Pays imaginaire" (Polo & Pan, no people): pitch → apply the best concept → generate; (b) Second Best R139 Jon Black "Хочу перемен" (Kino, graphic/constructivist): pitch → apply → generate; (c) re-read an existing person project (e.g. project 2, Bocelli) and confirm boxes come back. Inspect results visually; tune `PITCH_PROMPT` wording if concepts are cheap or generic (tests updated), redeploy.
- [ ] **Step 3:** Commit tuning; report concepts, chosen plan, cost, latency, and the images.
