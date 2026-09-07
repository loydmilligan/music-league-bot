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

import type { ReplaySong } from './replayTypes.js';

/**
 * Sound narrowing only: every rule here must be one that CANNOT exclude the
 * true submitter. The invariant test in deduceInvariants.test.ts runs this
 * against every real round in the database and fails if it ever does.
 */
export function candidatePools(
  songs: ReplaySong[],
  ballots: ReplayBallot[],
  knownVoters: string[],
  observers: string[],
): Record<string, string[]> {
  // Seed from SUBMITTERS, not voters. A player who never voted is still a
  // submitter, and seeding from voters would exclude them from their own pool.
  const universe = [...new Set(songs.map((s) => s.submitter))];
  const quota = new Map<string, number>();
  for (const s of songs) quota.set(s.submitter, (quota.get(s.submitter) ?? 0) + 1);

  const pools = new Map<string, Set<string>>(songs.map((s) => [s.uri, new Set(universe)]));
  const known = new Set(knownVoters);

  for (const ballot of ballots) {
    if (!known.has(ballot.voter)) continue;
    for (const v of ballot.votes) {
      if (v.points === 0) continue;          // a comment, not a vote
      pools.get(v.uri)?.delete(ballot.voter);
    }
  }
  for (const s of songs) {
    if (observers.includes(s.submitter)) pools.set(s.uri, new Set([s.submitter]));
  }

  // Quota propagation: once a player is pinned to k songs, evict them elsewhere.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [player, k] of quota) {
      const pinned = [...pools.entries()].filter(([, c]) => c.size === 1 && c.has(player));
      if (pinned.length !== k) continue;
      const pinnedUris = new Set(pinned.map(([uri]) => uri));
      for (const [uri, c] of pools) {
        if (!pinnedUris.has(uri) && c.delete(player)) changed = true;
      }
    }
  }
  return Object.fromEntries([...pools].map(([uri, c]) => [uri, [...c].sort()]));
}
