import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface CascadeAddInput {
  roundId: number;
  spotifyUri: string;
  title: string;
  artist: string;
  album?: string | null;
  notes?: string;
  ratings?: {
    discoveryPotential?: number;
    themeFit?: number;
    quality?: number;
    replayability?: number;
  };
}

export interface CascadeAddResult {
  shortlistSongId: string;
  researchSongId: number;
}

// Adds a song to the round's active research list AND ensures it exists on
// the (append-only, never-really-removed) global shortlist — the MCP
// server's add_song_to_round tool needs this in one atomic call rather than
// composing POST /api/shortlist + POST /api/shortlist/:id/assign/:roundId,
// which takes 2 round-trips and doesn't carry notes/ratings on the research
// row in the same step.
export function addSongToRoundWithShortlistCascade(db: Database.Database, input: CascadeAddInput): CascadeAddResult {
  const tx = db.transaction((i: CascadeAddInput): CascadeAddResult => {
    let shortlistRow = db
      .prepare('SELECT id FROM shortlist_songs WHERE spotify_uri = ?')
      .get(i.spotifyUri) as { id: string } | undefined;

    let shortlistSongId: string;
    if (shortlistRow) {
      shortlistSongId = shortlistRow.id;
    } else {
      shortlistSongId = randomUUID();
      db.prepare(
        `INSERT INTO shortlist_songs (id, spotify_uri, title, artist, album, added_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(shortlistSongId, i.spotifyUri, i.title, i.artist, i.album ?? null, new Date().toISOString());
    }

    db.prepare(
      `INSERT OR IGNORE INTO shortlist_assignments (shortlist_song_id, round_id) VALUES (?, ?)`,
    ).run(shortlistSongId, i.roundId);

    let researchRow = db
      .prepare('SELECT id FROM research_songs WHERE round_id = ? AND spotify_uri = ?')
      .get(i.roundId, i.spotifyUri) as { id: number } | undefined;

    if (!researchRow) {
      db.prepare(
        `INSERT INTO research_songs (round_id, spotify_uri, title, artist, album, added_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(i.roundId, i.spotifyUri, i.title, i.artist, i.album ?? null, new Date().toISOString());
      researchRow = db
        .prepare('SELECT id FROM research_songs WHERE round_id = ? AND spotify_uri = ?')
        .get(i.roundId, i.spotifyUri) as { id: number };
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    if (i.notes !== undefined) { sets.push('notes = ?'); vals.push(i.notes); }
    if (i.ratings?.discoveryPotential !== undefined) { sets.push('discovery_potential = ?'); vals.push(i.ratings.discoveryPotential); }
    if (i.ratings?.themeFit !== undefined) { sets.push('theme_fit = ?'); vals.push(i.ratings.themeFit); }
    if (i.ratings?.quality !== undefined) { sets.push('quality = ?'); vals.push(i.ratings.quality); }
    if (i.ratings?.replayability !== undefined) { sets.push('replayability = ?'); vals.push(i.ratings.replayability); }
    if (sets.length) {
      vals.push(researchRow.id);
      db.prepare(`UPDATE research_songs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }

    return { shortlistSongId, researchSongId: researchRow.id };
  });

  return tx(input);
}
