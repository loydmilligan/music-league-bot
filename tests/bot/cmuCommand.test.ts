import { describe, it, expect } from 'vitest';
import { parseCmuCommand, parseDmCommand, stripMentionAndFiller, DM_ONLY_KINDS, parseRecapTime, FILLER_WORDS, type CmuCommand } from '../../src/bot/cmuCommand.js';

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
    ['forget', { kind: 'forget', scope: 'both', target: 'self' }],
    ['forget all', { kind: 'forget', scope: 'both', target: 'all' }],
    ['off', { kind: 'off' }],
    ['Off!', { kind: 'off' }],
    ['on', { kind: 'on' }],
    ['on.', { kind: 'on' }],
    ['tldr', { kind: 'tldr' }],
    ['TL;DR', { kind: 'tldr' }],
    ['tl dr', { kind: 'tldr' }],
    ['pls tldr?', { kind: 'tldr' }],
    ['recap-bot-calls', { kind: 'recap' }],
    ['recap bot calls', { kind: 'recap' }],
    ['recapbotcalls', { kind: 'recap' }],
    ['hey recap-bot-calls!', { kind: 'recap' }],
    ['recap', CATCHUP],
  ];
  it.each(matches)('matches %j', (body, expected) => {
    expect(run(body)).toEqual(expected);
  });

  it('forget @target resolves the first non-self mentioned id', () => {
    expect(run('forget @456', true, ['123@lid', '456@lid'])).toEqual({
      kind: 'forget', scope: 'both', target: { id: '456@lid' },
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
    'on it', 'off topic', 'tldr of round 3', 'turn off', 'tl;dr please explain',
    'recap-bot-calls please now', 'recap-bot-cals', 'recap bot call',
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

describe('player commands (dm only)', () => {
  const dm = (body: string) => parseCmuCommand(body, false, [], SELF, { dm: true });

  it('group never parses player commands', () => {
    for (const b of ['top-songs', 'top songs', 'pick one', 'show-topic 3', 'my-dossier', 'morning-recap sub']) {
      expect(run(b)).toBeNull();
    }
  });

  const dmMatches: [string, CmuCommand][] = [
    ['top songs', { kind: 'top', list: 'songs', days: 2 }],
    ['topsongs week', { kind: 'top', list: 'songs', days: 7 }],
    ['top-songs', { kind: 'top', list: 'songs', days: 2 }],
    ['Top Songs!', { kind: 'top', list: 'songs', days: 2 }],
    ['top-pics week', { kind: 'top', list: 'pics', days: 7 }],
    ['top-videos', { kind: 'top', list: 'videos', days: 2 }],
    ['top links', { kind: 'top', list: 'links', days: 2 }],
    ['top-media week', { kind: 'top', list: 'media', days: 7 }],
    ['pick one', { kind: 'pick' }],
    ['pick-one', { kind: 'pick' }],
    ['list-topics', { kind: 'topics' }],
    ['list topics', { kind: 'topics' }],
    ['listtopics', { kind: 'topics' }],
    ['show topic 3', { kind: 'topic', n: 3 }],
    ['show-topic 10', { kind: 'topic', n: 10 }],
    ['showtopic 1', { kind: 'topic', n: 1 }],
    ['my dossier', { kind: 'dossier' }],
    ['my-dossier', { kind: 'dossier' }],
    ['dossier', { kind: 'dossier' }],
    ['morning recap 7:30', { kind: 'recap-time', time: '07:30' }],
    ['morning-recap 7:30', { kind: 'recap-time', time: '07:30' }],
    ['morning-recap time 7:30', { kind: 'recap-time', time: '07:30' }],
    ['morning-recap sub', { kind: 'recap-sub' }],
    ['recap sub', { kind: 'recap-sub' }],
    ['morning-recap unsub', { kind: 'recap-unsub' }],
    ['morning-recap 99', { kind: 'recap-time-bad' }],
    ['morning-recap time', { kind: 'recap-time-bad' }],
    ['morning-recap 7:5', { kind: 'recap-time-bad' }],
    ['recap unsub', { kind: 'recap-unsub' }],
    ['help', { kind: 'help' }],
    ['catch me up', CATCHUP],
    ['cach me up', CATCHUP],
    ['recap-bot-calls', { kind: 'recap' }],
  ];
  it.each(dmMatches)('dm matches %j', (body, expected) => {
    expect(dm(body)).toEqual(expected);
  });

  const dmNon = [
    'show-topic', 'show-topic 11', 'show-topic 0', 'pick one of these', 'top songs please',
    'can you catch me up', 'hey help', 'full', 'forget', 'forget all', 'off', 'on', 'tldr',
    'morning recap was great', 'morning recap was 5 stars', 'catch me up pls', 'hey top songs', 'top songs week please', 'top-songs 3', '@123 help',
  ];
  it.each(dmNon)('dm does not match %j', (body) => {
    expect(dm(body)).toBeNull();
  });

  it('dm ignores mentionsBot and group ignores nothing new', () => {
    expect(parseCmuCommand('help', true, [], SELF, { dm: true })).toEqual({ kind: 'help' });
    expect(parseCmuCommand('help', false, [], SELF, { dm: false })).toBeNull();
  });
});

describe('parseRecapTime', () => {
  const cases: [string, string | undefined][] = [
    ['7:30', '07:30'], ['7', '07:00'], ['3', '03:00'], ['12', '12:00'], ['13:15', '13:15'],
    ['7pm', '19:00'], ['12am', '00:00'], ['12pm', '12:00'], ['7:30 am', '07:30'], ['11', '11:00'],
    ['5', '05:00'], ['0', '00:00'], ['23:59', '23:59'],
    ['7:5', undefined], ['25', undefined], ['abc', undefined], ['24:00', undefined],
    ['7:60', undefined], ['13pm', undefined], ['0am', undefined], ['', undefined],
  ];
  it.each(cases)('%j -> %j', (s, expected) => {
    expect(parseRecapTime(s)).toBe(expected);
  });
});

describe('sprint 4 parsers', () => {
  const dm = (body: string) => parseCmuCommand(body, false, [], SELF, { dm: true });
  const ME = ['123@lid', '456@lid'];

  it.each([
    ['forget', 'both', 'self'], ['forget dl', 'dl', 'self'], ['forget sybg', 'sybg', 'self'],
    ['Forget DL', 'dl', 'self'], ['forget SYBG', 'sybg', 'self'],
    ['forget all', 'both', 'all'], ['forget dl all', 'dl', 'all'], ['forget SYBG all', 'sybg', 'all'],
  ] as const)('group %j scope %s target %s', (b, scope, target) => {
    expect(run(b)).toEqual({ kind: 'forget', scope, target });
  });

  it('forget scopes with @Player resolve the first non-self id', () => {
    expect(run('forget @Pat', true, ME)).toEqual({ kind: 'forget', scope: 'both', target: { id: '456@lid' } });
    expect(run('forget dl @Pat', true, ME)).toEqual({ kind: 'forget', scope: 'dl', target: { id: '456@lid' } });
    expect(run('forget sybg @Pat', true, ME)).toEqual({ kind: 'forget', scope: 'sybg', target: { id: '456@lid' } });
    expect(run('forget dl @Pat', true, [])).toBeNull();
  });

  it('forget with other words is null', () => {
    for (const b of ['forget dlx', 'forget all dl', 'forget dl sybg', 'forget it']) expect(run(b)).toBeNull();
  });

  it('bare recap stays catch-up, recap7 is not a group command', () => {
    expect(run('recap')).toEqual({ kind: 'catchup' });
    expect(dm('recap')).toEqual({ kind: 'catchup' });
    for (const b of ['recap7', 'recap 7', 'recap-7']) {
      expect(run(b)).toBeNull();
      expect(dm(b)).toEqual({ kind: 'recap7' });
    }
    expect(dm('Recap7!')).toEqual({ kind: 'recap7' });
    expect(dm('recap 8')).toBeNull();
  });

  it.each([
    ['morning-brief sub', { kind: 'recap-sub' }],
    ['morning brief unsub', { kind: 'recap-unsub' }],
    ['morning-brief 7:30', { kind: 'recap-time', time: '07:30' }],
    ['morning-brief time 7:30', { kind: 'recap-time', time: '07:30' }],
    ['morningbrief 8pm', { kind: 'recap-time', time: '20:00' }],
    ['morning-brief 99', { kind: 'recap-time-bad' }],
    ['morning-brief time', { kind: 'recap-time-bad' }],
    ['morning-recap sub', { kind: 'recap-sub' }],
    ['morning-recap unsub', { kind: 'recap-unsub' }],
    ['morning-recap 7:30', { kind: 'recap-time', time: '07:30' }],
  ] as [string, CmuCommand][])('dm %j', (b, expected) => {
    expect(dm(b)).toEqual(expected);
  });

  it('morning-brief sample is a group command and, by DM, not a command at all', () => {
    for (const t of ['morning-brief sample', 'Morning Brief sample!', 'hey morning brief sample']) expect(run(t)).toEqual({ kind: 'brief-sample' });
    expect(run('morning-brief sample please')).toBeNull();
    for (const t of ['morning-brief sample', 'Morning Brief sample!', 'morning brief sample']) {
      expect(dm(t)).toBeNull();
      expect(parseDmCommand(t)).toBeNull();
    }
    expect(DM_ONLY_KINDS.has('brief-sample')).toBe(false);
  });

  it('morning-brief is not a group command and ordinary words stay null', () => {
    expect(run('morning-brief sub')).toBeNull();
    expect(dm('morning brief was great')).toBeNull();
  });

  it('parseDmCommand is exported and matches the dm branch', () => {
    expect(parseDmCommand('recap7')).toEqual({ kind: 'recap7' });
    expect(parseDmCommand('help')).toEqual({ kind: 'help' });
  });

  it('stripMentionAndFiller drops mention, filler, case, curly apostrophes and trailing punctuation', () => {
    expect(stripMentionAndFiller('@123 Hey can you Catch Me Up!')).toBe('catch me up');
    expect(stripMentionAndFiller("@123 @456 what\u2019d I miss?")).toBe("what'd i miss");
    expect(stripMentionAndFiller('@123 hey yo bot pls help')).toBe('pls help');
    expect(stripMentionAndFiller('  plain   spaces ')).toBe('plain spaces');
  });

  it('DM_ONLY_KINDS is exactly the ten dm-only kinds', () => {
    expect([...DM_ONLY_KINDS].sort()).toEqual(
      ['dossier', 'pick', 'recap-sub', 'recap-time', 'recap-time-bad', 'recap-unsub', 'recap7', 'top', 'topic', 'topics'].sort(),
    );
    expect(DM_ONLY_KINDS.has('catchup')).toBe(false);
    expect(DM_ONLY_KINDS.has('help')).toBe(false);
  });
});
