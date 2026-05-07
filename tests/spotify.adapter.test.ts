import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/spotify/token.js', () => ({
  spotifyFetch: vi.fn(),
  SpotifyApiError: class SpotifyApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'SpotifyApiError';
      this.status = status;
    }
  },
}));

import { SpotifyAdapter } from '../src/spotify/adapter.js';
import { spotifyFetch, SpotifyApiError } from '../src/spotify/token.js';

const mockFetch = vi.mocked(spotifyFetch);

function mockOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => data,
  } as unknown as Response);
}

const sadeTrack = {
  id: 'track1',
  uri: 'spotify:track:track1',
  name: 'No Ordinary Love',
  artists: [{ name: 'Sade' }],
  album: { name: 'Love Deluxe' },
  duration_ms: 290000,
  external_urls: { spotify: 'https://open.spotify.com/track/track1' },
};

beforeEach(() => {
  mockFetch.mockClear();
});

describe('searchTrack', () => {
  it('returns a mapped ResolvedTrack with confidence 0.8', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({ tracks: { items: [sadeTrack] } });
    const result = await adapter.searchTrack('Sade No Ordinary Love');
    expect(result).toEqual({
      title: 'No Ordinary Love',
      artist: 'Sade',
      album: 'Love Deluxe',
      durationMs: 290000,
      spotifyTrackId: 'track1',
      spotifyUri: 'spotify:track:track1',
      sourceUrl: 'https://open.spotify.com/track/track1',
      confidence: 0.8,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/search?q='),
    );
  });

  it('returns null when no results', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({ tracks: { items: [] } });
    expect(await adapter.searchTrack('unknown xyz')).toBeNull();
  });
});

describe('getTrackById', () => {
  it('returns a mapped ResolvedTrack with confidence 1.0', async () => {
    const adapter = new SpotifyAdapter();
    mockOk(sadeTrack);
    const result = await adapter.getTrackById('track1');
    expect(result?.confidence).toBe(1.0);
    expect(result?.spotifyTrackId).toBe('track1');
    expect(result?.title).toBe('No Ordinary Love');
  });

  it('returns null when SpotifyApiError status is 404', async () => {
    const adapter = new SpotifyAdapter();
    mockFetch.mockRejectedValueOnce(new SpotifyApiError(404, 'Not Found'));
    expect(await adapter.getTrackById('nonexistent')).toBeNull();
  });

  it('rethrows non-404 SpotifyApiError', async () => {
    const adapter = new SpotifyAdapter();
    mockFetch.mockRejectedValueOnce(new SpotifyApiError(500, 'Server Error'));
    await expect(adapter.getTrackById('track1')).rejects.toBeInstanceOf(SpotifyApiError);
  });
});

describe('findOrCreatePlaylist', () => {
  it('returns existing playlist ID by exact name', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({
      items: [
        { id: 'p1', name: 'Music League - Week 19' },
        { id: 'p2', name: 'Other' },
      ],
      next: null,
    });
    expect(await adapter.findOrCreatePlaylist('Music League - Week 19')).toBe('p1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('paginates and finds playlist on second page', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({
      items: [{ id: 'p1', name: 'Other' }],
      next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50',
    });
    mockOk({
      items: [{ id: 'p2', name: 'Music League - Week 19' }],
      next: null,
    });
    expect(await adapter.findOrCreatePlaylist('Music League - Week 19')).toBe('p2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('creates a private playlist when name not found', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({ items: [], next: null }); // empty playlists list
    mockOk({ id: 'user123' });         // GET /me
    mockOk({ id: 'new-playlist' });    // POST create
    expect(await adapter.findOrCreatePlaylist('Music League - Week 19')).toBe('new-playlist');
    expect(mockFetch.mock.calls[2][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'Music League - Week 19', public: false }),
    });
  });

  it('caches user ID — calls GET /me only once across two creations', async () => {
    const adapter = new SpotifyAdapter();
    // First findOrCreate: create playlist A
    mockOk({ items: [], next: null });
    mockOk({ id: 'user123' });
    mockOk({ id: 'playlist-a' });
    await adapter.findOrCreatePlaylist('Playlist A');

    // Second findOrCreate: create playlist B — should NOT call GET /me again
    mockOk({ items: [], next: null });
    mockOk({ id: 'playlist-b' });
    await adapter.findOrCreatePlaylist('Playlist B');

    const getMeCalls = mockFetch.mock.calls.filter(([path]) =>
      typeof path === 'string' && path === '/me',
    );
    expect(getMeCalls).toHaveLength(1);
  });
});

describe('addTrackToPlaylist', () => {
  it('posts the correct URI to the playlist endpoint', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({ snapshot_id: 'snap1' });
    await adapter.addTrackToPlaylist('playlist1', 'spotify:track:track1');
    expect(mockFetch).toHaveBeenCalledWith('/playlists/playlist1/tracks', {
      method: 'POST',
      body: JSON.stringify({ uris: ['spotify:track:track1'] }),
    });
  });
});

describe('isTrackInPlaylist', () => {
  it('returns true when URI is in first page', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({
      items: [{ track: { uri: 'spotify:track:other' } }, { track: { uri: 'spotify:track:track1' } }],
      next: null,
    });
    expect(await adapter.isTrackInPlaylist('playlist1', 'spotify:track:track1')).toBe(true);
  });

  it('returns false when URI is not in any page', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({
      items: [{ track: { uri: 'spotify:track:other' } }],
      next: null,
    });
    expect(await adapter.isTrackInPlaylist('playlist1', 'spotify:track:missing')).toBe(false);
  });

  it('paginates and finds URI on second page', async () => {
    const adapter = new SpotifyAdapter();
    mockOk({
      items: [{ track: { uri: 'spotify:track:other' } }],
      next: 'https://api.spotify.com/v1/playlists/playlist1/tracks?offset=100',
    });
    mockOk({
      items: [{ track: { uri: 'spotify:track:track1' } }],
      next: null,
    });
    expect(await adapter.isTrackInPlaylist('playlist1', 'spotify:track:track1')).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
