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
import { resolveSpotifyFromYtm } from '$lib/songlink.js';

const YTM_URL_RE = /^https?:\/\/music\.youtube\.com\/(watch\?|playlist\?|browse\/)/i;

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

  // Process a single URL once we know which Spotify resource it maps to.
  // Used by both the direct Spotify path and the YTM-resolved-to-Spotify path
  // so reporting/dedup stays uniform. `originalUrl` is what the caller sent;
  // we want it surfaced in `failed[]` (not the post-Songlink Spotify URL).
  async function ingestSpotify(originalUrl: string, parsed: ReturnType<typeof parseSpotifyUrl>): Promise<void> {
    if (!parsed) {
      failed.push({ url: originalUrl, reason: 'songlink returned a non-track Spotify URL we cannot parse' });
      return;
    }
    if (parsed.kind === 'track') {
      addOne(originalUrl, await fetchTrack(parsed.id));
    } else if (parsed.kind === 'album') {
      const tracks = await fetchAlbumTracks(parsed.id);
      if (!tracks.length) failed.push({ url: originalUrl, reason: 'album has no tracks' });
      for (const t of tracks) addOne(originalUrl, t);
    } else {
      const tracks = await fetchPlaylistTracks(parsed.id);
      if (!tracks.length) failed.push({ url: originalUrl, reason: 'playlist has no tracks' });
      for (const t of tracks) addOne(originalUrl, t);
    }
  }

  for (const url of urls) {
    try {
      const parsed = parseSpotifyUrl(url);
      if (parsed) {
        await ingestSpotify(url, parsed);
        continue;
      }
      if (YTM_URL_RE.test(url)) {
        const resolved = await resolveSpotifyFromYtm(url);
        if ('error' in resolved) {
          failed.push({ url, reason: `Songlink lookup failed: ${resolved.error}` });
          continue;
        }
        const spotifyParsed = parseSpotifyUrl(resolved.url);
        if (!spotifyParsed) {
          failed.push({ url, reason: `Songlink returned unparseable Spotify URL: ${resolved.url}` });
          continue;
        }
        await ingestSpotify(url, spotifyParsed);
        continue;
      }
      failed.push({ url, reason: 'unsupported URL — only Spotify (track / album / playlist) and music.youtube.com (track / album / playlist) are accepted' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ url, reason: `fetch failed: ${msg}` });
    }
  }

  return json({ added, failed }, { headers: cors });
};
