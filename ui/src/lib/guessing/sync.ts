import type Database from 'better-sqlite3';
import { buildGuessMatcher, type GuessCandidate } from '../digest/guessResolver.js';
import { eligiblePlayers } from './assignment.js';

export interface SyncSongReport {
  spotifyUri: string;
  storedPlayerId: number | null;
  postedPlayerId: number | null;
  storedComment: string;
  postedComment: string | null;
  agrees: boolean;
}

export interface SyncReport {
  state: 'unverified' | 'ok' | 'mismatch';
  songs: SyncSongReport[];
}

/**
 * Spec §2: the posted Music League comment is canonical. Once the round's votes
 * import, re-derive the guess from the owner's own posted comment with the same
 * matcher The Guesser uses, and compare it to what we stored.
 *
 * Advisory only. A disagreement is surfaced as a sync error for a human to
 * resolve; nothing is silently rewritten in either direction.
 */
export function verifyRoundSync(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
  now: string,
): SyncReport {
  const pool = eligiblePlayers(db, roundId, mePlayerId);
  const candidates: GuessCandidate[] =
    pool.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id AS playerId, name AS label FROM competitors
              WHERE id IN (${pool.map(() => '?').join(',')})`,
          )
          .all(...pool) as GuessCandidate[]);
  const match = buildGuessMatcher(candidates);

  const rows = db.prepare(
    `SELECT gp.spotify_uri          AS uri,
            gp.final_pick_player_id AS stored,
            gp.comment              AS storedComment,
            v.comment               AS postedComment
       FROM guess_picks gp
       LEFT JOIN votes v
              ON v.round_id = gp.round_id
             AND v.spotify_uri = gp.spotify_uri
             AND v.voter_id = ?
      WHERE gp.round_id = ?
      ORDER BY gp.spotify_uri`,
  ).all(mePlayerId, roundId) as {
    uri: string; stored: number | null; storedComment: string; postedComment: string | null;
  }[];

  const songs: SyncSongReport[] = rows.map((r) => {
    const postedPlayerId = r.postedComment ? match(r.postedComment) : null;
    return {
      spotifyUri: r.uri,
      storedPlayerId: r.stored,
      postedPlayerId,
      storedComment: r.storedComment,
      postedComment: r.postedComment,
      agrees: postedPlayerId !== null && postedPlayerId === r.stored,
    };
  });

  const anyPosted = songs.some((s) => s.postedComment !== null);
  const state: SyncReport['state'] = !anyPosted
    ? 'unverified'
    : songs.filter((s) => s.postedComment !== null).every((s) => s.agrees)
      ? 'ok'
      : 'mismatch';

  db.prepare(
    `INSERT INTO guess_round_state (round_id, sync_state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(round_id) DO UPDATE SET sync_state = excluded.sync_state, updated_at = excluded.updated_at`,
  ).run(roundId, state, now);

  return { state, songs };
}
