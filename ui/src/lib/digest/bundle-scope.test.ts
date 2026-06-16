import { it, expect, describe, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { upsertCompetitor, upsertSubmission, upsertVote } from '../db/submissions.js';
import { gatherRoundData } from './llm.js';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

/**
 * Seeds a 4-round season. R1–R3 are complete with votes; R4 is a "future" round
 * (round_number=4) that has a submission to test the > N filter. The current
 * target round is R3 (round_number=3).
 */
function seedBundleScenario(db: Database.Database): { r3Id: number; r4Id: number } {
  seedLeagues(db);
  const leagueId = (
    db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }
  ).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');

  const r1Id = upsertRound(db, seasonId, { mlRoundId: 'r1', name: 'Old Flames', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  const r2Id = upsertRound(db, seasonId, { mlRoundId: 'r2', name: 'Bone Thugs Era', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-02T00:00:00Z' });
  const r3Id = upsertRound(db, seasonId, { mlRoundId: 'r3', name: 'Second Best', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-03T00:00:00Z' });
  const r4Id = upsertRound(db, seasonId, { mlRoundId: 'r4', name: 'Future Round', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-04T00:00:00Z' });

  db.prepare('UPDATE rounds SET round_number = 1 WHERE id = ?').run(r1Id);
  db.prepare('UPDATE rounds SET round_number = 2 WHERE id = ?').run(r2Id);
  db.prepare('UPDATE rounds SET round_number = 3 WHERE id = ?').run(r3Id);
  db.prepare('UPDATE rounds SET round_number = 4 WHERE id = ?').run(r4Id);

  const alice = upsertCompetitor(db, 'c-alice', 'Alice');
  const bob   = upsertCompetitor(db, 'c-bob',   'Bob');
  const carol = upsertCompetitor(db, 'c-carol', 'Carol');

  // R1: Alice submits "Malagueña" (winner, 9 pts), Bob submits "Blue Moon" (5 pts)
  upsertSubmission(db, { roundId: r1Id, competitorId: alice, spotifyUri: 'sp:r1:mal', title: 'Malagueña', album: '', artists: 'Trio', comment: '', createdAt: '2026-01-01T00:00:00Z', visibleToVoters: true });
  upsertSubmission(db, { roundId: r1Id, competitorId: bob, spotifyUri: 'sp:r1:blue', title: 'Blue Moon', album: '', artists: 'Ella', comment: '', createdAt: '2026-01-01T00:00:00Z', visibleToVoters: true });
  upsertVote(db, { roundId: r1Id, voterId: bob,   spotifyUri: 'sp:r1:mal',  points: 5, comment: '', createdAt: '2026-01-01T01:00:00Z' });
  upsertVote(db, { roundId: r1Id, voterId: carol, spotifyUri: 'sp:r1:mal',  points: 4, comment: '', createdAt: '2026-01-01T01:00:00Z' });
  upsertVote(db, { roundId: r1Id, voterId: alice, spotifyUri: 'sp:r1:blue', points: 5, comment: '', createdAt: '2026-01-01T01:00:00Z' });

  // R2: Bob submits "Bone Thugs" (winner, 7 pts), Carol submits "Jazz Song" (2 pts)
  upsertSubmission(db, { roundId: r2Id, competitorId: bob,   spotifyUri: 'sp:r2:bone', title: 'Bone Thugs', album: '', artists: 'BT', comment: '', createdAt: '2026-01-02T00:00:00Z', visibleToVoters: true });
  upsertSubmission(db, { roundId: r2Id, competitorId: carol, spotifyUri: 'sp:r2:jazz', title: 'Jazz Song',  album: '', artists: 'Miles', comment: '', createdAt: '2026-01-02T00:00:00Z', visibleToVoters: true });
  upsertVote(db, { roundId: r2Id, voterId: alice, spotifyUri: 'sp:r2:bone', points: 4, comment: '', createdAt: '2026-01-02T01:00:00Z' });
  upsertVote(db, { roundId: r2Id, voterId: carol, spotifyUri: 'sp:r2:bone', points: 3, comment: '', createdAt: '2026-01-02T01:00:00Z' });
  upsertVote(db, { roundId: r2Id, voterId: bob,   spotifyUri: 'sp:r2:jazz', points: 2, comment: '', createdAt: '2026-01-02T01:00:00Z' });

  // R3 (current): Carol submits "Second Best" (winner, 6 pts), Alice submits "Runner Up" (2 pts)
  upsertSubmission(db, { roundId: r3Id, competitorId: carol, spotifyUri: 'sp:r3:sec', title: 'Second Best', album: '', artists: 'Weezer', comment: '', createdAt: '2026-01-03T00:00:00Z', visibleToVoters: true });
  upsertSubmission(db, { roundId: r3Id, competitorId: alice, spotifyUri: 'sp:r3:run', title: 'Runner Up',   album: '', artists: 'X',     comment: '', createdAt: '2026-01-03T00:00:00Z', visibleToVoters: true });
  upsertVote(db, { roundId: r3Id, voterId: alice, spotifyUri: 'sp:r3:sec', points: 3, comment: '', createdAt: '2026-01-03T01:00:00Z' });
  upsertVote(db, { roundId: r3Id, voterId: bob,   spotifyUri: 'sp:r3:sec', points: 3, comment: '', createdAt: '2026-01-03T01:00:00Z' });
  upsertVote(db, { roundId: r3Id, voterId: carol, spotifyUri: 'sp:r3:run', points: 2, comment: '', createdAt: '2026-01-03T01:00:00Z' });

  // R4 (future): has "Cottonfield Blues" — must be excluded from the R3 bundle
  upsertSubmission(db, { roundId: r4Id, competitorId: bob, spotifyUri: 'sp:r4:cotton', title: 'Cottonfield Blues', album: '', artists: 'Johnny Lang', comment: '', createdAt: '2026-01-04T00:00:00Z', visibleToVoters: true });
  upsertVote(db, { roundId: r4Id, voterId: alice, spotifyUri: 'sp:r4:cotton', points: 5, comment: '', createdAt: '2026-01-04T01:00:00Z' });

  return { r3Id, r4Id };
}

describe('bundle scoping — gatherRoundData', () => {
  it('round-N bundle contains only rounds with round_number <= N', () => {
    const { r3Id } = seedBundleScenario(db);
    const { bundle } = gatherRoundData(db, r3Id);

    // Rounds 1, 2, 3 — NOT round 4
    expect(bundle).toHaveLength(3);
    const roundNumbers = bundle.map(e => e.round_number);
    expect(roundNumbers).toEqual([1, 2, 3]);
  });

  it('bundle is ordered by round_number ascending', () => {
    const { r3Id } = seedBundleScenario(db);
    const { bundle } = gatherRoundData(db, r3Id);

    for (let i = 1; i < bundle.length; i++) {
      expect(bundle[i].round_number).toBeGreaterThan(bundle[i - 1].round_number);
    }
  });

  it('current round is marked isCurrent=true, all others isCurrent=false', () => {
    const { r3Id } = seedBundleScenario(db);
    const { bundle } = gatherRoundData(db, r3Id);

    const current = bundle.filter(e => e.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].round_number).toBe(3);
  });

  it('immediately prior round is marked isPrev=true', () => {
    const { r3Id } = seedBundleScenario(db);
    const { bundle } = gatherRoundData(db, r3Id);

    const prev = bundle.filter(e => e.isPrev);
    expect(prev).toHaveLength(1);
    expect(prev[0].round_number).toBe(2);
  });

  it('bundle carries top3 and winner derived from actual votes', () => {
    const { r3Id } = seedBundleScenario(db);
    const { bundle } = gatherRoundData(db, r3Id);

    const r1 = bundle.find(e => e.round_number === 1)!;
    expect(r1.winner).toBe('Alice');             // Malagueña: 9 pts vs Blue Moon: 5 pts
    expect(r1.top3[0].song).toBe('Malagueña');
    expect(r1.top3[0].points).toBe(9);

    const r2 = bundle.find(e => e.round_number === 2)!;
    expect(r2.winner).toBe('Bob');              // Bone Thugs: 7 pts
    expect(r2.top3[0].song).toBe('Bone Thugs');
  });

  it('bottom1 is the least-voted song in the round', () => {
    const { r3Id } = seedBundleScenario(db);
    const { bundle } = gatherRoundData(db, r3Id);

    const r1 = bundle.find(e => e.round_number === 1)!;
    // Blue Moon = 5 pts, Malagueña = 9 pts → Blue Moon is least
    expect(r1.bottom1?.song).toBe('Blue Moon');
  });

  it('future-round songs do not appear anywhere in the bundle', () => {
    const { r3Id } = seedBundleScenario(db);
    const { bundle } = gatherRoundData(db, r3Id);

    const allSongs = bundle.flatMap(e => [
      ...e.top3.map(s => s.song),
      e.bottom1?.song ?? '',
    ]);
    expect(allSongs).not.toContain('Cottonfield Blues');
  });
});
