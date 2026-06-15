# Spotify Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `ISpotifyAdapter` against the real Spotify Web API using raw `fetch`, with a one-time OAuth CLI script to obtain a refresh token and automatic access token renewal built in.

**Architecture:** Three units — a token module (`src/spotify/token.ts`) owns the access-token lifecycle and exposes a typed `spotifyFetch()` wrapper; an adapter class (`src/spotify/adapter.ts`) implements `ISpotifyAdapter` using that wrapper; a standalone script (`scripts/spotify-oauth.ts`) runs once to obtain the initial refresh token. Unit tests mock `fetch` (token module) and mock `spotifyFetch` (adapter). Integration tests skip when no `SPOTIFY_REFRESH_TOKEN` is present and verify end-to-end against the real API.

**Tech Stack:** TypeScript (strict, NodeNext ESM), Node.js built-in `fetch` + `http.createServer`, Vitest, `dotenv`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/spotify/token.ts` | Create | `SpotifyApiError`, token cache, `getAccessToken()`, `spotifyFetch()` |
| `src/spotify/adapter.ts` | Create | `SpotifyAdapter` class implementing `ISpotifyAdapter` |
| `scripts/spotify-oauth.ts` | Create | One-time OAuth CLI — prints refresh token, shuts down |
| `tests/spotify.token.test.ts` | Create | Unit tests for token module with mocked `fetch` |
| `tests/spotify.adapter.test.ts` | Create | Unit tests for adapter with mocked `spotifyFetch` |
| `tests/spotify.integration.test.ts` | Create | Real-API smoke tests, skipped if no `SPOTIFY_REFRESH_TOKEN` |
| `package.json` | Modify | Add `spotify-auth` and `test:integration` scripts |
| `.env.example` | Modify | Uncomment / clarify `SPOTIFY_REDIRECT_URI` and `SPOTIFY_REFRESH_TOKEN` |

**Import note:** All relative imports use `.js` extension (NodeNext). `src/spotify/` is a new directory — create it.

---

### Task 1: Token module — SpotifyApiError + getAccessToken + spotifyFetch

**Files:**
- Create: `src/spotify/token.ts`
- Create: `tests/spotify.token.test.ts`

- [ ] **Step 1: Write `tests/spotify.token.test.ts`**

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAccessToken, spotifyFetch, SpotifyApiError, _resetTokenCache } from '../src/spotify/token.js';

const mockFetch = vi.fn();

beforeEach(() => {
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
    // calls: [token refresh, first attempt, retry]
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
```

- [ ] **Step 2: Run to verify tests fail**

```
npm test -- tests/spotify.token.test.ts
```
Expected: `Cannot find module '../src/spotify/token.js'`

- [ ] **Step 3: Create `src/spotify/token.ts`**

```typescript
export class SpotifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

type TokenCache = { accessToken: string; expiresAt: number } | null;
let tokenCache: TokenCache = null;

export function _resetTokenCache(cache: TokenCache = null): void {
  tokenCache = cache;
}

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Spotify credentials. Ensure SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN are set in .env. Run `npm run spotify-auth` to get a refresh token.',
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  if (!response.ok) {
    throw new SpotifyApiError(response.status, `Token refresh failed: ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.accessToken;
}

export async function spotifyFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const url = path.startsWith('https://') ? path : `https://api.spotify.com/v1${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const attempt = () => fetch(url, { ...options, headers });
  const response = await attempt();

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '1', 10);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    const retried = await attempt();
    if (!retried.ok) {
      const body = (await retried.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new SpotifyApiError(retried.status, body.error?.message ?? retried.statusText);
    }
    return retried;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new SpotifyApiError(response.status, body.error?.message ?? response.statusText);
  }

  return response;
}
```

- [ ] **Step 4: Run to verify all tests pass**

```
npm test -- tests/spotify.token.test.ts
```
Expected: PASS (11 tests)

- [ ] **Step 5: Run full suite to confirm no regressions**

```
npm test
```
Expected: all 43 tests pass (32 existing + 11 new)

- [ ] **Step 6: Commit**

```bash
git add src/spotify/token.ts tests/spotify.token.test.ts
git commit -m "feat: add Spotify token module with auto-refresh and fetch wrapper"
```

