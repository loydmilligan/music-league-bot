import { describe, it, expect } from 'vitest';
import { seasonArcCaption } from './GuesserLeaderboard.svelte';

/**
 * Review finding F6. The season arc is capped at the last 10 rounds, but
 * `seasonRate` averages the WHOLE season. The old caption read
 * "hit-rate over {bars.length} rounds" directly above "season avg N%", so once
 * a league passed 10 rounds the label claimed the average covered 10 rounds
 * when it covered more.
 *
 * The invariant: no reading of the caption may imply the average is over a
 * different set of rounds than it actually is.
 */
describe('seasonArcCaption', () => {
  it('names both sets once the arc is capped', () => {
    const c = seasonArcCaption(10, 14);
    expect(c).toBe('the season so far · last 10 of 14 rounds · average over all 14');
  });

  it('never states the on-screen bar count as the average’s round count', () => {
    // The specific F6 regression: "over 10 rounds" as the ONLY round count,
    // next to a 14-round average.
    const c = seasonArcCaption(10, 14);
    expect(c).not.toMatch(/over 10 rounds/);
    expect(c).not.toBe('the season so far · hit-rate over 10 rounds');
    // Whenever the two differ, the true total must be the number attached to
    // the average, and both counts must be present.
    expect(c).toContain('14');
    expect(c).toMatch(/average over all 14/);
  });

  it('stays simple when nothing was capped', () => {
    expect(seasonArcCaption(4, 4)).toBe('the season so far · hit-rate over 4 rounds');
    expect(seasonArcCaption(10, 10)).toBe('the season so far · hit-rate over 10 rounds');
  });

  it('holds the invariant across the whole cap boundary', () => {
    // For every season length, the count the caption attaches to the average
    // must equal the true season total, never the (possibly smaller) bar count.
    for (let total = 1; total <= 40; total++) {
      const shown = Math.min(total, 10);
      const caption = seasonArcCaption(shown, total);
      if (total > shown) {
        expect(caption).toMatch(new RegExp(`average over all ${total}$`));
        expect(caption).toContain(`last ${shown} of ${total} rounds`);
      } else {
        expect(caption).toBe(`the season so far · hit-rate over ${total} rounds`);
      }
    }
  });

  it('degrades safely at zero', () => {
    expect(seasonArcCaption(0, 0)).toBe('the season so far · hit-rate over 0 rounds');
  });
});
