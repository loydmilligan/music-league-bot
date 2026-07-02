/**
 * Shared Spotify API client. Caches the client-credentials token in-process.
 * Returns null from `getSpotifyToken()` when env credentials are missing so
 * callers can gracefully no-op instead of throwing.
 */

let _token: { value: string; expiresAt: number } | null = null;

export async function getSpotifyToken(): Promise<string | null> {
  if (_token && _token.expiresAt > Date.now()) return _token.value;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  _token = {
    value: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
  };
  return _token.value;
}

export interface PlaylistTrack {
  spotifyUri: string;
  title: string;
  artist: string;
  album: string | null;
}

const PLAYLIST_ID_RE = /^https:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/;

/**
 * Extract a Spotify playlist ID from any of the URL shapes Spotify produces:
 *   https://open.spotify.com/playlist/<ID>
 *   https://open.spotify.com/playlist/<ID>?si=...
 *   spotify:playlist:<ID>
 * Returns null if nothing matches — callers should treat this as 400.
 */
export function parsePlaylistId(url: string): string | null {
  const trimmed = url.trim();
  const m = trimmed.match(PLAYLIST_ID_RE);
  if (m) return m[1];
  const uri = trimmed.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (uri) return uri[1];
  return null;
}

/**
 * Page through a playlist's tracks. Skips local files (no spotify URI) and
 * episode items. Returns a flat list ready for ml_submissions insertion.
 *
 * Injectable `fetcher` so tests don't hit the network — defaults to global fetch.
 */
export async function fetchPlaylistTracks(
  playlistId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<PlaylistTrack[]> {
  const tracks: PlaylistTrack[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?fields=` +
    encodeURIComponent('items(track(uri,name,artists(name),album(name),type)),next') +
    '&limit=100';

  while (url) {
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Spotify playlist fetch failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { items?: any[]; next?: string | null };
    for (const item of data.items ?? []) {
      const t = item.track;
      if (!t || t.type !== 'track' || !t.uri || !t.uri.startsWith('spotify:track:')) continue;
      tracks.push({
        spotifyUri: t.uri,
        title: t.name ?? '',
        artist: Array.isArray(t.artists) ? t.artists.map((a: any) => a?.name ?? '').filter(Boolean).join(', ') : '',
        album: t.album?.name ?? null,
      });
    }
    url = data.next ?? null;
  }
  return tracks;
}

/**
 * Fetch Spotify track popularity (0–100) for a list of spotify:track: URIs.
 * Batches 50 ids/request. Returns an empty map when creds are missing or on
 * any error (best-effort — callers treat absence as "no Spotify signal").
 */
export async function fetchSpotifyPopularity(uris: string[]): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	if (!uris.length) return out;
	const token = await getSpotifyToken();
	if (!token) return out;
	const ids = uris.map((u) => u.split(':').pop()!).filter(Boolean);
	try {
		for (let i = 0; i < ids.length; i += 50) {
			const batch = ids.slice(i, i + 50);
			const r = await fetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!r.ok) continue;
			const { tracks } = (await r.json()) as { tracks: ({ uri: string; popularity?: number } | null)[] };
			for (const t of tracks) if (t && typeof t.popularity === 'number') out.set(t.uri, t.popularity);
		}
	} catch (e) {
		console.warn('[spotify] popularity fetch skipped:', e instanceof Error ? e.message : String(e));
	}
	return out;
}
