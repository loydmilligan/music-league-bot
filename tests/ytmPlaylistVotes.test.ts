import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensurePlaylistSchema, pageForSlug, pageRoster, authorizeWrite, castVote, tallies, stampers,
  submitMessage, queuedMessages, approvedMessages, decideMessage, readModel, MessageRejected,
} from '../ui/src/lib/ytm/playlistVotes.js';
import {
  ensureVideoReviewSchema, upsertReview, setPageSlug, type VideoPick,
} from '../ui/src/lib/ytm/videoReview.js';
import { DEFAULT_VIDEO_PLAYLIST_CONFIG } from '../ui/src/lib/db/videoPlaylist.js';

const CFG = { ...DEFAULT_VIDEO_PLAYLIST_CONFIG, enabled: true };
const T = (n: number) => `2026-09-08T20:${String(n).padStart(2, '0')}:00.000Z`;

function pick(over: Partial<VideoPick>): VideoPick {
  return {
    title: 't', artists: 'a', spotifyUri: 'u:1', source: 'search', score: 80, band: 'auto',
    candidates: [], chosen: [], included: true, decided: true, reason: null, ...over,
  };
}

/**
 * Round 1 (slug S1) is the page under test: one song with a primary and a
 * child, one excluded song, one song with no video. Round 2 (slug S2) exists
 * only so "never echo another round's data" has something to leak.
 */
const R1_PICKS = [
  pick({ spotifyUri: 'u:1', chosen: ['PRIMARY', 'CHILD'] }),
  pick({ spotifyUri: 'u:2', chosen: ['OTHER'] }),
  pick({ spotifyUri: 'u:3', chosen: ['DROPPED'], included: false }),
  pick({ spotifyUri: 'u:4', chosen: [] }),
];

