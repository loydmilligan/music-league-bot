import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  getShortlistSongs, addShortlistSong,
  deleteShortlistSongByUri,
} from '$lib/shortlist/shortlist.js';

export const GET: RequestHandler = async () => {
  const db = getDb();
  return json(getShortlistSongs(db));
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
