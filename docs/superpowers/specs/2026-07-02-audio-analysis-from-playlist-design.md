# Audio analysis from a round's Spotify playlist (pre-warm) — design

**Date:** 2026-07-02
**Status:** Approved, **PARKED** (spec captured; implementation deferred — to be resumed).

## Problem

Triggering **Analyze Audio** from the active-round screen during the **voting phase** returns *"no submissions in this round"* and does nothing. Observed on Second Best → "Unsung Heroes" (round id 132: `spotify_playlist_url` **set**, phase not-yet-complete, **0 rows** in `ml_submissions`). The user wants to run audio analysis *before* voting ends.

### Root cause (investigated, confirmed)

`POST /api/rounds/[roundId]/analyze-audio/+server.ts` resolves songs solely from `ml_submissions`:
```ts
const uris = db.prepare('SELECT DISTINCT spotify_uri FROM ml_submissions WHERE round_id = ?').all(roundId)...
if (uris.length === 0) return json({ queued: 0, message: 'no submissions in this round' });
```
The Music League `leagues export` only ships **completed** rounds, so an in-progress (voting) round has **no `ml_submissions` rows yet**. Hence the empty result. This is a data-availability gap, not a code bug.

### Key enabling facts

- **Audio analysis is keyed purely by `spotify_uri`.** `analyzeTrack(spotify_uri)` (`ui/src/lib/sintel.ts`) reconstructs the Spotify URL and runs `uv run sintel analyze <url>` (subprocess, cwd `/home/loydmilligan/Projects/sintel`); results go to `song_audio_features (spotify_uri PK, bpm, key, scale, energy, duration_s, analyzed_at)` — **no round/league foreign key**. So audio can be analyzed for any track and it auto-attaches to the round once the round later imports.
- **The round already stores its playlist URL:** `rounds.spotify_playlist_url` (exposed on the round screen as `data.round.spotifyPlaylistUrl`).
- **Reusable playlist fetch:** `parsePlaylistId(url)` + `getSpotifyToken()` + `fetchPlaylistTracks(playlistId, token)` in `ui/src/lib/spotify.ts` → `{ spotifyUri, title, artist, album }[]` (graceful no-op without creds).
- **Queue enqueue:** `enqueueMany(db, uris, ['audio'])` (`ui/src/lib/metadataQueue.ts`) → worker → `analyzeTrack` → `song_audio_features`. One-at-a-time, retried, visible in the metadata-queue panel.

## Design

**Single change: enhance `POST /api/rounds/[roundId]/analyze-audio/+server.ts`.**

1. **Submissions exist** (completed round) → unchanged: enqueue `['audio']` for the round's submission URIs.
2. **No submissions** → fall back to a playlist:
   - Source the playlist URL from the round's `spotify_playlist_url`, or from an optional `{ playlistUrl }` in the request body (body overrides / supplies when the round has none).
   - `parsePlaylistId` → `getSpotifyToken` → `fetchPlaylistTracks` → track `spotify_uri`s.
   - **Skip URIs already present in `song_audio_features`** (avoid re-running the expensive sintel pass), then `enqueueMany(db, freshUris, ['audio'])`.
   - Return `{ queued, alreadyAnalyzed, source: 'playlist' }` with a message, e.g. *"Queued N tracks from the Spotify playlist — audio results attach when the round imports."*
3. **No submissions and no playlist URL (none stored, none pasted)** → return a clear message: *"Set the round's Spotify playlist URL, or paste one, to analyze audio before submissions import."* (HTTP 200 with `queued: 0`, or 400 — implementer's choice; message is the contract.)
4. **Failure modes:** unparseable playlist URL → 400 with message; missing Spotify creds / fetch failure → message (no throw to the user); empty playlist → `queued: 0` message.

**Storage / linkage:** results land in `song_audio_features` keyed by `spotify_uri` only — **no `ml_submissions` pollution** (deliberately avoids the in-progress→completed re-import duplicate gotcha). When the round later imports for real, the features are already present and the digest + Taste Waveform pick them up automatically.

**UI (`ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`):**
- The existing **Analyze Audio** button (`analyzeAudio` handler ~L113–130, button ~L874–885) works on voting-phase rounds with **no change to the call** — it just surfaces the new message.
- Two small touches: (a) update the button's helper text to note it uses the round's playlist when submissions aren't imported yet; (b) if the endpoint replies "no playlist configured," prompt for a URL (simple input/`prompt()`) and re-POST with `{ playlistUrl }`.

**Execution:** the existing metadata queue (`enqueueMany` → worker → `analyzeTrack` → sintel) — one-at-a-time, retries, queue-panel visibility. No new batch path. (Note: `analyzePlaylist()` exists in `sintel.ts` but is intentionally NOT used — the queue gives retries + visibility.)

## Testing

Unit-test the endpoint (`ui/src/routes/api/rounds/[roundId]/analyze-audio/server.test.ts`), mocking `fetchPlaylistTracks`/`getSpotifyToken`:
- Round **with** submissions → enqueues submission URIs (unchanged behavior).
- Round with **no** submissions + `spotify_playlist_url` set → fetches tracks and enqueues the **fresh** URIs, **skipping** URIs already in `song_audio_features`; response reports `queued`/`alreadyAnalyzed`, `source: 'playlist'`.
- No submissions, no stored URL, `{ playlistUrl }` in body → uses the pasted URL.
- No submissions, no URL anywhere → the "set/paste a playlist URL" message, nothing enqueued.
- Unparseable URL → 400 message.

## Out of scope

- Showing the audio numbers on the round screen **during voting** (user chose "just have them ready" — pre-warm only).
- Any change to the sintel service or the hardcoded `/home/loydmilligan/Projects/sintel` path.
- A standalone "paste any playlist" analyzer decoupled from a round (round-scoped fallback is enough for now).

## Resume notes (for pickup)

- This is a small, single-endpoint feature + minor UI polish + one test file. No schema change. No new dependency.
- The whole thing hinges on `song_audio_features` being `spotify_uri`-keyed (verified) — that's what makes pre-warming safe and auto-attaching.
- Straight to `writing-plans` → build when resumed; no further design questions outstanding.
