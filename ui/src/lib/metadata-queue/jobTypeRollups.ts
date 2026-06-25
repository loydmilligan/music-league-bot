/**
 * jobTypeRollups.ts — Pure segment-width computation for per-job-type rollup bars.
 *
 * Data-only module (no Svelte) so it stays unit-testable without a Svelte harness.
 * Pattern mirrors ladder.ts from Task 1.
 *
 * Segment order (monotonic left→right):
 *   done (green) → running (sky + shimmer) → queued (dim-sky) → failed (amber) → missing (grey)
 *
 * Denominator: `total` (queue rows for this job type, as returned by the API).
 * "missing" = total − done − running − queued − failed (slots with no queue row).
 * If total === 0, returns [] (empty array — no NaN, no divide-by-zero).
 */

import type { JobCounts } from './ladder.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SegmentStatus = 'done' | 'running' | 'queued' | 'failed' | 'missing';

export interface Segment {
  status: SegmentStatus;
  widthPct: number;
  /** Tailwind class string for the segment background + optional animation. */
  className: string;
}

// ---------------------------------------------------------------------------
// Segment colors (monotonic, no accent/orange)
// ---------------------------------------------------------------------------

const SEGMENT_CLASS: Record<SegmentStatus, string> = {
  done:    'bg-health',
  running: 'bg-sky seg--running',
  queued:  'bg-sky/40',
  failed:  'bg-amber',
  missing: 'bg-fg-faint/20',
};

// ---------------------------------------------------------------------------
// segments() — pure function, exported and unit-tested
// ---------------------------------------------------------------------------

/**
 * Convert a JobCounts bag into an ordered array of display segments.
 *
 * - Denominator = counts.total (queue row count for this job type).
 * - Segments with count === 0 are omitted (no zero-width slivers).
 * - Total === 0 → returns [] (avoids NaN from 0/0).
 * - Widths are computed as (count / total) * 100 and may have floating-point
 *   sub-percent values; summing all will be ≈ 100 (rounding tolerance ±0.1).
 *
 * "done" count = total − pending − processing − failed (mirrors jobDone() in +page.svelte).
 */
export function segments(counts: JobCounts): Segment[] {
  const { pending, processing, failed, total } = counts;
  if (total === 0) return [];

  const done = Math.max(0, total - pending - processing - failed);
  const running = processing;
  const queued = pending;
  const missing = Math.max(0, total - done - running - queued - failed);

  const entries: Array<[SegmentStatus, number]> = [
    ['done',    done],
    ['running', running],
    ['queued',  queued],
    ['failed',  failed],
    ['missing', missing],
  ];

  return entries
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      status,
      widthPct: (count / total) * 100,
      className: SEGMENT_CLASS[status],
    }));
}
