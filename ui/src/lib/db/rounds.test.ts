import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound, updateDeadlines, getRoundById } from './rounds.js';
import type Database from 'better-sqlite3';

function mk(db: Database.Database): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 99, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId: 'r-deadline', name: 'deadline', description: '',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('writes both deadlines when both are provided', () => {
  const id = mk(db);
  updateDeadlines(db, id, '2026-07-22T00:00', '2026-07-26T00:00');
  const r = getRoundById(db, id)!;
  expect(r.submissionDeadline).toBe('2026-07-22T00:00');
  expect(r.votingDeadline).toBe('2026-07-26T00:00');
});

it('undefined preserves the existing column — partial updates only patch what was passed', () => {
  const id = mk(db);
  updateDeadlines(db, id, '2026-07-22T00:00', '2026-07-26T00:00');
  // Save again with only the voting deadline changed; submission must survive.
  updateDeadlines(db, id, undefined, '2026-08-01T00:00');
  const r = getRoundById(db, id)!;
  expect(r.submissionDeadline).toBe('2026-07-22T00:00');
  expect(r.votingDeadline).toBe('2026-08-01T00:00');
});

it('explicit null clears a column (intentional opt-in)', () => {
  const id = mk(db);
  updateDeadlines(db, id, '2026-07-22T00:00', '2026-07-26T00:00');
  updateDeadlines(db, id, null, undefined);
  const r = getRoundById(db, id)!;
  expect(r.submissionDeadline).toBeNull();
  expect(r.votingDeadline).toBe('2026-07-26T00:00');
});

it('all-undefined is a no-op (does not crash, does not wipe)', () => {
  const id = mk(db);
  updateDeadlines(db, id, '2026-07-22T00:00', '2026-07-26T00:00');
  expect(() => updateDeadlines(db, id, undefined, undefined)).not.toThrow();
  const r = getRoundById(db, id)!;
  expect(r.submissionDeadline).toBe('2026-07-22T00:00');
  expect(r.votingDeadline).toBe('2026-07-26T00:00');
});
