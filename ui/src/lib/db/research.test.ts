import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getResearchSongs, addResearchSong, updateResearchSong } from './research.js';

let db: Database.Database;
let roundId: number;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'research-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
});

it('getResearchSongs excludes removed songs by default', () => {
  const a = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:a', title: 'A', artist: 'Artist A', album: null });
  addResearchSong(db, { roundId, spotifyUri: 'spotify:track:b', title: 'B', artist: 'Artist B', album: null });
  updateResearchSong(db, a.id, { removedReason: 'user_removed', removedAt: '2026-01-02T00:00:00Z' } as any);

  const active = getResearchSongs(db, roundId);
  expect(active.map(s => s.spotifyUri)).toEqual(['spotify:track:b']);
});

it('getResearchSongs({ includeRemoved: true }) returns everything', () => {
  const a = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:a', title: 'A', artist: 'Artist A', album: null });
  updateResearchSong(db, a.id, { removedReason: 'user_removed', removedAt: '2026-01-02T00:00:00Z' } as any);

  const all = getResearchSongs(db, roundId, { includeRemoved: true });
  expect(all).toHaveLength(1);
  expect(all[0].removedReason).toBe('user_removed');
});

it('updateResearchSong persists removedReason, removedBySongId, removedAt', () => {
  const winner = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:winner', title: 'W', artist: 'Artist W', album: null });
  const loser = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:loser', title: 'L', artist: 'Artist L', album: null });
  updateResearchSong(db, loser.id, {
    removedReason: 'h2h_loss', removedBySongId: winner.id, removedAt: '2026-01-03T00:00:00Z',
  } as any);

  const all = getResearchSongs(db, roundId, { includeRemoved: true });
  const found = all.find(s => s.id === loser.id)!;
  expect(found.removedReason).toBe('h2h_loss');
  expect(found.removedBySongId).toBe(winner.id);
  expect(found.removedAt).toBe('2026-01-03T00:00:00Z');
});
