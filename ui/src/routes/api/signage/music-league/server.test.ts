import { it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { generateToken } from '$lib/auth/bearer.js';

let db: Database.Database;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});

import { GET } from './+server.js';

function seed(): void {
  db.prepare("INSERT INTO leagues (slug, name) VALUES ('test-league', 'Test League')").run();
  const lid = (db.prepare("SELECT id FROM leagues WHERE slug='test-league'").get() as { id: number }).id;
  db.prepare("INSERT INTO seasons (league_id, season_number, status) VALUES (?, 1, 'active')").run(lid);
  const sid = (db.prepare('SELECT id FROM seasons').get() as { id: number }).id;
  db.prepare(`INSERT INTO rounds (season_id, ml_round_id, name, description, created_at, round_number)
    VALUES (?, 'r1', 'Round One', 'A theme', '2026-01-01T00:00:00Z', 1)`).run(sid);
}
function req(token?: string): any {
  const headers = new Headers(token ? { authorization: `Bearer ${token}` } : {});
  return { request: { headers } };
}
async function status(p: () => Response | Promise<Response>): Promise<number> {
  try { return (await p()).status; } catch (e: any) { return e.status; }
}

beforeEach(() => { db = openLeagueDb(':memory:'); seed(); });

it('401 without a token', async () => {
  expect(await status(() => GET(req()))).toBe(401);
});

it('401 with a revoked token', async () => {
  const { plaintext, hash } = generateToken();
  db.prepare("INSERT INTO api_tokens (hash, label, created_at, revoked_at) VALUES (?, 'pocket-sign', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')").run(hash);
  expect(await status(() => GET(req(plaintext)))).toBe(401);
});

it('200 with the signage shape for a good token', async () => {
  const { plaintext, hash } = generateToken();
  db.prepare("INSERT INTO api_tokens (hash, label, created_at) VALUES (?, 'pocket-sign', '2026-01-01T00:00:00Z')").run(hash);
  const res = await GET(req(plaintext));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(typeof body.generatedAt).toBe('string');
  expect(body.seasons).toHaveLength(1);
  expect(body.seasons[0]).toMatchObject({
    league: { slug: 'test-league', name: 'Test League' }, season: 1, members: [], roundCount: 1, standings: null, shortlist: [],
  });
  expect(body.seasons[0].rounds[0]).toMatchObject({
    number: 1, title: 'Round One', theme: 'A theme', revealed: true, submitBy: null, voteBy: null,
    phase: 'submission', submitted: [], voted: [],
  });
});

it('calls requireBearerToken first (mocked)', async () => {
  vi.resetModules();
  vi.doMock('$lib/auth/bearer.js', () => ({ requireBearerToken: vi.fn(() => { throw Object.assign(new Error('x'), { status: 401 }); }) }));
  const { GET: G } = await import('./+server.js');
  const { requireBearerToken } = await import('$lib/auth/bearer.js');
  await expect(G(req())).rejects.toMatchObject({ status: 401 });
  expect(requireBearerToken).toHaveBeenCalled();
  vi.doUnmock('$lib/auth/bearer.js');
});
