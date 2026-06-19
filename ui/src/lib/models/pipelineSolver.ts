/**
 * Client-side EP solver — mirrors resolvePipeline from pipeline.ts but requires
 * no DB handle. Uses a pre-resolved bucketDefault instead of modelForSection().
 *
 * Exported separately so the parity vitest can import it directly.
 *
 * sprint-46 (b2): added archive no-merge mode. When releaseKind === 'archive',
 * each track is its own group (never merged with adjacent same-model tracks).
 */
import type { Pipeline } from '../digest/pipeline.js';

export type ClientEP = {
  groups: { model: string; sections: string[] }[];
  covers: { of: string; model: string }[];
};

/**
 * Local extended pipeline type for archive configs.
 * Lane A will export this from pipeline.ts once the releaseKind union lands;
 * until then, pipelineSolver owns this definition for the client side.
 */
export type ArchivePipelineInput = {
  releaseKind: 'archive';
  order: string[];
  models: Record<string, string>;
  skipAfter: Record<string, true>;
  covers: { of: string; model: string }[];
};

/**
 * Resolve a Pipeline into ClientEP array.
 *
 * @param pipeline       - The working-copy pipeline (digest or archive).
 * @param activeSections - Sections to include (typically pipeline.order for the editor).
 * @param bucketDefault  - The effective bucket model used when a section
 *                         has no pipeline.models override (mirrors modelForSection fallback).
 *
 * Digest mode (releaseKind === 'digest'): adjacent same-model tracks are merged into
 * one group per EP (one LLM call per group).
 *
 * Archive mode (releaseKind === 'archive'): each track is its own group — NO merge.
 * Skips still split EPs; covers still go to the trailing EP after their original.
 */
export function solveClientEPs(
  pipeline: Pipeline | ArchivePipelineInput,
  activeSections: string[],
  bucketDefault: string,
): ClientEP[] {
  const activeSet = new Set(activeSections);
  const models = pipeline.models as Record<string, string>;
  const skipAfter = pipeline.skipAfter as Record<string, boolean>;
  const isArchive = pipeline.releaseKind === 'archive';

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
  const coversByEp = new Map<number, { of: string; model: string }[]>();
  for (const cover of pipeline.covers) {
    const coverOf = cover.of as string;
    let origIdx = -1;
    for (let i = 0; i < epBuckets.length; i++) {
      if (epBuckets[i].includes(coverOf)) { origIdx = i; break; }
    }
    if (origIdx === -1) continue;
    const coverIdx = origIdx + 1;
    if (!coversByEp.has(coverIdx)) coversByEp.set(coverIdx, []);
    coversByEp.get(coverIdx)!.push({ of: coverOf, model: cover.model });
  }

  const totalEps = coversByEp.size > 0
    ? Math.max(epBuckets.length, ...Array.from(coversByEp.keys()).map((k) => k + 1))
    : epBuckets.length;

  const eps: ClientEP[] = [];
  for (let i = 0; i < totalEps; i++) {
    const bucket = epBuckets[i] ?? [];
    const covers = coversByEp.get(i) ?? [];

    let groups: { model: string; sections: string[] }[];

    if (isArchive) {
      // Archive: each track is its own call — NO merge, regardless of model.
      groups = bucket.map((sec) => ({ model: resolveModel(sec), sections: [sec] }));
    } else {
      // Digest: group adjacent same-model tracks into one call.
      const modelOrder: string[] = [];
      const groupMap = new Map<string, string[]>();
      for (const sec of bucket) {
        const model = resolveModel(sec);
        if (!groupMap.has(model)) { groupMap.set(model, []); modelOrder.push(model); }
        groupMap.get(model)!.push(sec);
      }
      groups = modelOrder.map((model) => ({ model, sections: groupMap.get(model)! }));
    }

    if (groups.length === 0 && covers.length === 0) continue;
    eps.push({ groups, covers });
  }

  return eps;
}
