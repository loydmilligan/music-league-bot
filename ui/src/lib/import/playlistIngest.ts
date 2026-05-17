import type Database from 'better-sqlite3';
import { getDb } from '../db/client.js';
import { fetchPlaylistTracks, getSpotifyToken, parsePlaylistId, type PlaylistTrack } from '../spotify.js';

export interface IngestResult { inserted: number; skipped: number; }

/**
 * Fetch a Spotify playlist's tracks and insert them as anonymous ml_submissions
 * rows (competitor_id NULL) for the given round. Idempotent on
 * (round_id, spotify_uri) via the partial unique index added in sprint-5.
 *
 * No-ops with a logged warning if SPOTIFY_CLIENT_ID is missing — fire-and-forget
 * callers don't need to handle the auth case.
 *
 * The `tracksProvider` injection point lets vitest swap in a fixture without
 * mocking global fetch.
 */
export async function ingestPlaylist(
  roundId: number,
  playlistUrl: string,
  opts: {
    db?: Database.Database;
    tracksProvider?: (playlistId: string) => Promise<PlaylistTrack[]>;
  } = {},
): Promise<IngestResult> {
  const playlistId = parsePlaylistId(playlistUrl);
  if (!playlistId) {
    console.warn('[playlistIngest] could not parse playlist id from', playlistUrl);
    return { inserted: 0, skipped: 0 };
  }

  const db = opts.db ?? getDb();

  let tracks: PlaylistTrack[];
  if (opts.tracksProvider) {
    tracks = await opts.tracksProvider(playlistId);
  } else {
    const token = await getSpotifyToken();
    if (!token) {
      console.warn('[playlistIngest] SPOTIFY_CLIENT_ID/SECRET not configured — skipping ingest');
      return { inserted: 0, skipped: 0 };
    }
    try {
      tracks = await fetchPlaylistTracks(playlistId, token);
    } catch (e) {
      console.warn('[playlistIngest] Spotify fetch failed:', e instanceof Error ? e.message : e);
      return { inserted: 0, skipped: 0 };
    }
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO ml_submissions
      (round_id, competitor_id, spotify_uri, title, album, artists, comment, created_at, visible_to_voters)
    VALUES (?, NULL, ?, ?, ?, ?, NULL, ?, 1)
  `);
  const now = new Date().toISOString();
  let inserted = 0;
  let skipped = 0;
  const tx = db.transaction((rows: PlaylistTrack[]) => {
    for (const t of rows) {
      const info = stmt.run(roundId, t.spotifyUri, t.title, t.album, t.artist, now);
      if (info.changes > 0) inserted++; else skipped++;
    }
  });
  tx(tracks);
  return { inserted, skipped };
}
