import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

export interface ApiResult {
  ok: boolean;
  roundId?: number;
  reason?: string;
}

export interface ApproveDeps {
  finalize: (roundId: number) => Promise<void>;
  triggerSend: () => Promise<void>;
  now: () => string;
}

export function generateApprovalToken(): string {
  return randomBytes(24).toString('base64url');
}

export function setAwaitingApproval(
  db: Database.Database, roundId: number, token: string, reviewUrl: string, nowIso: string,
): void {
  db.prepare(
    `UPDATE digest_jobs SET status='awaiting_approval', approval_token=?, review_url=?, updated_at=? WHERE round_id=?`,
  ).run(token, reviewUrl, nowIso, roundId);
}

export function setAwaitingReview(
  db: Database.Database, roundId: number, token: string, reviewUrl: string, nowIso: string,
): void {
  db.prepare(
    `UPDATE digest_jobs SET status='awaiting_review', approval_token=?, review_url=?, updated_at=? WHERE round_id=?`,
  ).run(token, reviewUrl, nowIso, roundId);
}

export function resolveJobByToken(
  db: Database.Database, token: string,
): { roundId: number; status: string } | undefined {
  if (!token) return undefined;
  const row = db.prepare('SELECT round_id, status FROM digest_jobs WHERE approval_token=?').get(token) as
    | { round_id: number; status: string }
    | undefined;
  return row ? { roundId: row.round_id, status: row.status } : undefined;
}

export async function approveJob(db: Database.Database, token: string, deps: ApproveDeps): Promise<ApiResult> {
  const job = resolveJobByToken(db, token);
  if (!job) return { ok: false, reason: 'invalid or already-used token' };
  if (job.status !== 'awaiting_approval') {
    return { ok: false, reason: `round ${job.roundId} is not awaiting approval (status=${job.status})` };
  }
  // Consume the token and mark the decision BEFORE the side effects, so a
  // double-tap can never fire finalize/send twice (single-use is atomic here).
  db.prepare(
    `UPDATE digest_jobs SET approval_token=NULL, decision='approved', decided_at=?, status='finalizing', updated_at=? WHERE round_id=?`,
  ).run(deps.now(), deps.now(), job.roundId);
  try {
    await deps.finalize(job.roundId);
    await deps.triggerSend();
  } catch (err) {
    db.prepare(`UPDATE digest_jobs SET status='failed', error=?, updated_at=? WHERE round_id=?`)
      .run(err instanceof Error ? err.message : String(err), deps.now(), job.roundId);
    return { ok: false, roundId: job.roundId, reason: `approve failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  db.prepare(`UPDATE digest_jobs SET status='done', updated_at=? WHERE round_id=?`).run(deps.now(), job.roundId);
  return { ok: true, roundId: job.roundId };
}

export async function denyJob(db: Database.Database, token: string, now: () => string): Promise<ApiResult> {
  const job = resolveJobByToken(db, token);
  if (!job) return { ok: false, reason: 'invalid or already-used token' };
  if (job.status !== 'awaiting_approval' && job.status !== 'awaiting_review') {
    return { ok: false, reason: `round ${job.roundId} is not awaiting a decision (status=${job.status})` };
  }
  db.prepare(
    `UPDATE digest_jobs SET approval_token=NULL, decision='denied', decided_at=?, status='denied', updated_at=? WHERE round_id=?`,
  ).run(now(), now(), job.roundId);
  return { ok: true, roundId: job.roundId };
}
