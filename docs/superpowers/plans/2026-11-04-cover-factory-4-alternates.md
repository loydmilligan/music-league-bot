# Cover Factory — Piece 4: Alternate Covers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On any Cover Factory project, "Alternate covers" lists other edition/single/compilation art for the same song (MusicBrainz + Cover Art Archive), visually de-duplicated; picking one makes it the project's cover (the original is kept). Concept pitches may suggest an alternate (`alternate` move) when it makes the gag easier; applying such a concept switches the cover for free and asks the user to re-read — never auto-spends.

**Architecture:** New `alternates.ts` (MusicBrainz search → release groups/releases → CAA fronts → dedupe by 8×8 average hash, cached in a new `cover_alt_cache` table), two project columns (`original_cover_rel`, `song_title`/`song_artist`/`song_album`), two API actions, a pitch-prompt extension, and an "Alternate covers" panel in step 1/2 of the page.

**Spec:** `docs/superpowers/specs/2026-11-04-cover-factory-design.md` §4 + "alternate cover" move in Goals; `docs/onboarding/agent-briefing-cover-factory.md`.

## Global Constraints

- Work in `ui/`. `npx vitest run <file>`; full `npm test` keeps only the ~15 pre-existing unrelated failures; `npm run build` passes. GitNexus impact before editing existing functions (`node ~/Projects/music-league-bot/.gitnexus/run.cjs impact "<sym>" --direction upstream --repo ~/Projects/music-league-bot`; if stale/not found, confirm with grep and say so).
- MusicBrainz: base `https://musicbrainz.org/ws/2/`, `fmt=json`, header `User-Agent: music-league-bot/1.0 (https://github.com/loydmilligan/music-league-bot)` (no email), **≥ 1.1 s between MusicBrainz requests** (module-level queue), at most 6 MusicBrainz requests per `findAlternateCovers` call. Cover Art Archive: `https://coverartarchive.org/release/<mbid>` JSON and `…/front-500`; CAA JSON returns `http://` image URLs — always rewrite to `https://`. All image bytes go through `fetchCoverBytes` (https only, redirect re-check, 10 MB cap); allow its redirect hops to reach `archive.org` hosts.
- Network results cached in `cover_alt_cache(key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT NOT NULL)`; TTL 7 days.
- Max 12 alternates returned, original-release first excluded only if visually identical to the current cover.
- Concept move added: `alternate` (exact string). Applying an `alternate` concept never triggers a paid call.
- Client code imports `$lib/server/*` only as `import type`; unique `{#each}` keys; no one-sided thick accent borders; match existing `/cover-factory` styling.
- Commit per task (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.

## Review Focus

1. Song with no MusicBrainz match / CAA 404 / MusicBrainz 503 rate-limit → `[]` plus a human message, never a 500; nothing cached on error. (Task 1 test.)
2. Many editions sharing the same art (e.g. 8 releases of *Punk in Drublic*) → one tile, not eight. (Task 1 test.)
3. Switching to an alternate keeps `original_cover_rel` (set once, never overwritten by later switches) and clears the breakdown/treatments so a stale read can't drive generation; versions already made stay intact. (Task 2 test.)
4. Upload-source projects with no known title/artist → the panel asks for a search ("song — artist") instead of erroring. (Task 2/3.)
5. A pitched `alternate` concept references an alternate id not in the cached list → dropped. (Task 2 test.)

---

### Task 1: `alternates.ts` — lookup, CAA, dedupe, cache

**Files:** Create `ui/src/lib/server/coverFactory/alternates.ts` + test; modify `ui/src/lib/db/schema.ts` (+ `cover_alt_cache` table, `CREATE TABLE IF NOT EXISTS`).

**Produces:**
```ts
export interface AltCover { id: string /* `${releaseMbid}` */; releaseMbid: string; releaseGroupMbid: string; title: string; kind: string /* Album|Single|EP|Compilation|… */; date: string | null; country: string | null; thumbUrl: string /* https …/front-250 */; fullUrl: string /* https …/front-500 */ }
export async function findAlternateCovers(db, q: { title: string; artist: string; album?: string | null }, o?: { fetchImpl?: FetchLike; now?: () => number }): Promise<{ alternates: AltCover[]; message: string | null }>
export async function averageHash(bytes: Buffer): Promise<string>   // 8×8 grayscale aHash → 16 hex chars
```
Algorithm: (a) if `album` → release-group search `releasegroup:"<album>" AND artist:"<artist>"`; (b) recording search `recording:"<title>" AND artist:"<artist>" AND status:official` (limit 25) → release groups of its releases, preferring primary types Album/Single/EP and skipping secondary type Live unless nothing else; (c) for up to 4 release groups, browse `release?release-group=<id>&limit=50` and keep releases with `cover-art-archive.front === true`; (d) fetch each candidate's `front-250` thumbnail (via `fetchCoverBytes`), `averageHash` it, drop near-duplicates (Hamming distance ≤ 6) keeping the earliest date; stop at 12. Strip quotes/Lucene specials from query terms; drop "- 2007 Remaster", "(feat. …)", "Single Version" style suffixes from titles before searching. Cache the final list under key `alt:<lower(artist)>|<lower(title)>|<lower(album)>`.

- [ ] **Step 1: Failing tests** (fake fetch routing by URL): album path returns 8 releases whose thumbnails are 2 distinct images → 2 alternates, earliest-dated kept; `http://coverartarchive.org/...` in JSON becomes `https://` in `thumbUrl`/`fullUrl`; MusicBrainz 503 → `{alternates: [], message: /busy|try again/i}` and no cache row; no matches → `[]` + message; second call within TTL uses cache (fetch not called); two consecutive MusicBrainz requests are ≥ 1100 ms apart (inject `now`/sleep spy); title "Juicy - 2007 Remaster" searches `Juicy`.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** `cover factory: alternate cover lookup (MusicBrainz + CAA)`.

### Task 2: project columns, API actions, pitch `alternate` move

**Files:** modify `schema.ts` + `client.ts` (idempotent `ALTER TABLE cover_projects ADD COLUMN` for `original_cover_rel TEXT`, `song_title TEXT`, `song_artist TEXT`, `song_album TEXT`), `repo.ts`, `service.ts`, `pitch.ts`; tests.

**Produces:**
- `create` stores song_title/artist/album (round: from `ml_submissions.title/artists/album`; spotify: resolved title/artists, album if known; upload: null).
- `POST {action:'alternates', projectId, q?: string}` → `{ alternates, message }`; `q` ("song — artist") overrides stored terms (required when the project has none → 400 "search for the song").
- `POST {action:'use-alternate', projectId, alternateId}` → alternate must be in the project's cached list; downloads `fullUrl` via `fetchCoverBytes` → saves under `covers/` (new file) → sets `cover_rel`, sets `original_cover_rel` only if null, clears `breakdown_json` and `treatments_json` → `{ project }`. `POST {action:'restore-original', projectId}` → back to `original_cover_rel` (same clearing).
- Pitch: when the project has cached alternates, `PITCH_PROMPT` lists them (`id`, title, kind, date) and allows `move:'alternate'` with `alternateId` and a one-line plan of the gag the alternate enables ("Jon as Fat Mike's dad on the Ribbed-era cover"); `cleanConcepts` keeps `alternate` concepts only with a known `alternateId` (no treatments required). `apply-concept` of an `alternate` concept = `use-alternate` (free) and returns `{ project, needsRead: true }`.

- [ ] Tests (RED→GREEN): create(round) stores song fields from the submission; alternates with no terms → 400; use-alternate sets cover_rel + original once (second switch keeps the first original), clears breakdown/treatments, versions untouched; unknown alternateId → 400; restore-original; alternate concept with unknown id dropped; applying an alternate concept makes zero paid calls (fetch fake only sees the CAA image GET).
- [ ] Commit `cover factory: alternate cover actions + pitch alternate move`.

### Task 3: UI — "Alternate covers" panel

**Files:** create `ui/src/lib/coverFactory/AlternateCovers.svelte`; modify `+page.svelte`, `api.ts`, `ConceptPitches.svelte` (render `alternate` cards: tag "alternate", thumb of the alternate, "Use this cover").

Panel under the cover in step 2 (collapsed by default, "Alternate covers" button; auto-expanded with a hint when the cover has no people): grid of thumbs with title · kind · year · country; current cover marked; "Use this cover" → `use-alternate` → page shows "Cover changed — Re-read cover" call-to-action (no automatic read); "Back to original" when `original_cover_rel` is set; search field when the project has no song terms; loading/empty/error states (MusicBrainz busy message). Browser check on a production build with a DB copy (same method as pieces 2–3): open a round project, list alternates (no paid calls), switch, re-read (one read ≤ $0.02), restore. Screenshots to `<scratchpad>/cf4-shots/`. Commit `cover factory: alternate covers panel`.

### Task 4: deploy + live alternate case

Merge (stash/pop Matt's `docker-compose.yml` WIP), deploy with the survey-sync-off override, verify in-container. Live: one project where the alternate makes the gag (e.g. a NOFX/older-catalog song with multiple editions in Boarz or Second Best history), switch → read → generate (≤ $0.20). Report the image.
