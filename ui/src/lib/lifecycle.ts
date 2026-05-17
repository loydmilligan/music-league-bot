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
 * Per-round phase. **Use sparingly** — only when you genuinely don't have
 * season context (e.g. a one-off `PATCH /api/rounds/:id` response where the
 * caller already knows which round it's looking at). Any UI surface that
 * lists rounds should use `getRoundPhasesForSeason` instead, because a round
 * can only legitimately be in `submission` once all earlier rounds have
 * archived. Calling this per-round on a 7-round season makes every round
 * with a future deadline read as `submission` simultaneously — the bug
 * sprint-5's phase-season-context-fix hotfix was filed against.
 *
 * @deprecated Prefer `getRoundPhasesForSeason` whenever sibling rounds are loadable.
 */
export function getRoundPhase(round: RoundLike, now: number = Date.now()): RoundPhase {
  const { sub, vote } = readDeadlines(round);
  if (sub === null) return 'upcoming';
  if (now < sub) return 'submission';
  if (vote !== null && now < vote) return 'voting';
  return 'archive';
}

interface IdentifiedRound extends RoundLike { id: number; }

/**
 * Season-aware phase derivation. Walks rounds in ascending `id` order applying:
 *   (1) now ≥ voting_deadline                         → archive
 *   (2) else now ≥ submission_deadline                → voting
 *   (3) else previous round archive (or first round)  → submission
 *   (4) else                                          → upcoming
 *
 * Rule (3) is the load-bearing one: it enforces that rounds run sequentially
 * within a season, so only the round whose predecessor has finished voting
 * can be in submission. Without this, every round whose submission_deadline
 * is in the future reads as "submitting", which is what the bug was.
 *
 * Returns a Map keyed by round id so callers can lookup without re-walking.
 */
export function getRoundPhasesForSeason(
  rounds: IdentifiedRound[],
  now: number = Date.now(),
): Map<number, RoundPhase> {
  const ordered = [...rounds].sort((a, b) => a.id - b.id);
  const out = new Map<number, RoundPhase>();
  let prevPhase: RoundPhase | null = null;
  for (const r of ordered) {
    const { sub, vote } = readDeadlines(r);
    let phase: RoundPhase;
    if (vote !== null && now >= vote) {
      phase = 'archive';
    } else if (sub !== null && now >= sub) {
      // Past sub_deadline but vote still open (or null + sub past → archive in
      // single-round case; here vote is not yet past per the branch above).
      // If voting_deadline is null AND sub is past, fall through to the
      // pre-archive case below — explicitly: treat as archive too so we don't
      // wedge in 'voting' indefinitely.
      phase = vote === null ? 'archive' : 'voting';
    } else if (prevPhase === null || prevPhase === 'archive') {
      // This round inherits "active turn" from the season — either it's the
      // first round or every predecessor has fully archived.
      phase = 'submission';
    } else {
      phase = 'upcoming';
    }
    out.set(r.id, phase);
    prevPhase = phase;
  }
  return out;
}

/**
 * A season is active iff at least one of its rounds is currently accepting
 * submissions or votes. Pure derivation — no DB hit; pass in rounds with
 * `phase` already attached (e.g. via `getRoundPhasesForSeason`).
 */
export function seasonIsActive(season: SeasonLike): boolean {
  if (!season.rounds) return false;
  return season.rounds.some(r => r.phase === 'submission' || r.phase === 'voting');
}
