import { describe, expect, it } from 'vitest';
import { resolveTemplate, getISOWeekNumber } from '../src/rules/templates.js';
import { applyRules } from '../src/rules/engine.js';
import type { RulesConfig } from '../src/config/types.js';

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

const testConfig: RulesConfig = {
  defaults: { requireCommandPrefix: true, commandPrefix: '!song', dedupeScope: 'playlist' },
  rules: [
    {
      name: 'Weekly playlist',
      enabled: true,
      when: { command: 'song' },
      playlist: { spotify: 'Music League - Week {{weekNumber}}' },
    },
    {
      name: 'Summer tag',
      enabled: true,
      when: { tag: 'summer' },
      playlist: { spotify: 'Music League - Summer', youtube: 'Music League - Summer YT' },
    },
    {
      name: 'Per submitter',
      enabled: true,
      when: { submittedBy: '*' },
      playlist: { spotify: 'Music League - {{submittedBy}}' },
    },
    {
      name: 'Disabled rule',
      enabled: false,
      when: { command: 'song' },
      playlist: { spotify: 'Should Not Appear' },
    },
  ],
};

describe('applyRules', () => {
  it('matches a command rule and resolves the weekNumber template', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: [] },
      { weekNumber: 7, year: 2026 },
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Weekly playlist');
    expect(matches[0].spotify).toBe('Music League - Week 7');
  });

  it('matches both command rule and tag rule when tag is present', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: ['summer'] },
      { weekNumber: 7, year: 2026 },
    );
    const names = matches.map((m) => m.name);
    expect(names).toContain('Weekly playlist');
    expect(names).toContain('Summer tag');
    expect(matches.find((m) => m.name === 'Summer tag')?.youtube).toBe('Music League - Summer YT');
  });

  it('skips disabled rules even when they would match', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: [] },
      { weekNumber: 7, year: 2026 },
    );
    expect(matches.every((m) => m.name !== 'Disabled Rule')).toBe(true);
  });

  it('matches wildcard submittedBy when submittedBy is provided', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: [], submittedBy: 'Alice' },
      { weekNumber: 7, year: 2026, submittedBy: 'Alice' },
    );
    expect(matches.some((m) => m.spotify === 'Music League - Alice')).toBe(true);
  });

  it('does not match wildcard submittedBy when submittedBy is absent', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: [] },
      { weekNumber: 7, year: 2026 },
    );
    expect(matches.every((m) => m.name !== 'Per submitter')).toBe(true);
  });

  it('returns empty array when config has no rules', () => {
    const empty: RulesConfig = { defaults: {}, rules: [] };
    const matches = applyRules(empty, { command: 'song', tags: [] }, { weekNumber: 1, year: 2026 });
    expect(matches).toHaveLength(0);
  });

  it('does not match command rule when command differs', () => {
    const matches = applyRules(
      testConfig,
      { command: 'playlist', tags: [] },
      { weekNumber: 7, year: 2026 },
    );
    expect(matches.every((m) => m.name !== 'Weekly playlist')).toBe(true);
  });
});
