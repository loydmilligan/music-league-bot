/**
 * heatmapView.test.ts — Unit tests for pure heatmap helper functions.
 *
 * Tests:
 *   - heatBucket: % → Tailwind class name mapping (boundary coverage)
 *   - cellBorder: running/failed/none border flag (all three cases)
 */

import { describe, it, expect } from 'vitest';
import { heatBucket, cellBorder } from './heatmapView.js';

// ---------------------------------------------------------------------------
// heatBucket
// ---------------------------------------------------------------------------

describe('heatBucket', () => {
  it('returns the 0% bucket for donePct=0', () => {
    expect(heatBucket(0)).toBe('bg-fg-faint/15');
  });

  it('returns the 1-25 bucket for donePct=1', () => {
    expect(heatBucket(1)).toBe('bg-health/20');
  });

  it('returns the 1-25 bucket for donePct=25', () => {
    expect(heatBucket(25)).toBe('bg-health/20');
  });

  it('returns the 26-50 bucket for donePct=26', () => {
    expect(heatBucket(26)).toBe('bg-health/40');
  });

  it('returns the 26-50 bucket for donePct=50', () => {
    expect(heatBucket(50)).toBe('bg-health/40');
  });

  it('returns the 51-75 bucket for donePct=51', () => {
    expect(heatBucket(51)).toBe('bg-health/60');
  });

  it('returns the 51-75 bucket for donePct=75', () => {
    expect(heatBucket(75)).toBe('bg-health/60');
  });

  it('returns the 76-99 bucket for donePct=76', () => {
    expect(heatBucket(76)).toBe('bg-health/80');
  });

  it('returns the 76-99 bucket for donePct=99', () => {
    expect(heatBucket(99)).toBe('bg-health/80');
  });

  it('returns the 100% bucket for donePct=100', () => {
    expect(heatBucket(100)).toBe('bg-health');
  });

  it('clamps values above 100 to the 100% bucket', () => {
    expect(heatBucket(110)).toBe('bg-health');
  });

  it('clamps negative values to the 0% bucket', () => {
    expect(heatBucket(-5)).toBe('bg-fg-faint/15');
  });
});

// ---------------------------------------------------------------------------
// cellBorder
// ---------------------------------------------------------------------------

describe('cellBorder', () => {
  it('returns "sky" when processing > 0 (running takes priority)', () => {
    expect(cellBorder({ processing: 1, failed: 0 })).toBe('sky');
  });

  it('returns "sky" when both processing > 0 and failed > 0 (running wins)', () => {
    expect(cellBorder({ processing: 2, failed: 3 })).toBe('sky');
  });

  it('returns "amber" when processing = 0 and failed > 0', () => {
    expect(cellBorder({ processing: 0, failed: 1 })).toBe('amber');
  });

  it('returns "none" when both processing = 0 and failed = 0', () => {
    expect(cellBorder({ processing: 0, failed: 0 })).toBe('none');
  });

  it('returns "amber" for multiple failures, no processing', () => {
    expect(cellBorder({ processing: 0, failed: 5 })).toBe('amber');
  });
});
