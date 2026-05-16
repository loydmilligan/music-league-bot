/**
 * Canonical round/season lifecycle derivation. One source of truth so the
 * layout loader, page loaders, and any client-side recompute all agree on
 * what state a round is in.
 */

export type RoundPhase = 'upcoming' | 'submission' | 'voting' | 'archive';

export interface RoundLike {
  submissionDeadline?: string | null;
  votingDeadline?: string | null;
  // accept snake_case shapes too — DB rows sometimes flow through unmapped.
  submission_deadline?: string | null;
  voting_deadline?: string | null;
}

interface SeasonLike {
  rounds?: { phase: RoundPhase }[] | undefined;
}

function readDeadlines(r: RoundLike): { sub: number | null; vote: number | null } {
  const subRaw = r.submissionDeadline ?? r.submission_deadline ?? null;
  const voteRaw = r.votingDeadline ?? r.voting_deadline ?? null;
  const sub = subRaw ? Date.parse(subRaw) : NaN;
  const vote = voteRaw ? Date.parse(voteRaw) : NaN;
  return {
    sub: Number.isFinite(sub) ? sub : null,
    vote: Number.isFinite(vote) ? vote : null,
  };
}

/**
 * Phase boundaries:
 *   submission_deadline null or unparsable → `upcoming` (no submissions opened yet)
 *   now < submission_deadline               → `submission`
 *   submission_deadline ≤ now < voting_deadline → `voting`
 *   now ≥ voting_deadline                   → `archive`
 *   (voting_deadline null with sub_deadline past → `archive` once we're past
 *    submissions; without a vote-by date there's nowhere else for the round
 *    to live, and treating it as `voting` indefinitely would be wrong.)
 */
export function getRoundPhase(round: RoundLike, now: number = Date.now()): RoundPhase {
  const { sub, vote } = readDeadlines(round);
  if (sub === null) return 'upcoming';
  if (now < sub) return 'submission';
  if (vote !== null && now < vote) return 'voting';
  return 'archive';
}

/**
 * A season is active iff at least one of its rounds is currently accepting
 * submissions or votes. Pure derivation — no DB hit; pass in the rounds you
 * already loaded.
 */
export function seasonIsActive(season: SeasonLike): boolean {
  if (!season.rounds) return false;
  return season.rounds.some(r => r.phase === 'submission' || r.phase === 'voting');
}
