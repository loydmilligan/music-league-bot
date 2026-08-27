import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import {
  getRolloutConfig, putRolloutConfig, createRun, loadRun, loadRunByRound,
  saveRun, claimCut, heartbeat, reapStaleCuts, hasActiveRun,
} from './store.js';
import { DEFAULT_ROLLOUT } from './defaults.js';
import type { Rollout } from './types.js';

const T0 = '2026-08-26T00:00:00Z';
const tiny: Rollout = {
  order: ['a', 'b'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'] },
    b: { kind: 'script', runtime: 'app', label: 'B', command: ['b'] },
  },
  skipAfter: { a: true },
  covers: [],
};

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
     VALUES (9, 1, 'r9', 'R9', ?)`,
  ).run(T0);
});

describe('config', () => {
  it('falls back to the default rollout, disabled, when unset', () => {
    const cfg = getRolloutConfig(db, 1);
    expect(cfg.enabled).toBe(false);
    expect(cfg.rollout.order).toEqual(DEFAULT_ROLLOUT.order);
  });

  it('round-trips a stored config', () => {
    putRolloutConfig(db, 1, tiny, true, T0);
    const cfg = getRolloutConfig(db, 1);
    expect(cfg.enabled).toBe(true);
    expect(cfg.rollout.order).toEqual(['a', 'b']);
  });

  it('falls back to the default when the stored JSON is malformed', () => {
    db.prepare('INSERT INTO rollout_configs (league_id, definition_json, enabled, updated_at) VALUES (1, ?, 1, ?)')
      .run('{ not json', T0);
    expect(getRolloutConfig(db, 1).rollout.order).toEqual(DEFAULT_ROLLOUT.order);
  });

  it('falls back to the default when the stored config is structurally invalid', () => {
    db.prepare('INSERT INTO rollout_configs (league_id, definition_json, enabled, updated_at) VALUES (1, ?, 1, ?)')
      .run(JSON.stringify({ order: [], cuts: {}, skipAfter: {}, covers: [] }), T0);
    expect(getRolloutConfig(db, 1).rollout.order).toEqual(DEFAULT_ROLLOUT.order);
  });
});

describe('runs', () => {
  it('creates a run with one pending cut row per active cut', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    const run = loadRun(db, id)!;
    expect(run.state).toBe('running');
    expect(run.currentEp).toBe(0);
    expect(run.cuts.map((c) => [c.cutId, c.ep, c.state]))
      .toEqual([['a', 0, 'pending'], ['b', 1, 'pending']]);
  });

  it('snapshots the definition so later config edits do not mutate the run', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    putRolloutConfig(db, 1, { ...tiny, order: ['a'] }, true, T0);
    const snap = db.prepare('SELECT definition_json FROM rollout_runs WHERE id=?').get(id) as { definition_json: string };
    expect((JSON.parse(snap.definition_json) as Rollout).order).toEqual(['a', 'b']);
  });

  it('finds a run by round', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    expect(loadRunByRound(db, 9)!.runId).toBe(id);
  });

  it('persists a modified RunState', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    const run = loadRun(db, id)!;
    saveRun(db, { ...run, currentEp: 1, state: 'parked', error: 'boom' }, T0);
    const back = loadRun(db, id)!;
    expect([back.currentEp, back.state, back.error]).toEqual([1, 'parked', 'boom']);
  });

  it('persists cut state and output', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    const run = loadRun(db, id)!;
    const cuts = run.cuts.map((c) => (c.cutId === 'a' ? { ...c, state: 'done' as const, outputJson: '{"x":1}', attempts: 2 } : c));
    saveRun(db, { ...run, cuts }, T0);
    const a = loadRun(db, id)!.cuts.find((c) => c.cutId === 'a')!;
    expect([a.state, a.outputJson, a.attempts]).toEqual(['done', '{"x":1}', 2]);
  });
});

describe('claiming', () => {
  it('claims a pending cut exactly once', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    expect(claimCut(db, id, 'a', T0)).toBe(true);
    expect(claimCut(db, id, 'a', T0)).toBe(false); // already running
  });

  it('records the claim time and heartbeat', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    claimCut(db, id, 'a', T0);
    const row = db.prepare('SELECT state, claimed_at, heartbeat_at FROM rollout_cut_runs WHERE run_id=? AND cut_id=?')
      .get(id, 'a') as { state: string; claimed_at: string; heartbeat_at: string };
    expect(row.state).toBe('running');
    expect(row.claimed_at).toBe(T0);
    expect(row.heartbeat_at).toBe(T0);
  });

  it('heartbeat refreshes the lease', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    claimCut(db, id, 'a', T0);
    heartbeat(db, id, 'a', '2026-08-26T00:05:00Z');
    const row = db.prepare('SELECT heartbeat_at FROM rollout_cut_runs WHERE run_id=? AND cut_id=?')
      .get(id, 'a') as { heartbeat_at: string };
    expect(row.heartbeat_at).toBe('2026-08-26T00:05:00Z');
  });
});

describe('reapStaleCuts', () => {
  it('returns an abandoned cut to pending and spends an attempt', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    claimCut(db, id, 'a', T0);
    const n = reapStaleCuts(db, '2026-08-26T01:00:00Z', 600);
    expect(n).toBe(1);
    const a = loadRun(db, id)!.cuts.find((c) => c.cutId === 'a')!;
    expect([a.state, a.attempts]).toEqual(['pending', 1]);
  });

  it('leaves a cut whose lease is still fresh', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    claimCut(db, id, 'a', T0);
    expect(reapStaleCuts(db, '2026-08-26T00:01:00Z', 600)).toBe(0);
  });
});

describe('hasActiveRun', () => {
  it('is true for a running run and false once done', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    expect(hasActiveRun(db, 1)).toBe(true);
    saveRun(db, { ...loadRun(db, id)!, state: 'done' }, T0);
    expect(hasActiveRun(db, 1)).toBe(false);
  });

  it('counts a PARKED run as active — a parked run still owns its league', () => {
    const id = createRun(db, 1, 9, tiny, T0);
    saveRun(db, { ...loadRun(db, id)!, state: 'parked' }, T0);
    expect(hasActiveRun(db, 1)).toBe(true);
  });

  it('does not let one league block another', () => {
    db.prepare('INSERT INTO leagues (id, slug, name) VALUES (2, ?, ?)').run('bz', 'Boarz');
    createRun(db, 1, 9, tiny, T0);
    expect(hasActiveRun(db, 2)).toBe(false);
  });
});
