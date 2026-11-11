import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { dayAt, postAtFor, targetRound, windowStartFor } from '../../src/awards/schedule.js';
import type { AwardDef, AwardRound } from '../../src/awards/types.js';

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

const BBB = { key: 'bbb', day: 1 } as AwardDef;
const HBA = { key: 'hba', day: 6 } as AwardDef;
const rec = (award: string, roundId: number, extra: Partial<AwardRound> = {}): AwardRound =>
  ({ award, roundId, candidates: [], picks: {}, approvals: [], ...extra });

describe('targetRound (R13)', () => {
  // Season 2 of league 1: round 20 released 10-03 20:00Z, round 21 released 10-10 20:00Z, round 22 unreleased.
  it('earliest unposted round still before its day + 24h; window from the previous release', () => {
    expect(targetRound(mkDb(), 1, BBB, [], new Date('2026-10-11T00:00:00Z')))
      .toEqual({ roundId: 21, releasedAt: '2026-10-10T20:00:00Z', windowStart: '2026-10-03T20:00:00Z' });
  });
  it('first round of the season: window = earliest deadline minus 7d', () => {
    expect(targetRound(mkDb(), 1, BBB, [], new Date('2026-10-04T00:00:00Z')))
      .toEqual({ roundId: 20, releasedAt: '2026-10-03T20:00:00Z', windowStart: '2026-09-24T00:00:00Z' });
  });
  it('(a) BBB: curation before N+1 is published targets N+1, and still N+1 after it publishes until day 1 08:00 + 24h', () => {
    // Round 21 day 1 = Sun 10-11 08:00 PDT (15:00Z); +24h = 10-12 15:00Z.
    const db = mkDb();
    expect(targetRound(db, 1, BBB, [], new Date('2026-10-12T16:00:00Z'))).toEqual({ roundId: 22, releasedAt: null, windowStart: '2026-10-10T20:00:00Z' });
    db.exec(`INSERT INTO digest2_shares VALUES (22,'e','2026-10-17T20:00:00Z','x')`);
    // Round 22 day 1 = 10-18 15:00Z; +24h = 10-19 15:00Z.
    expect(targetRound(db, 1, BBB, [], new Date('2026-10-17T21:00:00Z'))?.roundId).toBe(22);
    expect(targetRound(db, 1, BBB, [], new Date('2026-10-19T14:59:00Z'))?.roundId).toBe(22);
    expect(targetRound(db, 1, BBB, [], new Date('2026-10-19T15:00:00Z'))).toBeNull();
  });
  it('a successful BBB post moves the target on at once', () => {
    const now = new Date('2026-10-11T16:00:00Z');
    expect(targetRound(mkDb(), 1, BBB, [rec('bbb', 21, { postedAt: '2026-10-11T15:00:00Z', sentAt: '2026-10-11T15:00:05Z' })], now)?.roundId).toBe(22);
    // in flight (claimed, no failure) also counts as posted; a failed post does not
    expect(targetRound(mkDb(), 1, BBB, [rec('bbb', 21, { postedAt: '2026-10-11T15:00:00Z' })], now)?.roundId).toBe(22);
    expect(targetRound(mkDb(), 1, BBB, [rec('bbb', 21, { postedAt: '2026-10-11T15:00:00Z', postFailed: true })], now)?.roundId).toBe(21);
    // another award's post does not count
    expect(targetRound(mkDb(), 1, BBB, [rec('hba', 21, { sentAt: 'x' })], now)?.roundId).toBe(21);
  });
  it('(b) HBA (day 6) targets N until dayAt(release_N, 6) + 24h, then N+1', () => {
    // Round 21 day 6 = Fri 10-16 08:00 PDT (15:00Z); +24h = 10-17 15:00Z.
    expect(targetRound(mkDb(), 1, HBA, [], new Date('2026-10-12T16:00:00Z'))?.roundId).toBe(21);
    expect(targetRound(mkDb(), 1, HBA, [], new Date('2026-10-17T14:59:00Z'))?.roundId).toBe(21);
    expect(targetRound(mkDb(), 1, HBA, [], new Date('2026-10-17T15:00:00Z'))).toEqual({ roundId: 22, releasedAt: null, windowStart: '2026-10-10T20:00:00Z' });
  });
  it('other league isolated; no active season -> null', () => {
    expect(targetRound(mkDb(), 2, BBB, [], new Date('2026-11-10T00:00:00Z'))?.roundId).toBe(30);
    expect(targetRound(mkDb(), 9, BBB, [], new Date('2026-11-10T00:00:00Z'))).toBeNull();
  });
});

describe('postAtFor (R14)', () => {
  const REL = '2026-11-03T20:00:00Z'; // day 1 = 11-04 16:00Z, day 2 = 11-05 16:00Z
  it('approved before the day: the scheduled 08:00', () => {
    expect(postAtFor(REL, 1, '2026-11-03T22:00:00Z')?.toISOString()).toBe('2026-11-04T16:00:00.000Z');
  });
  it('approved after the day: the next 08:00, up to the next day', () => {
    expect(postAtFor(REL, 1, '2026-11-04T20:00:00Z')?.toISOString()).toBe('2026-11-05T16:00:00.000Z');
  });
  it('later than that: null', () => {
    expect(postAtFor(REL, 1, '2026-11-05T17:00:00Z')).toBeNull();
  });
});

describe('windowStartFor', () => {
  const round = { roundId: 1, releasedAt: 'r', windowStart: '2026-10-03T20:00:00Z' };
  const def = (window: 'round' | '7d') => ({ window }) as AwardDef;
  const now = new Date('2026-11-10T12:00:00Z');
  it('round', () => expect(windowStartFor(def('round'), round, now)).toBe('2026-10-03T20:00:00Z'));
  it('7d', () => expect(windowStartFor(def('7d'), round, now)).toBe('2026-11-03T12:00:00.000Z'));
});
