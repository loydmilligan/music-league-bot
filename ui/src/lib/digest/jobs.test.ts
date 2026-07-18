import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { enqueueJob, claimNextJob, transitionJob, failJob, getJob } from './jobs.js';

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
