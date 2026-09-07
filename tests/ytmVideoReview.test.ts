import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureVideoReviewSchema, upsertReview, getReview, getReviewByToken,
  applyDecisions, claimApproval, denyReview, snoozeReview, markSent, markFailed,
  undecidedPicks, includedVideoIds, reviewsDueForNotify, markNotified, SNOOZE_MS,
  type VideoPick,
} from '../ui/src/lib/ytm/videoReview.js';
import { DEFAULT_VIDEO_PLAYLIST_CONFIG } from '../ui/src/lib/db/videoPlaylist.js';

const CFG = { ...DEFAULT_VIDEO_PLAYLIST_CONFIG, enabled: true };
const T0 = '2026-09-07T20:00:00.000Z';

function pick(over: Partial<VideoPick>): VideoPick {
  return {
    title: 't', artists: 'a', spotifyUri: `spotify:track:${Math.random().toString(36).slice(2)}`,
    source: 'search', score: 50, band: 'review', candidates: [], chosen: null,
    included: false, decided: false, reason: null, ...over,
  };
}

const cand = (id: string, score = 50) => ({ videoId: id, title: id, channel: 'c', score });

// One of each band, in the order the drop resolves them.
function fixture(): VideoPick[] {
  return [
    pick({ spotifyUri: 'u:comment', band: 'certain', source: 'comment', score: 100,
           candidates: [cand('COMMENT1', 100)], chosen: 'COMMENT1', included: true, decided: true }),
    pick({ spotifyUri: 'u:auto', band: 'auto', score: 80,
           candidates: [cand('AUTO1', 80), cand('AUTO2', 55)], chosen: 'AUTO1', included: true, decided: true }),
    pick({ spotifyUri: 'u:review', band: 'review', score: 55,
           candidates: [cand('REV1', 55), cand('REV2', 40)], chosen: 'REV1', included: false, decided: false }),
    pick({ spotifyUri: 'u:sugg', band: 'suggestion', score: 30,
           candidates: [cand('SUG1', 30), cand('SUG2', 10)], chosen: null, included: false, decided: true }),
  ];
}

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec('CREATE TABLE rounds (id INTEGER PRIMARY KEY)');
  db.exec('INSERT INTO rounds (id) VALUES (143), (144)');
  ensureVideoReviewSchema(db);
  upsertReview(db, {
    roundId: 143, leagueId: 3, picks: fixture(), config: CFG,
    target: '120363428945055429@g.us', audioUrl: 'https://music.youtube.com/playlist?list=A', audioSent: true,
  }, T0);
});

describe('parking a review', () => {
  it('stores it pending with a token and round-trips the picks', () => {
    const r = getReview(db, 143)!;
    expect(r.status).toBe('pending');
    expect(r.token).toBeTruthy();
    expect(r.picks).toHaveLength(4);
    expect(r.audioSent).toBe(true);
    expect(getReviewByToken(db, r.token!)!.roundId).toBe(143);
  });

  it('refuses to reopen a round that already sent', () => {
    markSent(db, 143, 'https://www.youtube.com/playlist?list=V', T0);
    upsertReview(db, { roundId: 143, leagueId: 3, picks: [], config: CFG, target: 'x', audioUrl: null, audioSent: false }, T0);
    const r = getReview(db, 143)!;
    expect(r.status).toBe('sent');
    expect(r.picks).toHaveLength(4); // not clobbered by the empty re-resolve
  });

  it('refuses to reopen a denied round', () => {
    denyReview(db, getReview(db, 143)!.token!, () => T0);
    upsertReview(db, { roundId: 143, leagueId: 3, picks: [], config: CFG, target: 'x', audioUrl: null, audioSent: false }, T0);
    expect(getReview(db, 143)!.status).toBe('denied');
  });
});

