import { describe, it, expect } from 'vitest';
import { checkpoints } from './deduce.js';

describe('checkpoints', () => {
  // Worked example from the spec: I vote 1st (index 0), partner votes 11th
  // (index 10), so N = 9 ballots sit between us.
  it('2GS checks at 0, 50, 100 — after voters 1, 6, 10', () => {
    expect(checkpoints(0, 10, 2)).toEqual([0, 5, 9]);
  });

  it('3GS checks at 0, 25, 50, 75, 100 — after voters 1, 4, 6, 8, 10', () => {
    expect(checkpoints(0, 10, 3)).toEqual([0, 3, 5, 7, 9]);
  });

  it('1GS checks only at the ends', () => {
    expect(checkpoints(0, 10, 1)).toEqual([0, 9]);
  });

  it('4GS checks after every voter in the window', () => {
    expect(checkpoints(0, 10, 4)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('adjacent voters leave no window', () => {
    expect(checkpoints(3, 4, 4)).toEqual([3]);
  });
});

import { intervals, recoveredVoters } from './deduce.js';
import type { ReplayBallot } from './replayTypes.js';

const b = (voter: string, ...pairs: Array<[string, number]>): ReplayBallot => ({
  voter, castAt: `2026-09-0${voter.length}T00:00:00Z`,
  votes: pairs.map(([uri, points]) => ({ uri, points, comment: null })),
});

describe('intervals', () => {
  const ballots = [b('A', ['s1', 2]), b('B', ['s1', 1]), b('C', ['s2', 3]), b('D', ['s1', 1])];

  it('an interval containing one ballot is exact', () => {
    const ivs = intervals(ballots, [0, 1, 2]);
    expect(ivs.map((i) => i.voters)).toEqual([['B'], ['C']]);
    expect(ivs.every((i) => i.exact)).toBe(true);
  });

  it('an interval containing two ballots is not exact but keeps the summed delta', () => {
    const ivs = intervals(ballots, [0, 2]);
    expect(ivs).toHaveLength(1);
    expect(ivs[0].voters).toEqual(['B', 'C']);
    expect(ivs[0].exact).toBe(false);
    expect(ivs[0].delta).toEqual({ s1: 1, s2: 3 });
  });

  it('recoveredVoters returns only the exactly-known ballots', () => {
    expect(recoveredVoters(intervals(ballots, [0, 1, 3]))).toEqual(['B']);
  });
});

import { candidatePools } from './deduce.js';
import type { ReplaySong } from './replayTypes.js';

const song = (uri: string, submitter: string): ReplaySong =>
  ({ uri, title: uri, artist: 'x', submitter, submitterComment: null });

describe('candidatePools', () => {
  const songs = [song('s1', 'A'), song('s2', 'B'), song('s3', 'C')];

  it('a known ballot eliminates its voter from every song it scored', () => {
    const ballots = [b('A', ['s2', 3], ['s3', -1])];
    expect(candidatePools(songs, ballots, ['A'], [])['s2']).not.toContain('A');
    expect(candidatePools(songs, ballots, ['A'], [])['s3']).not.toContain('A');
  });

  it('a 0-point row eliminates nobody — it is a submitter comment, not a vote', () => {
    const ballots = [b('A', ['s1', 0])];
    expect(candidatePools(songs, ballots, ['A'], [])['s1']).toContain('A');
  });

  it('an observer knows their own song exactly', () => {
    expect(candidatePools(songs, [], [], ['B'])['s2']).toEqual(['B']);
  });

  // The Quinto case: a submitter who never voted must survive in his own pool.
  it('keeps a submitter who cast no ballot at all', () => {
    const ballots = [b('A', ['s2', 1], ['s3', 1]), b('B', ['s1', 1], ['s3', 1])];
    expect(candidatePools(songs, ballots, ['A', 'B'], [])['s3']).toContain('C');
  });

  // The two-fer case: pinning a player to one song must not evict them from another.
  it('respects a per-round quota above one song per player', () => {
    const twofer = [song('s1', 'A'), song('s2', 'A'), song('s3', 'B')];
    const pools = candidatePools(twofer, [], [], ['A']);
    expect(pools['s1']).toEqual(['A']);
    expect(pools['s2']).toEqual(['A']);
  });
});

import { analyse } from './deduce.js';
import type { ReplayPayload } from './replayTypes.js';

const payload = (): ReplayPayload => ({
  round: { id: 1, name: 'R', description: '', votingDeadline: null, windowOpensAfter: null },
  songs: [song('s1', 'A'), song('s2', 'B'), song('s3', 'C')],
  ballots: [b('A', ['s2', 1]), b('B', ['s1', 1]), b('C', ['s1', 1])],
});

describe('analyse', () => {
  it('reports the window size between the two observers', () => {
    const r = analyse(payload(), { observers: ['A', 'C'], gs: 4, hunches: [] });
    expect(r.windowSize).toBe(1);
    expect(r.observerPositions).toEqual({ A: 0, C: 2 });
  });

  it('a hunch narrows afterHunches but leaves mechanical untouched', () => {
    const r = analyse(payload(), { observers: ['A'], gs: 4, hunches: [{ uri: 's3', player: 'B' }] });
    const k = r.steps.at(-1)!.knowledge.find((x) => x.uri === 's3')!;
    expect(k.mechanical).toContain('B');
    expect(k.afterHunches).not.toContain('B');
    expect(k.ruledOutByYou).toEqual(['B']);
  });

  it('a hunch that would empty a pool is ignored — sound deduction wins', () => {
    const r = analyse(payload(), { observers: ['A'], gs: 4, hunches: [{ uri: 's1', player: 'A' }] });
    const k = r.steps.at(-1)!.knowledge.find((x) => x.uri === 's1')!;
    expect(k.afterHunches).toEqual(['A']);
    expect(k.ruledOutByYou).toEqual([]);
  });

  it('counts hunch leverage', () => {
    const r = analyse(payload(), { observers: ['A'], gs: 4, hunches: [{ uri: 's3', player: 'B' }] });
    expect(r.hunchesApplied).toBe(1);
    expect(r.songsResolvedByHunches).toBeGreaterThanOrEqual(0);
  });
});
