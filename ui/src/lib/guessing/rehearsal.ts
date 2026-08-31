/**
 * Rehearsal mode (spec §14): replay a completed round as if it were live.
 *
 * Anonymity note: startRehearsal reads ml_submissions.spotify_uri only, never
 * competitor_id — pre-seeding is_mine from the answer key would both break the
 * feature's honesty (§14.4) and trip the anonymity guard (scoring.test.ts).
 * archiveRehearsal reads only guess_* tables and never touches ml_submissions.
 */
import type Database from 'better-sqlite3';

export interface RehearsalArchive {
  roundId: number;
  asOf: string | null;
  archivedAt: string;
  state: unknown;
  picks: unknown[];
  candidates: unknown[];
  aiDistribution: unknown[];
  aiSong: unknown[];
}

/**
 * The horizon: rounds in the SAME LEAGUE as `roundId` whose voting_deadline is
 * strictly earlier than this round's, ascending. A league spans several
 * seasons, so scope by league via rounds → seasons, not by season directly.
 * NULL-deadline rounds (some zip imports have none) are excluded, and the
 * round itself is never included.
 */
export function priorRoundIds(db: Database.Database, roundId: number): number[] {
  return (
    db.prepare(
      `SELECT r2.id AS id
         FROM rounds r2
         JOIN seasons s2 ON s2.id = r2.season_id
        WHERE s2.league_id = (
                SELECT s.league_id FROM rounds r JOIN seasons s ON s.id = r.season_id WHERE r.id = ?)
          AND r2.id <> ?
          AND r2.voting_deadline IS NOT NULL
          AND r2.voting_deadline < (SELECT voting_deadline FROM rounds WHERE id = ?)
        ORDER BY r2.voting_deadline ASC`,
    ).all(roundId, roundId, roundId) as { id: number }[]
  ).map((r) => r.id);
}

/**
 * Put a round into rehearsal mode at the given effective "now". Idempotent:
 * a second call updates mode/as_of but never touches an already-marked
 * voting_lab_ballot row (INSERT OR IGNORE, never an UPDATE) — that would
 * silently wipe a mark Matt already made.
 *
 * Per spec §14.4: does NOT read competitor_id to pre-seed is_mine. Ballot rows
 * are created with is_mine = 0 only so there is something to toggle; rounds
 * 148 and 149 have no voting_lab_ballot rows at all.
 */
export function startRehearsal(db: Database.Database, roundId: number, asOf: string): void {
  db.prepare(
    `INSERT INTO guess_round_state (round_id, mode, as_of, updated_at)
     VALUES (?, 'rehearsal', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(round_id) DO UPDATE
       SET mode = 'rehearsal', as_of = excluded.as_of, updated_at = excluded.updated_at`,
  ).run(roundId, asOf);

  const songs = db.prepare(
    `SELECT spotify_uri FROM ml_submissions WHERE round_id = ?`,
  ).all(roundId) as { spotify_uri: string }[];

  const ins = db.prepare(
    `INSERT OR IGNORE INTO voting_lab_ballot (round_id, spotify_uri, is_mine, updated_at)
     VALUES (?, ?, 0, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  );
  for (const s of songs) ins.run(roundId, s.spotify_uri);
}

/**
 * Archive a rehearsal: serialize every guess_* row for the round plus its
 * guess_round_state row, then delete all five inside one transaction. The
 * round returns to having no guessing data at all — a rehearsal score can
 * never pool with a live score because the rows no longer exist. Writing the
 * returned archive to data/rehearsals/ is the caller's job.
 */
export function archiveRehearsal(db: Database.Database, roundId: number): RehearsalArchive {
  const state = db.prepare('SELECT * FROM guess_round_state WHERE round_id = ?').get(roundId) as
    { as_of: string | null } | undefined;
  const picks = db.prepare('SELECT * FROM guess_picks WHERE round_id = ?').all(roundId);
  const candidates = db.prepare('SELECT * FROM guess_candidates WHERE round_id = ?').all(roundId);
  const aiDistribution = db.prepare('SELECT * FROM guess_ai_distribution WHERE round_id = ?').all(roundId);
  const aiSong = db.prepare('SELECT * FROM guess_ai_song WHERE round_id = ?').all(roundId);

  const archive: RehearsalArchive = {
    roundId,
    asOf: state?.as_of ?? null,
    archivedAt: new Date().toISOString(),
    state: state ?? null,
    picks,
    candidates,
    aiDistribution,
    aiSong,
  };

  db.transaction(() => {
    db.prepare('DELETE FROM guess_picks WHERE round_id = ?').run(roundId);
    db.prepare('DELETE FROM guess_candidates WHERE round_id = ?').run(roundId);
    db.prepare('DELETE FROM guess_ai_distribution WHERE round_id = ?').run(roundId);
    db.prepare('DELETE FROM guess_ai_song WHERE round_id = ?').run(roundId);
    db.prepare('DELETE FROM guess_round_state WHERE round_id = ?').run(roundId);
  })();

  return archive;
}
