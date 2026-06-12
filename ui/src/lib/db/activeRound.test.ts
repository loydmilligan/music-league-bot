import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound, updateDeadlines } from './rounds.js';
import {
  markLeagueActive, setActiveRound, getActiveSeasonId,
  getActiveLeaguesActiveRounds, getLeagueActiveRound, createRoundWithDeadlines,
} from './activeRound.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); seedLeagues(db); });

function leagueId(slug: string): number {
  return (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
}

it('fresh seeded leagues start inactive — getActiveLeaguesActiveRounds is empty', () => {
  expect(getActiveLeaguesActiveRounds(db)).toEqual([]);
});

it('surfaces leagues with active seasons even when the manual active flag is unset', () => {
  const hj = leagueId('hip-jammers');
  const seasonId = upsertSeason(db, hj, 1, 'active');
  const rid = upsertRound(db, seasonId, {
    mlRoundId: 'derived-active-r1',
    name: 'Round 1',
    description: 'theme one',
    spotifyPlaylistUrl: '',
    createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, rid, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z');

  const out = getActiveLeaguesActiveRounds(db);

  expect(out.map(l => l.slug)).toContain('hip-jammers');
  expect(out.find(l => l.slug === 'hip-jammers')?.isActive).toBe(true);
  expect(out.find(l => l.slug === 'hip-jammers')?.activeRound?.id).toBe(rid);
});

it('treats a complete season with a live round as active for the picker', () => {
  const hj = leagueId('hip-jammers');
  const seasonId = upsertSeason(db, hj, 1, 'complete');
  const rid = upsertRound(db, seasonId, {
    mlRoundId: 'live-r1',
    name: 'Round 1',
    description: 'theme one',
    spotifyPlaylistUrl: '',
    createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, rid, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z');

  expect(getActiveSeasonId(db, hj)).toBe(seasonId);

  const out = getActiveLeaguesActiveRounds(db);
  const view = out.find(l => l.slug === 'hip-jammers');
  expect(view?.activeSeasonId).toBe(seasonId);
  expect(view?.activeRound?.id).toBe(rid);
});

it('does not resolve an archived round as active when every active-season round is past deadline', () => {
  const hj = leagueId('hip-jammers');
  const seasonId = upsertSeason(db, hj, 1, 'active');
  const r1 = upsertRound(db, seasonId, {
    mlRoundId: 'archived-r1',
    name: 'Round 1',
    description: 'old theme',
    spotifyPlaylistUrl: '',
    createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, r1, '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z');

  const view = getLeagueActiveRound(db, hj)!;

  expect(view.activeRound).toBeNull();
  expect(view.needsNextRound).toBe(true);
});

it('markLeagueActive surfaces the league with a null active round when it has no rounds', () => {
  const hj = leagueId('hip-jammers');
  upsertSeason(db, hj, 1, 'active');
  markLeagueActive(db, hj, true);
  const out = getActiveLeaguesActiveRounds(db);
  expect(out).toHaveLength(1);
  expect(out[0].slug).toBe('hip-jammers');
  expect(out[0].activeRound).toBeNull(); // → modal in the UI
});

it('derives the active round from the active season when no manual slot is set', () => {
  const hj = leagueId('hip-jammers');
  const seasonId = upsertSeason(db, hj, 1, 'active');
  const rid = upsertRound(db, seasonId, {
    mlRoundId: 'r1', name: 'Round 1', description: 'theme one',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
  // open submission window so it derives as the current round
  updateDeadlines(db, rid, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z');
  markLeagueActive(db, hj, true);

  const view = getLeagueActiveRound(db, hj)!;
  expect(view.activeRound?.id).toBe(rid);
  expect(view.activeRound?.source).toBe('derived');
  expect(view.activeRound?.theme).toBe('theme one');
  expect(view.availableRounds.map(r => r.id)).toContain(rid);
});

it('manual slot wins over derived and reports source=manual', () => {
  const hj = leagueId('hip-jammers');
  const seasonId = upsertSeason(db, hj, 1, 'active');
  const r1 = upsertRound(db, seasonId, { mlRoundId: 'r1', name: 'R1', description: '', spotifyPlaylistUrl: '', createdAt: new Date().toISOString() });
  const r2 = upsertRound(db, seasonId, { mlRoundId: 'r2', name: 'R2', description: '', spotifyPlaylistUrl: '', createdAt: new Date().toISOString() });
  updateDeadlines(db, r1, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z'); // derived would pick r1
  markLeagueActive(db, hj, true);
  setActiveRound(db, hj, r2);

  const view = getLeagueActiveRound(db, hj)!;
  expect(view.activeRound?.id).toBe(r2);
  expect(view.activeRound?.source).toBe('manual');
});

it('setActiveRound rejects a round from another league', () => {
  const hj = leagueId('hip-jammers');
  const fam = leagueId('fam-jam');
  const famSeason = upsertSeason(db, fam, 1, 'active');
  const famRound = upsertRound(db, famSeason, { mlRoundId: 'fr1', name: 'FR1', description: '', spotifyPlaylistUrl: '', createdAt: new Date().toISOString() });
  expect(() => setActiveRound(db, hj, famRound)).toThrow(/does not belong/);
});

it('createRoundWithDeadlines inserts into the active season and can set the slot', () => {
  const hj = leagueId('hip-jammers');
  const seasonId = upsertSeason(db, hj, 1, 'active');
  markLeagueActive(db, hj, true);

  const { roundId, seasonId: usedSeason } = createRoundWithDeadlines(db, hj, {
    name: 'Fresh Round', theme: 'a brand new theme',
    submissionDeadline: '2099-03-01T00:00:00Z', votingDeadline: '2099-03-08T00:00:00Z',
    setActive: true,
  });
  expect(usedSeason).toBe(seasonId);
  expect(getActiveSeasonId(db, hj)).toBe(seasonId);

  const view = getLeagueActiveRound(db, hj)!;
  expect(view.activeRound?.id).toBe(roundId);
  expect(view.activeRound?.source).toBe('manual');
  expect(view.activeRound?.theme).toBe('a brand new theme');
  expect(view.activeRound?.submissionDeadline).toBe('2099-03-01T00:00:00Z');
});

it('createRoundWithDeadlines throws when the league has no active season', () => {
  const hj = leagueId('hip-jammers');
  markLeagueActive(db, hj, true);
  expect(() => createRoundWithDeadlines(db, hj, { name: 'X' })).toThrow(/no active season/);
});

it('a dangling manual slot falls back to derived resolution', () => {
  const hj = leagueId('hip-jammers');
  const seasonId = upsertSeason(db, hj, 1, 'active');
  const r1 = upsertRound(db, seasonId, { mlRoundId: 'r1', name: 'R1', description: '', spotifyPlaylistUrl: '', createdAt: new Date().toISOString() });
  updateDeadlines(db, r1, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z');
  markLeagueActive(db, hj, true);
  // point the slot at a non-existent round id (FK normally guards this; a
  // legacy/FK-off DB could still carry one — the resolver must not blow up).
  db.pragma('foreign_keys = OFF');
  db.prepare('UPDATE leagues SET active_round_id = 99999 WHERE id = ?').run(hj);
  db.pragma('foreign_keys = ON');
  const view = getLeagueActiveRound(db, hj)!;
  expect(view.activeRound?.id).toBe(r1);
  expect(view.activeRound?.source).toBe('derived');
});
