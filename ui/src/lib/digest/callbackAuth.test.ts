import { describe, it, expect } from 'vitest';
import { bearerOk } from './callbackAuth.js';

describe('bearerOk', () => {
  it('accepts a matching bearer', () => {
    expect(bearerOk('Bearer abc', 'abc')).toBe(true);
  });
  it('rejects a mismatched bearer', () => {
    expect(bearerOk('Bearer wrong', 'abc')).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(bearerOk(null, 'abc')).toBe(false);
  });
  it('rejects when no expected secret is configured (fail closed)', () => {
    expect(bearerOk('Bearer abc', undefined)).toBe(false);
  });
});
