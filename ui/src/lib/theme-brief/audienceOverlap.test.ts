import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ownerExposure, resolveOwnerCompetitorId } from './audienceOverlap.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER);
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE competitors (id INTEGER PRIMARY KEY, name TEXT, player_id INTEGER);
    CREATE TABLE season_players (season_id INTEGER, player_id INTEGER);
    CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INTEGER, competitor_id INTEGER, title TEXT, artists TEXT);
  `);
  // leagues: 1=Hip Jammers, 3=Second Best, 5=Boarz (target)
  db.prepare('INSERT INTO leagues VALUES (1,?),(3,?),(5,?)').run('Hip Jammers', 'Second Best', 'Boarz');
  db.prepare('INSERT INTO seasons VALUES (11,1),(33,3),(55,5)').run(); // s11∈HJ, s33∈SB, s55∈Boarz
  db.prepare('INSERT INTO rounds VALUES (69,11),(109,33)').run();      // R69∈s11, R109∈s33
  db.prepare('INSERT INTO players VALUES (1,?),(4,?)').run('Matt', 'Jon Black');
  db.prepare('INSERT INTO competitors VALUES (3,?,1)').run('Mashew');  // owner = player 1
  // rosters: Matt in all; Jon Black in SB(s33) + Boarz(s55) but NOT HJ(s11)
  db.prepare('INSERT INTO season_players VALUES (11,1),(33,1),(55,1),(33,4),(55,4)').run();
  // owner submitted Abissama in R69 (HJ) and R109 (SB)
  db.prepare('INSERT INTO ml_submissions VALUES (900,69,3,?,?)').run('Abissama', 'Incredible Polo');
  db.prepare('INSERT INTO ml_submissions VALUES (901,109,3,?,?)').run('Abissama', 'Incredible Polo');
  return db;
}

describe('resolveOwnerCompetitorId', () => {
  it('finds the owner competitor by name', () => {
    expect(resolveOwnerCompetitorId(makeDb(), 'Mashew')).toBe(3);
  });
  it('returns null when absent', () => {
    expect(resolveOwnerCompetitorId(makeDb(), 'Nobody')).toBeNull();
  });
});

describe('ownerExposure', () => {
  it('flags the Second Best submission as recognizable (Jon Black), not the Hip Jammers one', () => {
    const rows = ownerExposure(makeDb(), 3, [69, 109], 5);
    const hj = rows.find((r) => r.roundId === 69)!;
    const sb = rows.find((r) => r.roundId === 109)!;
    expect(hj.recognizable).toBe(false);
    expect(hj.seenBy).toEqual([]);
    expect(sb.recognizable).toBe(true);
    expect(sb.seenBy).toEqual([{ playerId: 4, name: 'Jon Black' }]); // excludes the owner himself
  });
});
