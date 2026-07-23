import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import {
  DEFAULT_BUDGET, resolveBudget, setRoundBudget, setSeasonBudget, getSeasonBudget,
} from './ballotDb.js';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test', 'Test')`).run();
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase)
     VALUES (100, 10, 'ml-100', 'Round 1', '2026-07-01T00:00:00Z', 'voting')`,
  ).run();
  return db;
}

it('falls back to the default budget when nothing is configured', () => {
  const db = freshDb();
  const { budget, source } = resolveBudget(db, 100);
  expect(budget).toEqual(DEFAULT_BUDGET);
  expect(source).toBe('default');
  db.close();
});

it('inherits the season budget when no round override exists', () => {
  const db = freshDb();
  setSeasonBudget(db, 10, { upTotal: 8, downTotal: 2, perSongCap: 4 });
  const { budget, source } = resolveBudget(db, 100);
  expect(budget).toEqual({ upTotal: 8, downTotal: 2, perSongCap: 4 });
  expect(source).toBe('season');
  db.close();
});

it('prefers the round override over the season budget', () => {
  const db = freshDb();
  setSeasonBudget(db, 10, { upTotal: 8, downTotal: 2, perSongCap: null });
  setRoundBudget(db, 100, { upTotal: 6, downTotal: 1, perSongCap: null });
  const { budget, source } = resolveBudget(db, 100);
  expect(budget).toEqual({ upTotal: 6, downTotal: 1, perSongCap: null });
  expect(source).toBe('round');
  db.close();
});

it('upserts the season budget instead of duplicating', () => {
  const db = freshDb();
  setSeasonBudget(db, 10, { upTotal: 8, downTotal: 2, perSongCap: null });
  setSeasonBudget(db, 10, { upTotal: 9, downTotal: 1, perSongCap: null });
  expect(getSeasonBudget(db, 10)).toEqual({ upTotal: 9, downTotal: 1, perSongCap: null });
  db.close();
});

it('resolves each round to its own season budget, not another season\'s', () => {
  const db = freshDb();
  // Add a second season and round under the same league
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (20, 1, 2, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase)
     VALUES (200, 20, 'ml-200', 'Round 2', '2026-07-01T00:00:00Z', 'voting')`,
  ).run();

  // Set different budgets for each season
  setSeasonBudget(db, 10, { upTotal: 8, downTotal: 2, perSongCap: null });
  setSeasonBudget(db, 20, { upTotal: 5, downTotal: 1, perSongCap: 3 });

  // Each round should resolve to its own season's budget
  expect(resolveBudget(db, 100).budget).toEqual({ upTotal: 8, downTotal: 2, perSongCap: null });
  expect(resolveBudget(db, 200).budget).toEqual({ upTotal: 5, downTotal: 1, perSongCap: 3 });
  expect(resolveBudget(db, 100).source).toBe('season');
  expect(resolveBudget(db, 200).source).toBe('season');
  db.close();
});
