/**
 * Idempotency for the auto-posted digest.
 *
 * Posting to a group is irreversible, so the claim is taken BEFORE the send and
 * the row is the only thing standing between a retry and a duplicate message.
 *
 * Failure policy, deliberately asymmetric:
 *  - A send that throws keeps its claim. We cannot know whether WhatsApp
 *    accepted the message before the error, so retrying risks a duplicate in a
 *    real group. A stuck claim means a missed digest — loud, and fixable by
 *    hand. A duplicate is neither.
 *  - A failure BEFORE the send (export blew up, nothing left the process) calls
 *    releaseClaim, because retrying that is safe.
 */
import type Database from 'better-sqlite3';

/** Take the send slot for a round. False if it is already claimed or sent. */
export function claimSend(
  db: Database.Database,
  roundId: number,
  leagueId: number,
  nowIso: string,
): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO digest_sends (round_id, league_id, claimed_at)
       VALUES (?, ?, ?)`,
    )
    .run(roundId, leagueId, nowIso);
  return res.changes === 1;
}

/** Give the slot back after a pre-send failure. A confirmed send is never released. */
export function releaseClaim(db: Database.Database, roundId: number): void {
  db.prepare('DELETE FROM digest_sends WHERE round_id = ? AND sent_at IS NULL').run(roundId);
}

export function markSent(
  db: Database.Database,
  roundId: number,
  opts: { sentAt: string; target: string; url: string },
): void {
  db.prepare(
    `UPDATE digest_sends SET sent_at = ?, target = ?, url = ?, error = NULL
      WHERE round_id = ?`,
  ).run(opts.sentAt, opts.target, opts.url, roundId);
}

/** Record why a send failed. Deliberately does not clear the claim. */
export function markFailed(db: Database.Database, roundId: number, error: string): void {
  db.prepare('UPDATE digest_sends SET error = ? WHERE round_id = ?').run(error, roundId);
}

export function hasBeenSent(db: Database.Database, roundId: number): boolean {
  const row = db
    .prepare('SELECT 1 AS n FROM digest_sends WHERE round_id = ? AND sent_at IS NOT NULL')
    .get(roundId) as { n: number } | undefined;
  return !!row;
}
