# Implementation Plan: Unified Song Metadata Queue

## Overview

Replace the existing `ytm_resolution_queue` and ad-hoc popularity/audio patterns with a single
`song_metadata_queue` table and one unified worker. Five job types: `ytm`, `lastfm_pop`,
`lastfm_tags`, `audio`, `lyrics`. Triggers fire on zip import (fast jobs only), shortlist add,
and a round-level "Fill gaps" action. A combined Queue panel lands in App Settings as the topmost
panel, scope-switchable between all-rounds health and per-round digest readiness + coverage matrix.
No per-song UI trigger this sprint — that waits for the universal song card. A single-song backend
endpoint (`POST /api/songs/[spotifyUri]/enrich`) is built now so it's wirable later.

Source specs:
- `chat-content-handoff/cd-brief-song-metadata-queue.md`
- `docs/Music league bot queue feature.zip` → `handoff/`
- `song-metadata-queue-architecture.drawio`

---

## Architecture Decisions

- **One table, one worker.** `song_metadata_queue` replaces `ytm_resolution_queue`. The old table
  stays in the schema during the migration window, then is dropped in Task 12.
- **`metadataQueue.ts` is the single DB helper.** All enqueue/status/retry calls go through it.
  `ytmQueue.ts` is retired after all call sites are migrated.
- **Worker dispatches by `job_type`.** Each handler is a pure async function
  `(db, uri) => Promise<void>`. The worker owns rate-limiting and retry logic.
- **Auto-enrich D2:** fast jobs (`ytm`, `lastfm_pop`, `lastfm_tags`, `lyrics`) on import;
  `audio` is manual unless `auto_analyze_audio` is enabled.
- **prepChecks extension:** metadata checks are added as new `CheckResult` rows with
  `optional: true` so existing digest generation is unaffected until coverage is sufficient.
- **Single-song endpoint is backend-only.** No UI wires it this sprint.

---

## Dependency Graph

```
Task 1: schema.ts + metadataQueue.ts  (foundation)
    │
    ├── Task 2: lastfm + lrclib handlers
    │       │
    │       └── Task 3: unified queueWorker.ts + hooks.server.ts
    │               │
    │               └── Checkpoint A
    │
    ├── Task 4: import + shortlist triggers
    │
    ├── Task 5: analyze-audio endpoints sync→enqueue
    │
    └── Task 6: POST /api/songs/[spotifyUri]/enrich
            │
            └── Checkpoint B
                    │
                    ├── Task 7: queue status API + fill-gaps endpoint
                    │
                    └── Task 8: prepChecks metadata coverage extension
                            │
                            └── Checkpoint C
                                    │
                                    ├── Task 9: Queue panel skeleton (settings page)
                                    │
                                    ├── Task 10: Round-scope Digest readiness + Coverage matrix
                                    │
                                    └── Task 11: Failures list + auto-enrich footer
                                            │
                                            └── Checkpoint D
                                                    │
                                                    └── Task 12: Remove ytm_resolution_queue
                                                            │
                                                            └── Checkpoint E (final)
```

---

## Phase 1: Foundation

### Task 1: `song_metadata_queue` table + `metadataQueue.ts` helper

**Description:** Add the new unified queue table to `schema.ts` and create a `metadataQueue.ts`
module with all DB helpers the rest of the codebase will use.

**Acceptance criteria:**
- [ ] `song_metadata_queue` table exists in `schema.ts` with columns: `id`, `spotify_uri`,
  `job_type` CHECK IN ('ytm','lastfm_pop','lastfm_tags','audio','lyrics'), `status` CHECK IN
  ('pending','processing','done','failed'), `error`, `retries`, `queued_at`, `started_at`,
  `done_at`, UNIQUE(spotify_uri, job_type)
- [ ] `metadataQueue.ts` exports: `enqueue(db, uri, jobType)`, `enqueueMany(db, uris, jobTypes[])`,
  `getQueueStatus(db, roundId?)`, `getFailures(db, roundId?)`, `retryJob(db, id)`,
  `getCoverageMatrix(db, roundId)`, `getDigestReadiness(db, roundId)`
