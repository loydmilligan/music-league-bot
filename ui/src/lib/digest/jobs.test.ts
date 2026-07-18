import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

describe('digest_jobs schema', () => {
  it('exists after the league schema is applied', () => {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='digest_jobs'`,
    ).get();
    expect(row).toBeTruthy();
  });
});
