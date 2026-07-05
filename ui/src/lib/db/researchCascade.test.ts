import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { addSongToRoundWithShortlistCascade } from './researchCascade.js';

let db: Database.Database;
let roundId: number;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'cascade-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
});

it('creates a shortlist_songs row and a research_songs row for the round', () => {
  const result = addSongToRoundWithShortlistCascade(db, {
    roundId, spotifyUri: 'spotify:track:xyz', title: 'Song', artist: 'Artist', album: 'Album',
    notes: 'great pick', ratings: { discoveryPotential: 4, themeFit: 5, quality: 3, replayability: 4 },
  });

  const shortlistRow = db.prepare('SELECT * FROM shortlist_songs WHERE spotify_uri=?').get('spotify:track:xyz');
  expect(shortlistRow).toBeTruthy();

  const researchRow = db.prepare('SELECT * FROM research_songs WHERE round_id=? AND spotify_uri=?').get(roundId, 'spotify:track:xyz') as any;
  expect(researchRow.notes).toBe('great pick');
  expect(researchRow.discovery_potential).toBe(4);
  expect(researchRow.theme_fit).toBe(5);
  expect(researchRow.quality).toBe(3);
  expect(researchRow.replayability).toBe(4);
  expect(result.researchSongId).toBe(researchRow.id);
});

it('does not duplicate the shortlist row if one already exists for that spotify_uri', () => {
  addSongToRoundWithShortlistCascade(db, { roundId, spotifyUri: 'spotify:track:dup', title: 'Song', artist: 'Artist' });
  addSongToRoundWithShortlistCascade(db, { roundId, spotifyUri: 'spotify:track:dup', title: 'Song', artist: 'Artist' });

  const count = (db.prepare('SELECT COUNT(*) AS n FROM shortlist_songs WHERE spotify_uri=?').get('spotify:track:dup') as { n: number }).n;
  expect(count).toBe(1);
});

it('is idempotent for the same round + song — second call updates notes/ratings on the same research_songs row', () => {
  const first = addSongToRoundWithShortlistCascade(db, {
    roundId, spotifyUri: 'spotify:track:idem', title: 'Song', artist: 'Artist', notes: 'v1',
  });
  const second = addSongToRoundWithShortlistCascade(db, {
    roundId, spotifyUri: 'spotify:track:idem', title: 'Song', artist: 'Artist', notes: 'v2',
  });

  expect(second.researchSongId).toBe(first.researchSongId);
  const researchRow = db.prepare('SELECT notes FROM research_songs WHERE id=?').get(first.researchSongId) as { notes: string };
  expect(researchRow.notes).toBe('v2');
});
