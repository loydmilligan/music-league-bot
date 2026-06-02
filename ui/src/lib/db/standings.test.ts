import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import {
  computeStandings,
  getStandings,
  reconcile,
  readStoredStandings,
  persistStandings,
  adoptComputed,
  applyEdits,
  backfillSeasonStandings,
} from './standings.js';

// Build a two-round season with four competitors (D appears only in round 2).
// Round 1 totals:  A=5, B=3, C=1
// Round 2 points:  A=1, B=4, C=2, D=5  →  A=6, B=7, C=3, D=5
function seed(db: Database.Database): { seasonId: number; r1: number; r2: number; ids: Record<string, number> } {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  const r1 = upsertRound(db, seasonId, { mlRoundId: 'r1', name: 'Round 1', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  const r2 = upsertRound(db, seasonId, { mlRoundId: 'r2', name: 'Round 2', description: '', spotifyPlaylistUrl: '', createdAt: '2026-02-01T00:00:00Z' });

  const ids: Record<string, number> = {};
  const cstmt = db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)');
  for (const n of ['A', 'B', 'C', 'D']) ids[n] = Number(cstmt.run(`c-${n}`, n).lastInsertRowid);

  const sub = db.prepare(
    `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const vote = db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const now = '2026-01-01T00:00:00Z';

  // Round 1 submissions
  sub.run(r1, ids.A, 'uri:s1', 's1', 'A', now);
  sub.run(r1, ids.B, 'uri:s2', 's2', 'B', now);
  sub.run(r1, ids.C, 'uri:s3', 's3', 'C', now);
  // Round 1 votes → s1=5, s2=3, s3=1
  vote.run(r1, ids.B, 'uri:s1', 3, now);
  vote.run(r1, ids.C, 'uri:s1', 2, now);
  vote.run(r1, ids.A, 'uri:s2', 2, now);
  vote.run(r1, ids.C, 'uri:s2', 1, now);
  vote.run(r1, ids.A, 'uri:s3', 1, now);

  // Round 2 submissions (D is new)
  sub.run(r2, ids.A, 'uri:s4', 's4', 'A', now);
  sub.run(r2, ids.B, 'uri:s5', 's5', 'B', now);
  sub.run(r2, ids.C, 'uri:s6', 's6', 'C', now);
  sub.run(r2, ids.D, 'uri:s7', 's7', 'D', now);
  // Round 2 votes → s4=1, s5=4, s6=2, s7=5
  vote.run(r2, ids.B, 'uri:s4', 1, now);
  vote.run(r2, ids.A, 'uri:s5', 4, now);
  vote.run(r2, ids.A, 'uri:s6', 2, now);
  vote.run(r2, ids.B, 'uri:s7', 5, now);

  return { seasonId, r1, r2, ids };
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('computes round-1 standings with null prevRank (no prior round)', () => {
  const { r1 } = seed(db);
  const s = computeStandings(db, r1);
  expect(s.map((r) => [r.name, r.rank, r.priorTotal, r.roundPoints, r.currentTotal, r.prevRank])).toEqual([
    ['A', 1, 0, 5, 5, null],
    ['B', 2, 0, 3, 3, null],
    ['C', 3, 0, 1, 1, null],
  ]);
});

it('computes round-2 standings with prior totals, round impact, and prev ranks', () => {
  const { r2 } = seed(db);
  const s = computeStandings(db, r2);
  // standing order by current total: B7, A6, D5, C3
  expect(s.map((r) => [r.name, r.rank, r.priorTotal, r.roundPoints, r.currentTotal, r.prevRank])).toEqual([
    ['B', 1, 3, 4, 7, 2],
    ['A', 2, 5, 1, 6, 1],
    ['D', 3, 0, 5, 5, null], // new competitor → no prior rank
    ['C', 4, 1, 2, 3, 3],
  ]);
});

it('getStandings lazily persists the table on first access and reconciles match', () => {
  const { r2 } = seed(db);
  expect(readStoredStandings(db, r2)).toHaveLength(0);
  const res = getStandings(db, r2);
  expect(res.reconcile.status).toBe('match');
  expect(readStoredStandings(db, r2)).toHaveLength(4);
});

it('flags a mismatch when a stored row is tampered, and adopt-computed fixes it', () => {
  const { r2, ids } = seed(db);
  getStandings(db, r2); // populate
  // Tamper: bump B's current_total in the stored gospel.
  db.prepare('UPDATE season_standings SET current_total = 999 WHERE round_id = ? AND competitor_id = ?').run(r2, ids.B);

  const after = getStandings(db, r2);
  expect(after.reconcile.status).toBe('mismatch');
  const bDiff = after.reconcile.diffs.find((d) => d.competitorId === ids.B);
  expect(bDiff?.fields.some((f) => f.field === 'currentTotal' && f.stored === 999 && f.computed === 7)).toBe(true);

  const adopted = adoptComputed(db, r2);
  expect(adopted.reconcile.status).toBe('match');
  expect(getStandings(db, r2).reconcile.status).toBe('match');
});

it('applyEdits writes corrected values as gospel and re-ranks', () => {
  const { r2, ids } = seed(db);
  getStandings(db, r2);
  // Human says A actually has 100 total → A should jump to rank 1.
  const res = applyEdits(db, r2, [{ competitorId: ids.A, currentTotal: 100 }]);
  expect(res.standings[0].name).toBe('A');
  expect(res.standings[0].rank).toBe(1);
  expect(res.standings[0].currentTotal).toBe(100);
  // Persisted
  const stored = readStoredStandings(db, r2);
  expect(stored[0].name).toBe('A');
});

it('reconcile reports presence diffs when competitor sets differ', () => {
  const computed = [
    { competitorId: 1, name: 'A', rank: 1, prevRank: null, priorTotal: 0, roundPoints: 5, currentTotal: 5 },
  ];
  const stored: typeof computed = [];
  const r = reconcile(computed, stored);
  expect(r.status).toBe('mismatch');
  expect(r.diffs[0].presence).toBe('computed-only');
});

it('backfillSeasonStandings populates every round', () => {
  const { seasonId, r1, r2 } = seed(db);
  const n = backfillSeasonStandings(db, seasonId);
  expect(n).toBe(2);
  expect(readStoredStandings(db, r1)).toHaveLength(3);
  expect(readStoredStandings(db, r2)).toHaveLength(4);
});
