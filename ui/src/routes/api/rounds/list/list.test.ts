import { it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';

let db: Database.Database;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});
vi.mock('$lib/auth/bearer.js', () => ({ requireBearerToken: vi.fn() }));

import { GET } from './+server.js';

function mkEvent(query: Record<string, string>) {
  const url = new URL('http://localhost/api/rounds/list');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { url, request: { headers: new Headers() } } as any;
}

let leagueId: number;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const s3 = upsertSeason(db, leagueId, 3, 'complete');
  const s4 = upsertSeason(db, leagueId, 4, 'active');
  const r1 = upsertRound(db, s3, {
    mlRoundId: 'list-test-1', name: 'Round Three A', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  db.prepare('UPDATE rounds SET round_number = 1 WHERE id = ?').run(r1);
  upsertRound(db, s4, {
    mlRoundId: 'list-test-2', name: 'Round Four A', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-02T00:00:00Z',
  });
});

it('returns 400 when leagueSlug is missing', async () => {
  await expect(GET(mkEvent({}))).rejects.toMatchObject({ status: 400 });
});

it('lists every round for a league when seasonNumber is omitted', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers' }));
  const body = await res.json();
  expect(body).toHaveLength(2);
  expect(body.map((r: any) => r.name)).toEqual(['Round Three A', 'Round Four A']);
});

it('scopes to one season when seasonNumber is given', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3' }));
  const body = await res.json();
  expect(body).toHaveLength(1);
  expect(body[0]).toMatchObject({ name: 'Round Three A', roundNumber: 1, seasonNumber: 3 });
});
