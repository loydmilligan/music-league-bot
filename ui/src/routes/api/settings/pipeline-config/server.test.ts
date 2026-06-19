/**
 * sprint-45, Lane A: tests for GET/PUT /api/settings/pipeline-config
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { DEFAULT_PIPELINE } from '$lib/digest/pipeline.js';
import type { Pipeline } from '$lib/digest/pipeline.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});

import { GET, PUT } from './+server.js';

beforeEach(() => {
  db = openLeagueDb(':memory:');
});

function mkGetEvent(): Parameters<typeof GET>[0] {
  const url = new URL('http://localhost/api/settings/pipeline-config');
  return { url } as Parameters<typeof GET>[0];
}

function mkPutEvent(body: unknown): Parameters<typeof PUT>[0] {
  const url = new URL('http://localhost/api/settings/pipeline-config');
  return {
    url,
    request: {
      json: () => Promise.resolve(body),
    },
  } as unknown as Parameters<typeof PUT>[0];
}

/** A minimal valid Pipeline for testing edits. */
const CUSTOM_PIPELINE: Pipeline = {
  releaseKind: 'digest',
  order: ['quotes', 'consensus', 'villain', 'flow'],
  models: { villain: 'anthropic/claude-haiku-4-5' },
  skipAfter: { consensus: true },
  covers: [],
};

describe('GET /api/settings/pipeline-config', () => {
  it('returns DEFAULT_PIPELINE when key has never been set', async () => {
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: DEFAULT_PIPELINE });
  });

  it('returns DEFAULT_PIPELINE when stored value is malformed JSON', async () => {
    // pipeline_config is seeded by openLeagueDb; use INSERT OR REPLACE to overwrite.
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', 'not-json')").run();
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: DEFAULT_PIPELINE });
  });

  it('returns DEFAULT_PIPELINE when stored value is valid JSON but fails structural check', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', '{}')").run();
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: DEFAULT_PIPELINE });
  });

  it('returns the stored pipeline when a valid pipeline is present', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', ?)").run(
      JSON.stringify(CUSTOM_PIPELINE),
    );
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_PIPELINE });
  });
});

describe('PUT /api/settings/pipeline-config', () => {
  it('persists a valid pipeline and echoes it back', async () => {
    const res = await PUT(mkPutEvent({ pipeline: CUSTOM_PIPELINE }));
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_PIPELINE });

    // Confirm it is in the DB.
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'pipeline_config'")
      .get() as { value: string } | undefined;
    expect(JSON.parse(row!.value)).toEqual(CUSTOM_PIPELINE);
  });

  it('persists DEFAULT_PIPELINE (reset path)', async () => {
    const res = await PUT(mkPutEvent({ pipeline: DEFAULT_PIPELINE }));
    const body = await res.json();
    expect(body).toEqual({ pipeline: DEFAULT_PIPELINE });
  });

  it('GET after PUT reflects the changed pipeline', async () => {
    await PUT(mkPutEvent({ pipeline: CUSTOM_PIPELINE }));
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_PIPELINE });
  });

  it('returns 400 when body is empty object ({})', async () => {
    await expect(PUT(mkPutEvent({}))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when pipeline field is absent', async () => {
    await expect(PUT(mkPutEvent({ foo: 'bar' }))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when releaseKind is missing', async () => {
    const bad = { order: ['quotes'], models: {}, skipAfter: {}, covers: [] };
    await expect(PUT(mkPutEvent({ pipeline: bad }))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when releaseKind is not "digest"', async () => {
    const bad = { releaseKind: 'single', order: ['quotes'], models: {}, skipAfter: {}, covers: [] };
    await expect(PUT(mkPutEvent({ pipeline: bad }))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when order is empty', async () => {
    const bad = { releaseKind: 'digest', order: [], models: {}, skipAfter: {}, covers: [] };
    await expect(PUT(mkPutEvent({ pipeline: bad }))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when covers contains an element missing "of" or "model"', async () => {
    const bad = {
      releaseKind: 'digest',
      order: ['quotes'],
      models: {},
      skipAfter: {},
      covers: [{ of: 'quotes' }], // missing model
    };
    await expect(PUT(mkPutEvent({ pipeline: bad }))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const url = new URL('http://localhost/api/settings/pipeline-config');
    const event = {
      url,
      request: { json: () => Promise.reject(new SyntaxError('bad json')) },
    } as unknown as Parameters<typeof PUT>[0];
    await expect(PUT(event)).rejects.toMatchObject({ status: 400 });
  });
});
