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
function player(name: string, mlCompetitorId?: string): number {
  return (db.prepare('INSERT INTO players (name, ml_competitor_id) VALUES (?, ?) RETURNING id').get(name, mlCompetitorId ?? null) as { id: number }).id;
}
function linkCompetitorToPlayer(competitorId: number, playerId: number): void {
  db.prepare('UPDATE competitors SET player_id = ? WHERE id = ?').run(playerId, competitorId);
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

// ── Unlinked competitors (backward compat) ──────────────────────────────────

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

// ── Player-linked competitors ───────────────────────────────────────────────

it('shows players.name when competitor is linked to a player', () => {
  const comp = competitor('ml-1', 'mlhandle');
  const p = player('Real Name', 'ml-1');
  linkCompetitorToPlayer(comp, p);
  const r = round(1, 'R1');
  submit(r, comp, 'u:a', 'A', 'X');

  const roster = getPlayers(db);
  expect(roster).toHaveLength(1);
  expect(roster[0].name).toBe('Real Name');
});

it('getPlayer looks up by players.name when competitor is linked', () => {
  const comp = competitor('ml-1', 'mlhandle');
  const p = player('Real Name', 'ml-1');
  linkCompetitorToPlayer(comp, p);
  const r = round(1, 'R1');
  submit(r, comp, 'u:a', 'A', 'Artist');

  const detail = getPlayer(db, 'Real Name');
  expect(detail.songs).toHaveLength(1);
  expect(detail.songs[0].title).toBe('A');
});

it('history survives a player rename (looked up by new name)', () => {
  const comp = competitor('ml-1', 'mlhandle');
  const p = player('Old Name');
  linkCompetitorToPlayer(comp, p);
  const r = round(1, 'R1');
  submit(r, comp, 'u:a', 'A', 'Artist');

  // "Rename" the player
  db.prepare('UPDATE players SET name = ? WHERE id = ?').run('New Name', p);

  // Old name falls back to competitors.name match (still works for compat)
  // New name resolves via players table
  const detail = getPlayer(db, 'New Name');
  expect(detail.songs).toHaveLength(1);
  expect(detail.songs[0].title).toBe('A');

  // Roster shows new name
  const roster = getPlayers(db);
  expect(roster[0].name).toBe('New Name');
});

it('cross-league: two competitors linked to same player show as one record', () => {
  // Simulate two leagues: competitor 'alias1' and 'alias2' both → player 'Unified'
  const comp1 = competitor('ml-1', 'alias1');
  const comp2 = competitor('ml-2', 'alias2');
  const p = player('Unified');
  linkCompetitorToPlayer(comp1, p);
  linkCompetitorToPlayer(comp2, p);

  const r1 = round(1, 'League1Round');
  const r2 = round(2, 'League2Round');
  submit(r1, comp1, 'u:a', 'Song A', 'Artist');
  submit(r2, comp2, 'u:b', 'Song B', 'Artist');

  const roster = getPlayers(db);
  // Should appear as one entry, not two
  const unified = roster.filter((p) => p.name === 'Unified');
  expect(unified).toHaveLength(1);
  expect(unified[0].songsSubmitted).toBe(2);

  const detail = getPlayer(db, 'Unified');
  expect(detail.songs).toHaveLength(2);
  const titles = detail.songs.map((s) => s.title).sort();
  expect(titles).toEqual(['Song A', 'Song B']);
});

it('taste overlap keys use players.name for linked competitors', () => {
  const me = competitor('ml-me', 'me_handle');
  const them = competitor('ml-them', 'them_handle');
  const pMe = player('Me Real');
  const pThem = player('Them Real');
  linkCompetitorToPlayer(me, pMe);
  linkCompetitorToPlayer(them, pThem);

  const r = round(1, 'R');
  submit(r, me, 'u:a', 'A', 'X');
  submit(r, them, 'u:b', 'B', 'Y');
  // Both vote on the same song → creates non-zero overlap
  vote(r, me, 'u:a', 5);
  vote(r, them, 'u:a', 5);

  const detail = getPlayer(db, 'Me Real');
  expect('Them Real' in detail.tasteOverlap).toBe(true);
  expect('them_handle' in detail.tasteOverlap).toBe(false);
});
