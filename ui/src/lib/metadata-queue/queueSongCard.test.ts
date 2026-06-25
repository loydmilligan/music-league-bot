import { it, expect, describe } from 'vitest';
import { coverageStatePill, ladderKey, runMissingCount } from './queueSongCard.js';
import { LADDER } from './ladder.js';

// -----------------------------------------------------------------------
// coverageStatePill — coverage state → pill descriptor (via LADDER)
// -----------------------------------------------------------------------

describe('coverageStatePill', () => {
  it('done → glyph "✓" (from LADDER.done) and LADDER.done.fg tone', () => {
    const pill = coverageStatePill('done');
    expect(pill.glyph).toBe(LADDER.done.glyph);   // '✓'
    expect(pill.glyph).toBe('✓');
    expect(pill.toneClass).toBe(LADDER.done.fg);   // 'text-health'
    expect(pill.toneClass).toBe('text-health');
    expect(pill.label).toBe('done');
  });

  it('processing → glyph "⟳" (from LADDER.running) and sky tone', () => {
    const pill = coverageStatePill('processing');
    expect(pill.glyph).toBe(LADDER.running.glyph); // '⟳'
    expect(pill.glyph).toBe('⟳');
    expect(pill.toneClass).toBe(LADDER.running.fg); // 'text-sky'
    expect(pill.toneClass).toBe('text-sky');
    expect(pill.label).toBe('running');
  });

  it('pending → glyph "◌" (from LADDER.queued) and dim-sky tone', () => {
    const pill = coverageStatePill('pending');
    expect(pill.glyph).toBe(LADDER.queued.glyph);  // '◌'
    expect(pill.glyph).toBe('◌');
    expect(pill.toneClass).toBe(LADDER.queued.fg);  // 'text-sky/60'
    expect(pill.toneClass).toBe('text-sky/60');
    expect(pill.label).toBe('queued');
  });

  it('failed → failedHard glyph "✕" and ember tone', () => {
    const pill = coverageStatePill('failed');
    expect(pill.glyph).toBe(LADDER.failedHard.glyph); // '✕'
    expect(pill.glyph).toBe('✕');
    expect(pill.toneClass).toBe(LADDER.failedHard.fg); // 'text-ember'
    expect(pill.toneClass).toBe('text-ember');
    expect(pill.label).toBe('failed');
  });

  it('missing → glyph "○" (from LADDER.missing) and faint tone', () => {
    const pill = coverageStatePill('missing');
    expect(pill.glyph).toBe(LADDER.missing.glyph);  // '○'
    expect(pill.glyph).toBe('○');
    expect(pill.toneClass).toBe(LADDER.missing.fg);  // 'text-fg-faint'
    expect(pill.toneClass).toBe('text-fg-faint');
    expect(pill.label).toBe('missing');
  });

  it('NEVER returns accent as a toneClass for any coverage state', () => {
    const states = ['done', 'processing', 'pending', 'failed', 'missing'] as const;
    for (const s of states) {
      expect(coverageStatePill(s).toneClass).not.toContain('accent');
    }
  });

  it('pill has glyph, toneClass, label for all 5 states', () => {
    const states = ['done', 'processing', 'pending', 'failed', 'missing'] as const;
    for (const s of states) {
      const pill = coverageStatePill(s);
      expect(typeof pill.glyph).toBe('string');
      expect(pill.glyph.length).toBeGreaterThan(0);
      expect(typeof pill.toneClass).toBe('string');
      expect(pill.toneClass.length).toBeGreaterThan(0);
      expect(typeof pill.label).toBe('string');
      expect(pill.label.length).toBeGreaterThan(0);
    }
  });
});

// -----------------------------------------------------------------------
// runMissingCount — actionable elements (excludes done + processing)
// -----------------------------------------------------------------------

describe('runMissingCount', () => {
  it('excludes done and processing; counts missing/pending/failed', () => {
    const jobs: Record<string, 'done' | 'processing' | 'pending' | 'failed' | 'missing'> = {
      ytm:         'done',
      lastfm_pop:  'processing',
      lastfm_tags: 'missing',
      lyrics:      'pending',
      audio:       'failed',
    };
    // done + processing are excluded → only missing, pending, failed → count = 3
    expect(runMissingCount(jobs)).toBe(3);
  });

  it('all-done jobs → 0', () => {
    const jobs: Record<string, 'done' | 'processing' | 'pending' | 'failed' | 'missing'> = {
      ytm:         'done',
      lastfm_pop:  'done',
      lastfm_tags: 'done',
      lyrics:      'done',
      audio:       'done',
    };
    expect(runMissingCount(jobs)).toBe(0);
  });

  it('all-missing jobs → 5', () => {
    const jobs: Record<string, 'done' | 'processing' | 'pending' | 'failed' | 'missing'> = {
      ytm:         'missing',
      lastfm_pop:  'missing',
      lastfm_tags: 'missing',
      lyrics:      'missing',
      audio:       'missing',
    };
    expect(runMissingCount(jobs)).toBe(5);
  });

  it('processing-only jobs → 0 (processing is not actionable)', () => {
    const jobs: Record<string, 'done' | 'processing' | 'pending' | 'failed' | 'missing'> = {
      ytm:         'processing',
      lastfm_pop:  'processing',
      lastfm_tags: 'done',
      lyrics:      'done',
      audio:       'done',
    };
    expect(runMissingCount(jobs)).toBe(0);
  });

  it('mixed pending + failed → counts both', () => {
    const jobs: Record<string, 'done' | 'processing' | 'pending' | 'failed' | 'missing'> = {
      ytm:         'pending',
      lastfm_pop:  'failed',
      lastfm_tags: 'done',
      lyrics:      'processing',
      audio:       'missing',
    };
    // pending + failed + missing = 3; done + processing excluded
    expect(runMissingCount(jobs)).toBe(3);
  });
});

// -----------------------------------------------------------------------
// ladderKey — maps CoverageState → ElementState for LADDER lookup
// -----------------------------------------------------------------------

describe('ladderKey', () => {
  it('done → "done"', () => {
    expect(ladderKey('done')).toBe('done');
  });

  it('processing → "running"', () => {
    expect(ladderKey('processing')).toBe('running');
  });

  it('pending → "queued"', () => {
    expect(ladderKey('pending')).toBe('queued');
  });

  it('failed → "failedHard"', () => {
    expect(ladderKey('failed')).toBe('failedHard');
  });

  it('missing → "missing"', () => {
    expect(ladderKey('missing')).toBe('missing');
  });

  it('all keys map to valid LADDER entries', () => {
    const states = ['done', 'processing', 'pending', 'failed', 'missing'] as const;
    for (const s of states) {
      const key = ladderKey(s);
      expect(LADDER[key]).toBeDefined();
      expect(typeof LADDER[key].soft).toBe('string');
      expect(typeof LADDER[key].border).toBe('string');
    }
  });
});
