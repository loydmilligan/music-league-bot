import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { promotePendingJobs, tickApp } from './appExecutor.js';
import { putRolloutConfig, loadRunByRound } from './store.js';
import type { Rollout } from './types.js';

const T0 = '2026-08-26T00:00:00Z';
const rollout: Rollout = {
  order: ['capture', 'hold-approve', 'send'],
  cuts: {
    capture: { kind: 'script', runtime: 'app', label: 'Capture', command: ['capture'] },
    'hold-approve': { kind: 'human', label: 'Approve', reviewPath: '/digest/{roundId}', alertType: 'digest_ready' },
    send: { kind: 'script', runtime: 'app', label: 'Send', command: ['send'] },
  },
  skipAfter: { capture: true, 'hold-approve': true },
  covers: [],
};

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (2, ?, ?)').run('bz', 'Boarz');
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (2, 2, 1, 'active')").run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (9, 1, 'r9', 'R9', ?)`,
  ).run(T0);
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (10, 2, 'r10', 'R10', ?)`,
  ).run(T0);
  const job = db.prepare(
    `INSERT INTO digest_jobs (round_id, league_id, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`);
  job.run(9, 1, T0, T0);
  job.run(10, 2, T0, T0);
});

describe('promotePendingJobs — degenerate safety', () => {
  it('promotes nothing when no league has a rollout enabled', () => {
    expect(promotePendingJobs(db, T0)).toBe(0);
    expect(loadRunByRound(db, 9)).toBeNull();
    const job = db.prepare('SELECT status FROM digest_jobs WHERE round_id=9').get() as { status: string };
    expect(job.status).toBe('pending'); // untouched, still runOneJob's
  });

  it('promotes only the rollout-enabled league', () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    expect(promotePendingJobs(db, T0)).toBe(1);
    expect(loadRunByRound(db, 9)).not.toBeNull();
    expect(loadRunByRound(db, 10)).toBeNull();
  });

  it('leaves a config that exists but is disabled alone', () => {
    putRolloutConfig(db, 1, rollout, false, T0);
    expect(promotePendingJobs(db, T0)).toBe(0);
  });

  it('takes the promoted job out of runOneJob reach', () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const job = db.prepare('SELECT status FROM digest_jobs WHERE round_id=9').get() as { status: string };
    expect(job.status).toBe('rollout');
  });

  it('is idempotent — a second pass promotes nothing new', () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    expect(promotePendingJobs(db, T0)).toBe(0);
  });
});

describe('tickApp', () => {
  function deps(over = {}) {
    return {
      db,
      capture: vi.fn().mockResolvedValue(undefined),
      generate: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue(undefined),
      hold: { notify: vi.fn().mockResolvedValue([]), now: () => T0, appBase: 'https://x' },
      now: () => T0,
      ...over,
    };
  }

  it('is idle when there is nothing to do', async () => {
    expect(await tickApp(deps())).toBe('idle');
  });

  it('runs an app cut and advances', async () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const d = deps();
    expect(await tickApp(d)).toBe('worked');
    expect(d.capture).toHaveBeenCalledWith(9);
    const run = loadRunByRound(db, 9)!;
    expect(run.cuts.find((c) => c.cutId === 'capture')!.state).toBe('done');
  });

  it('parks and notifies when it reaches a hold', async () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const d = deps();
    await tickApp(d);           // capture
    await tickApp(d);           // advance into the hold
    expect(loadRunByRound(db, 9)!.state).toBe('parked');
    expect(d.hold.notify).toHaveBeenCalled();
  });

  it('does not run cuts while parked', async () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const d = deps();
    await tickApp(d); await tickApp(d);
    await tickApp(d);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('retries a throwing cut rather than failing the run', async () => {
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const d = deps({ capture: vi.fn().mockRejectedValue(new Error('boom')) });
    await tickApp(d);
    const cut = loadRunByRound(db, 9)!.cuts.find((c) => c.cutId === 'capture')!;
    expect(cut.state).toBe('pending');
    expect(cut.attempts).toBe(1);
  });
});

describe('host cut reclassification (C2)', () => {
  const hostRollout: Rollout = {
    order: ['verify'],
    cuts: {
      verify: { kind: 'script', runtime: 'host', label: 'Verify', command: ['v'], check: { rule: 'no-fail-checks' } },
    },
    skipAfter: {},
    covers: [{ of: 'verify', remaster: true, budget: 1 }],
  };

  function deps(over = {}) {
    return {
      db,
      capture: vi.fn().mockResolvedValue(undefined),
      generate: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      archive: vi.fn().mockResolvedValue(undefined),
      hold: { notify: vi.fn().mockResolvedValue([]), now: () => T0, appBase: 'https://x' },
      now: () => T0,
      ...over,
    };
  }

  /** Mimic host_executor.py's _finish: a raw result, unclassified by the engine. */
  function hostWritesRaw(runId: string, cutId: string, state: 'done' | 'failed', outputJson: string | null) {
    db.prepare(
      `UPDATE rollout_cut_runs SET state=?, output_json=?, error=NULL, finished_at=?, awaiting_classification=1
        WHERE run_id=? AND cut_id=?`,
    ).run(state, outputJson, T0, runId, cutId);
  }

  it('folds a host-raw failure through the engine: remaster once, then parks and notifies on exhaustion', async () => {
    putRolloutConfig(db, 1, hostRollout, true, T0);
    promotePendingJobs(db, T0);
    const runId = loadRunByRound(db, 9)!.runId;
    const bad = JSON.stringify({ checks: [{ severity: 'fail', id: 'quote fabricated?' }] });

    // First failure: host writes raw; the app tick reclassifies via applyCutResult
    // and fires the remaster (budget 1) — the cut goes back to pending.
    hostWritesRaw(runId, 'verify', 'failed', bad);
    const d1 = deps();
    expect(await tickApp(d1)).toBe('worked');
    let run = loadRunByRound(db, 9)!;
    const afterFirst = run.cuts.find((c) => c.cutId === 'verify')!;
    expect(afterFirst.state).toBe('pending');
    expect(afterFirst.remasters).toBe(1);
    expect(run.state).toBe('running');
    expect(d1.hold.notify).not.toHaveBeenCalled();

    // Second failure: host writes raw again; budget is exhausted — forced hold,
    // and the run parks AND notifies within the same tick.
    hostWritesRaw(runId, 'verify', 'failed', bad);
    const d2 = deps();
    await tickApp(d2);
    run = loadRunByRound(db, 9)!;
    expect(run.state).toBe('parked');
    expect(run.cuts.find((c) => c.cutId === 'verify')!.state).toBe('failed');
    expect(d2.hold.notify).toHaveBeenCalled();
  });

  it('clears awaiting_classification once reclassified', async () => {
    putRolloutConfig(db, 1, hostRollout, true, T0);
    promotePendingJobs(db, T0);
    const runId = loadRunByRound(db, 9)!.runId;
    hostWritesRaw(runId, 'verify', 'done', JSON.stringify({ checks: [] }));
    await tickApp(deps());
    const row = db.prepare('SELECT awaiting_classification FROM rollout_cut_runs WHERE run_id=? AND cut_id=?')
      .get(runId, 'verify') as { awaiting_classification: number };
    expect(row.awaiting_classification).toBe(0);
  });
});
