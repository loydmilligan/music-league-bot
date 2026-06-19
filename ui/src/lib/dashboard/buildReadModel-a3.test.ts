/**
 * sprint-46 a3 — SACRED REGRESSION GUARD (Contract #5):
 *
 *   An archive pipeline with no skips, no covers, models {} MUST reproduce
 *   today's buildReadModel behavior — same set of runPrediction calls, same
 *   parallelism (all tasks in one EP, each in its own group of 1).
 *
 * Tests:
 *   1. Structural: ARCHIVE_DEFAULT_PIPELINE resolves to 1 EP, 7 singleton groups
 *      (no merge, no skip) — guarantees flat-parallel execution matching the
 *      original hand-coded parallel block.
 *   2. Integration: buildReadModel calls all 7 task types for data that triggers
 *      them, using mocked runPrediction (no real LLM spend). Verifies dispatch
 *      table covers every ARCHIVE_TASK_KIND.
 *
 * If either test fails = BLOCKER — do not ship.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import {
  ARCHIVE_DEFAULT_PIPELINE,
  ARCHIVE_TASK_KINDS,
  resolvePipeline,
} from '$lib/digest/pipeline.js';

// ── 1. Structural regression guard ───────────────────────────────────────────

describe('REGRESSION GUARD — pipeline structure (contract #5, structural)', () => {
  it('ARCHIVE_DEFAULT_PIPELINE resolves to 1 EP with 7 singleton groups in ARCHIVE_TASK_KINDS order', () => {
    const db = openLeagueDb(':memory:');
    const eps = resolvePipeline(ARCHIVE_DEFAULT_PIPELINE, [...ARCHIVE_TASK_KINDS], db);

    // One EP — no skips in the default pipeline
    expect(eps).toHaveLength(1);

    // Exactly 7 groups — one per task (no merge: archive mode forces singleton groups)
    expect(eps[0].groups).toHaveLength(7);
    expect(eps[0].covers).toHaveLength(0);

    // Each group is a singleton (no-merge rule)
    for (const g of eps[0].groups) {
      expect(g.sections).toHaveLength(1);
    }

    // Task IDs match ARCHIVE_TASK_KINDS in order
    const taskIds = eps[0].groups.map(g => g.sections[0]);
    expect(taskIds).toEqual([...ARCHIVE_TASK_KINDS]);
  });

  it('archive pipeline with a skip creates 2 EPs, still no merge within each EP', () => {
    const db = openLeagueDb(':memory:');
    const pipeline = {
      ...ARCHIVE_DEFAULT_PIPELINE,
      skipAfter: { 'narrative-moment-lines': true as const },
    };
    const eps = resolvePipeline(pipeline, [...ARCHIVE_TASK_KINDS], db);

    expect(eps).toHaveLength(2);
    // All groups still singletons (no merge across either EP)
    for (const ep of eps) {
      for (const g of ep.groups) {
        expect(g.sections).toHaveLength(1);
      }
    }
  });

  it('inactive tasks are excluded from EP but active tasks remain singletons', () => {
    const db = openLeagueDb(':memory:');
    const active = ['narrative-player-superlatives', 'narrative-league-reel', 'season-update'];
    const eps = resolvePipeline(ARCHIVE_DEFAULT_PIPELINE, active, db);

    expect(eps).toHaveLength(1);
    expect(eps[0].groups).toHaveLength(3);
    const taskIds = eps[0].groups.map(g => g.sections[0]);
    expect(taskIds).toEqual(active);
  });
});

// ── 2. Integration regression guard ───────────────────────────────────────────
// Verifies buildReadModel dispatches runPrediction for all 7 archive task types
// when the DB contains data that triggers them.

vi.mock('$lib/predict/predict.js', async (orig) => {
  const actual = await orig<typeof import('$lib/predict/predict.js')>();

  const mockRunPrediction = vi.fn(
    async <TIn, TOut>(
      _db: Database.Database,
      task: { id: string; outputSchema: { parse: (v: unknown) => TOut } },
      _input: TIn,
    ): Promise<{ output: TOut; meta: { model: string; costUsd: number; latencyMs: number; rowId: string } }> => {
      let output: unknown;
      switch (task.id) {
        case 'narrative-player-superlatives':
          output = {
            signatureSuperlative: { award: 'Test Award', blurb: 'Test blurb.' },
            superlatives: [{ award: 'Top Submitter', accent: 'pulp', blurb: 'Great picks.' }],
          };
          break;
        case 'narrative-fan-hater-blurbs':
          output = { fanLine: 'Always there for you.', haterLine: 'Lovingly withholds points.' };
          break;
        case 'narrative-league-reel':
          output = {
            reel: [
              { accent: 'sky', award: 'MVP', blurb: 'The best.', winner: 'Alice' },
              { accent: 'pulp', award: 'Top Voter', blurb: 'Always engaged.', winner: 'Bob' },
              { accent: 'amber', award: 'Wildcard', blurb: 'Surprises everyone.', winner: 'Carol' },
            ],
          };
          break;
        case 'narrative-moment-lines':
          output = {
            mostLovedLine: 'Pure magic.',
            mostDivisiveLine: 'Bold choice.',
            biggestUpsetLine: 'Nobody saw it coming.',
          };
          break;
        case 'profile-spectrum':
          output = { polished_vs_raw: 40, sunny_vs_melancholy: 60, familiar_vs_obscure: 50 };
          break;
        case 'profile-playlist':
          output = {
            name: 'Test Playlist',
            nudge: 'Give it a spin.',
            tracks: [{ title: 'Song A', artist: 'Artist X', why: 'Great vibe.' }],
          };
          break;
        case 'season-update':
          output = { title: 'Season Update', body: 'Things are heating up.' };
          break;
        case 'taste-fingerprint':
          output = {
            signature_artists: ['The Cure'],
            genres: ['post-punk'],
            eras: ['80s'],
            rewards: ['atmosphere'],
            punishes: ['mainstream'],
            summary: 'Dark and atmospheric.',
            confidence: 'medium',
          };
          break;
        default:
          output = {};
      }
      return {
        output: task.outputSchema.parse(output) as TOut,
        meta: { model: 'test-model', costUsd: 0.001, latencyMs: 100, rowId: 'test-row-id' },
      };
    },
  );

  return { ...actual, runPrediction: mockRunPrediction };
});

import { runPrediction } from '$lib/predict/predict.js';
const mockRunPrediction = vi.mocked(runPrediction);

// Seed helpers
function seedMinimalData(db: Database.Database): { leagueId: number } {
  db.prepare("INSERT INTO leagues (slug, name, is_active) VALUES ('test', 'Test League', 1)").run();
  const leagueId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;

  db.prepare(
    "INSERT INTO seasons (league_id, season_number, status) VALUES (?, 1, 'active')",
  ).run(leagueId);
  const seasonId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;

  // 3 complete rounds — triggers moments computation
  const addRound = (n: number) => {
    db.prepare(
      `INSERT INTO rounds (season_id, ml_round_id, name, phase, voting_deadline, created_at)
       VALUES (?, ?, ?, 'complete', '2026-0${n}-01T00:00:00Z', '2026-0${n}-01T00:00:00Z')`,
    ).run(seasonId, `ml-round-${n}`, `Round ${n}`);
    return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
  };
  const r1 = addRound(1);
  const r2 = addRound(2);
  const r3 = addRound(3);

  // 3 players — ensures reel fires (≥2 full members) and fan/hater fires
  const addPlayer = (name: string) => {
    db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
    const pid = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    db.prepare("INSERT INTO competitors (ml_competitor_id, name, player_id) VALUES (?, ?, ?)").run(
      `ml-${name}`, name, pid,
    );
    const cid = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
    // Seed taste_fingerprint so loadOrGenerateFingerprints skips LLM generation
    db.prepare(
      'INSERT INTO player_profiles (player_id, taste_fingerprint) VALUES (?, ?)',
    ).run(pid, JSON.stringify({
      signature_artists: ['Test Artist'],
      genres: ['test-genre'],
      eras: ['2020s'],
      rewards: ['good vibes'],
      punishes: ['bad vibes'],
      summary: 'A test player.',
      confidence: 'medium',
    }));
    return { pid, cid };
  };

  const a = addPlayer('Alice');
  const b = addPlayer('Bob');
  const c = addPlayer('Carol');

  // Submit + vote across rounds to create fan/hater relationships and full-tier members
  const addSub = (rid: number, cid: number, pid: number, uri: string, title: string) => {
    db.prepare(
      `INSERT INTO ml_submissions (round_id, competitor_id, player_id, spotify_uri, title, artists, created_at)
       VALUES (?, ?, ?, ?, ?, 'Test Artist', '2026-01-01T00:00:00Z')`,
    ).run(rid, cid, pid, uri, title);
  };
  addSub(r1, a.cid, a.pid, 'spotify:a1', 'A Song 1');
  addSub(r2, a.cid, a.pid, 'spotify:a2', 'A Song 2');
  addSub(r3, a.cid, a.pid, 'spotify:a3', 'A Song 3');
  addSub(r1, b.cid, b.pid, 'spotify:b1', 'B Song 1');
  addSub(r2, b.cid, b.pid, 'spotify:b2', 'B Song 2');
  addSub(r3, b.cid, b.pid, 'spotify:b3', 'B Song 3');
  addSub(r1, c.cid, c.pid, 'spotify:c1', 'C Song 1');
  addSub(r2, c.cid, c.pid, 'spotify:c2', 'C Song 2');
  addSub(r3, c.cid, c.pid, 'spotify:c3', 'C Song 3');

  // Votes to create fan/hater data and trigger moments.
  // Must include player_id (the voteMatrix query filters v.player_id IS NOT NULL).
  const addVote = (rid: number, vid: number, vpid: number, uri: string, pts: number) => {
    db.prepare(
      `INSERT INTO votes (round_id, voter_id, player_id, spotify_uri, points, created_at)
       VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00Z')`,
    ).run(rid, vid, vpid, uri, pts);
  };
  // Bob votes heavily for Alice (Bob = Alice's biggestFan; with 3 shared rounds, also hater candidate)
  addVote(r1, b.cid, b.pid, 'spotify:a1', 5);
  addVote(r2, b.cid, b.pid, 'spotify:a2', 5);
  addVote(r3, b.cid, b.pid, 'spotify:a3', 5);
  // Carol votes little for Alice (only 1 shared round — doesn't qualify for hater)
  addVote(r1, c.cid, c.pid, 'spotify:a1', 1);
  // Alice votes for Bob across 2 rounds (qualifies as Bob's fan/hater)
  addVote(r1, a.cid, a.pid, 'spotify:b1', 4);
  addVote(r2, a.cid, a.pid, 'spotify:b2', 4);
  // Carol votes for Bob across 2 rounds (creates hater contrast for Bob)
  addVote(r2, c.cid, c.pid, 'spotify:b2', 2);
  addVote(r3, c.cid, c.pid, 'spotify:b3', 2);
  // Alice votes for Carol across 2 rounds (qualifies for Carol's fan/hater)
  addVote(r2, a.cid, a.pid, 'spotify:c2', 3);
  addVote(r3, a.cid, a.pid, 'spotify:c3', 3);
  // Bob gives Carol a big push in R3 — Carol's cumulative jumps from 3 to 13, overtaking Bob (12).
  // This produces a rank swap (Carol 3rd→2nd, Bob 2nd→3rd) so computeMovers emits bigMover+faller
  // and the season-update guard (requires asOfRound + at least one signal) allows runPrediction.
  addVote(r3, b.cid, b.pid, 'spotify:c3', 7);

  return { leagueId };
}

describe('REGRESSION GUARD — buildReadModel dispatch (contract #5, integration)', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    db = openLeagueDb(':memory:');
  });

  it('REGRESSION GUARD: default archive pipeline dispatches all active task types via runPrediction', async () => {
    const { leagueId } = seedMinimalData(db);

    const { buildReadModel } = await import('./buildReadModel.js');
    await buildReadModel(db, leagueId);

    // Collect all task.id values passed to runPrediction
    const calledTaskIds = mockRunPrediction.mock.calls.map(
      ([, task]) => (task as { id: string }).id,
    );

    // All 7 archive task types must be dispatched (contract #5)
    for (const taskKind of ARCHIVE_TASK_KINDS) {
      expect(calledTaskIds, `expected ${taskKind} to be dispatched`).toContain(taskKind);
    }

    // taste-fingerprint should NOT appear (it's an input task, not a published b-side track)
    expect(calledTaskIds).not.toContain('taste-fingerprint');
  });

  it('degenerate pipeline (no skips, no covers, models {}) fires same task set as ARCHIVE_DEFAULT_PIPELINE', async () => {
    const db2 = openLeagueDb(':memory:');
    const { leagueId } = seedMinimalData(db2);

    // Seed the archive pipeline config as ARCHIVE_DEFAULT_PIPELINE (already seeded by openLeagueDb)
    // explicitly verify the pipeline is treated as degenerate
    expect(ARCHIVE_DEFAULT_PIPELINE.skipAfter).toEqual({});
    expect(ARCHIVE_DEFAULT_PIPELINE.covers).toHaveLength(0);
    expect(ARCHIVE_DEFAULT_PIPELINE.models).toEqual({});

    vi.clearAllMocks();
    const { buildReadModel } = await import('./buildReadModel.js');
    await buildReadModel(db2, leagueId);

    const calledTaskIds = new Set(
      mockRunPrediction.mock.calls.map(([, task]) => (task as { id: string }).id),
    );

    // Must cover all 7 archive task kinds
    for (const kind of ARCHIVE_TASK_KINDS) {
      expect(calledTaskIds.has(kind), `${kind} must be called`).toBe(true);
    }
  });
});
