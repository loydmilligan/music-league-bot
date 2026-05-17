import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound, getRoundById, patchRound } from './rounds.js';
import type Database from 'better-sqlite3';

function mk(db: Database.Database): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 99, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId: 'patch-test', name: 'Old Name', description: 'Old Theme',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('patches a single field and leaves the rest alone', () => {
  const id = mk(db);
  expect(patchRound(db, id, { description: 'New Theme' })).toBe(true);
  const r = getRoundById(db, id)!;
  expect(r.description).toBe('New Theme');
  expect(r.name).toBe('Old Name');
});

it('multi-field patch in one call', () => {
  const id = mk(db);
  patchRound(db, id, {
    name: 'New Name',
    description: 'New Theme',
    submissionDeadline: '2026-06-01T00:00',
    votingDeadline: '2026-06-05T00:00',
    spotifyPlaylistUrl: 'https://open.spotify.com/playlist/abc123',
  });
  const r = getRoundById(db, id)!;
  expect(r.name).toBe('New Name');
  expect(r.description).toBe('New Theme');
  expect(r.submissionDeadline).toBe('2026-06-01T00:00');
  expect(r.votingDeadline).toBe('2026-06-05T00:00');
  expect(r.spotifyPlaylistUrl).toBe('https://open.spotify.com/playlist/abc123');
});

it('null clears a column (intentional)', () => {
  const id = mk(db);
  patchRound(db, id, { spotifyPlaylistUrl: 'https://open.spotify.com/playlist/xyz' });
  patchRound(db, id, { spotifyPlaylistUrl: null });
  expect(getRoundById(db, id)!.spotifyPlaylistUrl).toBeNull();
});

it('empty patch is a no-op (no SQL, returns false)', () => {
  const id = mk(db);
  expect(patchRound(db, id, {})).toBe(false);
  expect(getRoundById(db, id)!.name).toBe('Old Name');
});

it('phase is recomputed from the patched deadlines', () => {
  const id = mk(db);
  // Far-future deadlines → submission phase
  patchRound(db, id, {
    submissionDeadline: '2099-01-01T00:00',
    votingDeadline: '2099-01-08T00:00',
  });
  expect(getRoundById(db, id)!.phase).toBe('submission');
  // Past deadlines → archive phase
  patchRound(db, id, {
    submissionDeadline: '2020-01-01T00:00',
    votingDeadline: '2020-01-08T00:00',
  });
  expect(getRoundById(db, id)!.phase).toBe('archive');
});
