import { describe, it, expect } from 'vitest';
import {
  pointIntensity,
  buildCallouts,
  driftGeometry,
  normalizeGenre,
  topGenres,
  tornadoBars,
  DRIFT_W,
  DRIFT_H,
  type Matrix,
  type DriftRound,
} from './viz';

describe('pointIntensity', () => {
  it('0 for non-positive', () => {
    expect(pointIntensity(0, 26)).toBe(0);
    expect(pointIntensity(-2, 26)).toBe(0);
  });
  it('ramps 1..5 across the range', () => {
    expect(pointIntensity(1, 26)).toBe(1);
    expect(pointIntensity(26, 26)).toBe(5);
    expect(pointIntensity(13, 26)).toBe(3);
  });
  it('caps at 5 and guards maxPoints=0', () => {
    expect(pointIntensity(99, 26)).toBe(5);
    expect(pointIntensity(3, 0)).toBe(5);
  });
});

describe('buildCallouts', () => {
  const roster = ['A', 'B', 'C'];
  // A→B strongest (26), B→C obscure (10 @ obsc 70)
  const matrix: Matrix = [
    [null, { points: 26, count: 9, obscurity: 40, energy: 50 }, { points: 5, count: 3, obscurity: 30, energy: 40 }],
    [{ points: 8, count: 5, obscurity: 55, energy: 60 }, null, { points: 10, count: 6, obscurity: 70, energy: 45 }],
    [{ points: 2, count: 2, obscurity: 20, energy: 30 }, { points: 3, count: 2, obscurity: 25, energy: 35 }, null],
  ];

  it('surfaces the strongest one-way bond first', () => {
    const [bond] = buildCallouts(matrix, roster);
    expect(bond.tag).toBe('strongest bond');
    expect(bond.text).toBe('A → B: 26 pts across 9 votes — the single strongest one-way relationship in the league.');
  });

  it('surfaces the strongest obscurity≥60 pairing', () => {
    const [, obscure] = buildCallouts(matrix, roster);
    expect(obscure.tag).toBe('rewards obscure');
    expect(obscure.text).toContain('B → C: 10 pts at avg obscurity 70');
  });

  it('falls back when no obscure pair exists', () => {
    const low: Matrix = [
      [null, { points: 4, count: 2, obscurity: 30, energy: 40 }],
      [{ points: 2, count: 1, obscurity: 20, energy: 30 }, null],
    ];
    const [, obscure] = buildCallouts(low, ['A', 'B']);
    expect(obscure.text).toBe('no strong obscure-leaning pair found this scope.');
  });

  it('returns empty when there are no voted edges', () => {
    const empty: Matrix = [
      [null, { points: null, count: 0, obscurity: null, energy: null }],
      [{ points: null, count: 0, obscurity: null, energy: null }, null],
    ];
    expect(buildCallouts(empty, ['A', 'B'])).toEqual([]);
  });
});

describe('driftGeometry', () => {
  const rounds: DriftRound[] = [
    { season: 1, medianObsc: 50, winners: [40], seasonStart: true },
    { season: 1, medianObsc: 60, winners: [80], seasonStart: false },
    { season: 2, medianObsc: 30, winners: [20, 72], seasonStart: true }, // tie → 2 dots
  ];

  it('uses the documented viewBox', () => {
    const g = driftGeometry(rounds);
    expect([g.width, g.height]).toEqual([DRIFT_W, DRIFT_H]);
  });

  it('renders one winner dot per winner, so a tie yields two at the same x', () => {
    const g = driftGeometry(rounds);
    expect(g.winnerDots).toHaveLength(4); // 1 + 1 + 2
    const lastTwo = g.winnerDots.slice(-2);
    expect(lastTwo[0].x).toBeCloseTo(lastTwo[1].x, 5); // same round x
    expect(lastTwo[0].y).not.toBeCloseTo(lastTwo[1].y, 1); // different obscurity
  });

  it('closes the median area to the obscurity-0 baseline', () => {
    const g = driftGeometry(rounds);
    // first and last polygon points sit on the baseline (y for obsc 0)
    const pts = g.medianAreaPolygon.split(' ');
    const baselineY = pts[0].split(',')[1];
    expect(pts[pts.length - 1].split(',')[1]).toBe(baselineY);
  });

  it('marks a boundary at each season start', () => {
    const g = driftGeometry(rounds);
    expect(g.seasonBoundaries.map((b) => b.label)).toEqual(['S1', 'S2']);
  });

  it('centers a single-round scope without dividing by zero', () => {
    const g = driftGeometry([{ season: 1, medianObsc: 50, winners: [50], seasonStart: true }]);
    expect(g.winnerDots[0].x).toBeCloseTo((DRIFT_W - 20) / 2 + 10, 5);
    expect(Number.isFinite(g.winnerDots[0].x)).toBe(true);
  });
});

describe('normalizeGenre', () => {
  it('merges near-duplicates into the curated taxonomy', () => {
    expect(normalizeGenre('Hip-Hop')).toBe('hip-hop');
    expect(normalizeGenre('hip hop')).toBe('hip-hop');
    expect(normalizeGenre('rap')).toBe('hip-hop');
    expect(normalizeGenre('alternative')).toBe('alt rock');
    expect(normalizeGenre('alternative rock')).toBe('alt rock');
    expect(normalizeGenre('metalcore')).toBe('metal');
    expect(normalizeGenre('classic rock')).toBe('rock');
  });
  it('keeps canonical genres as themselves', () => {
    expect(normalizeGenre('rock')).toBe('rock');
    expect(normalizeGenre('new wave')).toBe('new wave');
  });
  it('drops era/mood/demographic/artist noise', () => {
    for (const junk of ['80s', '90s', 'female vocalists', 'love', 'british', 'radiohead', 'seen live', '']) {
      expect(normalizeGenre(junk)).toBeNull();
    }
  });
  it('is case/space insensitive', () => {
    expect(normalizeGenre('  ALT   Rock ')).toBe('alt rock');
  });
});

describe('topGenres', () => {
  it('picks top-N by combined submit+vote frequency', () => {
    const sub = { rock: 5, pop: 1, metal: 0 };
    const vote = { 'hip-hop': 4, pop: 2, metal: 1 };
    expect(topGenres(sub, vote, 3)).toEqual(['rock', 'hip-hop', 'pop']);
  });
});

describe('tornadoBars', () => {
  it('computes submit/vote share percentages', () => {
    const bars = tornadoBars(
      ['rock', 'hip-hop'],
      { rock: 1, 'hip-hop': 0 },
      11,
      { rock: 0, 'hip-hop': 4 },
      10,
    );
    expect(bars).toEqual([
      { label: 'rock', submitPct: 9, votePct: 0 },
      { label: 'hip-hop', submitPct: 0, votePct: 40 },
    ]);
  });
  it('guards zero totals', () => {
    expect(tornadoBars(['rock'], {}, 0, {}, 0)).toEqual([{ label: 'rock', submitPct: 0, votePct: 0 }]);
  });
});
