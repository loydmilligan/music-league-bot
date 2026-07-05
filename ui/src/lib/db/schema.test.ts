import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('research_songs has the new removal-tracking columns', () => {
  const cols = (db.prepare("PRAGMA table_info(research_songs)").all() as { name: string }[]).map(c => c.name);
  expect(cols).toContain('removed_reason');
  expect(cols).toContain('removed_by_song_id');
  expect(cols).toContain('removed_at');
});

it('h2h_pending_matchup table exists with the expected columns', () => {
  const cols = (db.prepare("PRAGMA table_info(h2h_pending_matchup)").all() as { name: string }[]).map(c => c.name);
  expect(cols).toEqual(['round_id', 'song_a_id', 'song_b_id', 'mode', 'created_at']);
});

it('h2h_pending_matchup enforces one pending row per round (round_id is the PK)', () => {
  // Set up parent records for foreign key references
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test', 'Test League')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`).run();
  db.prepare(`INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (1, 1, 'r1', 'Round 1', '2026-01-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO research_songs (id, round_id, spotify_uri, title, artist, added_at) VALUES (10, 1, 'uri1', 'Song 1', 'Artist 1', '2026-01-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO research_songs (id, round_id, spotify_uri, title, artist, added_at) VALUES (20, 1, 'uri2', 'Song 2', 'Artist 2', '2026-01-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO research_songs (id, round_id, spotify_uri, title, artist, added_at) VALUES (30, 1, 'uri3', 'Song 3', 'Artist 3', '2026-01-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO research_songs (id, round_id, spotify_uri, title, artist, added_at) VALUES (40, 1, 'uri4', 'Song 4', 'Artist 4', '2026-01-01T00:00:00Z')`).run();

  // Insert first row — should succeed
  db.prepare(`INSERT INTO h2h_pending_matchup (round_id, song_a_id, song_b_id, mode, created_at)
    VALUES (1, 10, 20, 'random', '2026-01-01T00:00:00Z')`).run();

  // Try to insert second row for same round — should throw (PRIMARY KEY conflict)
  expect(() =>
    db.prepare(`INSERT INTO h2h_pending_matchup (round_id, song_a_id, song_b_id, mode, created_at)
      VALUES (1, 30, 40, 'random', '2026-01-01T00:00:01Z')`).run()
  ).toThrow();
});
