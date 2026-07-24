import type Database from 'better-sqlite3';

/** One song as returned by the musicleague CLI for the open round. */
export interface CliSong {
  spotifyUri: string;
  title: string;
  artist: string;
  albumArtUrl: string | null;
}

/**
 * Upsert the live round's playlist into ml_submissions.
 *
 * Submitters are deliberately left NULL: during the voting phase Music League
 * hides who submitted what, and the lab must never learn it.
 * Idempotent — re-syncing an already-synced round inserts nothing.
 */
export function syncRoundSongs(
  db: Database.Database,
  roundId: number,
  songs: CliSong[],
): { inserted: number; skipped: number } {
  const existing = new Set(
    (db.prepare(`SELECT spotify_uri FROM ml_submissions WHERE round_id = ?`)
      .all(roundId) as { spotify_uri: string }[]).map((r) => r.spotify_uri),
  );

  // created_at is NOT NULL with no schema default (see ml_submissions in
  // schema.ts) — every writer must supply it explicitly.
  const insert = db.prepare(
    `INSERT INTO ml_submissions
       (round_id, competitor_id, spotify_uri, title, artists, album_art_url, visible_to_voters, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, 1, ?)`,
  );

  let inserted = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    const now = new Date().toISOString();
    for (const s of songs) {
      if (existing.has(s.spotifyUri)) { skipped++; continue; }
      insert.run(roundId, s.spotifyUri, s.title, s.artist, s.albumArtUrl, now);
      inserted++;
    }
  });
  run();
  return { inserted, skipped };
}
