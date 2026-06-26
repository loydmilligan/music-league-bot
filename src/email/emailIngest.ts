import type Database from 'better-sqlite3';
import type { ParsedEmail } from './emailParser.js';

/**
 * Persistence for parsed Music League emails: a full archive (`email_messages`)
 * plus a derived round phase log (`round_events`) and denormalized phase
 * timestamps on `rounds`. All writes are idempotent so backfills and reconnects
 * are safe to replay.
 */

const EVENT_FOR_TYPE: Record<string, { event: string; col: string } | undefined> = {
  round_starting: { event: 'round_started', col: 'round_started_at' },
  new_playlist: { event: 'voting_started', col: 'voting_started_at' },
  votes_are_in: { event: 'voting_ended', col: 'voting_ended_at' },
};

const ROUND_PHASE_COLUMNS = ['round_started_at', 'voting_started_at', 'voting_ended_at'];

/** Create the email tables and add the denormalized phase columns to `rounds`. */
export function ensureEmailSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_messages (
      message_id   TEXT PRIMARY KEY,
      uid          INTEGER,
      uidvalidity  INTEGER,
      from_addr    TEXT NOT NULL,
      to_addr      TEXT,
      subject      TEXT,
      sent_at      TEXT NOT NULL,
      parsed_type  TEXT NOT NULL,
      round_id     INTEGER REFERENCES rounds(id),
      raw          TEXT NOT NULL DEFAULT '',
      captured_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_type  ON email_messages(parsed_type);
    CREATE INDEX IF NOT EXISTS idx_email_round ON email_messages(round_id);

    CREATE TABLE IF NOT EXISTS round_events (
      id                INTEGER PRIMARY KEY,
      round_id          INTEGER NOT NULL REFERENCES rounds(id),
      event_type        TEXT NOT NULL,
      occurred_at       TEXT NOT NULL,
      playlist_url      TEXT,
      source_message_id TEXT REFERENCES email_messages(message_id),
      UNIQUE(round_id, event_type)
    );
  `);

  // ALTER TABLE … ADD COLUMN has no IF NOT EXISTS in SQLite — guard via table_info.
  const existing = new Set(
    (db.prepare('PRAGMA table_info(rounds)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const col of ROUND_PHASE_COLUMNS) {
    if (!existing.has(col)) db.exec(`ALTER TABLE rounds ADD COLUMN ${col} TEXT`);
  }
}

/** Resolve a parsed email to an mlbot round id, or null if unknown. */
function resolveRoundId(db: Database.Database, p: ParsedEmail): number | null {
  // round_starting / votes_are_in carry the exact ML round id.
  if (p.mlRoundId) {
    const row = db.prepare('SELECT id FROM rounds WHERE ml_round_id = ?').get(p.mlRoundId) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }
  // new_playlist has no round id → match round name within the league. The
  // leagueLabel ("Hip Jammers 3: its all hippening") begins with the league name.
  if (p.type === 'new_playlist' && p.roundName) {
    const row = db
      .prepare(
        `SELECT r.id FROM rounds r
         JOIN seasons s ON s.id = r.season_id
         JOIN leagues l ON l.id = s.league_id
         WHERE r.name = ? AND (? IS NULL OR ? LIKE l.name || '%')
         ORDER BY r.created_at DESC
         LIMIT 1`,
      )
      .get(p.roundName, p.leagueLabel, p.leagueLabel) as { id: number } | undefined;
    return row?.id ?? null;
  }
  return null;
}

export interface IngestResult {
  stored: boolean;
  roundId: number | null;
  eventType: string | null;
}

export interface IngestMeta {
  raw?: string;
  uid?: number;
  uidvalidity?: number;
}

/**
 * Archive a parsed email and, for the three lifecycle types, record the round
 * phase event + denormalized timestamp. Idempotent on message_id and on
 * (round_id, event_type).
 */
export function ingestParsedEmail(
  db: Database.Database,
  p: ParsedEmail,
  meta: IngestMeta = {},
): IngestResult {
  const roundId = p.type === 'other' ? null : resolveRoundId(db, p);

  db.prepare(
    `INSERT INTO email_messages
       (message_id, uid, uidvalidity, from_addr, to_addr, subject, sent_at, parsed_type, round_id, raw)
     VALUES (@message_id, @uid, @uidvalidity, @from_addr, @to_addr, @subject, @sent_at, @parsed_type, @round_id, @raw)
     ON CONFLICT(message_id) DO UPDATE SET
       parsed_type = excluded.parsed_type,
       round_id    = COALESCE(excluded.round_id, email_messages.round_id)`,
  ).run({
    message_id: p.messageId,
    uid: meta.uid ?? null,
    uidvalidity: meta.uidvalidity ?? null,
    from_addr: p.fromAddr,
    to_addr: p.toAddr,
    subject: p.subject,
    sent_at: p.sentAt,
    parsed_type: p.type,
    round_id: roundId,
    raw: meta.raw ?? '',
  });

  let eventType: string | null = null;
  const map = EVENT_FOR_TYPE[p.type];
  if (roundId != null && map) {
    eventType = map.event;
    db.prepare(
      `INSERT INTO round_events (round_id, event_type, occurred_at, playlist_url, source_message_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(round_id, event_type) DO UPDATE SET
         occurred_at       = excluded.occurred_at,
         playlist_url      = COALESCE(excluded.playlist_url, round_events.playlist_url),
         source_message_id = excluded.source_message_id`,
    ).run(roundId, map.event, p.sentAt, p.playlistUrl, p.messageId);

    db.prepare(`UPDATE rounds SET ${map.col} = ? WHERE id = ?`).run(p.sentAt, roundId);

    if (p.type === 'new_playlist' && p.playlistUrl) {
      db.prepare(
        `UPDATE rounds SET spotify_playlist_url = COALESCE(NULLIF(spotify_playlist_url, ''), ?) WHERE id = ?`,
      ).run(p.playlistUrl, roundId);
    }
  }

  return { stored: true, roundId, eventType };
}
