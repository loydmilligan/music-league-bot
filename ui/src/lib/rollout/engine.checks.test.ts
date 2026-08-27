import { describe, it, expect } from 'vitest';
import { evaluateCheck, applyCutResult, initialCutRuns } from './engine.js';
import type { Rollout, RunState } from './types.js';

const rollout: Rollout = {
  order: ['verify', 'next'],
  cuts: {
    verify: { kind: 'script', runtime: 'host', label: 'Verify', command: ['v'], check: { rule: 'no-fail-checks' } },
    next: { kind: 'script', runtime: 'host', label: 'Next', command: ['n'] },
  },
  skipAfter: { verify: true },
  covers: [{ of: 'verify', remaster: true, budget: 1 }],
};

const run = (): RunState => ({
  runId: 'r1', leagueId: 1, roundId: 9, currentEp: 0, state: 'running',
  cuts: initialCutRuns(rollout),
});
const cut = (r: RunState, id: string) => r.cuts.find((c) => c.cutId === id)!;

describe('evaluateCheck', () => {
  it('is undefined when no check is declared', () => {
    expect(evaluateCheck(undefined, { exitCode: 1 })).toBeUndefined();
  });
  it('exit-zero passes on 0 and fails otherwise', () => {
    expect(evaluateCheck({ rule: 'exit-zero' }, { exitCode: 0 })).toBe(true);
    expect(evaluateCheck({ rule: 'exit-zero' }, { exitCode: 1 })).toBe(false);
  });
  it('no-fail-checks reads severities out of the JSON payload', () => {
    const ok = JSON.stringify({ checks: [{ severity: 'ok' }, { severity: 'warn' }] });
    const bad = JSON.stringify({ checks: [{ severity: 'ok' }, { severity: 'fail' }] });
    expect(evaluateCheck({ rule: 'no-fail-checks' }, { exitCode: 1, outputJson: ok })).toBe(true);
    expect(evaluateCheck({ rule: 'no-fail-checks' }, { exitCode: 1, outputJson: bad })).toBe(false);
  });
  it('no-fail-checks fails closed on unparseable output', () => {
    expect(evaluateCheck({ rule: 'no-fail-checks' }, { exitCode: 0, outputJson: 'not json' })).toBe(false);
  });
});

describe('applyCutResult', () => {
  it('marks a passing cut done', () => {
    const r = applyCutResult(run(), rollout, 'verify', {
      exitCode: 0, outputJson: JSON.stringify({ checks: [] }),
    });
    expect(cut(r, 'verify').state).toBe('done');
    expect(cut(r, 'verify').checkPassed).toBe(true);
  });

  it('retries a transient failure without spending a remaster', () => {
    const r = applyCutResult(run(), rollout, 'verify', { exitCode: 1, error: 'timeout' });
    expect(cut(r, 'verify').state).toBe('pending');
    expect(cut(r, 'verify').attempts).toBe(1);
    expect(cut(r, 'verify').remasters).toBe(0);
  });

  it('fails a cut for good after 3 transient attempts', () => {
    let r = run();
    for (let i = 0; i < 3; i++) r = applyCutResult(r, rollout, 'verify', { exitCode: 1, error: 'timeout' });
    expect(cut(r, 'verify').state).toBe('failed');
  });

  it('spends a remaster and re-queues the cut when its check fails', () => {
    const bad = JSON.stringify({ checks: [{ severity: 'fail', id: 'quote fabricated?' }] });
    const r = applyCutResult(run(), rollout, 'verify', { exitCode: 1, outputJson: bad });
    expect(cut(r, 'verify').state).toBe('pending');
    expect(cut(r, 'verify').remasters).toBe(1);
    expect(cut(r, 'verify').attempts).toBe(0); // NOT a transient retry
    expect(r.state).toBe('running');
  });

  it('parks at a forced hold when the remaster budget is exhausted', () => {
    const bad = JSON.stringify({ checks: [{ severity: 'fail', id: 'quote fabricated?' }] });
    let r = applyCutResult(run(), rollout, 'verify', { exitCode: 1, outputJson: bad });
    r = applyCutResult(r, rollout, 'verify', { exitCode: 1, outputJson: bad });
    expect(r.state).toBe('parked');
    expect(cut(r, 'verify').state).toBe('failed');
    expect(r.error).toContain('verify');
  });

  it('never advances past a forced hold', () => {
    const bad = JSON.stringify({ checks: [{ severity: 'fail' }] });
    let r = applyCutResult(run(), rollout, 'verify', { exitCode: 1, outputJson: bad });
    r = applyCutResult(r, rollout, 'verify', { exitCode: 1, outputJson: bad });
    expect(r.currentEp).toBe(0);
  });

  it('does not fire a remaster for a cut with no remaster cover', () => {
    const noCover: Rollout = { ...rollout, covers: [] };
    const r = applyCutResult(run(), noCover, 'verify', {
      exitCode: 1, outputJson: JSON.stringify({ checks: [{ severity: 'fail' }] }),
    });
    expect(cut(r, 'verify').state).toBe('failed');
    expect(r.state).toBe('parked');
  });
});
