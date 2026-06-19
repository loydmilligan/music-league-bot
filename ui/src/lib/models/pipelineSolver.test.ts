/**
 * sprint-46 b2: pipelineSolver parity test.
 *
 * Asserts that solveClientEPs (client EP solver) produces the same EP structure
 * as resolvePipeline (server resolver) for both digest and archive configs.
 *
 * Digest parity: existing DEFAULT_PIPELINE behavior is preserved.
 *
 * Archive parity (no-merge rule): when releaseKind === 'archive', each track
 * must be its own group in both the client and server resolvers. This test
 * exercises ARCHIVE_DEFAULT_PIPELINE + 3 edited archive configs.
 *
 * NOTE: The archive parity assertions require Lane A's archive mode extension
 * to resolvePipeline. Until Lane A lands, the archive cases will fail (the
 * server resolver currently merges all same-model tracks). They will be green
 * at the sprint-46 gate when both lanes are integrated.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { resolvePipeline, DEFAULT_PIPELINE, type Pipeline } from '../digest/pipeline.js';
import { solveClientEPs, type ArchivePipelineInput } from './pipelineSolver.js';

// ---- archive default pipeline (per contract §2) ----------------------------
// Lane A will export this from pipeline.ts once the releaseKind union lands.
const ARCHIVE_DEFAULT_PIPELINE: ArchivePipelineInput = {
  releaseKind: 'archive',
  order: [
    'narrative-player-superlatives',
    'narrative-fan-hater-blurbs',
    'narrative-league-reel',
    'narrative-moment-lines',
    'profile-spectrum',
    'profile-playlist',
    'season-update',
  ],
  models: {},
  skipAfter: {},
  covers: [],
};

// Bucket default used with empty in-memory DB — matches HARDCODED_MODEL in modelFor.ts.
const BUCKET_DEFAULT = 'anthropic/claude-sonnet-4-5';

// ---- helpers ---------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = openLeagueDb(':memory:');
});

/**
 * Normalise EP output for comparison.
 * resolvePipeline returns SectionKind[] in group.sections; solveClientEPs uses string[].
 * Both produce structurally identical objects at runtime — deep-equal comparison works.
 */
function normaliseEPs(eps: Array<{ groups: Array<{ model: string; sections: string[] }>; covers: Array<{ of: string; model: string }> }>) {
  return eps.map((ep) => ({
    groups: ep.groups.map((g) => ({ model: g.model, sections: [...g.sections] })),
    covers: ep.covers.map((c) => ({ of: c.of, model: c.model })),
  }));
}

// ---- digest parity ---------------------------------------------------------

describe('parity: digest DEFAULT_PIPELINE', () => {
  it('client == server for DEFAULT_PIPELINE (all sections active)', () => {
    const activeSections = [...DEFAULT_PIPELINE.order];
    const serverEPs = resolvePipeline(DEFAULT_PIPELINE, activeSections as Parameters<typeof resolvePipeline>[1], db);
    const clientEPs = solveClientEPs(DEFAULT_PIPELINE, activeSections, BUCKET_DEFAULT);

    expect(normaliseEPs(clientEPs)).toEqual(normaliseEPs(serverEPs));
  });

  it('client == server for DEFAULT_PIPELINE with no-chat active sections', () => {
    // chat absent: the skip still fires at the chat anchor position (OQ-2).
    const activeSections = DEFAULT_PIPELINE.order.filter((s) => s !== 'chat') as Parameters<typeof resolvePipeline>[1];
    const serverEPs = resolvePipeline(DEFAULT_PIPELINE, activeSections, db);
    const clientEPs = solveClientEPs(DEFAULT_PIPELINE, [...activeSections], BUCKET_DEFAULT);

    expect(normaliseEPs(clientEPs)).toEqual(normaliseEPs(serverEPs));
  });

  it('client == server for digest pipeline with per-section model overrides', () => {
    const customDigest: Pipeline = {
      releaseKind: 'digest',
      order: ['quotes', 'consensus', 'podium', 'villain', 'flow'],
      models: { villain: 'anthropic/claude-opus-4-8', flow: 'anthropic/claude-haiku-4-5' } as Partial<Record<string, string>> as Pipeline['models'],
      skipAfter: { podium: true } as Partial<Record<string, true>> as Pipeline['skipAfter'],
      covers: [],
    };
    const activeSections = [...customDigest.order] as Parameters<typeof resolvePipeline>[1];
    const serverEPs = resolvePipeline(customDigest, activeSections, db);
    const clientEPs = solveClientEPs(customDigest, [...activeSections], BUCKET_DEFAULT);

    expect(normaliseEPs(clientEPs)).toEqual(normaliseEPs(serverEPs));
  });
});

// ---- archive parity (no-merge rule) ----------------------------------------
// These tests verify that both resolvers treat each archive track as its own
// group. They require Lane A's archive mode extension to resolvePipeline to pass.

