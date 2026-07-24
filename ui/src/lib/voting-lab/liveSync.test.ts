import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import { syncRoundSongs } from './liveSync.js';
import type { CliSong } from './liveSync.js';

function dbWithRound() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test', 'Test')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase)
     VALUES (100, 10, 'ml-100', 'R1', '2026-07-01T00:00:00Z', 'voting')`,
  ).run();
  return db;
}

const SONGS: CliSong[] = [
  { spotifyUri: 'spotify:track:a', title: 'Song A', artist: 'Artist A', albumArtUrl: null },
  { spotifyUri: 'spotify:track:b', title: 'Song B', artist: 'Artist B', albumArtUrl: 'http://art/b.jpg' },
];

it('inserts songs as anonymous and visible to voters', () => {
  const db = dbWithRound();
  expect(syncRoundSongs(db, 100, SONGS)).toEqual({ inserted: 2, skipped: 0 });
  const rows = db.prepare(
    `SELECT spotify_uri, competitor_id, visible_to_voters FROM ml_submissions WHERE round_id = 100`,
  ).all() as { spotify_uri: string; competitor_id: number | null; visible_to_voters: number }[];
  expect(rows).toHaveLength(2);
  // Voting-phase songs must stay anonymous.
  expect(rows.every((r) => r.competitor_id === null)).toBe(true);
  expect(rows.every((r) => r.visible_to_voters === 1)).toBe(true);
  db.close();
});

it('is idempotent — re-syncing does not duplicate', () => {
  const db = dbWithRound();
  syncRoundSongs(db, 100, SONGS);
  expect(syncRoundSongs(db, 100, SONGS)).toEqual({ inserted: 0, skipped: 2 });
  const count = db.prepare(`SELECT COUNT(*) AS c FROM ml_submissions WHERE round_id = 100`)
    .get() as { c: number };
  expect(count.c).toBe(2);
  db.close();
});
