/**
 * sprint-43 a1: Unit tests for resolvePipeline.
 *
 * Covers:
 *   - Degenerate pipeline (no skips, one model) → 1 EP, 1 group [REGRESSION GUARD §5]
 *   - Two-model no-skip pipeline → 1 EP, 2 groups
 *   - One-skip pipeline → 2 EPs
 *   - Cover placed into trailing EP
 *   - activeSections filter: disabled section excluded
 *   - OQ-2 edge case: skipAfter anchor not in activeSections
 */

import { it, expect, describe, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { resolvePipeline, DEFAULT_PIPELINE, type Pipeline } from './pipeline.js';
import type { SectionKind } from './llm.js';

// Minimal DB mock: modelForSection reads settings via DB.prepare().get().
// We return undefined (no pin) so modelForSection falls back to modelFor(bucket, db)
// which also reads from DB. Provide a stubbed prepare that returns different
// values based on the key queried.
function makeDb(pinMap: Partial<Record<string, string>> = {}, bucketModel = 'default-model'): Database.Database {
  return {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn((key: string) => {
        // settings WHERE key = ?
        if (sql.includes('settings')) {
          const val = pinMap[key];
          return val !== undefined ? { value: val } : undefined;
        }
        return undefined;
      }),
      all: vi.fn(() => []),
    })),
  } as unknown as Database.Database;
}

// All sections map to the same model (no per-section pins, bucket model is uniform).
function makeUniformDb(model: string): Database.Database {
  return makeDb({
    // bucket defaults for both 'predict_model' and 'digest_model'
    digest_model: model,
    predict_model: model,
  });
}

// DB that returns a specific model for a given section pin key, else a default.
function makePinDb(sectionPins: Partial<Record<string, string>>, defaultModel = 'base-model'): Database.Database {
  const pinMap: Record<string, string> = { digest_model: defaultModel, predict_model: defaultModel };
  for (const [section, model] of Object.entries(sectionPins)) {
    pinMap[`digest_model_${section}`] = model;
  }
  return makeDb(pinMap, defaultModel);
}

const ALL_ACTIVE: SectionKind[] = ['quotes', 'consensus', 'podium', 'chat', 'villain', 'flow'];

describe('resolvePipeline — degenerate case (regression guard)', () => {
  it('no skips, one model for all sections → exactly 1 EP with 1 group', () => {
    const db = makeUniformDb('anthropic/claude-sonnet-4-5');
    const pipeline: Pipeline = {
      releaseKind: 'digest',
      order: ALL_ACTIVE,
      models: {},
      skipAfter: {},
      covers: [],
    };
    const eps = resolvePipeline(pipeline, ALL_ACTIVE, db);
    expect(eps).toHaveLength(1);
    expect(eps[0].groups).toHaveLength(1);
    expect(eps[0].groups[0].model).toBe('anthropic/claude-sonnet-4-5');
    expect(eps[0].groups[0].sections).toEqual(ALL_ACTIVE);
    expect(eps[0].covers).toHaveLength(0);
  });
});

describe('resolvePipeline — two-model no-skip pipeline', () => {
  it('two models, no skips → 1 EP, 2 groups', () => {
    // villain and flow get a premium pin; the rest use the default
    const db = makePinDb({ villain: 'premium-model', flow: 'premium-model' }, 'base-model');
    const pipeline: Pipeline = {
      releaseKind: 'digest',
      order: ALL_ACTIVE,
      models: {},
      skipAfter: {},
      covers: [],
    };
    const eps = resolvePipeline(pipeline, ALL_ACTIVE, db);
    expect(eps).toHaveLength(1);
    expect(eps[0].groups).toHaveLength(2);
    const baseGroup = eps[0].groups.find(g => g.model === 'base-model');
    const premiumGroup = eps[0].groups.find(g => g.model === 'premium-model');
    expect(baseGroup?.sections).toEqual(['quotes', 'consensus', 'podium', 'chat']);
    expect(premiumGroup?.sections).toEqual(['villain', 'flow']);
  });
});

