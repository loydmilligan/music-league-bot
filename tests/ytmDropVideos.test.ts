import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain .mjs module, no types
import { extractVideoIds, channelMatchesArtist, resolveVideoPicks } from '../scripts/ytm-drop/videos.mjs';

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

describe('resolveVideoPicks', () => {
  const subs = [
    { title: 'Au Pays du Cocaine', artists: 'Geese', comment: 'https://youtu.be/RGE-JRsJ2uo\n\nthe baby one' },
    { title: 'Smooth Sailin', artists: 'Leon Bridges', comment: 'no link here' },
    { title: "Barrett's Privateers", artists: 'Stan Rogers', comment: null },
  ];
  // Every song has a search result available, so a pick that comes from the
  // comment is distinguishable only by NOT being the search id.
  const ytSearch = vi.fn(async (q: string) => {
    if (q.startsWith('Au Pays')) return [{ videoId: 'SEARCHHIT01', title: 'Au Pays', channel: 'Some Rando' }];
    if (q.startsWith('Smooth')) return [{ videoId: 'HYplnRjMVhM', title: 'Smooth Sailin', channel: 'LeonBridgesVEVO' }];
    return [{ videoId: '1WDX4PAH1L0', title: "Barrett's Privateers", channel: 'The Wellermen' }];
  });

  it('prefers the submitter link and never searches for that song', async () => {
    ytSearch.mockClear();
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0 });
    expect(picks[0]).toMatchObject({ videoId: 'RGE-JRsJ2uo', source: 'comment', confidence: 'certain' });
    expect(ytSearch).toHaveBeenCalledTimes(2);
    expect(ytSearch.mock.calls.some((c) => String(c[0]).startsWith('Au Pays'))).toBe(false);
  });

  it('marks a search hit on the artist channel "likely" and an unrelated one "weak"', async () => {
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0 });
    expect(picks[1]).toMatchObject({ videoId: 'HYplnRjMVhM', source: 'search', confidence: 'likely' });
    expect(picks[2]).toMatchObject({ videoId: '1WDX4PAH1L0', source: 'search', confidence: 'weak' });
  });

  it('reports a hole rather than dropping the song when search finds nothing', async () => {
    const picks = await resolveVideoPicks([subs[2]], async () => [], { pacingMs: 0 });
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ videoId: null, source: null, confidence: null });
  });

  it('keeps going when one search throws', async () => {
    const boom = vi.fn(async (q: string) => {
      if (q.startsWith('Smooth')) throw new Error('search HTTP 429');
      return [{ videoId: 'OK1', title: 't', channel: 'Stan Rogers' }];
    });
    const picks = await resolveVideoPicks(subs, boom, { pacingMs: 0 });
    expect(picks[1].videoId).toBeNull();
    expect(picks[1].error).toContain('429');
    expect(picks[2].videoId).toBe('OK1');
  });
});
