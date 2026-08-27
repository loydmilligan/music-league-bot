import { describe, it, expect } from 'vitest';
import { resolveRollout, epOfCut } from './solve.js';
import { DEFAULT_ROLLOUT } from './defaults.js';
import type { Rollout } from './types.js';

const tiny: Rollout = {
  order: ['a', 'b', 'c'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'], check: { rule: 'exit-zero' } },
    b: { kind: 'script', runtime: 'host', label: 'B', command: ['b'] },
    c: { kind: 'script', runtime: 'app', label: 'C', command: ['c'] },
  },
  skipAfter: { b: true },
  covers: [],
};

describe('resolveRollout', () => {
  it('groups cuts into EPs at skip boundaries', () => {
    expect(resolveRollout(tiny).map((ep) => ep.cuts)).toEqual([['a', 'b'], ['c']]);
  });

  it('never merges — each EP keeps its cuts as a plain list', () => {
    const eps = resolveRollout(tiny);
    expect(eps[0]).toEqual({ cuts: ['a', 'b'], covers: [] });
  });

  it('drops disabled cuts', () => {
    const eps = resolveRollout({ ...tiny, disabled: ['b'] });
    expect(eps.map((ep) => ep.cuts)).toEqual([['a'], ['c']]);
  });

  it('places a remaster cover in the EP after its original', () => {
    const eps = resolveRollout({ ...tiny, covers: [{ of: 'a', remaster: true, budget: 1 }] });
    expect(eps[1].covers).toEqual([{ of: 'a', remaster: true, budget: 1 }]);
  });

  it('resolves the default rollout into the spec EP layout', () => {
    const eps = resolveRollout(DEFAULT_ROLLOUT);
    expect(eps[0].cuts).toEqual(['capture']);
    expect(eps[1].cuts).toEqual(['generate']);
    expect(eps[2].cuts).toEqual(['verify', 'dedupe', 'mentions', 'participation']);
    expect(eps[3].cuts).toEqual(['ledes']);
    expect(eps[4].cuts).toEqual(['hold-ledes']);
    expect(eps[5].cuts).toEqual(['punchup']);
    expect(eps[6].cuts).toEqual(['verify-post-punchup', 'dedupe-post-punchup', 'dupe-findings']);
    expect(eps[7].cuts).toEqual(['dupe-page', 'cover-art']);
    expect(eps[8].cuts).toEqual(['hold-approve']);
    expect(eps[9].cuts).toEqual(['send']);
    expect(eps[10].cuts).toEqual(['bridge', 'archive-refresh']);
  });
});

describe('epOfCut', () => {
  it('finds the EP index a cut sits in', () => {
    expect(epOfCut(resolveRollout(tiny), 'c')).toBe(1);
  });
  it('returns -1 for an unknown cut', () => {
    expect(epOfCut(resolveRollout(tiny), 'zzz')).toBe(-1);
  });
});
