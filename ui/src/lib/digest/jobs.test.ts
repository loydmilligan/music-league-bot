import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { enqueueJob, claimNextJob, transitionJob, failJob, getJob, failOrRetry, requeueJob } from './jobs.js';

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

const NOW = '2026-07-17T09:00:00Z';
function seed(db: Database.Database) {
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1,'l','L')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (1,1,1,'active')`).run();
  db.prepare(`INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (7,1,'r7','R7','${NOW}')`).run();
}

describe('job queue', () => {
  it('enqueues a job once and refuses a duplicate', () => {
    seed(db);
    expect(enqueueJob(db, 7, 1, NOW)).toBe(true);
    expect(enqueueJob(db, 7, 1, NOW)).toBe(false);
  });
  it('claims the pending job and moves it to capturing', () => {
    seed(db); enqueueJob(db, 7, 1, NOW);
    const claimed = claimNextJob(db, NOW);
    expect(claimed).toMatchObject({ roundId: 7, leagueId: 1 });
    expect(getJob(db, 7)?.status).toBe('capturing');
  });
  it('a second claim finds nothing once the only job is claimed', () => {
    seed(db); enqueueJob(db, 7, 1, NOW); claimNextJob(db, NOW);
    expect(claimNextJob(db, NOW)).toBeNull();
  });
  it('transitions and fails', () => {
    seed(db); enqueueJob(db, 7, 1, NOW); claimNextJob(db, NOW);
    transitionJob(db, 7, 'generating', NOW);
    expect(getJob(db, 7)?.status).toBe('generating');
    failJob(db, 7, 'boom', NOW);
    expect(getJob(db, 7)).toMatchObject({ status: 'failed', error: 'boom' });
  });
});

function seedJob(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE digest_jobs (
    round_id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, status TEXT NOT NULL,
    gen_params TEXT, error TEXT, approval_token TEXT, decision TEXT, decided_at TEXT,
    review_url TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );`);
  db.prepare(`INSERT INTO digest_jobs (round_id, league_id, status, attempts, created_at, updated_at)
              VALUES (7, 1, 'capturing', 0, 'NOW', 'NOW')`).run();
  return db;
}

describe('failOrRetry', () => {
  it('retries (status pending, attempts incremented) below the cap', () => {
    const db = seedJob(); // helper that inserts a job at round_id=7, status 'capturing', attempts 0
    expect(failOrRetry(db, 7, 'boom', 'NOW', 3)).toBe('retry');
    const row = db.prepare('SELECT status, attempts FROM digest_jobs WHERE round_id=7').get() as { status: string; attempts: number };
    expect(row.status).toBe('pending'); expect(row.attempts).toBe(1);
  });
  it('fails terminally at the cap', () => {
    const db = seedJob();
    failOrRetry(db, 7, 'boom', 'NOW', 2); // attempts→1, retry
    expect(failOrRetry(db, 7, 'boom', 'NOW', 2)).toBe('failed'); // attempts→2, cap
    const row = db.prepare('SELECT status, attempts FROM digest_jobs WHERE round_id=7').get() as { status: string; attempts: number };
    expect(row.status).toBe('failed'); expect(row.attempts).toBe(2);
  });
});

describe('requeueJob', () => {
  it('resets a failed job to pending with attempts 0', () => {
    const db = seedJob();
    db.prepare("UPDATE digest_jobs SET status='failed', attempts=3, error='x' WHERE round_id=7").run();
    requeueJob(db, 7, 'NOW');
    const row = db.prepare('SELECT status, attempts, error FROM digest_jobs WHERE round_id=7').get() as { status: string; attempts: number; error: string | null };
    expect(row).toMatchObject({ status: 'pending', attempts: 0, error: null });
  });
});
