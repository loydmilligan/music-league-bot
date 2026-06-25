/**
 * metricTiles.ts — Pure helper for Song Metadata Queue metric tile labels.
 *
 * Data-only module (no Svelte) so it stays unit-testable without a Svelte harness.
 * Pattern mirrors ladder.ts from Task 1.
 *
 * Monotonic color rule (enforced in MetricTiles.svelte, documented here):
 *   queued  → text-sky/60 (dim-sky)   — NOT yellow/warn
 *   running → text-sky                — NOT orange/accent
 *   done    → text-health (green)
 *   failed  → text-amber              — amber only for failures
 *   accent  → ONLY for the selected-tile affordance (border/ring), NEVER as a count color
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filter states for the metric tiles panel. */
export type Filter = 'all' | 'done' | 'running' | 'queued' | 'failed';

/**
 * Extended JobCounts shape — includes `done` (lifetime) from Task 2's API addition.
 * The `done` field = total - pending - processing - failed (computed server-side).
 */
export interface MetricJobCounts {
  pending: number;
  processing: number;
  done24h: number;
  failed: number;
  total: number;
  done: number; // lifetime done
}

/** Derived scope totals for rendering the 4 metric tiles. */
export interface MetricTotals {
  totalQueued: number;    // Σ pending
  totalRunning: number;   // Σ processing
  totalDone: number;      // Σ done (lifetime)
  totalFailed: number;    // Σ failed
  total: number;          // Σ total
  totalDone24h: number;   // Σ done24h
  donePercent: number;    // round(totalDone / total * 100), 0 when total===0
}

// ---------------------------------------------------------------------------
// deriveTotals — aggregate byJobType into MetricTotals
// ---------------------------------------------------------------------------

/**
 * Sum a byJobType map into a MetricTotals bag.
 *
 * Songs-in-scope estimate: when coverageMatrix is available (round scope),
 * callers should pass coverageMatrix.length as approxSongs to failedLabel.
 * For all/league/season scope, approxSongs = Math.ceil(total / 4) is a reasonable
 * approximation (typical songs have 4–5 job types; audio is optional, so dividing
 * by 4 gives a conservative upper bound). The "~" prefix in the label signals
 * the value is approximate.
 */
export function deriveTotals(byJobType: Record<string, MetricJobCounts>): MetricTotals {
  let totalQueued = 0;
  let totalRunning = 0;
  let totalDone = 0;
  let totalFailed = 0;
  let total = 0;
  let totalDone24h = 0;

  for (const c of Object.values(byJobType)) {
    totalQueued += c.pending;
    totalRunning += c.processing;
    totalDone += c.done;
    totalFailed += c.failed;
    total += c.total;
    totalDone24h += c.done24h;
  }

  const donePercent = total === 0 ? 0 : Math.round((totalDone / total) * 100);

  return { totalQueued, totalRunning, totalDone, totalFailed, total, totalDone24h, donePercent };
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

/**
 * Failed tile sub-label.
 * Example: failedLabel(441, 110) → "Failed 441 · jobs across ~110 songs"
 *
 * The "~" prefix is LITERAL — it signals the song count is approximate.
 * The label answers "does 441 mean songs or elements?" inline by stating
 * that 441 counts jobs (not songs) and providing the ~song estimate.
 */
export function failedLabel(jobs: number, approxSongs: number): string {
  return `Failed ${jobs} · jobs across ~${approxSongs} songs`;
}

/**
 * Done tile sub-label — percent of scope complete.
 * Example: doneLabel(600, 1000) → "60% of 1000 in scope"
 */
export function doneLabel(done: number, total: number): string {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return `${percent}% of ${total} in scope`;
}

/**
 * Done tile 24h sub-stat — shown SEPARATELY from lifetime done.
 * Global constraint: keep the "done today" metric distinct from the lifetime count.
 * Example: doneSubLabel(42) → "· 42 in last 24h"
 */
export function doneSubLabel(done24h: number): string {
  return `· ${done24h} in last 24h`;
}
