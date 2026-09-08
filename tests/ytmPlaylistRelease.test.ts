import { describe, expect, it, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensurePlaylistSchema, submitMessage, messageByToken, claimMessage,
  queuedMessages, approvedMessages,
} from '../ui/src/lib/ytm/playlistVotes.js';
import { ensureVideoReviewSchema, upsertReview } from '../ui/src/lib/ytm/videoReview.js';

const T0 = '2026-09-08T03:00:00.000Z';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  // approveMessage walks slug → review → round → league to build the WhatsApp
  // post, so the fixture has to carry that whole chain, not just the message.
  db.exec(`
    CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO players (id, name) VALUES (1, 'Matt Mariani');
    CREATE TABLE leagues (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO leagues (id, name) VALUES (3, 'Second Best');
    CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER);
    INSERT INTO seasons (id, league_id) VALUES (9, 3);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER, name TEXT, round_number INTEGER);
    INSERT INTO rounds (id, season_id, name, round_number) VALUES (141, 9, 'Captain Jack Sparrow', 141);
    CREATE TABLE season_players (season_id INTEGER, player_id INTEGER);
    INSERT INTO season_players (season_id, player_id) VALUES (9, 1);
  `);
  ensureVideoReviewSchema(db);
  ensurePlaylistSchema(db);
  upsertReview(db, {
    roundId: 141, leagueId: 3, target: 'g@g.us', audioUrl: null, audioSent: true,
    config: { enabled: true, useComments: true, useSearch: true, searchAutoAcceptPct: 70, hilPct: 40 },
    picks: [{
      title: 'Where Is My Mind?', artists: 'Pixies', spotifyUri: 'u:1', source: 'search',
      score: 70, band: 'auto', candidates: [{ videoId: 'VID1', title: 'v', channel: 'c', score: 70 }],
      chosen: ['VID1'], included: true, decided: true, reason: null,
    }],
  }, T0);
  db.prepare('UPDATE ytm_video_reviews SET page_slug=? WHERE round_id=141').run('S1');
});

const put = (text = 'the low-budget green screen is elite') =>
  submitMessage(db, 'S1', 'VID1', '1', text, T0);

describe('a message carries a single-use approval token', () => {
  it('is minted on submit and resolves back to the message', () => {
    const { id, token } = put();
    expect(token).toBeTruthy();
    const m = messageByToken(db, token)!;
    expect(m.id).toBe(id);
    expect(m.playerName).toBe('Matt Mariani');
  });

  it('two messages never share a token', () => {
    expect(put('one').token).not.toBe(put('two').token);
  });

  it('is burned by a decision, so a second tap does nothing', () => {
    // The property that stops a double-tap on the notification posting twice.
    const { id, token } = put();
    expect(claimMessage(db, token, 'approved', T0)).not.toBeNull();
    expect(claimMessage(db, token, 'approved', T0)).toBeNull();
    // Assert the COLUMN, not the lookup: messageByToken also filters on
    // status, so it returns null either way and cannot see a live token left
    // behind on a decided message.
    const row = db.prepare('SELECT token FROM playlist_messages WHERE id=?').get(id) as { token: string | null };
    expect(row.token).toBeNull();
  });

  it('never resolves a token whose message is already decided', () => {
    const { id, token } = put();
    // Decide it WITHOUT clearing the token, which is the state a partial
    // implementation leaves behind.
    db.prepare("UPDATE playlist_messages SET status='approved' WHERE id=?").run(id);
    expect(messageByToken(db, token)).toBeNull();
  });

  it('cannot be claimed twice with different verdicts', () => {
    const { token } = put();
    claimMessage(db, token, 'denied', T0);
    expect(claimMessage(db, token, 'approved', T0)).toBeNull();
    expect(approvedMessages(db, 'S1')).toEqual([]);
  });

  it('rejects an unknown token', () => {
    expect(claimMessage(db, 'nope', 'approved', T0)).toBeNull();
  });
});

describe('what is public and what is not', () => {
  it('a submitted message is queued and NOT public', () => {
    put();
    expect(queuedMessages(db, 'S1')).toHaveLength(1);
    expect(approvedMessages(db, 'S1')).toEqual([]);
  });

  it('the public list is filtered by status, not merely by existence', () => {
    // Three messages, one per status: a list that ignores status returns all
    // three, and publishing a denied or pending message is the single worst
    // thing this flow can do.
    put('pending one');
    const a = put('approved one'); claimMessage(db, a.token, 'approved', T0);
    const d = put('denied one'); claimMessage(db, d.token, 'denied', T0);
    expect(approvedMessages(db, 'S1').map((m) => m.text)).toEqual(['approved one']);
    expect(queuedMessages(db, 'S1').map((m) => m.text)).toEqual(['pending one']);
  });

  it('approving moves it from the queue to the page, and only then', () => {
    const { token } = put();
    claimMessage(db, token, 'approved', T0);
    expect(queuedMessages(db, 'S1')).toEqual([]);
    expect(approvedMessages(db, 'S1')).toMatchObject([{ text: 'the low-budget green screen is elite' }]);
  });

  it('denying makes it public nowhere', () => {
    const { token } = put();
    claimMessage(db, token, 'denied', T0);
    expect(queuedMessages(db, 'S1')).toEqual([]);
    expect(approvedMessages(db, 'S1')).toEqual([]);
  });
});

describe('approveMessage posts before it rebuilds', () => {
  it('records the decision even when the WhatsApp send fails', async () => {
    // A wedged client must not un-approve a message or strand its token —
    // the decision is Matt's and it is already made.
    const { approveMessage } = await import('../ui/src/lib/ytm/playlistRelease.js');
    const { token } = put();
    const res = await approveMessage(db, token, {
      fetchFn: (async () => { throw new Error('client wedged'); }) as never,
      now: () => T0,
    });
    expect(res?.posted).toBe(false);
    expect(approvedMessages(db, 'S1')).toHaveLength(1);
  });

  it('returns null for a spent token rather than posting again', async () => {
    const { approveMessage } = await import('../ui/src/lib/ytm/playlistRelease.js');
    const { token } = put();
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response);
    await approveMessage(db, token, { fetchFn: fetchFn as never, now: () => T0 });
    const calls = fetchFn.mock.calls.length;
    expect(await approveMessage(db, token, { fetchFn: fetchFn as never, now: () => T0 })).toBeNull();
    expect(fetchFn.mock.calls.length).toBe(calls);
  });
});
