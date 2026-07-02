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

describe('lineStyle', () => {
  const base = { chrome: false } as const;
  it('strand (default) draws the gradient strand at width 4.5', () => {
    expect(tasteEngine(LG, S({ lineStyle: 'strand' })).buildChart(0, 322, 150, base)).toContain('stroke-width="4.5"');
  });
  it('none omits the thick strand', () => {
    expect(tasteEngine(LG, S({ lineStyle: 'none' })).buildChart(0, 322, 150, base)).not.toContain('stroke-width="4.5"');
  });
  it('solid draws a flat above-color line at width 3', () => {
    const svg = tasteEngine(LG, S({ lineStyle: 'solid', palette: 'cool' })).buildChart(0, 322, 150, base);
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('#7fd0ff'); // cool.above, literal (not gradient)
  });
});

describe('nodeStyle', () => {
  it('glow (default) emits the r=8 halo circle', () => {
    expect(tasteEngine(LG, S({ nodeStyle: 'glow' })).buildChart(0, 322, 150, { chrome: false })).toContain('r="8"');
  });
  it('none emits no node circles', () => {
    const svg = tasteEngine(LG, S({ nodeStyle: 'none' })).buildChart(0, 322, 150, { chrome: false });
    expect(svg).not.toContain('r="8"');
    expect(svg).not.toContain('r="3.4"');
  });
  it('dot emits a single r=3.4 dot', () => {
    const svg = tasteEngine(LG, S({ nodeStyle: 'dot' })).buildChart(0, 322, 150, { chrome: false });
    expect(svg).toContain('r="3.4"');
    expect(svg).not.toContain('r="8"');
  });
});

describe('amplitude + band', () => {
  it('amplitude changes the geometry', () => {
    const a = tasteEngine(LG, S({ amplitude: 1.0 })).buildChart(0, 322, 150, { chrome: false });
    const b = tasteEngine(LG, S({ amplitude: 1.8 })).buildChart(0, 322, 150, { chrome: false });
    expect(a).not.toBe(b);
  });
  it('band draws a filled above-color area at bandOpacity', () => {
    const svg = tasteEngine(LG, S({ band: true, bandOpacity: 0.04, palette: 'neon' })).buildChart(0, 322, 150, { chrome: false });
    expect(svg).toContain('fill="#5affd0"');
    expect(svg).toContain('opacity="0.04"');
  });
});

describe('separation()', () => {
  it('returns 0 for a single-player league', () => {
    const solo: LeagueData = { axes: LG.axes, players: [LG.players[0]] };
    expect(tasteEngine(solo, S()).separation()).toBe(0);
  });
  it('is the mean pairwise sig6 distance (positive for distinct players)', () => {
    const sep = tasteEngine(LG, S()).separation();
    expect(sep).toBeGreaterThan(0);
    // two players → exactly one pair → equals that pair's distance
    const eng = tasteEngine(LG, S());
    const a = eng.sig6(0), b = eng.sig6(1);
    const d = Math.sqrt(a.reduce((s, _v, k) => s + (a[k] - b[k]) ** 2, 0));
    expect(sep).toBeCloseTo(d, 6);
  });
});
