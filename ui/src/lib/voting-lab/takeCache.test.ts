import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedTake, setCachedTake, clearTakeCache } from './takeCache.js';

const take = { headline: 'x' } as never; // shape is irrelevant to the cache

describe('takeCache', () => {
  beforeEach(() => clearTakeCache());

  it('returns null for an unknown song', () => {
    expect(getCachedTake(1, 'spotify:track:a')).toBeNull();
  });

  it('round-trips a take', () => {
    setCachedTake(1, 'spotify:track:a', take);
    expect(getCachedTake(1, 'spotify:track:a')).toBe(take);
  });

  // DISCRIMINATING: a cache keyed on spotifyUri alone would return round 1's
  // take for round 2 and fail this.
  it('keys on round AND song, not song alone', () => {
    setCachedTake(1, 'spotify:track:a', take);
    expect(getCachedTake(2, 'spotify:track:a')).toBeNull();
  });

  it('overwrites on regenerate', () => {
    const second = { headline: 'y' } as never;
    setCachedTake(1, 'spotify:track:a', take);
    setCachedTake(1, 'spotify:track:a', second);
    expect(getCachedTake(1, 'spotify:track:a')).toBe(second);
  });
});