---

### Task 2: SpotifyAdapter

**Files:**
- Create: `src/spotify/adapter.ts`
- Create: `tests/spotify.adapter.test.ts`

- [ ] **Step 1: Write `tests/spotify.adapter.test.ts`**

```typescript
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
    // Third call should be the POST to create
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
```

- [ ] **Step 2: Run to verify tests fail**

```
npm test -- tests/spotify.adapter.test.ts
```
Expected: `Cannot find module '../src/spotify/adapter.js'`

- [ ] **Step 3: Create `src/spotify/adapter.ts`**

```typescript
import type { ResolvedTrack, ISpotifyAdapter } from '../music/types.js';
import { spotifyFetch, SpotifyApiError } from './token.js';

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string };
  duration_ms: number;
  external_urls: { spotify: string };
}

function mapTrack(track: SpotifyTrack, confidence: number): ResolvedTrack {
  return {
    title: track.name,
    artist: track.artists[0].name,
    album: track.album.name,
    durationMs: track.duration_ms,
    spotifyTrackId: track.id,
    spotifyUri: track.uri,
    sourceUrl: track.external_urls.spotify,
    confidence,
  };
}

export class SpotifyAdapter implements ISpotifyAdapter {
  private userId: string | null = null;

  async searchTrack(query: string): Promise<ResolvedTrack | null> {
    const response = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=1`);
    const data = (await response.json()) as { tracks: { items: SpotifyTrack[] } };
    if (data.tracks.items.length === 0) return null;
    return mapTrack(data.tracks.items[0], 0.8);
  }

  async getTrackById(spotifyTrackId: string): Promise<ResolvedTrack | null> {
    try {
      const response = await spotifyFetch(`/tracks/${spotifyTrackId}`);
      return mapTrack((await response.json()) as SpotifyTrack, 1.0);
    } catch (err) {
      if (err instanceof Error && err.name === 'SpotifyApiError' && (err as SpotifyApiError).status === 404) {
        return null;
      }
      throw err;
    }
  }

  async findOrCreatePlaylist(name: string): Promise<string> {
    let url: string | null = '/me/playlists?limit=50';
    while (url) {
      const response = await spotifyFetch(url);
      const data = (await response.json()) as {
        items: Array<{ id: string; name: string }>;
        next: string | null;
      };
      const found = data.items.find((p) => p.name === name);
      if (found) return found.id;
      url = data.next;
    }

    const userId = await this.getUserId();
    const response = await spotifyFetch(`/users/${userId}/playlists`, {
      method: 'POST',
      body: JSON.stringify({ name, public: false }),
    });
    return ((await response.json()) as { id: string }).id;
  }

  async addTrackToPlaylist(playlistId: string, spotifyUri: string): Promise<void> {
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: [spotifyUri] }),
    });
  }

  async isTrackInPlaylist(playlistId: string, spotifyUri: string): Promise<boolean> {
    let url: string | null =
      `/playlists/${playlistId}/tracks?fields=items(track(uri)),next&limit=100`;
    while (url) {
      const response = await spotifyFetch(url);
      const data = (await response.json()) as {
        items: Array<{ track: { uri: string } | null }>;
        next: string | null;
      };
      if (data.items.some((item) => item.track?.uri === spotifyUri)) return true;
      url = data.next;
    }
    return false;
  }

  private async getUserId(): Promise<string> {
    if (this.userId) return this.userId;
    const response = await spotifyFetch('/me');
    this.userId = ((await response.json()) as { id: string }).id;
    return this.userId;
  }
}
```

- [ ] **Step 4: Run to verify all adapter tests pass**

```
npm test -- tests/spotify.adapter.test.ts
```
Expected: PASS (14 tests)

- [ ] **Step 5: Run full suite to confirm no regressions**

```
npm test
```
Expected: all 57 tests pass (43 existing + 14 new)

- [ ] **Step 6: Commit**

```bash
git add src/spotify/adapter.ts tests/spotify.adapter.test.ts
git commit -m "feat: add SpotifyAdapter implementing ISpotifyAdapter"
```

---

### Task 3: OAuth script

**Files:**
- Create: `scripts/spotify-oauth.ts`

No unit tests — this is a one-shot CLI tool. Verified by running it.

- [ ] **Step 1: Create `scripts/spotify-oauth.ts`**

```typescript
import 'dotenv/config';
import { createServer } from 'node:http';

