import { describe, it, expect } from 'vitest';
import { initialCutRuns, claimable, epComplete, advance } from './engine.js';
import type { Rollout, RunState, CutRunState } from './types.js';

const rollout: Rollout = {
  order: ['a', 'b', 'hold', 'c'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'] },
    b: { kind: 'script', runtime: 'app', label: 'B', command: ['b'] },
    hold: { kind: 'human', label: 'Hold', reviewPath: '/x', alertType: 'digest_ready' },
    c: { kind: 'script', runtime: 'app', label: 'C', command: ['c'] },
  },
  skipAfter: { b: true, hold: true },
  covers: [],
};

function run(over: Partial<RunState> = {}, cuts?: CutRunState[]): RunState {
  return {
    runId: 'r1', leagueId: 1, roundId: 9, currentEp: 0, state: 'running',
    cuts: cuts ?? initialCutRuns(rollout),
    ...over,
  };
}
const set = (cuts: CutRunState[], id: string, patch: Partial<CutRunState>) =>
  cuts.map((c) => (c.cutId === id ? { ...c, ...patch } : c));

describe('initialCutRuns', () => {
  it('creates one pending row per active cut, tagged with its EP', () => {
    const rows = initialCutRuns(rollout);
    expect(rows.map((r) => [r.cutId, r.ep, r.state]))
      .toEqual([['a', 0, 'pending'], ['b', 0, 'pending'], ['hold', 1, 'pending'], ['c', 2, 'pending']]);
  });
  it('gives a human cut a null runtime', () => {
    expect(initialCutRuns(rollout).find((r) => r.cutId === 'hold')!.runtime).toBeNull();
  });
});

describe('claimable', () => {
  it('returns only pending cuts in the current EP matching the runtime', () => {
    expect(claimable(run(), rollout, 'host')).toEqual(['a']);
    expect(claimable(run(), rollout, 'app')).toEqual(['b']);
  });
  it('returns nothing for a cut already running', () => {
    expect(claimable(run({}, set(initialCutRuns(rollout), 'a', { state: 'running' })), rollout, 'host')).toEqual([]);
  });
  it('returns nothing while the run is parked', () => {
    expect(claimable(run({ state: 'parked' }), rollout, 'host')).toEqual([]);
  });
  it('never returns a human cut', () => {
    expect(claimable(run({ currentEp: 1 }), rollout, 'app')).toEqual([]);
  });
});

describe('epComplete', () => {
  it('is false while any cut in the EP is unfinished', () => {
    expect(epComplete(run(), 0)).toBe(false);
  });
  it('is true when every cut in the EP is terminal', () => {
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'done' });
    cuts = set(cuts, 'b', { state: 'skipped' });
    expect(epComplete(run({}, cuts), 0)).toBe(true);
  });
});

describe('advance', () => {
  it('holds position while the EP is incomplete', () => {
    expect(advance(run(), rollout).currentEp).toBe(0);
  });

  it('moves to the next EP when the current one completes', () => {
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'done' });
    cuts = set(cuts, 'b', { state: 'done' });
    const next = advance(run({}, cuts), rollout);
    expect(next.currentEp).toBe(1);
    expect(next.state).toBe('parked'); // EP1 is the hold
  });

  it('parks when the new EP contains a human cut', () => {
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'done' });
    cuts = set(cuts, 'b', { state: 'done' });
    expect(advance(run({}, cuts), rollout).state).toBe('parked');
  });

  it('resumes past a lifted hold', () => {
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'done' });
    cuts = set(cuts, 'b', { state: 'done' });
    cuts = set(cuts, 'hold', { state: 'done' });
    const next = advance(run({ currentEp: 1 }, cuts), rollout);
    expect(next.currentEp).toBe(2);
    expect(next.state).toBe('running');
  });

  it('finishes when the last EP completes', () => {
    const cuts = initialCutRuns(rollout).map((c) => ({ ...c, state: 'done' as const }));
    const next = advance(run({ currentEp: 2 }, cuts), rollout);
    expect(next.state).toBe('done');
  });

  it('is a no-op on a run that is already done', () => {
    const done = run({ state: 'done' });
    expect(advance(done, rollout)).toEqual(done);
  });

  it('does not un-park a forced hold even when its EP is terminal (C1)', () => {
    // The failed cut makes epComplete(0) true, but the run is PARKED (a
    // forced hold from applyCutResult), not RUNNING — advance must not move it.
    let cuts = set(initialCutRuns(rollout), 'a', { state: 'failed' });
    cuts = set(cuts, 'b', { state: 'done' });
    const parked = run({ state: 'parked' }, cuts);
    expect(advance(parked, rollout)).toEqual(parked);
  });

  it('skips a trailing cover-only EP that has no cut rows (I7)', () => {
    // A remaster cover of the LAST cut in the order creates an EP entry
    // (covers non-empty) with zero materialized cut rows — initialCutRuns
    // never generates a row for a cover, only for ep.cuts. Without a guard
    // the run parks forever waiting for an EP that can never complete.
    const trailingCover: Rollout = {
      order: ['a'],
      cuts: { a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'] } },
      skipAfter: {},
      covers: [{ of: 'a', remaster: true, budget: 1 }],
    };
    const cuts = set(initialCutRuns(trailingCover), 'a', { state: 'done' });
    const next = advance(run({}, cuts), trailingCover);
    expect(next.state).toBe('done'); // EP1 has no rows to wait for — finish, not stall
  });
});
