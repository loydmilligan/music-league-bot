import type Database from 'better-sqlite3';
import { addShortlistSong, assignToRound } from '../shortlist/shortlist.js';

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
    // Use helper functions to find-or-create shortlist_songs and assign to round
    const shortlistSong = addShortlistSong(db, {
      spotifyUri: i.spotifyUri,
      title: i.title,
      artist: i.artist,
      album: i.album,
    });

    assignToRound(db, shortlistSong.id, i.roundId);

    // Get the research_song row that was created by assignToRound
    const researchRow = db
      .prepare('SELECT id FROM research_songs WHERE round_id = ? AND spotify_uri = ?')
      .get(i.roundId, i.spotifyUri) as { id: number };

    // Apply notes and ratings to the research_songs row. Also unconditionally
    // clear any soft-removal state: adding a song to a round's active list
    // should always make it active, regardless of whether it was previously
    // soft-removed by a user action or an H2H loss (removal is otherwise a
    // silent no-op via assignToRound's INSERT OR IGNORE).
    const sets: string[] = ['removed_reason = NULL', 'removed_by_song_id = NULL', 'removed_at = NULL'];
    const vals: unknown[] = [];
    if (i.notes !== undefined) { sets.push('notes = ?'); vals.push(i.notes); }
    if (i.ratings?.discoveryPotential !== undefined) { sets.push('discovery_potential = ?'); vals.push(i.ratings.discoveryPotential); }
    if (i.ratings?.themeFit !== undefined) { sets.push('theme_fit = ?'); vals.push(i.ratings.themeFit); }
    if (i.ratings?.quality !== undefined) { sets.push('quality = ?'); vals.push(i.ratings.quality); }
    if (i.ratings?.replayability !== undefined) { sets.push('replayability = ?'); vals.push(i.ratings.replayability); }
    vals.push(researchRow.id);
    db.prepare(`UPDATE research_songs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    return { shortlistSongId: shortlistSong.id, researchSongId: researchRow.id };
  });

  return tx(input);
}
