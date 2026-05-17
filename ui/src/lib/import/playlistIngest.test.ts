import { it, expect, beforeEach, afterEach } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { ingestPlaylist } from './playlistIngest.js';
import { parsePlaylistId } from '../spotify.js';
import type Database from 'better-sqlite3';

function mkRound(db: Database.Database): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 99, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId: 'ingest-test', name: 'Ingest test', description: '',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('parsePlaylistId accepts the URL formats Spotify produces', () => {
  expect(parsePlaylistId('https://open.spotify.com/playlist/abc123')).toBe('abc123');
  expect(parsePlaylistId('https://open.spotify.com/playlist/abc123?si=xyz')).toBe('abc123');
  expect(parsePlaylistId('spotify:playlist:abc123')).toBe('abc123');
  expect(parsePlaylistId('not a url')).toBeNull();
});

it('ingest inserts one row per track with competitor_id NULL', async () => {
  const roundId = mkRound(db);
  const tracks = [
    { spotifyUri: 'spotify:track:a', title: 'A', artist: 'Aa', album: 'AAa' },
    { spotifyUri: 'spotify:track:b', title: 'B', artist: 'Bb', album: 'BBb' },
    { spotifyUri: 'spotify:track:c', title: 'C', artist: 'Cc', album: null },
  ];
  const res = await ingestPlaylist(roundId, 'https://open.spotify.com/playlist/test', {
    db, tracksProvider: async () => tracks,
  });
  expect(res).toEqual({ inserted: 3, skipped: 0 });
  const rows = db.prepare('SELECT count(*) n, count(competitor_id) nn FROM ml_submissions WHERE round_id = ?').get(roundId) as { n: number; nn: number };
  expect(rows.n).toBe(3);
  expect(rows.nn).toBe(0); // all competitor_id are NULL
  const first = db.prepare('SELECT spotify_uri, title, artists, album FROM ml_submissions WHERE round_id = ? ORDER BY spotify_uri').get(roundId) as any;
  expect(first.spotify_uri).toBe('spotify:track:a');
  expect(first.artists).toBe('Aa');
});

it('is idempotent — second run inserts 0, skips all', async () => {
  const roundId = mkRound(db);
  const tracks = [
    { spotifyUri: 'spotify:track:a', title: 'A', artist: 'Aa', album: null },
    { spotifyUri: 'spotify:track:b', title: 'B', artist: 'Bb', album: null },
  ];
  const provider = async () => tracks;
  const r1 = await ingestPlaylist(roundId, 'https://open.spotify.com/playlist/test', { db, tracksProvider: provider });
  expect(r1).toEqual({ inserted: 2, skipped: 0 });
  const r2 = await ingestPlaylist(roundId, 'https://open.spotify.com/playlist/test', { db, tracksProvider: provider });
  expect(r2).toEqual({ inserted: 0, skipped: 2 });
  const n = (db.prepare('SELECT count(*) n FROM ml_submissions WHERE round_id = ?').get(roundId) as { n: number }).n;
  expect(n).toBe(2);
});

const ORIG_ID = process.env.SPOTIFY_CLIENT_ID;
const ORIG_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
afterEach(() => {
  if (ORIG_ID === undefined) delete process.env.SPOTIFY_CLIENT_ID; else process.env.SPOTIFY_CLIENT_ID = ORIG_ID;
  if (ORIG_SECRET === undefined) delete process.env.SPOTIFY_CLIENT_SECRET; else process.env.SPOTIFY_CLIENT_SECRET = ORIG_SECRET;
});

it('no-op when SPOTIFY_CLIENT_ID is unset (no tracksProvider override)', async () => {
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  const roundId = mkRound(db);
  const res = await ingestPlaylist(roundId, 'https://open.spotify.com/playlist/test', { db });
  expect(res).toEqual({ inserted: 0, skipped: 0 });
  const n = (db.prepare('SELECT count(*) n FROM ml_submissions WHERE round_id = ?').get(roundId) as { n: number }).n;
  expect(n).toBe(0);
});

it('returns 0/0 without throwing when the playlist URL is unparseable', async () => {
  const roundId = mkRound(db);
  const res = await ingestPlaylist(roundId, 'not-a-spotify-url', { db });
  expect(res).toEqual({ inserted: 0, skipped: 0 });
});

it('different rounds get independent anon-row uniqueness (partial index is round-scoped)', async () => {
  const roundA = mkRound(db);
  const roundB = upsertRound(db, (db.prepare("SELECT id FROM seasons WHERE season_number=99").get() as { id: number }).id, {
    mlRoundId: 'round-b', name: 'B', description: '', spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
  const tracks = [{ spotifyUri: 'spotify:track:shared', title: 'Shared', artist: 'X', album: null }];
  const provider = async () => tracks;
  expect((await ingestPlaylist(roundA, 'https://open.spotify.com/playlist/a', { db, tracksProvider: provider })).inserted).toBe(1);
  expect((await ingestPlaylist(roundB, 'https://open.spotify.com/playlist/b', { db, tracksProvider: provider })).inserted).toBe(1);
});
