import { describe, expect, it } from 'vitest';
import { resolveTemplate, getISOWeekNumber } from '../src/rules/templates.js';

describe('getISOWeekNumber', () => {
  it('returns 1 for 2026-01-01 (Thursday)', () => {
    expect(getISOWeekNumber(new Date('2026-01-01'))).toBe(1);
  });

  it('returns 2 for 2026-01-05 (Monday of week 2)', () => {
    expect(getISOWeekNumber(new Date('2026-01-05'))).toBe(2);
  });
});

describe('resolveTemplate', () => {
  it('replaces {{weekNumber}}', () => {
    expect(resolveTemplate('Week {{weekNumber}}', { weekNumber: 7, year: 2026 })).toBe('Week 7');
  });

  it('replaces {{year}}', () => {
    expect(resolveTemplate('List {{year}}', { weekNumber: 1, year: 2026 })).toBe('List 2026');
  });

  it('replaces {{submittedBy}}', () => {
    expect(
      resolveTemplate('{{submittedBy}} Picks', { weekNumber: 1, year: 2026, submittedBy: 'Alice' }),
    ).toBe('Alice Picks');
  });

  it('replaces {{tag}}', () => {
    expect(resolveTemplate('Tag: {{tag}}', { weekNumber: 1, year: 2026, tag: 'summer' })).toBe(
      'Tag: summer',
    );
  });

  it('replaces optional variables with empty string when absent', () => {
    expect(resolveTemplate('{{submittedBy}} Picks', { weekNumber: 1, year: 2026 })).toBe(' Picks');
  });

  it('passes through strings with no template variables', () => {
    expect(resolveTemplate('Static Playlist', { weekNumber: 7, year: 2026 })).toBe(
      'Static Playlist',
    );
  });
});
