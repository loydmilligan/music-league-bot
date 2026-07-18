import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { structuralReviewReason } from './structuralReview.js';

// Minimal schema slice this helper touches.
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, description TEXT, submission_deadline TEXT, voting_deadline TEXT);
    CREATE TABLE ml_submissions (round_id INTEGER);
    CREATE TABLE votes (round_id INTEGER);
  `);
  db.prepare('INSERT INTO leagues (id, name) VALUES (1, ?)').run('Test League');
  db.prepare('INSERT INTO seasons (id, league_id, season_number) VALUES (1, 1, 1)').run();
  return db;
}

// A clean, sendable round needs: a successor round, >=1 submission, >=1 vote, a description.
function seedRound(db: Database.Database, id: number, description: string | null, subs: number, votes: number) {
  db.prepare('INSERT INTO rounds (id, season_id, description) VALUES (?, 1, ?)').run(id, description);
  for (let i = 0; i < subs; i++) db.prepare('INSERT INTO ml_submissions (round_id) VALUES (?)').run(id);
  for (let i = 0; i < votes; i++) db.prepare('INSERT INTO votes (round_id) VALUES (?)').run(id);
}

const NOW = '2026-07-17T00:00:00Z';

describe('structuralReviewReason', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });

  it('returns null for a clean, sendable round (has a successor)', () => {
    seedRound(db, 10, 'Songs about rain', 3, 5);
    seedRound(db, 11, 'Next theme', 3, 5); // successor → round 10 is not season-final
    expect(structuralReviewReason(db, 10, NOW)).toBeNull();
  });

  it('flags a season-final round (no successor)', () => {
    seedRound(db, 10, 'Finale', 3, 5); // no round 11 → season-final
    expect(structuralReviewReason(db, 10, NOW)).toMatch(/season-final/i);
  });

  it('flags a round with no submissions', () => {
    seedRound(db, 10, 'Theme', 0, 0);
    seedRound(db, 11, 'Next', 3, 5);
    expect(structuralReviewReason(db, 10, NOW)).toMatch(/submission/i);
  });

  it('flags a round with submissions but no votes', () => {
    seedRound(db, 10, 'Theme', 3, 0);
    seedRound(db, 11, 'Next', 3, 5);
    expect(structuralReviewReason(db, 10, NOW)).toMatch(/vote/i);
  });

  it('flags a round with no theme description', () => {
    seedRound(db, 10, '   ', 3, 5);
    seedRound(db, 11, 'Next', 3, 5);
    expect(structuralReviewReason(db, 10, NOW)).toMatch(/description|theme/i);
  });
});
