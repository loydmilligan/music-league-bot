import { it, expect, describe } from 'vitest';
import { segments } from './jobTypeRollups.js';
import type { JobCounts } from './ladder.js';

// ---------------------------------------------------------------------------
// segments() — pure segment width computation
// ---------------------------------------------------------------------------

describe('segments', () => {
  it('widths sum to ~100 for a mixed-status input', () => {
    // done=6, processing=2, pending=1, failed=1 → total=10
    const counts: JobCounts = { pending: 1, processing: 2, done24h: 0, failed: 1, total: 10 };
    const segs = segments(counts);
    const total = segs.reduce((s, seg) => s + seg.widthPct, 0);
    expect(total).toBeCloseTo(100, 1); // within 0.1%
  });

  it('running segment carries className including seg--running', () => {
    const counts: JobCounts = { pending: 1, processing: 2, done24h: 0, failed: 1, total: 10 };
    const segs = segments(counts);
    const runningSeg = segs.find((s) => s.status === 'running');
    expect(runningSeg).toBeDefined();
    expect(runningSeg?.className).toContain('seg--running');
  });

  it('total === 0 → empty array (no NaN, no divide-by-zero)', () => {
    const counts: JobCounts = { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0 };
    const segs = segments(counts);
    // No segments — nothing to show
    expect(segs).toHaveLength(0);
    // Ensure no NaN anywhere
    for (const s of segs) {
      expect(Number.isNaN(s.widthPct)).toBe(false);
    }
  });

  it('done-only input yields exactly one full-width done segment', () => {
    const counts: JobCounts = { pending: 0, processing: 0, done24h: 5, failed: 0, total: 8 };
    const segs = segments(counts);
    expect(segs).toHaveLength(1);
    expect(segs[0].status).toBe('done');
    expect(segs[0].widthPct).toBeCloseTo(100, 1);
  });

  it('a status with count === 0 produces no segment', () => {
    // pending=0, processing=0, failed=0 → only done segment
    const counts: JobCounts = { pending: 0, processing: 0, done24h: 0, failed: 0, total: 5 };
    const segs = segments(counts);
    // done = total - pending - processing - failed = 5
    expect(segs.every((s) => s.widthPct > 0)).toBe(true);
    // No running, queued, or failed segments
    expect(segs.find((s) => s.status === 'running')).toBeUndefined();
    expect(segs.find((s) => s.status === 'queued')).toBeUndefined();
    expect(segs.find((s) => s.status === 'failed')).toBeUndefined();
  });

  it('segment order is monotonic: done → running → queued → failed → missing', () => {
    // All statuses present: done=4, running=2, queued=1, failed=1, missing=2 → total=10
    const counts: JobCounts = { pending: 1, processing: 2, done24h: 0, failed: 1, total: 10 };
    const segs = segments(counts);
    const order = ['done', 'running', 'queued', 'failed', 'missing'] as const;
    // Filter to only statuses that appear
    const presentOrder = order.filter((st) => segs.find((s) => s.status === st));
    const actualOrder = segs.map((s) => s.status);
    expect(actualOrder).toEqual(presentOrder);
  });

  it('widthPct of each segment equals (count / total) * 100', () => {
    const counts: JobCounts = { pending: 2, processing: 3, done24h: 0, failed: 1, total: 10 };
    const segs = segments(counts);
    // done = 10 - 2 - 3 - 1 = 4
    const doneSeg = segs.find((s) => s.status === 'done');
    expect(doneSeg?.widthPct).toBeCloseTo(40, 1);
    const runningSeg = segs.find((s) => s.status === 'running');
    expect(runningSeg?.widthPct).toBeCloseTo(30, 1);
    const queuedSeg = segs.find((s) => s.status === 'queued');
    expect(queuedSeg?.widthPct).toBeCloseTo(20, 1);
    const failedSeg = segs.find((s) => s.status === 'failed');
    expect(failedSeg?.widthPct).toBeCloseTo(10, 1);
  });
});
