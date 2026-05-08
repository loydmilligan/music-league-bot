import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAccessToken, spotifyFetch, SpotifyApiError, _resetTokenCache } from '../src/spotify/token.js';

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  _resetTokenCache();
  process.env.SPOTIFY_CLIENT_ID = 'test-id';
  process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
  process.env.SPOTIFY_REFRESH_TOKEN = 'test-refresh';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  delete process.env.SPOTIFY_REFRESH_TOKEN;
});

function mockTokenOk(accessToken = 'test-token', expiresIn = 3600) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ access_token: accessToken, expires_in: expiresIn }),
  });
}

describe('getAccessToken', () => {
  it('fetches a new token when cache is empty', async () => {
    mockTokenOk();
    const token = await getAccessToken();
    expect(token).toBe('test-token');
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://accounts.spotify.com/api/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns cached token without a network call when still valid', async () => {
    mockTokenOk();
    await getAccessToken();
    mockFetch.mockClear();
    const token = await getAccessToken();
    expect(token).toBe('test-token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches a new token when cache is expired', async () => {
    _resetTokenCache({ accessToken: 'old-token', expiresAt: Date.now() - 1000 });
    mockTokenOk('new-token');
    const token = await getAccessToken();
    expect(token).toBe('new-token');
  });

  it('refreshes a token within the 60-second buffer window', async () => {
    _resetTokenCache({ accessToken: 'about-to-expire', expiresAt: Date.now() + 30_000 });
    mockTokenOk('fresh-token');
    const token = await getAccessToken();
    expect(token).toBe('fresh-token');
  });

  it('uses cached token when more than 60 seconds remain', async () => {
    _resetTokenCache({ accessToken: 'still-good', expiresAt: Date.now() + 90_000 });
    const token = await getAccessToken();
    expect(token).toBe('still-good');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws a plain Error when SPOTIFY_REFRESH_TOKEN is not set', async () => {
    delete process.env.SPOTIFY_REFRESH_TOKEN;
    await expect(getAccessToken()).rejects.toThrow('SPOTIFY_REFRESH_TOKEN');
  });

  it('throws SpotifyApiError when token endpoint returns non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });
    await expect(getAccessToken()).rejects.toBeInstanceOf(SpotifyApiError);
  });
});

describe('spotifyFetch', () => {
  it('prepends base URL when given a path', async () => {
    mockTokenOk();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await spotifyFetch('/me');
    const [url] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.spotify.com/v1/me');
  });

  it('uses a full URL directly without prepending', async () => {
    mockTokenOk();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await spotifyFetch('https://api.spotify.com/v1/me/playlists?offset=50');
    const [url] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.spotify.com/v1/me/playlists?offset=50');
  });

  it('attaches Bearer authorization header', async () => {
    mockTokenOk();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await spotifyFetch('/me');
    const [, options] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
  });

  it('throws SpotifyApiError on non-2xx response', async () => {
    mockTokenOk();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'Insufficient scope' } }),
    });
    const err = await spotifyFetch('/me').catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyApiError);
    expect((err as SpotifyApiError).status).toBe(403);
  });

  it('retries once on 429 and returns success response', async () => {
    mockTokenOk();
    mockFetch
      .mockResolvedValueOnce({
        status: 429,
        ok: false,
        headers: { get: (h: string) => (h === 'Retry-After' ? '0' : null) },
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const response = await spotifyFetch('/me');
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws SpotifyApiError if retry after 429 also fails', async () => {
    mockTokenOk();
    mockFetch
      .mockResolvedValueOnce({
        status: 429,
        ok: false,
        headers: { get: (h: string) => (h === 'Retry-After' ? '0' : null) },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({}),
      });
    await expect(spotifyFetch('/me')).rejects.toBeInstanceOf(SpotifyApiError);
  });
});
