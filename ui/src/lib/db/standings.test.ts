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
  // C and D filed ballots but spent nothing here. Zero-point rows are what the
  // export writes for a voter who gave a given song nothing, and they are what
  // keeps this fixture clear of the no-vote penalty — without them C and D would
  // be non-voters and their upvotes would be voided.
  vote.run(r2, ids.C, 'uri:s4', 0, now);
  vote.run(r2, ids.D, 'uri:s4', 0, now);

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


// ── the no-vote penalty ───────────────────────────────────────────────────────

/**
 * One round, three submitters, where the raw sum and the scored sum differ for
 * every one of them in a DIFFERENT way — so a regression cannot pass by
 * accident:
 *   A votes,          6 up / −2 down  → raw 4, scored 4  (unchanged)
 *   B does NOT vote,  6 up / −2 down  → raw 4, scored −2 (upvotes voided)
 *   C does NOT vote,  5 up /  0 down  → raw 5, scored 0  (nothing left to keep)
 * Ranked raw:    C 5, A 4, B 4   →   ranked scored: A 4, C 0, B −2.
 */
function seedNonVoter(db: Database.Database) {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  const r1 = upsertRound(db, seasonId, { mlRoundId: 'nv1', name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  const ids: Record<string, number> = {};
  const cstmt = db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)');
  for (const n of ['A', 'B', 'C']) ids[n] = Number(cstmt.run(`nv-${n}`, n).lastInsertRowid);
  const sub = db.prepare('INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?,?,?,?,?,?)');
  const vote = db.prepare('INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?,?,?,?,?)');
  const now = '2026-01-01T00:00:00Z';
  sub.run(r1, ids.A, 'uri:a', 'a', 'A', now);
  sub.run(r1, ids.B, 'uri:b', 'b', 'B', now);
  sub.run(r1, ids.C, 'uri:c', 'c', 'C', now);
  // Only A files a ballot.
  vote.run(r1, ids.A, 'uri:b', 6, now);
  vote.run(r1, ids.A, 'uri:c', 5, now);
  // B's and C's own scores come from votes cast by someone who did vote (A) plus
  // two downvotes each from a non-submitting voter, so downvotes exist to survive.
  const dId = Number(cstmt.run('nv-D', 'D').lastInsertRowid);
  vote.run(r1, dId, 'uri:a', 6, now);
  vote.run(r1, dId, 'uri:b', -2, now);
  vote.run(r1, ids.A, 'uri:a', 0, now); // A's own zero row, keeps A a voter
  vote.run(r1, dId, 'uri:c', 0, now);
  return { r1, ids };
}

it('voids a non-voting submitter\'s upvotes but keeps their downvotes', () => {
  const { r1 } = seedNonVoter(db);
  const s = computeStandings(db, r1);
  const by = Object.fromEntries(s.map((r) => [r.name, r.currentTotal]));
  expect(by.A).toBe(6);   // voted → keeps everything
  expect(by.B).toBe(-2);  // 6 up voided, −2 down stands
  expect(by.C).toBe(0);   // 5 up voided, no downvotes to keep
  // And the penalty must change the ORDER, not just the numbers.
  expect(s.map((r) => r.name)).toEqual(['A', 'C', 'B']);
});

it('applies the penalty per round, not per competitor', () => {
  // A submitter who skips one round's ballot keeps the points from the round
  // they did vote in. Grouping straight to competitor would void both.
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  const rA = upsertRound(db, seasonId, { mlRoundId: 'pr1', name: 'A', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  const rB = upsertRound(db, seasonId, { mlRoundId: 'pr2', name: 'B', description: '', spotifyPlaylistUrl: '', createdAt: '2026-02-01T00:00:00Z' });
  const cstmt = db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)');
  const x = Number(cstmt.run('pr-X', 'X').lastInsertRowid);
  const y = Number(cstmt.run('pr-Y', 'Y').lastInsertRowid);
  const sub = db.prepare('INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?,?,?,?,?,?)');
  const vote = db.prepare('INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?,?,?,?,?)');
  const now = '2026-01-01T00:00:00Z';
  sub.run(rA, x, 'uri:x1', 'x1', 'X', now);
  sub.run(rB, x, 'uri:x2', 'x2', 'X', now);
  sub.run(rA, y, 'uri:y1', 'y1', 'Y', now);
  sub.run(rB, y, 'uri:y2', 'y2', 'Y', now);
  vote.run(rA, y, 'uri:x1', 4, now);
  vote.run(rA, x, 'uri:y1', 1, now);  // X voted in round A
  vote.run(rB, y, 'uri:x2', 3, now);  // X did NOT vote in round B
  const s = computeStandings(db, rB);
  const by = Object.fromEntries(s.map((r) => [r.name, r.currentTotal]));
  expect(by.X).toBe(4); // round A's 4 kept, round B's 3 voided — not 7, and not 0
});

// ── chronological round order ─────────────────────────────────────────────────

it('sequences rounds by when they were played, not by row id', () => {
  // Mirrors Boarz season 10: the round with the HIGHER id was played EARLIER.
  // Ordering by id drops it from "as of" totals entirely.
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  const early = upsertRound(db, seasonId, { mlRoundId: 'e', name: 'Early', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  const late = upsertRound(db, seasonId, { mlRoundId: 'l', name: 'Late', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  // `late` has the SMALLER id but the LATER deadline; `early` the larger id and
  // the earlier deadline — the exact inversion R153 creates.
  db.prepare('UPDATE rounds SET voting_deadline = ? WHERE id = ?').run('2026-03-01T00:00:00Z', early);
  db.prepare('UPDATE rounds SET voting_deadline = ? WHERE id = ?').run('2026-02-01T00:00:00Z', late);
  const cstmt = db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)');
  const p = Number(cstmt.run('co-P', 'P').lastInsertRowid);
  const q = Number(cstmt.run('co-Q', 'Q').lastInsertRowid);
  const sub = db.prepare('INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?,?,?,?,?,?)');
  const vote = db.prepare('INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?,?,?,?,?)');
  const now = '2026-01-01T00:00:00Z';
  for (const [r, uri] of [[late, 'uri:l'], [early, 'uri:e']] as const) {
    sub.run(r, p, uri, 'song', 'P', now);
    vote.run(r, q, uri, 5, now);
    vote.run(r, p, uri + ':own', 0, now); // P files a ballot in both
  }
  // `early` is the season's LAST round chronologically, so standings as of it
  // must include `late`'s 5 as prior. Ordering by id would report prior 0.
  const s = computeStandings(db, early);
  const row = s.find((r) => r.name === 'P')!;
  expect(row.priorTotal).toBe(5);
  expect(row.roundPoints).toBe(5);
  expect(row.currentTotal).toBe(10);
});
