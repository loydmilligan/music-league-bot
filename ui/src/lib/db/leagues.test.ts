import { it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, getAllLeagues, getActiveSeasonsWithLeague, upsertSeason, setSeasonStatus } from './leagues.js';
import { upsertRound, updateDeadlines } from './rounds.js';

const mk = () => openLeagueDb(':memory:');

it('seeds 4 leagues, nostalgia-pit excluded', () => {
  const db = mk(); seedLeagues(db);
  const leagues = getAllLeagues(db);
  expect(leagues).toHaveLength(4);
  expect(leagues.find(l => l.slug === 'nostalgia-pit')?.excludeFromCombined).toBe(true);
});

it('seed idempotent', () => {
  const db = mk(); seedLeagues(db); seedLeagues(db);
  expect(getAllLeagues(db)).toHaveLength(4);
});

it('getActiveSeasonsWithLeague', () => {
  const db = mk(); seedLeagues(db);
  const [hj] = getAllLeagues(db);
  upsertSeason(db, hj.id, 1, 'complete');
  upsertSeason(db, hj.id, 3, 'active');
  const active = getActiveSeasonsWithLeague(db);
  expect(active).toHaveLength(1);
  expect(active[0].seasonNumber).toBe(3);
});

it('getActiveSeasonsWithLeague includes a stale complete season when it still has a live round', () => {
  const db = mk(); seedLeagues(db);
  const [hj] = getAllLeagues(db);
  const seasonId = upsertSeason(db, hj.id, 1, 'complete');
  const roundId = upsertRound(db, seasonId, {
    mlRoundId: 'live-round',
    name: 'Round 1',
    description: 'theme',
    spotifyPlaylistUrl: '',
    createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, roundId, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z');

  const active = getActiveSeasonsWithLeague(db);
  expect(active.map(s => s.id)).toContain(seasonId);
});

it('setSeasonStatus explicitly overrides season lifecycle state', () => {
  const db = mk(); seedLeagues(db);
  const [hj] = getAllLeagues(db);
  const seasonId = upsertSeason(db, hj.id, 4, 'complete');

  expect(setSeasonStatus(db, seasonId, 'active')).toBe(true);
  expect(getActiveSeasonsWithLeague(db).map(s => s.id)).toContain(seasonId);

  expect(setSeasonStatus(db, 99999, 'complete')).toBe(false);
});
