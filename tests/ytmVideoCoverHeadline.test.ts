import { describe, expect, it } from 'vitest';
import { splitHeadline, buildVideoCoverHtml } from '../ui/src/lib/ytm/videoCover.js';

describe('splitHeadline', () => {
  it('reproduces the designed poster for the round it was drawn for', () => {
    expect(splitHeadline('I Want My MTV')).toEqual({ kicker: 'I WANT MY', punch: 'MTV' });
  });

  it('puts the last word in the big slot for an ordinary title', () => {
    expect(splitHeadline('More Cowbell!')).toEqual({ kicker: 'MORE', punch: 'COWBELL!' });
    expect(splitHeadline('This is the Tale of Captain Jack Sparrow'))
      .toEqual({ kicker: 'THIS IS THE TALE OF CAPTAIN JACK', punch: 'SPARROW' });
  });

  it('takes two words when the last one is a fragment on its own', () => {
    // "TV" alone reads as a mistake; "MY TV" reads as a phrase.
    expect(splitHeadline('I Want My TV')).toEqual({ kicker: 'I WANT', punch: 'MY TV' });
    expect(splitHeadline('Songs About It')).toEqual({ kicker: 'SONGS', punch: 'ABOUT IT' });
  });

  it('makes a one-word round all payoff', () => {
    expect(splitHeadline('Thriller')).toEqual({ kicker: '', punch: 'THRILLER' });
  });

  it('does not fall apart on empty, whitespace or a two-word short tail', () => {
    expect(splitHeadline('')).toEqual({ kicker: '', punch: '' });
    expect(splitHeadline('   ')).toEqual({ kicker: '', punch: '' });
    // Only two words and the last is short: still splits rather than swallowing both.
    expect(splitHeadline('Big TV')).toEqual({ kicker: 'BIG', punch: 'TV' });
  });

  it('collapses runs of whitespace rather than emitting blanks', () => {
    expect(splitHeadline('More   Cowbell')).toEqual({ kicker: 'MORE', punch: 'COWBELL' });
  });
});

describe('cover html', () => {
  const base = { leagueTitle: 'Second Best', picks: [], roundNumber: 143 };

  it('falls back to a kicker when the round name is a single word', () => {
    // An empty highlighter slash over nothing looks like a rendering fault.
    expect(buildVideoCoverHtml({ ...base, roundName: 'Thriller' }, '')).toContain('THE VIDEOS');
  });

  it('stamps the league and round underneath the sheet', () => {
    expect(buildVideoCoverHtml({ ...base, roundName: 'I Want My MTV' }, ''))
      .toContain('SECOND BEST · R143');
  });

  it('omits the round number when there isn\'t one, without a dangling separator', () => {
    const html = buildVideoCoverHtml({ ...base, roundName: 'x', roundNumber: null }, '');
    expect(html).toContain('>SECOND BEST<');
    expect(html).not.toContain('SECOND BEST ·');
  });

  it('escapes a round name instead of letting it become markup', () => {
    const html = buildVideoCoverHtml({ ...base, roundName: '<img src=x onerror=alert(1)>' }, '');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;IMG');
  });

  it('carries no external assets but the shared font stylesheet', () => {
    const html = buildVideoCoverHtml({ ...base, roundName: 'I Want My MTV' }, '/fonts.css');
    expect((html.match(/<link[^>]+stylesheet/g) ?? [])).toHaveLength(1);
    expect(html).not.toMatch(/<img /);
    // The grain is feTurbulence, not a fetched texture — the render must be
    // deterministic and offline.
    expect(html).toContain('feTurbulence');
  });
});