describe('what goes in the playlist', () => {
  it('starts with the comment and auto picks only', () => {
    expect(includedVideoIds(getReview(db, 143)!.picks)).toEqual(['COMMENT1', 'AUTO1']);
  });

  it('never silently ships a suggestion', () => {
    const sugg = getReview(db, 143)!.picks.find((p) => p.band === 'suggestion')!;
    expect(sugg.chosen).toBeNull();
    expect(sugg.included).toBe(false);
  });

  it('de-duplicates a video chosen for two songs', () => {
    const picks = getReview(db, 143)!.picks.map((p) => ({ ...p, chosen: 'SAME', included: true }));
    expect(includedVideoIds(picks)).toEqual(['SAME']);
  });
});

describe('decisions', () => {
  it('answering a review pick unblocks it and can include it', () => {
    expect(undecidedPicks(getReview(db, 143)!.picks)).toHaveLength(1);
    applyDecisions(db, 143, [{ spotifyUri: 'u:review', chosen: 'REV2', included: true }], T0);
    const r = getReview(db, 143)!;
    expect(undecidedPicks(r.picks)).toHaveLength(0);
    expect(includedVideoIds(r.picks)).toEqual(['COMMENT1', 'AUTO1', 'REV2']);
  });

  it('"no video" is a real answer — it unblocks without including anything', () => {
    applyDecisions(db, 143, [{ spotifyUri: 'u:review', chosen: null }], T0);
    const r = getReview(db, 143)!;
    expect(undecidedPicks(r.picks)).toHaveLength(0);
    expect(includedVideoIds(r.picks)).toEqual(['COMMENT1', 'AUTO1']);
  });

  it('an auto pick can be removed', () => {
    applyDecisions(db, 143, [{ spotifyUri: 'u:auto', included: false }], T0);
    expect(includedVideoIds(getReview(db, 143)!.picks)).toEqual(['COMMENT1']);
  });

  it('a suggestion can be promoted, choosing among its candidates', () => {
    applyDecisions(db, 143, [{ spotifyUri: 'u:sugg', chosen: 'SUG2', included: true }], T0);
    expect(includedVideoIds(getReview(db, 143)!.picks)).toEqual(['COMMENT1', 'AUTO1', 'SUG2']);
  });

  it('refuses a videoId the pick never offered', () => {
    applyDecisions(db, 143, [{ spotifyUri: 'u:auto', chosen: 'INJECTED' }], T0);
    expect(getReview(db, 143)!.picks.find((p) => p.spotifyUri === 'u:auto')!.chosen).toBe('AUTO1');
  });

  it('including a pick with nothing chosen is treated as excluded', () => {
    applyDecisions(db, 143, [{ spotifyUri: 'u:sugg', included: true }], T0);
    const p = getReview(db, 143)!.picks.find((x) => x.spotifyUri === 'u:sugg')!;
    expect(p.included).toBe(false);
  });

  it('leaves untouched picks alone', () => {
    applyDecisions(db, 143, [{ spotifyUri: 'u:review', chosen: 'REV1', included: true }], T0);
    expect(getReview(db, 143)!.picks.find((p) => p.spotifyUri === 'u:comment')!.chosen).toBe('COMMENT1');
  });

  it('ignores decisions once the review is no longer pending', () => {
    applyDecisions(db, 143, [{ spotifyUri: 'u:review', chosen: 'REV1' }], T0);
    claimApproval(db, getReview(db, 143)!.token!, () => T0);
    applyDecisions(db, 143, [{ spotifyUri: 'u:auto', included: false }], T0);
    expect(getReview(db, 143)!.picks.find((p) => p.spotifyUri === 'u:auto')!.included).toBe(true);
  });
});

