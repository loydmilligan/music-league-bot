import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureEmailSchema, ingestParsedEmail, recordIngestFailure } from '../src/email/emailIngest.js';
import type { ParsedEmail } from '../src/email/emailParser.js';

function seedDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (
      id INTEGER PRIMARY KEY, season_id INTEGER, ml_round_id TEXT UNIQUE,
      name TEXT, created_at TEXT, spotify_playlist_url TEXT
    );
    INSERT INTO leagues (id, slug, name) VALUES (1, 'hip-jammers', 'Hip Jammers');
    INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 3);
    INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES
      (10, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Plots so thicc', '2026-06-23T00:00:00Z'),
      (11, 1, '12c30e07f33d4acd92ca489696788036', 'EDM ''em', '2026-06-23T00:00:00Z'),
      (12, 1, '1d4a94046a67405e9d855f5c0fd9136e', 'Pick Me Up', '2026-06-23T00:00:00Z');
  `);
  ensureEmailSchema(db);
  return db;
}

function mkEmail(over: Partial<ParsedEmail>): ParsedEmail {
  return {
    messageId: `m-${Math.round(Math.random() * 1e9)}@x`,
    subject: 's',
    fromAddr: 'notifications@musicleague.com',
    toAddr: 'mattmariani@gmail.com',
    sentAt: '2026-05-10T12:00:00.000Z',
    type: 'other',
    mlRoundId: null,
    leagueLabel: null,
    roundName: null,
    playlistUrl: null,
    ...over,
  };
}

let db: Database.Database;
beforeEach(() => {
  db = seedDb();
});

describe('ingestParsedEmail — archive', () => {
  it('stores every email (even "other") in email_messages', () => {
    ingestParsedEmail(db, mkEmail({ messageId: 'a@x', type: 'other' }));
    const row = db.prepare('SELECT * FROM email_messages WHERE message_id = ?').get('a@x') as any;
    expect(row).toBeTruthy();
    expect(row.parsed_type).toBe('other');
    expect(row.round_id).toBeNull();
  });

  it('is idempotent on message_id (no duplicate rows or events)', () => {
    const e = mkEmail({ messageId: 'dup@x', type: 'votes_are_in', mlRoundId: '1d4a94046a67405e9d855f5c0fd9136e' });
    ingestParsedEmail(db, e);
    ingestParsedEmail(db, e);
    expect((db.prepare('SELECT COUNT(*) c FROM email_messages').get() as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) c FROM round_events').get() as any).c).toBe(1);
  });
});

describe('ingestParsedEmail — exact ml_round_id mapping', () => {
  it('round_starting → round_started event + rounds.round_started_at', () => {
    ingestParsedEmail(db, mkEmail({
      type: 'round_starting', mlRoundId: '12c30e07f33d4acd92ca489696788036', sentAt: '2026-05-09T07:00:00.000Z',
    }));
    const ev = db.prepare("SELECT * FROM round_events WHERE round_id=11 AND event_type='round_started'").get() as any;
    expect(ev.occurred_at).toBe('2026-05-09T07:00:00.000Z');
    expect((db.prepare('SELECT round_started_at FROM rounds WHERE id=11').get() as any).round_started_at)
      .toBe('2026-05-09T07:00:00.000Z');
  });

  it('votes_are_in → voting_ended event + rounds.voting_ended_at', () => {
    ingestParsedEmail(db, mkEmail({
      type: 'votes_are_in', mlRoundId: '1d4a94046a67405e9d855f5c0fd9136e', sentAt: '2026-06-09T07:00:00.000Z',
    }));
    expect((db.prepare("SELECT event_type FROM round_events WHERE round_id=12").get() as any).event_type)
      .toBe('voting_ended');
    expect((db.prepare('SELECT voting_ended_at FROM rounds WHERE id=12').get() as any).voting_ended_at)
      .toBe('2026-06-09T07:00:00.000Z');
  });
});

describe('ingestParsedEmail — new_playlist mapping by round name + league', () => {
  it('maps by name+league, sets voting_started + playlist on event and round', () => {
    ingestParsedEmail(db, mkEmail({
      type: 'new_playlist',
      roundName: 'Plots so thicc',
      leagueLabel: 'Hip Jammers 3: its all hippening',
      playlistUrl: 'https://open.spotify.com/playlist/02J0ICSMkywokNYRhFxWCp',
      sentAt: '2026-05-31T07:00:00.000Z',
    }));
    const ev = db.prepare("SELECT * FROM round_events WHERE round_id=10").get() as any;
    expect(ev.event_type).toBe('voting_started');
    expect(ev.playlist_url).toContain('02J0ICSMkywokNYRhFxWCp');
    const r = db.prepare('SELECT voting_started_at, spotify_playlist_url FROM rounds WHERE id=10').get() as any;
    expect(r.voting_started_at).toBe('2026-05-31T07:00:00.000Z');
    expect(r.spotify_playlist_url).toContain('02J0ICSMkywokNYRhFxWCp');
  });
});

describe('ingestParsedEmail — action_status / action_detail', () => {
  it('round_starting → recorded with round name', () => {
    const res = ingestParsedEmail(db, mkEmail({ type: 'round_starting', mlRoundId: '12c30e07f33d4acd92ca489696788036' }));
    expect(res.actionStatus).toBe('recorded');
    expect(res.actionDetail).toContain('round_started');
    expect(res.actionDetail).toContain("EDM 'em");
    const row = db.prepare("SELECT action_status, action_detail FROM email_messages WHERE round_id=11").get() as any;
    expect(row.action_status).toBe('recorded');
  });

  it('new_playlist mapped → recorded + "playlist captured"', () => {
    const res = ingestParsedEmail(db, mkEmail({
      type: 'new_playlist', roundName: 'Plots so thicc', leagueLabel: 'Hip Jammers 3',
      playlistUrl: 'https://open.spotify.com/playlist/abc',
    }));
    expect(res.actionStatus).toBe('recorded');
    expect(res.actionDetail).toContain('playlist captured');
  });

  it('new_playlist when the round already has a playlist → "playlist already set"', () => {
    db.prepare("UPDATE rounds SET spotify_playlist_url='https://open.spotify.com/playlist/old' WHERE id=10").run();
    const res = ingestParsedEmail(db, mkEmail({
      type: 'new_playlist', roundName: 'Plots so thicc', leagueLabel: 'Hip Jammers 3',
      playlistUrl: 'https://open.spotify.com/playlist/abc',
    }));
    expect(res.actionDetail).toContain('playlist already set');
  });

  it('new_playlist unmapped → "playlist NOT captured"', () => {
    const res = ingestParsedEmail(db, mkEmail({ type: 'new_playlist', roundName: 'No Such Round', leagueLabel: 'Hip Jammers 3' }));
    expect(res.actionStatus).toBe('unmapped');
    expect(res.actionDetail).toContain('NOT captured');
  });

  it('other → archived (no action)', () => {
    const res = ingestParsedEmail(db, mkEmail({ type: 'other' }));
    expect(res.actionStatus).toBe('archived');
  });
});

describe('recordIngestFailure', () => {
  it('writes an error row visible in the log', () => {
    recordIngestFailure(db, 'fail-1@x', { subject: 'broke', uid: 999 }, 'boom');
    const row = db.prepare("SELECT parsed_type, action_status, action_detail FROM email_messages WHERE message_id='fail-1@x'").get() as any;
    expect(row.parsed_type).toBe('error');
    expect(row.action_status).toBe('error');
    expect(row.action_detail).toContain('boom');
  });
});

describe('ingestParsedEmail — unmapped', () => {
  it('stores the email with round_id NULL and writes no event when the round is unknown', () => {
    ingestParsedEmail(db, mkEmail({ messageId: 'u@x', type: 'round_starting', mlRoundId: 'ffffffffffffffffffffffffffffffff' }));
    expect((db.prepare("SELECT round_id FROM email_messages WHERE message_id='u@x'").get() as any).round_id).toBeNull();
    expect((db.prepare('SELECT COUNT(*) c FROM round_events').get() as any).c).toBe(0);
  });
});
