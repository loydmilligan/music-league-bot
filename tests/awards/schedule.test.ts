import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { currentRound, dayAt, windowStartFor } from '../../src/awards/schedule.js';
import type { AwardDef } from '../../src/awards/types.js';

describe('dayAt', () => {
  it('evening release -> next 08:00 LA', () => {
    expect(dayAt('2026-11-10T21:00:00Z', 1).toISOString()).toBe('2026-11-11T16:00:00.000Z');
  });
  it('07:30 LA release -> same morning', () => {
    expect(dayAt('2026-11-10T15:30:00Z', 1).toISOString()).toBe('2026-11-10T16:00:00.000Z');
  });
  it('day 6', () => {
    expect(dayAt('2026-11-10T21:00:00Z', 6).toISOString()).toBe('2026-11-16T16:00:00.000Z');
  });
  it('DST fall-back: day 2 after Oct 31 evening is PST', () => {
    expect(dayAt('2026-11-01T02:00:00Z', 2).toISOString()).toBe('2026-11-02T16:00:00.000Z');
  });
  it('PDT day is 15:00Z', () => {
    expect(dayAt('2026-10-30T20:00:00Z', 1).toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });
});

function mkDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE seasons(id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER, status TEXT);
    CREATE TABLE rounds(id INTEGER PRIMARY KEY, season_id INTEGER, round_number INTEGER, submission_deadline TEXT);
    CREATE TABLE digest2_shares(round_id INTEGER PRIMARY KEY, slug TEXT, created_at TEXT, updated_at TEXT);
  `);
  db.exec(`
    INSERT INTO seasons VALUES (1,1,1,'complete'),(2,1,2,'active'),(3,2,1,'active');
    INSERT INTO rounds VALUES (10,1,1,'2026-01-01T00:00:00Z'),(20,2,1,'2026-10-01T00:00:00Z'),(21,2,2,'2026-10-08T00:00:00Z'),(22,2,3,'2026-10-15T00:00:00Z'),(30,3,1,'2026-11-01T00:00:00Z');
    INSERT INTO digest2_shares VALUES (10,'a','2026-01-05T00:00:00Z','x'),(20,'b','2026-10-03T20:00:00Z','x'),(21,'c','2026-10-10T20:00:00Z','x'),(30,'d','2026-11-09T20:00:00Z','x');
  `);
  return db;
}

describe('currentRound', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  it('latest shared round of the active season, window from previous release', () => {
    expect(currentRound(mkDb(), 1, now)).toEqual({ roundId: 21, releasedAt: '2026-10-10T20:00:00Z', windowStart: '2026-10-03T20:00:00Z' });
  });
  it('no earlier shared round: season start = earliest deadline minus 7d', () => {
    const db = mkDb();
    db.exec(`DELETE FROM digest2_shares WHERE round_id=20`);
    expect(currentRound(db, 1, now)).toEqual({ roundId: 21, releasedAt: '2026-10-10T20:00:00Z', windowStart: '2026-09-24T00:00:00Z' });
  });
  it('other league isolated; none -> null', () => {
    expect(currentRound(mkDb(), 2, now)?.roundId).toBe(30);
    expect(currentRound(mkDb(), 9, now)).toBeNull();
  });
});

describe('windowStartFor', () => {
  const round = { roundId: 1, releasedAt: 'r', windowStart: '2026-10-03T20:00:00Z' };
  const def = (window: 'round' | '7d') => ({ window }) as AwardDef;
  const now = new Date('2026-11-10T12:00:00Z');
  it('round', () => expect(windowStartFor(def('round'), round, now)).toBe('2026-10-03T20:00:00Z'));
  it('7d', () => expect(windowStartFor(def('7d'), round, now)).toBe('2026-11-03T12:00:00.000Z'));
});
