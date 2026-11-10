import { describe, expect, it } from 'vitest';
import { scoreGuessComment } from './guesserInsights.js';

// Toy matcher: first known name in the text wins.
const ids: Record<string, number> = { koziol: 30, berto: 69, jensen: 34 };
const matcher = (c: string) => {
  for (const w of c.toLowerCase().split(/[^a-z]+/)) if (ids[w]) return ids[w];
  return null;
};

describe('scoreGuessComment', () => {
  it('gives half credit when either side of "X or Y" is the submitter', () => {
    expect(scoreGuessComment(matcher, 'Koziol or Berto', 30)).toEqual({ guessed: [30, 69], credit: 0.5 });
    expect(scoreGuessComment(matcher, 'Koziol or Berto', 69)).toEqual({ guessed: [30, 69], credit: 0.5 });
  });
  it('gives nothing when neither side is the submitter', () => {
    expect(scoreGuessComment(matcher, 'Koziol or Berto', 34)).toEqual({ guessed: [30, 69], credit: 0 });
  });
  it('keeps full credit for a single-name guess', () => {
    expect(scoreGuessComment(matcher, 'Jensen?', 34)).toEqual({ guessed: [34], credit: 1 });
  });
  it('treats "or" with only one name as a normal guess', () => {
    expect(scoreGuessComment(matcher, 'Koziol or maybe not', 30)).toEqual({ guessed: [30], credit: 1 });
  });
  it('returns null when no name is found', () => {
    expect(scoreGuessComment(matcher, 'great song', 30)).toBeNull();
  });
});
