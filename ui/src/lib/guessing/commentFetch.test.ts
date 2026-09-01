import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { applyComments } from './commentFetch.js';

const NOW = '2026-09-01T00:00:00Z';

describe('applyComments', () => {
  it('writes comments onto the matching submissions', () => {
    const { db, songs } = seedRound({ songCount: 3 });
    const res = applyComments(db, 1, {
      ok: true,
      songs: [{ spotifyUri: songs[1], comment: 'a real comment' }],
    }, NOW);
    expect(res.updated).toBe(1);
    const row = db.prepare(
      'SELECT comment FROM ml_submissions WHERE round_id = 1 AND spotify_uri = ?',
    ).get(songs[1]) as { comment: string | null };
    expect(row.comment).toBe('a real comment');
  });

  // DISCRIMINATING: song 0 gets no comment in the payload. An implementation
  // that writes NULL for every song (rather than only the ones it was given)
  // would wipe an existing comment and fail this.
  it('leaves songs absent from the payload untouched', () => {
    const { db, songs } = seedRound({ songCount: 3 });
    db.prepare('UPDATE ml_submissions SET comment = ? WHERE round_id = 1 AND spotify_uri = ?')
      .run('pre-existing', songs[0]);
    applyComments(db, 1, { ok: true, songs: [{ spotifyUri: songs[1], comment: 'x' }] }, NOW);
    const row = db.prepare(
      'SELECT comment FROM ml_submissions WHERE round_id = 1 AND spotify_uri = ?',
    ).get(songs[0]) as { comment: string | null };
    expect(row.comment).toBe('pre-existing');
  });

  // DISCRIMINATING: the producer's REAL payload shape. ml_vote_parse.py emits
  // every song on the ballot, with comment: null for the ones with no visible
  // comment (its own fixture: 10 songs, 2 comments). A plain
  // `SET comment = ?` writes those nulls over comments the zip import already
  // stored — including ones the submitter hid from voters — on any backfill or
  // rehearsal replay. Only COALESCE(?, comment) passes this.
  it('never clears an existing comment when the ballot shows none', () => {
    const { db, songs } = seedRound({ songCount: 3 });
    db.prepare('UPDATE ml_submissions SET comment = ? WHERE round_id = 1 AND spotify_uri = ?')
      .run('hidden from voters, kept in the export', songs[0]);
    // Producer shape: every song present, null where the ballot showed nothing.
    const res = applyComments(db, 1, {
      ok: true,
      songs: [
        { spotifyUri: songs[0], comment: null },
        { spotifyUri: songs[1], comment: null },
        { spotifyUri: songs[2], comment: 'a visible one' },
      ],
    }, NOW);
    const rows = db.prepare(
      'SELECT spotify_uri, comment FROM ml_submissions WHERE round_id = 1 ORDER BY spotify_uri',
    ).all() as { spotify_uri: string; comment: string | null }[];
    expect(rows.find((r) => r.spotify_uri === songs[0])!.comment)
      .toBe('hidden from voters, kept in the export');
    expect(rows.find((r) => r.spotify_uri === songs[1])!.comment).toBeNull();
    expect(rows.find((r) => r.spotify_uri === songs[2])!.comment).toBe('a visible one');
    // Loud-failure property survives COALESCE: matched rows still count.
    expect(res.unmatched).toEqual([]);
  });

  it('stamps comments_fetched_at and clears any prior error on success', () => {
    const { db, songs } = seedRound({ songCount: 2 });
    applyComments(db, 1, { ok: false, error: 'boom' }, NOW);
    applyComments(db, 1, { ok: true, songs: [{ spotifyUri: songs[0], comment: 'c' }] }, NOW);
    const s = db.prepare(
      'SELECT comments_fetched_at, comments_error FROM guess_round_state WHERE round_id = 1',
    ).get() as { comments_fetched_at: string | null; comments_error: string | null };
    expect(s.comments_fetched_at).toBe(NOW);
    expect(s.comments_error).toBeNull();
  });

  // §7.2: a failed scrape is recorded, never thrown.
  it('records a failure without throwing and without stamping fetched_at', () => {
    const { db } = seedRound({ songCount: 2 });
    expect(() => applyComments(db, 1, { ok: false, error: 'session expired' }, NOW)).not.toThrow();
    const s = db.prepare(
      'SELECT comments_fetched_at, comments_error FROM guess_round_state WHERE round_id = 1',
    ).get() as { comments_fetched_at: string | null; comments_error: string | null };
    expect(s.comments_fetched_at).toBeNull();
    expect(s.comments_error).toBe('session expired');
  });

  it('reports uris it could not match rather than failing', () => {
    const { db } = seedRound({ songCount: 2 });
    const res = applyComments(db, 1, {
      ok: true, songs: [{ spotifyUri: 'spotify:track:ghost', comment: 'c' }],
    }, NOW);
    expect(res.updated).toBe(0);
    expect(res.unmatched).toEqual(['spotify:track:ghost']);
  });
});
