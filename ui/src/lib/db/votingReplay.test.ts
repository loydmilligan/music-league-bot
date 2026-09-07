import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getVotingReplay } from './votingReplay.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

function player(name: string): number {
  return (db.prepare('INSERT INTO players (name) VALUES (?) RETURNING id').get(name) as { id: number }).id;
}
function competitor(mlId: string, name: string, playerId: number | null = null): number {
  return (
    db
      .prepare('INSERT INTO competitors (ml_competitor_id, name, player_id) VALUES (?,?,?) RETURNING id')
      .get(mlId, name, playerId) as { id: number }
  ).id;
}
function newRound(mlRoundId = 'r-replay'): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId, name: 'Replay Round', description: 'A theme.',
    spotifyPlaylistUrl: '', createdAt: '2026-09-01T00:00:00Z',
  });
}
function submit(roundId: number, competitorId: number, uri: string, title: string, createdAt: string): void {
  db.prepare(
    `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, comment, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(roundId, competitorId, uri, title, 'An Artist', null, createdAt);
}
function vote(roundId: number, voterId: number, uri: string, pts: number, at: string, comment: string | null = null): void {
  db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at) VALUES (?,?,?,?,?,?)`,
  ).run(roundId, voterId, uri, pts, comment, at);
}

// One round: three songs, two voters. "monicac1217" is the Music League handle
// for the player Michael Black -- the payload must never print the handle.
let roundId: number;
beforeEach(() => {
  db = openLeagueDb(':memory:');
  const mb = player('Michael Black');
  const handle = competitor('monicac1217', 'monicac1217', mb);
  const early = competitor('early', 'Early Voter');
  const late = competitor('late', 'Late Voter');
  roundId = newRound();
  submit(roundId, handle, 'spotify:track:s1', 'Song One', '2026-09-02T02:00:00Z');
  submit(roundId, early, 'spotify:track:s2', 'Song Two', '2026-09-02T02:30:00Z');
  submit(roundId, late, 'spotify:track:s3', 'Song Three', '2026-09-02T02:56:25Z');
  // Early Voter files one atomic ballot with two rows a few seconds apart.
  vote(roundId, early, 'spotify:track:s1', 2, '2026-09-02T10:00:00Z');
  vote(roundId, early, 'spotify:track:s3', 1, '2026-09-02T10:00:05Z');
  // Late Voter scores one song and leaves a 0-point note on their own.
  vote(roundId, late, 'spotify:track:s2', 3, '2026-09-02T12:00:00Z');
  vote(roundId, late, 'spotify:track:s3', 0, '2026-09-02T12:00:02Z', 'my own song');
});

it('groups each voter into one ballot, ordered by cast time', () => {
  const payload = getVotingReplay(db, roundId)!;
  expect(payload.ballots.map((b) => b.voter)).toEqual(['Early Voter', 'Late Voter']);
  expect(payload.ballots[0].votes).toHaveLength(2);
  expect(payload.ballots[1].votes).toHaveLength(2);
});

it('prefers players.name over the music league handle', () => {
  const payload = getVotingReplay(db, roundId)!;
  expect(payload.songs[0].submitter).toBe('Michael Black');
});

it('keeps a 0-point submitter comment in the ballot', () => {
  const payload = getVotingReplay(db, roundId)!;
  const zero = payload.ballots.flatMap((b) => b.votes).find((v) => v.points === 0);
  expect(zero?.comment).toBe('my own song');
});

it('windowOpensAfter is the last submission time', () => {
  expect(getVotingReplay(db, roundId)!.round.windowOpensAfter).toBe('2026-09-02T02:56:25Z');
});

it('returns null for an unknown round', () => {
  expect(getVotingReplay(db, 999999)).toBeNull();
});

// Two competitor rows can resolve to the same display name -- one through a
// linked player, one through the raw competitor name. They are still two
// people filing two ballots, and keying the grouping on the name would silently
// fuse them into one, which intervals() would then slice into wrong deltas.
it('does not merge two voters who resolve to the same display name', () => {
  const sz = player('Sarah Black');
  const viaPlayer = competitor('dup-a', 'sarahb1', sz);
  const viaName = competitor('dup-b', 'Sarah Black');
  const r2 = newRound('r-replay-dup');
  submit(r2, viaPlayer, 'spotify:track:d1', 'Dup One', '2026-09-03T02:00:00Z');
  submit(r2, viaName, 'spotify:track:d2', 'Dup Two', '2026-09-03T02:10:00Z');
  vote(r2, viaPlayer, 'spotify:track:d2', 4, '2026-09-03T10:00:00Z');
  vote(r2, viaName, 'spotify:track:d1', 5, '2026-09-03T11:00:00Z');

  const payload = getVotingReplay(db, r2)!;
  expect(payload.ballots).toHaveLength(2);
  expect(payload.ballots.map((b) => b.voter)).toEqual(['Sarah Black', 'Sarah Black']);
  expect(payload.ballots.map((b) => b.votes.length)).toEqual([1, 1]);
});
