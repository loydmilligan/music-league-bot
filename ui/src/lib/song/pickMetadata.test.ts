import { describe, it, expect } from 'vitest';
import {
  RING_CIRCUMFERENCE,
  ringOffset,
  opacityTier,
  formatDuration,
  buildIndicators,
  pointsLabel,
  lyricsHeadline,
  artInitial,
  type PickSignals,
} from './pickMetadata';

describe('ringOffset', () => {
  it('is full circumference at 0% (no visible arc)', () => {
    expect(ringOffset(0)).toBeCloseTo(RING_CIRCUMFERENCE, 5);
  });
  it('is 0 at 100% (full arc)', () => {
    expect(ringOffset(100)).toBeCloseTo(0, 5);
  });
  it('is half circumference at 50%', () => {
    expect(ringOffset(50)).toBeCloseTo(RING_CIRCUMFERENCE / 2, 5);
  });
  it('clamps out-of-range values', () => {
    expect(ringOffset(-20)).toBeCloseTo(RING_CIRCUMFERENCE, 5);
    expect(ringOffset(140)).toBeCloseTo(0, 5);
  });
});

describe('opacityTier', () => {
  it('0.3 when missing', () => expect(opacityTier(null)).toBe(0.3));
  it('0.6 when present but < 60', () => {
    expect(opacityTier(0)).toBe(0.6);
    expect(opacityTier(59)).toBe(0.6);
  });
  it('1 when >= 60', () => {
    expect(opacityTier(60)).toBe(1);
    expect(opacityTier(100)).toBe(1);
  });
});

describe('formatDuration', () => {
  it('formats m:ss and rounds', () => {
    expect(formatDuration(235.65)).toBe('3:56');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(0)).toBe('0:00');
  });
  it('em dash for missing / non-finite', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
  });
});

describe('buildIndicators', () => {
  const full: PickSignals = { obscurity: 72, obscurityBucket: 'Rabbit Hole', energy: 56, hasLyrics: true };

  it('returns obscurity → energy → lyrics in order with axis colors', () => {
    const ind = buildIndicators(full);
    expect(ind.map((i) => i.kind)).toEqual(['obscurity', 'energy', 'lyrics']);
    expect(ind.map((i) => i.colorVar)).toEqual(['--sky', '--amber', '--moss']);
  });

  it('builds obscurity tooltip with bucket and strong opacity', () => {
    const [obsc] = buildIndicators(full);
    expect(obsc.tooltip).toBe('Obscurity 72/100 (Rabbit Hole)');
    expect(obsc.opacity).toBe(1);
    expect(obsc.pct).toBe(72);
  });

  it('omits the bucket clause when none provided', () => {
    const [obsc] = buildIndicators({ ...full, obscurityBucket: null });
    expect(obsc.tooltip).toBe('Obscurity 72/100');
  });

  it('energy < 60 is present-but-weak (0.6)', () => {
    const [, energy] = buildIndicators(full);
    expect(energy.tooltip).toBe('Energy 56/100');
    expect(energy.opacity).toBe(0.6);
  });

  it('lyrics on file → 100% arc, full opacity', () => {
    const [, , lyr] = buildIndicators(full);
    expect(lyr.tooltip).toBe('Lyrics on file');
    expect(lyr.pct).toBe(100);
    expect(lyr.opacity).toBe(1);
  });

  it('instrumental → present (0.6), 0% arc', () => {
    const [, , lyr] = buildIndicators({ ...full, hasLyrics: false });
    expect(lyr.tooltip).toBe('Instrumental');
    expect(lyr.pct).toBe(0);
    expect(lyr.opacity).toBe(0.6);
  });

  it('fully missing pick → all indicators greyed (0.3) with not-analyzed tooltips', () => {
    const ind = buildIndicators({ obscurity: null, obscurityBucket: null, energy: null, hasLyrics: null });
    expect(ind.every((i) => i.opacity === 0.3)).toBe(true);
    expect(ind.every((i) => i.pct === 0)).toBe(true);
    expect(ind.map((i) => i.tooltip)).toEqual([
      'Obscurity — not analyzed yet',
      'Energy — not analyzed yet',
      'Lyrics — not analyzed yet',
    ]);
  });
});

describe('pointsLabel', () => {
  it('em dash when null (round not yet voted)', () => expect(pointsLabel(null)).toBe('—'));
  it('shows 0 for a scored-but-unpopular song', () => expect(pointsLabel(0)).toBe('0'));
  it('shows the number', () => expect(pointsLabel(14)).toBe('14'));
});

describe('lyricsHeadline', () => {
  it('maps the three states', () => {
    expect(lyricsHeadline(true)).toBe('on file');
    expect(lyricsHeadline(false)).toBe('—');
    expect(lyricsHeadline(null)).toBe('not analyzed yet');
  });
});

describe('artInitial', () => {
  it('first letter uppercased', () => expect(artInitial('nights like these')).toBe('N'));
  it('fallback for empty', () => expect(artInitial('   ')).toBe('?'));
});
