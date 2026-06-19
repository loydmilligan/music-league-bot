/**
 * Parity test: client EP solver (pipelineSolver.ts) must produce identical
 * EP/group/cover structure to resolvePipeline() for every tested config.
 *
 * Required by the orc decision in sprint-45 coord-doc:
 *   "Lane B acceptance includes a vitest asserting the client solver's
 *    EP/group/cover output equals resolvePipeline(...) for DEFAULT_PIPELINE
 *    + at least 3 edited configs."
 *
 * Test setup:
 *   - In-memory DB via openLeagueDb(':memory:') seeds the full schema.
 *   - 'digest_model' is set to MODEL so modelForSection() falls back to MODEL
 *     for all digest sections without per-section DB pins.
 *   - The client solver receives the same MODEL as bucketDefault.
 *   - No per-section DB pins are seeded unless the test explicitly needs them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { resolvePipeline, DEFAULT_PIPELINE, type Pipeline } from './pipeline.js';
import { solveClientEPs, type ClientEP } from '../models/pipelineSolver.js';
import type Database from 'better-sqlite3';
import type { EP } from './pipeline.js';

const MODEL = 'anthropic/claude-sonnet-4-5';
const ALT_MODEL = 'anthropic/claude-opus-4-8';

let db: Database.Database;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('digest_model', ?)").run(MODEL);
});

function assertEPsMatch(client: ClientEP[], real: EP[]) {
  expect(client.length).toBe(real.length);
  for (let i = 0; i < real.length; i++) {
    expect(client[i].groups.length).toBe(real[i].groups.length);
    for (let j = 0; j < real[i].groups.length; j++) {
      expect(client[i].groups[j].model).toBe(real[i].groups[j].model);
      expect(client[i].groups[j].sections).toEqual(real[i].groups[j].sections);
    }
    expect(client[i].covers.length).toBe(real[i].covers.length);
    for (let k = 0; k < real[i].covers.length; k++) {
      expect(client[i].covers[k].of).toBe(real[i].covers[k].of);
      expect(client[i].covers[k].model).toBe(real[i].covers[k].model);
    }
  }
}

describe('client EP solver parity vs resolvePipeline', () => {
  it('DEFAULT_PIPELINE: two EPs with one cover in the trailing EP', () => {
    const active = [...DEFAULT_PIPELINE.order];
    const client = solveClientEPs(DEFAULT_PIPELINE, active, MODEL);
    const real = resolvePipeline(DEFAULT_PIPELINE, active, db);
    assertEPsMatch(client, real);
  });

  it('extra skip: three EPs (two explicit skips, no covers)', () => {
    const pipeline: Pipeline = {
      releaseKind: 'digest',
      order: ['quotes', 'consensus', 'podium', 'chat', 'villain', 'flow'],
      models: {},
      skipAfter: { chat: true, podium: true },
      covers: [],
    };
    const active = [...pipeline.order];
    const client = solveClientEPs(pipeline, active, MODEL);
    const real = resolvePipeline(pipeline, active, db);
    assertEPsMatch(client, real);
  });

  it('per-section override: flow uses ALT_MODEL, splits into separate group', () => {
    const pipeline: Pipeline = {
      releaseKind: 'digest',
      order: ['quotes', 'consensus', 'podium', 'chat', 'villain', 'flow'],
      models: { flow: ALT_MODEL } as Pipeline['models'],
      skipAfter: {},
      covers: [],
    };
    const active = [...pipeline.order];
    const client = solveClientEPs(pipeline, active, MODEL);
    const real = resolvePipeline(pipeline, active, db);
    assertEPsMatch(client, real);
  });

  it('cover in a non-default EP slot (two skips + cover of villain)', () => {
    const pipeline: Pipeline = {
      releaseKind: 'digest',
      order: ['quotes', 'consensus', 'podium', 'chat', 'villain', 'flow'],
      models: {},
      skipAfter: { chat: true },
      covers: [{ of: 'villain', model: ALT_MODEL }],
    };
    const active = [...pipeline.order];
    const client = solveClientEPs(pipeline, active, MODEL);
    const real = resolvePipeline(pipeline, active, db);
    assertEPsMatch(client, real);
  });
});