describe('approval', () => {
  it('is refused while a review pick is unanswered', () => {
    const res = claimApproval(db, getReview(db, 143)!.token!, () => T0);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('need a decision');
    expect(getReview(db, 143)!.status).toBe('pending');
  });

  it('succeeds once everything is decided, and consumes the token', () => {
    applyDecisions(db, 143, [{ spotifyUri: 'u:review', chosen: null }], T0);
    const token = getReview(db, 143)!.token!;
    expect(claimApproval(db, token, () => T0).ok).toBe(true);
    expect(getReview(db, 143)!.status).toBe('approved');
    // The double-tap that must not build a second playlist. The status guard
    // alone would stop it, so assert the token is genuinely BURNED too —
    // otherwise a live token outlives the decision it authorised.
    expect(getReview(db, 143)!.token).toBeNull();
    expect(getReviewByToken(db, token)).toBeNull();
    expect(claimApproval(db, token, () => T0).ok).toBe(false);
  });

  it('deny also burns the token, not just the status', () => {
    const token = getReview(db, 143)!.token!;
    denyReview(db, token, () => T0);
    expect(getReview(db, 143)!.token).toBeNull();
    expect(getReviewByToken(db, token)).toBeNull();
  });

  it('rejects an unknown token', () => {
    expect(claimApproval(db, 'nope', () => T0).ok).toBe(false);
  });
});

describe('deny and snooze', () => {
  it('deny keeps the picks and consumes the token', () => {
    const token = getReview(db, 143)!.token!;
    expect(denyReview(db, token, () => T0).ok).toBe(true);
    const r = getReview(db, 143)!;
    expect(r.status).toBe('denied');
    expect(r.picks).toHaveLength(4);
    expect(denyReview(db, token, () => T0).ok).toBe(false);
  });

  it('snooze sets a 4-hour deadline and KEEPS the token usable', () => {
    const token = getReview(db, 143)!.token!;
    const now = new Date(T0);
    expect(snoozeReview(db, token, () => now).ok).toBe(true);
    const r = getReview(db, 143)!;
    expect(r.status).toBe('pending');
    expect(r.token).toBe(token);
    expect(Date.parse(r.snoozeUntil!) - now.getTime()).toBe(SNOOZE_MS);
    // Still actionable from the old notification.
    applyDecisions(db, 143, [{ spotifyUri: 'u:review', chosen: null }], T0);
    expect(claimApproval(db, token, () => T0).ok).toBe(true);
  });
});

describe('re-notification', () => {
  it('a never-notified review is due immediately', () => {
    expect(reviewsDueForNotify(db, T0).map((r) => r.roundId)).toEqual([143]);
  });

  it('goes quiet once notified', () => {
    markNotified(db, 143, T0);
    expect(reviewsDueForNotify(db, T0)).toHaveLength(0);
  });

  it('comes back only after the snooze expires', () => {
    markNotified(db, 143, T0);
    const now = new Date(T0);
    snoozeReview(db, getReview(db, 143)!.token!, () => now);
    const justBefore = new Date(now.getTime() + SNOOZE_MS - 1000).toISOString();
    const justAfter = new Date(now.getTime() + SNOOZE_MS + 1000).toISOString();
    expect(reviewsDueForNotify(db, justBefore)).toHaveLength(0);
    expect(reviewsDueForNotify(db, justAfter).map((r) => r.roundId)).toEqual([143]);
  });

  it('never re-notifies an approved, denied or sent review', () => {
    for (const finish of [
      () => { applyDecisions(db, 143, [{ spotifyUri: 'u:review', chosen: null }], T0); claimApproval(db, getReview(db, 143)!.token!, () => T0); },
      () => denyReview(db, getReview(db, 143)!.token!, () => T0),
      () => markSent(db, 143, 'u', T0),
      () => markFailed(db, 143, 'boom', T0),
    ]) {
      db.prepare("UPDATE ytm_video_reviews SET status='pending', token='t', notified_at=NULL, snooze_until=NULL WHERE round_id=143").run();
      finish();
      expect(reviewsDueForNotify(db, '2100-01-01T00:00:00.000Z')).toHaveLength(0);
    }
  });
});
