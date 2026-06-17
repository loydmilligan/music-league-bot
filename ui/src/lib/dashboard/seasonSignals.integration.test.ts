import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { computeSeasonSignalsForLeague } from './seasonSignals.js';

let db: Database.Database;
let leagueId: number, seasonId: number;

function comp(name: string): number {
  db.prepare("INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)").run(`ml-${name}`, name);
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}
function round(n: number): number {
  db.prepare("INSERT INTO rounds (season_id, ml_round_id, name, round_number, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(seasonId, `ml-r${n}`, `Round ${n}`, n, new Date().toISOString());
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}
function sub(roundId: number, competitorId: number, uri: string) {
  db.prepare("INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?,?,?,?,?,?)")
    .run(roundId, competitorId, uri, uri, 'Artist', new Date().toISOString());
}
function vote(roundId: number, voterId: number, uri: string, points: number) {
  db.prepare("INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?,?,?,?,?)")
    .run(roundId, voterId, uri, points, new Date().toISOString());
}

beforeEach(() => {
  db = openLeagueDb(':memory:');
  db.prepare("INSERT INTO leagues (slug, name, is_active) VALUES ('t','T',1)").run();
  leagueId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
  db.prepare("INSERT INTO seasons (league_id, season_number, status) VALUES (?,1,'active')").run(leagueId);
  seasonId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
});

it('produces movers + asOfRound from real DB data', () => {
  const a = comp('A'), b = comp('B');
  const r1 = round(1), r2 = round(2);
  // Round 1: A leads (9 vs 1). Round 2: B overtakes with 15 pts to A's 1 → B rank 1, clear mover.
  sub(r1, a, 'a1'); sub(r1, b, 'b1'); vote(r1, b, 'a1', 9); vote(r1, a, 'b1', 1);
  sub(r2, a, 'a2'); sub(r2, b, 'b2'); vote(r2, b, 'a2', 1); vote(r2, a, 'b2', 15);
  const sig = computeSeasonSignalsForLeague(db, leagueId);
  expect(sig.asOfRound?.roundNumber).toBe(2);
  expect(sig.bigMover || sig.faller).toBeTruthy();
});
