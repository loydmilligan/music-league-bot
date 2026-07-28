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

  it('adds extraStopwords on top of the built-in list instead of replacing it', () => {
    // 'this' and 'would' are built-ins; 'karaoke' is per-round noise.
    expect(
      getWordFrequencies(['This would be a karaoke chorus, this chorus'], {
        extraStopwords: ['karaoke'],
      }),
    ).toEqual([{ word: 'chorus', count: 2, weight: 1 }]);
  });

  it('keeps built-in stopwords out when the caller supplies round noise', () => {
    const words = getWordFrequencies(
      ['and the song would be good, but this song is only about her'],
      { extraStopwords: ['song'] },
    ).map((entry) => entry.word);
    expect(words).not.toContain('and');
    expect(words).not.toContain('this');
    expect(words).not.toContain('would');
    expect(words).not.toContain('song');
    expect(words).toContain('good');
  });

  it('returns an empty list for empty or invalid limits', () => {
    expect(getWordFrequencies([])).toEqual([]);
    expect(getWordFrequencies(['music everywhere'], { limit: 0 })).toEqual([]);
  });
});
