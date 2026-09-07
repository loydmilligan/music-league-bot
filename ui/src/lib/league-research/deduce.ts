// Pure deduction engine for the Voting Replay panel. No DB, no Svelte, no fetch.
// See docs/superpowers/specs/2026-09-07-voting-replay-design.md
import type { GlanceSeverity } from './replayTypes.js';

const FRACTIONS: Record<Exclude<GlanceSeverity, 4>, number[]> = {
  1: [0, 1],
  2: [0, 0.5, 1],
  3: [0, 0.25, 0.5, 0.75, 1],
};

/**
 * Ballot-indexed glance schedule. The Music League page shows who has voted, so
 * a "glance" is anchored to ballots, not to the clock.
 */
export function checkpoints(myPos: number, partnerPos: number, gs: GlanceSeverity): number[] {
  const n = partnerPos - myPos - 1;
  if (n <= 0) return [myPos];
  if (gs === 4) return Array.from({ length: n + 1 }, (_, i) => myPos + i);
  return [...new Set(FRACTIONS[gs].map((f) => myPos + Math.ceil(f * n)))].sort((a, b) => a - b);
}
