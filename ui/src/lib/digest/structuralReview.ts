import type Database from 'better-sqlite3';
import { getNextRound } from '$lib/db/nextRound.js';

/**
 * Why a completed round must go to a human before it can be sent — mirrors the
 * structural holds in `resolveScheduledDigest` (schedule.ts), MINUS the draft /
 * finalized gates (those are the approval mechanism, not review triggers).
 * Returns the reason string, or null if the round is structurally sendable.
 */
export function structuralReviewReason(
  db: Database.Database,
  roundId: number,
  _nowIso: string,
): string | null {
  const round = db.prepare('SELECT id, description FROM rounds WHERE id = ?').get(roundId) as
    | { id: number; description: string | null }
    | undefined;
  if (!round) return 'round not found';

  // Season-final: no later round → the next-round teaser renders empty and the
  // round wants a hand-worked recap. Tied to getNextRound exactly like the resolver.
  if (getNextRound(db, roundId) === null) {
    return 'season-final round — needs a hand-worked recap, and the next-round teaser would be empty';
  }

  const subs = (db.prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?').get(roundId) as { n: number }).n;
  if (subs === 0) return 'round has no submissions';

  const votes = (db.prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?').get(roundId) as { n: number }).n;
  if (votes === 0) return 'voting closed but no votes were recorded';

  if (!round.description?.trim()) return 'round has no theme description';

  return null;
}
