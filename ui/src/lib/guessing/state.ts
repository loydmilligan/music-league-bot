import type Database from 'better-sqlite3';

export type GuessPhase = 'gut' | 'fetch' | 'ai' | 'refine' | 'vote' | 'output' | 'done';
export type SyncState = 'unverified' | 'ok' | 'mismatch';
export type RehearsalMode = 'live' | 'rehearsal';

export interface RoundState {
  roundId: number;
  phase: GuessPhase;
  gutLockedAt: string | null;
  slateLockedAt: string | null;
  votesLockedAt: string | null;
  submittedAt: string | null;
  commentsFetchedAt: string | null;
  syncState: SyncState;
  mode: RehearsalMode;
  asOf: string | null;
}

interface StateRow {
  round_id: number; phase: GuessPhase;
  gut_locked_at: string | null; slate_locked_at: string | null;
  votes_locked_at: string | null; submitted_at: string | null;
  comments_fetched_at: string | null; sync_state: SyncState;
  mode: RehearsalMode; as_of: string | null;
}

/** Reads the round's state, creating the default row the first time. */
export function getRoundState(db: Database.Database, roundId: number): RoundState {
  db.prepare(
    `INSERT OR IGNORE INTO guess_round_state (round_id, updated_at)
     VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  ).run(roundId);
  const r = db.prepare('SELECT * FROM guess_round_state WHERE round_id = ?').get(roundId) as StateRow;
  return {
    roundId: r.round_id,
    phase: r.phase,
    gutLockedAt: r.gut_locked_at,
    slateLockedAt: r.slate_locked_at,
    votesLockedAt: r.votes_locked_at,
    submittedAt: r.submitted_at,
    commentsFetchedAt: r.comments_fetched_at,
    syncState: r.sync_state,
    mode: r.mode,
    asOf: r.as_of,
  };
}

/**
 * Set the first-instinct pick for one song. Throws once the round's gut slate is
 * locked — the whole value of the gut baseline is that it cannot be revised after
 * the AI has spoken.
 */
export function setGutPick(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
  playerId: number,
): void {
  if (getRoundState(db, roundId).gutLockedAt !== null) {
    throw new Error(`gut slate for round ${roundId} is locked; gut picks are immutable`);
  }
  db.prepare(
    `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(round_id, spotify_uri)
       DO UPDATE SET gut_pick_player_id = excluded.gut_pick_player_id,
                     updated_at = excluded.updated_at`,
  ).run(roundId, spotifyUri, playerId);
}

/** Freeze the gut slate and move to the comment-fetch phase. Idempotent. */
export function lockGut(db: Database.Database, roundId: number, now: string): void {
  getRoundState(db, roundId);
  db.prepare(
    `UPDATE guess_round_state
        SET gut_locked_at = COALESCE(gut_locked_at, ?), phase = 'fetch', updated_at = ?
      WHERE round_id = ?`,
  ).run(now, now, roundId);
}
