import { describe, it, expect } from 'vitest';
import { seedRound } from './fixtures.js';
import { getMeCompetitorId, setMeCompetitorId, resolveMeForRound } from './meCompetitor.js';

describe('me-competitor resolution', () => {
  it('returns null when the league has no setting yet', () => {
    const { db } = seedRound();
    expect(getMeCompetitorId(db, 'boarz-ii-men')).toBeNull();
  });

  it('round-trips a competitor id for a league', () => {
    const { db } = seedRound();
    setMeCompetitorId(db, 'boarz-ii-men', 3);
    expect(getMeCompetitorId(db, 'boarz-ii-men')).toBe(3);
  });

  it('keeps leagues independent — the same person is a different id per league', () => {
    const { db } = seedRound();
    setMeCompetitorId(db, 'boarz-ii-men', 3);
    setMeCompetitorId(db, 'second-best', 17);
    expect(getMeCompetitorId(db, 'boarz-ii-men')).toBe(3);
    expect(getMeCompetitorId(db, 'second-best')).toBe(17);
  });

  it('overwrites rather than duplicating on a second set', () => {
    const { db } = seedRound();
    setMeCompetitorId(db, 'boarz-ii-men', 3);
    setMeCompetitorId(db, 'boarz-ii-men', 4);
    expect(getMeCompetitorId(db, 'boarz-ii-men')).toBe(4);
    const n = db.prepare("SELECT COUNT(*) AS c FROM settings WHERE key LIKE 'guess_me_competitor:%'")
      .get() as { c: number };
    expect(n.c).toBe(1);
  });

  it('resolves from a round id via its league', () => {
    const { db } = seedRound(); // seeds league slug 'boarz-ii-men', round 1
    setMeCompetitorId(db, 'boarz-ii-men', 3);
    expect(resolveMeForRound(db, 1)).toBe(3);
  });

  it('returns null for a round whose league has no setting', () => {
    const { db } = seedRound();
    expect(resolveMeForRound(db, 1)).toBeNull();
  });
});
