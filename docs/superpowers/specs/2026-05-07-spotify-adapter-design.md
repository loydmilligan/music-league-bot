# Spotify Adapter Design

**Scope:** Milestone 2a — Spotify adapter only. Song resolver is a separate subsequent milestone.

**Goal:** Implement the `ISpotifyAdapter` interface against the real Spotify Web API using raw `fetch`, with a one-time OAuth script to obtain a refresh token and automatic access token refresh built into the fetch wrapper.

---

## File Structure

```
scripts/
  spotify-oauth.ts          One-time CLI script: runs OAuth flow, prints refresh token

src/spotify/
  token.ts                  In-memory token cache + spotifyFetch() wrapper
  adapter.ts                SpotifyAdapter class implementing ISpotifyAdapter

tests/
  spotify.adapter.test.ts   Unit tests with fetch mocked via vi.stubGlobal
  spotify.integration.test.ts  Real API smoke tests (skipped if SPOTIFY_REFRESH_TOKEN unset)
```

---

## OAuth Script (`scripts/spotify-oauth.ts`)

Run once via `npm run spotify-auth`. Never committed to git; not imported by any other module.

**Flow:**
1. Reads `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` from `.env`
2. Constructs Spotify authorization URL with scopes: `playlist-modify-public playlist-modify-private playlist-read-private`
3. Prints the URL and instructs user to open it in a browser
4. Starts HTTP server bound to `0.0.0.0:3888`
5. Receives callback at `/oauth/spotify/callback?code=...` (forwarded from Cloudflare tunnel at `https://mlbot.mattmariani.com`)
6. Exchanges code for tokens via POST to `https://accounts.spotify.com/api/token`
7. Prints `SPOTIFY_REFRESH_TOKEN=<value>` to terminal
8. Shuts down the server

User copies the printed token into `.env`. This is the only time the OAuth flow needs to run unless credentials are revoked.

**Required `.env` values before running:**
```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=https://mlbot.mattmariani.com/oauth/spotify/callback
```

**Added to `.env` after running:**
```
SPOTIFY_REFRESH_TOKEN=
```

---

## Token Store + Fetch Wrapper (`src/spotify/token.ts`)

### Exports

**`getAccessToken(): Promise<string>`**

Maintains a module-level cache:
```typescript
type TokenCache = { accessToken: string; expiresAt: number } | null;
```

- Returns cached token if `Date.now() < expiresAt - 60_000` (60-second buffer)
- Otherwise calls `https://accounts.spotify.com/api/token` with grant type `refresh_token`
- Updates cache with new token and `expiresAt = Date.now() + expires_in * 1000`
- Reads `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN` from `process.env`
- Throws `SpotifyApiError` if token endpoint returns non-2xx

**`spotifyFetch(path: string, options?: RequestInit): Promise<Response>`**

- Calls `getAccessToken()`
- Attaches `Authorization: Bearer <token>` header
- Calls `https://api.spotify.com/v1<path>`
- On **429**: reads `Retry-After` header (seconds), waits, retries once
- On **non-2xx** (after any retry): throws `SpotifyApiError({ status, message })`
- Returns the raw `Response` on success (2xx)

### Error class

```typescript
export class SpotifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}
```

---

## SpotifyAdapter (`src/spotify/adapter.ts`)

Implements `ISpotifyAdapter` from `src/music/types.ts`. Stateless except for a cached user ID (fetched once via `GET /v1/me` and reused for playlist creation).

### Methods

**`searchTrack(query: string): Promise<ResolvedTrack | null>`**
- `GET /v1/search?q=<encoded query>&type=track&limit=1`
- Maps first item to `ResolvedTrack` with `confidence: 0.8`
- Returns `null` if `tracks.items` is empty

**`getTrackById(spotifyTrackId: string): Promise<ResolvedTrack | null>`**
- `GET /v1/tracks/<id>`
- Maps to `ResolvedTrack` with `confidence: 1.0`
- Returns `null` on 404

