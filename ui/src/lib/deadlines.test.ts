import { it, expect, beforeEach } from 'vitest';
import { computeDeadlines } from './deadlines.js';
import { openLeagueDb } from './db/client.js';
import { seedLeagues, upsertSeason } from './db/leagues.js';
import { upsertRound, getRoundById, updateDeadlines } from './db/rounds.js';
import type Database from 'better-sqlite3';

function mkSeason(db: Database.Database, n = 99): { leagueId: number; seasonId: number } {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, n, 'active');
  return { leagueId, seasonId };
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('round 1 submission = startDate + daysToSubmit; voting = submission + daysToVote', () => {
  const got = computeDeadlines(1, { daysToSubmit: 4, daysToVote: 3, startDate: '2026-05-20' });
  expect(got).toEqual([
    { submissionDeadline: '2026-05-24T00:00', votingDeadline: '2026-05-27T00:00' },
  ]);
});

it('round N starts where round N-1 ends (back-to-back voting → next submission)', () => {
  const got = computeDeadlines(3, { daysToSubmit: 4, daysToVote: 3, startDate: '2026-05-20' });
  expect(got.map(r => r.submissionDeadline)).toEqual([
    '2026-05-24T00:00', '2026-05-31T00:00', '2026-06-07T00:00',
  ]);
  expect(got.map(r => r.votingDeadline)).toEqual([
    '2026-05-27T00:00', '2026-06-03T00:00', '2026-06-10T00:00',
  ]);
});

it('throws on invalid startDate', () => {
  expect(() => computeDeadlines(1, { daysToSubmit: 1, daysToVote: 1, startDate: 'not-a-date' }))
    .toThrow(/startDate/);
});

it('throws on non-positive days', () => {
  expect(() => computeDeadlines(1, { daysToSubmit: 0, daysToVote: 1, startDate: '2026-05-20' }))
    .toThrow(/daysToSubmit/);
  expect(() => computeDeadlines(1, { daysToSubmit: 1, daysToVote: -2, startDate: '2026-05-20' }))
    .toThrow(/daysToVote/);
});

it('end-to-end against the DB: three rounds in a season get back-to-back deadlines written', () => {
  const { seasonId } = mkSeason(db);
  const r1 = upsertRound(db, seasonId, { mlRoundId: 'r1', name: 'R1', description: '', spotifyPlaylistUrl: '', createdAt: '2026-05-15T00:00:00Z' });
  const r2 = upsertRound(db, seasonId, { mlRoundId: 'r2', name: 'R2', description: '', spotifyPlaylistUrl: '', createdAt: '2026-05-16T00:00:00Z' });
  const r3 = upsertRound(db, seasonId, { mlRoundId: 'r3', name: 'R3', description: '', spotifyPlaylistUrl: '', createdAt: '2026-05-17T00:00:00Z' });

  const computed = computeDeadlines(3, { daysToSubmit: 4, daysToVote: 3, startDate: '2026-05-20' });
  for (const [i, rid] of [r1, r2, r3].entries()) {
    updateDeadlines(db, rid, computed[i].submissionDeadline, computed[i].votingDeadline);
  }

  expect(getRoundById(db, r1)!.submissionDeadline).toBe('2026-05-24T00:00');
  expect(getRoundById(db, r1)!.votingDeadline).toBe('2026-05-27T00:00');
  expect(getRoundById(db, r3)!.submissionDeadline).toBe('2026-06-07T00:00');
  expect(getRoundById(db, r3)!.votingDeadline).toBe('2026-06-10T00:00');
});
