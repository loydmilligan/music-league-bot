/**
 * Phase-truth tests (sprint-34).
 *
 * Stored `rounds.phase` is authoritative. A round whose voting_deadline has
 * already passed but whose stored phase is 'voting' must stay in voting — the
 * clock must not flip it to archive. Deadline derivation is the fallback only
 * when `phase` is null.
 */
import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound, updateDeadlines, getRoundsForSeason } from './rounds.js';
import {
  markLeagueActive, setActiveRound,
  getActiveLeaguesActiveRounds, getLeagueActiveRound,
} from './activeRound.js';
import { getAllAdoptedLeagues } from './layout.js';
import { runPrepChecks } from '../digest/prepChecks.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); seedLeagues(db); });

function leagueId(slug = 'hip-jammers'): number {
  return (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
}

// ── getRoundsForSeason: stored phase overrides deadline derivation ──────────

it('stored phase=voting overrides a past voting_deadline (no archive flip)', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  const rid = upsertRound(db, sid, {
    mlRoundId: 'pt-r1', name: 'Round 1', description: 'theme',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  // Deadline in the past — without stored phase this would derive as archive.
  updateDeadlines(db, rid, '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z');
  // Force stored phase to voting.
  db.prepare("UPDATE rounds SET phase='voting' WHERE id=?").run(rid);

  const rounds = getRoundsForSeason(db, sid);
  expect(rounds.find(r => r.id === rid)?.phase).toBe('voting');
});

it('stored phase=submission overrides a past submission_deadline', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  const rid = upsertRound(db, sid, {
    mlRoundId: 'pt-r2', name: 'Round 2', description: 'theme',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, rid, '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z');
  db.prepare("UPDATE rounds SET phase='submission' WHERE id=?").run(rid);

  const rounds = getRoundsForSeason(db, sid);
  expect(rounds.find(r => r.id === rid)?.phase).toBe('submission');
});

it('null phase falls back to deadline derivation', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  const rid = upsertRound(db, sid, {
    mlRoundId: 'pt-r3', name: 'Round 3', description: 'theme',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, rid, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z');
  // Ensure phase is null (upsertRound doesn't set it; backfill already ran but
  // in-memory DB starts fresh so phase column starts NULL here).
  db.prepare('UPDATE rounds SET phase=NULL WHERE id=?').run(rid);

  const rounds = getRoundsForSeason(db, sid);
  // Future deadlines → derived as 'submission' (first round in season).
  expect(rounds.find(r => r.id === rid)?.phase).toBe('submission');
});

// ── Active-round resolution: stored phase keeps stale-deadline round active ─

it('getLeagueActiveRound resolves stored-voting round as active despite past deadline', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  markLeagueActive(db, lid, true);

  const rid = upsertRound(db, sid, {
    mlRoundId: 'pt-r4', name: 'Stale Voting Round', description: 'theme',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, rid, '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z');
  db.prepare("UPDATE rounds SET phase='voting' WHERE id=?").run(rid);

  // Without stored phase this would derive as archive → no active round.
  // With stored phase it stays voting → resolves as the active round.
  const view = getLeagueActiveRound(db, lid)!;
  expect(view.activeRound?.id).toBe(rid);
  expect(view.activeRound?.phase).toBe('voting');
});

it('getActiveLeaguesActiveRounds: stored-voting round stays active on both paths', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  markLeagueActive(db, lid, true);

  const rid = upsertRound(db, sid, {
    mlRoundId: 'pt-r5', name: 'Stale Voting', description: 'theme',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, rid, '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z');
  db.prepare("UPDATE rounds SET phase='voting' WHERE id=?").run(rid);

  // Modal path
  const modal = getActiveLeaguesActiveRounds(db).find(l => l.slug === 'hip-jammers');
  expect(modal?.activeRound?.id).toBe(rid);

  // Home rail path
  const rail = getAllAdoptedLeagues(db).find(l => l.slug === 'hip-jammers');
  expect(rail?.currentRoundId).toBe(rid);

  // Both agree
  expect(modal?.activeRound?.id).toBe(rail?.currentRoundId);
});

// ── Manual pin: stored-voting round honoured when pinned ───────────────────

it('manual pin on a stored-voting round (past deadline) is honoured', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  markLeagueActive(db, lid, true);

  const r1 = upsertRound(db, sid, {
    mlRoundId: 'pt-r6', name: 'Old Voting', description: 'theme',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, r1, '2020-01-01T00:00:00Z', '2020-01-08T00:00:00Z');
  db.prepare("UPDATE rounds SET phase='voting' WHERE id=?").run(r1);

  const r2 = upsertRound(db, sid, {
    mlRoundId: 'pt-r7', name: 'New Submission', description: 'theme2',
    spotifyPlaylistUrl: '', createdAt: '2026-02-01T00:00:00Z',
  });
  updateDeadlines(db, r2, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z');
  db.prepare("UPDATE rounds SET phase='submission' WHERE id=?").run(r2);

  // Pin to r1 (stored voting, past deadline).
  setActiveRound(db, lid, r1);

  const view = getLeagueActiveRound(db, lid)!;
  // Pin honoured because stored phase=voting, not archive.
  expect(view.activeRound?.id).toBe(r1);
  expect(view.activeRound?.source).toBe('manual');
});

// ── prep-checks: blank deadline does not block meta_ok ─────────────────────

it('runPrepChecks: Round metadata passes with description and no deadlines', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  const rid = upsertRound(db, sid, {
    mlRoundId: 'pt-r8', name: 'No-deadline Round', description: 'has a theme',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  // Leave deadlines NULL intentionally.

  const checks = runPrepChecks(db, rid);
  const meta = checks.find(c => c.name === 'Round metadata')!;
  expect(meta.ok).toBe(true);
});

it('runPrepChecks: Round metadata fails when description is missing', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  const rid = upsertRound(db, sid, {
    mlRoundId: 'pt-r9', name: 'No-theme Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  updateDeadlines(db, rid, '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z');

  const checks = runPrepChecks(db, rid);
  const meta = checks.find(c => c.name === 'Round metadata')!;
  expect(meta.ok).toBe(false);
});
