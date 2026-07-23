import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

function tableNames(): string[] {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.pragma('foreign_keys = OFF');
  const rows = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table'`,
  ).all() as { name: string }[];
  db.close();
  return rows.map((r) => r.name);
}

it('creates the three voting-lab tables', () => {
  const names = tableNames();
  expect(names).toContain('voting_lab_ballot');
  expect(names).toContain('voting_lab_budget');
  expect(names).toContain('season_vote_budget');
});

it('voting_lab_ballot is keyed by (round_id, spotify_uri)', () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.pragma('foreign_keys = OFF');
  db.prepare(
    `INSERT INTO voting_lab_ballot (round_id, spotify_uri, up_points, down_points, updated_at)
     VALUES (1, 'spotify:track:a', 2, 0, '2026-07-23T00:00:00Z')`,
  ).run();
  // Same key again must conflict (PK), proving the composite primary key exists.
  expect(() =>
    db.prepare(
      `INSERT INTO voting_lab_ballot (round_id, spotify_uri, up_points, down_points, updated_at)
       VALUES (1, 'spotify:track:a', 3, 0, '2026-07-23T00:00:00Z')`,
    ).run(),
  ).toThrow();
  db.close();
});
