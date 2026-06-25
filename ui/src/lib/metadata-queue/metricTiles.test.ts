/**
 * metricTiles.test.ts — TDD RED phase
 *
 * Tests for the pure label/count helper in metricTiles.ts.
 * All assertions mirror the exact strings from task-4-brief.md.
 */

import { it, expect, describe } from 'vitest';
import {
  failedLabel,
  doneLabel,
  doneSubLabel,
  deriveTotals,
} from './metricTiles.js';
import type { MetricJobCounts, MetricTotals } from './metricTiles.js';

// ---------------------------------------------------------------------------
// failedLabel — "Failed 441 · jobs across ~110 songs"
// ---------------------------------------------------------------------------

describe('failedLabel', () => {
  it('formats "Failed <jobs> · jobs across ~<songs> songs" with the literal tilde', () => {
    const result = failedLabel(441, 110);
    expect(result).toBe('Failed 441 · jobs across ~110 songs');
  });

  it('uses the exact tilde prefix for the approximate song count', () => {
    const result = failedLabel(5, 2);
    expect(result).toContain('~2 songs');
  });

  it('says "jobs" not "song" to answer the "what does 441 count?" question', () => {
    const result = failedLabel(10, 3);
    expect(result).toContain('jobs');
  });

  it('handles 0 failed jobs gracefully', () => {
    const result = failedLabel(0, 0);
    expect(result).toBe('Failed 0 · jobs across ~0 songs');
  });
});

// ---------------------------------------------------------------------------
// doneLabel — "60% of N in scope"
// ---------------------------------------------------------------------------

describe('doneLabel', () => {
  it('formats "<percent>% of <total> in scope"', () => {
    // given done=600, total=1000 → 60%
    const result = doneLabel(600, 1000);
    expect(result).toContain('60% of 1000 in scope');
  });

  it('rounds percent to integer', () => {
    // 333/1000 = 33.3% → should round to 33%
    const result = doneLabel(333, 1000);
    expect(result).toContain('33% of 1000 in scope');
  });

  it('returns 0% when done=0', () => {
    const result = doneLabel(0, 1000);
    expect(result).toContain('0% of 1000 in scope');
  });

  it('returns 0% of 0 in scope when total===0 (divide-by-zero guard)', () => {
    const result = doneLabel(0, 0);
    expect(result).toBe('0% of 0 in scope');
  });

  it('returns 100% when fully complete', () => {
    const result = doneLabel(500, 500);
    expect(result).toContain('100% of 500 in scope');
  });
});

// ---------------------------------------------------------------------------
// doneSubLabel — "· N in last 24h" (24h shown separately from lifetime done)
// ---------------------------------------------------------------------------

describe('doneSubLabel', () => {
  it('returns a string containing the done24h count and "24h"', () => {
    const result = doneSubLabel(42);
    expect(result).toContain('42');
    expect(result).toContain('24h');
  });

  it('is distinct from the lifetime done count — separate sub-stat', () => {
    // 24h stat must be a standalone fragment, not folded into the main count
    const result = doneSubLabel(7);
    expect(result).toContain('7');
    // should NOT just return a plain number — it must label the 24h window
    expect(result).not.toBe('7');
  });

  it('handles 0 done24h', () => {
    const result = doneSubLabel(0);
    expect(result).toContain('0');
    expect(result).toContain('24h');
  });
});

// ---------------------------------------------------------------------------
// deriveTotals — aggregate byJobType into MetricTotals
// ---------------------------------------------------------------------------

describe('deriveTotals', () => {
  const sampleByJobType: Record<string, MetricJobCounts> = {
    ytm: {
      pending: 10, processing: 2, done24h: 5, failed: 3, total: 20, done: 5,
    },
    lastfm_pop: {
      pending: 20, processing: 1, done24h: 8, failed: 8, total: 37, done: 8,
    },
    audio: {
      pending: 0, processing: 0, done24h: 0, failed: 0, total: 0, done: 0,
    },
  };

  it('sums queued (pending) across all job types', () => {
    const totals = deriveTotals(sampleByJobType);
    expect(totals.totalQueued).toBe(30); // 10 + 20 + 0
  });

  it('sums running (processing) across all job types', () => {
    const totals = deriveTotals(sampleByJobType);
    expect(totals.totalRunning).toBe(3); // 2 + 1 + 0
  });

  it('sums lifetime done across all job types', () => {
    const totals = deriveTotals(sampleByJobType);
    expect(totals.totalDone).toBe(13); // 5 + 8 + 0
  });

  it('sums failed across all job types', () => {
    const totals = deriveTotals(sampleByJobType);
    expect(totals.totalFailed).toBe(11); // 3 + 8 + 0
  });

  it('sums total across all job types', () => {
    const totals = deriveTotals(sampleByJobType);
    expect(totals.total).toBe(57); // 20 + 37 + 0
  });

  it('sums done24h across all job types', () => {
    const totals = deriveTotals(sampleByJobType);
    expect(totals.totalDone24h).toBe(13); // 5 + 8 + 0
  });

  it('computes donePercent as round(totalDone / total * 100)', () => {
    const totals = deriveTotals(sampleByJobType);
    // 13/57 * 100 = 22.807... → 23
    expect(totals.donePercent).toBe(23);
  });

  it('returns donePercent=0 when total===0 (divide-by-zero guard)', () => {
    const totals = deriveTotals({});
    expect(totals.donePercent).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('returns all zeros for empty byJobType', () => {
    const totals: MetricTotals = deriveTotals({});
    expect(totals.totalQueued).toBe(0);
    expect(totals.totalRunning).toBe(0);
    expect(totals.totalDone).toBe(0);
    expect(totals.totalFailed).toBe(0);
    expect(totals.totalDone24h).toBe(0);
  });
});
