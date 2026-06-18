/**
 * a1-debug-setting: tests for GET/PUT /api/settings/debug-mode
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
  const url = new URL('http://localhost/api/settings/debug-mode');
  return { url } as Parameters<typeof GET>[0];
}

function mkPutEvent(body: unknown): Parameters<typeof PUT>[0] {
  const url = new URL('http://localhost/api/settings/debug-mode');
  return {
    url,
    request: {
      json: () => Promise.resolve(body),
    },
  } as unknown as Parameters<typeof PUT>[0];
}

describe('GET /api/settings/debug-mode', () => {
  it('returns enabled: false when key has never been set', async () => {
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ enabled: false });
  });

  it('returns enabled: true after the key is set to true', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('debug_mode', 'true')").run();
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ enabled: true });
  });

  it('returns enabled: false when key is explicitly set to false', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('debug_mode', 'false')").run();
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ enabled: false });
  });
});

describe('PUT /api/settings/debug-mode', () => {
  it('persists enabled: true and returns { enabled: true }', async () => {
    const res = await PUT(mkPutEvent({ enabled: true }));
    const body = await res.json();
    expect(body).toEqual({ enabled: true });

    // Verify it persists in the DB
    const row = db.prepare("SELECT value FROM settings WHERE key = 'debug_mode'").get() as { value: string } | undefined;
    expect(row?.value).toBe('true');
  });

  it('persists enabled: false and returns { enabled: false }', async () => {
    // First set it to true
    db.prepare("INSERT INTO settings (key, value) VALUES ('debug_mode', 'true')").run();

    const res = await PUT(mkPutEvent({ enabled: false }));
    const body = await res.json();
    expect(body).toEqual({ enabled: false });

    const row = db.prepare("SELECT value FROM settings WHERE key = 'debug_mode'").get() as { value: string } | undefined;
    expect(row?.value).toBe('false');
  });

  it('GET reads the persisted value after PUT', async () => {
    await PUT(mkPutEvent({ enabled: true }));
    const res = await GET(mkGetEvent());
    const body = await res.json();
    expect(body).toEqual({ enabled: true });
  });

  it('returns 400 when body is missing enabled field', async () => {
    const event = mkPutEvent({ foo: 'bar' });
    await expect(PUT(event)).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const event = mkPutEvent({ enabled: 'yes' });
    await expect(PUT(event)).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when body is null/invalid JSON', async () => {
    const url = new URL('http://localhost/api/settings/debug-mode');
    const event = {
      url,
      request: { json: () => Promise.reject(new SyntaxError('bad json')) },
    } as unknown as Parameters<typeof PUT>[0];
    await expect(PUT(event)).rejects.toMatchObject({ status: 400 });
  });
});
