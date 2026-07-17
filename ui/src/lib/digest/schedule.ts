/**
 * Which round, if any, the scheduled digest should post — and when it must not.
 *
 * Three outcomes, not two. `hold` is the interesting one: the system knows it
 * could produce a digest and deliberately declines, leaving it for a human.
 *
 * Deliberate non-uses:
 *  - `seasons.status` is not consulted. It is provably wrong in live data
 *    (second-best S1: all 10 rounds complete, status still 'active') — that's
 *    roadmap B1. Season-final is derived structurally instead.
 *  - `runPrepChecks` is not reused. It is a human-facing advisory checklist and
 *    its "Votes" check passes on votes_count > 0, which is true mid-voting. A
 *    checklist a person reads and a gate a robot obeys are different jobs.
 */
import type Database from 'better-sqlite3';
import { getNextRound } from '$lib/db/nextRound.js';

export type ScheduleDecision =
  | { action: 'send'; roundId: number; reason: string }
  | { action: 'hold'; roundId: number; reason: string }
  | { action: 'none'; reason: string };

interface CandidateRow {
  id: number;
  description: string | null;
}

/**
 * The most recently completed round in a league: voting closed, latest first.
 * Ordering mirrors getNextRound (season_number, then round id) so "latest" means
 * the same thing in both places.
 */
function latestCompletedRound(
  db: Database.Database,
  leagueId: number,
  nowIso: string,
): CandidateRow | undefined {
  return db
    .prepare(
      `SELECT r.id, r.description
         FROM rounds r
         JOIN seasons s ON s.id = r.season_id
        WHERE s.league_id = ?
          AND r.voting_deadline IS NOT NULL
          AND r.voting_deadline <= ?
        ORDER BY s.season_number DESC, r.id DESC
        LIMIT 1`,
    )
    .get(leagueId, nowIso) as CandidateRow | undefined;
}

export function resolveScheduledDigest(
  db: Database.Database,
  leagueId: number,
  nowIso: string,
): ScheduleDecision {
  const round = latestCompletedRound(db, leagueId, nowIso);
  if (!round) {
    return { action: 'none', reason: 'no round in this league has finished voting' };
  }

  // Season-final: no later round exists, so the next-round teaser renders empty
  // and the round wants a hand-worked season recap. Both make this a human's job.
  // Tied to getNextRound deliberately — "would the teaser be empty" IS the rule.
  if (getNextRound(db, round.id) === null) {
    return {
      action: 'hold',
      roundId: round.id,
      reason: 'season-final round — needs a hand-worked recap, and the next-round teaser would be empty',
    };
  }

  const subs = (
    db.prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?').get(round.id) as {
      n: number;
    }
  ).n;
  if (subs === 0) {
    return { action: 'hold', roundId: round.id, reason: 'round has no submissions' };
  }

  const votes = (
    db.prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?').get(round.id) as { n: number }
  ).n;
  if (votes === 0) {
    return { action: 'hold', roundId: round.id, reason: 'voting closed but no votes were recorded' };
  }

  if (!round.description?.trim()) {
    return { action: 'hold', roundId: round.id, reason: 'round has no theme description' };
  }

  return { action: 'send', roundId: round.id, reason: 'voting closed, round is complete and has a successor' };
}
