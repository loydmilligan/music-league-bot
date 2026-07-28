import { describe, expect, it } from 'vitest';
import { coerceTopSectionVariant, resolveTopSectionVariant } from './topSectionVariants.js';

const all = { hero: true, sound: true, race: true, language: true };

describe('top section variants', () => {
  it('normalizes missing or invalid values to auto', () => {
    expect(coerceTopSectionVariant(undefined)).toBe('auto');
    expect(coerceTopSectionVariant('scatter')).toBe('auto');
    expect(coerceTopSectionVariant('race')).toBe('race');
  });

  it('keeps an explicit available choice stable', () => {
    expect(resolveTopSectionVariant('sound', 136, all)).toBe('sound');
  });

  it('rotates auto choices deterministically', () => {
    expect(resolveTopSectionVariant('auto', 1, all)).toBe('sound');
    expect(resolveTopSectionVariant('auto', 1, all)).toBe('sound');
    expect(resolveTopSectionVariant('auto', 2, all)).toBe('race');
  });

  it('skips unavailable choices', () => {
    expect(resolveTopSectionVariant('race', 1, { hero: true, sound: true, race: false, language: true })).toBe('sound');
    expect(resolveTopSectionVariant('auto', 1, { hero: true, sound: false, race: true, language: true })).toBe('race');
  });
});
