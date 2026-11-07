import { describe, it, expect } from 'vitest';
import { parseCmuCommand, FILLER_WORDS, type CmuCommand } from '../../src/bot/cmuCommand.js';

const SELF = new Set(['123@lid']);
const run = (body: string, mentions = true, ids: string[] = []) =>
  parseCmuCommand(`@123 ${body}`, mentions, ids, SELF);
const CATCHUP: CmuCommand = { kind: 'catchup' };

describe('parseCmuCommand', () => {
  const matches: [string, CmuCommand][] = [
    ...[
      'catch me up', 'Catch Me Up!', 'catch up', 'catchup', 'catchmeup', 'cmu',
      'what did i miss', "what'd I miss?", 'whatd i miss', 'wdim', "what’d I miss",
      'fill me in', 'recap me', 'recap', 'summary', 'summarize',
      'hey can you catch me up', 'yo bot pls catch me up', 'catch me up pls',
      'cach me up', 'ctach me up', 'cathc me up',
    ].map((b): [string, CmuCommand] => [b, CATCHUP]),
    ['help', { kind: 'help' }],
    ['help.', { kind: 'help' }],
    ['full', { kind: 'full' }],
    ['forget', { kind: 'forget', target: 'self' }],
    ['forget all', { kind: 'forget', target: 'all' }],
  ];
  it.each(matches)('matches %j', (body, expected) => {
    expect(run(body)).toEqual(expected);
  });

  it('forget @target resolves the first non-self mentioned id', () => {
    expect(run('forget @456', true, ['123@lid', '456@lid'])).toEqual({
      kind: 'forget', target: { id: '456@lid' },
    });
  });

  it('forget @someone with no resolvable id is null', () => {
    expect(run('forget @456', true, ['123@lid'])).toBeNull();
    expect(run('forget @456', true, [])).toBeNull();
  });

  const nonMatches = [
    'help me pick a song', 'full of it', 'forget it, never mind', 'summary of round 3',
    'recap the scores', "hey what's up", 'can you play something',
    'please please please please catch me up', 'cat me up', 'catches up',
    'match me up', 'patch me up', 'batch up',
  ];
  it.each(nonMatches)('does not match %j', (body) => {
    expect(run(body)).toBeNull();
  });

  it('requires the mention', () => {
    expect(run('catch me up', false)).toBeNull();
    expect(run('help', false)).toBeNull();
  });

  it('exports the filler list', () => {
    expect(FILLER_WORDS).toContain('pls');
    expect(FILLER_WORDS).toHaveLength(14);
  });
});