async function main(): Promise<void> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error(
      'Error: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI must all be set in .env',
    );
    process.exit(1);
  }

  const scopes = [
    'playlist-modify-public',
    'playlist-modify-private',
    'playlist-read-private',
  ].join(' ');

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for Spotify callback on port 3888...\n');

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith('/oauth/spotify/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }

      const callbackUrl = new URL(req.url, 'http://localhost');
      const code = callbackUrl.searchParams.get('code');
      const error = callbackUrl.searchParams.get('error');

      if (error || !code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`OAuth error: ${error ?? 'missing code'}`);
        server.close();
        reject(new Error(`OAuth error: ${error ?? 'missing code'}`));
        return;
      }

      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Token exchange failed. Check your terminal.');
        server.close();
        reject(new Error(`Token exchange failed: ${text}`));
        return;
      }

      const tokens = (await tokenRes.json()) as { refresh_token: string };

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body style="font-family:sans-serif;padding:2rem"><h1>✅ Authorised!</h1><p>You can close this tab and return to the terminal.</p></body></html>',
      );

      console.log('\n✅ Success! Add this line to your .env file:\n');
      console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}\n`);

      server.close();
      resolve();
    });

    server.listen(3888, '0.0.0.0', () => {
      console.log('Listening on 0.0.0.0:3888 (Cloudflare tunnel → https://your-domain.example.com)\n');
    });
  });
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Add `spotify-auth` script to `package.json`**

In the `"scripts"` block, add:
```json
"spotify-auth": "tsx scripts/spotify-oauth.ts"
```

- [ ] **Step 3: Verify the script starts cleanly**

```
npm run spotify-auth
```
Expected: prints an auth URL and `Listening on 0.0.0.0:3888...`. Press Ctrl+C to cancel (don't complete the flow yet — that's done manually after this milestone).

- [ ] **Step 4: Commit**

```bash
git add scripts/spotify-oauth.ts package.json
git commit -m "feat: add Spotify OAuth one-time auth script"
```

---

### Task 4: Integration tests

**Files:**
- Create: `tests/spotify.integration.test.ts`
- Modify: `package.json` — add `test:integration` script

- [ ] **Step 1: Create `tests/spotify.integration.test.ts`**

```typescript
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SpotifyAdapter } from '../src/spotify/adapter.js';
import { spotifyFetch } from '../src/spotify/token.js';

const skipIntegration = !process.env.SPOTIFY_REFRESH_TOKEN;

