/**
 * FB-3: Shared active-round derivation — consumed by both layout.ts (home
 * rail) and activeRound.ts (ActiveRounds modal / API) to guarantee they
 * report the same round per league.
 *
 * Design:
 *   1. Manual pin if set and the pinned round is NOT in archive.
 *      A pin that has reached archive falls through automatically — the pin
 *      stays in the DB but loses force until the user picks a new round.
 *   2. Deadline-derived best round (submission > voting > upcoming); ties
 *      broken by newest createdAt.
 *   3. null — all rounds in archive or the list is empty.
 */
import type { RoundPhase } from '../types.js';

export interface DerivableRound {
  id: number;
  phase?: RoundPhase;
  createdAt?: string;
}

const PHASE_PRIORITY: Record<RoundPhase, number> = {
  submission: 0,
  voting: 1,
  upcoming: 2,
  archive: 3,
};

function effectivePhase(phase: RoundPhase | undefined): RoundPhase {
  return phase ?? 'upcoming';
}

export function pickActiveRound<T extends DerivableRound>(
  rounds: T[],
  pinnedRoundId: number | null | undefined,
): { round: T; source: 'manual' | 'derived' } | null {
  if (pinnedRoundId != null) {
    const pinned = rounds.find(r => r.id === pinnedRoundId);
    if (pinned && effectivePhase(pinned.phase) !== 'archive') {
      return { round: pinned, source: 'manual' };
    }
    // Pin is archive or dangling → fall through to derived.
  }

  if (rounds.length === 0) return null;
  const sorted = [...rounds].sort((a, b) => {
    const dp = PHASE_PRIORITY[effectivePhase(a.phase)] - PHASE_PRIORITY[effectivePhase(b.phase)];
    if (dp !== 0) return dp;
    if (a.createdAt && b.createdAt) return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    return 0;
  });
  const best = sorted[0];
  if (effectivePhase(best.phase) === 'archive') return null;
  return { round: best, source: 'derived' };
}
