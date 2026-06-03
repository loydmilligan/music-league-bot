import { it, expect, beforeEach, describe } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getRoundStats } from './roundStats.js';
import { getNextRound } from './nextRound.js';
import { getDiscoverability } from './discoverability.js';

// Season with 2 rounds. Round 1 song points: s1=5 (A), s2=3 (B), s3=1 (C).
function seed(db: Database.Database) {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  const r1 = upsertRound(db, seasonId, { mlRoundId: 'r1', name: 'Round One', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  const r2 = upsertRound(db, seasonId, { mlRoundId: 'r2', name: 'Round Two', description: '', spotifyPlaylistUrl: '', createdAt: '2026-02-01T00:00:00Z' });
  db.prepare('UPDATE rounds SET submission_deadline=? WHERE id=?').run('2026-02-10T00:00:00Z', r2);

  const ids: Record<string, number> = {};
  const c = db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)');
  for (const n of ['A', 'B', 'C']) ids[n] = Number(c.run(`c-${n}`, n).lastInsertRowid);

  const sub = db.prepare('INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?,?,?,?,?,?)');
  const vote = db.prepare('INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?,?,?,?,?)');
  const now = '2026-01-01T00:00:00Z';
  sub.run(r1, ids.A, 'uri:s1', 's1', 'Artist One', now);
  sub.run(r1, ids.B, 'uri:s2', 's2', 'Artist Two, Feat Guy', now); // multi-artist → first only
  sub.run(r1, ids.C, 'uri:s3', 's3', 'Artist One', now);           // same first artist as s1
  vote.run(r1, ids.B, 'uri:s1', 3, now);
  vote.run(r1, ids.C, 'uri:s1', 2, now);
  vote.run(r1, ids.A, 'uri:s2', 2, now);
  vote.run(r1, ids.C, 'uri:s2', 1, now);
  vote.run(r1, ids.A, 'uri:s3', 1, now);
  // r2: one submission so far
  sub.run(r2, ids.A, 'uri:s4', 's4', 'Artist Three', now);
  return { seasonId, r1, r2, ids };
}

function pop(db: Database.Database, uri: string, listeners: number, playcount: number, proxy: number) {
  db.prepare('INSERT INTO song_popularity (spotify_uri, artist, title, listeners, playcount, popularity_proxy, fetched_at) VALUES (?,?,?,?,?,?,?)')
    .run(uri, 'x', 'y', listeners, playcount, proxy, '2026-01-01T00:00:00Z');
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

describe('getRoundStats', () => {
  it('computes the five stat tiles', () => {
    const { r1 } = seed(db);
    const s = getRoundStats(db, r1);
    expect(s.totalVotes).toBe(5);       // 5 vote rows
    expect(s.submitters).toBe(3);
    expect(s.blowoutMargin).toBe(2);    // 5 - 3
    expect(s.closestRace).toBe(2);      // min(5-3, 3-1)
    expect(s.uniqueArtists).toBe(2);    // "Artist One" (s1,s3) + "Artist Two" (s2 first artist)
  });
});

describe('getNextRound', () => {
  it('previews the following round with its deadline + submissions so far', () => {
    const { r1 } = seed(db);
    const nx = getNextRound(db, r1)!;
    expect(nx.theme).toBe('Round Two');
    expect(nx.deadline).toBe('2026-02-10T00:00:00Z');
    expect(nx.submissionsSoFar).toBe(1);
  });
  it('returns null on the latest round', () => {
    const { r2 } = seed(db);
    expect(getNextRound(db, r2)).toBeNull();
  });
});

describe('getDiscoverability', () => {
  it('ranks players by mean obscurity (100 − proxy), most-obscure first', () => {
    const { r1 } = seed(db);
    // A→s1 (proxy 90 → obsc 10), B→s2 (proxy 30 → obsc 70), C→s3 (proxy 10 → obsc 90)
    pop(db, 'uri:s1', 100, 100, 90);
    pop(db, 'uri:s2', 100, 100, 30);
    pop(db, 'uri:s3', 100, 100, 10);
    const d = getDiscoverability(db, r1)!;
    expect(d.map((r) => [r.name, r.obscurityScore, r.submissionCount, r.avgPopularity])).toEqual([
      ['C', 90, 1, 10], // most obscure
      ['B', 70, 1, 30],
      ['A', 10, 1, 90], // crowd-pleaser
    ]);
  });
  it('self-suppresses (null) when no popularity data exists', () => {
    const { r1 } = seed(db);
    expect(getDiscoverability(db, r1)).toBeNull();
  });
});
