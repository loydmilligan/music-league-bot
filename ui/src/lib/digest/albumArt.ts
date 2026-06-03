import type Database from 'better-sqlite3';
import { fetchTracks } from '$lib/spotify/client.js';

// sprint-15 podium-thumbnails: per-song album art for a round's submissions.
// Album art isn't carried in the Music League export, so we resolve it once
// from Spotify (client_credentials) and cache it on ml_submissions.album_art_url.
// Best-effort: callers run this before generation but tolerate failure (no
// Spotify creds, API error) — the podium just falls back to the vinyl glyph.

interface MissingRow {
  id: number;
  spotify_uri: string;
}

/**
 * Resolve + persist album art for any of the round's submissions missing it.
 * Returns the number of rows newly populated. Throws only on a hard Spotify
 * failure — callers should wrap in try/catch to keep generation resilient.
 */
export async function ensureAlbumArt(db: Database.Database, roundId: number): Promise<number> {
  const rows = db
    .prepare(
      `SELECT id, spotify_uri FROM ml_submissions
       WHERE round_id = ? AND album_art_url IS NULL AND spotify_uri LIKE 'spotify:track:%'`,
    )
    .all(roundId) as MissingRow[];
  if (!rows.length) return 0;

  const ids = rows.map((r) => r.spotify_uri.split(':').pop()!).filter(Boolean);
  const tracks = await fetchTracks(ids);
  const artByUri = new Map(tracks.map((t) => [t.uri, t.albumArtUrl]));

  const upd = db.prepare('UPDATE ml_submissions SET album_art_url = ? WHERE id = ?');
  let n = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const art = artByUri.get(r.spotify_uri) ?? null;
      if (art) {
        upd.run(art, r.id);
        n++;
      }
    }
  });
  tx();
  return n;
}
