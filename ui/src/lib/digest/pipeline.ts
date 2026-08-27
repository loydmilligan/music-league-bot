/**
 * sprint-43: Generation pipeline v1.
 * sprint-46: Extended to 'archive' releaseKind with no-merge resolver mode.
 *
 * A Pipeline is config, not code-per-release. It declares the run order for
 * sections/tasks, optional per-section model overrides, skip boundaries that
 * create EP boundaries, and covers (re-run of a track in a later EP).
 *
 * Vocabulary (from DESIGN-RATIONALE):
 *   EP     - one parallel phase: the tracks between two skips.
 *   Track  - a section (digest) or task (archive) to generate.
 *   Skip   - a serialization barrier; everything after reads prior-EP output.
 *   Merge  - adjacent same-model tracks collapse into one callOpenRouter (digest only).
 *   Cover  - a track placed in a later EP on a different model, using prior context.
 */

import type Database from 'better-sqlite3';
import { modelForSection } from './modelFor.js';
import type { SectionKind } from './llm.js';
import { bucketBySkip, placeCovers } from './epCore.js';

// Re-export SectionKind for callers that only import from pipeline.ts
export type { SectionKind };

export type Track = {
  section: string;
  /** Explicit model override; absent = modelForSection(section, db). */
  model?: string;
};

export type Cover = {
  /** Which track to re-run. */
  of: string;
  /** Cover model — MUST be specified. */
  model: string;
};

export type Pipeline = {
  releaseKind: 'digest' | 'archive';
  /** Run order. For digest: SectionKind ids. For archive: task ids. */
  order: string[];
  /** Per-track model overrides. Empty object = all tracks use DB pins / bucket default. */
  models: Partial<Record<string, string>>;
  /** A skip sits AFTER this track. */
  skipAfter: Partial<Record<string, true>>;
  /** Covers to fire in subsequent EPs. */
  covers: Cover[];
};

/** One parallel phase (tracks between two skips). */
export type EP = {
  /**
   * Groups within this EP. Digest: merged by model (one callOpenRouter per group).
   * Archive: each track is its own group of one (no merge).
   */
  groups: { model: string; sections: string[] }[];
  /** Covers firing in this EP (after their original has completed). */
  covers: Cover[];
};

/**
 * The conservative v1 default digest pipeline.
 *
 * One skip: EP0 = factual/extractive tracks (quotes, consensus, podium, chat) merged
 * on the per-section-resolved model. EP1 = voice tracks (villain, flow) reading the
 * full EP0 output as context.
 *
 * models: {} — all sections resolve through modelForSection → per-section DB pin
 *              → bucket default. This is what closes the production gap: per-section
 *              pins flow through on the first draft.
 *
 * covers: one cover of the `flow` section (the high-dependency voice section) on
 * claude-sonnet-4-5. This fires as a trailing EP2 with full accumulated context.
 * Cost note: every fresh digest now fires ONE extra LLM call for the flow cover.
 * The original flow output is retained as the default; the cover is offered for
 * A/B review in the digest UI (sprint-44). Intentional premium-where-it-matters.
 */
export const DEFAULT_PIPELINE: Pipeline = {
  releaseKind: 'digest',
  // sprint-storylines: 'storylines' is factual/extractive (fed by curated
  // evidence, not free narrative), so it joins EP0 alongside quotes/consensus/podium.
  order: ['quotes', 'consensus', 'podium', 'storylines', 'chat', 'villain', 'flow'],
  models: {},
  skipAfter: { chat: true },
  covers: [{ of: 'flow', model: 'anthropic/claude-sonnet-4-5' }],
};

/**
 * The b-side archive task ids (verified against buildReadModel.ts runPrediction calls).
 * taste-fingerprint is an input, not a published b-side track — excluded.
 */
