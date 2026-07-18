import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  generateApprovalToken, setAwaitingApproval, setAwaitingReview,
  resolveJobByToken, approveJob, denyJob, claimApproval, completeApproval,
} from './approvals.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE digest_jobs (
      round_id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, status TEXT NOT NULL,
      gen_params TEXT, error TEXT, approval_token TEXT, decision TEXT, decided_at TEXT,
      review_url TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO digest_jobs (round_id, league_id, status, created_at, updated_at)
              VALUES (7, 1, 'rendered', '2026-07-17T00:00:00Z', '2026-07-17T00:00:00Z')`).run();
  return db;
}
const NOW = '2026-07-17T09:00:00Z';
const status = (db: Database.Database, id = 7) =>
  (db.prepare('SELECT status FROM digest_jobs WHERE round_id=?').get(id) as { status: string }).status;

describe('token lifecycle', () => {
  it('generates distinct, non-empty tokens', () => {
    const a = generateApprovalToken(); const b = generateApprovalToken();
    expect(a.length).toBeGreaterThan(16); expect(a).not.toBe(b);
  });
  it('setAwaitingApproval stores token + review_url + status', () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok123', 'https://d/x', NOW);
    expect(status(db)).toBe('awaiting_approval');
    expect(resolveJobByToken(db, 'tok123')).toEqual({ roundId: 7, status: 'awaiting_approval' });
  });
  it('setAwaitingReview stores token + status awaiting_review', () => {
    const db = makeDb();
    setAwaitingReview(db, 7, 'tok456', 'https://d/x', NOW);
    expect(status(db)).toBe('awaiting_review');
    expect(resolveJobByToken(db, 'tok456')).toEqual({ roundId: 7, status: 'awaiting_review' });
  });
  it('resolveJobByToken returns undefined for an unknown token', () => {
    expect(resolveJobByToken(makeDb(), 'nope')).toBeUndefined();
  });
});

describe('approveJob', () => {
  it('finalizes, triggers send, marks approved+done, consumes the token', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    const finalize = vi.fn().mockResolvedValue(undefined);
    const triggerSend = vi.fn().mockResolvedValue(undefined);
    const res = await approveJob(db, 'tok', { finalize, triggerSend, now: () => NOW });
    expect(res).toEqual({ ok: true, roundId: 7 });
    expect(finalize).toHaveBeenCalledWith(7);
    expect(triggerSend).toHaveBeenCalledTimes(1);
    expect(status(db)).toBe('done');
    const row = db.prepare('SELECT decision, approval_token FROM digest_jobs WHERE round_id=7').get() as { decision: string; approval_token: string | null };
    expect(row.decision).toBe('approved');
    expect(row.approval_token).toBeNull(); // single-use
  });
  it('rejects an unknown token without finalizing', async () => {
    const db = makeDb();
    const finalize = vi.fn();
    const res = await approveJob(db, 'bad', { finalize, triggerSend: vi.fn(), now: () => NOW });
    expect(res.ok).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });
  it('rejects a token whose job is not awaiting_approval (e.g. awaiting_review)', async () => {
    const db = makeDb();
    setAwaitingReview(db, 7, 'tok', 'https://d/x', NOW);
    const res = await approveJob(db, 'tok', { finalize: vi.fn(), triggerSend: vi.fn(), now: () => NOW });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/awaiting approval/i);
  });
  it('a second approve with the same (now-consumed) token is rejected', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    await approveJob(db, 'tok', { finalize: vi.fn().mockResolvedValue(undefined), triggerSend: vi.fn().mockResolvedValue(undefined), now: () => NOW });
    const res = await approveJob(db, 'tok', { finalize: vi.fn(), triggerSend: vi.fn(), now: () => NOW });
    expect(res.ok).toBe(false);
  });
  it('marks the job failed with the error message when finalize throws, without calling triggerSend, and still consumes the token', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    const finalize = vi.fn().mockRejectedValue(new Error('finalize 500'));
    const triggerSend = vi.fn().mockResolvedValue(undefined);
    const res = await approveJob(db, 'tok', { finalize, triggerSend, now: () => NOW });
    expect(res.ok).toBe(false);
    expect(res.roundId).toBe(7);
    expect(triggerSend).not.toHaveBeenCalled();
    const row = db.prepare('SELECT status, error, approval_token FROM digest_jobs WHERE round_id=7').get() as
      { status: string; error: string | null; approval_token: string | null };
    expect(row.status).toBe('failed');
    expect(row.error).toContain('finalize 500');
    expect(row.approval_token).toBeNull();
  });
});

describe('claimApproval (fast-ack half)', () => {
  it('consumes the token and marks finalizing WITHOUT any side effect', () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    const res = claimApproval(db, 'tok', () => NOW);
    expect(res).toEqual({ ok: true, roundId: 7 });
    const row = db.prepare('SELECT status, decision, approval_token FROM digest_jobs WHERE round_id=7').get() as { status: string; decision: string; approval_token: string | null };
    expect(row.status).toBe('finalizing');
    expect(row.decision).toBe('approved');
    expect(row.approval_token).toBeNull();
  });
  it('rejects an unknown token', () => {
    expect(claimApproval(makeDb(), 'bad', () => NOW).ok).toBe(false);
  });
  it('rejects a token not in awaiting_approval', () => {
    const db = makeDb();
    setAwaitingReview(db, 7, 'tok', 'https://d/x', NOW);
    expect(claimApproval(db, 'tok', () => NOW).ok).toBe(false);
  });
  it('a second claim with the consumed token is rejected', () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    claimApproval(db, 'tok', () => NOW);
    expect(claimApproval(db, 'tok', () => NOW).ok).toBe(false);
  });
});

describe('completeApproval (background half)', () => {
  it('finalizes, triggers send, marks done', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    claimApproval(db, 'tok', () => NOW);
    const finalize = vi.fn().mockResolvedValue(undefined);
    const triggerSend = vi.fn().mockResolvedValue(undefined);
    await completeApproval(db, 7, { finalize, triggerSend, now: () => NOW });
    expect(finalize).toHaveBeenCalledWith(7);
    expect(triggerSend).toHaveBeenCalledTimes(1);
    expect(status(db)).toBe('done');
  });
  it('on a finalize throw: marks the job failed with the error, and rethrows, without calling triggerSend', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    claimApproval(db, 'tok', () => NOW);
    const triggerSend = vi.fn().mockResolvedValue(undefined);
    await expect(completeApproval(db, 7, {
      finalize: vi.fn().mockRejectedValue(new Error('finalize 500')), triggerSend, now: () => NOW,
    })).rejects.toThrow('finalize 500');
    expect(triggerSend).not.toHaveBeenCalled();
    const row = db.prepare('SELECT status, error FROM digest_jobs WHERE round_id=7').get() as { status: string; error: string | null };
    expect(row.status).toBe('failed');
    expect(row.error).toContain('finalize 500');
  });
});

describe('denyJob', () => {
  it('marks denied, consumes token, leaves status denied', async () => {
    const db = makeDb();
    setAwaitingApproval(db, 7, 'tok', 'https://d/x', NOW);
    const res = await denyJob(db, 'tok', () => NOW);
    expect(res).toEqual({ ok: true, roundId: 7 });
    expect(status(db)).toBe('denied');
    const row = db.prepare('SELECT decision, approval_token FROM digest_jobs WHERE round_id=7').get() as { decision: string; approval_token: string | null };
    expect(row.decision).toBe('denied');
    expect(row.approval_token).toBeNull();
  });
  it('denies a token in awaiting_review too', async () => {
    const db = makeDb();
    setAwaitingReview(db, 7, 'tok', 'https://d/x', NOW);
    expect((await denyJob(db, 'tok', () => NOW)).ok).toBe(true);
    expect(status(db)).toBe('denied');
  });
  it('rejects an unknown token', async () => {
    expect((await denyJob(makeDb(), 'bad', () => NOW)).ok).toBe(false);
  });
});
