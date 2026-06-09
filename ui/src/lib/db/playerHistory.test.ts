import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getPlayers, getPlayer } from './playerHistory.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

function competitor(mlId: string, name: string): number {
  return (db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?) RETURNING id').get(mlId, name) as { id: number }).id;
}
function round(season: number, label: string): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, season, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId: `r-${season}-${label}`, name: label, description: '',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
}
function submit(roundId: number, competitorId: number, uri: string, title: string, artists: string): void {
  db.prepare(`INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
    VALUES (?,?,?,?,?,?)`).run(roundId, competitorId, uri, title, artists, new Date().toISOString());
}
function vote(roundId: number, voterId: number, uri: string, pts: number): void {
  db.prepare(`INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at)
    VALUES (?,?,?,?,?)`).run(roundId, voterId, uri, pts, new Date().toISOString());
}

beforeEach(() => { db = openLeagueDb(':memory:'); });

it('returns an empty roster with no submissions', () => {
  expect(getPlayers(db)).toEqual([]);
});

it('summarizes songsSubmitted and winRate per player', () => {
  const me = competitor('me', 'Me');
  const them = competitor('them', 'Them');
  const r1 = round(1, 'R1');
  const r2 = round(1, 'R2');
  // R1: Me wins (9 vs 2)
  submit(r1, me, 'u:a', 'A', 'X'); vote(r1, them, 'u:a', 9);
  submit(r1, them, 'u:b', 'B', 'Y'); vote(r1, me, 'u:b', 2);
  // R2: Them wins (5 vs 1); Me submits again
  submit(r2, me, 'u:c', 'C', 'X'); vote(r2, them, 'u:c', 1);
  submit(r2, them, 'u:d', 'D', 'Y'); vote(r2, me, 'u:d', 5);

  const players = getPlayers(db);
  const me_ = players.find((p) => p.name === 'Me')!;
  const them_ = players.find((p) => p.name === 'Them')!;
  expect(me_.songsSubmitted).toBe(2);
  expect(me_.winRate).toBe(0.5); // won 1 of 2
  expect(them_.winRate).toBe(0.5);
});

it('returns a player detail with songs, winRate and tasteOverlap', () => {
  const me = competitor('me', 'Me');
  const them = competitor('them', 'Them');
  const r = round(1, 'Weatherbug');
  submit(r, me, 'u:rain', 'Rain', 'Beatles'); vote(r, them, 'u:rain', 4);
  submit(r, them, 'u:sun', 'Sun', 'Beck'); vote(r, me, 'u:sun', 6);
  // both vote points on a shared song → overlap
  vote(r, me, 'u:rain', 0); // 0 points doesn't count toward taste
  const r2 = round(1, 'Shared');
  submit(r2, me, 'u:shared', 'S', 'Z');
  vote(r2, me, 'u:shared', 3); vote(r2, them, 'u:shared', 3);

  const detail = getPlayer(db, 'Me');
  expect(detail.songs).toEqual([
    { round: 'Weatherbug', title: 'Rain', artist: 'Beatles', points: 4 },
    { round: 'Shared', title: 'S', artist: 'Z', points: 6 }, // 3 (me) + 3 (them)
  ]);
  expect(detail.winRate).toBe(0.5); // Sun (6) beats Rain (4) in R1; S (6) wins R2 → 1 of 2
  // Me voted {u:sun, u:shared}; Them voted {u:rain, u:shared}; overlap = 1/3
  expect(detail.tasteOverlap.Them).toBeCloseTo(0.333, 2);
});

it('omits zero-overlap players from tasteOverlap', () => {
  const me = competitor('me', 'Me');
  const them = competitor('them', 'Them');
  const r = round(1, 'R');
  submit(r, me, 'u:a', 'A', 'X'); submit(r, them, 'u:b', 'B', 'Y');
  vote(r, me, 'u:a', 5); vote(r, them, 'u:b', 5); // disjoint vote sets
  expect(getPlayer(db, 'Me').tasteOverlap).toEqual({});
});
