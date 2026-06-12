import { it, expect, beforeEach, describe } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound, updateDeadlines } from './rounds.js';
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
  sub.run(r1, ids.A, 'spotify:track:s1', 's1', 'Artist One', now);
  sub.run(r1, ids.B, 'spotify:track:s2', 's2', 'Artist Two, Feat Guy', now); // multi-artist → first only
  sub.run(r1, ids.C, 'spotify:track:s3', 's3', 'Artist One', now);           // same first artist as s1
  vote.run(r1, ids.B, 'spotify:track:s1', 3, now);
  vote.run(r1, ids.C, 'spotify:track:s1', 2, now);
  vote.run(r1, ids.A, 'spotify:track:s2', 2, now);
  vote.run(r1, ids.C, 'spotify:track:s2', 1, now);
  vote.run(r1, ids.A, 'spotify:track:s3', 1, now);
  // r2: one submission so far
  sub.run(r2, ids.A, 'spotify:track:s4', 's4', 'Artist Three', now);
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
    expect(nx.submissionDeadline).toBe('2026-02-10T00:00:00Z');
    expect(nx.votingDeadline).toBeNull();
    expect(nx.submissionsSoFar).toBe(1);
  });
  it('returns null on the latest round', () => {
    const { r2 } = seed(db);
    expect(getNextRound(db, r2)).toBeNull();
  });
  it('continues across seasons within the same league', () => {
    seedLeagues(db);
    const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
    const s1 = upsertSeason(db, leagueId, 1, 'complete');
    const s2 = upsertSeason(db, leagueId, 2, 'active');
    const last = upsertRound(db, s1, {
      mlRoundId: 'cross-s1-r2',
      name: 'Round 2',
      description: 'Finale theme',
      spotifyPlaylistUrl: '',
      createdAt: '2026-01-02T00:00:00Z',
    });
    const next = upsertRound(db, s2, {
      mlRoundId: 'cross-s2-r1',
      name: 'Round 1',
      description: 'New season theme',
      spotifyPlaylistUrl: '',
      createdAt: '2026-02-01T00:00:00Z',
    });
    updateDeadlines(db, next, '2026-02-10T00:00:00Z', '2026-02-17T00:00:00Z');

    const nx = getNextRound(db, last)!;

    expect(nx.theme).toBe('New season theme');
    expect(nx.themeSource).toBe('description');
    expect(nx.submissionDeadline).toBe('2026-02-10T00:00:00Z');
    expect(nx.votingDeadline).toBe('2026-02-17T00:00:00Z');
  });
});

describe('getDiscoverability (tastemaker v2)', () => {
  // obscurity = 100 − proxy. A→s1(proxy90→obsc10), B→s2(proxy30→obsc70), C→s3(proxy10→obsc90).
  function popR1(d: Database.Database) {
    pop(d, 'spotify:track:s1', 100, 100, 90);
    pop(d, 'spotify:track:s2', 100, 100, 30);
    pop(d, 'spotify:track:s3', 100, 100, 10);
  }

  it('ranks by median discovery percentile, with buckets + per-song detail (single round)', () => {
    const { r1 } = seed(db);
    popR1(db);
    const d = getDiscoverability(db, r1)!;
    expect(d.scope).toBe('season');
    // 3 obscurities (10,70,90) → percentiles 0,50,100. Ranked most-obscure first.
    expect(d.players.map((p) => [p.name, p.tastemakerScore, p.rank, p.prevRank])).toEqual([
      ['C', 100, 1, null], // obsc90 → pct100, rabbitHole; no prior round → prevRank null
      ['B', 50, 2, null],  // obsc70 → pct50, rabbitHole
      ['A', 0, 3, null],   // obsc10 → pct0, recognizable
    ]);
    const c = d.players[0];
    expect(c.buckets).toEqual({ radioHit: 0, recognizable: 0, curiousCut: 0, rabbitHole: 1 });
    expect(c.songs).toHaveLength(1);
    expect(c.songs[0]).toMatchObject({ obscurity: 90, discoveryPercentile: 100, bucket: 'rabbitHole', points: 1 });
    // buckets sum to submissionCount for each player
    for (const p of d.players) {
      const sum = p.buckets.radioHit + p.buckets.recognizable + p.buckets.curiousCut + p.buckets.rabbitHole;
      expect(sum).toBe(p.submissionCount);
    }
  });

  it('prevRank comes from the cumulative ranking through the prior round', () => {
    const { r2 } = seed(db);
    popR1(db);
    pop(db, 'spotify:track:s4', 100, 100, 50); // A's r2 pick, obsc50
    const d = getDiscoverability(db, r2)!;
    // Corpus r1+r2: obscurities 10,50,70,90 → percentiles 0,33,67,100.
    // A has s1(0)+s4(33) → median 17; B s2→67; C s3→100.
    const byName = Object.fromEntries(d.players.map((p) => [p.name, p]));
    expect(byName.A.tastemakerScore).toBe(17);
    expect(byName.A.submissionCount).toBe(2);
    // prevRank = ranking through r1 only (A3,B2,C1) — present, not null.
    expect([byName.C.prevRank, byName.B.prevRank, byName.A.prevRank]).toEqual([1, 2, 3]);
  });

  it('self-suppresses (null) when no popularity data exists', () => {
    const { r1 } = seed(db);
    expect(getDiscoverability(db, r1)).toBeNull();
  });

  it('self-suppresses (null) when coverage is PARTIAL (< 80% of the corpus scored)', () => {
    const { r1 } = seed(db);
    pop(db, 'spotify:track:s2', 100, 100, 30); // only 1 of r1's 3 songs scored = 33%
    expect(getDiscoverability(db, r1)).toBeNull();
  });
});
