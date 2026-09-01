import type Database from 'better-sqlite3';

export interface VisibleSubmission {
  spotifyUri: string;
  title: string;
  artists: string;
  /** null when the submitter's comment was NOT visible to voters that round. */
  comment: string | null;
}

/**
 * The round's songs as a voter saw them (spec §14.3).
 *
 * The `visible_to_voters` filter is load-bearing, not a nicety: on Boarz R148 and
 * R149 only 5 of 10 comments were visible during voting. Returning all ten would
 * make a rehearsal easier than the real round was and inflate the score.
 *
 * §14.5: no CLI fetch is needed — the comments are already here.
 *
 * This module is NOT on the §5 anonymity allowlist and must never select
 * competitor_id. The shape returned deliberately has no identity field.
 */
export function visibleSubmissions(db: Database.Database, roundId: number): VisibleSubmission[] {
  return db.prepare(
    `SELECT spotify_uri AS spotifyUri,
            title,
            artists,
            CASE WHEN visible_to_voters = 1 THEN comment ELSE NULL END AS comment
       FROM ml_submissions
      WHERE round_id = ?
      ORDER BY id`,
  ).all(roundId) as VisibleSubmission[];
}