let db: Database.Database;
/** players.id of the four band members and of a non-stamping player. */
const ID: Record<string, string> = {};

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER NOT NULL);
    CREATE TABLE players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE season_players (season_id INTEGER NOT NULL, player_id INTEGER NOT NULL);
  `);
  db.exec('INSERT INTO rounds (id, season_id) VALUES (1, 11), (2, 22)');
  const insPlayer = db.prepare('INSERT INTO players (name) VALUES (?) RETURNING id');
  const insSeason = db.prepare('INSERT INTO season_players (season_id, player_id) VALUES (?, ?)');
  for (const name of ['Matt Mariani', 'Jon Black', 'Brian Pascoe', 'TJ Cook', 'Sarah Zucker']) {
    const id = (insPlayer.get(name) as { id: number }).id;
    ID[name] = String(id);
    insSeason.run(11, id);
  }
  // On season 22 only: the round-2 roster, to prove roster checks are per round.
  const outsider = (insPlayer.get('Grant Koziol') as { id: number }).id;
  ID['Grant Koziol'] = String(outsider);
  insSeason.run(22, outsider);

  ensureVideoReviewSchema(db);
  ensurePlaylistSchema(db);
  const park = (roundId: number, picks: VideoPick[]) =>
    upsertReview(db, {
      roundId, leagueId: 3, picks, config: CFG, target: 'g@g.us', audioUrl: null, audioSent: false,
    }, T(0));
  park(1, R1_PICKS);
  park(2, [pick({ spotifyUri: 'u:9', chosen: ['R2VIDEO'] })]);
  setPageSlug(db, 1, 'S1', T(0));
  setPageSlug(db, 2, 'S2', T(0));
});

describe('pageForSlug', () => {
  it('offers only included primaries for voting, children for comment only', () => {
    const page = pageForSlug(db, 'S1')!;
    expect(page.roundId).toBe(1);
    expect(page.votable).toEqual(['PRIMARY', 'OTHER']);
    expect(page.commentable).toEqual(['PRIMARY', 'CHILD', 'OTHER']);
  });

  it('is null for a slug nobody minted', () => {
    expect(pageForSlug(db, 'nope')).toBeNull();
    expect(pageForSlug(db, '')).toBeNull();
  });
});

describe('pageRoster', () => {
  it('is the roster of the round’s own season', () => {
    expect(pageRoster(db, 1).map((p) => p.name)).toEqual([
      'Brian Pascoe', 'Jon Black', 'Matt Mariani', 'Sarah Zucker', 'TJ Cook',
    ]);
    expect(pageRoster(db, 2).map((p) => p.name)).toEqual(['Grant Koziol']);
  });
});

describe('authorizeWrite', () => {
  const refuse = (...args: [string, string, string, 'votable' | 'commentable']) =>
    authorizeWrite(db, ...args) as { status: number; reason: string };

  it('404s an unknown slug without saying whether any other exists', () => {
    const r = refuse('nope', 'PRIMARY', ID['Matt Mariani'], 'votable');
    expect(r.status).toBe(404);
    expect(r.reason).toBe('no such page');
  });

  it('rejects a player who is not on this round’s roster', () => {
    expect(refuse('S1', 'PRIMARY', ID['Grant Koziol'], 'votable').status).toBe(400);
    expect(refuse('S1', 'PRIMARY', '9999', 'votable').status).toBe(400);
  });

  it('refuses a vote on a child, but allows a message on one (D6)', () => {
    expect(refuse('S1', 'CHILD', ID['Matt Mariani'], 'votable').status).toBe(404);
    expect(authorizeWrite(db, 'S1', 'CHILD', ID['Matt Mariani'], 'commentable')).toMatchObject({
      player: { name: 'Matt Mariani' },
    });
  });

  it('refuses a video that belongs to another round, or to an excluded song', () => {
    expect(refuse('S1', 'R2VIDEO', ID['Matt Mariani'], 'commentable').status).toBe(404);
    expect(refuse('S1', 'DROPPED', ID['Matt Mariani'], 'votable').status).toBe(404);
  });
});

describe('castVote', () => {
  const matt = () => ID['Matt Mariani'];

  it('is one row per person per video — changing a vote updates it', () => {
    castVote(db, 'S1', 'PRIMARY', matt(), 'up', T(1));
    castVote(db, 'S1', 'PRIMARY', matt(), 'down', T(2));
    expect(db.prepare('SELECT COUNT(*) AS n FROM playlist_votes').get()).toEqual({ n: 1 });
    expect(tallies(db, 'S1')).toEqual([
      { videoId: 'PRIMARY', up: 0, down: 1, stampers: [] },
    ]);
  });

  it('removes the row on a null direction', () => {
    castVote(db, 'S1', 'PRIMARY', matt(), 'up', T(1));
    castVote(db, 'S1', 'PRIMARY', matt(), null, T(2));
    expect(tallies(db, 'S1')).toEqual([]);
  });

  it('counts each voter once per video', () => {
    castVote(db, 'S1', 'PRIMARY', matt(), 'up', T(1));
    castVote(db, 'S1', 'PRIMARY', ID['Jon Black'], 'up', T(2));
    castVote(db, 'S1', 'PRIMARY', ID['Sarah Zucker'], 'down', T(3));
    castVote(db, 'S1', 'OTHER', ID['Sarah Zucker'], 'up', T(4));
    const t = tallies(db, 'S1');
    expect(t.find((x) => x.videoId === 'PRIMARY')).toMatchObject({ up: 2, down: 1 });
    expect(t.find((x) => x.videoId === 'OTHER')).toMatchObject({ up: 1, down: 0 });
  });
});

describe('the band stamp', () => {
  const matt = () => ID['Matt Mariani'];
  const stamped = (slug: string) => Object.fromEntries(stampers(db, slug));

  it('lands on a member’s first upvote, not their latest', () => {
    castVote(db, 'S1', 'PRIMARY', matt(), 'up', T(1));
    castVote(db, 'S1', 'OTHER', matt(), 'up', T(2));
    expect(stamped('S1')).toEqual({ PRIMARY: ['matt'] });
  });

  it('moves to the next-earliest upvote when the first is withdrawn', () => {
    castVote(db, 'S1', 'PRIMARY', matt(), 'up', T(1));
    castVote(db, 'S1', 'OTHER', matt(), 'up', T(2));
    castVote(db, 'S1', 'PRIMARY', matt(), null, T(3));
    expect(stamped('S1')).toEqual({ OTHER: ['matt'] });
  });

  it('does not move when the same upvote is cast again', () => {
    castVote(db, 'S1', 'PRIMARY', matt(), 'up', T(1));
    castVote(db, 'S1', 'OTHER', matt(), 'up', T(2));
    // A double-tap must not re-date the earlier vote, or the stamp would slide
    // onto OTHER, which nobody did anything to.
    castVote(db, 'S1', 'PRIMARY', matt(), 'up', T(9));
    expect(stamped('S1')).toEqual({ PRIMARY: ['matt'] });
  });

  it('treats a flip to up as a new upvote, dated when it happened', () => {
    castVote(db, 'S1', 'PRIMARY', matt(), 'down', T(1));
    castVote(db, 'S1', 'OTHER', matt(), 'up', T(2));
    castVote(db, 'S1', 'PRIMARY', matt(), 'up', T(3));
    expect(stamped('S1')).toEqual({ OTHER: ['matt'] });
  });

  it('assembles the band when first picks coincide, in reading order', () => {
    castVote(db, 'S1', 'PRIMARY', ID['TJ Cook'], 'up', T(1));
    castVote(db, 'S1', 'PRIMARY', ID['Jon Black'], 'up', T(2));
    castVote(db, 'S1', 'OTHER', ID['Brian Pascoe'], 'up', T(3));
    expect(stamped('S1')).toEqual({ PRIMARY: ['jon', 'tj'], OTHER: ['brian'] });
  });

  it('ignores everyone else’s upvotes and every downvote', () => {
    castVote(db, 'S1', 'PRIMARY', ID['Sarah Zucker'], 'up', T(1));
    castVote(db, 'S1', 'OTHER', matt(), 'down', T(2));
    expect(stamped('S1')).toEqual({});
    expect(tallies(db, 'S1').every((t) => t.stampers.length === 0)).toBe(true);
  });
});

describe('messages', () => {
  const matt = () => ID['Matt Mariani'];

  it('queues pending and stays out of the page until approved', () => {
    const { id } = submitMessage(db, 'S1', 'PRIMARY', matt(), 'this one rules', T(1));
    expect(approvedMessages(db, 'S1')).toEqual([]);
    expect(queuedMessages(db, 'S1')).toMatchObject([{ id, text: 'this one rules', playerName: 'Matt Mariani' }]);
    expect(decideMessage(db, id, 'approved', T(2))).toBe(true);
    expect(approvedMessages(db, 'S1')).toMatchObject([{ id, status: 'approved', decidedAt: T(2) }]);
    expect(queuedMessages(db, 'S1')).toEqual([]);
  });

  it('never shows a denied message', () => {
    const { id } = submitMessage(db, 'S1', 'PRIMARY', matt(), 'nope', T(1));
    decideMessage(db, id, 'denied', T(2));
    expect(approvedMessages(db, 'S1')).toEqual([]);
    expect(queuedMessages(db, 'S1')).toEqual([]);
  });

  it('decides a message once — a second release changes nothing', () => {
    const { id } = submitMessage(db, 'S1', 'PRIMARY', matt(), 'ok', T(1));
    decideMessage(db, id, 'denied', T(2));
    expect(decideMessage(db, id, 'approved', T(3))).toBe(false);
    expect(approvedMessages(db, 'S1')).toEqual([]);
  });

  it('rejects empty and over-long text, and trims what it keeps', () => {
    expect(() => submitMessage(db, 'S1', 'PRIMARY', matt(), '   ', T(1))).toThrow(MessageRejected);
    expect(() => submitMessage(db, 'S1', 'PRIMARY', matt(), 'x'.repeat(501), T(1))).toThrow(MessageRejected);
    submitMessage(db, 'S1', 'PRIMARY', matt(), '  spaced  ', T(1));
    expect(submitMessage(db, 'S1', 'PRIMARY', matt(), 'y'.repeat(500), T(2)).id).toBeGreaterThan(0);
    expect(queuedMessages(db, 'S1')[0].text).toBe('spaced');
  });
});

describe('readModel', () => {
  it('carries this round’s votes and approved messages, and nothing else’s', () => {
    castVote(db, 'S1', 'PRIMARY', ID['Matt Mariani'], 'up', T(1));
    castVote(db, 'S2', 'R2VIDEO', ID['Grant Koziol'], 'up', T(2));
    const mine = submitMessage(db, 'S1', 'PRIMARY', ID['Matt Mariani'], 'mine', T(3));
    const theirs = submitMessage(db, 'S2', 'R2VIDEO', ID['Grant Koziol'], 'theirs', T(4));
    decideMessage(db, mine.id, 'approved', T(5));
    decideMessage(db, theirs.id, 'approved', T(6));

    const model = readModel(db, 'S1')!;
    expect(model.tallies).toEqual([{ videoId: 'PRIMARY', up: 1, down: 0, stampers: ['matt'] }]);
    expect(model.messages.map((m) => m.text)).toEqual(['mine']);
  });

  it('is null for an unknown slug', () => {
    expect(readModel(db, 'nope')).toBeNull();
  });
});
