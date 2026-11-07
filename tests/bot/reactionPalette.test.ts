import { describe, expect, it } from 'vitest';
import { PALETTE, loadPalette } from '../../src/bot/reactionPalette.js';
import { CMU_SIGNAL_EMOJIS } from '../../src/bot/catchMeUp.js';

describe('reaction palette', () => {
  it('has unique ids, ≥3 emojis per category, no duplicates, 100–300 total', () => {
    const ids = PALETTE.categories.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of PALETTE.categories) expect(c.emojis.length).toBeGreaterThanOrEqual(3);
    expect(new Set(PALETTE.all).size).toBe(PALETTE.all.length);
    expect(PALETTE.all.length).toBeGreaterThanOrEqual(100);
    expect(PALETTE.all.length).toBeLessThanOrEqual(300);
  });
  it('contains none of the bot signal emojis', () => {
    for (const e of CMU_SIGNAL_EMOJIS) expect(PALETTE.all).not.toContain(e);
  });
  it('fallback pool is dying-laughing + hype minus zwj and death emojis', () => {
    expect(PALETTE.fallbackPool).toContain('😂');
    expect(PALETTE.fallbackPool).toContain('🎉');
    for (const e of ['🪦', '⚰️', '☠️', '😵‍💫', '🫨']) expect(PALETTE.fallbackPool).not.toContain(e);
    expect(PALETTE.fallbackPool.every((e) => PALETTE.all.includes(e))).toBe(true);
  });
  it('rejects a palette with a duplicate emoji or a reserved emoji', () => {
    expect(() => loadPalette({ categories: [{ id: 'a', describe: 'x', emojis: ['😂', '😂', '🎉'] }] })).toThrow();
    expect(() => loadPalette({ categories: [{ id: 'a', describe: 'x', emojis: ['😂', '👍', '🎉'] }] })).toThrow();
  });
});
