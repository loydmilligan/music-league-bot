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

/**
 * Fast, synchronous half of approve: verify + CONSUME the single-use token and
 * mark the job `finalizing` (decision=approved) in one UPDATE, BEFORE any side
 * effects — so a double-tap can never fire finalize/send twice. Returns the
 * roundId to hand to `completeApproval`. This is what the public endpoint calls
 * first so it can fast-ack (200) before the slow finalize+send, which otherwise
 * blows past the ntfy action's ~15s timeout.
 */
export function claimApproval(db: Database.Database, token: string, now: () => string): ApiResult {
  const job = resolveJobByToken(db, token);
  if (!job) return { ok: false, reason: 'invalid or already-used token' };
  if (job.status !== 'awaiting_approval') {
    return { ok: false, reason: `round ${job.roundId} is not awaiting approval (status=${job.status})` };
  }
  db.prepare(
    `UPDATE digest_jobs SET approval_token=NULL, decision='approved', decided_at=?, status='finalizing', updated_at=? WHERE round_id=?`,
  ).run(now(), now(), job.roundId);
  return { ok: true, roundId: job.roundId };
}

/**
 * Slow half of approve: finalize the draft, then trigger the immediate send.
 * Runs after `claimApproval` (which already consumed the token). On success the
 * job is `done`; on failure it is marked `failed` (visible + requeue-able) and
 * the error is rethrown so a synchronous caller learns of it. Callers that
 * fast-acked run this in the background and just log a rejection.
 */
export async function completeApproval(
  db: Database.Database, roundId: number, deps: ApproveDeps,
): Promise<void> {
  try {
    await deps.finalize(roundId);
    await deps.triggerSend();
  } catch (err) {
    db.prepare(`UPDATE digest_jobs SET status='failed', error=?, updated_at=? WHERE round_id=?`)
      .run(err instanceof Error ? err.message : String(err), deps.now(), roundId);
    throw err;
  }
  db.prepare(`UPDATE digest_jobs SET status='done', updated_at=? WHERE round_id=?`).run(deps.now(), roundId);
}

/**
 * Synchronous end-to-end approve (claim → finalize → send → done). Preserved for
 * callers/tests that want the whole thing awaited; the public endpoint instead
 * uses claimApproval + a background completeApproval to fast-ack.
 */
export async function approveJob(db: Database.Database, token: string, deps: ApproveDeps): Promise<ApiResult> {
  const claim = claimApproval(db, token, deps.now);
  if (!claim.ok || claim.roundId === undefined) return claim;
  try {
    await completeApproval(db, claim.roundId, deps);
  } catch (err) {
    return { ok: false, roundId: claim.roundId, reason: `approve failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, roundId: claim.roundId };
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
