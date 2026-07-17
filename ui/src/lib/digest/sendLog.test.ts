import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { claimSend, releaseClaim, markSent, markFailed, hasBeenSent } from './sendLog.js';

const NOW = '2026-07-17T09:00:00Z';
const TARGET = '120363406254406895@g.us';
const URL = 'https://digest.mattmariani.com/d/abc123';

let db: Database.Database;
beforeEach(() => {
  db = openLeagueDb(':memory:');
  // digest_sends carries real FKs to leagues/rounds, so the rows must exist.
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test-league', 'Test League')`).run();
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`,
  ).run();
  for (const id of [1, 2]) {
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
       VALUES (?, 1, ?, ?, '2026-06-01T00:00:00Z')`,
    ).run(id, `r${id}`, `Round ${id}`);
  }
});

describe('claiming', () => {
  it('claims an unclaimed round', () => {
    expect(claimSend(db, 1, 1, NOW)).toBe(true);
  });

  it('refuses a second claim on the same round', () => {
    claimSend(db, 1, 1, NOW);
    expect(claimSend(db, 1, 1, NOW)).toBe(false);
  });

  it('claims different rounds independently', () => {
    expect(claimSend(db, 1, 1, NOW)).toBe(true);
    expect(claimSend(db, 2, 1, NOW)).toBe(true);
  });
});

describe('hasBeenSent', () => {
  it('is false for an untouched round', () => {
    expect(hasBeenSent(db, 1)).toBe(false);
  });

  it('is false for a round that is only claimed — a claim is not a send', () => {
    claimSend(db, 1, 1, NOW);
    expect(hasBeenSent(db, 1)).toBe(false);
  });

  it('is true once the send is recorded', () => {
    claimSend(db, 1, 1, NOW);
    markSent(db, 1, { sentAt: NOW, target: TARGET, url: URL });
    expect(hasBeenSent(db, 1)).toBe(true);
  });
});

describe('a failed send stays claimed', () => {
  it('does not release the claim on failure — a retry could duplicate a real message', () => {
    claimSend(db, 1, 1, NOW);
    markFailed(db, 1, 'sendMessage timed out');

    expect(claimSend(db, 1, 1, NOW)).toBe(false);
  });

  it('does not count a failed send as sent', () => {
    claimSend(db, 1, 1, NOW);
    markFailed(db, 1, 'sendMessage timed out');

    expect(hasBeenSent(db, 1)).toBe(false);
  });

  it('records the error for a human to find', () => {
    claimSend(db, 1, 1, NOW);
    markFailed(db, 1, 'sendMessage timed out');

    const row = db.prepare('SELECT error FROM digest_sends WHERE round_id = 1').get() as {
      error: string;
    };
    expect(row.error).toMatch(/timed out/);
  });
});

describe('releasing a pre-send failure', () => {
  it('allows a re-claim after an explicit release', () => {
    // Export failed before anything was sent — retrying is safe.
    claimSend(db, 1, 1, NOW);
    releaseClaim(db, 1);

    expect(claimSend(db, 1, 1, NOW)).toBe(true);
  });

  it('refuses to release a round that was already sent', () => {
    claimSend(db, 1, 1, NOW);
    markSent(db, 1, { sentAt: NOW, target: TARGET, url: URL });
    releaseClaim(db, 1);

    expect(hasBeenSent(db, 1)).toBe(true);
    expect(claimSend(db, 1, 1, NOW)).toBe(false);
  });
});

describe('the send record', () => {
  it('keeps the target and url that went out', () => {
    claimSend(db, 1, 1, NOW);
    markSent(db, 1, { sentAt: NOW, target: TARGET, url: URL });

    const row = db.prepare('SELECT target, url, sent_at FROM digest_sends WHERE round_id = 1').get() as {
      target: string;
      url: string;
      sent_at: string;
    };
    expect(row).toMatchObject({ target: TARGET, url: URL, sent_at: NOW });
  });
});
