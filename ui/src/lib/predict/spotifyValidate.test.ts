import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateTracks } from './spotifyValidate.js';

vi.mock('../spotify.js', () => ({
  getSpotifyToken: vi.fn().mockResolvedValue('mock-token'),
}));

import { getSpotifyToken } from '../spotify.js';
const mockGetToken = vi.mocked(getSpotifyToken);

// ── Fixture responses ──────────────────────────────────────────────────────────

const RICKROLL_HIT = {
  uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
  name: 'Never Gonna Give You Up',
  artists: [{ name: 'Rick Astley' }],
  album: {
    images: [
      { url: 'https://example.com/art640.jpg', width: 640, height: 640 },
      { url: 'https://example.com/art300.jpg', width: 300, height: 300 },
    ],
  },
};

const FOUND_RESPONSE = { tracks: { items: [RICKROLL_HIT] } };
const EMPTY_RESPONSE = { tracks: { items: [] } };

function makeFetcher(responses: object[]): typeof fetch {
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce({ ok: true, json: async () => r } as unknown as Response);
  }
  return mock as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetToken.mockResolvedValue('mock-token');
});

// ── Resolved path ──────────────────────────────────────────────────────────────

describe('validateTracks — resolved path', () => {
  it('returns resolved:true with canonical title/artist/url for a known song', async () => {
    const fetcher = makeFetcher([FOUND_RESPONSE]);
    const [result] = await validateTracks(
      [{ title: 'Never Gonna Give You Up', artist: 'Rick Astley' }],
      fetcher,
    );
    expect(result.resolved).toBe(true);
    expect(result.title).toBe('Never Gonna Give You Up');
    expect(result.artist).toBe('Rick Astley');
    expect(result.spotify_url).toBe(
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    );
  });

  it('carries the largest album art image', async () => {
    const fetcher = makeFetcher([FOUND_RESPONSE]);
    const [result] = await validateTracks(
      [{ title: 'Never Gonna Give You Up', artist: 'Rick Astley' }],
      fetcher,
    );
    expect(result.album_art_url).toBe('https://example.com/art640.jpg');
  });
});

// ── Unresolved path ────────────────────────────────────────────────────────────

describe('validateTracks — unresolved path', () => {
  it('returns resolved:false when Spotify returns no hits', async () => {
    const fetcher = makeFetcher([EMPTY_RESPONSE]);
    const [result] = await validateTracks(
      [{ title: 'xyzzy-nonsense-12345', artist: 'nobody-fake-99' }],
      fetcher,
    );
    expect(result.resolved).toBe(false);
    expect(result.spotify_url).toBeUndefined();
    expect(result.title).toBe('xyzzy-nonsense-12345');
    expect(result.artist).toBe('nobody-fake-99');
  });

  it('never throws when the fetcher rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;
    await expect(
      validateTracks([{ title: 'test', artist: 'artist' }], fetcher),
    ).resolves.toHaveLength(1);
    const [result] = await validateTracks([{ title: 'test', artist: 'artist' }], fetcher);
    expect(result.resolved).toBe(false);
  });

  it('never throws when the fetcher returns a non-ok response', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const [result] = await validateTracks([{ title: 'test', artist: 'artist' }], fetcher);
    expect(result.resolved).toBe(false);
  });

  it('returns resolved:false when no Spotify token available', async () => {
    mockGetToken.mockResolvedValue(null);
    const fetcher = vi.fn() as unknown as typeof fetch;
    const [result] = await validateTracks([{ title: 'test', artist: 'artist' }], fetcher);
    expect(result.resolved).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns resolved:false when getSpotifyToken throws', async () => {
    mockGetToken.mockRejectedValue(new Error('creds missing'));
    const fetcher = vi.fn() as unknown as typeof fetch;
    const [result] = await validateTracks([{ title: 'test', artist: 'artist' }], fetcher);
    expect(result.resolved).toBe(false);
  });
});

// ── Order preservation ─────────────────────────────────────────────────────────

describe('validateTracks — order preservation', () => {
  it('preserves input order across resolved and unresolved candidates', async () => {
    const fetcher = makeFetcher([FOUND_RESPONSE, EMPTY_RESPONSE, FOUND_RESPONSE]);
    const candidates = [
      { title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
      { title: 'xyzzy-nonsense', artist: 'nobody' },
      { title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
    ];
    const results = await validateTracks(candidates, fetcher);
    expect(results).toHaveLength(3);
    expect(results[0].resolved).toBe(true);
    expect(results[1].resolved).toBe(false);
    expect(results[2].resolved).toBe(true);
  });

  it('handles empty candidates array', async () => {
    const fetcher = makeFetcher([]);
    const results = await validateTracks([], fetcher);
    expect(results).toHaveLength(0);
  });
});
