import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { addResearchSong } from './research.js';
import type Database from 'better-sqlite3';

function mkRound(db: Database.Database): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 99, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId: 'h2h-test-round',
    name: 'H2H test round',
    description: '',
    spotifyPlaylistUrl: '',
    createdAt: new Date().toISOString(),
  });
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('has the head_to_head_matches table with the indexed columns', () => {
  const cols = db.prepare("PRAGMA table_info(head_to_head_matches)").all() as { name: string }[];
  const names = cols.map(c => c.name).sort();
  expect(names).toEqual(['created_at', 'id', 'loser_id', 'round_id', 'winner_id']);
  const idx = db.prepare("PRAGMA index_list(head_to_head_matches)").all() as { name: string }[];
  expect(idx.some(i => i.name === 'idx_h2h_round_created')).toBe(true);
});

it('research_songs has the new status column defaulting to reviewing', () => {
  const cols = db.prepare("PRAGMA table_info(research_songs)").all() as { name: string; dflt_value: string | null }[];
  const status = cols.find(c => c.name === 'status');
  expect(status).toBeDefined();
  expect(status!.dflt_value).toMatch(/reviewing/);
});

it('inserts an h2h match and round-trips the row', () => {
  const roundId = mkRound(db);
  const a = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:a', title: 'A', artist: 'AA', album: null });
  const b = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:b', title: 'B', artist: 'BB', album: null });
  const info = db.prepare(
    'INSERT INTO head_to_head_matches (round_id, winner_id, loser_id, created_at) VALUES (?,?,?,?)'
  ).run(roundId, a.id, b.id, new Date().toISOString());
  const row = db.prepare('SELECT * FROM head_to_head_matches WHERE id=?').get(info.lastInsertRowid) as any;
  expect(row.winner_id).toBe(a.id);
  expect(row.loser_id).toBe(b.id);
  expect(row.round_id).toBe(roundId);
});

it('foreign key violation when winner_id does not exist in research_songs', () => {
  const roundId = mkRound(db);
  const real = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:x', title: 'X', artist: 'XX', album: null });
  expect(() => {
    db.prepare(
      'INSERT INTO head_to_head_matches (round_id, winner_id, loser_id, created_at) VALUES (?,?,?,?)'
    ).run(roundId, 99999, real.id, new Date().toISOString());
  }).toThrow(/FOREIGN KEY/i);
});
