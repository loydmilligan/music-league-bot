/**
 * heatmapView.ts — Pure helper functions for the HeatmapView component.
 *
 * Data-only module (no Svelte) so it stays unit-testable.
 *
 * Monotonic grey→green colour scale:
 *   0%    → bg-fg-faint/15  (darkest grey — no data)
 *   1–25  → bg-health/20    (faint green)
 *   26–50 → bg-health/40
 *   51–75 → bg-health/60
 *   76–99 → bg-health/80
 *   100%  → bg-health       (full green)
 *
 * Border signals (sky = running; amber = failure):
 *   processing > 0 → 'sky'   (running takes priority)
 *   failed > 0     → 'amber'
 *   else           → 'none'
 */

// ---------------------------------------------------------------------------
// heatBucket
// ---------------------------------------------------------------------------

/**
 * Map a completion percentage (0–100) to a Tailwind bg class.
 * Values outside [0, 100] are clamped.
 */
export function heatBucket(donePct: number): string {
	const pct = Math.max(0, Math.min(100, donePct));
	if (pct === 0) return 'bg-fg-faint/15';
	if (pct <= 25) return 'bg-health/20';
	if (pct <= 50) return 'bg-health/40';
	if (pct <= 75) return 'bg-health/60';
	if (pct < 100) return 'bg-health/80';
	return 'bg-health';
}

// ---------------------------------------------------------------------------
// cellBorder
// ---------------------------------------------------------------------------

/**
 * Return a border-colour signal for a heatmap cell.
 * - 'sky'   → cell has at least one job currently processing (running wins)
 * - 'amber' → cell has at least one failure but no running jobs
 * - 'none'  → idle / done
 */
export function cellBorder(c: { processing: number; failed: number }): 'sky' | 'amber' | 'none' {
	if (c.processing > 0) return 'sky';
	if (c.failed > 0) return 'amber';
	return 'none';
}

// ---------------------------------------------------------------------------
// JOB_ORDER for the heatmap columns
// ---------------------------------------------------------------------------

export const HEATMAP_JOB_ORDER = ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics', 'audio'] as const;
export type HeatmapJobType = (typeof HEATMAP_JOB_ORDER)[number];
