import type Database from 'better-sqlite3';
import { eligiblePlayers } from './assignment.js';

export type CandidateStatus = 'possible' | 'prime' | 'locked';
/** free = untouched · dimmed = prime somewhere (advisory) · taken = locked somewhere (hard) */
export type Availability = 'free' | 'dimmed' | 'taken';

export interface Candidate {
  playerId: number;
  status: CandidateStatus;
  certainty: number | null;
  factors: string;
  notes: string;
}

export interface CandidatePatch {
  status?: CandidateStatus;
  certainty?: number | null;
  factors?: string;
  notes?: string;
}

/** Upsert one candidate row, patching only the supplied fields. */
export function setCandidate(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
  playerId: number,
  patch: CandidatePatch,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO guess_candidates (round_id, spotify_uri, player_id, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  ).run(roundId, spotifyUri, playerId);

  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status); }
  if (patch.certainty !== undefined) { sets.push('certainty = ?'); args.push(patch.certainty); }
  if (patch.factors !== undefined) { sets.push('factors = ?'); args.push(patch.factors); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); args.push(patch.notes); }
  if (sets.length === 0) return;

  sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
  args.push(roundId, spotifyUri, playerId);
  db.prepare(
    `UPDATE guess_candidates SET ${sets.join(', ')}
      WHERE round_id = ? AND spotify_uri = ? AND player_id = ?`,
  ).run(...args);
}

export function removeCandidate(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
  playerId: number,
): void {
  db.prepare(
    'DELETE FROM guess_candidates WHERE round_id = ? AND spotify_uri = ? AND player_id = ?',
  ).run(roundId, spotifyUri, playerId);
}

export function candidatesForSong(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
): Candidate[] {
  return (
    db.prepare(
      `SELECT player_id AS playerId, status, certainty, factors, notes
         FROM guess_candidates
        WHERE round_id = ? AND spotify_uri = ?
        ORDER BY player_id`,
    ).all(roundId, spotifyUri) as Candidate[]
  );
}

/**
 * Grid-wide availability, the input to the sudoku dimming. A player locked on any
 * song is 'taken' everywhere; prime-but-not-locked is 'dimmed'. Locked outranks
 * prime, so a player who is prime on one song and locked on another reads taken.
 */
export function playerAvailability(
  db: Database.Database,
  roundId: number,
  mePlayerId: number,
): Map<number, Availability> {
  const out = new Map<number, Availability>();
  for (const pid of eligiblePlayers(db, roundId, mePlayerId)) out.set(pid, 'free');

  const rows = db.prepare(
    `SELECT player_id AS pid, status FROM guess_candidates
      WHERE round_id = ? AND status IN ('prime','locked')`,
  ).all(roundId) as { pid: number; status: 'prime' | 'locked' }[];

  for (const r of rows) {
    if (r.status === 'locked') out.set(r.pid, 'taken');
    else if (out.get(r.pid) !== 'taken') out.set(r.pid, 'dimmed');
  }
  return out;
}