describe('parity: archive ARCHIVE_DEFAULT_PIPELINE (no-merge)', () => {
  it('client produces one group per track (no-merge) for ARCHIVE_DEFAULT_PIPELINE', () => {
    const activeSections = [...ARCHIVE_DEFAULT_PIPELINE.order];
    const clientEPs = solveClientEPs(ARCHIVE_DEFAULT_PIPELINE, activeSections, BUCKET_DEFAULT);

    // With no skips and no covers, all 7 tracks land in EP0, each as its own group.
    expect(clientEPs).toHaveLength(1);
    expect(clientEPs[0].groups).toHaveLength(7);
    for (const group of clientEPs[0].groups) {
      expect(group.sections).toHaveLength(1);
    }
  });

  it('client == server for ARCHIVE_DEFAULT_PIPELINE (archive parity; requires Lane A)', () => {
    const activeSections = [...ARCHIVE_DEFAULT_PIPELINE.order];
    // Cast: Lane A will extend resolvePipeline to handle releaseKind === 'archive'.
    const serverEPs = resolvePipeline(ARCHIVE_DEFAULT_PIPELINE as unknown as Pipeline, activeSections as Parameters<typeof resolvePipeline>[1], db);
    const clientEPs = solveClientEPs(ARCHIVE_DEFAULT_PIPELINE, activeSections, BUCKET_DEFAULT);

    expect(normaliseEPs(clientEPs)).toEqual(normaliseEPs(serverEPs));
  });
});

describe('parity: edited archive configs', () => {
  // Edited archive config 1: one skip after narrative block.
  it('archive with skip — client no-merge per EP; both resolvers agree', () => {
    const archiveWithSkip: ArchivePipelineInput = {
      releaseKind: 'archive',
      order: [
        'narrative-player-superlatives', 'narrative-fan-hater-blurbs',
        'narrative-league-reel', 'narrative-moment-lines',
        'profile-spectrum', 'profile-playlist', 'season-update',
      ],
      models: {},
      skipAfter: { 'narrative-moment-lines': true },
      covers: [],
    };
    const activeSections = [...archiveWithSkip.order];
    const clientEPs = solveClientEPs(archiveWithSkip, activeSections, BUCKET_DEFAULT);

    // EP0: 4 narrative tracks; EP1: 3 profile/season tracks. Each track = own group.
    expect(clientEPs).toHaveLength(2);
    expect(clientEPs[0].groups).toHaveLength(4);
    expect(clientEPs[1].groups).toHaveLength(3);
    for (const ep of clientEPs) {
      for (const group of ep.groups) {
        expect(group.sections).toHaveLength(1);
      }
    }

    // Parity: requires Lane A.
    const serverEPs = resolvePipeline(archiveWithSkip as unknown as Pipeline, activeSections as Parameters<typeof resolvePipeline>[1], db);
    expect(normaliseEPs(clientEPs)).toEqual(normaliseEPs(serverEPs));
  });

  // Edited archive config 2: per-track model overrides (different models per track).
  it('archive with per-track model overrides — no merge even for same model', () => {
    const archiveWithModels: ArchivePipelineInput = {
      releaseKind: 'archive',
      order: [
        'narrative-player-superlatives', 'narrative-fan-hater-blurbs',
        'narrative-league-reel', 'narrative-moment-lines',
        'profile-spectrum', 'profile-playlist', 'season-update',
      ],
      models: {
        'narrative-player-superlatives': 'anthropic/claude-opus-4-8',
        'narrative-fan-hater-blurbs': 'anthropic/claude-opus-4-8',  // same model as above
        'profile-spectrum': 'anthropic/claude-haiku-4-5',
      },
      skipAfter: {},
      covers: [],
    };
    const activeSections = [...archiveWithModels.order];
    const clientEPs = solveClientEPs(archiveWithModels, activeSections, BUCKET_DEFAULT);

    // Even though two tracks share the same model, archive never merges them.
    expect(clientEPs).toHaveLength(1);
    expect(clientEPs[0].groups).toHaveLength(7);  // 7 tracks, 7 groups
    for (const group of clientEPs[0].groups) {
      expect(group.sections).toHaveLength(1);
    }

    // Parity: requires Lane A.
    const serverEPs = resolvePipeline(archiveWithModels as unknown as Pipeline, activeSections as Parameters<typeof resolvePipeline>[1], db);
    expect(normaliseEPs(clientEPs)).toEqual(normaliseEPs(serverEPs));
  });

  // Edited archive config 3: cover + skip combination.
  it('archive with cover — cover lands in trailing EP, no-merge throughout', () => {
    const archiveWithCover: ArchivePipelineInput = {
      releaseKind: 'archive',
      order: [
        'narrative-player-superlatives', 'narrative-fan-hater-blurbs',
        'profile-spectrum', 'profile-playlist', 'season-update',
      ],
      models: {},
      skipAfter: { 'narrative-fan-hater-blurbs': true },
      covers: [{ of: 'profile-spectrum', model: 'anthropic/claude-opus-4-8' }],
    };
    const activeSections = [...archiveWithCover.order];
    const clientEPs = solveClientEPs(archiveWithCover, activeSections, BUCKET_DEFAULT);

    // EP0: 2 narrative tracks; EP1: 3 profile/season + cover of profile-spectrum.
    // Wait: cover fires in EP after the one containing profile-spectrum.
    // profile-spectrum is in EP1 (after skip). So cover fires in EP2.
    expect(clientEPs).toHaveLength(3);
    expect(clientEPs[0].groups).toHaveLength(2);
    expect(clientEPs[1].groups).toHaveLength(3);
    expect(clientEPs[2].groups).toHaveLength(0);
    expect(clientEPs[2].covers).toHaveLength(1);
    expect(clientEPs[2].covers[0].of).toBe('profile-spectrum');
    for (const ep of clientEPs) {
      for (const group of ep.groups) {
        expect(group.sections).toHaveLength(1);
      }
    }

    // Parity: requires Lane A.
    const serverEPs = resolvePipeline(archiveWithCover as unknown as Pipeline, activeSections as Parameters<typeof resolvePipeline>[1], db);
    expect(normaliseEPs(clientEPs)).toEqual(normaliseEPs(serverEPs));
  });
});
