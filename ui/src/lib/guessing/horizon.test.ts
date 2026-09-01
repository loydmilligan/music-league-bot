import { describe, it, expect } from 'vitest';
import { seedRound, seedPriorRound, seedVote, seedChat, CHAT_GROUP } from './fixtures.js';
import { visibleSubmissions, priorVotes, chatBefore } from './horizon.js';

describe('visible submissions (spec §14.3, §14.5)', () => {
  it('returns only comments that were visible to voters', () => {
    const { db, songs } = seedRound({ songCount: 4, mineIndex: null });
    db.prepare('UPDATE ml_submissions SET comment = ? WHERE spotify_uri = ?').run('shown', songs[0]);
    db.prepare('UPDATE ml_submissions SET comment = ?, visible_to_voters = 0 WHERE spotify_uri = ?')
      .run('hidden', songs[1]);

    const out = visibleSubmissions(db, 1);
    const byUri = new Map(out.map((s) => [s.spotifyUri, s]));
    expect(byUri.get(songs[0])!.comment).toBe('shown');
    expect(byUri.get(songs[1])!.comment).toBeNull();
  });

  it('still lists the song when its comment was not visible', () => {
    const { db, songs } = seedRound({ songCount: 4, mineIndex: null });
    db.prepare('UPDATE ml_submissions SET visible_to_voters = 0').run();
    const out = visibleSubmissions(db, 1);
    expect(out.map((s) => s.spotifyUri)).toEqual(songs);
    expect(out.every((s) => s.comment === null)).toBe(true);
  });

  it('never exposes submitter identity', () => {
    const { db } = seedRound({ songCount: 2, mineIndex: null });
    db.prepare('UPDATE ml_submissions SET competitor_id = 2').run();
    const out = visibleSubmissions(db, 1);
    for (const s of out) {
      expect(Object.keys(s)).toEqual(['spotifyUri', 'title', 'artists', 'comment']);
    }
  });

  it('returns playlist order', () => {
    const { db, songs } = seedRound({ songCount: 4, mineIndex: null });
    expect(visibleSubmissions(db, 1).map((s) => s.spotifyUri)).toEqual(songs);
  });
});

describe('prior votes (spec §14.3 — the trap)', () => {
  function setup() {
    const s = seedRound({ songCount: 3, playerCount: 4, mineIndex: null });
    // round 1 is the round under study; give it a deadline
    s.db.prepare("UPDATE rounds SET voting_deadline = '2026-02-01T00:00:00Z' WHERE id = 1").run();
    seedPriorRound(s.db, 2, '2026-01-01T00:00:00Z'); // earlier
    seedPriorRound(s.db, 3, '2026-03-01T00:00:00Z'); // later
    return s;
  }

  it('EXCLUDES the round under study by id, not by time', () => {
    const { db, songs } = setup();
    // cast BEFORE this round's own deadline — a naive `ts < asOf` clamp would leak it
    seedVote(db, 1, 2, songs[0], 'this is obviously steiny', '2026-01-15T00:00:00Z');
    expect(priorVotes(db, 1).map((v) => v.roundId)).not.toContain(1);
  });

  it('includes votes from strictly earlier rounds', () => {
    const { db, songs } = setup();
    seedVote(db, 2, 2, songs[0], 'earlier round', '2025-12-15T00:00:00Z');
    const out = priorVotes(db, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ roundId: 2, voterId: 2, comment: 'earlier round' });
  });

  it('excludes votes from later rounds', () => {
    const { db, songs } = setup();
    seedVote(db, 3, 2, songs[0], 'the future', '2026-02-15T00:00:00Z');
    expect(priorVotes(db, 1)).toEqual([]);
  });

  it('excludes rounds with no voting deadline', () => {
    const { db, songs } = setup();
    seedPriorRound(db, 4, null);
    seedVote(db, 4, 2, songs[0], 'undated', '2025-11-01T00:00:00Z');
    expect(priorVotes(db, 1).map((v) => v.roundId)).not.toContain(4);
  });
});

describe('chat horizon (spec §14.3)', () => {
  it('returns only messages strictly before the cutoff, oldest first', () => {
    const { db } = seedRound({ mineIndex: null });
    seedChat(db, CHAT_GROUP, 'A', 'before', '2026-01-01T00:00:00Z');
    seedChat(db, CHAT_GROUP, 'B', 'on the boundary', '2026-02-01T00:00:00Z');
    seedChat(db, CHAT_GROUP, 'C', 'after', '2026-03-01T00:00:00Z');

    const out = chatBefore(db, CHAT_GROUP, '2026-02-01T00:00:00Z');
    expect(out.map((m) => m.text)).toEqual(['before']);
  });

  it('ignores other groups', () => {
    const { db } = seedRound({ mineIndex: null });
    seedChat(db, CHAT_GROUP, 'A', 'ours', '2026-01-01T00:00:00Z');
    seedChat(db, 'Some Other Group', 'B', 'theirs', '2026-01-01T00:00:00Z');
    expect(chatBefore(db, CHAT_GROUP, '2026-02-01T00:00:00Z').map((m) => m.text)).toEqual(['ours']);
  });

  it('returns empty when chat_messages does not exist at all', () => {
    const { db } = seedRound({ mineIndex: null });
    expect(chatBefore(db, CHAT_GROUP, '2026-02-01T00:00:00Z')).toEqual([]);
  });
});
