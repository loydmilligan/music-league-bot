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

  it('does not throw or create a second run when a completed round is re-queued (I6)', async () => {
    // requeueJob (ui/src/lib/digest/jobs.ts, reachable from the live
    // POST /api/digest/[roundId]/requeue button) sets digest_jobs.status
    // back to 'pending' unconditionally — it has no idea a rollout run for
    // this round already exists. rollout_runs_round is UNIQUE, so without a
    // guard in promotePendingJobs, tickApp's own createRun throws on every
    // future tick once the round is re-queued after its run completed.
    putRolloutConfig(db, 1, rollout, true, T0);
    promotePendingJobs(db, T0);
    const runId = loadRunByRound(db, 9)!.runId;
    db.prepare(`UPDATE rollout_runs SET state='done' WHERE id=?`).run(runId);

    // Exactly requeueJob's UPDATE.
    db.prepare(`UPDATE digest_jobs SET status='pending', attempts=0, error=NULL, updated_at=? WHERE round_id=?`)
      .run(T0, 9);

    const d = deps();
    await expect(tickApp(d)).resolves.not.toThrow();
    const runCount = db.prepare('SELECT COUNT(*) AS n FROM rollout_runs WHERE round_id=9').get() as { n: number };
    expect(runCount.n).toBe(1);
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

describe('app cut heartbeats (I5)', () => {
  it('refreshes heartbeat_at while an app cut is still running', async () => {
    vi.useFakeTimers();
    try {
      putRolloutConfig(db, 1, rollout, true, T0);
      promotePendingJobs(db, T0);
      const runId = loadRunByRound(db, 9)!.runId;

      let finish!: () => void;
      const gate = new Promise<void>((r) => { finish = r; });
      const later = '2026-08-26T00:20:00Z'; // beyond the 600s lease
      let clock = T0;                        // claim happens at T0…
      const d = deps({
        capture: vi.fn().mockImplementation(() => gate),
        now: () => clock,
      });

      const tick = tickApp(d);
      clock = later;                         // …the wall clock moves on while the cut runs
      await vi.advanceTimersByTimeAsync(11 * 60_000); // 11 minutes of "still running"
      const row = db.prepare(
        `SELECT heartbeat_at FROM rollout_cut_runs WHERE run_id=? AND cut_id='capture'`,
      ).get(runId) as { heartbeat_at: string };
      expect(row.heartbeat_at).toBe(later);   // refreshed past claim time — reap can't take it

      finish();
      await tick;
    } finally {
      vi.useRealTimers();
    }
  });

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
});
