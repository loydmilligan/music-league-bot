import type { BallotEntry, BudgetUsage, VoteBudget } from './types.js';

/** Total points spent from each pool, and what's left. */
export function computeUsage(entries: BallotEntry[], budget: VoteBudget): BudgetUsage {
  let upUsed = 0;
  let downUsed = 0;
  for (const e of entries) {
    upUsed += e.upPoints;
    downUsed += e.downPoints;
  }
  return {
    upUsed,
    downUsed,
    upRemaining: budget.upTotal - upUsed,
    downRemaining: budget.downTotal - downUsed,
  };
}

/**
 * Can we apply `delta` (usually +1 / -1) to this song's `kind` pool?
 * Guards: own song, negative result, pool exhaustion, per-song cap.
 */
export function canAllocate(
  entries: BallotEntry[],
  budget: VoteBudget,
  spotifyUri: string,
  kind: 'up' | 'down',
  delta: number,
): boolean {
  const target = entries.find((e) => e.spotifyUri === spotifyUri);
  if (!target) return false;
  if (target.isMine) return false;

  const current = kind === 'up' ? target.upPoints : target.downPoints;
  const next = current + delta;
  if (next < 0) return false;

  if (budget.perSongCap !== null && next > budget.perSongCap) return false;

  const usage = computeUsage(entries, budget);
  const remaining = kind === 'up' ? usage.upRemaining : usage.downRemaining;
  // Spending more than remains is blocked; giving points back always fits.
  if (delta > 0 && delta > remaining) return false;

  return true;
}

/** Human-readable violations. Empty array = ballot is submittable as-is. */
export function validateBallot(entries: BallotEntry[], budget: VoteBudget): string[] {
  const problems: string[] = [];
  const usage = computeUsage(entries, budget);

  if (usage.upUsed > budget.upTotal) {
    problems.push(`Over budget: ${usage.upUsed} up points allocated, only ${budget.upTotal} available.`);
  }
  if (usage.downUsed > budget.downTotal) {
    problems.push(`Over budget: ${usage.downUsed} down points allocated, only ${budget.downTotal} available.`);
  }
  for (const e of entries) {
    if (e.isMine && (e.upPoints > 0 || e.downPoints > 0)) {
      problems.push(`You cannot vote on your own song (${e.spotifyUri}).`);
    }
    if (e.upPoints < 0 || e.downPoints < 0) {
      problems.push(`Negative allocation on ${e.spotifyUri}.`);
    }
    if (budget.perSongCap !== null && (e.upPoints > budget.perSongCap || e.downPoints > budget.perSongCap)) {
      problems.push(`${e.spotifyUri} exceeds the per-song cap of ${budget.perSongCap}.`);
    }
    if (e.upPoints > 0 && e.downPoints > 0) {
      problems.push(`${e.spotifyUri} has both up and down points — a song can only be upvoted or downvoted.`);
    }
  }
  return problems;
}