export const ARCHIVE_TASK_KINDS = [
  'narrative-player-superlatives',
  'narrative-fan-hater-blurbs',
  'narrative-league-reel',
  'narrative-moment-lines',
  'profile-spectrum',
  'profile-playlist',
  'season-update',
] as const;
export type ArchiveTaskKind = (typeof ARCHIVE_TASK_KINDS)[number];

/**
 * Conservative default archive pipeline.
 *
 * No skips (all tasks in one EP — parallel), no covers, no model overrides.
 * Degenerate guarantee: this pipeline with resolvePipeline reproduces today's
 * buildReadModel behavior — same runPrediction calls, same task ids (contract #5).
 */
export const ARCHIVE_DEFAULT_PIPELINE: Pipeline = {
  releaseKind: 'archive',
  order: [...ARCHIVE_TASK_KINDS],
  models: {},
  skipAfter: {},
  covers: [],
};

/**
 * Resolve a Pipeline into an ordered EP array.
 *
 * @param pipeline       - The pipeline config.
 * @param activeSections - Sections/tasks that are currently active.
 *   For digest: active SectionKind ids. For archive: active task ids.
 * @param db             - League DB; used to resolve per-section models when the
 *   pipeline's `models` map has no explicit override.
 * @returns Ordered EP array; empty EPs are elided.
 *
 * Digest degenerate case guarantee:
 *   A digest pipeline with skipAfter = {}, covers = [], and all active sections
 *   resolving to the same model returns exactly:
 *     [{ groups: [{ model, sections: allActive }], covers: [] }]
 *   — one EP, one group, one callOpenRouter.
 *
 * Archive mode:
 *   Each track is ALWAYS its own group (no merge), regardless of model.
 *   Skips still create EP boundaries; covers still fire in trailing EPs.
 *
 * Edge case (OQ-2): if a skipAfter anchor section is not in activeSections (e.g.
 *   chat is disabled), the skip effectively fires after the last section in
 *   pipeline.order that appears before the anchor. Implemented by tracking the
 *   position of the anchor in the unfiltered order and splitting active sections
 *   at the corresponding position boundary.
 */
export function resolvePipeline(
  pipeline: Pipeline,
  activeSections: string[],
  db: Database.Database,
): EP[] {
  // Resolve model for each section: pipeline.models override → modelForSection fallback.
  const resolveModel = (section: string): string =>
    pipeline.models[section] ?? modelForSection(section, db);

  const epBuckets = bucketBySkip(pipeline.order, pipeline.skipAfter as Record<string, boolean>, activeSections);
  const coversByEp = placeCovers(epBuckets, pipeline.covers);

  // Determine total EP count, adding a trailing EP if needed for covers.
  const totalEps = coversByEp.size > 0
    ? Math.max(epBuckets.length, ...Array.from(coversByEp.keys()).map(k => k + 1))
    : epBuckets.length;

  // Build EP objects.
  const eps: EP[] = [];
  for (let i = 0; i < totalEps; i++) {
    const bucket = epBuckets[i] ?? [];
    const covers = coversByEp.get(i) ?? [];

    let groups: { model: string; sections: string[] }[];

    if (pipeline.releaseKind === 'archive') {
      // Archive mode: each track is its own group — no merge, ever.
      groups = bucket.map(section => ({ model: resolveModel(section), sections: [section] }));
    } else {
      // Digest mode: group tracks by resolved model, preserving order within each group.
      const modelOrder: string[] = [];
      const groupMap = new Map<string, string[]>();
      for (const section of bucket) {
        const model = resolveModel(section);
        if (!groupMap.has(model)) {
          groupMap.set(model, []);
          modelOrder.push(model);
        }
        groupMap.get(model)!.push(section);
      }
      groups = modelOrder.map(model => ({ model, sections: groupMap.get(model)! }));
    }

    // Elide empty EPs that have no groups and no covers.
    if (groups.length === 0 && covers.length === 0) continue;

    eps.push({ groups, covers });
  }

  return eps;
}
