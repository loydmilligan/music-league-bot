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

    -- One row per "User Submitted" email. Deliberately NOT round_events, which
    -- is UNIQUE(round_id, event_type) and so can hold only one row per round --
    -- the whole point here is the repeats. A second row for the same person in
    -- the same round IS the mid-round pick change.
    --
    -- The email names the person and the round but never the song, so this
    -- table cannot reveal who submitted what. That is what makes it safe to
    -- read during a live round, while guessing is still open.
    CREATE TABLE IF NOT EXISTS submission_events (
      message_id     TEXT PRIMARY KEY REFERENCES email_messages(message_id),
      round_id       INTEGER REFERENCES rounds(id),
      submitter_name TEXT NOT NULL,
      league_label   TEXT,
      round_name     TEXT,
      occurred_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_submission_events_round
      ON submission_events(round_id, submitter_name, occurred_at);

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

/** Lowercase and drop everything but a-z0-9, so punctuation/spacing can't matter. */
function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Map an email's league label ("Second Second Best", "Fam Jam IV: Uncharted
 * Tracks") to a `leagues.id`, or null when it is unknown or ambiguous.
 *
 * This used to be a bare `label LIKE l.name || '%'` prefix test, which silently
 * dropped two of the four live leagues for the whole of 2026: the ML season
 * names "Second Second Best" and "Fam Jam IV: Uncharted Tracks" do not START
 * with the mlbot league names "Second Best" and "Fam-Jam", so every
 * new_playlist email for those leagues logged "playlist NOT captured" and no
 * voting_started event was ever written for them.
 *
 * Containment on the normalized forms handles both ("secondsecondbest"
 * contains "secondbest"; "famjamivunchartedtracks" contains "famjam").
 * scripts/ml-rebuild.mjs rightly warns that substring matching is unsafe — but
 * the danger it describes is picking the wrong SEASON of one league, and this
 * resolves only the LEAGUE. To keep it honest anyway, an ambiguous label that
 * hits more than one league returns null rather than guessing; that is the same
 * "unmapped" outcome as before, so a future league name that collides degrades
 * to today's behaviour instead of writing to the wrong round.
 */
export function resolveLeagueIdFromLabel(
  db: Database.Database,
  label: string | null,
): number | null {
  if (!label) return null;
  const needle = normalizeLabel(label);
  if (!needle) return null;
  const leagues = db.prepare('SELECT id, name FROM leagues').all() as Array<{ id: number; name: string }>;
  const hits = leagues.filter((l) => {
    const n = normalizeLabel(l.name);
    return n.length > 0 && needle.includes(n);
  });
  return hits.length === 1 ? hits[0].id : null;
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
  // new_playlist and user_submitted carry no round id → match round name within
  // the league. Same league-scoping discipline applies to both: an unplaceable
  // league label must not fall back to a league-wide name match.
  if ((p.type === 'new_playlist' || p.type === 'user_submitted') && p.roundName) {
    const leagueId = resolveLeagueIdFromLabel(db, p.leagueLabel);
    // A label we could not place is not a licence to match the round name
    // league-wide — that is how one league's round name would capture another
    // league's playlist. Only a genuinely absent label stays unscoped.
    if (p.leagueLabel && leagueId == null) return null;
    const row = db
      .prepare(
        `SELECT r.id FROM rounds r
         JOIN seasons s ON s.id = r.season_id
         WHERE r.name = ? AND (? IS NULL OR s.league_id = ?)
         ORDER BY r.created_at DESC
         LIMIT 1`,
      )
      .get(p.roundName, leagueId, leagueId) as { id: number } | undefined;
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
  if (p.type === 'user_submitted') {
    const who = p.submitterName ?? 'someone';
    return { status: 'recorded', detail: `recorded submission by ${who}` };
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

  // Submission churn. Keyed on message_id so a replayed backfill is a no-op,
  // while genuinely distinct emails from the same person in the same round each
  // keep their own row -- those repeats are the pick-change signal.
  if (p.type === 'user_submitted' && p.submitterName) {
    db.prepare(
      `INSERT INTO submission_events
         (message_id, round_id, submitter_name, league_label, round_name, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         round_id = COALESCE(excluded.round_id, submission_events.round_id)`,
    ).run(p.messageId, roundId, p.submitterName, p.leagueLabel, p.roundName, p.sentAt);
  }

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
