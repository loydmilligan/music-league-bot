import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { resolveSourceCompetition, resolveActiveSourceCompetition } from './mlSource.mjs';

function seed() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER,
      status TEXT, source TEXT DEFAULT 'music_league', source_competition_id TEXT);
    INSERT INTO leagues (slug,name) VALUES ('second-best','Second Best');
    INSERT INTO seasons (league_id,season_number,status,source_competition_id)
      VALUES (1,1,'complete','oldid'),(1,2,'active','newid');`);
  return db;
}

test('resolveSourceCompetition returns the season mapping', () => {
  const db = seed();
  assert.deepEqual(resolveSourceCompetition(db, 'second-best', 2),
    { source: 'music_league', sourceCompetitionId: 'newid' });
  assert.equal(resolveSourceCompetition(db, 'second-best', 9), null);
});

test('resolveActiveSourceCompetition picks the highest active season', () => {
  const db = seed();
  assert.deepEqual(resolveActiveSourceCompetition(db, 'second-best'),
    { source: 'music_league', sourceCompetitionId: 'newid', seasonNumber: 2 });
});
