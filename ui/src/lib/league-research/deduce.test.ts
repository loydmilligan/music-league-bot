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
