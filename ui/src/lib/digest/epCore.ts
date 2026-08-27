/**
 * Shared EP resolution primitives.
 *
 * Extracted from resolvePipeline (pipeline.ts) and solveClientEPs
 * (models/pipelineSolver.ts), which implemented this identically. The Rollout
 * solver is the third caller — hence one home rather than three copies.
 *
 * Deliberately knows nothing about models, merging, or runtimes: those differ
 * per level and stay with their own solver.
 */

/**
 * Split `order` into EP buckets at `skipAfter` boundaries, keeping only
 * members present in `active`.
 *
 * OQ-2: a skip whose anchor is NOT active still fires its boundary. The
 * boundary therefore lands after the last active member preceding the anchor.
 * Empty buckets are elided.
 */
export function bucketBySkip(
  order: string[],
  skipAfter: Record<string, boolean | undefined>,
  active: string[],
): string[][] {
  const activeSet = new Set(active);
  const buckets: string[][] = [];
  let current: string[] = [];

  for (const id of order) {
    if (activeSet.has(id)) current.push(id);
    // The skip sits AFTER this member, and fires whether or not it is active.
    if (skipAfter[id] === true && current.length > 0) {
      buckets.push(current);
      current = [];
    }
  }
  if (current.length > 0) buckets.push(current);
  return buckets;
}

/**
 * Map each cover to the EP index it fires in: one after the EP containing its
 * original. A cover of a member in the last EP creates a trailing EP. A cover
 * whose original is not in any bucket (inactive) is dropped.
 */
export function placeCovers<C extends { of: string }>(
  buckets: string[][],
  covers: C[],
): Map<number, C[]> {
  const byEp = new Map<number, C[]>();
  for (const cover of covers) {
    const originalEp = buckets.findIndex((b) => b.includes(cover.of));
    if (originalEp === -1) continue;
    const target = originalEp + 1;
    if (!byEp.has(target)) byEp.set(target, []);
    byEp.get(target)!.push(cover);
  }
  return byEp;
}