describe('resolvePipeline — one-skip pipeline (DEFAULT_PIPELINE shape)', () => {
  it('skipAfter chat → EP0 = [quotes,consensus,podium,chat], EP1 = [villain,flow]', () => {
    const db = makeUniformDb('base-model');
    const eps = resolvePipeline(DEFAULT_PIPELINE, ALL_ACTIVE, db);
    expect(eps).toHaveLength(2);
    expect(eps[0].groups[0].sections).toEqual(['quotes', 'consensus', 'podium', 'chat']);
    expect(eps[1].groups[0].sections).toEqual(['villain', 'flow']);
  });

  it('EP0 and EP1 each have exactly 1 group when all sections use the same model', () => {
    const db = makeUniformDb('base-model');
    const eps = resolvePipeline(DEFAULT_PIPELINE, ALL_ACTIVE, db);
    expect(eps[0].groups).toHaveLength(1);
    expect(eps[1].groups).toHaveLength(1);
  });

  it('villain pinned to premium model → EP1 has 2 groups', () => {
    const db = makePinDb({ villain: 'premium-model' }, 'base-model');
    const eps = resolvePipeline(DEFAULT_PIPELINE, ALL_ACTIVE, db);
    expect(eps[1].groups).toHaveLength(2);
    const villainGroup = eps[1].groups.find(g => g.sections.includes('villain'));
    const flowGroup = eps[1].groups.find(g => g.sections.includes('flow'));
    expect(villainGroup?.model).toBe('premium-model');
    expect(flowGroup?.model).toBe('base-model');
  });
});

describe('resolvePipeline — covers', () => {
  it('cover of a section in EP0 is placed in EP1', () => {
    const db = makeUniformDb('base-model');
    // podium is in EP0 (before the chat skip boundary); its cover goes to EP1.
    const pipeline: Pipeline = {
      ...DEFAULT_PIPELINE,
      covers: [{ of: 'podium', model: 'premium-model' }],
    };
    const eps = resolvePipeline(pipeline, ALL_ACTIVE, db);
    // EP1 (the voice EP) should contain the cover for podium
    expect(eps).toHaveLength(2);
    const ep1 = eps[1];
    expect(ep1.covers).toHaveLength(1);
    expect(ep1.covers[0].of).toBe('podium');
    expect(ep1.covers[0].model).toBe('premium-model');
  });

  it('cover of a section in last EP creates a trailing EP', () => {
    const db = makeUniformDb('base-model');
    // No skips — all sections in one EP. Cover of flow → needs EP1 (trailing).
    const pipeline: Pipeline = {
      releaseKind: 'digest',
      order: ALL_ACTIVE,
      models: {},
      skipAfter: {},
      covers: [{ of: 'flow', model: 'premium-model' }],
    };
    const eps = resolvePipeline(pipeline, ALL_ACTIVE, db);
    expect(eps).toHaveLength(2);
    expect(eps[0].groups[0].sections).toEqual(ALL_ACTIVE);
    expect(eps[1].covers).toHaveLength(1);
    expect(eps[1].covers[0].of).toBe('flow');
    expect(eps[1].groups).toHaveLength(0);
  });
});

describe('resolvePipeline — activeSections filter', () => {
  it('excludes a disabled section from all EPs', () => {
    const db = makeUniformDb('base-model');
    const pipeline: Pipeline = {
      ...DEFAULT_PIPELINE,
      skipAfter: {},
      covers: [],
    };
    const active: SectionKind[] = ['quotes', 'consensus', 'podium', 'villain', 'flow']; // no chat
    const eps = resolvePipeline(pipeline, active, db);
    expect(eps).toHaveLength(1);
    const allSections = eps[0].groups.flatMap(g => g.sections);
    expect(allSections).not.toContain('chat');
    expect(allSections).toEqual(active);
  });

  it('OQ-2: skipAfter anchor (chat) not in activeSections still creates EP boundary', () => {
    const db = makeUniformDb('base-model');
    // chat is not in activeSections — the skip still fires at the chat position in order
    // so podium (last before chat in order) ends EP0, villain+flow are in EP1.
    const active: SectionKind[] = ['quotes', 'consensus', 'podium', 'villain', 'flow'];
    const eps = resolvePipeline(DEFAULT_PIPELINE, active, db);
    expect(eps).toHaveLength(2);
    expect(eps[0].groups[0].sections).toEqual(['quotes', 'consensus', 'podium']);
    expect(eps[1].groups[0].sections).toEqual(['villain', 'flow']);
  });
});
