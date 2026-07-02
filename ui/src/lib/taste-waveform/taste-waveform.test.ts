import { describe, it, expect } from 'vitest';
import {
  tasteEngine, THEMES, ORDERS, DEFAULT_TASTE_SETTINGS,
  type LeagueData, type TasteSettings,
} from './taste-waveform.js';

// Minimal 2-player league. axes: [obscurity,energy,mood,tempo,lyrical].
// rows: [songIdx, interaction(0=sub,1=vote), points, roundId, hasComment, leagueId].
const LG: LeagueData = {
  axes: [[20, 80, 60, 70, 90], [80, 30, 40, 30, 10], [50, 50, 50, 50, 50]],
  players: [
    { name: 'Alice Ex', rows: [[0, 0, 0, 1, 0, 1], [1, 0, 0, 2, 0, 1]] },
    { name: 'Bob Ry',   rows: [[2, 0, 0, 1, 0, 1], [1, 0, 0, 2, 0, 1]] },
  ],
};
const S = (o: Partial<TasteSettings> = {}): TasteSettings => ({ ...DEFAULT_TASTE_SETTINGS, ...o });

describe('palette + order maps', () => {
  it('exposes the three palettes with a traits array and above color', () => {
    for (const p of ['neon', 'cool', 'spectrum'] as const) {
      expect(THEMES[p].traits).toHaveLength(6);
      expect(THEMES[p].above).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(THEMES.neon.traits[0]).toBe('#ff5bbe'); // == legacy TRAITS[0]
  });
  it('exposes the four axis orders', () => {
    expect(ORDERS.alt).toEqual([0, 4, 3, 2, 1]);
    expect(ORDERS.raw).toEqual([0, 1, 2, 3, 4]);
    expect(ORDERS['lyric-last']).toEqual([0, 2, 3, 1, 4]);
    expect(ORDERS['lyric-first']).toEqual([4, 0, 1, 2, 3]);
  });
});

describe('axis order changes chrome label sequence', () => {
  it('alt puts WORDY (axis4) before HYPE (axis1); raw reverses that', () => {
    const alt = tasteEngine(LG, S({ order: 'alt' })).buildChart(0, 322, 150, { chrome: true });
    const raw = tasteEngine(LG, S({ order: 'raw' })).buildChart(0, 322, 150, { chrome: true });
    expect(alt.indexOf('WORDY')).toBeLessThan(alt.indexOf('HYPE'));
    expect(raw.indexOf('HYPE')).toBeLessThan(raw.indexOf('WORDY'));
  });
});

describe('defaults preserve the current render', () => {
  it('default palette=neon, order=alt still draws the thick strand at width 4.5', () => {
    const svg = tasteEngine(LG, S()).buildChart(0, 322, 150);
    expect(svg).toContain('stroke-width="4.5"'); // strand stroke unchanged
  });
});
