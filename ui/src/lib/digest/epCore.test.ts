import { describe, it, expect } from 'vitest';
import { bucketBySkip, placeCovers } from './epCore.js';

describe('bucketBySkip', () => {
  it('splits at a skip boundary', () => {
    expect(bucketBySkip(['a', 'b', 'c'], { b: true }, ['a', 'b', 'c']))
      .toEqual([['a', 'b'], ['c']]);
  });

  it('drops inactive members but still fires their boundary (OQ-2)', () => {
    // `b` is the skip anchor and is inactive; the boundary must still split.
    expect(bucketBySkip(['a', 'b', 'c'], { b: true }, ['a', 'c']))
      .toEqual([['a'], ['c']]);
  });

  it('returns one bucket when there are no skips', () => {
    expect(bucketBySkip(['a', 'b'], {}, ['a', 'b'])).toEqual([['a', 'b']]);
  });

  it('elides a bucket that ends up empty', () => {
    expect(bucketBySkip(['a', 'b'], { a: true }, ['b'])).toEqual([['b']]);
  });
});

describe('placeCovers', () => {
  it('places a cover in the EP after its original', () => {
    const m = placeCovers([['a', 'b'], ['c']], [{ of: 'a' }]);
    expect(m.get(1)).toEqual([{ of: 'a' }]);
  });

  it('places a cover of a last-EP track in a trailing EP', () => {
    const m = placeCovers([['a']], [{ of: 'a' }]);
    expect(m.get(1)).toEqual([{ of: 'a' }]);
  });

  it('drops a cover whose original is inactive', () => {
    expect(placeCovers([['a']], [{ of: 'zzz' }]).size).toBe(0);
  });
});
