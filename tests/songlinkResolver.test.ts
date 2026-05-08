import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeBatchDelay,
  normalizeSonglinkInput,
  resolveSonglinkBatch,
  resolveSonglinkUrl,
  spotifyUrlToUri,
} from '../src/resolver/songlinkResolver.js';

const songlinkResponse = {
  entityUniqueId: 'SPOTIFY_SONG::123',
  userCountry: 'US',
  pageUrl: 'https://song.link/i/123',
  entitiesByUniqueId: {
    'SPOTIFY_SONG::123': {
      id: '123',
      type: 'song',
      title: 'Test Song',
      artistName: 'Test Artist',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      apiProvider: 'spotify',
      platforms: ['spotify', 'appleMusic', 'youtube'],
    },
  },
  linksByPlatform: {
    spotify: { country: 'US', url: 'https://open.spotify.com/track/abc123XYZ', entityUniqueId: 'SPOTIFY_SONG::123' },
    appleMusic: { country: 'US', url: 'https://music.apple.com/us/song/test-song/123', entityUniqueId: 'APPLE_MUSIC_SONG::123' },
    youtube: { country: 'US', url: 'https://www.youtube.com/watch?v=video123', entityUniqueId: 'YOUTUBE_VIDEO::video123' },
    youtubeMusic: { country: 'US', url: 'https://music.youtube.com/watch?v=video123', entityUniqueId: 'YOUTUBE_MUSIC_VIDEO::video123' },
  },
};

afterEach(() => { vi.restoreAllMocks(); });

describe('songlinkResolver', () => {
  it('converts Spotify track URIs into Spotify URLs', () => {
    expect(normalizeSonglinkInput('spotify:track:abc123')).toBe('https://open.spotify.com/track/abc123');
  });

  it('leaves non-Spotify-URI links unchanged after trimming', () => {
    expect(normalizeSonglinkInput(' https://music.apple.com/us/song/example ')).toBe('https://music.apple.com/us/song/example');
  });

  it('derives Spotify URI from Spotify track URL', () => {
    expect(spotifyUrlToUri('https://open.spotify.com/track/abc123XYZ?si=foo')).toBe('spotify:track:abc123XYZ');
  });

  it('returns undefined when Spotify URI cannot be derived', () => {
    expect(spotifyUrlToUri('https://open.spotify.com/album/abc123')).toBeUndefined();
    expect(spotifyUrlToUri(undefined)).toBeUndefined();
  });

  it('resolves a music URL into platform links', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => songlinkResponse,
    } as Response);

    const result = await resolveSonglinkUrl('https://music.apple.com/us/song/test-song/123');

    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error('Expected resolved track, got error');
    expect(result.title).toBe('Test Song');
    expect(result.artist).toBe('Test Artist');
    expect(result.thumbnail).toBe('https://example.com/thumb.jpg');
    expect(result.links.spotify).toBe('https://open.spotify.com/track/abc123XYZ');
    expect(result.links.spotifyUri).toBe('spotify:track:abc123XYZ');
    expect(result.links.appleMusic).toBe('https://music.apple.com/us/song/test-song/123');
    expect(result.links.youtube).toBe('https://www.youtube.com/watch?v=video123');
    expect(result.links.youtubeMusic).toBe('https://music.youtube.com/watch?v=video123');
    expect(result.links.songLink).toBe('https://song.link/i/123');
  });

  it('returns an error object for 404 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);
    const result = await resolveSonglinkUrl('https://example.com/missing');
    expect('error' in result).toBe(true);
    if (!('error' in result)) throw new Error('Expected error result');
    expect(result.error).toBe('Track not found on Songlink/Odesli');
    expect(result.links).toEqual({});
  });

  it('returns an error object for network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const result = await resolveSonglinkUrl('https://example.com/failure');
    expect('error' in result).toBe(true);
    if (!('error' in result)) throw new Error('Expected error result');
    expect(result.error).toBe('network down');
    expect(result.links).toEqual({});
  });

  it('resolves batches with a max of ten inputs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => songlinkResponse,
    } as Response);
    const inputs = Array.from({ length: 12 }, (_, i) => `https://example.com/${i}`);
    const results = await resolveSonglinkBatch(inputs, { delayMs: 0 });
    expect(results).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});

describe('computeBatchDelay', () => {
  it('returns 0 for batches of 6 or fewer', () => {
    expect(computeBatchDelay(1, 0)).toBe(0);
    expect(computeBatchDelay(6, 0)).toBe(0);
    expect(computeBatchDelay(6, 5)).toBe(0);
  });

  it('uses adaptive delays for batches over 6', () => {
    expect(computeBatchDelay(7, 0)).toBe(2000);
    expect(computeBatchDelay(7, 1)).toBe(2000);
    expect(computeBatchDelay(10, 2)).toBe(4000);
    expect(computeBatchDelay(10, 3)).toBe(4000);
    expect(computeBatchDelay(10, 4)).toBe(6000);
    expect(computeBatchDelay(10, 5)).toBe(6000);
    expect(computeBatchDelay(10, 6)).toBe(8000);
    expect(computeBatchDelay(10, 7)).toBe(8000);
    expect(computeBatchDelay(10, 8)).toBe(10000);
    expect(computeBatchDelay(10, 9)).toBe(10000);
  });

  it('total adaptive delay for 10 inputs stays under 60s', () => {
    const total = Array.from({ length: 9 }, (_, i) => computeBatchDelay(10, i)).reduce((a, b) => a + b, 0);
    expect(total).toBe(50000);
    expect(total).toBeLessThan(60000);
  });
});
