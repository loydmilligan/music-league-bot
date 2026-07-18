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
import { hasBeenSent } from './sendLog.js';

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
          AND ((r.voting_deadline IS NOT NULL AND r.voting_deadline <= ?) OR r.voting_ended_at IS NOT NULL)
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

  // The digest body is LLM-written prose about real people's songs and votes.
  // finalized_at is the existing signal that a human read it and pressed the
  // button, so it is the readiness gate: no finalized draft, no post. An absent
  // draft is deliberately a hold rather than an auto-generate — nothing goes to
  // a group that nobody has looked at.
  const draft = db
    .prepare('SELECT finalized_at FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1')
    .get(round.id) as { finalized_at: string | null } | undefined;

  if (!draft) {
    return { action: 'hold', roundId: round.id, reason: 'no digest has been generated for this round' };
  }
  if (!draft.finalized_at) {
    return { action: 'hold', roundId: round.id, reason: 'digest has not been finalized' };
  }

  return {
    action: 'send',
    roundId: round.id,
    reason: 'voting closed, digest finalized, and the round has a successor',
  };
}

export interface ScheduleEntry {
  leagueId: number;
  leagueSlug: string;
  action: ScheduleDecision['action'];
  roundId: number;
  roundName: string;
  reason: string;
}

/**
 * What the auto-poster should do for every league, right now.
 *
 * Already-sent rounds are reported as `none` so the schedule reads honestly.
 * That is reporting, not the duplicate guard — the guard is the atomic claim in
 * sendLog. A round that is claimed but not yet confirmed still reads as `send`;
 * the claim will refuse it.
 */
export function buildSchedule(db: Database.Database, nowIso: string): ScheduleEntry[] {
  const leagues = db.prepare('SELECT id, slug FROM leagues ORDER BY slug').all() as {
    id: number;
    slug: string;
  }[];

  return leagues.map((league) => {
    const decision = resolveScheduledDigest(db, league.id, nowIso);
    const roundId = 'roundId' in decision ? decision.roundId : 0;

    if (decision.action === 'send' && hasBeenSent(db, roundId)) {
      return {
        leagueId: league.id,
        leagueSlug: league.slug,
        action: 'none' as const,
        roundId,
        roundName: roundName(db, roundId),
        reason: 'digest for this round was already sent',
      };
    }

    return {
      leagueId: league.id,
      leagueSlug: league.slug,
      action: decision.action,
      roundId,
      roundName: roundId ? roundName(db, roundId) : '',
      reason: decision.reason,
    };
  });
}

function roundName(db: Database.Database, roundId: number): string {
  const row = db.prepare('SELECT name FROM rounds WHERE id = ?').get(roundId) as
    | { name: string }
    | undefined;
  return row?.name ?? '';
}
