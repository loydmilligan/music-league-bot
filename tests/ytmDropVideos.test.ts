import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain .mjs module, no types
import { extractVideoIds, channelMatchesArtist, resolveVideoPicks, scoreSearchHit } from '../scripts/ytm-drop/videos.mjs';

describe('extractVideoIds', () => {
  it('reads the three link shapes people actually paste', () => {
    expect(extractVideoIds('https://youtu.be/RGE-JRsJ2uo?is=VPZYfmps5qPaxxNK')).toEqual(['RGE-JRsJ2uo']);
    expect(extractVideoIds('https://www.youtube.com/watch?v=Orlbo9WkZ2E&t=30s')).toEqual(['Orlbo9WkZ2E']);
    expect(extractVideoIds('https://m.youtube.com/shorts/kEqGdGAgAjw')).toEqual(['kEqGdGAgAjw']);
  });

  it('returns links in the order they appear, not in pattern order', () => {
    // The caller takes [0] as "the link the submitter meant". Both ids are
    // present either way, so only the ORDER can catch a pattern-major scan.
    const comment = 'watch https://youtu.be/TZ827lkktYs — or the long one https://www.youtube.com/watch?v=Orlbo9WkZ2E';
    expect(extractVideoIds(comment)[0]).toBe('TZ827lkktYs');
  });

  it('is quiet on comments with no video and on no comment at all', () => {
    expect(extractVideoIds('The video with the baby always makes me laugh')).toEqual([]);
    expect(extractVideoIds(null)).toEqual([]);
    expect(extractVideoIds('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toEqual([]);
  });
});

describe('channelMatchesArtist', () => {
  it('accepts the artist channel and its VEVO/Official/Topic variants', () => {
    expect(channelMatchesArtist('LeonBridgesVEVO', 'Leon Bridges')).toBe(true);
    expect(channelMatchesArtist('PixiesOfficial', 'Pixies')).toBe(true);
    expect(channelMatchesArtist('Flight Of The Conchords - Topic', 'Flight of the Conchords, Jemaine Clement')).toBe(true);
  });

  it('rejects the covers and fan uploads search actually returned', () => {
    expect(channelMatchesArtist('The Wellermen', 'Stan Rogers')).toBe(false);
    expect(channelMatchesArtist('IslamicVideo Daily', 'Serengeti')).toBe(false);
    expect(channelMatchesArtist('building55', 'Josh Ritter')).toBe(false);
  });

  it('does not match on a missing channel or artist', () => {
    expect(channelMatchesArtist(null, 'Pixies')).toBe(false);
    expect(channelMatchesArtist('PixiesOfficial', '')).toBe(false);
  });
});

describe('scoreSearchHit', () => {
  const t = (title: string, artists: string) => ({ title, artists });

  it('scores the real SB R141 results the way the threshold needs', () => {
    // These five are verbatim from the live dry run; the recommended 70 has to
    // split them 2/3 or the default is wrong.
    expect(scoreSearchHit({ channel: 'PixiesOfficial', title: 'Pixies - Where Is My Mind (Official Video)' }, t('Where Is My Mind?', 'Pixies'), 0)).toBe(100);
    expect(scoreSearchHit({ channel: 'LeonBridgesVEVO', title: "Leon Bridges - Smooth Sailin'" }, t("Smooth Sailin'", 'Leon Bridges'), 0)).toBe(75);
    expect(scoreSearchHit({ channel: 'The Wellermen', title: "Barrett's Privateers" }, t("Barrett's Privateers", 'Stan Rogers'), 0)).toBe(30);
    expect(scoreSearchHit({ channel: 'building55', title: 'Josh Ritter - Another New World' }, t('Another New World', 'Josh Ritter'), 0)).toBe(30);
    expect(scoreSearchHit({ channel: 'IslamicVideo Daily', title: 'Shark Attack Compilation' }, t('shark attack', 'Serengeti'), 2)).toBe(20);
  });

  it('will not auto-accept an artist-channel upload of the WRONG song at 70', () => {
    // Artist channel (45) + rank (10) = 55. The title check is what stops a
    // drift to a different track on the right channel from sailing through.
    expect(scoreSearchHit({ channel: 'PixiesOfficial', title: 'Pixies - Debaser' }, t('Where Is My Mind?', 'Pixies'), 0)).toBe(55);
  });

  it('scores a missing hit as zero rather than throwing', () => {
    expect(scoreSearchHit(null, t('x', 'y'), 0)).toBe(0);
  });
});

describe('resolveVideoPicks', () => {
  const subs = [
    { title: 'Au Pays du Cocaine', artists: 'Geese', comment: 'https://youtu.be/RGE-JRsJ2uo\n\nthe baby one' },
    { title: 'Smooth Sailin', artists: 'Leon Bridges', comment: 'no link here' },
    { title: "Barrett's Privateers", artists: 'Stan Rogers', comment: null },
  ];
  // Every song has a search result available, so a pick that comes from the
  // comment is distinguishable only by NOT being the search id. And the two
  // searched songs land on OPPOSITE sides of the default threshold.
  const ytSearch = vi.fn(async (q: string) => {
    if (q.startsWith('Au Pays')) return [{ videoId: 'SEARCHHIT01', title: 'Au Pays', channel: 'Some Rando' }];
    if (q.startsWith('Smooth')) return [{ videoId: 'HYplnRjMVhM', title: "Leon Bridges - Smooth Sailin", channel: 'LeonBridgesVEVO' }];
    return [{ videoId: '1WDX4PAH1L0', title: "Barrett's Privateers", channel: 'The Wellermen' }];
  });

  it('prefers the submitter link and never searches for that song', async () => {
    ytSearch.mockClear();
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0 });
    expect(picks[0]).toMatchObject({ videoId: 'RGE-JRsJ2uo', source: 'comment', score: 100, accepted: true });
    expect(ytSearch).toHaveBeenCalledTimes(2);
    expect(ytSearch.mock.calls.some((c) => String(c[0]).startsWith('Au Pays'))).toBe(false);
  });

  it('accepts above the threshold and holds back below it', async () => {
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, autoAcceptPct: 70 });
    expect(picks[1]).toMatchObject({ videoId: 'HYplnRjMVhM', source: 'search', accepted: true });
    expect(picks[2]).toMatchObject({ videoId: '1WDX4PAH1L0', source: 'search', accepted: false });
    expect(picks[2].reason).toContain('below the 70');
  });

  it('moves the line when the threshold moves', async () => {
    const loose = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, autoAcceptPct: 25 });
    expect(loose[2].accepted).toBe(true);
    const strict = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, autoAcceptPct: 90 });
    expect(strict[1].accepted).toBe(false);
  });

  it('useComments:false ignores the submitter link and searches instead', async () => {
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, useComments: false });
    expect(picks[0]).toMatchObject({ videoId: 'SEARCHHIT01', source: 'search' });
  });

  it('useSearch:false leaves the gaps empty and never calls search', async () => {
    const spy = vi.fn(async () => [{ videoId: 'X', title: 't', channel: 'c' }]);
    const picks = await resolveVideoPicks(subs, spy, { pacingMs: 0, useSearch: false });
    expect(picks[0].videoId).toBe('RGE-JRsJ2uo');
    expect(picks[1]).toMatchObject({ videoId: null, accepted: false });
    expect(picks[1].reason).toContain('search is off');
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports a hole rather than dropping the song when search finds nothing', async () => {
    const picks = await resolveVideoPicks([subs[2]], async () => [], { pacingMs: 0 });
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ videoId: null, source: null, accepted: false, reason: 'search found nothing' });
  });

  it('keeps going when one search throws', async () => {
    const boom = vi.fn(async (q: string) => {
      if (q.startsWith('Smooth')) throw new Error('search HTTP 429');
      return [{ videoId: 'OK1', title: "Barrett's Privateers (Official Video)", channel: 'Stan Rogers' }];
    });
    const picks = await resolveVideoPicks(subs, boom, { pacingMs: 0 });
    expect(picks[1].videoId).toBeNull();
    expect(picks[1].reason).toContain('429');
    expect(picks[2].videoId).toBe('OK1');
  });

  it('returns one entry per submission even when everything fails', async () => {
    const picks = await resolveVideoPicks(subs, async () => { throw new Error('down'); }, { pacingMs: 0 });
    expect(picks).toHaveLength(subs.length);
  });
});
