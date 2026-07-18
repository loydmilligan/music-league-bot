import type Database from 'better-sqlite3';
import type { ParsedEmail } from './emailParser.js';
import { enqueueDigestJob } from './digestJobs.js';

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
      action_status TEXT,
      action_detail TEXT,
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
  // Guarded ALTER for email_messages outcome columns (older DBs predate them).
  const emailCols = new Set(
    (db.prepare('PRAGMA table_info(email_messages)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const col of ['action_status', 'action_detail']) {
    if (!emailCols.has(col)) db.exec(`ALTER TABLE email_messages ADD COLUMN ${col} TEXT`);
  }
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
  actionStatus: string;
  actionDetail: string;
}

export interface IngestMeta {
  raw?: string;
  uid?: number;
  uidvalidity?: number;
}

/** Compute the human-facing action outcome for a parsed email. Read-only. */
function computeOutcome(
  db: Database.Database,
  p: ParsedEmail,
  roundId: number | null,
): { status: string; detail: string } {
  if (p.type === 'other') return { status: 'archived', detail: 'archived (no action)' };
  if (roundId == null) {
    return {
      status: 'unmapped',
      detail:
        p.type === 'new_playlist'
          ? 'no matching round — playlist NOT captured'
          : 'no matching round (round not imported yet?)',
    };
  }
  const event = EVENT_FOR_TYPE[p.type]?.event ?? 'event';
  const roundName =
    (db.prepare('SELECT name FROM rounds WHERE id = ?').get(roundId) as { name: string } | undefined)?.name ?? `#${roundId}`;
  if (p.type === 'new_playlist') {
    const prior = (
      db.prepare('SELECT spotify_playlist_url AS u FROM rounds WHERE id = ?').get(roundId) as { u: string | null } | undefined
    )?.u;
    const cap = prior && prior.trim() ? 'playlist already set' : p.playlistUrl ? 'playlist captured' : 'no playlist URL in email';
    return { status: 'recorded', detail: `recorded ${event} · round "${roundName}" · ${cap}` };
  }
  return { status: 'recorded', detail: `recorded ${event} · round "${roundName}"` };
}

/** Record an email that threw during parse/ingest so it's visible in the log. */
export function recordIngestFailure(
  db: Database.Database,
  key: string,
  fields: { subject?: string; sentAt?: string; raw?: string; uid?: number; uidvalidity?: number },
  error: string,
): void {
  db.prepare(
    `INSERT INTO email_messages
       (message_id, uid, uidvalidity, from_addr, to_addr, subject, sent_at, parsed_type, round_id, action_status, action_detail, raw)
     VALUES (@message_id, @uid, @uidvalidity, '', NULL, @subject, @sent_at, 'error', NULL, 'error', @detail, @raw)
     ON CONFLICT(message_id) DO UPDATE SET
       parsed_type = 'error', action_status = 'error', action_detail = excluded.action_detail`,
  ).run({
    message_id: key,
    uid: fields.uid ?? null,
    uidvalidity: fields.uidvalidity ?? null,
    subject: fields.subject ?? null,
    sent_at: fields.sentAt ?? new Date().toISOString(),
    detail: `parse/ingest failed: ${error}`.slice(0, 300),
    raw: fields.raw ?? '',
  });
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
  // Compute the outcome BEFORE the round-update writes (so new_playlist can tell
  // "captured" from "already set" by reading the prior playlist URL).
  const outcome = computeOutcome(db, p, roundId);

  db.prepare(
    `INSERT INTO email_messages
       (message_id, uid, uidvalidity, from_addr, to_addr, subject, sent_at, parsed_type, round_id, action_status, action_detail, raw)
     VALUES (@message_id, @uid, @uidvalidity, @from_addr, @to_addr, @subject, @sent_at, @parsed_type, @round_id, @action_status, @action_detail, @raw)
     ON CONFLICT(message_id) DO UPDATE SET
       parsed_type   = excluded.parsed_type,
       round_id      = COALESCE(excluded.round_id, email_messages.round_id),
       action_status = excluded.action_status,
       action_detail = excluded.action_detail`,
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
    action_status: outcome.status,
    action_detail: outcome.detail,
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

    if (eventType === 'voting_ended') {
      const leagueRow = db.prepare(
        `SELECT s.league_id AS leagueId FROM rounds r JOIN seasons s ON s.id=r.season_id WHERE r.id=?`,
      ).get(roundId) as { leagueId: number } | undefined;
      if (leagueRow) enqueueDigestJob(db, roundId, leagueRow.leagueId, p.sentAt);
    }
  }

  return { stored: true, roundId, eventType, actionStatus: outcome.status, actionDetail: outcome.detail };
}
