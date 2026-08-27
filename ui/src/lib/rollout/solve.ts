/**
 * Resolve a Rollout into ordered EPs.
 *
 * Same algorithm as the pipeline solver, via the shared epCore primitives,
 * minus two things that do not belong at this level:
 *   - no merge: collapsing adjacent agent cuts into one call would destroy
 *     the context isolation that makes a parallel EP meaningful;
 *   - no model grouping: agent cuts resolve their model individually via
 *     modelFor, and script/human cuts have no model at all.
 */
import { bucketBySkip, placeCovers } from '$lib/digest/epCore.js';
import { activeCuts, type Rollout, type RolloutCover } from './types.js';

export type RolloutEP = { cuts: string[]; covers: RolloutCover[] };

export function resolveRollout(rollout: Rollout): RolloutEP[] {
  const active = activeCuts(rollout);
  const buckets = bucketBySkip(
    rollout.order,
    rollout.skipAfter as Record<string, boolean>,
    active,
  );
  const coversByEp = placeCovers(buckets, rollout.covers);

  const total = coversByEp.size > 0
    ? Math.max(buckets.length, ...Array.from(coversByEp.keys()).map((k) => k + 1))
    : buckets.length;

  const eps: RolloutEP[] = [];
  for (let i = 0; i < total; i++) {
    const cuts = buckets[i] ?? [];
    const covers = coversByEp.get(i) ?? [];
    if (cuts.length === 0 && covers.length === 0) continue; // elide empty EPs
    eps.push({ cuts, covers });
  }
  return eps;
}

/** EP index containing `cutId`, or -1 if it is not active. */
export function epOfCut(eps: RolloutEP[], cutId: string): number {
  return eps.findIndex((ep) => ep.cuts.includes(cutId));
}