**`findOrCreatePlaylist(name: string): Promise<string>`**
- `GET /v1/me/playlists?limit=50` — paginated until all playlists fetched
- Returns `id` if a playlist with exact `name` match found
- If not found: fetches user ID via `GET /v1/me` (cached), creates playlist via `POST /v1/users/<userId>/playlists` with `{ name, public: false }`
- Returns new playlist `id`

**`addTrackToPlaylist(playlistId: string, spotifyUri: string): Promise<void>`**
- `POST /v1/playlists/<playlistId>/tracks` with body `{ uris: [spotifyUri] }`

**`isTrackInPlaylist(playlistId: string, spotifyUri: string): Promise<boolean>`**
- `GET /v1/playlists/<playlistId>/tracks?fields=items(track(uri)),next&limit=100`
- Pages through all tracks until URI found or list exhausted
- Returns `true` if found, `false` otherwise

### ResolvedTrack mapping

Both `searchTrack` and `getTrackById` map Spotify track objects to `ResolvedTrack`:
```
title         ← track.name
artist        ← track.artists[0].name
album         ← track.album.name
durationMs    ← track.duration_ms
spotifyTrackId ← track.id
spotifyUri    ← track.uri
sourceUrl     ← track.external_urls.spotify
confidence    ← 0.8 (search) | 1.0 (direct lookup)
youtubeVideoId ← undefined (not populated at this stage)
```

---

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| 401 from any Spotify call | Throw `SpotifyApiError(401, ...)` — signals revoked credentials, re-run OAuth script |
| 404 from `getTrackById` | Return `null` |
| 429 Rate Limited | Read `Retry-After`, wait, retry once; throw if still fails |
| Other non-2xx | Throw `SpotifyApiError(status, message)` |
| `SPOTIFY_REFRESH_TOKEN` not set | Throw with clear message on first `getAccessToken()` call |

---

## Testing

### Unit tests (`tests/spotify.adapter.test.ts`)

Mock `fetch` globally with `vi.stubGlobal('fetch', mockFn)`. Restore after each test.

Covers:
- `getAccessToken()` uses cached token when valid
- `getAccessToken()` refreshes when expired
- `searchTrack()` maps response correctly
- `searchTrack()` returns null on empty results
- `getTrackById()` maps response with confidence 1.0
- `getTrackById()` returns null on 404
- `findOrCreatePlaylist()` returns existing playlist ID by name
- `findOrCreatePlaylist()` creates playlist when not found
- `findOrCreatePlaylist()` paginates correctly
- `isTrackInPlaylist()` returns true when URI present
- `isTrackInPlaylist()` returns false when URI absent
- `spotifyFetch()` throws `SpotifyApiError` on non-2xx
- `spotifyFetch()` retries once on 429

### Integration tests (`tests/spotify.integration.test.ts`)

Skipped automatically if `SPOTIFY_REFRESH_TOKEN` is not set in environment.

Run via `npm run test:integration`.

Covers (against real Spotify API), run sequentially:
- Token refresh produces a valid access token
- `searchTrack('Sade No Ordinary Love')` returns a result with `artist === 'Sade'`
- `getTrackById(<id from search result>)` returns correct track metadata with `confidence === 1.0`
- `findOrCreatePlaylist('mlbot-integration-test')` creates the playlist, returns an ID
- `addTrackToPlaylist(<playlist id>, <uri from search result>)` adds the track without error
- `isTrackInPlaylist(<playlist id>, <uri from search result>)` returns `true`
- Cleanup: unfollow test playlist via `DELETE /v1/playlists/<id>/followers`

---

## package.json additions

```json
"scripts": {
  "spotify-auth": "tsx scripts/spotify-oauth.ts",
  "test:integration": "vitest run tests/spotify.integration.test.ts"
}
```

---

## Constraints

- No WhatsApp, no SongResolver, no database in this milestone
- Playlists created as private by default
- Only the Spotify account that ran the OAuth flow can own/manage playlists
- `SPOTIFY_REFRESH_TOKEN` must be set before running the bot or integration tests
