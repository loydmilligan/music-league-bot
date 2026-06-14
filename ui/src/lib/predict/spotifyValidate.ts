import { getSpotifyToken } from '../spotify.js';

export interface ValidatedTrack {
  title: string;
  artist: string;
  spotify_url?: string;
  album_art_url?: string;
  resolved: boolean;
}

interface SpotifySearchHit {
  uri: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    images: Array<{ url: string; width?: number; height?: number }>;
  };
}

interface SpotifySearchResponse {
  tracks?: { items: SpotifySearchHit[] };
}

async function searchOne(
  title: string,
  artist: string,
  token: string,
  fetcher: typeof fetch,
): Promise<{ title: string; artist: string; spotify_url: string; album_art_url?: string } | null> {
  try {
    const q = encodeURIComponent(`track:${title} artist:${artist}`);
    const url = `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`;
    const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as SpotifySearchResponse;
    const hit = data.tracks?.items?.[0];
    if (!hit) return null;
    const trackId = hit.uri.split(':')[2];
    const bestArt = hit.album?.images?.slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
    return {
      title: hit.name,
      artist: hit.artists.map((a) => a.name).join(', '),
      spotify_url: `https://open.spotify.com/track/${trackId}`,
      album_art_url: bestArt,
    };
  } catch {
    return null;
  }
}

/**
 * Spotify-validate a list of LLM-proposed candidates.
 *
 * Each candidate is searched via the app's existing Spotify client-credentials
 * token. Resolved items carry canonical title/artist/url/art from Spotify.
 * Unresolved items echo the input title/artist with resolved:false.
 *
 * Order is preserved. Never throws — any per-candidate failure returns resolved:false.
 *
 * @param candidates  title+artist pairs from the LLM
 * @param fetcher     injectable for tests (defaults to global fetch)
 */
export async function validateTracks(
  candidates: { title: string; artist: string }[],
  fetcher: typeof fetch = fetch,
): Promise<ValidatedTrack[]> {
  let token: string | null = null;
  try {
    token = await getSpotifyToken();
  } catch {
    token = null;
  }

  return Promise.all(
    candidates.map(async (c): Promise<ValidatedTrack> => {
      if (!token) {
        return { title: c.title, artist: c.artist, resolved: false };
      }
      try {
        const match = await searchOne(c.title, c.artist, token, fetcher);
        if (!match) {
          return { title: c.title, artist: c.artist, resolved: false };
        }
        return {
          title: match.title,
          artist: match.artist,
          spotify_url: match.spotify_url,
          album_art_url: match.album_art_url,
          resolved: true,
        };
      } catch {
        return { title: c.title, artist: c.artist, resolved: false };
      }
    }),
  );
}
