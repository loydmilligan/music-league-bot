import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ensureEmailSchema, ingestParsedEmail } from '../src/email/emailIngest.js';
import { classifySubject } from '../src/email/emailParser.js';
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
    INSERT INTO leagues (id, slug, name) VALUES (5, 'boarz-ii-men', 'Boarz II Men');
    INSERT INTO seasons (id, league_id, season_number) VALUES (10, 5, 1);
    INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES
      (150, 10, 'a'||hex(randomblob(15)), 'Couple of Lines', '2026-09-02T00:00:00Z');
  `);
  ensureEmailSchema(db);
  return db;
}

function mkSubmitted(over: Partial<ParsedEmail>): ParsedEmail {
  return {
    messageId: `m-${Math.round(Math.random() * 1e9)}@x`,
    subject: 'Boarz II Men - User Submitted',
    fromAddr: 'notifications@musicleague.com',
    toAddr: 'mattmariani@gmail.com',
    sentAt: '2026-09-06T01:24:14.000Z',
    type: 'user_submitted',
    mlRoundId: null,
    submitterName: 'Steiny',
    leagueLabel: 'Boarz II Men',
    roundName: 'Couple of Lines',
    playlistUrl: null,
    ...over,
  };
}

describe('user_submitted classification', () => {
  it('classifies the subject', () => {
    expect(classifySubject('Boarz II Men - User Submitted')).toBe('user_submitted');
  });
  it('does not swallow the other lifecycle types', () => {
    expect(classifySubject('Boarz II Men - New Playlist')).toBe('new_playlist');
    expect(classifySubject('Boarz II Men - Round Starting')).toBe('round_starting');
  });
});

describe('submission_events', () => {
  it('records one row per email, so repeats survive as pick changes', () => {
    const db = seedDb();
    // Steiny submitted four times in three minutes on 2026-09-06 — the exact
    // churn this table exists to capture. Distinct message ids, same person.
    for (const ts of ['01:24:14', '01:24:32', '01:25:38', '01:26:27']) {
      ingestParsedEmail(db, mkSubmitted({ sentAt: `2026-09-06T${ts}.000Z` }));
    }
    ingestParsedEmail(db, mkSubmitted({ submitterName: 'Grant Koziol' }));

    const rows = db
      .prepare(`SELECT submitter_name, COUNT(*) n FROM submission_events GROUP BY 1 ORDER BY n DESC`)
      .all() as { submitter_name: string; n: number }[];
    expect(rows).toEqual([
      { submitter_name: 'Steiny', n: 4 },
      { submitter_name: 'Grant Koziol', n: 1 },
    ]);
    // Resolved to the round, so churn can be queried per round.
    expect(
      (db.prepare(`SELECT COUNT(*) n FROM submission_events WHERE round_id = 150`).get() as { n: number }).n,
    ).toBe(5);
  });

  it('is idempotent on message_id, so a backfill replay adds nothing', () => {
    const db = seedDb();
    const email = mkSubmitted({});
    ingestParsedEmail(db, email);
    ingestParsedEmail(db, email);
    expect((db.prepare(`SELECT COUNT(*) n FROM submission_events`).get() as { n: number }).n).toBe(1);
  });

  it('does not write a row for the other email types', () => {
    const db = seedDb();
    ingestParsedEmail(db, mkSubmitted({ type: 'new_playlist', submitterName: null }));
    expect((db.prepare(`SELECT COUNT(*) n FROM submission_events`).get() as { n: number }).n).toBe(0);
  });
});
