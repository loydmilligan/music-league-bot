import { describe, expect, it } from 'vitest';
import { splitHeadline, buildVideoCoverHtml } from '../ui/src/lib/ytm/videoCover.js';
import { parseIsoDuration, totalRuntimeMin } from '../ui/src/lib/ytm/youtube.js';

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

describe('runtime stamp', () => {
  const base = { leagueTitle: 'Second Best', picks: [], roundNumber: 143, roundName: 'I Want My MTV' };

  it('prints the runtime it was given', () => {
    expect(buildVideoCoverHtml({ ...base, runtimeMin: 60 }, '')).toContain('>60 MIN<');
  });

  // The bug this replaced was a hardcoded "120 MIN". A test that only checks
  // one value cannot tell a real stamp from a constant, so two must differ.
  it('tracks the value rather than printing a constant', () => {
    expect(buildVideoCoverHtml({ ...base, runtimeMin: 37 }, '')).toContain('>37 MIN<');
    expect(buildVideoCoverHtml({ ...base, runtimeMin: 37 }, '')).not.toContain('120 MIN');
  });

  it('omits the stamp entirely when the runtime is unknown', () => {
    for (const runtimeMin of [null, undefined, 0, NaN]) {
      const html = buildVideoCoverHtml({ ...base, runtimeMin }, '');
      // Not just "no number" — no empty bordered box left behind either.
      expect(html).not.toContain('MIN<');
      expect(html).not.toMatch(/rotate\(6deg\)/);
    }
  });
});

describe('parseIsoDuration', () => {
  it('reads the shapes the API actually returns', () => {
    expect(parseIsoDuration('PT4M13S')).toBe(253);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT2M')).toBe(120);
  });

  it('is 0 for junk rather than NaN', () => {
    expect(parseIsoDuration(undefined)).toBe(0);
    expect(parseIsoDuration('')).toBe(0);
    expect(parseIsoDuration('4:13')).toBe(0);
  });
});

describe('totalRuntimeMin', () => {
  const creds = { clientId: 'c', clientSecret: 's', refreshToken: 'r' };
  const okToken = { ok: true, json: async () => ({ access_token: 't' }) };

  it('sums a batch into whole minutes', async () => {
    const fetchFn = (async (url: string) =>
      String(url).includes('oauth2') ? okToken : {
        ok: true,
        json: async () => ({ items: [{ contentDetails: { duration: 'PT4M' } }, { contentDetails: { duration: 'PT2M30S' } }] }),
      }) as unknown as typeof fetch;
    // 4:00 + 2:30 = 390s = 6.5min → 7
    expect(await totalRuntimeMin(creds, ['a', 'b'], fetchFn)).toBe(7);
  });

  it('returns null — not a number — when the API fails', async () => {
    const fetchFn = (async (url: string) =>
      String(url).includes('oauth2') ? okToken : { ok: false, json: async () => ({}) }) as unknown as typeof fetch;
    expect(await totalRuntimeMin(creds, ['a'], fetchFn)).toBeNull();
  });

  it('returns null when every id is unresolvable, not 0', async () => {
    const fetchFn = (async (url: string) =>
      String(url).includes('oauth2') ? okToken : { ok: true, json: async () => ({ items: [] }) }) as unknown as typeof fetch;
    expect(await totalRuntimeMin(creds, ['gone'], fetchFn)).toBeNull();
  });

  it('returns null for an empty playlist without calling the API', async () => {
    const fetchFn = (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch;
    expect(await totalRuntimeMin(creds, [], fetchFn)).toBeNull();
  });
});
