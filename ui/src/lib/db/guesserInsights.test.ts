import { describe, it, expect, beforeAll } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { getGuesserData } from './guesserInsights.js';

// Self-contained fixture, in-memory DB.
//
// League 'x', season 1, players: Gus (guesser), Ann, Bob, Cid.
// Rounds r1..r3 build up season history (Ann always right, Bob always wrong
// guessed-as-Cid, Cid gets one no-match "no idea" comment that must NOT count
// as an attempt). Round r4 (the target round, `round2Id`) adds a 4th
// submission by Gus himself — proving self-submissions are skipped — plus the
// deliberate Bob<->Cid guess swap that seeds `littermates`.
let db: Database.Database;
let round2Id: number;
let gusPlayerId: number;
let annPlayerId: number;
let bobPlayerId: number;

beforeAll(() => {
  db = openLeagueDb(':memory:');

  db.prepare("INSERT INTO leagues (id, slug, name) VALUES (1, 'x', 'X League')").run();
  db.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();

  const insertPlayer = db.prepare('INSERT INTO players (id, name) VALUES (?, ?)');
  insertPlayer.run(1, 'Gus');
  insertPlayer.run(2, 'Ann');
  insertPlayer.run(3, 'Bob');
  insertPlayer.run(4, 'Cid');
  gusPlayerId = 1;
  annPlayerId = 2;
  bobPlayerId = 3;

  const insertCompetitor = db.prepare(
    'INSERT INTO competitors (id, ml_competitor_id, name, player_id) VALUES (?, ?, ?, ?)',
  );
  insertCompetitor.run(1, 'ml-gus', 'Gus', 1);
  insertCompetitor.run(2, 'ml-ann', 'Ann', 2);
  insertCompetitor.run(3, 'ml-bob', 'Bob', 3);
  insertCompetitor.run(4, 'ml-cid', 'Cid', 4);

  const insertRound = db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (?, 1, ?, ?, ?)`,
  );
  insertRound.run(1, 'r-1', 'Round 1', '2026-01-01T00:00:00Z');
  insertRound.run(2, 'r-2', 'Round 2', '2026-01-08T00:00:00Z');
  insertRound.run(3, 'r-3', 'Round 3', '2026-01-15T00:00:00Z');
  insertRound.run(4, 'r-4', 'Round 4', '2026-01-22T00:00:00Z');
  round2Id = 4;

  const insertSub = db.prepare(
    `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
     VALUES (?, ?, ?, ?, 'Artist', ?)`,
  );
  // Round 1
  insertSub.run(1, 2, 'ann-r1', 'Ann Song 1', '2026-01-01T01:00:00Z');
  insertSub.run(1, 3, 'bob-r1', 'Bob Song 1', '2026-01-01T01:00:00Z');
  // Round 2
  insertSub.run(2, 2, 'ann-r2', 'Ann Song 2', '2026-01-08T01:00:00Z');
  insertSub.run(2, 3, 'bob-r2', 'Bob Song 2', '2026-01-08T01:00:00Z');
  // Round 3 (adds Cid, who gets a no-match comment -> must not count as an attempt)
  insertSub.run(3, 2, 'ann-r3', 'Ann Song 3', '2026-01-15T01:00:00Z');
  insertSub.run(3, 3, 'bob-r3', 'Bob Song 3', '2026-01-15T01:00:00Z');
  insertSub.run(3, 4, 'cid-r3', 'Cid Song 3', '2026-01-15T01:00:00Z');
  // Round 4 (target): Gus himself submits too (uri sorts LAST -> proves
  // self-submission is skipped, not just excluded from correctness).
  insertSub.run(4, 2, 'aa-ann-r4', 'Ann Song 4', '2026-01-22T01:00:00Z');
  insertSub.run(4, 3, 'bb-bob-r4', 'Bob Song 4', '2026-01-22T01:00:00Z');
  insertSub.run(4, 4, 'cc-cid-r4', 'Cid Song 4', '2026-01-22T01:00:00Z');
  insertSub.run(4, 1, 'zz-gus-r4', 'Gus Song 4', '2026-01-22T01:00:00Z');

  const insertVote = db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at)
     VALUES (?, 1, ?, 1, ?, ?)`,
  );
  // Round 1: Ann correct, Bob wrong (guessed Cid) -> swap #1
  insertVote.run(1, 'ann-r1', 'this is Ann', '2026-01-01T12:00:00Z');
  insertVote.run(1, 'bob-r1', 'must be Cid', '2026-01-01T12:00:00Z');
  // Round 2: Ann correct, Bob wrong (guessed Cid) -> swap #2
  insertVote.run(2, 'ann-r2', "definitely Ann's pick", '2026-01-08T12:00:00Z');
  insertVote.run(2, 'bob-r2', 'sounds like Cid to me', '2026-01-08T12:00:00Z');
  // Round 3: Ann correct, Bob wrong (guessed Cid) -> swap #3; Cid gets a
  // no-match comment (no roster name in it) -> must not count as an attempt.
  insertVote.run(3, 'ann-r3', 'classic Ann move', '2026-01-15T12:00:00Z');
  insertVote.run(3, 'bob-r3', 'gotta be Cid', '2026-01-15T12:00:00Z');
  insertVote.run(3, 'cid-r3', 'no idea who this is, random guess', '2026-01-15T12:00:00Z');
  // Round 4 (target): Ann correct (4th), Bob wrong->Cid (4th swap), Cid
  // wrong->Bob (reverse of the swap pair). No vote on Gus's own song.
  insertVote.run(4, 'aa-ann-r4', 'this is Ann', '2026-01-22T12:00:00Z');
  insertVote.run(4, 'bb-bob-r4', 'must be Cid', '2026-01-22T12:00:00Z');
  insertVote.run(4, 'cc-cid-r4', 'sounds like Bob', '2026-01-22T12:00:00Z');
});

