import { describe, it, expect } from 'vitest';
import { summarizeRun } from './runView.js';
import type { Rollout, RunState, CutRunState } from './types.js';

const rollout: Rollout = {
  order: ['verify', 'punchup', 'hold'],
  cuts: {
    verify: { kind: 'script', runtime: 'host', label: 'Verify facts', command: ['v'], check: { rule: 'no-fail-checks' } },
    punchup: { kind: 'agent', runtime: 'host', label: 'Punch-up', job: 'punchup' },
    hold: { kind: 'human', label: 'Approve', reviewPath: '/d', alertType: 'digest_ready' },
  },
  skipAfter: { verify: true, punchup: true },
  covers: [{ of: 'verify', remaster: true, budget: 1 }],
};

const c = (over: Partial<CutRunState> & { cutId: string; ep: number }): CutRunState => ({
  runtime: 'host', state: 'pending', attempts: 0, remasters: 0, ...over,
});

const run = (over: Partial<RunState> = {}, cuts: CutRunState[] = []): RunState => ({
  runId: 'r1', leagueId: 1, roundId: 9, currentEp: 0, state: 'running', cuts, ...over,
});

describe('summarizeRun', () => {
  it('labels a cut that passed its check', () => {
    const v = summarizeRun(run({}, [c({ cutId: 'verify', ep: 0, state: 'done', checkPassed: true })]), rollout);
    expect(v.cuts[0].status).toBe('passed');
  });

  it('labels a cut repaired by a remaster', () => {
    const v = summarizeRun(run({}, [c({ cutId: 'verify', ep: 0, state: 'done', checkPassed: true, remasters: 1 })]), rollout);
    expect(v.cuts[0].status).toBe('repaired');
    expect(v.cuts[0].note).toContain('remaster');
  });

  it('labels a cut whose check failed unrepairably', () => {
    const v = summarizeRun(run({}, [c({ cutId: 'verify', ep: 0, state: 'failed', checkPassed: false, remasters: 1 })]), rollout);
    expect(v.cuts[0].status).toBe('failed-check');
  });

  it('distinguishes a transient failure from a failed check', () => {
    const v = summarizeRun(run({}, [c({ cutId: 'verify', ep: 0, state: 'failed', attempts: 3 })]), rollout);
    expect(v.cuts[0].status).toBe('failed-transient');
  });

  it('reports the run as resumable only when parked', () => {
    expect(summarizeRun(run({ state: 'parked' }), rollout).resumable).toBe(true);
    expect(summarizeRun(run({ state: 'running' }), rollout).resumable).toBe(false);
    expect(summarizeRun(run({ state: 'done' }), rollout).resumable).toBe(false);
  });

  it('names the hold a parked run is waiting on', () => {
    const v = summarizeRun(
      run({ state: 'parked', currentEp: 2 }, [c({ cutId: 'hold', ep: 2, runtime: null })]),
      rollout);
    expect(v.waitingOn).toBe('Approve');
  });

  it('surfaces the run error on a forced hold', () => {
    const v = summarizeRun(run({ state: 'parked', error: 'cut "verify" check failed' }), rollout);
    expect(v.error).toContain('verify');
  });

  it('counts progress as terminal cuts over total', () => {
    const v = summarizeRun(run({}, [
      c({ cutId: 'verify', ep: 0, state: 'done' }),
      c({ cutId: 'punchup', ep: 1, state: 'pending' }),
    ]), rollout);
    expect(v.progress).toEqual({ done: 1, total: 2 });
  });
});
