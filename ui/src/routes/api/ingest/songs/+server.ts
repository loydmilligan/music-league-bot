import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { addShortlistSong } from '$lib/shortlist/shortlist.js';
import {
  parseSpotifyUrl,
  fetchTrack,
  fetchAlbumTracks,
  fetchPlaylistTracks,
  type ResolvedTrack,
} from '$lib/spotify/client.js';

interface AddedItem { title: string; artist: string; spotifyId: string }
interface FailedItem { url: string; reason: string }

function corsHeaders(origin: string | null): Record<string, string> {
  // Token is the auth boundary per D8; we reflect any origin that asks. Chrome
  // extensions arrive as `chrome-extension://<id>`; webapp same-origin calls
  // don't need CORS at all but the reflected header is harmless.
  const allow = origin ?? '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export const OPTIONS: RequestHandler = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
};

export const POST: RequestHandler = async ({ request }) => {
  const origin = request.headers.get('origin');
  const cors = corsHeaders(origin);

  const db = getDb();
  requireBearerToken(request, db); // throws 401 on miss

  const body = (await request.json().catch(() => ({}))) as { urls?: unknown };
  if (!Array.isArray(body.urls)) throw error(400, 'body.urls (string[]) required');
  const urls = body.urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);

  const added: AddedItem[] = [];
  const failed: FailedItem[] = [];
  const seenUrisThisCall = new Set<string>();

  // Pre-compute existing spotify_uri set for cheap dedup on bulk adds. One read
  // beats N round-trips for an album/playlist hit.
  const existingRows = db.prepare('SELECT spotify_uri FROM shortlist_songs').all() as { spotify_uri: string }[];
  const existingUris = new Set(existingRows.map(r => r.spotify_uri));

  function addOne(url: string, t: ResolvedTrack): void {
    if (existingUris.has(t.uri) || seenUrisThisCall.has(t.uri)) {
      failed.push({ url, reason: 'already in shortlist' });
      return;
    }
    addShortlistSong(db, {
      spotifyUri: t.uri, title: t.title, artist: t.artist,
      album: t.album, albumArtUrl: t.albumArtUrl,
      year: t.year, durationSec: t.durationSec,
    });
    seenUrisThisCall.add(t.uri);
    added.push({ title: t.title, artist: t.artist, spotifyId: t.id });
  }

  for (const url of urls) {
    const parsed = parseSpotifyUrl(url);
    if (!parsed) {
      failed.push({ url, reason: 'only Spotify URLs supported in v1 (track / album / playlist)' });
      continue;
    }
    try {
      if (parsed.kind === 'track') {
        addOne(url, await fetchTrack(parsed.id));
      } else if (parsed.kind === 'album') {
        const tracks = await fetchAlbumTracks(parsed.id);
        if (!tracks.length) failed.push({ url, reason: 'album has no tracks' });
        for (const t of tracks) addOne(url, t);
      } else {
        const tracks = await fetchPlaylistTracks(parsed.id);
        if (!tracks.length) failed.push({ url, reason: 'playlist has no tracks' });
        for (const t of tracks) addOne(url, t);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ url, reason: `spotify fetch failed: ${msg}` });
    }
  }

  return json({ added, failed }, { headers: cors });
};
