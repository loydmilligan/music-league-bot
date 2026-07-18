import { describe, it, expect } from 'vitest';
import { shouldRegenerate } from './draftForce.js';

describe('shouldRegenerate', () => {
  it('reuses cache when no params and not forced', () => {
    expect(shouldRegenerate(null, false)).toBe(false);
  });
  it('regenerates when forced even without params', () => {
    expect(shouldRegenerate(null, true)).toBe(true);
  });
  it('regenerates when params are present', () => {
    expect(shouldRegenerate({ sections: [{ id: 'podium', enabled: true }] } as never, false)).toBe(true);
  });
});
