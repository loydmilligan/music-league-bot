import { it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues } from '$lib/db/leagues.js';

let db: Database.Database;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});
vi.mock('$lib/auth/bearer.js', () => ({ requireBearerToken: vi.fn() }));

import { requireBearerToken } from '$lib/auth/bearer.js';
import { GET } from './+server.js';

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
});

it('returns every league as {slug, name}, calling requireBearerToken first', async () => {
  const res = await GET({ request: { headers: new Headers() } } as any);
  expect(requireBearerToken).toHaveBeenCalled();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toContainEqual({ slug: 'hip-jammers', name: 'Hip Jammers' });
  expect(body).toHaveLength(4);
});
