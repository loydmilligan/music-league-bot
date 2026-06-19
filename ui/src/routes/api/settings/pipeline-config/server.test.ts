/**
 * sprint-45, Lane A: tests for GET/PUT /api/settings/pipeline-config
 * sprint-46, Lane A (a2): extended with ?kind=archive tests + seed verification
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { DEFAULT_PIPELINE, ARCHIVE_DEFAULT_PIPELINE } from '$lib/digest/pipeline.js';
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

function mkGetEvent(kind?: string): Parameters<typeof GET>[0] {
  const url = new URL('http://localhost/api/settings/pipeline-config');
  if (kind) url.searchParams.set('kind', kind);
  return { url } as Parameters<typeof GET>[0];
}

function mkPutEvent(body: unknown, kind?: string): Parameters<typeof PUT>[0] {
  const url = new URL('http://localhost/api/settings/pipeline-config');
  if (kind) url.searchParams.set('kind', kind);
  return {
    url,
    request: {
      json: () => Promise.resolve(body),
    },
  } as unknown as Parameters<typeof PUT>[0];
}

/** A minimal valid digest Pipeline for testing edits. */
const CUSTOM_DIGEST_PIPELINE: Pipeline = {
  releaseKind: 'digest',
  order: ['quotes', 'consensus', 'villain', 'flow'],
  models: { villain: 'anthropic/claude-haiku-4-5' },
  skipAfter: { consensus: true },
  covers: [],
};

/** A minimal valid archive Pipeline for testing edits. */
const CUSTOM_ARCHIVE_PIPELINE: Pipeline = {
  releaseKind: 'archive',
  order: ['narrative-player-superlatives', 'narrative-fan-hater-blurbs', 'profile-spectrum'],
  models: { 'profile-spectrum': 'anthropic/claude-haiku-4-5' },
  skipAfter: { 'narrative-fan-hater-blurbs': true },
  covers: [],
};

// ---------------------------------------------------------------------------
// GET ?kind=digest (default — no kind param = digest)
// ---------------------------------------------------------------------------
describe('GET /api/settings/pipeline-config (digest, no kind param)', () => {
  it('returns DEFAULT_PIPELINE when key has never been set', async () => {
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: DEFAULT_PIPELINE });
  });

  it('returns DEFAULT_PIPELINE when stored value is malformed JSON', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', 'not-json')").run();
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: DEFAULT_PIPELINE });
  });

  it('returns DEFAULT_PIPELINE when stored value fails structural check', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', '{}')").run();
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: DEFAULT_PIPELINE });
  });

  it('returns the stored pipeline when a valid digest pipeline is present', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', ?)").run(
      JSON.stringify(CUSTOM_DIGEST_PIPELINE),
    );
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_DIGEST_PIPELINE });
  });
});

// ---------------------------------------------------------------------------
// GET ?kind=archive
// ---------------------------------------------------------------------------
describe('GET /api/settings/pipeline-config?kind=archive', () => {
  it('returns ARCHIVE_DEFAULT_PIPELINE when seeded by openLeagueDb', async () => {
    const res = await GET(mkGetEvent('archive'));
    const body = await res.json();
    expect(body).toEqual({ pipeline: ARCHIVE_DEFAULT_PIPELINE });
  });

  it('returns ARCHIVE_DEFAULT_PIPELINE when stored value is malformed JSON', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config_archive', 'not-json')").run();
    const res = await GET(mkGetEvent('archive'));
    const body = await res.json();
    expect(body).toEqual({ pipeline: ARCHIVE_DEFAULT_PIPELINE });
  });

  it('returns stored archive pipeline when a valid one is present', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config_archive', ?)").run(
      JSON.stringify(CUSTOM_ARCHIVE_PIPELINE),
    );
    const res = await GET(mkGetEvent('archive'));
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_ARCHIVE_PIPELINE });
  });

  it('digest and archive keys are independent', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipeline_config', ?)").run(
      JSON.stringify(CUSTOM_DIGEST_PIPELINE),
    );
    const digestRes = await GET(mkGetEvent('digest'));
    const archiveRes = await GET(mkGetEvent('archive'));
    expect((await digestRes.json()).pipeline.releaseKind).toBe('digest');
    expect((await archiveRes.json()).pipeline.releaseKind).toBe('archive');
  });
});