describe.skipIf(skipIntegration)('Spotify integration (real API)', () => {
  const adapter = new SpotifyAdapter();
  let testPlaylistId = '';
  let testTrackId = '';
  let testTrackUri = '';

  beforeAll(async () => {
    const track = await adapter.searchTrack('Sade No Ordinary Love');
    if (!track?.spotifyTrackId || !track.spotifyUri) {
      throw new Error('Setup: could not find Sade track on Spotify');
    }
    testTrackId = track.spotifyTrackId;
    testTrackUri = track.spotifyUri;
    testPlaylistId = await adapter.findOrCreatePlaylist('mlbot-integration-test');
  });

  afterAll(async () => {
    if (testPlaylistId) {
      await spotifyFetch(`/playlists/${testPlaylistId}/followers`, { method: 'DELETE' });
    }
  });

  it('searchTrack returns Sade for "Sade No Ordinary Love"', async () => {
    const track = await adapter.searchTrack('Sade No Ordinary Love');
    expect(track).not.toBeNull();
    expect(track!.artist).toBe('Sade');
    expect(track!.confidence).toBe(0.8);
    expect(track!.spotifyUri).toMatch(/^spotify:track:/);
  });

  it('getTrackById returns the same track with confidence 1.0', async () => {
    const track = await adapter.getTrackById(testTrackId);
    expect(track).not.toBeNull();
    expect(track!.confidence).toBe(1.0);
    expect(track!.spotifyTrackId).toBe(testTrackId);
  });

  it('getTrackById returns null for a nonexistent ID', async () => {
    const track = await adapter.getTrackById('00000000000000000000000000');
    expect(track).toBeNull();
  });

  it('findOrCreatePlaylist returns same ID on second call', async () => {
    const id = await adapter.findOrCreatePlaylist('mlbot-integration-test');
    expect(id).toBe(testPlaylistId);
  });

  it('addTrackToPlaylist adds the track without error', async () => {
    await expect(
      adapter.addTrackToPlaylist(testPlaylistId, testTrackUri),
    ).resolves.toBeUndefined();
  });

  it('isTrackInPlaylist returns true for the added track', async () => {
    const found = await adapter.isTrackInPlaylist(testPlaylistId, testTrackUri);
    expect(found).toBe(true);
  });

  it('isTrackInPlaylist returns false for a URI not in the playlist', async () => {
    const found = await adapter.isTrackInPlaylist(
      testPlaylistId,
      'spotify:track:00000000000000000000000000',
    );
    expect(found).toBe(false);
  });
});
```

- [ ] **Step 2: Add `test:integration` script to `package.json`**

```json
"test:integration": "vitest run tests/spotify.integration.test.ts"
```

- [ ] **Step 3: Run integration tests with no token set — confirm they are skipped**

```
npm run test:integration
```
Expected: `0 tests | 0 passed | 1 skipped` (or similar — the describe block is skipped entirely)

- [ ] **Step 4: Commit**

```bash
git add tests/spotify.integration.test.ts package.json
git commit -m "feat: add Spotify integration smoke tests"
```

---

### Task 5: .env.example update + README note

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Update `.env.example`**

Replace the Spotify section with:
```
# Spotify — run `npm run spotify-auth` to get SPOTIFY_REFRESH_TOKEN
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=https://your-domain.example.com/oauth/spotify/callback
SPOTIFY_REFRESH_TOKEN=
```

- [ ] **Step 2: Add a "Spotify setup" section to README.md**

After the "Running tests" section, add:

```markdown
## Spotify setup

1. Create an app at https://developer.spotify.com/dashboard
2. Add `https://your-domain.example.com/oauth/spotify/callback` as a Redirect URI
3. Copy Client ID and Client Secret into `.env`
4. Run the one-time auth flow:

```bash
npm run spotify-auth
```

Open the printed URL in your browser, authorise the app, then copy the printed `SPOTIFY_REFRESH_TOKEN` into `.env`. You only need to do this once.

5. Verify with:

```bash
npm run test:integration
```
```

- [ ] **Step 3: Run `npm test` to confirm all unit tests still pass**

```
npm test
```
Expected: 57 tests pass, no failures.

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add Spotify setup instructions and update .env.example"
```

---

## Self-Review

**Spec coverage:**
- [x] OAuth script (`scripts/spotify-oauth.ts`) — Task 3
- [x] Token cache + `getAccessToken()` — Task 1
- [x] `spotifyFetch()` wrapper with auto-refresh — Task 1
- [x] `SpotifyApiError` — Task 1
- [x] `searchTrack()` — Task 2
- [x] `getTrackById()` returning null on 404 — Task 2
- [x] `findOrCreatePlaylist()` with pagination — Task 2
- [x] `addTrackToPlaylist()` — Task 2
- [x] `isTrackInPlaylist()` with pagination — Task 2
- [x] 429 retry once — Task 1
- [x] Unit tests (mocked fetch) — Tasks 1, 2
- [x] Integration tests (real API, skipped without token) — Task 4
- [x] `spotify-auth` and `test:integration` npm scripts — Tasks 3, 4
- [x] `.env.example` and README — Task 5

**Placeholder scan:** No TBD/TODO patterns. All code blocks are complete.

**Type consistency:**
- `SpotifyApiError` defined in `token.ts`, imported in `adapter.ts` ✓
- `ISpotifyAdapter` from `src/music/types.ts`, implemented by `SpotifyAdapter` ✓
- `ResolvedTrack` from `src/music/types.ts`, returned by `searchTrack`/`getTrackById` ✓
- `spotifyFetch` exported from `token.ts`, imported in `adapter.ts` and `integration.test.ts` ✓
- `_resetTokenCache` exported for test use only ✓
