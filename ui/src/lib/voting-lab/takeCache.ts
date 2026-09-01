import type { VotingTakeOutput } from '$lib/predict/tasks/votingTake.js';

/**
 * Module-scoped cache for "Get take" results, so switching away from and back
 * to the vote tab does not re-bill the LLM call. The vote UI mounts
 * conditionally (matching the guess tab's pattern), which unmounts the row
 * components on every tab switch and would otherwise discard the take.
 *
 * Deliberately in-memory only: a take is cheap to regenerate on a real page
 * load and stale takes should not outlive the session.
 */
const cache = new Map<string, VotingTakeOutput>();

const key = (roundId: number, spotifyUri: string) => `${roundId} ${spotifyUri}`;

export function getCachedTake(roundId: number, spotifyUri: string): VotingTakeOutput | null {
  return cache.get(key(roundId, spotifyUri)) ?? null;
}

export function setCachedTake(roundId: number, spotifyUri: string, take: VotingTakeOutput): void {
  cache.set(key(roundId, spotifyUri), take);
}

/** Test hygiene only — not called by application code. */
export function clearTakeCache(): void {
  cache.clear();
}
