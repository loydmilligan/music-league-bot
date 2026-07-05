import { it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import { addResearchSong } from '$lib/db/research.js';

let db: Database.Database;
let roundId: number;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});
vi.mock('$lib/auth/bearer.js', () => ({ requireBearerToken: vi.fn() }));

import { POST as startPost } from './start/+server.js';
import { POST as reshufflePost } from './reshuffle/+server.js';
import { POST as selectWinnerPost } from './select-winner/+server.js';
import { GET as currentGet } from './current/+server.js';

function mkEvent(roundIdParam: number, body?: unknown) {
  return {
    params: { roundId: String(roundIdParam) },
    request: { json: () => Promise.resolve(body ?? {}), headers: new Headers() },
  } as any;
}

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'route-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  for (const letter of ['A', 'B', 'C', 'D', 'E']) {
    addResearchSong(db, { roundId, spotifyUri: `spotify:track:${letter}`, title: letter, artist: `Artist ${letter}`, album: null });
  }
});

it('GET current returns null before any matchup is started', async () => {
  const res = await currentGet(mkEvent(roundId));
  expect(await res.json()).toBeNull();
});

it('POST start returns 201 with a pairing, then GET current returns it', async () => {
  const res = await startPost(mkEvent(roundId));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.songAId).toBeDefined();
  expect(body.songBId).toBeDefined();

  const current = await (await currentGet(mkEvent(roundId))).json();
  expect(current).toEqual(body);
});

it('POST reshuffle returns a different pairing', async () => {
  const first = await (await startPost(mkEvent(roundId))).json();
  const res = await reshufflePost(mkEvent(roundId));
  expect(res.status).toBe(200);
  const reshuffled = await res.json();
  expect([first.songAId, first.songBId]).not.toContain(reshuffled.songAId);
});

it('POST select-winner advances the matchup', async () => {
  const started = await (await startPost(mkEvent(roundId))).json();
  const res = await selectWinnerPost(mkEvent(roundId, { winnerSongId: started.songAId }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.songAId).toBe(started.songAId);
});

it('POST select-winner with an invalid id returns 400', async () => {
  await startPost(mkEvent(roundId));
  await expect(selectWinnerPost(mkEvent(roundId, { winnerSongId: 999999 }))).rejects.toMatchObject({ status: 400 });
});

it('POST reshuffle with fewer than 2 active songs (excluding current pair) returns 400', async () => {
  // Start a matchup (picks 2 from 5, leaving 3 in the pool)
  const started = await (await startPost(mkEvent(roundId))).json();

  // Get all active songs
  const allSongs = db
    .prepare(`SELECT id FROM research_songs WHERE round_id = ? AND removed_reason IS NULL`)
    .all(roundId) as { id: number }[];

  // Remove all songs except the current pair
  const currentPair = [started.songAId, started.songBId];
  for (const song of allSongs) {
    if (!currentPair.includes(song.id)) {
      db.prepare(`UPDATE research_songs SET removed_reason = 'h2h_loss', removed_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        song.id,
      );
    }
  }

  // Try to reshuffle — should fail because only the current pair remains
  await expect(reshufflePost(mkEvent(roundId))).rejects.toMatchObject({ status: 400 });
});
