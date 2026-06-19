/**
 * Client-side EP solver — mirrors resolvePipeline from pipeline.ts but requires
 * no DB handle. Uses a pre-resolved bucketDefault instead of modelForSection().
 *
 * Exported separately so the parity vitest can import it directly.
 */
import type { Pipeline, Cover } from '../digest/pipeline.js';

export type ClientEP = {
  groups: { model: string; sections: string[] }[];
  covers: Cover[];
};

/**
 * Resolve a Pipeline into ClientEP array.
 *
 * @param pipeline       - The working-copy pipeline.
 * @param activeSections - Sections to include (typically pipeline.order for the editor).
 * @param bucketDefault  - The effective digest-bucket model used when a section
 *                         has no pipeline.models override (mirrors modelForSection fallback).
 */
export function solveClientEPs(
  pipeline: Pipeline,
  activeSections: string[],
  bucketDefault: string,
): ClientEP[] {
  const activeSet = new Set(activeSections);
  const models = pipeline.models as Record<string, string>;
  const skipAfter = pipeline.skipAfter as Record<string, boolean>;

  const resolveModel = (sec: string): string => models[sec] ?? bucketDefault;

  // Split pipeline.order into EP buckets at skipAfter boundaries.
  // An inactive anchor still fires the boundary (mirrors OQ-2 in resolvePipeline).
  const epBuckets: string[][] = [];
  let cur: string[] = [];
  for (const sec of pipeline.order) {
    if (activeSet.has(sec)) cur.push(sec);
    if (skipAfter[sec] === true) {
      if (cur.length > 0) { epBuckets.push(cur); cur = []; }
    }
  }
  if (cur.length > 0) epBuckets.push(cur);

  // Place covers into the EP slot after the one containing their original section.
  const coversByEp = new Map<number, Cover[]>();
  for (const cover of pipeline.covers) {
    let origIdx = -1;
    for (let i = 0; i < epBuckets.length; i++) {
      if (epBuckets[i].includes(cover.of)) { origIdx = i; break; }
    }
    if (origIdx === -1) continue;
    const coverIdx = origIdx + 1;
    if (!coversByEp.has(coverIdx)) coversByEp.set(coverIdx, []);
    coversByEp.get(coverIdx)!.push(cover);
  }

  const totalEps = coversByEp.size > 0
    ? Math.max(epBuckets.length, ...Array.from(coversByEp.keys()).map((k) => k + 1))
    : epBuckets.length;

  const eps: ClientEP[] = [];
  for (let i = 0; i < totalEps; i++) {
    const bucket = epBuckets[i] ?? [];
    const covers = coversByEp.get(i) ?? [];

    const modelOrder: string[] = [];
    const groupMap = new Map<string, string[]>();
    for (const sec of bucket) {
      const model = resolveModel(sec);
      if (!groupMap.has(model)) { groupMap.set(model, []); modelOrder.push(model); }
      groupMap.get(model)!.push(sec);
    }

    const groups = modelOrder.map((model) => ({ model, sections: groupMap.get(model)! }));
    if (groups.length === 0 && covers.length === 0) continue;
    eps.push({ groups, covers });
  }

  return eps;
}
