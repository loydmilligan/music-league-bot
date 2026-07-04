/**
 * Tests for GET/PUT /api/settings/tastemaker-buckets
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
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
  return {} as Parameters<typeof GET>[0];
}

function mkPutEvent(body: unknown): Parameters<typeof PUT>[0] {
  return {
    request: { json: () => Promise.resolve(body) },
  } as unknown as Parameters<typeof PUT>[0];
}

describe('GET /api/settings/tastemaker-buckets', () => {
  it('returns the shipped default (10/20/30) when unset', async () => {
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ boundaries: { b1: 10, b2: 20, b3: 30 } });
  });

  it('returns the stored boundaries when present', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('tastemaker_bucket_boundaries', ?)").run(
      JSON.stringify({ b1: 15, b2: 35, b3: 66 }),
    );
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ boundaries: { b1: 15, b2: 35, b3: 66 } });
  });

  it('falls back to defaults when the stored value is malformed JSON', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('tastemaker_bucket_boundaries', 'not-json')").run();
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ boundaries: { b1: 10, b2: 20, b3: 30 } });
  });

  it('falls back to defaults when the stored value fails structural validation (b2 <= b1)', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('tastemaker_bucket_boundaries', ?)").run(
      JSON.stringify({ b1: 20, b2: 20, b3: 30 }),
    );
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ boundaries: { b1: 10, b2: 20, b3: 30 } });
  });
});

describe('PUT /api/settings/tastemaker-buckets', () => {
  it('persists valid boundaries and echoes them back', async () => {
    const res = await PUT(mkPutEvent({ boundaries: { b1: 15, b2: 35, b3: 66 } }));
    const body = await res.json();
    expect(body).toEqual({ boundaries: { b1: 15, b2: 35, b3: 66 } });

    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'tastemaker_bucket_boundaries'")
      .get() as { value: string } | undefined;
    expect(JSON.parse(row!.value)).toEqual({ b1: 15, b2: 35, b3: 66 });
  });

  it('GET after PUT reflects the changed boundaries', async () => {
    await PUT(mkPutEvent({ boundaries: { b1: 5, b2: 15, b3: 40 } }));
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ boundaries: { b1: 5, b2: 15, b3: 40 } });
  });

  it('returns 400 when body is missing boundaries', async () => {
    await expect(PUT(mkPutEvent({}))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when b1 >= b2', async () => {
    await expect(
      PUT(mkPutEvent({ boundaries: { b1: 20, b2: 20, b3: 30 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when b3 > 100', async () => {
    await expect(
      PUT(mkPutEvent({ boundaries: { b1: 10, b2: 20, b3: 101 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when boundaries are non-integer', async () => {
    await expect(
      PUT(mkPutEvent({ boundaries: { b1: 10.5, b2: 20, b3: 30 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const event = {
      request: { json: () => Promise.reject(new SyntaxError('bad json')) },
    } as unknown as Parameters<typeof PUT>[0];
    await expect(PUT(event)).rejects.toMatchObject({ status: 400 });
  });
});
