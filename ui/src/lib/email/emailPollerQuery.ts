import type Database from 'better-sqlite3';
import type { PollStatus } from './emailPollerView.js';

export interface RecentEmail {
  sentAt: string;
  subject: string | null;
  type: string;
  actionStatus: string | null;
  actionDetail: string | null;
}

export interface EmailPollerData {
  poll: PollStatus | null;
  recent: RecentEmail[];
}

/**
 * Read the latest poll status + the most recent ingested emails for the Settings
 * panel. Tolerant of a fresh DB (no status row, or the email tables/columns not
 * created yet) — returns nulls/empties rather than throwing.
 */
export function getEmailPollerData(db: Database.Database, limit = 10): EmailPollerData {
  let poll: PollStatus | null = null;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'email_poll_status'").get() as
      | { value: string }
      | undefined;
    if (row?.value) poll = JSON.parse(row.value) as PollStatus;
  } catch {
    poll = null;
  }

  let recent: RecentEmail[] = [];
  try {
    recent = (
      db
        .prepare(
          `SELECT sent_at, subject, parsed_type, action_status, action_detail
           FROM email_messages
           ORDER BY captured_at DESC, rowid DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
        sent_at: string;
        subject: string | null;
        parsed_type: string;
        action_status: string | null;
        action_detail: string | null;
      }>
    ).map((r) => ({
      sentAt: r.sent_at,
      subject: r.subject,
      type: r.parsed_type,
      actionStatus: r.action_status,
      actionDetail: r.action_detail,
    }));
  } catch {
    recent = [];
  }

  return { poll, recent };
}
