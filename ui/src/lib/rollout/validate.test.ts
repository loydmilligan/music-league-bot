import { describe, it, expect } from 'vitest';
import { isValidRollout } from './validate.js';
import { DEFAULT_ROLLOUT } from './defaults.js';

describe('isValidRollout', () => {
  it('accepts the default rollout', () => {
    expect(isValidRollout(DEFAULT_ROLLOUT)).toBe(true);
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 42, 'x', []]) expect(isValidRollout(v)).toBe(false);
  });

  it('rejects an empty order', () => {
    expect(isValidRollout({ ...DEFAULT_ROLLOUT, order: [] })).toBe(false);
  });

  it('rejects an order entry with no cut definition', () => {
    expect(isValidRollout({ ...DEFAULT_ROLLOUT, order: [...DEFAULT_ROLLOUT.order, 'ghost'] })).toBe(false);
  });

  it('rejects a duplicate cut id in order', () => {
    expect(isValidRollout({ ...DEFAULT_ROLLOUT, order: [...DEFAULT_ROLLOUT.order, 'capture'] })).toBe(false);
  });

  it('rejects a cover whose original is not a known cut', () => {
    expect(isValidRollout({ ...DEFAULT_ROLLOUT, covers: [{ of: 'nope', remaster: true }] })).toBe(false);
  });

  it('rejects an agent cut with runtime app', () => {
    const bad = structuredClone(DEFAULT_ROLLOUT) as unknown as Record<string, never>;
    (bad.cuts as Record<string, Record<string, unknown>>).ledes.runtime = 'app';
    expect(isValidRollout(bad)).toBe(false);
  });
});
