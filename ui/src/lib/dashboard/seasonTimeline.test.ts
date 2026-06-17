import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { buildSeasonTimeline } from './seasonTimeline.js';

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

it('returns scored rounds in round_number order with per-round standings', () => {
  const a = comp('A'), b = comp('B');
  const r1 = round(1), r2 = round(2);
  sub(r1, a, 'a1'); sub(r1, b, 'b1'); vote(r1, b, 'a1', 5); vote(r1, a, 'b1', 1);
  sub(r2, a, 'a2'); sub(r2, b, 'b2'); vote(r2, b, 'a2', 1); vote(r2, a, 'b2', 5);

  const t = buildSeasonTimeline(db, leagueId);
  expect(t.rounds.map(r => r.roundNumber)).toEqual([1, 2]);
  expect(t.standingsByRound).toHaveLength(2);
  // round 1: A leads (5 vs 1)
  expect(t.standingsByRound[0].standings[0].name).toBe('A');
  // round 2 cumulative: A=6, B=6 — tie, both present
  const r2names = t.standingsByRound[1].standings.map(s => s.name).sort();
  expect(r2names).toEqual(['A', 'B']);
});

it('captures vote pairs linking voter -> submitter with points', () => {
  const a = comp('A'), b = comp('B');
  const r1 = round(1);
  sub(r1, a, 'a1'); sub(r1, b, 'b1');
  vote(r1, b, 'a1', -1);  // B downvoted A's song
  const t = buildSeasonTimeline(db, leagueId);
  const pair = t.votePairs.find(p => p.voterName === 'B' && p.targetName === 'A');
  expect(pair).toBeTruthy();
  expect(pair!.points).toBe(-1);
  expect(pair!.roundNumber).toBe(1);
});
