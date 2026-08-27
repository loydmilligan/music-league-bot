import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { createRun, loadRun, saveRun } from './store.js';
import { parkAtHold, liftHold } from './holds.js';
import type { Rollout } from './types.js';

const T0 = '2026-08-26T00:00:00Z';
const rollout: Rollout = {
  order: ['a', 'hold'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'] },
    hold: { kind: 'human', label: 'Rate ledes', reviewPath: '/digest/{roundId}/hil', alertType: 'digest_ready' },
  },
  skipAfter: { a: true },
  covers: [],
};

let db: Database.Database;
let deps: { notify: ReturnType<typeof vi.fn>; now: () => string; appBase: string };

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
     VALUES (9, 1, 'r9', 'More Cowbell!', ?)`,
  ).run(T0);
  deps = { notify: vi.fn().mockResolvedValue([]), now: () => T0, appBase: 'https://mlb37.example' };
});

function parked() {
  const id = createRun(db, 1, 9, rollout, T0);
  const run = loadRun(db, id)!;
  const cuts = run.cuts.map((c) => (c.cutId === 'a' ? { ...c, state: 'done' as const } : c));
  saveRun(db, { ...run, cuts, currentEp: 1, state: 'parked' }, T0);
  return loadRun(db, id)!;
}

describe('parkAtHold', () => {
  it('mints a resume token and stores the review url', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    const row = db.prepare('SELECT resume_token, review_url FROM rollout_runs WHERE id=?')
      .get(run.runId) as { resume_token: string; review_url: string };
    expect(row.resume_token).toMatch(/^[\w-]{20,}$/);
    expect(row.review_url).toBe('https://mlb37.example/digest/9/hil');
  });

  it('substitutes {roundId} in the review path', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    expect(loadRun(db, run.runId)!.state).toBe('parked');
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      link: 'https://mlb37.example/digest/9/hil',
    }));
  });

  it('names the league and round in the notification', async () => {
    await parkAtHold(db, parked(), rollout, deps);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      alertType: 'digest_ready',
      title: 'Second Best — More Cowbell!',
      message: expect.stringContaining('Rate ledes'),
    }));
  });

  it('carries unresolved failures into the message on a forced hold', async () => {
    const run = { ...parked(), error: 'cut "verify" check failed and could not be repaired' };
    await parkAtHold(db, run, rollout, deps);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('verify'),
    }));
  });

  it('does not notify twice for the same hold', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    await parkAtHold(db, loadRun(db, run.runId)!, rollout, deps);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });
});

describe('liftHold', () => {
  it('marks the human cut done and resumes the run', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    const token = (db.prepare('SELECT resume_token FROM rollout_runs WHERE id=?')
      .get(run.runId) as { resume_token: string }).resume_token;

    const res = liftHold(db, token, T0);
    expect(res).toEqual({ ok: true, runId: run.runId });

    const after = loadRun(db, run.runId)!;
    expect(after.cuts.find((c) => c.cutId === 'hold')!.state).toBe('done');
    expect(after.state).toBe('running');
  });

  it('clears the token so it cannot be replayed', async () => {
    const run = await parkAtHold(db, parked(), rollout, deps);
    const token = (db.prepare('SELECT resume_token FROM rollout_runs WHERE id=?')
      .get(run.runId) as { resume_token: string }).resume_token;
    liftHold(db, token, T0);
    expect(liftHold(db, token, T0)).toEqual({ ok: false, reason: 'unknown or spent token' });
  });

  it('rejects an empty token', () => {
    expect(liftHold(db, '', T0)).toEqual({ ok: false, reason: 'unknown or spent token' });
  });
});
