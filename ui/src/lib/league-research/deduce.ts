// Pure deduction engine for the Voting Replay panel. No DB, no Svelte, no fetch.
// See docs/superpowers/specs/2026-09-07-voting-replay-design.md
import type { GlanceSeverity } from './replayTypes.js';

const FRACTIONS: Record<Exclude<GlanceSeverity, 4>, number[]> = {
  1: [0, 1],
  2: [0, 0.5, 1],
  3: [0, 0.25, 0.5, 0.75, 1],
};

/**
 * Ballot-indexed glance schedule. The Music League page shows who has voted, so
 * a "glance" is anchored to ballots, not to the clock.
 */
export function checkpoints(myPos: number, partnerPos: number, gs: GlanceSeverity): number[] {
  const n = partnerPos - myPos - 1;
  if (n <= 0) return [myPos];
  if (gs === 4) return Array.from({ length: n + 1 }, (_, i) => myPos + i);
  return [...new Set(FRACTIONS[gs].map((f) => myPos + Math.ceil(f * n)))].sort((a, b) => a - b);
}

import type { Interval, ReplayBallot } from './replayTypes.js';

/**
 * Split the ballots between consecutive checkpoints. A single observer's
 * checkpoints PARTITION the timeline — the intervals are disjoint, so no
 * interval shares an unknown with another and cross-interval solving yields
 * exactly nothing (measured in the spec). Do not add a solver here.
 */
export function intervals(ballots: ReplayBallot[], cps: number[]): Interval[] {
  const out: Interval[] = [];
  for (let i = 0; i < cps.length - 1; i++) {
    const slice = ballots.slice(cps[i] + 1, cps[i + 1] + 1);
    if (!slice.length) continue;
    const delta: Record<string, number> = {};
    for (const ballot of slice) {
      for (const v of ballot.votes) delta[v.uri] = (delta[v.uri] ?? 0) + v.points;
    }
    out.push({ voters: slice.map((s) => s.voter), delta, exact: slice.length === 1 });
  }
  return out;
}

export function recoveredVoters(ivs: Interval[]): string[] {
  return ivs.filter((i) => i.exact).map((i) => i.voters[0]);
}
