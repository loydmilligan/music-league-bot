import { describe, expect, it } from 'vitest';
import { buildPlaylistPageHtml, entriesFor, watchAllUrl } from '../ui/src/lib/ytm/playlistPage.js';
import type { VideoPick } from '../ui/src/lib/ytm/videoReview.js';

function pick(over: Partial<VideoPick>): VideoPick {
  return {
    title: 'Song', artists: 'Artist', spotifyUri: 'u:1', source: 'search', score: 80, band: 'auto',
    candidates: [{ videoId: 'V1', title: 'Vid One', channel: 'Chan', score: 80 }],
    chosen: ['V1'], included: true, decided: true, reason: null, ...over,
  };
}
const base = { roundName: 'I Want My MTV', leagueTitle: 'Second Best' };

describe('entriesFor', () => {
  it('emits one entry per selected video, not per song', () => {
    const two = pick({
      chosen: ['A', 'B'],
      candidates: [{ videoId: 'A', title: 'a', channel: 'c', score: 90 }, { videoId: 'B', title: 'b', channel: 'd', score: 70 }],
    });
    expect(entriesFor([two, pick({})]).map((e) => e.videoId)).toEqual(['A', 'B', 'V1']);
  });

  it('carries the song a video belongs to, which is the point of the page', () => {
    const [e] = entriesFor([pick({ title: 'Where Is My Mind?', artists: 'Pixies' })]);
    expect(e.song).toBe('Where Is My Mind?');
    expect(e.artists).toBe('Pixies');
    expect(e.videoTitle).toBe('Vid One');
  });

  it('survives a chosen id whose candidate has gone missing', () => {
    const [e] = entriesFor([pick({ chosen: ['GHOST'], candidates: [] })]);
    expect(e.videoId).toBe('GHOST');
    expect(e.videoTitle).toBe('Song');
  });
});

describe('watchAllUrl', () => {
  it('builds a temporary-playlist link needing no playlist to exist', () => {
    expect(watchAllUrl(['A', 'B'])).toBe('https://www.youtube.com/watch_videos?video_ids=A,B');
  });
  it('caps at the 50 YouTube accepts', () => {
    const url = watchAllUrl(Array.from({ length: 80 }, (_, i) => `V${i}`))!;
    expect(url.split(',')).toHaveLength(50);
  });
  it('is absent when there is nothing to play', () => {
    expect(watchAllUrl([])).toBeNull();
  });
});

describe('page html', () => {
  it('labels where each video came from', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [
      pick({ source: 'comment' }),
      pick({ spotifyUri: 'u:2' }),
      pick({ spotifyUri: 'u:3', candidates: [{ videoId: 'V1', title: 'v', channel: 'c', score: 0, manual: true }] }),
    ] });
    expect(html).toContain('submitter’s pick');
    expect(html).toContain('found by search · 80%');
    expect(html).toContain('added by hand');
  });

  it('counts only auto-found videos in the accuracy note', () => {
    const allHuman = buildPlaylistPageHtml({ ...base, picks: [pick({ source: 'comment' })] });
    expect(allHuman).not.toContain('found automatically');
    const mixed = buildPlaylistPageHtml({ ...base, picks: [pick({ source: 'comment' }), pick({ spotifyUri: 'u:2' })] });
    expect(mixed).toContain('1 of these were found automatically');
  });

  it('offers the YouTube playlist only when one exists', () => {
    expect(buildPlaylistPageHtml({ ...base, picks: [pick({})] })).not.toContain('Save to YouTube');
    expect(buildPlaylistPageHtml({ ...base, picks: [pick({})], youtubeUrl: 'https://yt/x' })).toContain('Save to YouTube');
  });

  it('escapes titles instead of letting them become markup', () => {
    const html = buildPlaylistPageHtml({ ...base, roundName: '<img src=x onerror=alert(1)>', picks: [pick({})] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('is self-contained: no build-step assets beyond the shared fonts', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [pick({})] });
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect((html.match(/<link[^>]+stylesheet/g) ?? [])).toHaveLength(1);
  });

  it('does not autoload a player per video', () => {
    const many = Array.from({ length: 12 }, (_, i) => pick({ spotifyUri: `u:${i}` }));
    const html = buildPlaylistPageHtml({ ...base, picks: many });
    expect(html).not.toContain('<iframe');
  });
});
