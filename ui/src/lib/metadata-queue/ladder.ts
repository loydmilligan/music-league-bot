/**
 * ladder.ts — Status ladder foundation for Song Metadata Queue.
 *
 * Data-only module (no Svelte) so it stays unit-testable.
 *
 * Monotonic constraint: missing(grey) → queued(dim-sky) → running(sky) → done(green)
 * Amber/ember ONLY for real failures. Orange/accent NEVER used as status.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ElementState =
  | 'missing'
  | 'queued'
  | 'running'
  | 'done'
  | 'failedRetry'
  | 'failedHard';

export interface LadderEntry {
  glyph: string;
  fg: string;
  soft: string;
  border: string;
  pulse?: true;
}

/** Shape of job counts from the metadata queue worker */
export interface JobCounts {
  pending: number;
  processing: number;
  done24h: number;
  failed: number;
  total: number;
}

export type RollupTone = 'sky' | 'amber' | 'health' | 'muted';

export interface RollupChip {
  label: string;
  tone: RollupTone;
}

// ---------------------------------------------------------------------------
// LADDER map
// ---------------------------------------------------------------------------

export const LADDER: Record<ElementState, LadderEntry> = {
  missing: {
    glyph: '○',
    fg: 'text-fg-faint',
    soft: 'bg-surface',
    border: 'border-border-muted',
  },
  queued: {
    glyph: '◌',
    fg: 'text-sky/60',
    soft: 'bg-sky-bg',
    border: 'border-sky/20',
  },
  running: {
    glyph: '⟳',
    fg: 'text-sky',
    soft: 'bg-sky-bg',
    border: 'border-sky/40',
    pulse: true,
  },
  done: {
    glyph: '✓',
    fg: 'text-health',
    soft: 'bg-health-bg',
    border: 'border-health/40',
  },
  failedRetry: {
    glyph: '↻',
    fg: 'text-amber',
    soft: 'bg-surface',
    border: 'border-amber/40',
  },
  failedHard: {
    glyph: '✕',
    fg: 'text-ember',
    soft: 'bg-ember-bg',
    border: 'border-ember/40',
  },
};

// ---------------------------------------------------------------------------
// rollupChip — summarise a JobCounts bag into a single chip label + tone
// Priority: total===0 → running → failed → pending → done
// ---------------------------------------------------------------------------

export function rollupChip(c: JobCounts): RollupChip {
  if (c.total === 0) {
    return { label: 'no data', tone: 'muted' };
  }
  if (c.processing > 0) {
    return { label: 'running', tone: 'sky' };
  }
  if (c.failed > 0) {
    return { label: `${c.failed} failed`, tone: 'amber' };
  }
  if (c.pending > 0) {
    return { label: `${c.pending} to go`, tone: 'sky' };
  }
  return { label: 'done', tone: 'health' };
}
