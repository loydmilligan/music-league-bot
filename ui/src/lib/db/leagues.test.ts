import { describe, it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, getAllLeagues, getActiveSeasonsWithLeague, upsertSeason } from './leagues.js';

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
