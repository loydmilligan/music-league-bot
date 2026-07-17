import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { resolveScheduledDigest } from './schedule.js';

const NOW = '2026-07-17T09:00:00Z';
const PAST = '2026-07-10T00:00:00Z';
const EARLIER = '2026-07-01T00:00:00Z';
const FUTURE = '2026-07-24T00:00:00Z';

function seedLeague(db: Database.Database) {
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test-league', 'Test League')`).run();
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`,
  ).run();
  db.prepare(`INSERT INTO competitors (id, ml_competitor_id, name) VALUES (1, 'c1', 'Alice')`).run();
  db.prepare(`INSERT INTO competitors (id, ml_competitor_id, name) VALUES (2, 'c2', 'Bob')`).run();
}

function addRound(
  db: Database.Database,
  opts: { id: number; seasonId?: number; votingDeadline: string; description?: string | null },
) {
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, description, voting_deadline, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-06-01T00:00:00Z')`,
  ).run(
    opts.id,
    opts.seasonId ?? 1,
    `r${opts.id}`,
    `Round ${opts.id}`,
    opts.description === undefined ? 'A theme' : opts.description,
    opts.votingDeadline,
  );
}

/** A round that would pass every readiness check. */
function makeComplete(db: Database.Database, roundId: number) {
  db.prepare(
    `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
     VALUES (?, 1, ?, 'Title', 'Artist', '2026-06-01T00:00:00Z')`,
  ).run(roundId, `spotify:track:s${roundId}`);
  db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at)
     VALUES (?, 2, ?, 5, 'nice', '2026-06-01T00:00:00Z')`,
  ).run(roundId, `spotify:track:s${roundId}`);
}

let db: Database.Database;
beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeague(db);
});

describe('nothing to do', () => {
  it('returns none when the league has no rounds', () => {
    expect(resolveScheduledDigest(db, 1, NOW).action).toBe('none');
  });

  it('returns none when no round has finished voting yet', () => {
    addRound(db, { id: 1, votingDeadline: FUTURE });
    makeComplete(db, 1);
    expect(resolveScheduledDigest(db, 1, NOW).action).toBe('none');
  });
});

describe('season-final rounds are held, never sent', () => {
  it('holds when no later round exists in the league', () => {
    addRound(db, { id: 1, votingDeadline: PAST });
    makeComplete(db, 1);

    const d = resolveScheduledDigest(db, 1, NOW);
    expect(d.action).toBe('hold');
    expect(d.reason).toMatch(/season-final/i);
  });

  it('holds the season-final round even when it is fully ready', () => {
    addRound(db, { id: 1, votingDeadline: EARLIER });
    addRound(db, { id: 2, votingDeadline: PAST });
    makeComplete(db, 1);
    makeComplete(db, 2);

    // Round 2 is the latest round in the league → its next-round teaser is empty.
    const d = resolveScheduledDigest(db, 1, NOW);
    expect(d).toMatchObject({ action: 'hold', roundId: 2 });
  });

  it('sends once a later round exists, even if that round has not started', () => {
    addRound(db, { id: 1, votingDeadline: PAST });
    addRound(db, { id: 2, votingDeadline: FUTURE });
    makeComplete(db, 1);

    expect(resolveScheduledDigest(db, 1, NOW)).toMatchObject({ action: 'send', roundId: 1 });
  });
});

describe('round selection', () => {
  it('picks the most recently completed round, not the oldest', () => {
    addRound(db, { id: 1, votingDeadline: EARLIER });
    addRound(db, { id: 2, votingDeadline: PAST });
    addRound(db, { id: 3, votingDeadline: FUTURE });
    makeComplete(db, 1);
    makeComplete(db, 2);

    expect(resolveScheduledDigest(db, 1, NOW)).toMatchObject({ action: 'send', roundId: 2 });
  });

  it('never selects a round whose voting is still open, even though it has votes', () => {
    // The prepChecks "Votes" check passes on votes_count > 0, which is true here
    // mid-voting. Selection must gate on the deadline, not on vote existence.
    addRound(db, { id: 1, votingDeadline: PAST });
    addRound(db, { id: 2, votingDeadline: FUTURE });
    makeComplete(db, 1);
    makeComplete(db, 2); // round 2 has a vote but voting is still open

    expect(resolveScheduledDigest(db, 1, NOW)).toMatchObject({ action: 'send', roundId: 1 });
  });

  it('ignores rounds belonging to other leagues', () => {
    db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (2, 'other', 'Other')`).run();
    db.prepare(
      `INSERT INTO seasons (id, league_id, season_number, status) VALUES (2, 2, 1, 'active')`,
    ).run();
    addRound(db, { id: 1, seasonId: 2, votingDeadline: PAST });
    makeComplete(db, 1);

    expect(resolveScheduledDigest(db, 1, NOW).action).toBe('none');
  });
});

describe('readiness gating', () => {
  it('holds when the completed round has no votes', () => {
    addRound(db, { id: 1, votingDeadline: PAST });
    addRound(db, { id: 2, votingDeadline: FUTURE });
    db.prepare(
      `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
       VALUES (1, 1, 'spotify:track:s1', 'T', 'A', '2026-06-01T00:00:00Z')`,
    ).run();

    const d = resolveScheduledDigest(db, 1, NOW);
    expect(d).toMatchObject({ action: 'hold', roundId: 1 });
    expect(d.reason).toMatch(/vote/i);
  });

  it('holds when the completed round has no submissions', () => {
    addRound(db, { id: 1, votingDeadline: PAST });
    addRound(db, { id: 2, votingDeadline: FUTURE });

    const d = resolveScheduledDigest(db, 1, NOW);
    expect(d).toMatchObject({ action: 'hold', roundId: 1 });
    expect(d.reason).toMatch(/submission/i);
  });

  it('holds when the round has no theme description', () => {
    addRound(db, { id: 1, votingDeadline: PAST, description: null });
    addRound(db, { id: 2, votingDeadline: FUTURE });
    makeComplete(db, 1);

    const d = resolveScheduledDigest(db, 1, NOW);
    expect(d).toMatchObject({ action: 'hold', roundId: 1 });
    expect(d.reason).toMatch(/description|theme/i);
  });
});
