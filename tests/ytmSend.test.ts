import { describe, expect, it, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureVideoReviewSchema, upsertReview, getReview, claimApproval, applyDecisions,
  markPlaylistBuilt, type VideoPick,
} from '../ui/src/lib/ytm/videoReview.js';
import { DEFAULT_VIDEO_PLAYLIST_CONFIG } from '../ui/src/lib/db/videoPlaylist.js';

const T0 = '2026-09-07T20:00:00.000Z';
const CFG = { ...DEFAULT_VIDEO_PLAYLIST_CONFIG, enabled: true };

function pick(over: Partial<VideoPick>): VideoPick {
  return {
    title: 't', artists: 'a', spotifyUri: 'u:1', source: 'search', score: 80, band: 'auto',
    candidates: [{ videoId: 'V1', title: 'v', channel: 'c', score: 80 }],
    chosen: ['V1'], included: true, decided: true, reason: null, ...over,
  };
}

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec('CREATE TABLE rounds (id INTEGER PRIMARY KEY); INSERT INTO rounds (id) VALUES (141)');
  ensureVideoReviewSchema(db);
  upsertReview(db, {
    roundId: 141, leagueId: 3, picks: [pick({})], config: CFG,
    target: 'g@g.us', audioUrl: 'https://music.youtube.com/playlist?list=A', audioSent: true,
  }, T0);
});

describe('a built playlist survives a failed send', () => {
  it('markPlaylistBuilt records the url without calling the round done', () => {
    markPlaylistBuilt(db, 141, 'https://www.youtube.com/playlist?list=V', T0);
    const r = getReview(db, 141)!;
    // The distinction that matters: the playlist exists, the round does not.
    expect(r.videoUrl).toBe('https://www.youtube.com/playlist?list=V');
    expect(r.status).not.toBe('sent');
  });

  it('is what a retry reads, so it does not build a second playlist', async () => {
    // The 2026-09-07 failure: YouTube succeeded, WhatsApp was wedged, and the
    // url was discarded — so the retry orphaned the first playlist.
    claimApproval(db, getReview(db, 141)!.token!, () => T0);
    markPlaylistBuilt(db, 141, 'https://www.youtube.com/playlist?list=FIRST', T0);

    const { completeApproval } = await import('../ui/src/lib/ytm/send.js');
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return { ok: true, status: 200, text: async () => '', json: async () => ({}) } as unknown as Response;
    });
    const res = await completeApproval(db, 141, {
      roundName: 'r', leagueTitle: 'l', fetchFn: fetchFn as never, now: () => T0,
    });
    expect(res.videoUrl).toBe('https://www.youtube.com/playlist?list=FIRST');
    expect(calls.some((u) => u.includes('googleapis.com'))).toBe(false);
    expect(getReview(db, 141)!.status).toBe('sent');
  });
});

describe('an approved review with nothing selected', () => {
  it('is a decision, not an error: no playlist, no message', async () => {
    applyDecisions(db, 141, [{ spotifyUri: 'u:1', chosen: [] }], T0);
    claimApproval(db, getReview(db, 141)!.token!, () => T0);
    const { completeApproval } = await import('../ui/src/lib/ytm/send.js');
    const fetchFn = vi.fn();
    const res = await completeApproval(db, 141, {
      roundName: 'r', leagueTitle: 'l', fetchFn: fetchFn as never, now: () => T0,
    });
    expect(res.sent).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getReview(db, 141)!.status).toBe('sent');
  });
});
