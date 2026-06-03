// Lightweight Spotify Web API client for the ui workspace, scoped to the
// minimum surface ingest needs: token (client_credentials), one track, all
// tracks of an album, all tracks of a playlist. Mirrors the existing inline
// client at ui/src/routes/api/spotify/search/+server.ts but extracted so the
// ingest endpoint can reuse it. Does NOT replace the root src/spotify/* (which
// uses refresh_token for user-scoped operations like playlist mutation).

let _token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now()) return _token.value;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token request failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return _token.value;
}

async function api<T>(path: string): Promise<T> {
  const token = await getToken();
  const url = path.startsWith('https://') ? path : `https://api.spotify.com/v1${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Spotify ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export type SpotifyUrlKind = 'track' | 'album' | 'playlist';
export interface ParsedSpotifyUrl {
  kind: SpotifyUrlKind;
  id: string;
  uri: string;
}

const SPOTIFY_URL_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([A-Za-z0-9]{15,40})(?:\?|$|#|\/)/;
const SPOTIFY_URI_RE = /^spotify:(track|album|playlist):([A-Za-z0-9]{15,40})$/;

export function parseSpotifyUrl(input: string): ParsedSpotifyUrl | null {
  const trimmed = input.trim();
  const m = trimmed.match(SPOTIFY_URL_RE) || trimmed.match(SPOTIFY_URI_RE);
  if (!m) return null;
  const kind = m[1] as SpotifyUrlKind;
  const id = m[2];
  return { kind, id, uri: `spotify:${kind}:${id}` };
}

interface SpotifyImage { url: string; width?: number; height?: number }
interface SpotifyArtist { name: string }
interface SpotifyAlbumRef {
  name: string;
  release_date?: string;
  images?: SpotifyImage[];
}
export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: SpotifyArtist[];
  album?: SpotifyAlbumRef;
  duration_ms?: number;
}

export interface ResolvedTrack {
  id: string;          // raw Spotify track id
  uri: string;         // spotify:track:<id>
  title: string;
  artist: string;      // joined "A, B, C"
  album: string | null;
  year: number | null;
  durationSec: number | null;
  albumArtUrl: string | null;
}

function joinArtists(artists: SpotifyArtist[] | undefined): string {
  return (artists ?? []).map(a => a.name).join(', ');
}

function yearOf(album: SpotifyAlbumRef | undefined): number | null {
  const d = album?.release_date;
  if (!d) return null;
  const y = Number(d.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function bestArt(album: SpotifyAlbumRef | undefined): string | null {
  const imgs = album?.images;
  if (!imgs || !imgs.length) return null;
  // Spotify returns largest first; if widths present, pick max.
  const sorted = [...imgs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0].url;
}

function toResolved(t: SpotifyTrack): ResolvedTrack {
  return {
    id: t.id,
    uri: t.uri,
    title: t.name,
    artist: joinArtists(t.artists),
    album: t.album?.name ?? null,
    year: yearOf(t.album),
    durationSec: typeof t.duration_ms === 'number' ? Math.round(t.duration_ms / 1000) : null,
    albumArtUrl: bestArt(t.album),
  };
}

export async function fetchTrack(id: string): Promise<ResolvedTrack> {
  const t = await api<SpotifyTrack>(`/tracks/${id}`);
  return toResolved(t);
}

// Batch track lookup (Spotify allows up to 50 ids per call). Paginates over
// larger id lists; skips null entries (unmatched / removed tracks).
export async function fetchTracks(ids: string[]): Promise<ResolvedTrack[]> {
  const out: ResolvedTrack[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const { tracks } = await api<{ tracks: (SpotifyTrack | null)[] }>(`/tracks?ids=${batch.join(',')}`);
    for (const t of tracks) if (t && t.id) out.push(toResolved(t));
  }
  return out;
}

interface SpotifyAlbumFull extends SpotifyAlbumRef {
  id: string;
  tracks: { items: SpotifyTrack[]; next: string | null };
}

export async function fetchAlbumTracks(id: string): Promise<ResolvedTrack[]> {
  const album = await api<SpotifyAlbumFull>(`/albums/${id}`);
  const albumRef: SpotifyAlbumRef = {
    name: album.name,
    release_date: album.release_date,
    images: album.images,
  };
  const tracks: SpotifyTrack[] = [...album.tracks.items];
  let next = album.tracks.next;
  while (next) {
    const page = await api<{ items: SpotifyTrack[]; next: string | null }>(next);
    tracks.push(...page.items);
    next = page.next;
  }
  // The /albums/{id}/tracks page does not include `album`; graft it back so
  // toResolved() can populate album/year/art consistently.
  return tracks.map(t => toResolved({ ...t, album: albumRef }));
}

interface SpotifyPlaylistItem {
  track: SpotifyTrack | null;
}
interface SpotifyPlaylistTracks {
  items: SpotifyPlaylistItem[];
  next: string | null;
}

export async function fetchPlaylistTracks(id: string): Promise<ResolvedTrack[]> {
  let url: string | null = `/playlists/${id}/tracks?limit=100&fields=items(track(id,uri,name,artists(name),album(name,release_date,images),duration_ms)),next`;
  const out: ResolvedTrack[] = [];
  while (url) {
    const page: SpotifyPlaylistTracks = await api<SpotifyPlaylistTracks>(url);
    for (const it of page.items) {
      if (it.track && it.track.id) out.push(toResolved(it.track));
    }
    url = page.next;
  }
  return out;
}
