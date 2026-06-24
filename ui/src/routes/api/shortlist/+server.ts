import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  getShortlistSongs, addShortlistSong,
  deleteShortlistSongByUri,
} from '$lib/shortlist/shortlist.js';
import { attachYtmLinks } from '$lib/db/ytmLinks.js';
import { enqueueMany } from '$lib/db/metadataQueue.js';

export const GET: RequestHandler = async () => {
  const db = getDb();
  return json(attachYtmLinks(db, getShortlistSongs(db)));
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as {
    spotify_uri?: string; title?: string; artist?: string;
    album?: string; album_art_url?: string; year?: number; duration_sec?: number;
  };
  if (!body.spotify_uri || !body.title || !body.artist) {
    throw error(400, 'spotify_uri, title, and artist are required');
  }
  const db = getDb();
  const song = addShortlistSong(db, {
    spotifyUri: body.spotify_uri,
    title: body.title,
    artist: body.artist,
    album: body.album ?? null,
    albumArtUrl: body.album_art_url ?? null,
    year: body.year ?? null,
    durationSec: body.duration_sec ?? null,
  });
  // Enqueue fast metadata jobs for the new shortlist song.
  enqueueMany(db, [song.spotifyUri], ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics']);
  const autoAudioSetting = db.prepare("SELECT value FROM settings WHERE key='auto_analyze_audio'").get() as { value: string } | undefined;
  if (autoAudioSetting?.value === '1') {
    enqueueMany(db, [song.spotifyUri], ['audio']);
  }
  return json(song, { status: 201 });
};

export const DELETE: RequestHandler = async ({ request, url }) => {
  const spotifyUri = url.searchParams.get('spotify_uri');
  if (spotifyUri) {
    deleteShortlistSongByUri(getDb(), spotifyUri);
    return new Response(null, { status: 204 });
  }
  const body = await request.json().catch(() => ({})) as { spotify_uri?: string };
  if (body.spotify_uri) {
    deleteShortlistSongByUri(getDb(), body.spotify_uri);
    return new Response(null, { status: 204 });
  }
  throw error(400, 'spotify_uri query param required');
};
