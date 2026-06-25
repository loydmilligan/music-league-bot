/**
 * queueSongCard.ts — Pure data helpers for QueueSongCard.
 *
 * Data-only module (no Svelte) so it stays unit-testable.
 *
 * Maps CoverageRow job states to LADDER-derived pill descriptors and
 * counts actionable elements for the "run N missing" control.
 */

import { LADDER } from './ladder.js';
import type { ElementState } from './ladder.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PillDescriptor {
  /** Visual glyph from LADDER (e.g. '✓', '⟳', '○') */
  glyph: string;
  /** Tailwind fg class from LADDER (e.g. 'text-health', 'text-sky') */
  toneClass: string;
  /** Human label for the state */
  label: string;
}

export type CoverageState = 'done' | 'processing' | 'pending' | 'failed' | 'missing';

// ---------------------------------------------------------------------------
// ladderKey — map CoverageState → ElementState for LADDER lookup
// ---------------------------------------------------------------------------

/**
 * Pure mapping from CoverageState to ElementState.
 * Used to index into LADDER for .soft and .border classes.
 *
 * Bridge:
 *   done       → 'done'
 *   processing → 'running'
 *   pending    → 'queued'
 *   failed     → 'failedHard'
 *   missing    → 'missing'
 */
export function ladderKey(state: CoverageState): ElementState {
  const map: Record<CoverageState, ElementState> = {
    done:       'done',
    processing: 'running',
    pending:    'queued',
    failed:     'failedHard',
    missing:    'missing',
  };
  return map[state];
}

// ---------------------------------------------------------------------------
// coverageStatePill — map a coverage state to a LADDER-derived pill
// ---------------------------------------------------------------------------

/**
 * Maps a CoverageRow job state to a pill descriptor sourced from LADDER.
 * Bridge:
 *   done       → LADDER.done
 *   processing → LADDER.running
 *   pending    → LADDER.queued
 *   failed     → LADDER.failedHard
 *   missing    → LADDER.missing
 *
 * Accent is NEVER used as a status — only LADDER fg values are used.
 */
export function coverageStatePill(state: CoverageState): PillDescriptor {
  const ladderMap: Record<CoverageState, ElementState> = {
    done:       'done',
    processing: 'running',
    pending:    'queued',
    failed:     'failedHard',
    missing:    'missing',
  };

  const labelMap: Record<CoverageState, string> = {
    done:       'done',
    processing: 'running',
    pending:    'queued',
    failed:     'failed',
    missing:    'missing',
  };

  const ladderState = ladderMap[state];
  const entry = LADDER[ladderState];

  return {
    glyph:     entry.glyph,
    toneClass: entry.fg,
    label:     labelMap[state],
  };
}

// ---------------------------------------------------------------------------
// runMissingCount — count actionable elements (excludes done + processing)
// ---------------------------------------------------------------------------

/**
 * Returns the number of job elements that are actionable:
 * missing, pending, or failed. Excludes done and processing.
 *
 * This is the count used for the "run N missing" control.
 */
export function runMissingCount(
  jobs: Record<string, CoverageState>
): number {
  return Object.values(jobs).filter(
    state => state !== 'done' && state !== 'processing'
  ).length;
}
