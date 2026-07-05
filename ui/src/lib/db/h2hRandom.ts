import type Database from 'better-sqlite3';
import { recordH2HMatch } from './headToHead.js';

export interface ActiveResearchSong {
  id: number;
  spotifyUri: string;
  title: string;
  artist: string;
}

export interface PendingMatchup {
  songAId: number;
  songBId: number;
}

export interface SelectWinnerResult {
  songAId: number;
  songBId: number | null; // null when no challenger remains — tournament complete
}

// Active = still in the round's list, independent of the existing `status`
// column king-of-the-hill uses (see headToHead.ts's ELIGIBLE_STATUS gate).
// A song could be status='reviewing' (eligible for king-of-the-hill) while
// removed_reason='h2h_loss' (excluded here) — the two modes gate the same
// table independently by design; they share only the underlying pool and
// head_to_head_matches history.
export function getActiveResearchSongs(db: Database.Database, roundId: number): ActiveResearchSong[] {
  return db
    .prepare(
      `SELECT id, spotify_uri AS spotifyUri, title, artist
       FROM research_songs WHERE round_id = ? AND removed_reason IS NULL`,
    )
    .all(roundId) as ActiveResearchSong[];
}

export function getPendingMatchup(db: Database.Database, roundId: number): PendingMatchup | null {
  const row = db
    .prepare('SELECT song_a_id AS songAId, song_b_id AS songBId FROM h2h_pending_matchup WHERE round_id = ?')
    .get(roundId) as PendingMatchup | undefined;
  return row ?? null;
}

function pickTwoDistinct(pool: ActiveResearchSong[], excludeIds: number[] = []): [ActiveResearchSong, ActiveResearchSong] {
  const eligible = pool.filter((s) => !excludeIds.includes(s.id));
  if (eligible.length < 2) throw new Error('not enough active songs in the round to start a matchup');
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

function setPendingMatchup(db: Database.Database, roundId: number, songAId: number, songBId: number): void {
  db.prepare(
    `INSERT INTO h2h_pending_matchup (round_id, song_a_id, song_b_id, mode, created_at)
     VALUES (?, ?, ?, 'random', ?)
     ON CONFLICT(round_id) DO UPDATE SET song_a_id = excluded.song_a_id, song_b_id = excluded.song_b_id, created_at = excluded.created_at`,
  ).run(roundId, songAId, songBId, new Date().toISOString());
}

export function startRandomMatchup(db: Database.Database, roundId: number): PendingMatchup {
  const pool = getActiveResearchSongs(db, roundId);
  const [a, b] = pickTwoDistinct(pool);
  setPendingMatchup(db, roundId, a.id, b.id);
  return { songAId: a.id, songBId: b.id };
}

export function reshuffleRandomMatchup(db: Database.Database, roundId: number): PendingMatchup {
  const current = getPendingMatchup(db, roundId);
  const pool = getActiveResearchSongs(db, roundId);
  const [a, b] = pickTwoDistinct(pool, current ? [current.songAId, current.songBId] : []);
  setPendingMatchup(db, roundId, a.id, b.id);
  return { songAId: a.id, songBId: b.id };
}

export function selectH2HWinner(db: Database.Database, roundId: number, winnerSongId: number): SelectWinnerResult {
  const pending = getPendingMatchup(db, roundId);
  if (!pending) throw new Error('no pending matchup for this round');
  if (winnerSongId !== pending.songAId && winnerSongId !== pending.songBId) {
    throw new Error('winnerSongId is not part of the current matchup');
  }
  const loserSongId = winnerSongId === pending.songAId ? pending.songBId : pending.songAId;

  recordH2HMatch(db, roundId, winnerSongId, loserSongId);
  db.prepare(
    `UPDATE research_songs SET removed_reason = 'h2h_loss', removed_by_song_id = ?, removed_at = ? WHERE id = ?`,
  ).run(winnerSongId, new Date().toISOString(), loserSongId);

  const pool = getActiveResearchSongs(db, roundId);
  const remaining = pool.filter((s) => s.id !== winnerSongId);
  if (!remaining.length) {
    db.prepare('DELETE FROM h2h_pending_matchup WHERE round_id = ?').run(roundId);
    return { songAId: winnerSongId, songBId: null };
  }
  const challenger = remaining[Math.floor(Math.random() * remaining.length)];
  setPendingMatchup(db, roundId, winnerSongId, challenger.id);
  return { songAId: winnerSongId, songBId: challenger.id };
}
