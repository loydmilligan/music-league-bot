import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { createRun, saveRun, loadRun } from '$lib/rollout/store.js';
import type { Rollout } from '$lib/rollout/types.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', () => ({ getDb: () => db }));

const { POST } = await import('./+server.js');
const req = (body: unknown) => ({ json: async () => body }) as Request;

const T0 = '2026-08-26T00:00:00Z';
const rollout: Rollout = {
  order: ['a', 'hold'],
  cuts: {
    a: { kind: 'script', runtime: 'host', label: 'A', command: ['a'] },
    hold: { kind: 'human', label: 'Rate', reviewPath: '/x/{roundId}', alertType: 'digest_ready' },
  },
  skipAfter: { a: true },
  covers: [],
};

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('sb', 'Second Best');
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
  db.prepare(`INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (9, 1, 'r9', 'R9', ?)`).run(T0);
});

function parkedRunWithToken(): { runId: string; token: string } {
  const id = createRun(db, 1, 9, rollout, T0);
  const run = loadRun(db, id)!;
  const cuts = run.cuts.map((c) => (c.cutId === 'a' ? { ...c, state: 'done' as const } : c));
  saveRun(db, { ...run, cuts, currentEp: 1, state: 'parked' }, T0);
  const token = 'test-resume-token-xyz';
  db.prepare('UPDATE rollout_runs SET resume_token=? WHERE id=?').run(token, id);
  return { runId: id, token };
}

describe('POST /api/rollout/resume', () => {
  it('resumes by token', async () => {
    const { runId, token } = parkedRunWithToken();
    const res = await POST({ request: req({ token }) } as never);
    expect(await res.json()).toEqual({ ok: true, runId });
  });

  it('resumes by runId — no token paste required (C3)', async () => {
    const { runId } = parkedRunWithToken();
    const res = await POST({ request: req({ runId }) } as never);
    expect(await res.json()).toEqual({ ok: true, runId });
    expect(loadRun(db, runId)!.state).toBe('running');
  });

  it('404s a runId with no active resume token', async () => {
    const id = createRun(db, 1, 9, rollout, T0); // still running, never parked
    await expect(POST({ request: req({ runId: id }) } as never)).rejects.toMatchObject({ status: 404 });
  });

  it('404s an unknown runId', async () => {
    await expect(POST({ request: req({ runId: 'nope' }) } as never)).rejects.toMatchObject({ status: 404 });
  });

  it('404s when neither token nor runId is given', async () => {
    await expect(POST({ request: req({}) } as never)).rejects.toMatchObject({ status: 404 });
  });
});
