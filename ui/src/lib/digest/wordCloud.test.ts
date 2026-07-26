import { describe, expect, it } from 'vitest';
import { getWordFrequencies } from './wordCloud';

describe('getWordFrequencies', () => {
  it('combines comments and chat, normalizes case, and removes noise', () => {
    const result = getWordFrequencies([
      { text: 'Dreamy, DREAMY chorus! https://example.com/track' },
      { text: 'The chorus feels dreamy — @alex 123' },
      'Café café café',
    ]);

    expect(result).toEqual([
      { word: 'cafe', count: 3, weight: 1 },
      { word: 'dreamy', count: 3, weight: 1 },
      { word: 'chorus', count: 2, weight: 2 / 3 },
      { word: 'feels', count: 1, weight: 1 / 3 },
    ]);
  });

  it('uses alphabetical ordering for equal counts', () => {
    expect(getWordFrequencies(['Bravo alpha CHARLIE'], { limit: 3 })).toEqual([
      { word: 'alpha', count: 1, weight: 1 },
      { word: 'bravo', count: 1, weight: 1 },
      { word: 'charlie', count: 1, weight: 1 },
    ]);
  });

  it('supports custom stopwords, limits, and apostrophes', () => {
    expect(
      getWordFrequencies(["Don't stop, don't stop, we're moving"], {
        limit: 2,
        stopwords: ["don't", 'stop'],
      }),
    ).toEqual([
      { word: 'moving', count: 1, weight: 1 },
      { word: "we're", count: 1, weight: 1 },
    ]);
  });

  it('returns an empty list for empty or invalid limits', () => {
    expect(getWordFrequencies([])).toEqual([]);
    expect(getWordFrequencies(['music everywhere'], { limit: 0 })).toEqual([]);
  });
});
