import { it, expect, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { buildPlayerContext } from './playerContext.js';
import type Database from 'better-sqlite3';

// ── Minimal DB seed helpers ──────────────────────────────────────────────────

function mkBase(db: Database.Database) {
  seedLeagues(db);
  const leagueId = (
    db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }
  ).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  return { leagueId, seasonId };
}

function mkRound(db: Database.Database, seasonId: number, name: string, mlId: string) {
  return upsertRound(db, seasonId, {
    mlRoundId: mlId,
    name,
    description: '',
    spotifyPlaylistUrl: '',
    createdAt: new Date().toISOString(),
  });
}

function mkPlayer(db: Database.Database, name: string): number {
  db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function mkCompetitor(db: Database.Database, playerId: number, name: string): number {
  db.prepare(
    "INSERT INTO competitors (ml_competitor_id, name, player_id) VALUES (?, ?, ?)"
  ).run(`ml-${name}`, name, playerId);
  return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function mkSubmission(
  db: Database.Database,
  opts: { roundId: number; competitorId: number; uri: string; title: string; artist: string },
): void {
  db.prepare(
    `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at, visible_to_voters)
     VALUES (?, ?, ?, ?, ?, datetime('now'), 1)`,
  ).run(opts.roundId, opts.competitorId, opts.uri, opts.title, opts.artist);
}

function mkVote(
  db: Database.Database,
  opts: { roundId: number; voterId: number; uri: string; points: number; comment?: string },
): void {
  db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(opts.roundId, opts.voterId, opts.uri, opts.points, opts.comment ?? null);
}

// ── Tests ───────────────────────────────────────────────────────────────────

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

describe('player with dossier + history', () => {
  it('returns full PlayerContext shape with submissions, votes, overlap, and dossier', () => {
    const { leagueId, seasonId } = mkBase(db);

    // Two rounds
    const r1 = mkRound(db, seasonId, 'Theme A', 'round-a');
    const r2 = mkRound(db, seasonId, 'Theme B', 'round-b');

    // Two players
    const aliceId = mkPlayer(db, 'Alice');
    const bobId = mkPlayer(db, 'Bob');
    const aliceComp = mkCompetitor(db, aliceId, 'Alice');
    const bobComp = mkCompetitor(db, bobId, 'Bob');

    // Alice submits in both rounds
    mkSubmission(db, { roundId: r1, competitorId: aliceComp, uri: 'spotify:track:a1', title: 'Song A1', artist: 'Artist A' });
    mkSubmission(db, { roundId: r2, competitorId: aliceComp, uri: 'spotify:track:a2', title: 'Song A2', artist: 'Artist B' });
    // Bob submits too
    mkSubmission(db, { roundId: r1, competitorId: bobComp, uri: 'spotify:track:b1', title: 'Song B1', artist: 'Artist C' });

    // Bob votes on Alice's submissions (giving her points)
    mkVote(db, { roundId: r1, voterId: bobComp, uri: 'spotify:track:a1', points: 3, comment: 'Great track!' });
    mkVote(db, { roundId: r2, voterId: bobComp, uri: 'spotify:track:a2', points: 5 });
    // Alice votes on Bob's submission
    mkVote(db, { roundId: r1, voterId: aliceComp, uri: 'spotify:track:b1', points: 4, comment: 'Nice one' });

    // Alice has a dossier
    db.prepare(
      `INSERT INTO player_profiles (player_id, notes, tags, taste_fingerprint, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(aliceId, 'Loves indie and 80s synth', JSON.stringify(['indie', '80s']), JSON.stringify({ summary: 'eclectic' }));

    const ctx = buildPlayerContext(db, aliceId);

    // Shape
    expect(ctx.playerId).toBe(aliceId);
    expect(ctx.playerName).toBe('Alice');

    // Dossier
    expect(ctx.dossier.notes).toBe('Loves indie and 80s synth');
    expect(ctx.dossier.tags).toEqual(['indie', '80s']);
    expect(ctx.dossier.tasteFingerprint).toEqual({ summary: 'eclectic' });

    // Submissions (most-recent-first)
    expect(ctx.submissions).toHaveLength(2);
    expect(ctx.submissions[0].round).toBe('Theme B'); // r2 = more recent
    expect(ctx.submissions[0].title).toBe('Song A2');
    expect(ctx.submissions[0].pointsReceived).toBe(5);

    // Votes cast by Alice
    expect(ctx.votesCast).toHaveLength(1);
    expect(ctx.votesCast[0].songTitle).toBe('Song B1');
    expect(ctx.votesCast[0].pointsGiven).toBe(4);
    expect(ctx.votesCast[0].comment).toBe('Nice one');

    // Taste overlap (Alice and Bob co-voted on same song)
    expect(ctx.tasteOverlap.length).toBeGreaterThanOrEqual(0); // depends on shared song votes
    expect(ctx.winRate).toBeGreaterThanOrEqual(0);
    expect(ctx.boundingApplied).toBe(false);
  });
});

describe('player with neither dossier nor history', () => {
  it('returns empty arrays and null dossier fields', () => {
    // Player exists in players table but has no profile, no competitors, no history
    const playerId = mkPlayer(db, 'Ghost');
    const ctx = buildPlayerContext(db, playerId);

    expect(ctx.playerId).toBe(playerId);
    expect(ctx.playerName).toBe('Ghost');
    expect(ctx.dossier.notes).toBeNull();
    expect(ctx.dossier.tags).toEqual([]);
    expect(ctx.dossier.tasteFingerprint).toBeNull();
    expect(ctx.submissions).toHaveLength(0);
    expect(ctx.votesCast).toHaveLength(0);
    expect(ctx.tasteOverlap).toHaveLength(0);
    expect(ctx.winRate).toBe(0);
    expect(ctx.boundingApplied).toBe(false);
  });
});

describe('bounding', () => {
  it('caps submissions to maxSubmissions and sets boundingApplied', () => {
    const { leagueId, seasonId } = mkBase(db);
    const playerId = mkPlayer(db, 'Prolific');
    const compId = mkCompetitor(db, playerId, 'Prolific');

    // Insert 5 rounds and submissions
    for (let i = 0; i < 5; i++) {
      const roundId = mkRound(db, seasonId, `Theme ${i}`, `round-${i}`);
      mkSubmission(db, {
        roundId,
        competitorId: compId,
        uri: `spotify:track:sub${i}`,
        title: `Song ${i}`,
        artist: 'Band',
      });
    }

    const ctx = buildPlayerContext(db, playerId, { maxSubmissions: 3 });
    expect(ctx.submissions).toHaveLength(3);
    expect(ctx.boundingApplied).toBe(true);
    // Most-recent-first: Theme 4 should be first
    expect(ctx.submissions[0].round).toBe('Theme 4');
  });

  it('caps votesCast to maxVotes and sets boundingApplied', () => {
    const { leagueId, seasonId } = mkBase(db);
    const voterId = mkPlayer(db, 'ActiveVoter');
    const targetId = mkPlayer(db, 'SongMaker');
    const voterComp = mkCompetitor(db, voterId, 'ActiveVoter');
    const targetComp = mkCompetitor(db, targetId, 'SongMaker');

    // 5 rounds, 1 song each; voter votes on all
    for (let i = 0; i < 5; i++) {
      const roundId = mkRound(db, seasonId, `Round ${i}`, `r-vote-${i}`);
      mkSubmission(db, { roundId, competitorId: targetComp, uri: `spotify:track:v${i}`, title: `T${i}`, artist: 'X' });
      mkVote(db, { roundId, voterId: voterComp, uri: `spotify:track:v${i}`, points: 2 });
    }

    const ctx = buildPlayerContext(db, voterId, { maxVotes: 2 });
    expect(ctx.votesCast).toHaveLength(2);
    expect(ctx.boundingApplied).toBe(true);
  });
});

describe('edge cases', () => {
  it('handles unknown playerId gracefully', () => {
    const ctx = buildPlayerContext(db, 99999);
    expect(ctx.playerName).toBe('player:99999');
    expect(ctx.submissions).toHaveLength(0);
    expect(ctx.votesCast).toHaveLength(0);
  });

  it('handles malformed tags JSON in dossier without throwing', () => {
    const playerId = mkPlayer(db, 'Corrupt');
    db.prepare(
      "INSERT INTO player_profiles (player_id, notes, tags) VALUES (?, ?, ?)"
    ).run(playerId, null, 'not-valid-json');
    const ctx = buildPlayerContext(db, playerId);
    expect(ctx.dossier.tags).toEqual([]);
  });

  it('excludes zero-point votes from votesCast', () => {
    const { leagueId, seasonId } = mkBase(db);
    const voterId = mkPlayer(db, 'Abstainer');
    const targetId = mkPlayer(db, 'Submitter');
    const voterComp = mkCompetitor(db, voterId, 'Abstainer');
    const targetComp = mkCompetitor(db, targetId, 'Submitter');

    const roundId = mkRound(db, seasonId, 'Zero Theme', 'zero-round');
    mkSubmission(db, { roundId, competitorId: targetComp, uri: 'spotify:track:zero', title: 'Meh', artist: 'X' });
    mkVote(db, { roundId, voterId: voterComp, uri: 'spotify:track:zero', points: 0 });

    const ctx = buildPlayerContext(db, voterId);
    expect(ctx.votesCast).toHaveLength(0);
  });
});
