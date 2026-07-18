import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { enqueueDigestJob } from '../src/email/digestJobs.js';
import { ensureEmailSchema, ingestParsedEmail } from '../src/email/emailIngest.js';
import type { ParsedEmail } from '../src/email/emailParser.js';

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
          CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER, status TEXT);
          CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, ml_round_id TEXT, name TEXT, created_at TEXT);`);
  d.prepare(`INSERT INTO leagues VALUES (1,'l','L')`).run();
  return d;
}

describe('enqueueDigestJob', () => {
  it('creates the table if missing and enqueues once', () => {
    const d = db();
    enqueueDigestJob(d, 7, 1, '2026-07-17T09:00:00Z');
    const row = d.prepare(`SELECT status FROM digest_jobs WHERE round_id=7`).get() as { status: string };
    expect(row.status).toBe('pending');
  });
  it('is idempotent — a re-ingested email does not duplicate', () => {
    const d = db();
    enqueueDigestJob(d, 7, 1, '2026-07-17T09:00:00Z');
    enqueueDigestJob(d, 7, 1, '2026-07-17T10:00:00Z');
    const n = (d.prepare(`SELECT COUNT(*) AS n FROM digest_jobs WHERE round_id=7`).get() as { n: number }).n;
    expect(n).toBe(1);
  });
});

describe('emailIngest wiring — voting_ended enqueues a digest job', () => {
  function seedDb(): Database.Database {
    const d = new Database(':memory:');
    d.exec(`
      CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
      CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
      CREATE TABLE rounds (
        id INTEGER PRIMARY KEY, season_id INTEGER, ml_round_id TEXT UNIQUE,
        name TEXT, created_at TEXT, spotify_playlist_url TEXT
      );
      INSERT INTO leagues (id, slug, name) VALUES (1, 'hip-jammers', 'Hip Jammers');
      INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 3);
      INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES
        (12, 1, '1d4a94046a67405e9d855f5c0fd9136e', 'Pick Me Up', '2026-06-23T00:00:00Z');
    `);
    ensureEmailSchema(d);
    return d;
  }

  function mkEmail(over: Partial<ParsedEmail>): ParsedEmail {
    return {
      messageId: `m-${Math.round(Math.random() * 1e9)}@x`,
      subject: 's',
      fromAddr: 'notifications@musicleague.com',
      toAddr: 'mattmariani@gmail.com',
      sentAt: '2026-06-09T07:00:00.000Z',
      type: 'other',
      mlRoundId: null,
      leagueLabel: null,
      roundName: null,
      playlistUrl: null,
      ...over,
    };
  }

  it('ingesting a votes_are_in email produces a digest_jobs row for that round/league', () => {
    const d = seedDb();
    ingestParsedEmail(d, mkEmail({
      type: 'votes_are_in', mlRoundId: '1d4a94046a67405e9d855f5c0fd9136e', sentAt: '2026-06-09T07:00:00.000Z',
    }));
    const row = d.prepare(`SELECT round_id, league_id, status FROM digest_jobs WHERE round_id=12`).get() as
      | { round_id: number; league_id: number; status: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.league_id).toBe(1);
    expect(row!.status).toBe('pending');
  });

  it('re-ingesting the same votes_are_in email does not duplicate the digest job', () => {
    const d = seedDb();
    const e = mkEmail({
      messageId: 'dup@x', type: 'votes_are_in', mlRoundId: '1d4a94046a67405e9d855f5c0fd9136e',
      sentAt: '2026-06-09T07:00:00.000Z',
    });
    ingestParsedEmail(d, e);
    ingestParsedEmail(d, e);
    const n = (d.prepare(`SELECT COUNT(*) AS n FROM digest_jobs WHERE round_id=12`).get() as { n: number }).n;
    expect(n).toBe(1);
  });
});
