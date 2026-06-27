import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { fetchMusicLeagueEmails, type ImapConfig } from './imapClient.js';
import { parseEmail } from './emailParser.js';
import { ensureEmailSchema, ingestParsedEmail, recordIngestFailure } from './emailIngest.js';

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
  const db = getDb();
  if (!cfg.pass) {
    console.warn('[email] GMAIL_IMAP_APP_PASSWORD unset — email poller dormant');
    writePollStatus(db, { ok: false, fetched: 0, events: 0, error: 'no app password configured' });
    return { fetched: 0, events: 0 };
  }
  const minUidFor = (uidValidity: number): number => {
    const row = db
      .prepare('SELECT MAX(uid) AS m FROM email_messages WHERE uidvalidity = ?')
      .get(uidValidity) as { m: number | null } | undefined;
    return row?.m ?? 0;
  };

  let emails;
  try {
    emails = await fetchMusicLeagueEmails(cfg, minUidFor);
  } catch (err) {
    // Connection/auth failure — record it so the status indicator can go red.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email] IMAP fetch failed:', msg);
    writePollStatus(db, { ok: false, fetched: 0, events: 0, error: msg });
    return { fetched: 0, events: 0 };
  }

  let events = 0;
  for (const e of emails) {
    try {
      const parsed = await parseEmail(e.raw);
      const res = ingestParsedEmail(db, parsed, { raw: e.raw, uid: e.uid, uidvalidity: e.uidValidity });
      if (res.eventType) events++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[email] parse/ingest failed for uid', e.uid, msg);
      // Record the failed email so it's visible in the status log.
      try {
        recordIngestFailure(db, `uid:${e.uidValidity}:${e.uid}`, { uid: e.uid, uidvalidity: e.uidValidity, raw: e.raw }, msg);
      } catch { /* best-effort */ }
    }
  }
  writePollStatus(db, { ok: true, fetched: emails.length, events, error: null });
  if (emails.length) console.log(`[email] ingested ${emails.length} message(s), ${events} round event(s)`);
  return { fetched: emails.length, events };
}

/** Persist the latest poll outcome for the Settings status panel. */
function writePollStatus(
  db: Database.Database,
  s: { ok: boolean; fetched: number; events: number; error: string | null },
): void {
  try {
    const value = JSON.stringify({ checkedAt: new Date().toISOString(), ...s });
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('email_poll_status', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(value);
  } catch (err) {
    console.error('[email] failed to write poll status', err);
  }
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