// ---------------------------------------------------------------------------
// PUT ?kind=digest (default)
// ---------------------------------------------------------------------------
describe('PUT /api/settings/pipeline-config (digest)', () => {
  it('persists a valid digest pipeline and echoes it back', async () => {
    const res = await PUT(mkPutEvent({ pipeline: CUSTOM_DIGEST_PIPELINE }));
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_DIGEST_PIPELINE });

    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'pipeline_config'")
      .get() as { value: string } | undefined;
    expect(JSON.parse(row!.value)).toEqual(CUSTOM_DIGEST_PIPELINE);
  });

  it('persists DEFAULT_PIPELINE (reset path)', async () => {
    const res = await PUT(mkPutEvent({ pipeline: DEFAULT_PIPELINE }));
    const body = await res.json();
    expect(body).toEqual({ pipeline: DEFAULT_PIPELINE });
  });

  it('GET after PUT reflects the changed pipeline', async () => {
    await PUT(mkPutEvent({ pipeline: CUSTOM_DIGEST_PIPELINE }));
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_DIGEST_PIPELINE });
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

  it('returns 400 when releaseKind does not match kind (archive pipeline PUT to digest)', async () => {
    await expect(PUT(mkPutEvent({ pipeline: CUSTOM_ARCHIVE_PIPELINE }))).rejects.toMatchObject({ status: 400 });
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
      covers: [{ of: 'quotes' }],
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

// ---------------------------------------------------------------------------
// PUT ?kind=archive
// ---------------------------------------------------------------------------
describe('PUT /api/settings/pipeline-config?kind=archive', () => {
  it('persists a valid archive pipeline and echoes it back', async () => {
    const res = await PUT(mkPutEvent({ pipeline: CUSTOM_ARCHIVE_PIPELINE }, 'archive'));
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_ARCHIVE_PIPELINE });

    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'pipeline_config_archive'")
      .get() as { value: string } | undefined;
    expect(JSON.parse(row!.value)).toEqual(CUSTOM_ARCHIVE_PIPELINE);
  });

  it('persists ARCHIVE_DEFAULT_PIPELINE (reset path)', async () => {
    const res = await PUT(mkPutEvent({ pipeline: ARCHIVE_DEFAULT_PIPELINE }, 'archive'));
    const body = await res.json();
    expect(body).toEqual({ pipeline: ARCHIVE_DEFAULT_PIPELINE });
  });

  it('GET archive after PUT archive reflects the change', async () => {
    await PUT(mkPutEvent({ pipeline: CUSTOM_ARCHIVE_PIPELINE }, 'archive'));
    const res = await GET(mkGetEvent('archive'));
    const body = await res.json();
    expect(body).toEqual({ pipeline: CUSTOM_ARCHIVE_PIPELINE });
  });

  it('returns 400 when releaseKind does not match kind (digest pipeline PUT to archive)', async () => {
    await expect(
      PUT(mkPutEvent({ pipeline: CUSTOM_DIGEST_PIPELINE }, 'archive'))
    ).rejects.toMatchObject({ status: 400 });
  });

  it('PUT archive does not clobber digest config', async () => {
    await PUT(mkPutEvent({ pipeline: CUSTOM_DIGEST_PIPELINE }));
    await PUT(mkPutEvent({ pipeline: CUSTOM_ARCHIVE_PIPELINE }, 'archive'));
    const digestRes = await GET(mkGetEvent('digest'));
    expect((await digestRes.json()).pipeline).toEqual(CUSTOM_DIGEST_PIPELINE);
  });
});

// ---------------------------------------------------------------------------
// Invalid kind param
// ---------------------------------------------------------------------------
describe('GET/PUT with invalid kind param', () => {
  it('GET returns 400 for unknown kind', () => {
    const url = new URL('http://localhost/api/settings/pipeline-config?kind=single');
    const event = { url } as Parameters<typeof GET>[0];
    expect(() => GET(event)).toThrow();
  });

  it('PUT returns 400 for unknown kind', async () => {
    const url = new URL('http://localhost/api/settings/pipeline-config?kind=single');
    const event = {
      url,
      request: { json: () => Promise.resolve({ pipeline: CUSTOM_DIGEST_PIPELINE }) },
    } as unknown as Parameters<typeof PUT>[0];
    await expect(PUT(event)).rejects.toMatchObject({ status: 400 });
  });
});
