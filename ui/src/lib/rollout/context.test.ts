import { describe, it, expect } from 'vitest';
import { contextFor } from './context.js';
import type { RunState, CutRunState } from './types.js';

const c = (cutId: string, ep: number, outputJson?: string): CutRunState => ({
  cutId, ep, runtime: 'host', state: outputJson ? 'done' : 'pending',
  attempts: 0, remasters: 0, outputJson,
});

const run: RunState = {
  runId: 'r1', leagueId: 1, roundId: 9, currentEp: 2, state: 'running',
  cuts: [
    c('capture', 0, '{"ok":true}'),
    c('verify', 1, '{"checks":[]}'),
    c('dedupe', 1, '{"runs":[]}'),
    c('punchup', 2),
    c('sibling', 2, '{"leaked":true}'),
    c('later', 3),
  ],
};

describe('contextFor', () => {
  it('includes every cut from a strictly earlier EP', () => {
    expect(contextFor(run, 'punchup').upstream.map((u) => u.cutId))
      .toEqual(['capture', 'verify', 'dedupe']);
  });

  it('never includes a sibling in the same EP', () => {
    expect(contextFor(run, 'punchup').upstream.some((u) => u.cutId === 'sibling')).toBe(false);
  });

  it('never includes a downstream cut', () => {
    expect(contextFor(run, 'punchup').upstream.some((u) => u.cutId === 'later')).toBe(false);
  });

  it('carries each upstream cut output verbatim', () => {
    const verify = contextFor(run, 'punchup').upstream.find((u) => u.cutId === 'verify')!;
    expect(verify.outputJson).toBe('{"checks":[]}');
  });

  it('gives an EP0 cut an empty upstream', () => {
    expect(contextFor(run, 'capture').upstream).toEqual([]);
  });

  it('omits upstream cuts that produced no output', () => {
    const partial: RunState = { ...run, cuts: [c('a', 0), c('b', 1)] };
    expect(contextFor(partial, 'b').upstream).toEqual([]);
  });

  it('throws for an unknown cut rather than silently returning everything', () => {
    expect(() => contextFor(run, 'ghost')).toThrow(/unknown cut/);
  });
});
