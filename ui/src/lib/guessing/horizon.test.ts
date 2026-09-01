import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { visibleSubmissions } from './horizon.js';

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
