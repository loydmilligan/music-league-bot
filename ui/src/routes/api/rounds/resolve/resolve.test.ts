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
  const url = new URL('http://localhost/api/rounds/resolve');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { url, request: { headers: new Headers() } } as any;
}

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 3, 'active');
  const roundId = upsertRound(db, seasonId, {
    mlRoundId: 'resolve-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  db.prepare('UPDATE rounds SET round_number = 5 WHERE id = ?').run(roundId);
});

it('resolves by leagueSlug + seasonNumber + roundNumber', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3', roundNumber: '5' }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.name).toBe('Test Round');
  expect(body.roundNumber).toBe(5);
});

it('resolves by leagueSlug + seasonNumber + roundName', async () => {
  const res = await GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3', roundName: 'Test Round' }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.roundNumber).toBe(5);
});

it('returns 404 when nothing matches', async () => {
  await expect(GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3', roundNumber: '99' }))).rejects.toMatchObject({
    status: 404,
  });
});

it('returns 400 when neither roundNumber nor roundName is given', async () => {
  await expect(GET(mkEvent({ leagueSlug: 'hip-jammers', seasonNumber: '3' }))).rejects.toMatchObject({
    status: 400,
  });
});