- [ ] `enqueue` is idempotent (`INSERT OR IGNORE`)

**Verification:**
- [ ] `npm run check` passes
- [ ] Existing `ytm_resolution_queue` table still present (migration deferred to Task 12)

**Dependencies:** None

**Files touched:**
- `ui/src/lib/db/schema.ts`
- `ui/src/lib/db/metadataQueue.ts` (new)

**Estimated scope:** S

---

### Task 2: Last.fm + LRCLIB provider handlers

**Description:** Build the two new provider handler modules. Last.fm covers `lastfm_pop` (listeners
+ playcount → `song_popularity`) and `lastfm_tags` (genre/mood tags added to `song_popularity`).
LRCLIB covers `lyrics` (raw lyrics fetched; lyrical metrics deferred to a future task — for now just
store a `has_lyrics` flag or raw text in a new `song_lyrics_metrics` table so the queue job
succeeds).

**Acceptance criteria:**
- [ ] `ui/src/lib/lastfm.ts` exports `fetchPopularity(uri, title, artist)` and
  `fetchTags(uri, title, artist)` — each stores result to `song_popularity` and returns void
- [ ] `ui/src/lib/lrclib.ts` exports `fetchLyrics(uri, title, artist)` — stores to
  `song_lyrics_metrics` and returns void
- [ ] `song_lyrics_metrics` table added to `schema.ts` (minimal: `spotify_uri PK`, `has_lyrics INT`,
  `fetched_at TEXT`)
- [ ] Last.fm handler uses the existing `LASTFM_API_KEY` env var (check how it's used in existing
  code or `.env` — grep for LASTFM first)
- [ ] LRCLIB needs no API key (public endpoint)

**Verification:**
- [ ] `npm run check` passes
- [ ] Manual: calling `fetchPopularity` on a known URI writes a row to `song_popularity`

**Dependencies:** Task 1

**Files touched:**
- `ui/src/lib/lastfm.ts` (new or extend if exists)
- `ui/src/lib/lrclib.ts` (new)
- `ui/src/lib/db/schema.ts` (song_lyrics_metrics)

**Estimated scope:** M

---

### Task 3: Unified `queueWorker.ts` + update `hooks.server.ts`

**Description:** Rewrite `queueWorker.ts` to dispatch by `job_type` from `song_metadata_queue`.
Keep the 6s poll interval. Add per-provider rate limiting (Last.fm: 10/min via slot token;
sintel: 1 concurrent via a flag). Auto-retry up to 3 times on failure (increment `retries`,
reset to `pending` if retries < 3, else leave as `failed`). Update `hooks.server.ts` to call
the new `startQueueWorker` (it still calls the same function name, just imported from the
updated module).

**Acceptance criteria:**
- [ ] Worker picks one pending job per tick for fast job types (ytm, lastfm_pop, lastfm_tags,
  lyrics); audio is rate-limited to 1 concurrent (skip if another audio job is processing)
- [ ] On success: sets `status='done'`, `done_at=now()`
- [ ] On failure with `retries < 3`: increments retries, resets `status='pending'`
- [ ] On failure with `retries >= 3`: sets `status='failed'`
- [ ] `hooks.server.ts` starts the unified worker (no reference to old YTM-specific worker)
- [ ] The old `startQueueWorker` import in `hooks.server.ts` is updated to new module

**Verification:**
- [ ] `npm run check` passes
- [ ] Dev server starts without errors
- [ ] A pending `ytm` job in `song_metadata_queue` gets processed within 6s

**Dependencies:** Tasks 1, 2

**Files touched:**
- `ui/src/lib/queueWorker.ts`
- `ui/src/hooks.server.ts`

**Estimated scope:** M

---

### Checkpoint A: Worker is live on new table

