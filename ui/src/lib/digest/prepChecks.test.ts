import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { runPrepChecks } from './prepChecks.js';

const CHAT_MSGS_DDL = `
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    group_name TEXT NOT NULL,
    group_key TEXT,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    ts TEXT NOT NULL,
    msg_hash TEXT
  );
`;

/** Minimal base seed: one league/season/round, one competitor, chat_messages DDL. */
function seedBase(db: Database.Database) {
  db.exec(CHAT_MSGS_DDL);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test-league', 'Test League')`).run();
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, description, created_at)
     VALUES (1, 1, 'r1', 'Round 1', 'A fun round', '2026-06-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO competitors (id, ml_competitor_id, name) VALUES (1, 'c1', 'Alice')`,
  ).run();
}

function insertSubmission(db: Database.Database, roundId: number, uri: string) {
  db.prepare(
    `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
     VALUES (?, 1, ?, 'Title', 'Artist', '2026-06-01T00:00:00Z')`,
  ).run(roundId, uri);
}

function insertProxy(db: Database.Database, uri: string, proxy: number | null) {
  db.prepare(
    `INSERT OR REPLACE INTO song_popularity
       (spotify_uri, artist, title, listeners, playcount, popularity_proxy, fetched_at)
     VALUES (?, 'x', 'y', 0, 0, ?, '2026-06-01T00:00:00Z')`,
  ).run(uri, proxy);
}

let db: Database.Database;
beforeEach(() => {
  db = openLeagueDb(':memory:');
});

// ---------------------------------------------------------------------------
// Tastemaker coverage
// ---------------------------------------------------------------------------

describe('Tastemaker check reflects popularity_proxy coverage, not row existence', () => {
  it('returns ok=false when fewer than 80% of cumulative-season submissions are proxied (7/10)', () => {
    seedBase(db);
    // 10 submissions, 7 have non-null popularity_proxy (7/10 = 0.7 < 0.8)
    for (let i = 1; i <= 10; i++) {
      insertSubmission(db, 1, `spotify:track:s${i}`);
    }
    for (let i = 1; i <= 7; i++) {
      insertProxy(db, `spotify:track:s${i}`, 50);
    }
    // s8, s9, s10: no song_popularity row → LEFT JOIN → null proxy

    const checks = runPrepChecks(db, 1);
    const tm = checks.find((c) => c.name === 'Tastemaker leaderboard')!;
    expect(tm).toBeDefined();
    expect(tm.ok).toBe(false);
    expect(tm.count).toBe(7);
    expect(tm.src).toBe('song_popularity · 7/10 proxied');
    expect(tm.optional).toBe(true);
  });

  it('returns ok=true when exactly 80% of cumulative-season submissions are proxied (8/10)', () => {
    seedBase(db);
    // 10 submissions, 8 have non-null popularity_proxy (8/10 = 0.8 >= 0.8)
    for (let i = 1; i <= 10; i++) {
      insertSubmission(db, 1, `spotify:track:s${i}`);
    }
    for (let i = 1; i <= 8; i++) {
      insertProxy(db, `spotify:track:s${i}`, 50);
    }

    const checks = runPrepChecks(db, 1);
    const tm = checks.find((c) => c.name === 'Tastemaker leaderboard')!;
    expect(tm).toBeDefined();
    expect(tm.ok).toBe(true);
    expect(tm.count).toBe(8);
    expect(tm.src).toBe('song_popularity · 8/10 proxied');
    expect(tm.optional).toBe(true);
  });

  it('is cumulative: counts proxied submissions from earlier rounds in the same season too', () => {
    seedBase(db);
    // Add round 2 — it is the target for runPrepChecks
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, description, created_at)
       VALUES (2, 1, 'r2', 'Round 2', 'Second round', '2026-06-08T00:00:00Z')`,
    ).run();

    // r1: 5 submissions all proxied; r2: 5 submissions none proxied → 5/10 < 0.8
    for (let i = 1; i <= 5; i++) {
      insertSubmission(db, 1, `spotify:track:r1s${i}`);
      insertProxy(db, `spotify:track:r1s${i}`, 50);
    }
    for (let i = 1; i <= 5; i++) {
      insertSubmission(db, 2, `spotify:track:r2s${i}`);
      // no proxy rows for r2 songs
    }

    const checks = runPrepChecks(db, 2);
    const tm = checks.find((c) => c.name === 'Tastemaker leaderboard')!;
    expect(tm.ok).toBe(false); // 5/10 = 0.5 < 0.8
    expect(tm.count).toBe(5);
    expect(tm.src).toBe('song_popularity · 5/10 proxied');
  });
});

// ---------------------------------------------------------------------------
// Chat availability row
// ---------------------------------------------------------------------------

describe('Chat check reflects mapped group + in-window message count', () => {
  it('returns ok=true with correct count when league is mapped and messages exist in window', () => {
    seedBase(db);
    // Second round defines the upper boundary of the chat window
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
       VALUES (2, 1, 'r2', 'Round 2', '2026-06-08T00:00:00Z')`,
    ).run();

    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('chat_league_group_map', '{"test-league":"TestGroup"}')`,
    ).run();

    // 3 in-window messages (between 2026-06-01 and 2026-06-08)
    for (let i = 1; i <= 3; i++) {
      db.prepare(
        `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
         VALUES (?, 'whatsapp', 'TestGroup', 'Alice', ?, ?)`,
      ).run(`m${i}`, `msg ${i}`, `2026-06-0${i + 1}T10:00:00Z`);
    }
    // 1 out-of-window message (after round 2 start)
    db.prepare(
      `INSERT INTO chat_messages (id, platform, group_name, sender, text, ts)
       VALUES ('m4', 'whatsapp', 'TestGroup', 'Dave', 'after window', '2026-06-09T10:00:00Z')`,
    ).run();

    const checks = runPrepChecks(db, 1);
    const chat = checks.find((c) => c.name === 'Chat')!;
    expect(chat).toBeDefined();
    expect(chat.ok).toBe(true);
    expect(chat.count).toBe(3);
    expect(chat.src).toBe('chat_messages · TestGroup');
    expect(chat.optional).toBe(true);
  });

  it('returns ok=false with src showing "league unmapped" when no group mapping exists', () => {
    seedBase(db);
    // No chat_league_group_map setting → defaults to empty {}

    const checks = runPrepChecks(db, 1);
    const chat = checks.find((c) => c.name === 'Chat')!;
    expect(chat).toBeDefined();
    expect(chat.ok).toBe(false);
    expect(chat.count).toBe(0);
    expect(chat.src).toBe('chat_messages · league unmapped');
    expect(chat.optional).toBe(true);
  });

  it('returns ok=false with zero count when group is mapped but no in-window messages exist', () => {
    seedBase(db);
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('chat_league_group_map', '{"test-league":"TestGroup"}')`,
    ).run();
    // No messages inserted

    const checks = runPrepChecks(db, 1);
    const chat = checks.find((c) => c.name === 'Chat')!;
    expect(chat).toBeDefined();
    expect(chat.ok).toBe(false);
    expect(chat.count).toBe(0);
    expect(chat.src).toBe('chat_messages · TestGroup');
  });
});
