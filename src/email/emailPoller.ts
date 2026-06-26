import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { fetchMusicLeagueEmails, type ImapConfig } from './imapClient.js';
import { parseEmail } from './emailParser.js';
import { ensureEmailSchema, ingestParsedEmail } from './emailIngest.js';

/**
 * Background poller that ingests Music League notification mail into league.db.
 * Mirrors mlAuthHeartbeat: one pass at startup (which backfills the whole
 * mailbox the first time, since email_messages is empty), then a fixed interval.
 * Dormant — but never crashing — when no app password is configured.
 */

let _db: Database.Database | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  const path = resolve(process.env.DATA_DIR ?? 'data', 'league.db');
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('foreign_keys = ON');
  ensureEmailSchema(_db);
  return _db;
}

function config(): ImapConfig {
  return {
    host: process.env.GMAIL_IMAP_HOST ?? 'imap.gmail.com',
    port: Number(process.env.GMAIL_IMAP_PORT ?? 993),
    user: process.env.GMAIL_IMAP_USER ?? 'mattmariani@gmail.com',
    pass: process.env.GMAIL_IMAP_APP_PASSWORD ?? '',
    fromFilter: process.env.MUSICLEAGUE_FROM ?? 'notifications@musicleague.com',
  };
}

/** Run one ingest pass. Safe to call repeatedly; idempotent on message_id. */
export async function runEmailIngestPass(): Promise<{ fetched: number; events: number }> {
  const cfg = config();
  if (!cfg.pass) {
    console.warn('[email] GMAIL_IMAP_APP_PASSWORD unset — email poller dormant');
    return { fetched: 0, events: 0 };
  }
  const db = getDb();
  const minUidFor = (uidValidity: number): number => {
    const row = db
      .prepare('SELECT MAX(uid) AS m FROM email_messages WHERE uidvalidity = ?')
      .get(uidValidity) as { m: number | null } | undefined;
    return row?.m ?? 0;
  };

  const emails = await fetchMusicLeagueEmails(cfg, minUidFor);
  let events = 0;
  for (const e of emails) {
    try {
      const parsed = await parseEmail(e.raw);
      const res = ingestParsedEmail(db, parsed, { raw: e.raw, uid: e.uid, uidvalidity: e.uidValidity });
      if (res.eventType) events++;
    } catch (err) {
      console.error('[email] parse/ingest failed for uid', e.uid, err);
    }
  }
  if (emails.length) console.log(`[email] ingested ${emails.length} message(s), ${events} round event(s)`);
  return { fetched: emails.length, events };
}

/** Start the background poller. Idempotent. */
export function startEmailPoller(): void {
  if (timer) return;
  const intervalMs = Number(process.env.EMAIL_POLL_MS ?? 180_000);
  void runEmailIngestPass().catch((err) => console.error('[email] initial pass failed', err));
  timer = setInterval(() => {
    void runEmailIngestPass().catch((err) => console.error('[email] pass failed', err));
  }, intervalMs);
  timer.unref?.();
}
