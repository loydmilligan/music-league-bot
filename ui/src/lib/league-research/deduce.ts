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

import type { ReplayAnalysis, ReplayPayload, ReplayStep, Scenario, SongBoard, SongKnowledge } from './replayTypes.js';

export function analyse(payload: ReplayPayload, scenario: Scenario): ReplayAnalysis {
  const { ballots, songs } = payload;
  const pos: Record<string, number> = {};
  ballots.forEach((bal, i) => { if (scenario.observers.includes(bal.voter)) pos[bal.voter] = i; });
  const idxs = Object.values(pos).sort((a, b) => a - b);
  const windowSize = idxs.length >= 2 ? idxs.at(-1)! - idxs[0] - 1 : 0;

  // Union of every observer's schedule: two people refreshing at different
  // moments partition the timeline more finely than either alone. That, not
  // shared secrets, is the mechanical benefit of a partnership.
  const cps = idxs.length >= 2
    ? [...new Set(idxs.flatMap((s, i) => (i < idxs.length - 1 ? checkpoints(s, idxs[i + 1], scenario.gs) : [s])))]
        .sort((a, b) => a - b)
    : idxs;

  const running: Record<string, number> = {};
  const voterCount: Record<string, number> = {};
  const steps: ReplayStep[] = [];

  ballots.forEach((ballot, index) => {
    for (const v of ballot.votes) {
      running[v.uri] = (running[v.uri] ?? 0) + v.points;
      if (v.points !== 0) voterCount[v.uri] = (voterCount[v.uri] ?? 0) + 1;
    }
    const seen = cps.filter((c) => c <= index);
    const ivs = intervals(ballots.slice(0, index + 1), seen);
    const known = [...new Set([...recoveredVoters(ivs), ...scenario.observers])];
    const mech = candidatePools(songs, ballots.slice(0, index + 1), known, scenario.observers);

    const knowledge: SongKnowledge[] = songs.map((s) => {
      const mechanical = mech[s.uri] ?? [];
      const cut = scenario.hunches.filter((h) => h.uri === s.uri).map((h) => h.player);
      const after = mechanical.filter((p) => !cut.includes(p));
      // A hunch that contradicts sound deduction is discarded, not obeyed.
      const usable = after.length ? after : mechanical;
      return {
        uri: s.uri, mechanical, afterHunches: usable,
        ruledOutByYou: after.length ? mechanical.filter((p) => cut.includes(p)) : [],
      };
    });

    const board: SongBoard[] = songs
      .map((s) => ({ uri: s.uri, points: running[s.uri] ?? 0, voterCount: voterCount[s.uri] ?? 0 }))
      .sort((a, b) => b.points - a.points);

    steps.push({ index, ballot, board, knownBallots: known, partialIntervals: ivs.filter((i) => !i.exact), knowledge });
  });

  // Count at the LAST step, not an average across steps: the view renders this
  // as "N songs resolved", so it must be a count of songs, not a rate.
  const final = steps.at(-1);
  const songsResolvedByHunches = final
    ? final.knowledge.filter((k) => k.mechanical.length > 1 && k.afterHunches.length === 1).length
    : 0;

  return { steps, windowSize, observerPositions: pos, hunchesApplied: scenario.hunches.length, songsResolvedByHunches };
}