describe('getGuesserData', () => {
  it('computes weekly record, play order, and leaderboards', () => {
    const g = getGuesserData(db, round2Id);
    expect(g.guesserName).toBe('Gus');
    expect(g.weekly.attempts).toBeGreaterThan(0);
    expect(g.weekly.guesses[0].playPosition).toBe(1); // spotify_uri order
    expect(g.littermates?.swaps).toBeGreaterThanOrEqual(1); // Bob<->Cid
  });

  it('skips the song the guesser submitted himself', () => {
    const g = getGuesserData(db, round2Id);
    // 4 submissions in round 4 (Ann, Bob, Cid, Gus); Gus's own is excluded.
    expect(g.weekly.guesses).toHaveLength(3);
    expect(g.weekly.guesses.some((x) => x.actualPlayerId === gusPlayerId)).toBe(false);
    // playPosition is preserved from the full round (not renumbered after
    // removing Gus's own song, which sorts last by spotify_uri).
    expect(g.weekly.guesses.map((x) => x.playPosition)).toEqual([1, 2, 3]);
    expect(g.weekly.guesses[0].playCount).toBe(4);
  });

  it('scores the exact expected weekly record: Ann correct, Bob and Cid wrong (swap)', () => {
    const g = getGuesserData(db, round2Id);
    const byName = Object.fromEntries(g.weekly.guesses.map((x) => [x.actualName, x]));
    expect(byName.Ann.correct).toBe(true);
    expect(byName.Ann.guessedName).toBe('Ann');
    expect(byName.Bob.correct).toBe(false);
    expect(byName.Bob.guessedName).toBe('Cid');
    expect(byName.Cid.correct).toBe(false);
    expect(byName.Cid.guessedName).toBe('Bob');
    expect(g.weekly.attempts).toBe(3);
    expect(g.weekly.correct).toBe(1);
    expect(g.weekly.rate).toBeCloseTo(1 / 3);
  });

  it('buckets accuracy by play-position third (playCount=4: firstEnd=2, middleEnd=3)', () => {
    const g = getGuesserData(db, round2Id);
    // 4 submissions in round 4 -> firstEnd=ceil(4/3)=2, middleEnd=ceil(8/3)=3.
    // Guesses land at positions 1 (Ann, correct), 2 (Bob, wrong), 3 (Cid,
    // wrong); position 4 (Gus's own song) is skipped entirely, so `last`
    // never gets an attempt and defaults to 0.
    expect(g.drunkByThird).toEqual({ first: 0.5, middle: 0, last: 0 });
  });

  it('buckets accuracy by play-position third at a small-N boundary (playCount=2)', () => {
    // Round 1 as its own target: 2 submissions (Ann, Bob) -> firstEnd=ceil(2/3)=1,
    // middleEnd=ceil(4/3)=2. Position 1 (Ann, correct) -> first; position 2
    // (Bob, wrong) -> middle; nothing lands in last.
    const g1 = getGuesserData(db, 1);
    expect(g1.drunkByThird).toEqual({ first: 1, middle: 0, last: 0 });
  });

  it('builds season leaderboards with the MIN-attempts floor', () => {
    const g = getGuesserData(db, round2Id);
    // Ann: 4/4 correct across r1..r4 -> tops alwaysNails.
    expect(g.alwaysNails[0]?.name).toBe('Ann');
    expect(g.alwaysNails[0]?.attempts).toBe(4);
    expect(g.alwaysNails[0]?.correct).toBe(4);
    expect(g.alwaysNails[0]?.rate).toBe(1);
    // Bob: 0/4 correct across r1..r4 -> tops eludesHim.
    expect(g.eludesHim[0]?.name).toBe('Bob');
    expect(g.eludesHim[0]?.attempts).toBe(4);
    expect(g.eludesHim[0]?.correct).toBe(0);
    expect(g.eludesHim[0]?.rate).toBe(0);
    // Cid only has 1 real attempt (r3's "no idea" comment doesn't count) ->
    // below the MIN=3 floor, excluded from both leaderboards.
    expect(g.eludesHim.some((x) => x.name === 'Cid')).toBe(false);
    expect(g.alwaysNails.some((x) => x.name === 'Cid')).toBe(false);
  });

  it('picks Bob<->Cid as the top littermates pair', () => {
    const g = getGuesserData(db, round2Id);
    expect(g.littermates).not.toBeNull();
    const names = [g.littermates!.aName, g.littermates!.bName].sort();
    expect(names).toEqual(['Bob', 'Cid']);
    // 3 swaps from r1-r3 (Bob guessed as Cid) + 1 from r4 (Bob guessed as
    // Cid) + 1 reverse from r4 (Cid guessed as Bob) = 5.
    expect(g.littermates!.swaps).toBe(5);
  });

  it('carries the raw vote comment on each weekly guess (for the descent viz)', () => {
    const g = getGuesserData(db, round2Id);
    const byName = Object.fromEntries(g.weekly.guesses.map((x) => [x.actualName, x]));
    expect(byName.Ann.comment).toBe('this is Ann');
    expect(byName.Bob.comment).toBe('must be Cid');
    expect(byName.Cid.comment).toBe('sounds like Bob');
    // Gus's own song is skipped entirely — never appears as a guess row.
    expect(g.weekly.guesses.some((x) => x.actualName === 'Gus')).toBe(false);
  });

  it('builds the season hit-rate arc chronologically with a season average', () => {
    const g = getGuesserData(db, round2Id);
    // One point per round he attempted, oldest→newest (round ids 1..4).
    expect(g.seasonHitRates.map((p) => p.roundId)).toEqual([1, 2, 3, 4]);
    // round_number is unset in the fixture → label falls back to the round id.
    expect(g.seasonHitRates.map((p) => p.label)).toEqual(['1', '2', '3', '4']);
    // r1..r3: Ann right + Bob wrong (Cid's no-match doesn't count) = 1/2 each.
    // r4: Ann right, Bob wrong, Cid wrong = 1/3.
    expect(g.seasonHitRates.map((p) => [p.correct, p.attempts])).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
      [1, 3],
    ]);
    expect(g.seasonHitRates[0].rate).toBeCloseTo(0.5);
    expect(g.seasonHitRates[3].rate).toBeCloseTo(1 / 3);
    // Season average = total correct (4) / total attempts (9).
    expect(g.seasonRate).toBeCloseTo(4 / 9);
  });

  it('returns an empty section when no guesser can be detected', () => {
    const empty = openLeagueDb(':memory:');
    empty.prepare("INSERT INTO leagues (id, slug, name) VALUES (1, 'y', 'Y League')").run();
    empty.prepare("INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')").run();
    empty
      .prepare(`INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (1, 1, 'e-1', 'E1', '2026-01-01T00:00:00Z')`)
      .run();
    const g = getGuesserData(empty, 1);
    expect(g.guesserName).toBeNull();
    expect(g.weekly).toEqual({ attempts: 0, correct: 0, rate: 0, guesses: [] });
    expect(g.seasonHitRates).toEqual([]);
    expect(g.seasonRate).toBe(0);
    expect(g.eludesHim).toEqual([]);
    expect(g.alwaysNails).toEqual([]);
    expect(g.littermates).toBeNull();
  });
});
