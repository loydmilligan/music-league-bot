import type Database from 'better-sqlite3';
import { priorRoundIds } from './rehearsal.js';

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

export interface PriorVote {
  roundId: number;
  voterId: number;
  spotifyUri: string;
  points: number;
  comment: string | null;
}

/**
 * Votes from rounds that had already closed before the round under study.
 *
 * SPEC §14.3 TRAP: the round's own votes are excluded **by round id, never by
 * timestamp**. Every vote on a round is cast BEFORE that round's voting deadline,
 * so a `created_at < asOf` clamp would leak the entire round — which is the answer
 * in all but name. `priorRoundIds` already excludes the round itself, rounds that
 * close later, and rounds with a NULL deadline.
 */
export function priorVotes(db: Database.Database, roundId: number): PriorVote[] {
  const ids = priorRoundIds(db, roundId);
  if (ids.length === 0) return [];
  return db.prepare(
    `SELECT round_id AS roundId, voter_id AS voterId, spotify_uri AS spotifyUri,
            points, comment
       FROM votes
      WHERE round_id IN (${ids.map(() => '?').join(',')})
      ORDER BY round_id, id`,
  ).all(...ids) as PriorVote[];
}

export interface ChatLine {
  sender: string;
  text: string;
  ts: string;
}

/**
 * Group chat strictly before `cutoff`, oldest first.
 *
 * Chat IS clamped by timestamp — unlike votes, a message's own timestamp is
 * exactly when it became knowable, so the naive comparison is the correct one here.
 *
 * `chat_messages` is created by the bot side (src/) and is absent from the UI's
 * SCHEMA constant, so it may legitimately not exist in a test database. Returning
 * empty is correct in that case: no chat evidence, not an error.
 */
export function chatBefore(
  db: Database.Database,
  groupName: string,
  cutoff: string,
): ChatLine[] {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'")
    .get();
  if (!exists) return [];

  return db.prepare(
    `SELECT sender, text, ts
       FROM chat_messages
      WHERE group_name = ? AND ts < ?
      ORDER BY ts`,
  ).all(groupName, cutoff) as ChatLine[];
}