- [ ] `npm run check` passes
- [ ] Dev server starts, no console errors
- [ ] Inserting a `ytm` job into `song_metadata_queue` manually → processed within 12s
- [ ] Existing YTM resolution still works (old queue still present, but new worker handles ytm type)

---

## Phase 2: Trigger Wiring

### Task 4: Update zip import + shortlist add triggers

**Description:** Wire the two automatic trigger points to the new queue. After a successful zip
import, enqueue fast jobs (`ytm`, `lastfm_pop`, `lastfm_tags`, `lyrics`) for all new
`spotify_uri` values. After shortlist add, do the same. If `auto_analyze_audio` is enabled,
also enqueue `audio`.

Find the zip import trigger (likely `ui/src/lib/import/importer.ts` or the import API route)
and the shortlist add trigger (`ui/src/routes/api/shortlist/+server.ts` calls
`attachYtmLinks` — that's the pattern to extend).

**Acceptance criteria:**
- [ ] After importing a zip, `song_metadata_queue` gains pending rows for each new submission's
  URI for job types: ytm, lastfm_pop, lastfm_tags, lyrics
- [ ] If `auto_analyze_audio` is enabled in settings, `audio` also enqueued on import
- [ ] Adding a song to the shortlist enqueues the same fast job types
- [ ] Existing import flow is otherwise unchanged (no regressions to round/submission data)

**Verification:**
- [ ] `npm run check` passes
- [ ] Import a test zip → verify rows appear in `song_metadata_queue`
- [ ] Add a shortlist song → verify rows appear in `song_metadata_queue`

**Dependencies:** Task 1

**Files touched:**
- `ui/src/lib/import/importer.ts` (or relevant import endpoint)
- `ui/src/routes/api/shortlist/+server.ts`

**Estimated scope:** S

---

### Task 5: Convert analyze-audio endpoints from sync → enqueue

**Description:** Replace the synchronous sintel calls in both analyze-audio endpoints with
queue inserts. The endpoints should now: look up the target URIs, call
`enqueueMany(db, uris, ['audio'])`, and return `{ queued: N }` immediately. The sintel worker
handler (from Task 3) will do the actual analysis in the background. The existing
`analyzeTrack` / `analyzePlaylist` functions in `sintel.ts` are now called only from the worker,
not from HTTP handlers.

**Acceptance criteria:**
- [ ] `POST /api/rounds/[roundId]/analyze-audio` returns `{ queued: N }` immediately (no blocking)
- [ ] `POST /api/shortlist/[id]/analyze-audio` returns `{ queued: 1 }` immediately
- [ ] Both endpoints write `audio` jobs to `song_metadata_queue`
- [ ] `sintel.ts` itself is unchanged (still the worker calls it)

**Verification:**
- [ ] `npm run check` passes
- [ ] Calling the round endpoint returns in <100ms
- [ ] Audio job appears in `song_metadata_queue` with status='pending'

**Dependencies:** Task 1

**Files touched:**
- `ui/src/routes/api/rounds/[roundId]/analyze-audio/+server.ts`
- `ui/src/routes/api/shortlist/[id]/analyze-audio/+server.ts`

**Estimated scope:** S

---

### Task 6: `POST /api/songs/[spotifyUri]/enrich` (single-song backend endpoint)

**Description:** New endpoint that enqueues all job types for a single `spotify_uri`. Body
accepts optional `{ jobTypes?: string[] }` to scope which types (defaults to all 5). Returns
`{ queued: N, alreadyQueued: M }`. No UI wires this endpoint this sprint — it exists so the
universal song card can wire it later with no backend work.

**Acceptance criteria:**
- [ ] `POST /api/songs/spotify:track:xxx/enrich` → inserts pending rows for all 5 job types
  (or subset if `jobTypes` specified)
- [ ] Idempotent: already-queued/done URIs for a job type do not create duplicate rows
- [ ] Returns `{ queued: N, alreadyQueued: M }`
- [ ] 400 if `spotifyUri` is malformed

**Verification:**
- [ ] `npm run check` passes
- [ ] `curl -X POST /api/songs/spotify:track:xxx/enrich` → rows appear in queue

**Dependencies:** Task 1

**Files touched:**
- `ui/src/routes/api/songs/[spotifyUri]/enrich/+server.ts` (new)

**Estimated scope:** S

---

### Checkpoint B: Trigger wiring complete

- [ ] `npm run check` passes
- [ ] Import zip → 4 job types enqueued per song
- [ ] `POST .../analyze-audio` returns immediately, job appears in queue
- [ ] Single-song enrich endpoint works via curl

---

## Phase 3: Queue API + Data Layer

### Task 7: Queue status API + fill-gaps endpoint

**Description:** Build the API endpoints the Queue panel UI will call.

- `GET /api/metadata-queue/status?roundId=N` — returns per-job-type counts (pending, processing,
  done24h, failed, total) and failures list. `roundId` is optional; omit for all-rounds view.
- `POST /api/metadata-queue/fill-gaps` body `{ roundId: N }` — finds all `spotify_uri` values
  in `ml_submissions` for the round that are missing any fast job type (no row, or row is
  `failed`), enqueues them, returns `{ queued: N }`.
- `POST /api/metadata-queue/retry` body `{ id: N }` — resets a failed job to pending.

**Acceptance criteria:**
- [ ] Status endpoint returns correct counts for both scopes (all vs round)
- [ ] Status endpoint includes `failures` array with `{ id, spotify_uri, job_type, error, retries }`
- [ ] Fill-gaps enqueues only missing/failed jobs (not done or already pending)
- [ ] Retry endpoint resets `status='pending'`, clears `error`

**Verification:**
- [ ] `npm run check` passes
- [ ] Hitting the status endpoint returns valid JSON
- [ ] Fill-gaps on a round with missing jobs → rows appear in queue

**Dependencies:** Task 1

**Files touched:**
- `ui/src/routes/api/metadata-queue/status/+server.ts` (new)
- `ui/src/routes/api/metadata-queue/fill-gaps/+server.ts` (new)
- `ui/src/routes/api/metadata-queue/retry/+server.ts` (new)

**Estimated scope:** M

---

### Task 8: Extend `prepChecks.ts` with metadata coverage checks

**Description:** Add 5 new `CheckResult` rows to `runPrepChecks` for metadata coverage, each
`optional: true`. These mirror the Digest readiness block in the UI spec and share the same
80%-coverage threshold as the existing Tastemaker logic.

| Check name | ok condition | src |
|---|---|---|
| YTM playlist links | all submissions have ytm_link_cache row | `ytm_link_cache` |
| Tastemaker leaderboard | ≥80% of submissions have song_popularity row | `song_popularity` |
| Genre & mood blurbs | ≥80% of submissions have non-null tags in song_popularity | `song_popularity.tags` |
| Lyrical metrics | ≥80% of submissions have song_lyrics_metrics row | `song_lyrics_metrics` |
| Audio insights | ≥80% of submissions have song_audio_features row | `song_audio_features` |

**Acceptance criteria:**
- [ ] `runPrepChecks` returns the 5 new rows appended after the existing 6
- [ ] Each new row has `optional: true`
- [ ] `ok` threshold logic matches the spec above
- [ ] `count` is the number of covered songs (numerator, not the percentage)
- [ ] Existing 6 checks are unchanged

**Verification:**
- [ ] `npm run check` passes
- [ ] Existing tests still pass (`npm test`)
- [ ] A round with partial popularity coverage → Tastemaker row returns `ok: false`

**Dependencies:** Tasks 1, 2 (schema for lyrics table)

**Files touched:**
- `ui/src/lib/digest/prepChecks.ts`

**Estimated scope:** S

---

### Checkpoint C: Data layer complete

- [ ] `npm run check` passes, tests pass
- [ ] Status API returns correct per-type counts and failures
- [ ] `runPrepChecks` returns 11 rows (6 existing + 5 metadata)
- [ ] Fill-gaps endpoint works correctly

---

## Phase 4: Queue Panel UI

### Task 9: Queue panel skeleton — scope control, tiles, per-job rows

**Description:** Add the Queue panel as the first child after `<SettingsTabs />` in
`settings/+page.svelte`. Implement the header, scope control (segmented: All rounds / recent rounds
populated from DB via page server load), summary tiles (4), and per-job-type rows (5). Load data
from `GET /api/metadata-queue/status`. Poll every 10s while the panel is visible.

UI conventions per spec:
- Left border: `3px solid var(--color-accent)`
- Status chip colors: done=`--color-health`, processing/queued=`--color-accent`, failed=`--color-warn`, missing=`--color-fg-dim`
- Per-job rows: `[ name + provider·speed ] [ progress bar ] [ done/total ] [ status chip ]`
- Audio row chip shows pulsing dot; note `2–10m · 1 concurrent`

**Acceptance criteria:**
- [ ] Panel renders above the existing weights/import grid
- [ ] Scope control switches between All rounds and specific rounds (populated from DB)
- [ ] 4 summary tiles show correct counts for the current scope
- [ ] 5 per-job rows show progress bars and status chips
- [ ] Data refreshes every 10s

**Verification:**
- [ ] `npm run check` passes
- [ ] Dev server renders the panel in Settings
- [ ] Switching scope updates all counts

**Dependencies:** Task 7

**Files touched:**
- `ui/src/routes/settings/+page.svelte`
- `ui/src/routes/settings/+page.server.ts` (add rounds list to load)

**Estimated scope:** L

---

### Task 10: Round-scope Digest readiness block + Coverage matrix

**Description:** When a specific round is selected in the scope control, show two additional
blocks below the per-job rows:

1. **Digest readiness** — 5 rows mirroring the `prepChecks` metadata checks. Each row: glyph
   (✓ or !) + section name + source·count (mono) + Ready/Blocked chip. Headline: "N section(s)
   blocked". **"Fill gaps · enrich N"** button (shown only when gaps exist): calls
   `POST /api/metadata-queue/fill-gaps`, shows optimistic green flip on success.

2. **Coverage matrix** — song × job-type grid for the round. Columns: YTM / Pop / Tags / Audio /
   Lyr. Each cell: done / running / queued / failed / missing. Data from
   `getCoverageMatrix` (via status endpoint or a dedicated field).

**Acceptance criteria:**
- [ ] Both blocks only appear when a specific round is selected (not All rounds)
- [ ] Digest readiness rows correctly reflect `prepChecks` metadata coverage data
- [ ] Fill gaps button is hidden when the round is green (0 blocked)
- [ ] Fill gaps button calls fill-gaps endpoint, shows toast, flips blocked rows to a
  "queued" state optimistically
- [ ] Coverage matrix renders correct state per cell

**Verification:**
- [ ] `npm run check` passes
- [ ] Round with missing jobs → blocked rows and Fill gaps button visible
- [ ] Clicking Fill gaps → toast, rows flip optimistically
- [ ] Coverage matrix cells match actual queue state

**Dependencies:** Tasks 7, 8, 9

**Files touched:**
- `ui/src/routes/settings/+page.svelte`

**Estimated scope:** M

---

### Task 11: Failures list (all-rounds) + auto-enrich footer

**Description:** Two remaining panel sections:

1. **Failures list** (all-rounds scope only): collapsible `Failures (N) · auto-retry n/3`.
   Each row: title · provider · error · `Retry ↻` button (calls retry endpoint).

2. **Auto-enrich footer** (always visible): green `✓` chips for `ytm/popularity/tags/lyrics`,
   dashed `audio · manual` chip, **Include audio** toggle wired to the existing
   `GET/PUT /api/settings/auto-analyze` endpoint (already implemented — just move the toggle
   here from its current position in the settings page and remove the old one).

**Acceptance criteria:**
- [ ] Failures list only appears in all-rounds scope
- [ ] Retry button calls retry endpoint and removes the row on success
- [ ] Auto-enrich footer is visible in all scopes
- [ ] Include audio toggle correctly reads/writes `auto_analyze_audio` setting
- [ ] The old standalone auto-analyze toggle (currently in settings page) is removed
  to avoid duplication

**Verification:**
- [ ] `npm run check` passes
- [ ] A failed job → appears in failures list with error text
- [ ] Retry → job resets to pending, row disappears from failures
- [ ] Include audio toggle persists across page refresh

**Dependencies:** Tasks 7, 9

**Files touched:**
- `ui/src/routes/settings/+page.svelte`

**Estimated scope:** S

---

### Checkpoint D: Queue panel complete

- [ ] `npm run check` passes
- [ ] Panel renders correctly in all scopes
- [ ] All interactivity works (scope switch, fill gaps, retry, include audio toggle)
- [ ] No console errors in browser dev tools
- [ ] Smoke: `cd ui && npm run dev -- --host --port 5180` and verify manually

---

## Phase 5: Cleanup

### Task 12: Retire `ytm_resolution_queue` + `ytmQueue.ts`

**Description:** Remove the old YTM-specific queue table and helper. Steps:
1. Migrate any pending/failed rows from `ytm_resolution_queue` to `song_metadata_queue` as
   `job_type='ytm'` (one-time migration in schema.ts init, guarded by checking if the old table
   still has rows).
2. Drop `ytm_resolution_queue` from `schema.ts` (or keep the `CREATE TABLE IF NOT EXISTS`
   but empty the worker reference — safer to keep schema for now, drop once confident).
3. Delete `ui/src/lib/db/ytmQueue.ts`.
4. Update `ui/src/lib/db/client.test.ts` (removes ytm_resolution_queue from expected tables).
5. Update `ui/src/routes/api/ytm-queue/+server.ts` to redirect to or wrap the new status endpoint.

**Acceptance criteria:**
- [ ] `ytmQueue.ts` deleted
- [ ] No remaining imports of `ytmQueue.ts` anywhere
- [ ] `ytm-queue` API route either removed or returns data from the new queue
- [ ] `client.test.ts` updated to expect `song_metadata_queue` instead of `ytm_resolution_queue`
- [ ] `npm run check` passes, tests pass

**Verification:**
- [ ] `npm run check` passes
- [ ] `npm test` passes
- [ ] Dev server starts, no broken imports

**Dependencies:** All prior tasks

**Files touched:**
- `ui/src/lib/db/ytmQueue.ts` (delete)
- `ui/src/lib/db/schema.ts`
- `ui/src/lib/db/client.test.ts`
- `ui/src/routes/api/ytm-queue/+server.ts`

**Estimated scope:** S

---

### Checkpoint E: Final smoke

- [ ] `npm run check` passes
- [ ] `npm test` passes
- [ ] Dev server starts cleanly
- [ ] Import a zip → jobs enqueue → worker drains → panel shows progress
- [ ] Digest readiness block goes green after fill-gaps on a complete round
- [ ] No references to `ytm_resolution_queue` remain except possibly the schema DROP

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Last.fm API key not in env | Med | Grep for existing key before building handler; fail gracefully with error in job |
| sintel concurrency: audio job blocks worker | High | 1-concurrent flag in worker; fast jobs use separate tick logic |
| Coverage matrix query is slow on large rounds | Low | Add index on `(spotify_uri, job_type, status)` in schema |
| prepChecks change breaks digest generation | Med | New checks are all `optional: true`; existing logic unchanged |
| Old queue rows lost on migration | Low | Migration copies rows before dropping; keep old table in schema until confirmed clear |

---

## Open Questions

- Does `song_popularity` currently have a `tags` column, or does Last.fm tags need a new column?
  (Check schema before Task 2.)
- What is the exact Last.fm API endpoint for tags, and is the key already in use somewhere?
  (Grep `LASTFM` in the codebase before Task 2.)
- Should the coverage matrix in the panel be paginated for rounds with many songs (>20)?
  (Flag for Task 10 — start unpaginated, add scroll if needed.)
