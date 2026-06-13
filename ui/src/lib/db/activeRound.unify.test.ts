/**
 * FB-3 tests — shared active-round derivation (C4 fix).
 *
 * Both layout.ts (home rail) and resolveActiveRound (modal/API) must report
 * the same round per league. A pin in archive phase must fall through to
 * the deadline-derived round rather than being shown stale.
 */
import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound, updateDeadlines } from './rounds.js';
import { setActiveRound, getActiveLeaguesActiveRounds } from './activeRound.js';
import { getAllAdoptedLeagues } from './layout.js';
import { pickActiveRound } from './activeRoundDerive.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); seedLeagues(db); });

function leagueId(slug = 'hip-jammers'): number {
  return (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
}

// --- Unit tests for pickActiveRound shared module ---

it('pickActiveRound returns pinned round when it is not archive', () => {
  const rounds = [
    { id: 1, phase: 'archive' as const, createdAt: '2026-01-01T00:00:00Z' },
    { id: 2, phase: 'submission' as const, createdAt: '2026-02-01T00:00:00Z' },
  ];
  // Pin round 2 (submission)
  const result = pickActiveRound(rounds, 2);
  expect(result?.round.id).toBe(2);
  expect(result?.source).toBe('manual');
});

it('pickActiveRound falls through to derived when pinned round is archive', () => {
  const rounds = [
    { id: 1, phase: 'archive' as const, createdAt: '2026-01-01T00:00:00Z' },
    { id: 2, phase: 'submission' as const, createdAt: '2026-02-01T00:00:00Z' },
  ];
  // Pin round 1 (archive) — should fall through to round 2 (submission)
  const result = pickActiveRound(rounds, 1);
  expect(result?.round.id).toBe(2);
  expect(result?.source).toBe('derived');
});

it('pickActiveRound returns null when pin is archive and all others are archive too', () => {
  const rounds = [
    { id: 1, phase: 'archive' as const, createdAt: '2026-01-01T00:00:00Z' },
    { id: 2, phase: 'archive' as const, createdAt: '2026-02-01T00:00:00Z' },
  ];
  const result = pickActiveRound(rounds, 1);
  expect(result).toBeNull();
});

it('pickActiveRound prefers submission over voting over upcoming', () => {
  const rounds = [
    { id: 1, phase: 'voting' as const, createdAt: '2026-01-01T00:00:00Z' },
    { id: 2, phase: 'submission' as const, createdAt: '2026-01-01T00:00:00Z' },
    { id: 3, phase: 'upcoming' as const, createdAt: '2026-01-01T00:00:00Z' },
  ];
  const result = pickActiveRound(rounds, null);
  expect(result?.round.id).toBe(2); // submission wins
  expect(result?.source).toBe('derived');
});

it('pickActiveRound returns null when list is empty', () => {
  expect(pickActiveRound([], 42)).toBeNull();
});

// --- Integration test: pin-in-archive fallthrough via resolveActiveRound and layout.ts ---

it('C4 repro: archive-pinned round falls through on both rail and modal paths', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  db.prepare('UPDATE leagues SET is_active = 1 WHERE id = ?').run(lid);

  // round 1: all deadlines past → archive
  const r1 = upsertRound(db, sid, {
    mlRoundId: 'hj-r1', name: 'Archived Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, r1, '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z');

  // round 2: far-future deadlines → submission
  const r2 = upsertRound(db, sid, {
    mlRoundId: 'hj-r2', name: 'Live Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-02-01T00:00:00Z',
  });
  updateDeadlines(db, r2, '2099-06-01T00:00:00Z', '2099-06-08T00:00:00Z');

  // Pin to the archived round (the C4 stale-pin scenario).
  setActiveRound(db, lid, r1);

  // Modal path (resolveActiveRound via getActiveLeaguesActiveRounds)
  const modalLeague = getActiveLeaguesActiveRounds(db).find(l => l.slug === 'hip-jammers');
  expect(modalLeague?.activeRound?.id).toBe(r2);
  expect(modalLeague?.activeRound?.source).toBe('derived');

  // Home rail path (pickCurrentRound via getAllAdoptedLeagues)
  const railLeague = getAllAdoptedLeagues(db).find(l => l.slug === 'hip-jammers');
  expect(railLeague?.currentRoundId).toBe(r2);

  // Both paths agree.
  expect(modalLeague?.activeRound?.id).toBe(railLeague?.currentRoundId);
});

it('live pin is honoured by both paths when the pinned round is not archive', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  db.prepare('UPDATE leagues SET is_active = 1 WHERE id = ?').run(lid);

  // round 1: voting phase
  const r1 = upsertRound(db, sid, {
    mlRoundId: 'hj2-r1', name: 'Voting Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, r1, '2020-01-01T00:00:00Z', '2099-06-08T00:00:00Z');

  // round 2: submission phase (deadline-derived would pick this without pin)
  const r2 = upsertRound(db, sid, {
    mlRoundId: 'hj2-r2', name: 'Submission Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-02-01T00:00:00Z',
  });
  updateDeadlines(db, r2, '2099-07-01T00:00:00Z', '2099-07-08T00:00:00Z');

  // Explicitly pin to r1 (voting, non-archive)
  setActiveRound(db, lid, r1);

  const modalLeague = getActiveLeaguesActiveRounds(db).find(l => l.slug === 'hip-jammers');
  expect(modalLeague?.activeRound?.id).toBe(r1);
  expect(modalLeague?.activeRound?.source).toBe('manual');

  const railLeague = getAllAdoptedLeagues(db).find(l => l.slug === 'hip-jammers');
  expect(railLeague?.currentRoundId).toBe(r1);

  expect(modalLeague?.activeRound?.id).toBe(railLeague?.currentRoundId);
});
