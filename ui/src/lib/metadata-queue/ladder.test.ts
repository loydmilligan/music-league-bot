import { it, expect, describe } from 'vitest';
import { rollupChip, LADDER } from './ladder.js';
import type { JobCounts } from './ladder.js';

// -----------------------------------------------------------------------
// rollupChip — priority ladder tests
// -----------------------------------------------------------------------

describe('rollupChip', () => {
  it('returns sky tone and "running" label when processing > 0', () => {
    const counts: JobCounts = { pending: 2, processing: 3, done24h: 0, failed: 0, total: 5 };
    const result = rollupChip(counts);
    expect(result.tone).toBe('sky');
    expect(result.label).toBe('running');
  });

  it('returns sky/"running" even when failed > 0 if processing > 0 (running takes priority)', () => {
    const counts: JobCounts = { pending: 0, processing: 1, done24h: 0, failed: 2, total: 3 };
    const result = rollupChip(counts);
    expect(result.tone).toBe('sky');
    expect(result.label).toBe('running');
  });

  it('returns amber tone and "<n> failed" label when failed > 0 and none processing', () => {
    const counts: JobCounts = { pending: 0, processing: 0, done24h: 2, failed: 3, total: 5 };
    const result = rollupChip(counts);
    expect(result.tone).toBe('amber');
    expect(result.label).toBe('3 failed');
  });

  it('returns sky tone and "<n> to go" label when only pending left (no failures, no running)', () => {
    const counts: JobCounts = { pending: 4, processing: 0, done24h: 0, failed: 0, total: 10 };
    const result = rollupChip(counts);
    expect(result.tone).toBe('sky');
    expect(result.label).toBe('4 to go');
  });

  it('returns health tone and "done" label when all work complete', () => {
    const counts: JobCounts = { pending: 0, processing: 0, done24h: 5, failed: 0, total: 5 };
    const result = rollupChip(counts);
    expect(result.tone).toBe('health');
    expect(result.label).toBe('done');
  });

  it('returns muted tone and "no data" label when total === 0', () => {
    const counts: JobCounts = { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0 };
    const result = rollupChip(counts);
    expect(result.tone).toBe('muted');
    expect(result.label).toBe('no data');
  });

  it('NEVER returns accent tone — processing > 0 case', () => {
    const counts: JobCounts = { pending: 0, processing: 5, done24h: 0, failed: 0, total: 5 };
    expect(rollupChip(counts).tone).not.toBe('accent');
  });

  it('NEVER returns accent tone — failed > 0 case', () => {
    const counts: JobCounts = { pending: 0, processing: 0, done24h: 0, failed: 2, total: 5 };
    expect(rollupChip(counts).tone).not.toBe('accent');
  });

  it('NEVER returns accent tone — pending only case', () => {
    const counts: JobCounts = { pending: 3, processing: 0, done24h: 0, failed: 0, total: 5 };
    expect(rollupChip(counts).tone).not.toBe('accent');
  });

  it('NEVER returns accent tone — done case', () => {
    const counts: JobCounts = { pending: 0, processing: 0, done24h: 5, failed: 0, total: 5 };
    expect(rollupChip(counts).tone).not.toBe('accent');
  });

  it('tone is always within the allowed union (sky | amber | health | muted)', () => {
    const cases: JobCounts[] = [
      { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0 },
      { pending: 1, processing: 0, done24h: 0, failed: 0, total: 5 },
      { pending: 0, processing: 2, done24h: 0, failed: 0, total: 5 },
      { pending: 0, processing: 0, done24h: 0, failed: 1, total: 5 },
      { pending: 0, processing: 0, done24h: 5, failed: 0, total: 5 },
    ];
    const allowed = new Set(['sky', 'amber', 'health', 'muted']);
    for (const c of cases) {
      expect(allowed.has(rollupChip(c).tone)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------
// LADDER — data map tests
// -----------------------------------------------------------------------

describe('LADDER', () => {
  it('LADDER.running.pulse === true', () => {
    expect(LADDER.running.pulse).toBe(true);
  });

  it('only running has pulse === true; all other states have pulse falsy', () => {
    const states = ['missing', 'queued', 'done', 'failedRetry', 'failedHard'] as const;
    for (const s of states) {
      expect(LADDER[s].pulse).toBeFalsy();
    }
  });

  it('every state has glyph, fg, soft, border fields', () => {
    const states = ['missing', 'queued', 'running', 'done', 'failedRetry', 'failedHard'] as const;
    for (const s of states) {
      expect(typeof LADDER[s].glyph).toBe('string');
      expect(typeof LADDER[s].fg).toBe('string');
      expect(typeof LADDER[s].soft).toBe('string');
      expect(typeof LADDER[s].border).toBe('string');
    }
  });
});
