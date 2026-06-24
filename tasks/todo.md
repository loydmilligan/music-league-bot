# Task List: Unified Song Metadata Queue

## Phase 1: Foundation
- [x] Task 1: `song_metadata_queue` table + `metadataQueue.ts` helper (S)
- [x] Task 2: Last.fm + LRCLIB provider handlers (M)
- [x] Task 3: Unified `queueWorker.ts` + update `hooks.server.ts` (M)
- [x] **Checkpoint A:** Worker live on new table

## Phase 2: Trigger Wiring
- [x] Task 4: Update zip import + shortlist add triggers (S)
- [x] Task 5: Convert analyze-audio endpoints sync → enqueue (S)
- [x] Task 6: `POST /api/songs/[spotifyUri]/enrich` single-song endpoint (S)
- [x] **Checkpoint B:** All triggers wired, analyze-audio non-blocking

## Phase 3: Queue API + Data Layer
- [x] Task 7: Queue status API + fill-gaps + retry endpoints (M)
- [x] Task 8: Extend `prepChecks.ts` with 5 metadata coverage checks (S)
- [x] **Checkpoint C:** Data layer complete, status API verified

## Phase 4: Queue Panel UI
- [x] Task 9: Panel skeleton — scope control, tiles, per-job rows (L)
- [x] Task 10: Round-scope Digest readiness + Coverage matrix + Fill gaps (M)
- [x] Task 11: Failures list + auto-enrich footer + Include audio toggle (S)
- [x] **Checkpoint D:** Panel complete, all interactivity works

## Phase 5: Cleanup
- [x] Task 12: Retire `ytm_resolution_queue` + `ytmQueue.ts` (S)
- [ ] **Checkpoint E:** Final smoke — import zip → drain → panel green
